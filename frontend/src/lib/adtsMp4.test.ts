import { describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
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

const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('ADTS playback container', () => {
  test('keeps long AAC readable with a fragment-limited Blob implementation', async () => {
    // WebKit can create a many-slice Blob but later fail reading/playing it.
    // Fail at construction here so this engine-limit regression also runs in Node.
    const NativeBlob = Blob;
    const count = 131073; // Crosses the observed failure range, with a partial final batch.
    const encodedFrame = frame([1, 2, 3, 4, 5, 6, 7, 8]);
    const input = new Uint8Array(encodedFrame.length * count);
    for (let index = 0; index < count; index++) input.set(encodedFrame, index * encodedFrame.length);
    const source = new NativeBlob([input]);
    vi.stubGlobal('Blob', class extends NativeBlob {
      constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
        if (parts.length > 65536) throw new Error('Playback Blob has too many fragments');
        super(parts, options);
      }
    });
    try {
      const result = await remuxAdtsToMp4(source);
      const output = new Uint8Array(await result.arrayBuffer());
      const mdat = findBox(output, 'mdat')!;
      const expected = new Uint8Array(count * 8);
      for (let index = 0; index < count; index++) expected.set(encodedFrame.subarray(7), index * 8);
      expect(hash(output.subarray(mdat.start + 8, mdat.end))).toBe(hash(expected));
      expect(hash(new Uint8Array(await source.arrayBuffer()))).toBe(hash(input));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('preserves CRC payloads, order and sample tables across byte-sized batches', async () => {
    const count = 1301;
    const payloadSize = 1024;
    const frames = Array.from({ length: count }, (_, index) => frame(
      Array.from({ length: payloadSize }, (_, at) => (index + at) & 255),
      { crc: index % 2 === 0 },
    ));
    const source = new Blob(frames);
    const before = hash(new Uint8Array(await source.arrayBuffer()));
    const output = new Uint8Array(await (await remuxAdtsToMp4(source)).arrayBuffer());
    const mdat = findBox(output, 'mdat')!;
    const expected = new Uint8Array(count * payloadSize);
    for (let index = 0; index < count; index++) {
      expected.set(frames[index].subarray(index % 2 === 0 ? 9 : 7), index * payloadSize);
    }
    expect(hash(output.subarray(mdat.start + 8, mdat.end))).toBe(hash(expected));
    const moov = findBox(output, 'moov')!;
    const trak = findBox(output, 'trak', moov.start + 8, moov.end)!;
    const mdia = findBox(output, 'mdia', trak.start + 8, trak.end)!;
    const minf = findBox(output, 'minf', mdia.start + 8, mdia.end)!;
    const stbl = findBox(output, 'stbl', minf.start + 8, minf.end)!;
    const stsz = findBox(output, 'stsz', stbl.start + 8, stbl.end)!;
    const stts = findBox(output, 'stts', stbl.start + 8, stbl.end)!;
    const view = new DataView(output.buffer);
    expect(view.getUint32(stsz.start + 16)).toBe(count);
    for (let index = 0; index < count; index++) expect(view.getUint32(stsz.start + 20 + index * 4)).toBe(payloadSize);
    expect(view.getUint32(stts.start + 16)).toBe(count);
    expect(view.getUint32(stts.start + 20)).toBe(1024);
    expect(hash(new Uint8Array(await source.arrayBuffer()))).toBe(before);
  });

  test('still rejects a truncated frame after a completed batch', async () => {
    const valid = frame([1, 2, 3]);
    const source = new Blob([...Array.from({ length: 2048 }, () => valid), valid.slice(0, -1)]);
    await expect(remuxAdtsToMp4(source)).rejects.toBeInstanceOf(UnsupportedAdtsError);
  });

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
