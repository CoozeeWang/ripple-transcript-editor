// @vitest-environment jsdom
/** Real original-model writes in an in-memory filesystem; provider calls are mocked. */
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { msg, setInterfaceLanguage } from '../src/i18n';
import { createModel, readManifest, readModelEdit, readModelOriginal, TranscriptionError } from '../src/localStore';
import { useTranscription } from '../src/hooks/useTranscription';
import type { ProcessStatus } from '../src/hooks/useVersions';
import { TranscriptHeader } from '../src/components/TranscriptHeader';
import { TranscribeAudioButton } from '../src/components/TranscribeAudioButton';
import { TranscriptionDialog } from '../src/TranscriptionDialog';
import type { ProviderInfo, Transcript, TranscriptManifest } from '../src/types';
import { syntheticDirectory, syntheticTree, syntheticWave, type SyntheticTree } from './syntheticProjectDirectory';

const api = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock('../src/localStore', async importOriginal => ({
  ...await importOriginal<typeof import('../src/localStore')>(),
  transcribeAudio: api.transcribe,
  acknowledgeTranscription: vi.fn(async () => {}),
}));
const audio = 'Synthetic interview.wav';
const providers: ProviderInfo[] = [{ id:'synthetic', name:'Synthetic engine', configured:true, models:[], credential_fields:[],
  capabilities:{ diarization:true, language_selection:true, speaker_count_hint:true, audio_events:true, word_timestamps:true } }];
const transcript = (text: string): Transcript => ({ audio:{ filename:audio, duration:8 }, speakers:[{ id:'s', name:'Synthetic speaker' }],
  segments:[{ id:'one', speaker_id:'s', start:0, end:8, text }] });
const nothing = () => {};

beforeEach(async () => {
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile);
  HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/providers/synthetic/credentials') return new Response(JSON.stringify({ active_profile_id:'default', profiles:[
      { id:'default', name:'Synthetic default', is_default:true }, { id:'other', name:'Synthetic other', is_default:false },
    ] }));
    if (url.endsWith('/activate')) return new Response('{}');
    throw new Error('Unexpected request blocked by synthetic test');
  }));
  await setInterfaceLanguage('zh-CN');
});
afterEach(async () => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); await setInterfaceLanguage('zh-CN'); });

