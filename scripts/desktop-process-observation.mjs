import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

// Observe only PIDs returned by this test application's own Electron metrics.
// Never collect command lines, paths, socket contents or unrelated processes.
export async function observeDesktopProcesses(pids, execute = runFile) {
  if (!Array.isArray(pids) || !pids.length || pids.length > 16 || pids.some(pid => !Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) || new Set(pids).size !== pids.length) throw new Error('Expected bounded, unique desktop process IDs.');
  const command = `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows=@(); foreach($taskPid in @(${pids.join(',')})) { $p=Get-Process -Id $taskPid -ErrorAction SilentlyContinue; if($p) { try { $threads=@($p.Threads | Select-Object -First 64 | ForEach-Object { $reason=if($_.ThreadState -eq 'Wait') { [string]$_.WaitReason } else { '' }; @{id=$_.Id;state=[string]$_.ThreadState;reason=$reason} }); $rows+=@{pid=$taskPid;cpuMilliseconds=$p.TotalProcessorTime.TotalMilliseconds;workingSetBytes=$p.WorkingSet64;threads=$threads} } catch { $rows+=@{pid=$taskPid;unavailable=$true} } } else { $rows+=@{pid=$taskPid;exited=$true} } }; ConvertTo-Json -InputObject $rows -Depth 4 -Compress`;
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 2000, maxBuffer: 65_536 });
    const rows = JSON.parse(stdout);
    if (!Array.isArray(rows) || rows.length !== pids.length || rows.some((row, index) => row?.pid !== pids[index])) throw new Error('Invalid observation');
    return rows.map(row => {
      if (row.exited === true) return { pid: row.pid, exited: true };
      if (row.unavailable === true) return { pid: row.pid, unavailable: true };
      if (![row.cpuMilliseconds, row.workingSetBytes].every(value => Number.isFinite(value) && value >= 0) || !Array.isArray(row.threads) || row.threads.length > 64) throw new Error('Invalid process metadata');
      const threads = row.threads.map(thread => {
        if (!Number.isInteger(thread.id) || thread.id <= 0 || typeof thread.state !== 'string' || thread.state.length > 32 || typeof thread.reason !== 'string' || thread.reason.length > 32) throw new Error('Invalid thread metadata');
        return { id: thread.id, state: thread.state, reason: thread.reason };
      });
      return { pid: row.pid, cpuMilliseconds: row.cpuMilliseconds, workingSetBytes: row.workingSetBytes, threads };
    });
  } catch { throw new Error('Desktop process observation unavailable.'); }
}
