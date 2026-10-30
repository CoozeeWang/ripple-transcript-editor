import { createContext } from 'react';
import type { ProjectTag } from './tags';

/** Only an open input consumes suggestions; closed segment rows need no catalog-wide prop. */
export const TagCandidatesContext = createContext<readonly ProjectTag[]>([]);
export const TagWritingContext = createContext(false);