function snapshot(tree: SyntheticTree, prefix = ''): Record<string, number[]> {
  return Object.fromEntries([...tree.files].map(([name, bytes]) => [prefix+name, [...bytes]]).concat(
    [...tree.folders].flatMap(([name, folder]) => Object.entries(snapshot(folder, prefix+name+'/')))));
}
async function fixture() {
  const tree = syntheticTree(); tree.files.set(audio, syntheticWave());
  const dir = syntheticDirectory(tree, 'Synthetic project');
  const original = transcript('Synthetic original words');
  const edited = transcript('Human correction to keep');
  edited.segments[0].annotations = [{ id:'human-note', text:'Retained human annotation', createdAt:'2026-01-01' }];
  edited.segments[0].highlights = [{ id:'human-highlight', start:0, end:5 }];
  const old = await createModel(dir, audio, { engine:'Synthetic old engine', original, transcript:edited });
  const reopened = await readModelEdit(dir, audio, old.model.id, 'e1');
  const before = snapshot(tree);
  function Harness() {
    const directory = useRef(dir);
    const [manifest, setManifest] = useState<TranscriptManifest>(old.manifest);
    const [current, setCurrent] = useState(old.edited.transcript);
    const [status, setStatus] = useState<ProcessStatus>('idle');
    const [message, setMessage] = useState('');
    const hook = useTranscription({ dirHandleRef:directory, selectedAudio:audio, providers, contextKey:'old-edit',
      initialMetadata:old.edited.metadata, beforeChange:async()=>{}, processStatus:status, setProcessStatus:setStatus,
      setProcessMessage:setMessage, setActiveProviderName:nothing, setMetadata:nothing, reset:setCurrent,
      setSelectedSegmentId:nothing, setHasLoadedTranscript:nothing, setSaveStatus:nothing, applyManifest:next=>{if(next)setManifest(next);},
      setNamingTarget:nothing, setNamingOpen:nothing, setNamingValue:nothing, refreshAudioList:async()=>{},
    });
    return <>
      <TranscriptHeader metadata={old.edited.metadata} segmentCount={current.segments.length} viewingOriginal={false}
        activeModelId={manifest.activeModelId} patchMetadata={nothing} forkFromOriginal={nothing} versionControls={null}
        transcriptionControl={<TranscribeAudioButton onClick={()=>hook.setTranscriptionDialogOpen(true)} disabledReason={hook.transcribeJob ? msg('transcriptionAction.running') : undefined}/>}/>
      {hook.transcriptionDialogOpen && <TranscriptionDialog providers={providers} defaultProviderId="synthetic" selectedProviderId="synthetic"
        onSelectProvider={nothing} hasAudio audioFilename={audio} busy={Boolean(hook.transcribeJob)} preserveExisting
        onClose={()=>hook.setTranscriptionDialogOpen(false)} onStart={hook.startTranscription}/>}
      {hook.transcribeJob && <button onClick={hook.cancelTranscription}>Cancel synthetic job</button>}
      <output data-testid="current">{JSON.stringify(current)}</output><output data-testid="manifest">{JSON.stringify(manifest)}</output>
      <output data-testid="message">{message}</output>
    </>;
  }
  render(<Harness/>);
  return { tree, dir, old, reopened, before, unchanged:()=>expect(snapshot(tree)).toEqual(before) };
}
async function openSettings() {
  fireEvent.click(screen.getByRole('button', { name:msg('transcriptionAction.transcribe') }));
  const confirm = await screen.findByRole('button', { name:msg('transcriptionAction.confirm') });
  await waitFor(()=>expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect(api.transcribe).not.toHaveBeenCalled();
  return confirm;
}
async function start() {
  fireEvent.click(await openSettings());
  await waitFor(()=>expect(api.transcribe).toHaveBeenCalledOnce());
}

test.each(['zh-CN','zh-TW','en'] as const)('title-row entry opens settings and cancellation preserves every byte in %s', async language => {
  await setInterfaceLanguage(language);
  const f = await fixture(); const opener = screen.getByRole('button', { name:msg('transcriptionAction.transcribe') });
  expect(opener.closest('.transcript-title-row')?.querySelector('h1')).toBeTruthy();
  expect(opener.parentElement?.getAttribute('data-tip')).toBe(msg('transcriptionAction.transcribe'));
  opener.focus(); await openSettings();
  expect(screen.getByText(msg('transcriptionAction.preserve'))).toBeTruthy();
  expect(screen.getByText(msg('transcriptionAction.preserveDetails'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name:msg('TranscriptionDialog.m0145') }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
  expect(api.transcribe).not.toHaveBeenCalled(); f.unchanged();
});

test('success appends a fresh original, keeps existing models and all original/edit/audio bytes', async () => {
  const f = await fixture(); api.transcribe.mockResolvedValue(transcript('Synthetic new recognition'));
  await start();
  await waitFor(()=>expect(JSON.parse(screen.getByTestId('manifest').textContent!).models).toHaveLength(2));
  const manifest = (await readManifest(f.dir, audio))!;
  expect(manifest.models[0]).toEqual(f.old.model);
  expect(manifest.models[1].id).not.toBe(f.old.model.id);
  expect(manifest.models[1].original).not.toBe(f.old.model.original);
  expect(manifest.models[1].edits).toEqual([]); expect(manifest.models[1].designatedOriginal).toBe(true);
  const after = snapshot(f.tree);
  for (const [file, bytes] of Object.entries(f.before)) if (!file.endsWith('/manifest.json')) expect(after[file]).toEqual(bytes);
  expect(await readModelEdit(f.dir, audio, f.old.model.id, 'e1')).toEqual(f.reopened);
  expect((await readModelOriginal(f.dir, audio, f.old.model.id))?.transcript.segments[0].text).toBe('Synthetic original words');
  expect((await readModelOriginal(f.dir, audio, manifest.models[1].id))?.transcript.segments[0].text).toBe('Synthetic new recognition');
});

test('provider failure leaves the old current draft, annotations, highlights and disk unchanged', async () => {
  const f = await fixture(); api.transcribe.mockRejectedValue(new TranscriptionError('Synthetic provider unavailable', 'network'));
  await start(); await waitFor(()=>expect(screen.getByTestId('message').textContent).toContain('Synthetic provider unavailable'));
  expect(JSON.parse(screen.getByTestId('current').textContent!)).toEqual(f.old.edited.transcript); f.unchanged();
  expect((screen.getByRole('button', { name:msg('transcriptionAction.transcribe') }) as HTMLButtonElement).disabled).toBe(false);
});

test('in-flight cancellation preserves old data and disables the same-audio entry until settled', async () => {
  const f = await fixture();
  api.transcribe.mockImplementation((_dir, _audio, _options, callbacks) => new Promise((_resolve, reject) => {
    callbacks.signal.addEventListener('abort', ()=>reject(new TranscriptionError('Synthetic cancelled', 'aborted')));
  }));
  await start();
  const entry = screen.getByRole('button', { name:msg('transcriptionAction.transcribe') });
  expect((entry as HTMLButtonElement).disabled).toBe(true); fireEvent.click(entry); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name:'Cancel synthetic job' }));
  await waitFor(()=>expect((entry as HTMLButtonElement).disabled).toBe(false));
  expect(JSON.parse(screen.getByTestId('current').textContent!)).toEqual(f.old.edited.transcript); f.unchanged();
});

