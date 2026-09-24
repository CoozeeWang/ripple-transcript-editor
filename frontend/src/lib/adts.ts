/**
 * 裸 ADTS AAC 的「首帧桩帧」规避。
 *
 * 有些录音工具导出的裸 .aac（ADTS）文件，第一帧是个 9 字节的桩帧——7 字节头 + 2 字节载荷，
 * 头部自己就声明 frame_length=9。ffmpeg 把它当坏包跳过，照常解出后面的音频；
 * 但 Chrome 的 AAC 解码器把这帧判成致命错误，整段音频都放不出来，报错还会误导成
 * 「文件可能已损坏」。读前 1KB 就能认出来，认出来就让播放器从第二帧开始。
 *
 * 只影响播放：转录走的是原始文件句柄，不经过这里。
 */

/** 低于这个长度的帧一律视作可疑；正常帧远大于它（实测 32kHz 192kbps 单声道为 775 字节）。 */
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
