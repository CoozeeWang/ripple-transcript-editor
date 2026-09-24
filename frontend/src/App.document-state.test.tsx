// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import type { UseFolderDeps } from "./hooks/useFolder";

const fixture = vi.hoisted(() => ({ folder: null as UseFolderDeps | null, flush: vi.fn(async () => {}) }));
vi.mock("./hooks/useFolder", () => ({ useFolder: (deps: UseFolderDeps) => {
  fixture.folder = deps;
  return { dirHandle: null, dirHandleRef: { current: null }, startPref: { type: "last" },
    preferredStartName: "", recentFolders: [], audioFiles: [], legacyEntries: [],
    migratingLegacy: false, selectedAudio: null, setSelectedAudio: vi.fn(),
    refreshAudioList: vi.fn(), loadAudio: vi.fn(), applyStartPref: vi.fn(),
    pickPreferredFolder: vi.fn(), handleOpenFolder: vi.fn(), handleOpenRecentFolder: vi.fn(),
    handleMigrateLegacy: vi.fn() };
} }));
vi.mock("./hooks/useProviders", () => ({ useProviders: () => ({ providers: [],
  selectedProviderId: "", setSelectedProviderId: vi.fn(), defaultProviderId: null,
  activeProviderName: "", setActiveProviderName: vi.fn() }) }));
vi.mock("./hooks/usePersistence", () => ({ usePersistence: () => ({ flushPendingSave: fixture.flush }) }));
vi.mock("./hooks/useOpeningPosition", () => ({ useOpeningPosition: () => {} }));

function load(name: string) {
  const transcript = { audio: { filename: name, duration: 2 },
    speakers: [{ id: "speaker_0", name: "说话人 1" }],
    segments: [{ id: "seg_1", speaker_id: "speaker_0", start: 0, end: 2, text: `${name}的内容` }] };
  const metadata = { id: name, title: name, participants: [], topics: [], notes: "", location: "",
    recorded_at: null, created_at: "", updated_at: "" };
  act(() => { fixture.folder!.onLoaded({ url: "", manifest: { schemaVersion: 2, audio: name, models: [], activeModelId: "" },
    edited: { kind: "te-edited", audio: name, transcript, metadata } }, name); });
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("does not inherit hidden speaker IDs from old global storage or a previous document", () => {
  localStorage.setItem("te-hidden-speakers", JSON.stringify(["speaker_0"]));
  render(<App />);
  load("A.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "隐藏 说话人 1" }));
  expect(screen.getByRole("button", { name: "显示 说话人 1" })).toBeTruthy();
  // A failed navigation must leave A's view alone.
  act(() => { fixture.folder!.onLoadError("无法打开", true); });
  expect(screen.getByRole("button", { name: "显示 说话人 1" })).toBeTruthy();
  load("B.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "显示 说话人 1" })).toBeNull();
  load("A.wav");
  expect(screen.getByRole("button", { name: "隐藏 说话人 1" })).toBeTruthy();
});

it("clears find and replace text when loading another document", () => {
  render(<App />);
  load("A.wav");
  fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
  fireEvent.change(screen.getByPlaceholderText("查找"), { target: { value: "A.wav" } });
  fireEvent.click(screen.getByTitle("显示替换选项"));
  fireEvent.change(screen.getByPlaceholderText("替换为"), { target: { value: "旧文稿的替换" } });
  load("B.wav");
  expect(screen.queryByPlaceholderText("查找")).toBeNull();
  fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
  expect((screen.getByPlaceholderText("查找") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByTitle("显示替换选项"));
  expect((screen.getByPlaceholderText("替换为") as HTMLInputElement).value).toBe("");
});

it('waits for successful persistence before leaving the editor for projects', async () => {
  const leave = vi.fn();
  render(<App onReturnToProjects={leave} />);
  load('A.wav');
  fixture.flush.mockRejectedValueOnce(new Error('保存失败，请重试'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Ripple，返回项目" })); });
  expect(leave).not.toHaveBeenCalled();
  expect(screen.getByText(/保存失败，请重试/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '返回项目' })); });
  expect(leave).toHaveBeenCalledOnce();
});
