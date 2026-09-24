import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime, formatTime, toDatetimeLocalValue, today } from "./format";

describe("formatTime", () => {
  it("不足 1 小时 → mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(599)).toBe("09:59");
  });

  it("超过 1 小时 → h:mm:ss", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("分钟与秒补零", () => {
    expect(formatTime(60)).toBe("01:00");
    expect(formatTime(61)).toBe("01:01");
  });

  it("非有限值按 0 处理", () => {
    expect(formatTime(NaN)).toBe("00:00");
    expect(formatTime(Infinity)).toBe("00:00");
  });

  it("负数按 0 处理", () => {
    expect(formatTime(-5)).toBe("00:00");
  });
});

describe("toDatetimeLocalValue", () => {
  it("截到分钟，去掉秒和时区", () => {
    expect(toDatetimeLocalValue("2026-08-31T23:45:12.000Z")).toBe("2026-08-31T23:45");
  });

  it("无值返回空串", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(undefined)).toBe("");
    expect(toDatetimeLocalValue("")).toBe("");
  });

  it("非法格式返回空串", () => {
    expect(toDatetimeLocalValue("昨天")).toBe("");
  });
});

describe("today", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("返回本地无关的 YYYY-MM-DD", () => {
    vi.setSystemTime(new Date("2026-08-31T15:00:00Z"));
    expect(today()).toBe("2026-08-31");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-08-31T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("不足 1 分钟 → 刚刚", () => {
    expect(formatRelativeTime(new Date(now - 30_000).toISOString())).toBe("刚刚");
  });

  it("不足 1 小时 → N 分钟前", () => {
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5 分钟前");
  });

  it("不足 1 天 → N 小时前", () => {
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString())).toBe("3 小时前");
  });

  it("不足 7 天 → N 天前", () => {
    expect(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString())).toBe("2 天前");
  });

  it("非法时间返回空串", () => {
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});
it('keeps date-only metadata date-only when reopening',()=>{
 expect(toDatetimeLocalValue('2026-09-20')).toBe('2026-09-20');
 expect(toDatetimeLocalValue('2026-09-20T14:30:00')).toBe('2026-09-20T14:30');
});
it('preserves year and month precision without inventing dates',()=>{
 expect(toDatetimeLocalValue('2026')).toBe('2026');
 expect(toDatetimeLocalValue('2026-09')).toBe('2026-09');
});
