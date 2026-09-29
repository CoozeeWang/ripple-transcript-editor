/** Rewrap raw ADTS AAC frames for playback. The source Blob is never changed. */

export class UnsupportedAdtsError extends Error {}

const SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const MAX_U32 = 0xffffffff;

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values);
}

function u16(value: number): Uint8Array<ArrayBuffer> {
  return bytes((value >>> 8) & 255, value & 255);
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  return bytes((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function ascii(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value, char => char.charCodeAt(0));
}

function join(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function box(name: string, ...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const payload = join(...parts);
  return join(u32(payload.length + 8), ascii(name), payload);
}

function fullBox(name: string, flags: number, ...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  return box(name, u32(flags), ...parts);
}

function descriptor(tag: number, payload: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const size = payload.length;
  const length = bytes((size >>> 21) | 0x80, ((size >>> 14) & 0x7f) | 0x80,
    ((size >>> 7) & 0x7f) | 0x80, size & 0x7f);
  return join(bytes(tag), length, payload);
}

const MATRIX = join(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));

function movieHeader(duration: number): Uint8Array<ArrayBuffer> {
  return fullBox('mvhd', 0, u32(0), u32(0), u32(1000), u32(duration), u32(0x10000),
    u16(0x100), u16(0), u32(0), u32(0), MATRIX, new Uint8Array(24), u32(2));
}

function trackHeader(duration: number): Uint8Array<ArrayBuffer> {
  return fullBox('tkhd', 3, u32(0), u32(0), u32(1), u32(0), u32(duration),
    u32(0), u32(0), u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0));
}

function sampleDescription(rateIndex: number, sampleRate: number, channels: number): Uint8Array<ArrayBuffer> {
  const config = bytes((2 << 3) | (rateIndex >> 1), ((rateIndex & 1) << 7) | (channels << 3));
  const decSpecific = descriptor(5, config);
  const decoder = descriptor(4, join(bytes(0x40, 0x15, 0, 0, 0), u32(0), u32(0), decSpecific));
  const es = descriptor(3, join(u16(1), bytes(0), decoder, descriptor(6, bytes(2))));
  const mp4a = box('mp4a', new Uint8Array(6), u16(1), new Uint8Array(8),
    u16(channels), u16(16), u16(0), u16(0), u32(sampleRate * 65536), fullBox('esds', 0, es));
  return fullBox('stsd', 0, u32(1), mp4a);
}

function movie(rateIndex: number, sampleRate: number, channels: number,
  sampleSizes: number[], dataOffset: number): Uint8Array<ArrayBuffer> {
  const mediaDuration = sampleSizes.length * 1024;
  const movieDuration = Math.round(mediaDuration * 1000 / sampleRate);
  const sizeTable = new Uint8Array(sampleSizes.length * 4);
  const sizeView = new DataView(sizeTable.buffer);
  sampleSizes.forEach((size, index) => sizeView.setUint32(index * 4, size));
  const stbl = box('stbl', sampleDescription(rateIndex, sampleRate, channels),
    fullBox('stts', 0, u32(1), u32(sampleSizes.length), u32(1024)),
    fullBox('stsc', 0, u32(1), u32(1), u32(sampleSizes.length), u32(1)),
    fullBox('stsz', 0, u32(0), u32(sampleSizes.length), sizeTable),
    fullBox('stco', 0, u32(1), u32(dataOffset)));
  const minf = box('minf', fullBox('smhd', 0, u16(0), u16(0)),
    box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', 1))), stbl);
  const mdia = box('mdia', fullBox('mdhd', 0, u32(0), u32(0), u32(sampleRate),
    u32(mediaDuration), u16(0x55c4), u16(0)),
  fullBox('hdlr', 0, u32(0), ascii('soun'), u32(0), u32(0), u32(0), ascii('SoundHandler\0')), minf);
  return box('moov', movieHeader(movieDuration), box('trak', trackHeader(movieDuration), mdia));
}

function isAdtsHeader(header: Uint8Array): boolean {
  return header.length >= 7 && header[0] === 0xff && (header[1] & 0xf6) === 0xf0;
}

/** Returns the original Blob when it is not ADTS. Supports AAC LC with one raw block per frame. */
export async function remuxAdtsToMp4(blob: Blob): Promise<Blob> {
  let windowStart = -1;
  let windowBytes = new Uint8Array(0);
  async function headerAt(offset: number): Promise<Uint8Array> {
    if (offset + 7 > blob.size) return new Uint8Array();
    if (offset < windowStart || offset + 7 > windowStart + windowBytes.length) {
      windowStart = offset;
      windowBytes = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
    }
    return windowBytes.subarray(offset - windowStart, offset - windowStart + 7);
  }

  const first = await headerAt(0);
  if (!isAdtsHeader(first)) return blob;
  const rateIndex = (first[2] >> 2) & 0x0f;
  const sampleRate = SAMPLE_RATES[rateIndex];
  const channels = ((first[2] & 1) << 2) | (first[3] >> 6);
  const profile = ((first[2] >> 6) & 3) + 1;
  if (profile !== 2 || !sampleRate || sampleRate > 65535 || channels < 1 || channels > 7) {
    throw new UnsupportedAdtsError('Unsupported AAC profile, sample rate, or channel layout');
  }

  const sampleSizes: number[] = [];
  const audioParts: Blob[] = [];
  let dataSize = 0;
  let offset = 0;
  while (offset < blob.size) {
    const header = await headerAt(offset);
    if (!isAdtsHeader(header)) throw new UnsupportedAdtsError('Invalid ADTS frame');
    if (((header[2] >> 6) & 3) + 1 !== profile || ((header[2] >> 2) & 0x0f) !== rateIndex ||
      (((header[2] & 1) << 2) | (header[3] >> 6)) !== channels || (header[6] & 3) !== 0) {
      throw new UnsupportedAdtsError('ADTS stream parameters change between frames');
    }
    const headerSize = (header[1] & 1) ? 7 : 9;
    const frameSize = ((header[3] & 3) << 11) | (header[4] << 3) | (header[5] >> 5);
    if (frameSize <= headerSize || offset + frameSize > blob.size) {
      throw new UnsupportedAdtsError('Incomplete ADTS frame');
    }
    const payloadSize = frameSize - headerSize;
    sampleSizes.push(payloadSize);
    audioParts.push(blob.slice(offset + headerSize, offset + frameSize));
    dataSize += payloadSize;
    offset += frameSize;
  }
  if (!sampleSizes.length || sampleSizes.length * 1024 > MAX_U32 || dataSize + 8 > MAX_U32) {
    throw new UnsupportedAdtsError('ADTS recording exceeds playback container limits');
  }

  const ftyp = box('ftyp', ascii('isom'), u32(0x200), ascii('isomiso2mp41'));
  const initialMovie = movie(rateIndex, sampleRate, channels, sampleSizes, 0);
  const moov = movie(rateIndex, sampleRate, channels, sampleSizes, ftyp.length + initialMovie.length + 8);
  return new Blob([ftyp, moov, u32(dataSize + 8), ascii('mdat'), ...audioParts], { type: 'audio/mp4' });
}
