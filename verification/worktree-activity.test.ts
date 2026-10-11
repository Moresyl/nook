import { describe, expect, it } from 'vitest';
import { WorktreeActivity } from '../desktop/services/worktree-activity';

function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
describe('application worktree activity exclusion', () => {
  it('registers a pending action synchronously and rejects cleanup until every action settles', async () => {
    const activity = new WorktreeActivity(), one = gate(), two = gate();
    const first = activity.run(() => one.promise), second = activity.run(() => two.promise);
    expect(activity.idle).toBe(false);
    await expect(activity.exclusive(() => true)).rejects.toThrow('busy'); one.release(); await first;
    await expect(activity.exclusive(() => true)).rejects.toThrow('busy'); two.release(); await second;
    expect(await activity.exclusive(() => 'ready')).toBe('ready');
    expect(activity.idle).toBe(true);
  });
  it('blocks new actions and overlapping cleanup while the accepted cleanup is held', async () => {
    const activity = new WorktreeActivity(), held = gate(), pending = activity.exclusive(() => held.promise);
    expect(activity.idle).toBe(false);
    expect(() => activity.assertAvailable()).toThrow('cleanup');
    await expect(activity.run(() => true)).rejects.toThrow('cleanup');
    await expect(activity.exclusive(() => true)).rejects.toThrow('busy'); held.release(); await pending;
    expect(() => activity.assertAvailable()).not.toThrow(); expect(await activity.run(() => 42)).toBe(42);
  });
  it('releases both kinds of lease after synchronous and asynchronous failures', async () => {
    const activity = new WorktreeActivity();
    await expect(activity.run(() => { throw new Error('action'); })).rejects.toThrow('action');
    await expect(activity.exclusive(async () => { throw new Error('cleanup'); })).rejects.toThrow('cleanup');
    expect(await activity.exclusive(() => 1)).toBe(1); expect(await activity.run(() => 2)).toBe(2);
  });
});
