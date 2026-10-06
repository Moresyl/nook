import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalSessions, type PtyFactory } from '../desktop/services/terminal-sessions';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup(emit = vi.fn()) {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-terminal-')); directories.push(root);
  const processes: { data: (value: string) => void; exit: (value: { exitCode: number }) => void; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const spawn: PtyFactory = vi.fn(() => {
    const process = { data: (_value: string) => {}, exit: (_value: { exitCode: number }) => {}, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), dispose: vi.fn() }; processes.push(process);
    return { pid: 123, write: process.write, resize: process.resize, kill: process.kill, onData: (listener: (data: string) => void) => { process.data = listener; return { dispose: process.dispose }; }, onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => { process.exit = listener; return { dispose: process.dispose }; } };
  });
  const terminate = vi.fn(async (process) => process.kill());
  const terminals = new TerminalSessions(spawn, emit, terminate);
  return { root, processes, spawn, emit, terminate, terminals };
}
describe('owned PTY sessions', () => {
  it('uses the selected available shell with the existing profile-free arguments and owned project geometry', async () => {
    const { root, spawn, emit, terminate } = await setup(); const selected = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'; const choose = vi.fn(async () => selected);
    const terminals = new TerminalSessions(spawn, emit, terminate, choose);
    const session = await terminals.open('project', root, { cols: 80, rows: 24 }); expect(choose).toHaveBeenCalledTimes(1); expect(session.shell).toBe(selected);
    expect(spawn).toHaveBeenCalledWith(selected, process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [], expect.objectContaining({ cwd: root, cols: 80, rows: 24 })); await terminals.shutdown();
  });
  it('starts in the verified project folder, streams numbered output and replays bounded snapshots', async () => {
    const { root, terminals, processes, spawn, emit } = await setup();
    const session = await terminals.open('project', root, { cols: 80, rows: 24 });
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ cwd: root, cols: 80, rows: 24, name: 'xterm-256color' }));
    processes[0].data('\u001b[31mANSI output\u001b[0m'); processes[0].data('x'.repeat(300_000));
    expect(emit.mock.calls[0][0]).toMatchObject({ id: session.id, sequence: 1, data: '\u001b[31mANSI output\u001b[0m' });
    expect(terminals.list('project')[0]).toMatchObject({ sequence: 2, status: 'running' }); expect(terminals.list('project')[0].output).toHaveLength(256_000);
    const copied = terminals.list('project'); copied[0].output = 'changed'; expect(terminals.list('project')[0].output).not.toBe('changed');
    expect(terminals.list('other')).toEqual([]); expect(terminals.active()).toBe(true);
    terminals.write(session.id, 'echo evidence\r'); terminals.resize(session.id, { cols: 120, rows: 40 });
    expect(processes[0].write).toHaveBeenCalledWith('echo evidence\r'); expect(processes[0].resize).toHaveBeenCalledWith(120, 40);
    processes[0].exit({ exitCode: 7 }); expect(terminals.active()).toBe(false); expect(terminals.list('project')[0]).toMatchObject({ status: 'exited', exitCode: 7, sequence: 3 });
    expect(() => terminals.write(session.id, 'more')).toThrow('closed'); await terminals.close(session.id); expect(terminals.list('project')).toEqual([]);
  });
  it('does not spawn a terminal when shutdown happens during shell discovery', async () => {
    const { root, spawn, emit, terminate } = await setup(); let release!: (shell: string) => void;
    const selected = new Promise<string>((resolve) => { release = resolve; }); const choose = vi.fn(() => selected);
    const terminals = new TerminalSessions(spawn, emit, terminate, choose); const opening = terminals.open('project', root, { cols: 80, rows: 24 });
    const rejected = expect(opening).rejects.toThrow('Close'); await vi.waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    await terminals.shutdown(); release('powershell.exe'); await rejected; expect(spawn).not.toHaveBeenCalled(); expect(terminals.list('project')).toEqual([]);
  });
  it('keeps the sixteen-session limit when concurrent shell discovery completes together', async () => {
    const { root, spawn, emit, terminate } = await setup(); let release!: (shell: string) => void;
    const selected = new Promise<string>((resolve) => { release = resolve; }); const choose = vi.fn(() => selected);
    const terminals = new TerminalSessions(spawn, emit, terminate, choose);
    const openings = Promise.allSettled(Array.from({ length: 17 }, () => terminals.open('project', root, { cols: 80, rows: 24 })));
    await vi.waitFor(() => expect(choose).toHaveBeenCalledTimes(17)); release('powershell.exe'); const results = await openings;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(16);
    expect(results.filter((result) => result.status === 'rejected')).toEqual([expect.objectContaining({ reason: expect.any(Error) })]);
    expect(spawn).toHaveBeenCalledTimes(16); expect(terminals.list('project')).toHaveLength(16); await terminals.shutdown(); expect(terminate).toHaveBeenCalledTimes(16);
  });
  it('redacts a failed shell resolver and leaves no owned process or session', async () => {
    const { root, spawn, emit, terminate } = await setup(); const choose = vi.fn(async () => { throw new Error('PRIVATE_SHELL_DISCOVERY_PATH'); });
    const terminals = new TerminalSessions(spawn, emit, terminate, choose);
    await expect(terminals.open('project', root, { cols: 80, rows: 24 })).rejects.toThrow(/^Could not start the terminal\. Check the shell and project folder\.$/);
    expect(spawn).not.toHaveBeenCalled(); expect(terminals.active()).toBe(false); await terminals.shutdown();
  });
  it('closes only owned project sessions, disposes listeners and stops accepting sessions at shutdown', async () => {
    const { root, terminals, processes, terminate } = await setup();
    const one = await terminals.open('one', root, { cols: 80, rows: 24 }); const two = await terminals.open('two', root, { cols: 80, rows: 24 });
    await terminals.closeProject('one'); expect(terminate).toHaveBeenCalledTimes(1); expect(processes[0].dispose).toHaveBeenCalledTimes(2); expect(terminals.list('two')).toHaveLength(1);
    processes[0].data('late'); processes[0].exit({ exitCode: 0 }); expect(terminals.list('one')).toEqual([]);
    await terminals.close(one.id); await terminals.shutdown(); expect(terminate).toHaveBeenCalledTimes(2); expect(() => terminals.resize(two.id, { cols: 80, rows: 24 })).toThrow('closed');
    await expect(terminals.open('one', root, { cols: 80, rows: 24 })).rejects.toThrow('Close');
  });
  it.each(['project', 'application'] as const)('waits for an already closing terminal when closing the %s', async (scope) => {
    const { root, spawn, emit, processes } = await setup(); let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; }); const terminate = vi.fn(() => pending);
    const terminals = new TerminalSessions(spawn, emit, terminate); const session = await terminals.open('one', root, { cols: 80, rows: 24 });
    const first = terminals.close(session.id); const firstFinished = vi.fn(); void first.then(firstFinished);
    const again = terminals.close(session.id); const againFinished = vi.fn(); void again.then(againFinished);
    const closing = scope === 'project' ? terminals.closeProject('one') : terminals.shutdown(); const closingFinished = vi.fn(); void closing.then(closingFinished);
    try {
      await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1)); await Promise.resolve(); await Promise.resolve();
      expect(terminals.list('one')).toEqual([]); expect(processes[0].dispose).toHaveBeenCalledTimes(2);
      expect(firstFinished).not.toHaveBeenCalled(); expect(againFinished).not.toHaveBeenCalled(); expect(closingFinished).not.toHaveBeenCalled();
      processes[0].data('late'); expect(emit).not.toHaveBeenCalled();
    } finally { release(); await Promise.all([first, again, closing]); }
    expect(firstFinished).toHaveBeenCalledTimes(1); expect(againFinished).toHaveBeenCalledTimes(1); expect(closingFinished).toHaveBeenCalledTimes(1);
    await terminals.shutdown(); expect(terminate).toHaveBeenCalledTimes(1);
  });
  it('counts terminals awaiting cleanup toward the sixteen-process limit and releases their slots', async () => {
    const { root, spawn, emit } = await setup(); let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; }); const terminate = vi.fn(() => pending);
    const terminals = new TerminalSessions(spawn, emit, terminate);
    const sessions = await Promise.all(Array.from({ length: 16 }, () => terminals.open('one', root, { cols: 80, rows: 24 })));
    const closing = Promise.all(sessions.map(({ id }) => terminals.close(id)));
    try {
      await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(16));
      await expect(terminals.open('two', root, { cols: 80, rows: 24 })).rejects.toThrow('Close'); expect(spawn).toHaveBeenCalledTimes(16);
    } finally { release(); await closing; }
    await terminals.open('two', root, { cols: 80, rows: 24 }); expect(spawn).toHaveBeenCalledTimes(17); await terminals.shutdown();
  });
  it('shares a pending cleanup failure with concurrent closers and releases its process slot', async () => {
    const { root, spawn, emit } = await setup(); let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, failed) => { reject = failed; }); const failure = new Error('Owned cleanup failed');
    const terminate = vi.fn(() => pending); const terminals = new TerminalSessions(spawn, emit, terminate);
    const session = await terminals.open('one', root, { cols: 80, rows: 24 });
    const first = terminals.close(session.id); const again = terminals.close(session.id); const project = terminals.closeProject('one');
    const outcomes = Promise.allSettled([first, again, project]); await vi.waitFor(() => expect(terminate).toHaveBeenCalledTimes(1)); reject(failure);
    expect(await outcomes).toEqual(Array.from({ length: 3 }, () => ({ status: 'rejected', reason: failure })));
    await terminals.close(session.id); await terminals.shutdown(); expect(terminate).toHaveBeenCalledTimes(1);
  });
  it('validates geometry, input, session limits, missing folders and process errors', async () => {
    const { root, terminals } = await setup();
    await expect(terminals.open('p', root, { cols: 1, rows: 24 })).rejects.toThrow();
    await expect(terminals.open('p', join(root, 'missing'), { cols: 80, rows: 24 })).rejects.toThrow();
    expect(() => terminals.write('unknown', 'x')).toThrow('closed'); expect(() => terminals.write('unknown', '')).toThrow('input'); expect(() => terminals.write('unknown', 'x'.repeat(64_001))).toThrow('input');
    for (let i = 0; i < 16; i++) await terminals.open('p', root, { cols: 80, rows: 24 });
    await expect(terminals.open('p', root, { cols: 80, rows: 24 })).rejects.toThrow('Close'); await terminals.shutdown();
    const failed = new TerminalSessions(() => { throw new Error('Private shell output'); }, vi.fn()); await expect(failed.open('p', root, { cols: 80, rows: 24 })).rejects.toThrow('Could not start');
  });
  it('keeps sessions alive if the renderer disappears', async () => {
    const { root, terminals, processes } = await setup(vi.fn(() => { throw new Error('Renderer gone'); }));
    await terminals.open('p', root, { cols: 80, rows: 24 }); processes[0].data('Kept'); processes[0].kill.mockImplementation(() => { throw new Error('Already gone'); }); processes[0].exit({ exitCode: 0 }); expect(terminals.list('p')[0].output).toBe('Kept'); await terminals.shutdown();
  });
});
