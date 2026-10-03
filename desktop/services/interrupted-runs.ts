import type { Thread } from '../../contracts/workspace';

export function interruptRuns(threads: Thread[], now = Date.now()): boolean {
  let changed = false;
  for (const thread of threads) for (const message of thread.messages) {
    if (message.status === 'running') { message.status = 'stopped'; changed = true; }
    for (const invocation of message.invocations ?? []) {
      if (invocation.status === 'running') { invocation.status = 'interrupted'; invocation.finishedAt = now; changed = true; }
    }
    for (const activity of message.activities ?? []) {
      if (activity.status === 'running' || activity.status === 'waiting') { activity.status = 'stopped'; activity.finishedAt = now; changed = true; }
    }
  }
  return changed;
}
