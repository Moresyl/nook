import { execFile, spawn } from 'node:child_process';

export type CommandResult = { output: string; exitCode: number | null; timedOut: boolean };

function terminate(child: ReturnType<typeof spawn>): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => { child.kill(); });
  } else {
    try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const fallback = setTimeout(() => { try { if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 1000);
    fallback.unref();
  }
}

export function projectCommand(program: string, args: string[], cwd: string, timeout: number, signal: AbortSignal, onProgress: (output: string) => void): Promise<CommandResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let truncated = false;
    let timedOut = false;
    let lastProgress = 0;
    const report = (text: string) => {
      if (!truncated) {
        const remaining = 60_000 - output.length;
        output += text.slice(0, remaining);
        if (text.length > remaining) { output += '\n[Command output truncated.]'; truncated = true; }
      }
      if (Date.now() - lastProgress >= 100) { lastProgress = Date.now(); onProgress(output); }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', report); child.stderr.on('data', report);
    const abort = () => terminate(child);
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, timeout);
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => { clean(); reject(new Error('Could not start the command. Check the program and executable path.')); });
    child.once('close', (exitCode) => {
      clean();
      if (signal.aborted) reject(new DOMException('Command stopped', 'AbortError'));
      else resolve({ output, exitCode, timedOut });
    });
  });
}
