import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { projectCommand } from '../desktop/services/project-command';

describe('project command lifecycle', () => {
  it('passes arguments literally, uses the project directory and streams bounded output', async () => {
    const progress = vi.fn();
    const result = await projectCommand(process.execPath, ['-e', 'process.stdout.write(process.cwd()+"\\n"+process.argv[1]); process.stderr.write("\\nError stream");', 'literal $(no-shell) & text'], tmpdir(), 5000, new AbortController().signal, progress);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.output).toContain(resolve(tmpdir()));
    expect(result.output).toContain('literal $(no-shell) & text');
    expect(result.output).toContain('Error stream');
    expect(progress).toHaveBeenCalled();
    const large = await projectCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000));'], tmpdir(), 5000, new AbortController().signal, () => {});
    expect(large.output.length).toBeLessThan(64_000); expect(large.output).toContain('truncated');
  });
  it('returns nonzero exit status, times out, and hides startup exception details', async () => {
    expect((await projectCommand(process.execPath, ['-e', 'process.exit(3)'], tmpdir(), 5000, new AbortController().signal, () => {})).exitCode).toBe(3);
    const timeout = await projectCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], tmpdir(), 100, new AbortController().signal, () => {});
    expect(timeout.timedOut).toBe(true);
    await expect(projectCommand('qiyao-missing-executable', [], tmpdir(), 5000, new AbortController().signal, () => {})).rejects.toThrow('Could not start');
  });
  it('stops the created process and its descendants on cancellation', async () => {
    const controller = new AbortController(); let descendant = 0;
    const script = 'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"}); process.stdout.write(String(c.pid)); setInterval(()=>{},1000);';
    const promise = projectCommand(process.execPath, ['-e', script], tmpdir(), 5000, controller.signal, (text) => { descendant = Number(text); controller.abort(); });
    await expect(promise).rejects.toThrow('stopped');
    expect(descendant).toBeGreaterThan(0);
    await vi.waitFor(() => expect(() => process.kill(descendant, 0)).toThrow());
    expect(() => projectCommand(process.execPath, [], tmpdir(), 1000, controller.signal, () => {})).toThrow();
  });
});
