import { msg, useInterfaceLanguage } from '../i18n';
import { ProjectIcon } from './ProjectIcon';

export function AudioStorageIcon({ storage, pending = false }: { storage: 'copy' | 'reference'; pending?: boolean }) {
  useInterfaceLanguage();
  const tip = storage === 'reference' ? msg('AudioStorageIcon.m0375') : pending ? msg('AudioStorageIcon.m0376') : msg('AudioStorageIcon.m0377');
  return <span className="audio-storage-icon" role="img" aria-label={tip} tabIndex={0} data-tip={tip} data-tip-pos="top">
    <ProjectIcon kind="audio"/>
    {storage === 'reference' && <svg className="audio-storage-icon__link" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>
    </svg>}
  </span>;
}
