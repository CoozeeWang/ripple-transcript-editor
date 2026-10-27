import { useId } from 'react';
import { msg, useInterfaceLanguage } from '../i18n';

/** This opens settings only; starting a provider request requires confirmation. */
export function TranscribeAudioButton({ onClick, disabledReason }: {
  onClick: () => void;
  disabledReason?: string;
}) {
  useInterfaceLanguage();
  const description = useId();
  return <span className="transcription-control" data-tip={disabledReason || msg('transcriptionAction.transcribe')}
    tabIndex={disabledReason ? 0 : undefined} role={disabledReason ? 'group' : undefined}
    aria-label={disabledReason || undefined}>
    <button type="button" className="button button--secondary button--icon transcribe-audio-button"
      aria-label={msg('transcriptionAction.transcribe')} aria-describedby={disabledReason ? description : undefined}
      disabled={Boolean(disabledReason)} onClick={onClick}>
      <svg className="toolbar-button-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M3 10v4m3-7v10m3-13v16m3-12v8m4-10h5m-5 6h5m-5 6h5" />
      </svg>
    </button>
    {disabledReason && <span className="sr-only" id={description}>{disabledReason}</span>}
  </span>;
}
