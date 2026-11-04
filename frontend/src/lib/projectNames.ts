import { msg } from '../i18n';
import type { ProjectInterview } from './projectStore';

/** Titles use the existing trim-only convention. Legacy duplicate identities remain readable. */
export function assertProjectNameChange(before: ProjectInterview[], after: ProjectInterview[]): void {
  const check = (old: Array<{id:string;name:string}>, next: Array<{id:string;name:string}>, key: 'sessionNameConflict'|'audioNameConflict') => {
    const names = new Map<string, Set<string>>();
    for (const item of next) {
      const name = item.name.trim();
      const ids = names.get(name) ?? new Set<string>(); ids.add(item.id); names.set(name, ids);
    }
    for (const [name, ids] of names) if (ids.size > 1) {
      const previous = new Set(old.filter(item => item.name.trim() === name).map(item => item.id));
      if ([...ids].some(id => !previous.has(id))) throw new Error(msg(`projectStore.${key}`, { name }));
    }
  };
  check(before.map(s => ({id:s.id,name:s.title})), after.map(s => ({id:s.id,name:s.title})), 'sessionNameConflict');
  const audio = (sessions: ProjectInterview[]) => sessions.flatMap(s => s.recordings.filter(r => r.storage !== 'none'));
  check(audio(before), audio(after), 'audioNameConflict');
}
