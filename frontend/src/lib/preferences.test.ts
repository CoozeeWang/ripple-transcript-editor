import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOLLOW_PLAYBACK_KEY,
  HIDDEN_SPEAKERS_KEY,
  PLAYBACK_RATE_KEY,
  SKIP_SECONDS_KEY,
  loadBooleanPreference,
  loadNumberPreference,
  loadSetPreference,
  saveBooleanPreference,
  saveNumberPreference,
  saveSetPreference,
} from "./preferences";

/** 内存版 localStorage，模拟浏览器行为（含 getItem/setItem）。 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

let storage: Storage;

beforeEach(() => {
  storage = createMemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadNumberPreference / saveNumberPreference", () => {
  it("无值返回 fallback", () => {
    expect(loadNumberPreference(PLAYBACK_RATE_KEY, 1)).toBe(1);
  });

  it("保存后能读回", () => {
    saveNumberPreference(SKIP_SECONDS_KEY, 3);
    expect(loadNumberPreference(SKIP_SECONDS_KEY, 0)).toBe(3);
  });

  it("非法数值返回 fallback", () => {
    storage.setItem(PLAYBACK_RATE_KEY, "not-a-number");
    expect(loadNumberPreference(PLAYBACK_RATE_KEY, 1.5)).toBe(1.5);
  });
});

describe("loadSetPreference / saveSetPreference", () => {
  it("无值返回空 Set", () => {
    expect(loadSetPreference(HIDDEN_SPEAKERS_KEY)).toEqual(new Set());
  });

  it("保存后能读回", () => {
    saveSetPreference(HIDDEN_SPEAKERS_KEY, new Set(["a", "b"]));
    expect(loadSetPreference(HIDDEN_SPEAKERS_KEY)).toEqual(new Set(["a", "b"]));
  });

  it("非法 JSON 返回空 Set", () => {
    storage.setItem(HIDDEN_SPEAKERS_KEY, "{not-json");
    expect(loadSetPreference(HIDDEN_SPEAKERS_KEY)).toEqual(new Set());
  });

  it("过滤掉非字符串元素", () => {
    storage.setItem(HIDDEN_SPEAKERS_KEY, JSON.stringify(["a", 1, null, "b"]));
    expect(loadSetPreference(HIDDEN_SPEAKERS_KEY)).toEqual(new Set(["a", "b"]));
  });
});

describe("loadBooleanPreference / saveBooleanPreference", () => {
  it("无值返回 fallback", () => {
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, true)).toBe(true);
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, false)).toBe(false);
  });

  it("保存 true 读回 true", () => {
    saveBooleanPreference(FOLLOW_PLAYBACK_KEY, true);
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, false)).toBe(true);
  });

  it("保存 false 读回 false", () => {
    saveBooleanPreference(FOLLOW_PLAYBACK_KEY, false);
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, true)).toBe(false);
  });

  it("只把 1/true 视为 true，其余视为 false", () => {
    storage.setItem(FOLLOW_PLAYBACK_KEY, "true");
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, false)).toBe(true);
    storage.setItem(FOLLOW_PLAYBACK_KEY, "1");
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, false)).toBe(true);
    storage.setItem(FOLLOW_PLAYBACK_KEY, "yes");
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, true)).toBe(false);
  });
});

describe("localStorage 不可用时的降级", () => {
  it("getItem 抛错时返回 fallback", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage);
    expect(loadNumberPreference(PLAYBACK_RATE_KEY, 2)).toBe(2);
    expect(loadBooleanPreference(FOLLOW_PLAYBACK_KEY, true)).toBe(true);
    expect(loadSetPreference(HIDDEN_SPEAKERS_KEY)).toEqual(new Set());
  });

  it("setItem 抛错时不抛出", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage);
    expect(() => {
      saveNumberPreference(PLAYBACK_RATE_KEY, 2);
      saveSetPreference(HIDDEN_SPEAKERS_KEY, new Set(["x"]));
      saveBooleanPreference(FOLLOW_PLAYBACK_KEY, true);
    }).not.toThrow();
  });
});
