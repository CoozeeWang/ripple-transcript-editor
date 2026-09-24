export type ProjectIconKind = 'project' | 'original' | 'trash' | 'rename' | 'copy' | 'audio' | 'document' | 'mic' | 'ignore' | 'plus' | 'play' | 'preview' | 'grip' | 'folder' | 'calendar' | 'location' | 'people' | 'unlink';
export function ProjectIcon({ kind }: { kind: ProjectIconKind }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'project' && <><path d="M7 3h10M5 7h14" /><rect x="3" y="11" width="18" height="10" rx="2" /></>}
    {kind === 'original' && <path d="M6 3h12v19l-6-4-6 4z"/>}
    {kind === 'audio' && <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />}
    {kind === 'trash' && <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>}
    {kind === 'rename'  && <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>}
    {kind === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>}
    {kind === 'mic'  && <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}
    {(kind === 'document' || kind === 'preview') && <><path d="M14 2H5v20h14V7zM14 2v5h5" />{kind === 'document' ? <path d="M8 12h8M8 16h6" /> : <><circle cx="11" cy="13" r="3" /><path d="m13 15 3 3" /></>}</>}
    {kind === 'ignore' && <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>}
    {kind === 'plus' && <path d="M12 5v14M5 12h14" />}
    {kind === 'play' && <path d="m8 5 11 7-11 7z" />}
    {kind === 'grip' && <>{[5,12,19].flatMap(y => [9,15].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r=".8" />))}</>}
    {kind === 'folder' && <path d="M3 7V5h6l2 2h10v13H3z" />}
    {kind === 'calendar' && <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>}
    {kind === 'location' && <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>}
    {kind === 'people' && <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M19 14a5 5 0 0 1 2 4v3" /></>}
    {kind === 'unlink' && <path d="m3 3 18 18M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />}
  </svg>;
}
