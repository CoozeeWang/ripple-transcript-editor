import { useEffect, useRef, useState } from 'react';
import { AudioStorageDialog } from './AudioStorageDialog';

type Storage = 'copy' | 'reference';
export function useAudioStorageChoice() {
  const [pending, setPending] = useState<{ names: string[]; referenceable: boolean } | null>(null);
  const resolve = useRef<((value: Storage | null) => void) | null>(null);
  useEffect(() => () => { resolve.current?.(null); }, []);
  const choose = (names: string[], referenceable: boolean) => new Promise<Storage | null>(done => { resolve.current = done; setPending({ names, referenceable }); });
  const finish = (value: Storage | null) => { const done = resolve.current; resolve.current = null; setPending(null); done?.(value); };
  return { choose, dialog: pending ? <AudioStorageDialog {...pending} finish={finish}/> : null };
}
