import { AIMarkTasks } from './aiMarkTasks';
import type { AIMark } from './aiMarks';
import { nextAIEditName, type AISuggestion } from './aiVersionEdits';
import type { Transcript } from '../types';
import { editingExamples } from './editingExamples';

/** IDs are unique within the current interview, not paths or display names. */
export interface ConnectorVersion {
  id: string;
  model_id: string;
  edit_id: string;
  name: string;
  kind: 'original' | 'edit';
}
export interface ConnectorReference {
  version: ConnectorVersion;
  load: () => Promise<Transcript | null>;
}

export interface ConnectorDocument {
  editable?: boolean;
  identity: string;
  transcript: Transcript;
  title: string;
  label: string;
  names: string[];
  rules?: string[];
  remember?: (rules: string[]) => Promise<void>;
  version: ConnectorVersion;
  references: () => Promise<ConnectorReference[]>;
}
export interface ConnectorHost {
  current: () => Promise<ConnectorDocument>;
  applyMarks?: (baseline: Transcript, marks: AIMark[], taskId: string) => Promise<Record<string, unknown>>;
  publish: (baseline: Transcript, suggestions: AISuggestion[], name: string) => Promise<Record<string, unknown>>;
}
type Snapshot = ConnectorDocument & { id: string; revision: string };
interface Change { segment_id: string; before: string; after: string }
interface Task {
  snapshot: Snapshot; id: string; summary: string; rules: string[];
  ids: string[]; startOffset: number; endOffset: number;
  staged: Map<string, Change>; state: 'draft' | 'publishing' | 'completed' | 'cancelled';
  name: string; result?: Record<string, unknown>; promise?: Promise<Record<string, unknown>>;
}
function fail(code: string): never { throw new Error(code); }
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail('invalid_range');
  return value as number;
}
function boundary(text: string, offset: number): boolean {
  return offset === text.length || new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text).containing(offset)?.index === offset;
}

