import { interfaceLanguage, msg, setInterfaceLanguage, useInterfaceLanguage } from '../i18n';
import './languageControl.css';

export function LanguageControl({ welcome = false }: { welcome?: boolean }) {
  useInterfaceLanguage();
  return <div className={`language-control${welcome ? ' language-control--welcome' : ' icon-button'}`} title={msg('language.label')}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z" /></svg>
    <select aria-label={msg('language.label')} value={interfaceLanguage()} onChange={event => void setInterfaceLanguage(event.target.value as 'zh-CN' | 'en')}>
      <option value="zh-CN">简体中文</option><option value="en">English</option>
    </select>
  </div>;
}
