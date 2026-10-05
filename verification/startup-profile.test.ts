import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import type { Profiler } from 'node:inspector';
import { describe, expect, it, vi } from 'vitest';
import { startStartupProfileExpression, summarizeStartupProfile } from '../scripts/startup-profile.mjs';

const node = (id: number, name: string): Profiler.ProfileNode => ({ id, callFrame: { functionName: name, scriptId: 'private', url: 'file:///PRIVATE/workspace.json', lineNumber: 0, columnNumber: 0 } });
describe('owned startup CPU sampling', () => {
  it('aggregates self time without exposing paths or source, and bounds output', () => {
    const profile: Profiler.Profile = { startTime: 1000, endTime: 31000, nodes: [node(1, 'readFile'), node(2, '(idle)'), node(3, 'readFile')], samples: [1, 2, 3, 2], timeDeltas: [2000, 10000, 8000, 10000] };
    const summary = summarizeStartupProfile(profile);
    expect(summary).toEqual({ durationMs: 30, samples: 4, frames: [{ name: '(idle)', samples: 2, microseconds: 20000 }, { name: 'readFile', samples: 2, microseconds: 10000 }] });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    const many = { ...profile, nodes: Array.from({ length: 30 }, (_, i) => node(i, `frame-${i}`)), samples: Array.from({ length: 30 }, (_, i) => i), timeDeltas: Array(30).fill(10000) };
    expect(summarizeStartupProfile(many)?.frames).toHaveLength(12);
  });
  it('handles unavailable profiles, unknown samples and missing deltas', () => {
    expect(summarizeStartupProfile()).toBeUndefined();
    const summary = summarizeStartupProfile({ startTime: 1, endTime: 1, nodes: [node(1, 'a\nb\t' + 'x'.repeat(120))], samples: [1, 9], timeDeltas: [-1] });
    expect(summary?.frames.map(frame => frame.microseconds)).toEqual([0, 0]);
    expect(summary?.frames[0].name).toHaveLength(100);
    expect(summary?.frames[0].name).not.toMatch(/[\r\n\t]/);
    expect(summary?.frames[1].name).toBe('(unknown)');
  });
  it('disconnects a failed sampler without leaving a capture hook', async () => {
    const disconnect = vi.fn();
    class FailedSession { connect() {} disconnect = disconnect; post(_method: string, _params: object, done: (error: Error) => void) { done(new Error('private diagnostic failure')); } }
    const context = { require: () => ({ Session: FailedSession }) };
    await expect(runInNewContext(startStartupProfileExpression, context)).resolves.toBe(false);
    expect(disconnect).toHaveBeenCalledOnce(); expect(context).not.toHaveProperty('qiyaoCaptureStartupProfile');
  });
  it('samples a real owned Node process and releases its inspector session on capture', async () => {
    const context: { require: NodeJS.Require; qiyaoCaptureStartupProfile?: () => Promise<Profiler.Profile> } = { require: createRequire(import.meta.url) };
    expect(await runInNewContext(startStartupProfileExpression, context)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));
    const profile = await context.qiyaoCaptureStartupProfile!();
    expect(summarizeStartupProfile(profile)?.durationMs).toBeGreaterThan(0);
    expect(context).not.toHaveProperty('qiyaoCaptureStartupProfile');
  });
  it('releases the session even when stopping the profiler fails', async () => {
    const disconnect = vi.fn();
    class StopFailureSession { connect() {} disconnect = disconnect; post(method: string, _params: object, done: (error: Error | null, result?: object) => void) { done(method === 'Profiler.stop' ? new Error('stop failure') : null, {}); } }
    const context: { require: () => object; qiyaoCaptureStartupProfile?: () => Promise<Profiler.Profile> } = { require: () => ({ Session: StopFailureSession }) };
    expect(await runInNewContext(startStartupProfileExpression, context)).toBe(true);
    await expect(context.qiyaoCaptureStartupProfile!()).rejects.toThrow('stop failure');
    expect(disconnect).toHaveBeenCalledOnce(); expect(context).not.toHaveProperty('qiyaoCaptureStartupProfile');
  });
});
