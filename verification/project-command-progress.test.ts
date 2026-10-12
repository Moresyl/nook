import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock('node:child_process', () => mocks);
import { projectCommand } from '../desktop/services/project-command';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function command() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null, kill: vi.fn() });
  mocks.spawn.mockReturnValueOnce(child);
  const progress = vi.fn(), controller = new AbortController();
  const result = projectCommand('owned-command', [], '.', 5000, controller.signal, progress);
  return { child, progress, controller, result };
}

describe('project command progress delivery', () => {
  it('reports the first output even when the clock begins at zero', async () => {
    vi.setSystemTime(0); const { child, progress, result } = command(); child.stdout.write('FIRST');
    expect(progress.mock.calls).toEqual([['FIRST']]); child.emit('close', 0); await result;
  });
  it('delivers a trailing burst while the process remains running and produces no further output', async () => {
    const { child, progress, result } = command();
    child.stdout.write('FIRST 中文😀\n'); await vi.advanceTimersByTimeAsync(60); child.stderr.write('NEXT 保留原文\n');
    expect(progress.mock.calls).toEqual([['FIRST 中文😀\n']]);
    await vi.advanceTimersByTimeAsync(39); expect(progress).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(progress.mock.calls).toEqual([['FIRST 中文😀\n'], ['FIRST 中文😀\nNEXT 保留原文\n']]);
    expect(child.exitCode).toBeNull(); child.emit('close', 0);
    expect(await result).toMatchObject({ output: 'FIRST 中文😀\nNEXT 保留原文\n', exitCode: 0, timedOut: false });
    await vi.advanceTimersByTimeAsync(1000); expect(progress).toHaveBeenCalledTimes(2);
  });
  it('coalesces a burst without losing intermediate stdout or stderr', async () => {
    const { child, progress, result } = command();
    child.stdout.write('A'); await vi.advanceTimersByTimeAsync(30); child.stdout.write('B');
    await vi.advanceTimersByTimeAsync(30); child.stderr.write('C'); await vi.advanceTimersByTimeAsync(40);
    expect(progress.mock.calls).toEqual([['A'], ['ABC']]); child.emit('close', 0); expect((await result).output).toBe('ABC');
  });
  it('retains pending final output in the result and clears notifications on close', async () => {
    const { child, progress, result } = command(); child.stdout.write('A'); child.stdout.write('B'); child.emit('close', 3);
    expect(await result).toMatchObject({ output: 'AB', exitCode: 3 }); await vi.advanceTimersByTimeAsync(1000);
    expect(progress.mock.calls).toEqual([['A']]); expect(vi.getTimerCount()).toBe(0);
  });
  it('clears pending progress on startup failure without exposing exception details', async () => {
    const { child, progress, result } = command(); child.stdout.write('A'); child.stdout.write('B');
    const rejected = expect(result).rejects.toThrow('Could not start the command.'); child.emit('error', new Error('private path'));
    await rejected; await vi.advanceTimersByTimeAsync(1000); expect(progress.mock.calls).toEqual([['A']]); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not deliver a pending callback after cancellation', async () => {
    const { child, progress, controller, result } = command(); child.stdout.write('A'); child.stdout.write('B'); controller.abort();
    await vi.advanceTimersByTimeAsync(100); expect(progress.mock.calls).toEqual([['A']]);
    const rejected = expect(result).rejects.toThrow('Command stopped'); child.emit('close', null); await rejected;
    await vi.advanceTimersByTimeAsync(1000); expect(progress).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
