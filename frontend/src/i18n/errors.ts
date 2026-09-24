import zh from './locales/zh-CN.json';
import sources from './sourceText.json';
import { interfaceLanguage, msg } from './index';
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = Object.entries(sources.backend).map(([key, source]) => ({ key,
  pattern: new RegExp('^' + source.split(/(\{\{v\d+\}\})/).map(part => /^\{\{v\d+\}\}$/.test(part) ? `(?<${part.slice(2, -2)}>.*?)` : escapeRegex(part)).join('') + '$', 's'),
}));
function backendMessage(code: unknown, params: unknown): string | undefined {
  if (typeof code !== 'string') return;
  const key = code.replace(/^ripple_/, '');
  if (!Object.hasOwn(zh.backend, key)) return;
  const values = params && typeof params === 'object' ? Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) : {};
  return msg(`backend.${key}`, values);
}
const generic: Record<string, string> = {
  invalid_api_key: 'localStore.m1521', no_api_key: 'localStore.m1524', quota_exceeded: 'localStore.m1523',
  file_too_large: 'localStore.m1525', bad_request: 'localStore.m1526', rate_limited: 'localStore.m1527',
  upstream_error: 'localStore.m1528', backend_unreachable: 'useTranscription.m1162',
  empty_result: 'useTranscription.m1164', unsupported_format: 'useTranscription.m1155',
  unsupported_option: 'useTranscription.m1156', service_not_enabled: 'useTranscription.m1157',
  too_long: 'useTranscription.m1154', network: 'useTranscription.m1159',
  upload_timeout: 'useTranscription.m1160', response_timeout: 'useTranscription.m1161',
  bad_response: 'useTranscription.m1165', no_base_url: 'useTranscription.m1150',
};
export function apiErrorMessage(body: unknown, status: number, fallback?: string): string {
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const detail = value.detail && typeof value.detail === 'object' && !Array.isArray(value.detail) ? value.detail as Record<string, unknown> : {};
  const coded = backendMessage(value.message_code, value.params) ?? backendMessage(value.code, value.params);
  if (coded) return coded;
  const message = typeof value.detail === 'string' ? value.detail : typeof detail.message === 'string' ? detail.message : '';
  // Compatibility with a still-running older backend. Match only app-owned templates.
  for (const {key, pattern} of patterns) {
    const match = pattern.exec(message);
    if (match) return msg(`backend.${key}`, match.groups);
  }
  const code = typeof value.code === 'string' ? value.code : typeof detail.code === 'string' ? detail.code : '';
  if (generic[code]) return msg(generic[code]);
  // Preserve existing Chinese app explanations on older servers; unknown English errors
  // are technical details, never the primary user-facing message.
  if (interfaceLanguage() === 'zh-CN' && /[\u3400-\u9fff]/.test(message)) return message;
  if (status === 422 || status === 400) return msg('backend.validation_error');
  if (status === 401 || status === 403) return msg('DiagnosticsSettings.m0393');
  if (status === 429) return msg('DiagnosticsSettings.m0396');
  return fallback ?? msg('backend.internal_error');
}
