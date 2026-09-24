import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';

export type InterfaceLanguage = 'zh-CN' | 'en';
export const LANGUAGE_KEY = 'ripple-interface-language';
function storedLanguage(): InterfaceLanguage {
  try { return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}
void i18next.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zh }, en: { translation: en } },
  lng: storedLanguage(), fallbackLng: 'zh-CN', supportedLngs: ['zh-CN', 'en'],
  initAsync: false, interpolation: { escapeValue: false },
});
export function interfaceLanguage(): InterfaceLanguage { return i18next.language === 'en' ? 'en' : 'zh-CN'; }
const renderedMessages = new Map<string, { key: string; values?: Record<string, unknown> }>();
export function msg(key: string, values?: Record<string, unknown>): string {
  const text = String(i18next.t(key, values ?? {}));
  renderedMessages.set(text, { key, values });
  if (renderedMessages.size > 2048) renderedMessages.delete(renderedMessages.keys().next().value!);
  return text;
}
/** Only for transient app notices/errors. Never apply to manuscript or user data. */
export function uiMessage(text: string): string {
  const source = renderedMessages.get(text);
  return source ? String(i18next.t(source.key, source.values ?? {})) : text;
}
export function useInterfaceLanguage() {
  useTranslation();
  return interfaceLanguage();
}
export async function setInterfaceLanguage(language: InterfaceLanguage) {
  await i18next.changeLanguage(language);
  try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Still works for this window. */ }
}
function updateDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = interfaceLanguage();
}
i18next.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage();
export function formatNumber(value: number) { return new Intl.NumberFormat(interfaceLanguage()).format(value); }
export { i18next };

/** Stable identity check for pre-existing message-valued progress state. */
export function isMessage(value: string, key: string): boolean {
  return ['zh-CN', 'en'].some(lng => i18next.t(key, { lng }) === value);
}
