import { msg, interfaceLanguage } from '../i18n';
// 格式化与快捷键显示辅助。纯函数，无 React / 存储依赖。

/** 今天的日期（YYYY-MM-DD），用于默认文件名/标签。 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 秒数转 mm:ss，超过 1 小时转 h:mm:ss。非有限值按 0 处理。 */
export function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

// ===== 快捷键显示（Windows 兼容：mac 显示 ⌘，win/linux 显示 Ctrl） =====
export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");

/** 把 mac 符号组合转成当前平台的快捷键文案，如 keys("Z") → ⌘Z / Ctrl+Z。 */
export function keys(symbol: string, shift = false): string {
  return IS_MAC ? `⌘${shift ? "⇧" : ""}${symbol}` : `Ctrl+${shift ? "Shift+" : ""}${symbol}`;
}

/** 保留日期精度；含时间时截到分钟，无时区转换。 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(iso)) return iso;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(iso);
  return match ? match[1] : "";
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前，超过一周显示日期。 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return msg('format.m1336');
  if (interfaceLanguage() === 'en') {
    const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
    if (diff < hour) return relative.format(-Math.floor(diff / minute), 'minute');
    if (diff < day) return relative.format(-Math.floor(diff / hour), 'hour');
    if (diff < 7 * day) return relative.format(-Math.floor(diff / day), 'day');
  }
  if (diff < hour) return msg('format.m1337', { count: Math.floor(diff / minute) });
  if (diff < day) return msg('format.m1338', { count: Math.floor(diff / hour) });
  if (diff < 7 * day) return msg('format.m1339', { count: Math.floor(diff / day) });
  return new Date(iso).toLocaleDateString(interfaceLanguage());
}
