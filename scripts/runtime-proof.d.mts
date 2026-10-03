import type { ReleaseProof } from './release-policy.mjs';

export const runtimeProofFiles: Readonly<Record<keyof ReleaseProof, string>>;
export function readRuntimeProof(root: string): Promise<ReleaseProof>;
export function resetRuntimeProof(root: string): Promise<void>;
