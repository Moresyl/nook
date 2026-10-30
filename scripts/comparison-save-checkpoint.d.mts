export const comparisonSaveCheckpointTimeoutMs: number;
export function waitForComparisonSaveCheckpoint(readEntered: () => Promise<boolean>): Promise<{ elapsedMs: number; deadlineMs: number }>;
