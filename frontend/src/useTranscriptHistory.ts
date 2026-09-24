import { useCallback, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T | null;
  future: T[];
  lastGroupKey: string | null;
  lastCommitAt: number;
}
const MAX_HISTORY_LENGTH = 100;
const GROUPING_WINDOW_MS = 1000;

export function useTranscriptHistory<T>() {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: null,
    future: [],
    lastGroupKey: null,
    lastCommitAt: 0,
  });

  const reset = useCallback((value: T) => {
    setHistory({
      past: [],
      present: value,
      future: [],
      lastGroupKey: null,
      lastCommitAt: 0,
    });
  }, []);

  const commit = useCallback((updater: (current: T) => T, groupKey?: string) => {
    setHistory((current) => {
      if (!current.present) return current;

      const now = Date.now();
      const canGroup = Boolean(
        groupKey &&
          groupKey === current.lastGroupKey &&
          now - current.lastCommitAt <= GROUPING_WINDOW_MS,
      );
      const next = updater(current.present);

      return {
        past: canGroup
          ? current.past
          : [...current.past, current.present].slice(-MAX_HISTORY_LENGTH),
        present: next,
        future: [],
        lastGroupKey: groupKey ?? null,
        lastCommitAt: now,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (!previous || !current.present) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
        lastGroupKey: null,
        lastCommitAt: 0,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next || !current.present) return current;
      return {
        past: [...current.past, current.present].slice(-MAX_HISTORY_LENGTH),
        present: next,
        future: current.future.slice(1),
        lastGroupKey: null,
        lastCommitAt: 0,
      };
    });
  }, []);

  return {
    transcript: history.present,
    reset,
    commit,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