test('synchronous repeated confirmation cannot activate an account or submit twice', async () => {
  const f = await fixture();
  let activated!: () => void;
  const activate = new Promise<Response>(resolve=>{activated=()=>resolve(new Response('{}'));});
  const fetch = vi.mocked(globalThis.fetch), originalFetch = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options)=>String(url).includes('/other/activate') ? activate : originalFetch(url, options));
  api.transcribe.mockResolvedValue(transcript('Synthetic recognition'));
  const button = await openSettings();
  fireEvent.change(screen.getByRole('combobox', { name:msg('TranscriptionDialog.m0118') }), { target:{ value:'synthetic:other' } });
  fireEvent.change(screen.getByRole('combobox', { name:msg('TranscriptionDialog.m0130') }), { target:{ value:'eng' } });
  fireEvent.change(screen.getByRole('spinbutton'), { target:{ value:'3' } });
  fireEvent.click(screen.getByRole('checkbox', { name:new RegExp(msg('TranscriptionDialog.m0137')) }));
  const form = button.closest('form')!;
  act(()=>{fireEvent.submit(form);fireEvent.submit(form);fireEvent.click(button);});
  expect(fetch.mock.calls.filter(([url])=>String(url).includes('/other/activate'))).toHaveLength(1);
  expect(api.transcribe).not.toHaveBeenCalled();
  await act(async()=>activated());
  await waitFor(()=>expect(api.transcribe).toHaveBeenCalledOnce());
  await waitFor(()=>expect(JSON.parse(screen.getByTestId('manifest').textContent!).models).toHaveLength(2));
  expect(api.transcribe.mock.calls[0][2]).toMatchObject({ language_code:'eng', num_speakers:3, diarize:false });
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>String(url).includes('/default/activate'))).toBe(true));
  expect((await readManifest(f.dir, audio))?.models).toHaveLength(2);
});

test('closing while account activation is pending prevents a late provider submission', async () => {
  const f = await fixture(); let activated!: () => void;
  const pending = new Promise<Response>(resolve=>{activated=()=>resolve(new Response('{}'));});
  const fetch = vi.mocked(globalThis.fetch), originalFetch = fetch.getMockImplementation()!;
  fetch.mockImplementation((url, options)=>String(url).includes('/other/activate') ? pending : originalFetch(url, options));
  const button = await openSettings();
  fireEvent.change(screen.getByRole('combobox', { name:msg('TranscriptionDialog.m0118') }), { target:{ value:'synthetic:other' } });
  fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name:msg('TranscriptionDialog.m0145') }));
  await act(async()=>activated());
  expect(api.transcribe).not.toHaveBeenCalled(); f.unchanged();
});
