import { msg } from '../i18n';
import { remuxAdtsToMp4, UnsupportedAdtsError } from './adtsMp4';

/** Legacy helper retained for compatibility tests only. Playback must preserve every frame;
 * a short AAC frame alone does not establish corruption. Do not call this from playback/import. */
const SUSPICIOUS_FRAME_BYTES = 100;

/** ADTS 帧头固定 7 字节（无 CRC）或 9 字节（含 CRC）。 */
const ADTS_HEADER_BYTES = 7;

function isAdtsFrameHeader(bytes: Uint8Array, at: number): boolean {
  if (at + 1 >= bytes.length) return false;
  // 同步字 0xFFF（高 12 位）+ layer 字段必须为 00 —— 后半条把 MP3 挡在外面。
  return bytes[at] === 0xff && (bytes[at + 1] & 0xf6) === 0xf0;
}

function adtsFrameLength(bytes: Uint8Array, at: number): number {
  return ((bytes[at + 3] & 0x03) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5);
}

/**
 * 若 blob 是「首帧为桩帧」的裸 ADTS 流，返回去掉该帧的视图；其余情况原样返回。
 * 用 slice 而不是复制，所以不会把整个文件读进内存。
 */
export async function stripStubFirstFrame(blob: Blob): Promise<Blob> {
  try {
    const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
    if (head.length < 16 || !isAdtsFrameHeader(head, 0)) return blob;
    const first = adtsFrameLength(head, 0);
    // 首帧必须小得离谱、且完整落在已读范围内，否则不碰。
    if (first < ADTS_HEADER_BYTES || first >= SUSPICIOUS_FRAME_BYTES) return blob;
    // 第二帧必须是正常帧——两条证据齐了才认定是桩帧，避免误伤合法的极短首帧。
    if (!isAdtsFrameHeader(head, first)) return blob;
    if (adtsFrameLength(head, first) < SUSPICIOUS_FRAME_BYTES) return blob;
    return blob.slice(first);
  } catch {
    // 读不出来就当没这回事，让后续流程报它自己的错。
    return blob;
  }
}

/** The returned view is for playback only; callers retain the original file for saving/transcription. */
export async function prepareAudioForPlayback(blob: Blob, name: string): Promise<Blob> {
  if (!/\.aac$/i.test(name)) {
    const mime:Record<string,string>={m4a:'audio/mp4',m4b:'audio/mp4',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',flac:'audio/flac',ogg:'audio/ogg',oga:'audio/ogg',opus:'audio/ogg',webm:'audio/webm'};
    const type=mime[name.split('.').at(-1)?.toLowerCase()??''];
    return type&&(!blob.type||blob.type==='application/octet-stream')?blob.slice(0,blob.size,type):blob;
  }
  // Preserve every frame and its duration. A short frame is not proof of corrupt audio.
  try {
    return await remuxAdtsToMp4(blob);
  } catch (error) {
    if (error instanceof UnsupportedAdtsError) {
      throw new Error(msg('audioPlayback.unsupportedAdts', { v0: name }), { cause: error });
    }
    throw error;
  }
}