/** Owns transient tasks, never a second project store. Model input cannot choose a path. */
export class AIConnector {
  private snapshots = new Map<string, Snapshot>();
  private tasks = new Map<string, Task>();
  private markTasks: AIMarkTasks;
  constructor(private host: ConnectorHost) { this.markTasks = new AIMarkTasks(host, id => this.valid(id)); }
  private async valid(id: unknown): Promise<Snapshot> {
    const snapshot = this.snapshots.get(String(id));
    if (!snapshot) fail('snapshot_expired_read_current_again');
    const current = await this.host.current();
    if (current.identity !== snapshot.identity || JSON.stringify(current.version) !== JSON.stringify(snapshot.version) || JSON.stringify(current.transcript) !== snapshot.revision)
      fail('source_changed_read_current_again');
    return snapshot;
  }
  private task(id: unknown): Task {
    const task = this.tasks.get(String(id));
    if (!task) fail('task_expired');
    return task;
  }
  async handle(operation: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (['prepare_marks', 'stage_marks', 'apply_marks', 'marks_status', 'cancel_marks'].includes(operation)) return this.markTasks.handle(operation, a);
    if (operation === 'read_current') {
      const doc = await this.host.current();
      if (!doc.transcript.segments.length) fail('no_transcript');
      if (this.snapshots.size >= 16) this.snapshots.delete(this.snapshots.keys().next().value!);
      const id = crypto.randomUUID();
      const snapshot = { ...doc, transcript: structuredClone(doc.transcript), id, revision: JSON.stringify(doc.transcript) };
      this.snapshots.set(id, snapshot);
      return { snapshot: id, title: doc.title, version: doc.label, segment_count: doc.transcript.segments.length,
        current_version: doc.version,
        duration: doc.transcript.audio.duration, speakers: doc.transcript.speakers, current_interview_rules: doc.rules ?? [],
        instructions: 'Current version is the continuation target. Call read_editing_examples to resolve comparison versions before learning style. If comparison selection is required, list candidates and ask the user; never silently choose. Read pages as needed. Ask for an explicit continuation start. Do not display full text by default.' };
    }
    if (operation === 'read_page') {
      const s = await this.valid(a.snapshot);
      const limit = a.max_chars === undefined ? 6000 : integer(a.max_chars, 500, 12000);
      const cursor = String(a.cursor ?? '0:0');
      if (!/^\d+:\d+$/.test(cursor)) fail('invalid_cursor');
      let [index, offset] = cursor.split(':').map(Number);
      integer(index, 0, s.transcript.segments.length);
      const segments: Record<string, unknown>[] = [];
      let size = 0;
      while (index < s.transcript.segments.length && size < limit && segments.length < 40) {
        const segment = s.transcript.segments[index];
        integer(offset, 0, segment.text.length);
        if (!boundary(segment.text, offset)) fail('invalid_cursor');
        let end = Math.min(segment.text.length, offset + limit - size);
        while (end > offset && !boundary(segment.text, end)) end--;
        if (end === offset && offset < segment.text.length) break;
        segments.push({ id: segment.id, speaker_id: segment.speaker_id, start: segment.start, end: segment.end,
          text_offset: offset, text: segment.text.slice(offset, end), complete_segment: offset === 0 && end === segment.text.length });
        size += end - offset;
        if (end === segment.text.length) { index++; offset = 0; } else { offset = end; break; }
      }
      return { snapshot: s.id, segments, next_cursor: index < s.transcript.segments.length ? `${index}:${offset}` : null,
        complete: index === s.transcript.segments.length };
    }
    if (operation === 'read_examples') {
      const s = await this.valid(a.snapshot);
      const requested = a.segment_ids;
      if (!Array.isArray(requested) || requested.length > 20 || requested.some(id => typeof id !== 'string')) fail('select_up_to_20_example_segments');
      const references = (await s.references()).filter(r => r.version.id !== s.version.id);
      await this.valid(a.snapshot);
      const context = { snapshot: s.id, current_version: s.version, comparison_versions: references.map(r => r.version), examples: [] };
      let reference: ConnectorReference | undefined;
      if (a.comparison_version_id !== undefined) {
        if (typeof a.comparison_version_id !== 'string') fail('invalid_comparison_version_id');
        reference = references.find(r => r.version.id === a.comparison_version_id);
        if (!reference) return { ...context, comparison_status: 'unavailable', reason: 'comparison_version_not_available', needs_reference: true };
      } else if (references.length === 1 && references[0].version.kind === 'original') reference = references[0];
      else return { ...context, comparison_status: references.length ? 'selection_required' : 'unavailable',
        reason: references.length ? 'choose_comparison_version' : 'no_comparison_versions', needs_reference: true,
        instruction: 'List comparison versions with their IDs and ask which to compare. Do not infer preferences yet.' };
      let baseline: Transcript | null;
      try { baseline = await reference.load(); } catch { baseline = null; }
      await this.valid(a.snapshot);
      const comparison = { before_version: reference.version, after_version: s.version };
      if (!baseline) return { ...context, comparison, comparison_status: 'unavailable', reason: 'comparison_version_unreadable', needs_reference: true };
      const examples = editingExamples(baseline, s.transcript, reference.version, s.version, requested);
      const reliable = examples.filter(e => 'before' in e).length;
      return { ...context, comparison, comparison_status: requested.length && !reliable ? 'unreliable' : 'resolved', examples,
        ...(requested.length && !reliable ? { reason: 'no_reliable_example_pairs' } : {}),
        changed_examples: examples.filter(e => e.changed === true).length,
        reliable_examples: reliable,
        instruction: 'before comes from before_version; after comes from after_version (the continuation target). Unchanged examples only describe these selected segments, not the whole manuscript. Ambiguous examples are not differences. Confirm which changes are human-authored before inferring personal style; AI or mixed edits require user confirmation.' };
    }
    if (operation === 'prepare') {
      const s = await this.valid(a.snapshot);
      if (typeof a.start_id !== 'string' || !a.start_id) return { needs_clarification: ['continuation_start'], writable: false };
      if (!Array.isArray(a.rules) || !a.rules.length || a.rules.length > 30 || a.rules.some(rule => typeof rule !== 'string' || !rule.trim() || rule.length > 2000))
        return { needs_clarification: ['key_style_rules'], writable: false };
      const segments = s.transcript.segments;
      const first = segments.findIndex(segment => segment.id === a.start_id);
      const last = a.end_id === undefined ? segments.length - 1 : segments.findIndex(segment => segment.id === a.end_id);
      if (first < 0 || last < first) fail('invalid_range');
      const startOffset = a.start_offset === undefined ? 0 : integer(a.start_offset, 0, segments[first].text.length);
      const endOffset = a.end_offset === undefined ? segments[last].text.length : integer(a.end_offset, 0, segments[last].text.length);
      if (!boundary(segments[first].text, startOffset) || !boundary(segments[last].text, endOffset) || (first === last && startOffset >= endOffset)) fail('invalid_range');
      const ids = segments.slice(first, last + 1).map(segment => segment.id);
      if (segments.slice(first, last + 1).some(segment => segment.text.length > 12000)) fail('segment_too_large_split_in_ripple_first');
      if (this.tasks.size >= 32) fail('too_many_tasks_cancel_or_restart_connection');
      const name = nextAIEditName(s.label, s.names);
      const summary = JSON.stringify({ source: s.label, start_id: a.start_id, start_offset: startOffset,
        end_id: segments[last].id, end_offset: endOffset, rules: a.rules, new_version: name });
      const task: Task = { snapshot: s, id: crypto.randomUUID(), summary, rules: a.rules as string[], ids,
        startOffset, endOffset, staged: new Map(), state: 'draft', name };
      this.tasks.set(task.id, task);
      return { task_id: task.id, summary, start_id: ids[0], end_id: ids.at(-1), segment_count: ids.length,
        new_version: name, instruction: 'Confirm key style and scope in conversation. Stage every in-scope segment, including unchanged ones, then publish once.' };
    }
    if (operation === 'stage') {
      const task = this.task(a.task_id);
      if (task.state !== 'draft') fail('task_not_editable');
      await this.valid(task.snapshot.id);
      if (task.state !== 'draft') fail('task_not_editable');
      if (!Array.isArray(a.changes) || a.changes.length > 32 || !a.changes.length) fail('invalid_batch');
      const validated: Change[] = [];
      const seen = new Set<string>();
      for (const item of a.changes) {
        if (typeof item !== 'object' || item === null) fail('invalid_change');
        const change = item as Change;
        if (typeof change.segment_id !== 'string' || typeof change.before !== 'string' || typeof change.after !== 'string' ||
          !change.after.trim() || change.after.length > 16000 || seen.has(change.segment_id) || !task.ids.includes(change.segment_id)) fail('invalid_change');
        const segment = task.snapshot.transcript.segments.find(s => s.id === change.segment_id)!;
        if (segment.text !== change.before) fail('before_text_mismatch');
        if (change.segment_id === task.ids[0] && !change.after.startsWith(change.before.slice(0, task.startOffset))) fail('start_prefix_changed');
        if (change.segment_id === task.ids.at(-1) && !change.after.endsWith(change.before.slice(task.endOffset))) fail('end_suffix_changed');
        seen.add(change.segment_id); validated.push({ segment_id: change.segment_id, before: change.before, after: change.after });
      }
      for (const change of validated) task.staged.set(change.segment_id, change);
      return { staged: task.staged.size, remaining: task.ids.length - task.staged.size, published: false };
    }
    if (operation === 'status') {
      const task = this.task(a.task_id);
      return { task_id: task.id, state: task.state, summary: task.summary,
        staged_ids: [...task.staged.keys()], remaining_ids: task.ids.filter(id => !task.staged.has(id)), result: task.result ?? null };
    }
    if (operation === 'cancel') {
      const task = this.task(a.task_id);
      if (task.state === 'publishing' || task.state === 'completed') fail('already_publishing_or_saved');
      task.state = 'cancelled'; task.staged.clear();
      return { cancelled: true };
    }
    if (operation === 'publish') {
      const task = this.task(a.task_id);
      if (a.confirmed_summary !== task.summary) fail('confirmation_changed');
      if (task.result) return task.result;
      if (task.promise) return task.promise;
      if (task.state !== 'draft') fail('task_not_editable');
      await this.valid(task.snapshot.id);
      if (task.result) return task.result;
      if (task.promise) return task.promise;
      if (task.state !== 'draft') fail('task_not_editable');
      if (task.staged.size !== task.ids.length) fail('incomplete_task_continue_staging');
      const suggestions = [...task.staged.values()].filter(c => c.before !== c.after)
        .map(c => ({ id: c.segment_id, text: c.after, reason: task.rules.join('; ') }));
      if (!suggestions.length) {
        await task.snapshot.remember?.(task.rules);
        task.state = 'completed'; task.result = { saved: false, reason: 'no_changes', source_version: task.snapshot.label };
        return task.result;
      }
      // State and shared promise serialize independent calls before the first await.
      task.state = 'publishing';
      task.promise = this.host.publish(task.snapshot.transcript, suggestions, task.name).then(async result => {
        let rulesSaved = true;
        try { await task.snapshot.remember?.(task.rules); } catch { rulesSaved = false; }
        task.result = { ...result, saved: true, rules_saved: rulesSaved, changed_segments: suggestions.length, source_version: task.snapshot.label };
        task.state = 'completed'; return task.result;
      }).catch(error => { task.state = 'draft'; task.promise = undefined; throw error; });
      return task.promise;
    }
    fail('unsupported_operation');
  }
}
