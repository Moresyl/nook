import assert from 'node:assert/strict';

export const comparisonSaveCheckpointTimeoutMs = 30_000;

/** Durable filesystem synchronization may precede the held rename checkpoint. */
export async function waitForComparisonSaveCheckpoint(readEntered) {
  const startedAt = Date.now();
  const deadline = startedAt + comparisonSaveCheckpointTimeoutMs;
  while (Date.now() < deadline) {
    const entered = await readEntered();
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < comparisonSaveCheckpointTimeoutMs, 'The actual comparison save did not reach the held rename within 30000 ms.');
    if (entered) return { elapsedMs, deadlineMs: comparisonSaveCheckpointTimeoutMs };
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('The actual comparison save did not reach the held rename within 30000 ms.');
}
