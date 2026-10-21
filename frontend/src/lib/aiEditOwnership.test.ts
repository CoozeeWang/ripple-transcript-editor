import { describe, expect, it } from 'vitest';
import { AIEditOwnership, blocksHumanEditing, ownsEditing, visibleAIActivities } from './aiEditOwnership';
import type { ConnectorDocument } from './aiConnector';
const doc = { identity: 'synthetic', label: 'Synthetic v1', version: { id: 'm:e' } } as ConnectorDocument;
describe('AI write ownership', () => {
  it('replaces a saved success on a new target and keeps receipts and other protected tasks', () => {
    const own = new AIEditOwnership(() => {});
    own.acquire('saved', 'chatgpt', doc, 'text', 2);
    own.update('saved', { state: 'completed', saved: 2 });
    own.acquire('protected', 'claude', { ...doc, identity: 'other' }, 'marks', 1);
    own.update('protected', { state: 'failed' });
    expect(visibleAIActivities(own.values()).map(task => task.task_id)).toEqual(['protected']);
    own.acquire('new', 'workbuddy', { ...doc, identity: 'third' }, 'text', 3);
    expect(own.get('saved')?.saved).toBe(2);
    own.dismiss('protected');
    expect(blocksHumanEditing(own.get('protected')!)).toBe(true);
    expect(visibleAIActivities(own.values()).map(task => task.task_id)).toEqual(['protected', 'new']);
  });
  it('locks only the exact target, checks clients, and never implicitly revives ended tasks', () => {
    const own = new AIEditOwnership(() => {});
    own.acquire('one', 'chatgpt', doc, 'marks', 2);
    expect(() => own.acquire('two', 'claude', doc, 'text', 1)).toThrow('locked_by_other_ai');
    expect(() => own.assert('one', 'claude')).toThrow('another_client');
    own.acquire('other', 'workbuddy', { ...doc, identity: 'other' }, 'text', 1);
    own.end('one');
    own.endAll('connection_disabled');
    expect(own.get('one')?.reason).toBe('user_ended');
    expect(() => own.assert('one', 'chatgpt')).toThrow('editing_task_ended');
    expect(() => own.acquire('one', 'chatgpt', doc, 'marks', 2)).toThrow('editing_task_ended');
    expect(ownsEditing(own.get('other')!)).toBe(false);
  });
  it('retains exclusive protection during idle, pause, error and disconnect until explicit end', () => {
    let now = 0; const own = new AIEditOwnership(() => {}, () => now);
    own.acquire('one', 'chatgpt', doc, 'marks', 1);
    own.update('one', { inFlight: 1, state: 'saving' }); now = 500;
    expect(own.get('one')?.state).toBe('saving');
    own.update('one', { inFlight: 0 }); now = 700;
    expect(blocksHumanEditing(own.get('one')!)).toBe(true);
    own.update('one', { state: 'failed' });
    expect(blocksHumanEditing(own.get('one')!)).toBe(true);
    own.interruptAll('connection_lost');
    expect(blocksHumanEditing(own.get('one')!)).toBe(true);
    expect(() => own.acquire('other', 'claude', doc, 'marks', 1)).toThrow('locked_by_other_ai');
    own.end('one');
    expect(blocksHumanEditing(own.get('one')!)).toBe(false);
  });
  it('revokes future writes immediately but keeps a pending save protected until it settles', () => {
    const own = new AIEditOwnership(() => {}); own.acquire('one', 'chatgpt', doc, 'marks', 1);
    own.update('one', { state: 'saving', inFlight: 1 }); own.end('one');
    expect(() => own.assert('one')).toThrow('editing_task_ended');
    expect(blocksHumanEditing(own.get('one')!)).toBe(true);
    expect(() => own.acquire('two', 'claude', doc, 'text', 1)).toThrow('locked_by_other_ai');
    own.update('one', { inFlight: 0 });
    expect(blocksHumanEditing(own.get('one')!)).toBe(false);
    own.acquire('two', 'claude', doc, 'text', 1);
  });
});
