import { msg, useInterfaceLanguage } from '../i18n';
export function ManuscriptImportHint() {
  useInterfaceLanguage();
  return <p className="manuscript-import-hint">{msg('ManuscriptImportHint.m0553')}<span tabIndex={0} role="img" aria-label={msg('ManuscriptImportHint.m0554')} data-tip={msg('ManuscriptImportHint.m0555')} data-tip-pos="top">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></svg>
    </span>
  </p>;
}
