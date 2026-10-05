import type { Profiler } from 'node:inspector';
export const startStartupProfileExpression: string;
export function summarizeStartupProfile(profile?: Profiler.Profile): { durationMs: number; samples: number; frames: { name: string; samples: number; microseconds: number }[] } | undefined;
