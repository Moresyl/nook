import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messageSchema, type Message } from '../contracts/workspace';
import { MessageCheckpoints } from '../desktop/services/message-checkpoints';
import { sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const message = (owner: string, content = 'PARTIAL'): Message => messageSchema.parse({ id: `message-${owner}`, role: 'assistant', content, status: 'running', createdAt: 1 });
async function setup() {
  const { vault, directory } = await testVault(); directories.push(directory);
  await vault.update((draft) => { draft.threads = ['__proto__', 'owner😀'].map((id) => sampleThread({ id, messages: [message(id)] })); });
  return { vault, directory, checkpoints: new MessageCheckpoints(vault) };
}

describe('owned message checkpoint batching', () => {
  it('combines different owners and duplicate pending messages in one write and returns independent committed messages', async () => {
    const { vault, checkpoints, directory } = await setup(); const previous = await readFile(join(directory, 'workspace.json')); const update = vi.spyOn(vault, 'checkpointMessages');
    const one = message('__proto__', 'OLD'); const latest = { ...one, content: 'LATEST 中文😀', status: 'complete' as const }; const two = { ...message('owner😀', 'SECOND'), status: 'stopped' as const };
    const results = await Promise.all([checkpoints.persist('__proto__', one), checkpoints.persist('__proto__', latest), checkpoints.persist('owner😀', two)]);
    expect(update).toHaveBeenCalledTimes(1); expect(await readFile(join(directory, 'workspace.backup.json'))).toEqual(previous);
    expect(results).toEqual([latest, latest, two]); expect(results[0]).not.toBe(results[1]); results[0]!.content = 'CALLER_MUTATION';
    expect(results[1]!.content).toBe('LATEST 中文😀'); expect(vault.snapshot().threads[0].messages[0].content).toBe('LATEST 中文😀');
  });
  it('captures the latest mutable message only when the queued vault operation executes', async () => {
    const { vault, checkpoints } = await setup(); const update = vault.checkpointMessages.bind(vault); let release!: () => void; const queue = new Promise<void>((resolve) => { release = resolve; });
    const intercepted = vi.spyOn(vault, 'checkpointMessages').mockImplementation(async (entries) => { await queue; return update(entries); });
    const current = message('__proto__'); const saved = checkpoints.persist('__proto__', current); await vi.waitFor(() => expect(intercepted).toHaveBeenCalledTimes(1));
    current.content = 'LATEST_AFTER_QUEUE'; current.status = 'complete'; release(); expect(await saved).toEqual(current);
  });
  it('retains newly queued owners during an in-flight write and settles them only after their own next atomic batch', async () => {
    const { vault, checkpoints } = await setup(); const update = vault.checkpointMessages.bind(vault); let release!: () => void; const queue = new Promise<void>((resolve) => { release = resolve; });
    const intercepted = vi.spyOn(vault, 'checkpointMessages').mockImplementationOnce(async (entries) => { await queue; return update(entries); });
    const first = checkpoints.persist('__proto__', { ...message('__proto__', 'FIRST'), status: 'complete' }); await vi.waitFor(() => expect(intercepted).toHaveBeenCalledTimes(1));
    let secondSettled = false; const second = checkpoints.persist('owner😀', { ...message('owner😀', 'SECOND'), status: 'complete' }).then((value) => { secondSettled = true; return value; });
    await Promise.resolve(); expect(secondSettled).toBe(false); release(); await first; expect(await second).toMatchObject({ content: 'SECOND', status: 'complete' });
    expect(intercepted).toHaveBeenCalledTimes(2); expect(vault.snapshot().threads.map((thread) => thread.messages[0].content)).toEqual(['FIRST', 'SECOND']);
  });
  it('rejects every waiter on an atomic-write failure without changing data and permits an intact retry', async () => {
    const { vault, checkpoints, directory } = await setup(); const before = await readFile(join(directory, 'workspace.json')); const failure = new Error('PRIVATE_CHECKPOINT_WRITE_FAILURE');
    const update = vi.spyOn(vault, 'checkpointMessages').mockRejectedValueOnce(failure);
    const results = await Promise.allSettled([checkpoints.persist('__proto__', message('__proto__', 'FIRST')), checkpoints.persist('owner😀', message('owner😀', 'SECOND'))]);
    expect(results).toEqual([{ status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }]); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
    const retry = await checkpoints.persist('__proto__', { ...message('__proto__', 'RETRIED'), status: 'complete' }); expect(retry).toMatchObject({ content: 'RETRIED', status: 'complete' }); expect(update).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect a removed owner or a removed message and preserves every current file byte', async () => {
    const { vault, checkpoints, directory } = await setup(); await vault.update((draft) => { draft.threads = [sampleThread({ id: 'owner😀' })]; });
    const before = await readFile(join(directory, 'workspace.json'));
    expect(await Promise.all([checkpoints.persist('__proto__', message('__proto__')), checkpoints.persist('owner😀', message('owner😀'))])).toEqual([undefined, undefined]);
    expect(await readFile(join(directory, 'workspace.json'))).toEqual(before); expect(vault.snapshot().threads).toHaveLength(1); expect(vault.snapshot().threads[0].messages).toEqual([]);
  });
  it('keeps invalid checkpoint data outside the complete workspace and recovers with a valid whole batch', async () => {
    const { vault, checkpoints, directory } = await setup(); const before = await readFile(join(directory, 'workspace.json'));
    const invalid = { ...message('__proto__'), status: 'INVALID' } as unknown as Message;
    const results = await Promise.allSettled([checkpoints.persist('__proto__', invalid), checkpoints.persist('owner😀', message('owner😀', 'VALID_PEER'))]);
    expect(results.every((result) => result.status === 'rejected')).toBe(true); expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
    const valid = [{ ...message('__proto__', 'RECOVERED_ONE'), status: 'complete' as const }, { ...message('owner😀', 'RECOVERED_TWO'), status: 'complete' as const }];
    expect(await Promise.all(valid.map((value, index) => checkpoints.persist(index === 0 ? '__proto__' : 'owner😀', value)))).toEqual(valid);
    expect(vault.snapshot().threads.map((thread) => thread.messages[0].content)).toEqual(['RECOVERED_ONE', 'RECOVERED_TWO']);
  });
});
