import { msg } from '../i18n';
import { version } from "../../../desktop/src-tauri/tauri.conf.json";

export const DIAGNOSTICS_KEY = "ripple-diagnostics-v1";
export const DIAGNOSTICS_EVENT = "ripple:diagnostics";
export const MAX_PROBLEMS = 100;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const operations = {
  get open() { return msg('diagnostics.m1250'); }, get save() { return msg('diagnostics.m1251'); }, get rename() { return msg('diagnostics.m1252'); }, get transcription() { return msg('diagnostics.m1253'); },
  get version() { return msg('diagnostics.m1255'); }, get import() { return msg('diagnostics.m1256'); }, get export() { return msg('diagnostics.m1257'); },
  get engine() { return msg('diagnostics.m1258'); }, get runtime() { return msg('diagnostics.m1259'); }, get comparison() { return msg('diagnostics.m1260'); },
} as const;
export type Operation = keyof typeof operations;
export const reasons = {
  get connect_timeout() { return msg('diagnostics.m1261'); }, get read_timeout() { return msg('diagnostics.m1262'); }, get write_timeout() { return msg('diagnostics.m1263'); }, get pool_timeout() { return msg('diagnostics.m1264'); },
  get proxy() { return msg('diagnostics.m1265'); }, get connect() { return msg('diagnostics.m1266'); }, get connection_lost() { return msg('diagnostics.m1267'); }, get write() { return msg('diagnostics.m1268'); }, get upstream_http() { return msg('diagnostics.m1269'); }, get output_limit() { return msg('diagnostics.m1270'); },
  get permission() { return msg('diagnostics.m1271'); }, get network() { return msg('diagnostics.m1272'); }, get timeout() { return msg('diagnostics.m1273'); },
  get input_limit() { return msg('transcriptionErrors.inputLimit'); },
  get storage() { return msg('diagnostics.m1274'); }, get format() { return msg('diagnostics.m1275'); },
  get missing() { return msg('diagnostics.m1276'); }, get rate_limit() { return msg('diagnostics.m1277'); },
  get unknown() { return msg('diagnostics.m1278'); },
} as const;
type Reason = keyof typeof reasons;
export interface Problem {
  id: string; time: string; operation: Operation; reason: Reason; count: number;
}
let memory: Problem[] = [];
let persistent = true;

function reasonOf(error: unknown): Reason {
  const value = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  // Inspect only to classify. Never retain exception messages, stacks or upstream bodies.
  const text = [value?.name, value?.code, value?.message].filter(v => typeof v === "string").join(" ");
  if (/^(too_long|file_too_large)$/.test(String(value?.code ?? ""))) return "input_limit";
  if (/NotAllowed|SecurityError|permission|权限|密钥|401|403/i.test(text)) return "permission";
  if (/timeout|timed out|超时/i.test(text)) return "timeout";
  if (/QuotaExceeded|ENOSPC|空间不足|写入/i.test(text)) return "storage";
  if (/NotFound|ENOENT|不存在|找不到|404/i.test(text)) return "missing";
  if (/429|rate.limit|额度|频繁/i.test(text)) return "rate_limit";
  if (/format|json|格式|timestamp|时间戳/i.test(text)) return "format";
  if (/network|fetch|连接|网络/i.test(text)) return "network";
  return "unknown";
}
function validRows(value: unknown): Problem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is Problem => p && typeof p === "object" &&
    typeof p.id === "string" && /^[a-z0-9-]{1,80}$/i.test(p.id) &&
    typeof p.time === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(p.time) &&
    Date.parse(p.time) >= Date.now() - RETENTION_MS && Date.parse(p.time) <= Date.now() + 60000 &&
    Object.hasOwn(operations, p.operation) && Object.hasOwn(reasons, p.reason) &&
    Number.isInteger(p.count) && p.count > 0 && p.count <= 9999)
    .slice(-MAX_PROBLEMS).map(({ id, time, operation, reason, count }) => ({ id, time, operation, reason, count }));
}
export function readProblems(): Problem[] {
  if (!persistent) return validRows(memory);
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    memory = raw && raw.length <= 65536 ? validRows(JSON.parse(raw)) : [];
    if (raw && raw !== JSON.stringify(memory)) localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(memory));
  } catch { persistent = false; }
  return validRows(memory);
}
export function diagnosticsPersistent() { return persistent; }
export function recordProblem(operation: Operation, error?: unknown): Problem {
  const rows = readProblems(), reason = reasonOf(error), last = rows.at(-1), now = Date.now();
  const problem: Problem = last && last.operation === operation && last.reason === reason &&
    now - Date.parse(last.time) < 5000 ? { ...last, time: new Date(now).toISOString(), count: Math.min(9999, last.count + 1) }
    : { id: crypto.randomUUID(), time: new Date(now).toISOString(), operation, reason, count: 1 };
  if (last?.id === problem.id) rows.pop();
  memory = [...rows, problem].slice(-MAX_PROBLEMS);
  try { localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(memory)); persistent = true; } catch { persistent = false; }
  window.dispatchEvent(new Event(DIAGNOSTICS_EVENT));
  return problem;
}
export function problemSummary(p: Problem) { return `${operations[p.operation]}：${reasons[p.reason]}`; }
export function problemDetails(p: Problem) {
  return msg('diagnostics.m1279', { v0: version, v1: p.id, v2: p.time, v3: operations[p.operation], v4: reasons[p.reason], v5: p.reason, v6: p.count });
}
export function diagnosticEnvironment() {
  const ua = navigator.userAgent;
  return { app: "Ripple", version, generatedAt: new Date().toISOString(),
    system: /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : msg('diagnostics.m1280'),
    browser: /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : msg('diagnostics.m1281') };
}
export function installRuntimeDiagnostics() {
  const onError = (event: ErrorEvent) => { recordProblem("runtime", event.error); };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (event.reason?.name !== "AbortError") recordProblem("runtime", event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
}
