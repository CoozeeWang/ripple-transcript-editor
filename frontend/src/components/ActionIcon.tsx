export type ActionIconKind = 'clock' | 'language' | 'settings' | 'trash' | 'export';

/** Shared chrome artwork: 1.25px visible stroke and a 15.5px outer extent. */
export function ActionIcon({ kind }: { kind: ActionIconKind }) {
  const size = 20;
  const visibleStroke = 1.25;
  const visibleExtent = 15.5;
  // The gear fills 22 source units; the other four drawings fill 18.
  const sourceExtent = kind === 'settings' ? 22 : 18;
  const scale = (visibleExtent - visibleStroke) / sourceExtent;
  const viewport = size / scale;
  const inset = (24 - viewport) / 2;
  const strokeWidth = visibleStroke / scale;

  return <svg className="action-icon" width={size} height={size}
    viewBox={`${inset} ${inset} ${viewport} ${viewport}`}
    fill="none" stroke="currentColor" strokeWidth={strokeWidth}
    style={{ strokeWidth }} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'clock' && <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
    {kind === 'language' && <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z"/></>}
    {kind === 'settings' && <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></>}
    {kind === 'trash' && <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>}
    {kind === 'export' && <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12"/>}
  </svg>;
}
