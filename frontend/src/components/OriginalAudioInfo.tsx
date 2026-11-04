import { msg, useInterfaceLanguage } from '../i18n';
import { originalAudioFacts, type OriginalAudioInfo as Info } from '../lib/originalAudioInfo';

/** Static metadata from the original media identity; no filesystem reads. */
export function OriginalAudioInfo({ info, labeled = false, lowercase = false }: { info: Info; labeled?: boolean; lowercase?:boolean }) {
  useInterfaceLanguage();
  const facts = originalAudioFacts(info);
  const details = `${(lowercase?facts.format?.toLowerCase():facts.format) ?? msg('originalAudio.unknownFormat')} · ${facts.size ?? msg('originalAudio.unknownSize')}`;
  const text = labeled ? msg('originalAudio.label', { details }) : details;
  return <span className="original-audio-info" data-action-tip={`${text}\n${msg('originalAudio.source')}`} aria-description={msg('originalAudio.source')}>
    {text}
  </span>;
}
