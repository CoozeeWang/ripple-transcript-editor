// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  InterviewMetadata,
  Transcript,
  TranscriptManifest,
} from "../types";
import { removeEdit, readModelEdit, createEdit, renameEditLabel } from "../localStore";
import { useVersions } from "./useVersions";

afterEach(cleanup);

/** 内存版「转录目录」：文件名 → 文件内容。替代 File System Access API。 */
const fake = vi.hoisted(() => ({
  files: new Map<string, unknown>(),
  manifest: null as unknown as TranscriptManifest,
}));

vi.mock("../localStore", () => ({
  saveActiveEdit: vi.fn(
    async (
      _dir: unknown,
      _name: string,
      modelId: string,
      editId: string,
      data: unknown,
    ) => {
      const model = fake.manifest.models.find((m) => m.id === modelId);
      const edit = model?.edits.find((e) => e.id === editId);
      if (!edit) return;
      fake.files.set(edit.file, JSON.parse(JSON.stringify(data)));
    },
  ),
  readManifest: vi.fn(async () => fake.manifest),
  readModelEdit: vi.fn(
    async (_dir: unknown, name: string, modelId: string, editId: string) => {
      const model = fake.manifest.models.find((m) => m.id === modelId);
      const edit = model?.edits.find((e) => e.id === editId);
      const raw = edit ? (fake.files.get(edit.file) as StoredFile | undefined) : null;
      if (!raw) return null;
      return {
        kind: "te-edited",
        audio: name,
        metadata: raw.metadata,
        transcript: raw.transcript,
      };
    },
  ),
  readModelOriginal: vi.fn(async (_dir: unknown, _name: string, modelId: string) => {
    const model = fake.manifest.models.find((m) => m.id === modelId);
    const raw = model?.original
      ? (fake.files.get(model.original) as StoredFile | undefined)
      : null;
    return raw ? { transcript: raw.transcript } : null;
  }),
  persistActiveModel: vi.fn(
    async (_dir: unknown, _name: string, modelId: string, editId?: string) => {
      fake.manifest = {
        ...fake.manifest,
        activeModelId: modelId,
        models: fake.manifest.models.map((m) =>
          m.id === modelId && editId ? { ...m, activeEditId: editId } : m,
        ),
      };
      return fake.manifest;
    },
  ),
  readEdited: vi.fn(async () => null),
  createEdit: vi.fn(),
  removeEdit: vi.fn(),
  removeModelOriginal: vi.fn(),
  renameEditLabel: vi.fn(),
  renameModelLabel: vi.fn(),
}));

function transcriptWith(text: string): Transcript {
  return {
    audio: { filename: "a.m4a", duration: 10 },
    speakers: [{ id: "speaker_0", name: "A" }],
    segments: [
      { id: "s1", speaker_id: "speaker_0", start: 0, end: 1, text },
    ],
  };
}

