import { msg, useInterfaceLanguage } from '../i18n';

export type MaterialImportNote = { name: string; keys: string[] };

/** Completed import limitations; hiding this receipt never changes the import. */
export function MaterialImportNotice({ notes, onDismiss }: { notes: MaterialImportNote[]; onDismiss: () => void }) {
  const language = useInterfaceLanguage();
  if (!notes.length) return null;
  return <div className="project-import-notices notice-row" role="status">
    <div className="notice-row__message">{notes.map((note, index) => <p key={index}>
      {note.name}{language === 'en' ? ': ' : '：'}{note.keys.map(key => msg(key)).join(language === 'en' ? ' ' : '')}
    </p>)}</div>
    <button type="button" className="notice-dismiss" aria-label={msg('notice.dismiss')} onClick={onDismiss}>×</button>
  </div>;
}
