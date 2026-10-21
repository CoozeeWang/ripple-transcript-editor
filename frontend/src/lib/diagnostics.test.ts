// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DIAGNOSTICS_KEY, MAX_PROBLEMS, recordProblem, readProblems, problemDetails } from "./diagnostics";
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it("keeps useful classifications without storing messages, filenames or document contents", () => {
  const error = Object.assign(new Error('secret-key 私有访谈全文 /Users/person/private.wav'), { code: 'response_timeout' });
  const p = recordProblem('transcription', error);
  expect(p.reason).toBe('timeout');
  const output = localStorage.getItem(DIAGNOSTICS_KEY)! + problemDetails(p);
  for (const secret of ['secret-key', '私有访谈全文', 'private.wav', '/Users']) expect(output).not.toContain(secret);
});
it("limits records, groups rapid repeated errors, and expires old entries", () => {
  recordProblem('save'); recordProblem('save');
  expect(readProblems()).toHaveLength(1); expect(readProblems()[0].count).toBe(2);
  for (let i = 0; i < 110; i++) recordProblem(i % 2 ? 'save' : 'open');
  expect(readProblems()).toHaveLength(MAX_PROBLEMS);
  const rows = readProblems(); rows[0].time = '2000-01-01T00:00:00.000Z';
  localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(rows));
  expect(readProblems()).toHaveLength(MAX_PROBLEMS - 1);
});
it("does not export extra fields from stored data", () => {
  const p = recordProblem('rename');
  localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify([{ ...p, raw: 'secret-key' }]));
  expect(JSON.stringify(readProblems())).not.toContain('secret-key');
});