const METADATA: InterviewMetadata = {
  id: "a",
  title: "a",
  recorded_at: null,
  location: "",
  participants: [],
  topics: [],
  notes: "",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const MANIFEST: TranscriptManifest = {
  schemaVersion: 2,
  audio: "a.m4a",
  models: [
    {
      id: "m1",
      engine: "ElevenLabs",
      original: "m1-original.json",
      edits: [{ id: "e1", file: "m1-e1.json", updated_at: "2026-01-01" }],
      activeEditId: "e1",
    },
  ],
  activeModelId: "m1",
};

/** 假磁盘上存放的两种文件内容：修改稿（te-edited）与原稿（te-original）。 */
interface StoredFile {
  kind: string;
  audio?: string;
  metadata?: InterviewMetadata;
  transcript: Transcript;
}

type Api = ReturnType<typeof useVersions>;
type Controls = { setTranscript: (t: Transcript) => void };

function Harness({
  apiRef,
  controlsRef,
  initialTranscript,
}: {
  apiRef: { current: Api | null };
  controlsRef: { current: Controls | null };
  initialTranscript: Transcript;
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [metadata] = useState(METADATA);
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(
    {} as FileSystemDirectoryHandle,
  );

  const api = useVersions({
    dirHandleRef,
    selectedAudio: "a.m4a",
    transcript,
    metadata,
    reset: (t) => setTranscript(t),
    setMetadata: () => {},
    setSelectedSegmentId: () => {},
    setHasLoadedTranscript: () => {},
    setViewingOriginal,
    viewingOriginal,
    setImportRepairs: () => {},
    setProcessStatus: () => {},
    setProcessMessage: () => {},
  });

  const { namingOpen, namingRef, setNamingOpen } = api;

  // 挂载时灌入 manifest（等价于打开音频后读到的清单）
  useEffect(() => {
    api.applyManifest(fake.manifest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每次渲染后刷新句柄：测试拿到的是最新一次渲染的 api，其闭包里的 transcript /
  // viewingOriginal 才是当前值（与真实点击时拿到的一致）。
  useEffect(() => {
    apiRef.current = api;
    controlsRef.current = { setTranscript };
  }, [api, apiRef, controlsRef]);

  return <>
    <div data-testid="text">{transcript.segments[0]?.text}</div>
    <button onClick={() => setNamingOpen(true)}>修改版本名称</button>
    {namingOpen && <div className="overlay"><div ref={namingRef}>设置版本名称</div></div>}
  </>;
}

function textOf(root: HTMLElement): string {
  return root.querySelector('[data-testid="text"]')?.textContent ?? "";
}

beforeEach(() => {
  fake.files.clear();
  fake.manifest = MANIFEST;
  fake.files.set("m1-original.json", {
    kind: "te-original",
    transcript: transcriptWith("引擎原稿"),
  });
  fake.files.set("m1-e1.json", {
    kind: "te-edited",
    audio: "a.m4a",
    metadata: METADATA,
    transcript: transcriptWith("用户的修改"),
  });
});

describe("useVersions 原稿/修改稿切换", () => {
  it("打开命名窗口后，双击的第二次按下不会关闭窗口，Esc 仍可关闭", () => {
    const apiRef: { current: Api | null } = { current: null };
    const controlsRef: { current: Controls | null } = { current: null };
    const { getByRole, container } = render(<Harness apiRef={apiRef} controlsRef={controlsRef}
      initialTranscript={transcriptWith("用户的修改")} />);
    fireEvent.click(getByRole("button", { name: "修改版本名称" }));
    const overlay = container.querySelector(".overlay")!;
    fireEvent.pointerDown(overlay);
    fireEvent.pointerUp(overlay);
    fireEvent.click(overlay, { detail: 2 });
    expect(apiRef.current!.namingOpen).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(apiRef.current!.namingOpen).toBe(false);
  });
  it("切到原稿再切回修改稿，修改稿内容保持不变（不被原稿覆盖）", async () => {
    const apiRef: { current: Api | null } = { current: null };
    const controlsRef: { current: Controls | null } = { current: null };
    const { container } = render(
      <Harness
        apiRef={apiRef}
        controlsRef={controlsRef}
        initialTranscript={transcriptWith("用户的修改")}
      />,
    );
    expect(textOf(container)).toBe("用户的修改");

    // 1) 切到原稿
    await act(async () => {
      await apiRef.current!.openOriginal("m1");
    });
    expect(textOf(container)).toBe("引擎原稿");
    // 磁盘上的修改稿必须还是用户的内容
    const onDisk = fake.files.get("m1-e1.json") as StoredFile;
    expect(onDisk.transcript.segments[0].text).toBe("用户的修改");

    // 2) 切回修改稿
    await act(async () => {
      await apiRef.current!.selectEdit("m1", "e1");
    });
    expect(textOf(container)).toBe("用户的修改");
  });

  it("切到原稿前会把内存中未落盘的修改写入修改稿", async () => {
    const apiRef: { current: Api | null } = { current: null };
    const controlsRef: { current: Controls | null } = { current: null };
    const { container } = render(
      <Harness
        apiRef={apiRef}
        controlsRef={controlsRef}
        initialTranscript={transcriptWith("用户的修改")}
      />,
    );

    // 模拟用户继续编辑（防抖自动保存尚未触发时切走）
    act(() => {
      controlsRef.current!.setTranscript(transcriptWith("刚打完还没保存"));
    });
    expect(textOf(container)).toBe("刚打完还没保存");

    await act(async () => {
      await apiRef.current!.openOriginal("m1");
    });
    const onDisk = fake.files.get("m1-e1.json") as StoredFile;
    expect(onDisk.transcript.segments[0].text).toBe("刚打完还没保存");
  });
});

function hookDeps() {
  return {dirHandleRef:{current:{} as FileSystemDirectoryHandle},selectedAudio:"a.m4a",
    transcript:transcriptWith("用户的修改"),metadata:METADATA,reset:vi.fn(),setMetadata:vi.fn(),
    setSelectedSegmentId:vi.fn(),setHasLoadedTranscript:vi.fn(),setViewingOriginal:vi.fn(),viewingOriginal:false,
    setImportRepairs:vi.fn(),setProcessStatus:vi.fn(),setProcessMessage:vi.fn(),beforeChange:vi.fn(async()=>{})};
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

it("keeps the old save target until the fallback manuscript has finished loading",async()=>{
 const deps=hookDeps();const ui=renderHook(()=>useVersions(deps));
 act(()=>ui.result.current.applyManifest(MANIFEST));
 const next={...MANIFEST,models:[{...MANIFEST.models[0],activeEditId:"e2",edits:[{id:"e2",file:"2.json",updated_at:""}]}]};
 vi.mocked(removeEdit).mockResolvedValueOnce(next);
 const read=deferred<Awaited<ReturnType<typeof readModelEdit>>>();vi.mocked(readModelEdit).mockReturnValueOnce(read.promise);
 act(()=>ui.result.current.setDeletePrompt({kind:"edit",modelId:"m1",editId:"e1",label:"旧稿",isLast:false}));
 let work!:Promise<void>;await act(async()=>{work=ui.result.current.confirmDelete();});
 expect(ui.result.current.activeModel?.activeEditId).toBe("e1");expect(deps.reset).not.toHaveBeenCalled();
 await act(async()=>{read.resolve({kind:"te-edited",audio:"a.m4a",metadata:METADATA,transcript:transcriptWith("剩余稿件")});await work;});
 expect(ui.result.current.activeModel?.activeEditId).toBe("e2");expect(deps.reset).toHaveBeenCalledWith(transcriptWith("剩余稿件"));
});
it("does not replace the current document after a slow version creation finishes in another interview",async()=>{
 const deps=hookDeps();const ui=renderHook(p=>useVersions(p),{initialProps:deps});
 act(()=>{ui.result.current.applyManifest(MANIFEST);ui.result.current.setNamingTarget({kind:"create",modelId:"m1"});});
 const write=deferred<Awaited<ReturnType<typeof createEdit>>>();vi.mocked(createEdit).mockReturnValueOnce(write.promise);
 let work!:Promise<void>;await act(async()=>{work=ui.result.current.confirmNaming("新稿");});
 ui.rerender({...deps,selectedAudio:"b.wav"});
 await act(async()=>{write.resolve({manifest:MANIFEST,model:MANIFEST.models[0],edit:MANIFEST.models[0].edits[0],edited:{kind:"te-edited",audio:"a.m4a",metadata:METADATA,transcript:transcriptWith("A 的结果")}});await work;});
 expect(deps.reset).not.toHaveBeenCalled();expect(deps.setMetadata).not.toHaveBeenCalled();
});

it("renames in place without opening naming dialog or changing selection",async()=>{
 const deps=hookDeps();const ui=renderHook(()=>useVersions(deps));
 act(()=>ui.result.current.applyManifest(MANIFEST));
 const renamed={...MANIFEST,models:[{...MANIFEST.models[0],edits:[{...MANIFEST.models[0].edits[0],label:"定稿"}]}]};
 vi.mocked(renameEditLabel).mockResolvedValueOnce(renamed);
 await act(async()=>{await ui.result.current.renameVersion("m1","e1"," 定稿 ");});
 expect(renameEditLabel).toHaveBeenCalledWith(deps.dirHandleRef.current,"a.m4a","m1","e1","定稿");
 expect(ui.result.current.activeModel?.edits[0].label).toBe("定稿");
 expect(ui.result.current.activeModel?.activeEditId).toBe("e1");
 expect(ui.result.current.namingOpen).toBe(false);expect(deps.reset).not.toHaveBeenCalled();
});
