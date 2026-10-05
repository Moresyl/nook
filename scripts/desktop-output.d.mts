import type { Readable } from 'node:stream';

export function drainDesktopOutput(stream: Readable): () => number;
