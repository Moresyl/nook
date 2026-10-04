import { stat } from 'node:fs/promises';
import { win32 } from 'node:path';

export async function terminalShell(platform = process.platform, environment = process.env,
  isFile: (path: string) => Promise<boolean> = async (path) => (await stat(path)).isFile()): Promise<string> {
  if (platform !== 'win32') return environment.SHELL || '/bin/bash';
  const roots = [environment.ProgramFiles, environment.ProgramW6432].filter((root): root is string => Boolean(root && win32.isAbsolute(root) && !root.includes('\0')));
  const candidates = [...new Set(roots.map((root) => win32.join(root, 'PowerShell', '7', 'pwsh.exe')))];
  for (const candidate of candidates) {
    try { if (await isFile(candidate)) return candidate; } catch { /* An unavailable installation retains the Windows PowerShell fallback. */ }
  }
  return 'powershell.exe';
}
