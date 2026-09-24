// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { Transcript, TranscriptionOptions } from "../types";
import { TranscriptionError } from "../localStore";
import type { ProcessStatus } from "./useVersions";
import { useTranscription, type UseTranscriptionDeps } from "./useTranscription";

// 只替换真正会打网络/文件的两件事，其余的（TranscriptionError 等）用真身，
// 否则 `instanceof` 判定会失真。
const store = vi.hoisted(() => ({ transcribeAudio: vi.fn(), createModel: vi.fn() }));

vi.mock("../localStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../localStore")>();
  return {
    ...actual,
    transcribeAudio: store.transcribeAudio,
    createModel: store.createModel,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function transcriptWith(text: string): Transcript {
  return {
    audio: { filename: "a.wav", duration: 12 },
    speakers: [{ id: "spk1", name: "说话人 1", colorIndex: 0 }],
    segments: [{ id: "s1", start: 0, end: 12, text, speaker_id: "spk1", words: [] }],
  };
}

function makeDeps(overrides: Partial<UseTranscriptionDeps> = {}): UseTranscriptionDeps {
  return {
    beforeChange: vi.fn(async () => {}),
    contextKey: ":false",
    dirHandleRef: { current: { name: "采访" } as unknown as FileSystemDirectoryHandle },
    selectedAudio: "a.wav",
    providers: [{ id: "iflytek", name: "讯飞" }],
    setActiveProviderName: vi.fn(),
    processStatus: "idle" as ProcessStatus,
    setProcessStatus: vi.fn(),
    setProcessMessage: vi.fn(),
    setMetadata: vi.fn(),
    reset: vi.fn(),
    setSelectedSegmentId: vi.fn(),
    setHasLoadedTranscript: vi.fn(),
    setSaveStatus: vi.fn(),
    applyManifest: vi.fn(),
    setNamingTarget: vi.fn(),
    setNamingOpen: vi.fn(),
    setNamingValue: vi.fn(),
    refreshAudioList: vi.fn(async () => {}),
    ...overrides,
  };
}

const options = {} as TranscriptionOptions;

/** 转录「挂住不返回」，直到测试自己 resolve / reject。 */
function pendingTranscription() {
  const deferred: { resolve: (t: Transcript) => void; reject: (e: unknown) => void } = {
    resolve: () => {},
    reject: () => {},
  };
  const pending = new Promise<Transcript>((resolve, reject) => {
    deferred.resolve = resolve;
    deferred.reject = reject;
  });
  store.transcribeAudio.mockImplementation(() => pending);
  return deferred;
}

test("转录中切到别的文件：任务不丢，稿子落盘但不覆盖正在看的文件", async () => {
  const settle = pendingTranscription();
  const edited = transcriptWith("嗯，我那时候在拉萨。");
  store.createModel.mockResolvedValue({
    model: { id: "m1" },
    manifest: { models: [], activeModelId: "m1" },
    edited: { metadata: null, transcript: edited },
  });

  const deps = makeDeps();
  const { result, rerender } = renderHook((d: UseTranscriptionDeps) => useTranscription(d), {
    initialProps: deps,
  });

  let started!: Promise<void>;
  act(() => { started = result.current.startTranscription(options, "iflytek"); });
  // 任务身份是「转录中」这块界面的依据：它必须带着是谁在跑。
  expect(result.current.transcribeJob).toMatchObject({ audio: "a.wav", engine: "讯飞" });
  expect(deps.setProcessStatus).toHaveBeenCalledWith("transcribing");

  // 用户切到 b.wav，App 载入完成后会把状态重置回 ready —— 任务本身不受影响。
  rerender({ ...deps, selectedAudio: "b.wav" });
  act(() => { deps.setProcessStatus("ready" as ProcessStatus); });
  expect(result.current.transcribeJob).toMatchObject({ audio: "a.wav" });

  await act(async () => { settle.resolve(transcriptWith("原始识别结果")); await started; });

  // 写盘用的是 a.wav，界面状态没有被 b.wav 的视图吞掉。
  expect(store.createModel.mock.calls[0][1]).toBe("a.wav");
  expect(deps.reset).not.toHaveBeenCalled();
  expect(deps.applyManifest).not.toHaveBeenCalled();
  expect(deps.refreshAudioList).toHaveBeenCalled();
  expect(deps.setProcessMessage).toHaveBeenCalledWith(expect.stringContaining("“a.wav”转录完成"));
  expect(deps.setProcessMessage).toHaveBeenCalledWith(expect.stringContaining("切回该音频即可查看"));
  // 任务收尾后身份清空，界面才能回到「这一屏」自己的状态。
  expect(result.current.transcribeJob).toBeNull();
});

test("切走之后再取消：不向调用方抛错，只在当前这一屏留一句交代", async () => {
  const settle = pendingTranscription();
  const deps = makeDeps();
  const { result, rerender } = renderHook((d: UseTranscriptionDeps) => useTranscription(d), {
    initialProps: deps,
  });

  let started!: Promise<void>;
  act(() => { started = result.current.startTranscription(options, "iflytek"); });
  rerender({ ...deps, selectedAudio: "b.wav" });
  act(() => { result.current.cancelTranscription(); });
  settle.reject(new TranscriptionError("已取消这次转录。", "aborted"));

  await act(async () => { await expect(started).resolves.toBeUndefined(); });
  expect(deps.setProcessStatus).toHaveBeenLastCalledWith("idle");
  expect(deps.setProcessMessage).toHaveBeenLastCalledWith("已停止等待“a.wav”的转录结果。稍后仍可继续等待原任务。");
});

test.each([
  ["response_timeout", "稍后重试"],
  ["upload_timeout", "压缩音频或切成几段"],
  ["network", "请先重试"],
])("失败码 %s：给出对症的下一步建议", async (code, expected) => {
  store.transcribeAudio.mockRejectedValue(
    new TranscriptionError("引擎等了很久", code, "The read operation timed out"),
  );
  const deps = makeDeps();
  const { result } = renderHook((d: UseTranscriptionDeps) => useTranscription(d), {
    initialProps: deps,
  });

  await act(async () => {
    await expect(result.current.startTranscription(options, "iflytek")).rejects.toThrow(
      "引擎等了很久",
    );
  });

  // 「等不到结果」和「连不上」必须给不同的下一步；否则用户不知道该等、该查网络、
  // 还是该换引擎。原始英文仍然保留，供复制排查。
  expect(result.current.transcribeHint).toContain(expected);
  expect(result.current.transcribeRaw).toBe("The read operation timed out");
});

test("有任务在跑时再点开始转录：报错点名是谁在跑，并指向取消入口", async () => {
  pendingTranscription();
  const deps = makeDeps();
  const { result } = renderHook((d: UseTranscriptionDeps) => useTranscription(d), {
    initialProps: deps,
  });

  // 第一个任务挂在半途，模拟「正在跑」。
  act(() => { void result.current.startTranscription(options, "iflytek"); });

  await act(async () => {
    await expect(result.current.startTranscription(options, "iflytek")).rejects.toThrow("“a.wav”正在转录");
    await expect(result.current.startTranscription(options, "iflytek")).rejects.toThrow("停止等待");
  });
  expect(store.transcribeAudio).toHaveBeenCalledTimes(1);
});
