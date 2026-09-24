import { describe, expect, test } from "vitest";
import { stripStubFirstFrame } from "./adts";

/**
 * 造一个真实形态的 ADTS 帧。字段取值刻意抄自出问题的真文件：
 * MPEG-2 头（0xFFF9）、AAC LC / 32kHz（0x54）、无 CRC、载荷填 0x4B。
 */
function adtsFrame(payloadBytes: number): Uint8Array<ArrayBuffer> {
  const length = 7 + payloadBytes;
  const frame = new Uint8Array(length);
  frame[0] = 0xff;
  frame[1] = 0xf9;
  frame[2] = 0x54;
  frame[3] = (length >> 11) & 0x03;
  frame[4] = (length >> 3) & 0xff;
  frame[5] = ((length & 0x07) << 5) | 0x1f;
  frame[6] = 0xfc;
  frame.fill(0x4b, 7);
  return frame;
}

function stream(...frames: Uint8Array<ArrayBuffer>[]): Blob {
  return new Blob(frames);
}

/** 9 字节桩帧 + 若干 775 字节正常帧 —— 用户那 59 个录音的形态。 */
function stubStream(normalFrames: number): Blob {
  const frames = [adtsFrame(2)];
  for (let i = 0; i < normalFrames; i++) frames.push(adtsFrame(768));
  return stream(...frames);
}

async function firstBytes(blob: Blob, n: number): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.slice(0, n).arrayBuffer()));
}

describe("stripStubFirstFrame", () => {
  test("首帧是 9 字节桩帧时剥掉它，其余内容字节不变", async () => {
    const original = stubStream(3);
    const result = await stripStubFirstFrame(original);
    expect(result.size).toBe(original.size - 9);
    // 剥完的第一帧就是原来的第二帧：正常长度、同步字还在。
    const head = await firstBytes(result, 6);
    expect(head.slice(0, 2)).toEqual([0xff, 0xf9]);
    // 775 = 7 字节头 + 768 字节载荷，即堆帧之外那种正常帧的长度。
    expect((head[4] << 3) | (head[5] >> 5)).toBe(775);
  });

  test("只剥一帧，不连锁剥第二帧", async () => {
    const original = stubStream(2);
    const once = await stripStubFirstFrame(original);
    const twice = await stripStubFirstFrame(once);
    expect(once.size).toBe(original.size - 9);
    expect(twice).toBe(once);
  });

  test("正常 ADTS 文件原样返回（不产生新对象）", async () => {
    const original = stream(adtsFrame(768), adtsFrame(768), adtsFrame(768));
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("首帧正常但第二帧也是正常帧时不动它", async () => {
    const original = stream(adtsFrame(768), adtsFrame(768));
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("前两帧都短得可疑时不动它（避免误伤合法短帧）", async () => {
    const original = stream(adtsFrame(2), adtsFrame(2), adtsFrame(768));
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("MP4 容器（m4a/mp4）原样返回", async () => {
    const ftyp = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
    const original = stream(ftyp, adtsFrame(768));
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("MP3 原样返回（layer 字段不为 00）", async () => {
    const mp3 = new Uint8Array(64);
    mp3[0] = 0xff;
    mp3[1] = 0xfb;
    mp3[2] = 0x90;
    const original = stream(mp3, mp3);
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("文件太小、读不出第二帧头时原样返回", async () => {
    const original = new Blob([new Uint8Array([0xff, 0xf9, 0x54])]);
    expect(await stripStubFirstFrame(original)).toBe(original);
  });

  test("空文件不抛异常", async () => {
    const original = new Blob([]);
    expect(await stripStubFirstFrame(original)).toBe(original);
  });
});
