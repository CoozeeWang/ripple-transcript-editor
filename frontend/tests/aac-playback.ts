// Public synthetic test only: no project files, microphone or transcription API.
import { prepareAudioForPlayback } from '../src/lib/adts';
import sampleUrl from '../../mock-data/audio-playback-test/synthetic-32k.aac?url';

const result = document.getElementById('result')!;
const report = (value: Record<string, unknown>) => {
  result.textContent = JSON.stringify(value, null, 2);
  const host = window as unknown as { webkit?: { messageHandlers?: { result?: { postMessage: (value: string) => void } } } };
  host.webkit?.messageHandlers?.result?.postMessage(result.textContent);
};
const hash = async (blob: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
const check = (valid: boolean, message: string) => { if (!valid) throw new Error(message); };

function metadata(audio: HTMLAudioElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Metadata timed out')), 20000);
    const finish = (error?: Error) => {
      clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null;
      if (error) reject(error); else resolve();
    };
    audio.onloadedmetadata = () => finish();
    audio.onerror = () => finish(new Error(`Media error ${audio.error?.code}`));
    audio.src = url;
  });
}
function advance(audio: HTMLAudioElement, position: number): Promise<number> {
  audio.pause();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Playback timed out at ${position}`)), 20000);
    const finish = (error?: Error) => {
      clearTimeout(timer); audio.ontimeupdate = null; audio.onerror = null; audio.pause();
      if (error) reject(error); else resolve(audio.currentTime);
    };
    audio.onerror = () => finish(new Error(`Media error ${audio.error?.code}`));
    audio.ontimeupdate = () => { if (audio.currentTime > position + 0.05) finish(); };
    audio.currentTime = position;
    void audio.play().catch(error => finish(error));
  });
}

async function run() {
  const response = await fetch(sampleUrl);
  check(response.ok, 'Synthetic sample could not be read');
  const sample = new Uint8Array(await response.arrayBuffer());
  const source = new Blob(Array.from({ length: 2048 }, () => sample));
  // Match the desktop file bridge's one-MiB input chunks.
  const data = await source.arrayBuffer();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < data.byteLength; at += 1024 * 1024) {
    chunks.push(new Uint8Array(data, at, Math.min(1024 * 1024, data.byteLength - at)));
  }
  const file = new File(chunks, 'synthetic-long.aac');
  const sourceHash = await hash(file);
  const prepared = await prepareAudioForPlayback(file, file.name);
  check(prepared.type === 'audio/mp4', 'Playback should use an MP4 container');
  const playbackHash = await hash(prepared); // Fails on the old WebKit many-fragment Blob.
  check(await hash(file) === sourceHash, 'Original AAC bytes changed');
  const audio = new Audio(); audio.muted = true; audio.volume = 0;
  const url = URL.createObjectURL(prepared);
  try {
    await metadata(audio, url);
    const expectedSeconds = 131072 * 1024 / 32000;
    check(Math.abs(audio.duration - expectedSeconds) < 0.2, 'Unexpected playback duration');
    const duration = audio.duration;
    const start = await advance(audio, 0);
    const middle = await advance(audio, duration / 2);
    const end = await advance(audio, duration - 1);
    check(await hash(file) === sourceHash, 'Playback changed the original AAC');
    report({ status: 'passed', frames: 131072, sourceBytes: file.size, playbackBytes: prepared.size,
      sourceHash, playbackHash, duration, playedAt: [start, middle, end] });
  } finally {
    audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
  }
}
const button = document.getElementById('run') as HTMLButtonElement;
async function execute() {
  button.disabled = true;
  result.textContent = 'Running…';
  try { await run(); }
  catch (error) { report({ status: 'failed', error: String(error) }); }
  finally { button.disabled = false; }
}
button.onclick = () => { void execute(); };
void execute();
