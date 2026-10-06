import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { IPty, IPtyForkOptions } from 'node-pty';
import type { TerminalEvent, TerminalGeometry, TerminalSession } from '../../contracts/projects';
import { terminalGeometrySchema } from '../../contracts/projects';
import { scopedPath } from './project-files';
import { terminalShell } from './terminal-shell';

type Pty = Pick<IPty, 'pid' | 'onData' | 'onExit' | 'write' | 'resize' | 'kill'>;
export type PtyFactory = (shell: string, args: string[], options: IPtyForkOptions) => Pty;
type Session = { view: TerminalSession; process: Pty; dispose: (() => void)[] };

export class TerminalSessions {
  private sessions = new Map<string, Session>();
  private closingSessions = new Map<string, { projectId: string; promise: Promise<void> }>();
  private closing = false;
  constructor(private readonly spawn: PtyFactory, private readonly emit: (event: TerminalEvent) => void,
    private readonly terminate = (pty: Pty): Promise<void> => new Promise((resolve) => {
      const finish = () => { try { pty.kill(); } catch {} resolve(); };
      if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pty.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, finish);
      else finish();
    }), private readonly chooseShell: () => Promise<string> = () => terminalShell()) {}
  private notify(event: TerminalEvent) { try { this.emit(event); } catch {} }
  async open(projectId: string, root: string, raw: TerminalGeometry): Promise<TerminalSession> {
    if (this.closing || this.sessions.size + this.closingSessions.size >= 16) throw new Error('Close a terminal before opening another one.');
    const geometry = terminalGeometrySchema.parse(raw);
    const cwd = await scopedPath(root, '.');
    if (this.closing || this.sessions.size + this.closingSessions.size >= 16) throw new Error('Close a terminal before opening another one.');
    let shell: string;
    try { shell = await this.chooseShell(); }
    catch { throw new Error('Could not start the terminal. Check the shell and project folder.'); }
    if (this.closing || this.sessions.size + this.closingSessions.size >= 16) throw new Error('Close a terminal before opening another one.');
    let pty: Pty;
    try { pty = this.spawn(shell, process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [], { ...geometry, cwd, name: 'xterm-256color', env: { ...process.env, TERM: 'xterm-256color' } }); }
    catch { throw new Error('Could not start the terminal. Check the shell and project folder.'); }
    const view: TerminalSession = { id: randomUUID(), projectId, cwd, shell, status: 'running', output: '', sequence: 0 };
    const session: Session = { view, process: pty, dispose: [] };
    this.sessions.set(view.id, session);
    const dataSubscription = pty.onData((data) => {
      if (!this.sessions.has(view.id) || view.status !== 'running') return;
      view.output = (view.output + data).slice(-256_000); view.sequence++;
      this.notify({ id: view.id, sequence: view.sequence, data });
    });
    const exitSubscription = pty.onExit(({ exitCode }) => {
      if (!this.sessions.has(view.id)) return;
      view.status = 'exited'; view.exitCode = exitCode; view.sequence++;
      this.notify({ id: view.id, sequence: view.sequence, exitCode });
      try { pty.kill(); } catch {}
    });
    session.dispose.push(() => dataSubscription.dispose(), () => exitSubscription.dispose());
    return structuredClone(view);
  }
  list(projectId: string): TerminalSession[] { return [...this.sessions.values()].filter(({ view }) => view.projectId === projectId).map(({ view }) => structuredClone(view)); }
  private running(id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.view.status !== 'running') throw new Error('This terminal has closed. Open a new terminal.');
    return session;
  }
  write(id: string, data: string): void {
    if (!data || data.length > 64_000) throw new Error('Terminal input must be between 1 and 64 KB.');
    this.running(id).process.write(data);
  }
  resize(id: string, raw: TerminalGeometry): void { const size = terminalGeometrySchema.parse(raw); this.running(id).process.resize(size.cols, size.rows); }
  async close(id: string): Promise<void> {
    const pending = this.closingSessions.get(id);
    if (pending) return pending.promise;
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.dispose.forEach((dispose) => dispose());
    if (session.view.status === 'running') {
      const promise = Promise.resolve().then(() => this.terminate(session.process)).finally(() => this.closingSessions.delete(id));
      this.closingSessions.set(id, { projectId: session.view.projectId, promise });
      await promise;
    }
  }
  active(): boolean { return [...this.sessions.values()].some(({ view }) => view.status === 'running'); }
  async closeProject(projectId: string): Promise<void> {
    const ids = [...this.list(projectId).map(({ id }) => id), ...[...this.closingSessions].filter(([, session]) => session.projectId === projectId).map(([id]) => id)];
    await Promise.all(ids.map((id) => this.close(id)));
  }
  async shutdown(): Promise<void> {
    this.closing = true; await Promise.all([...this.sessions.keys(), ...this.closingSessions.keys()].map((id) => this.close(id)));
  }
}
