import { readAudioUrl } from "../localStore";

/** 只读元数据地探一次音频时长，用于判断转录与音频是否可能是同一份录音。 */
export async function probeAudioDuration(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number | null> {
  let url: string | null = null;
  try {
    url = await readAudioUrl(dir, name);
    return await new Promise<number | null>((resolve) => {
      const probe = new Audio();
      let settled = false;
      const timeout = window.setTimeout(() => settle(null), 10000);
      const settle = (value: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        probe.onloadedmetadata = null;
        probe.onerror = null;
        probe.removeAttribute('src');
        probe.load();
        resolve(value);
      };
      probe.preload = "metadata";
      probe.onloadedmetadata = () => settle(Number.isFinite(probe.duration) ? probe.duration : null);
      probe.onerror = () => settle(null);
      probe.src = url as string;
    });
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
