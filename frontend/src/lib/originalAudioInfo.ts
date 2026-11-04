/** Original file facts only: never describe the playback or upload conversion. */
export interface OriginalAudioInfo { file: string; fingerprint?: string; sourceFile?: string; sourceFormat?: string }
export function originalAudioFacts(info: OriginalAudioInfo) {
  // The persisted identity is byte-size:SHA-256, captured at media import.
  const match = /^(0|[1-9]\d*):[a-f0-9]{64}$/i.exec(info.fingerprint ?? '');
  const bytes = match ? Number(match[1]) : NaN;
  const size = Number.isSafeInteger(bytes) && bytes > 0 ? (bytes < 10_000 ? '<0.01' : (bytes / 1_000_000).toFixed(2)) + ' MB' : null;
  const extension = /\.([a-z0-9]{1,10})$/i.exec((typeof info.sourceFile === 'string' ? info.sourceFile : typeof info.file === 'string' ? info.file : '').split(/[\\/]/).pop() ?? '')?.[1];
  return { format: info.sourceFormat?.toUpperCase() ?? extension?.toUpperCase() ?? null, size };
}
