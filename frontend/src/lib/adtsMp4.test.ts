import { describe, expect, test } from 'vitest';
import { remuxAdtsToMp4, UnsupportedAdtsError } from './adtsMp4';

function frame(payload: number[], options: { profile?: number; crc?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const headerSize = options.crc ? 9 : 7;
  const length = headerSize + payload.length;
  const result = new Uint8Array(length);
  result.set([0xff, options.crc ? 0xf0 : 0xf1,
    ((options.profile ?? 1) << 6) | (5 << 2),
    (1 << 6) | ((length >> 11) & 3),
    (length >> 3) & 255,
    ((length & 7) << 5) | 0x1f, 0xfc]);
  result.set(payload, headerSize);
  return result;
}

function findBox(data: Uint8Array, type: string, start = 0, end = data.length): { start: number; end: number } | null {
  for (let at = start; at + 8 <= end;) {
    const size = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0);
    if (size < 8 || at + size > end) return null;
    if (String.fromCharCode(...data.subarray(at + 4, at + 8)) === type) return { start: at, end: at + size };
    at += size;
  }
  return null;
}

describe('ADTS playback container', () => {
  test('rewraps frames without changing the source bytes or encoded payload', async () => {
    const originalBytes = new Uint8Array([...frame([1, 2, 3]), ...frame([4, 5], { crc: true })]);
    const original = new Blob([originalBytes]);
    const result = await remuxAdtsToMp4(original);
    expect(result.type).toBe('audio/mp4');
    expect(Array.from(new Uint8Array(await original.arrayBuffer()))).toEqual(Array.from(originalBytes));
    const bytes = new Uint8Array(await result.arrayBuffer());
    const moov = findBox(bytes, 'moov');
    const mdat = findBox(bytes, 'mdat');
    expect(moov).not.toBeNull();
    expect(mdat).not.toBeNull();
    expect(Array.from(bytes.subarray(mdat!.start + 8, mdat!.end))).toEqual([1, 2, 3, 4, 5]);
    const trak = findBox(bytes, 'trak', moov!.start + 8, moov!.end)!;
    const mdia = findBox(bytes, 'mdia', trak.start + 8, trak.end)!;
    const minf = findBox(bytes, 'minf', mdia.start + 8, mdia.end)!;
    const stbl = findBox(bytes, 'stbl', minf.start + 8, minf.end)!;
    const stsz = findBox(bytes, 'stsz', stbl.start + 8, stbl.end)!;
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(stsz.start + 16)).toBe(2);
    expect([view.getUint32(stsz.start + 20), view.getUint32(stsz.start + 24)]).toEqual([3, 2]);
  });

  test('leaves another audio container untouched', async () => {
    const original = new Blob([new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112])]);
    expect(await remuxAdtsToMp4(original)).toBe(original);
  });

  test('reports unsupported AAC profiles and incomplete frames', async () => {
    await expect(remuxAdtsToMp4(new Blob([frame([1, 2, 3], { profile: 2 })])))
      .rejects.toBeInstanceOf(UnsupportedAdtsError);
    const broken = frame([1, 2, 3]);
    broken[4] = 10;
    await expect(remuxAdtsToMp4(new Blob([broken]))).rejects.toBeInstanceOf(UnsupportedAdtsError);
  });
});
