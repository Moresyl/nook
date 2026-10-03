import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyPersistence({ page, application, directory, endpoint }) {
  const workspacePath = join(directory, 'workspace.json');
  await page.evaluate((url) => window.qiyao.saveProvider({ id: 'persistence', name: 'Persistence verification', kind: 'ollama', endpoint: url, models: ['verification-model'], hasKey: false }), endpoint);
  const holdScript = join(directory, 'hold-workspace.ps1');
  await writeFile(holdScript, "param([string]$WorkspacePath)\n$stream = [IO.File]::Open($WorkspacePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)\ntry { [Console]::WriteLine('LOCK_READY'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 600 } finally { $stream.Dispose() }\n");
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', holdScript, '-WorkspacePath', workspacePath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => { holder.once('exit', resolve); holder.once('error', resolve); });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('The Windows file-share fixture did not open the workspace')), 5000); holder.once('error', (error) => { clearTimeout(timer); reject(error); }); holder.stdout.on('data', (chunk) => { if (chunk.toString().includes('LOCK_READY')) { clearTimeout(timer); resolve(); } }); holder.once('exit', () => { clearTimeout(timer); reject(new Error('The file-share fixture exited before opening the workspace')); }); });
    await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); });
  } finally { await exited; }
  const errors = await application.evaluateMain('globalThis.qiyaoFilesystemFailures');
  assert.ok(errors.length > 0, 'The real Windows file-share fixture must reject at least one replacement');
  assert.equal((JSON.parse(await readFile(workspacePath, 'utf8'))).preferences.theme, 'dark');

  let reads = 0; let reading = true; const readErrors = [];
  const reader = (async () => { while (reading) { try { JSON.parse(await readFile(workspacePath, 'utf8')); reads++; } catch (error) { readErrors.push(error.code ?? error.name); } await new Promise((resolve) => setTimeout(resolve, 2)); } })();
  const cycles = 12;
  try {
    for (let cycle = 0; cycle < cycles; cycle++) {
      const { threadId } = await page.evaluate((value) => window.qiyao.submit({ providerId: 'persistence', model: 'verification-model', text: `slow persistence ${value}`, attachments: [] }), cycle);
      let checkpoint = false;
      const deadline = Date.now() + 5000;
      while (!checkpoint && Date.now() < deadline) {
        await page.evaluate(async ({ threadId, cycle }) => { await window.qiyao.saveComposerDraft({ threadId, text: `Unsent persistence ${cycle}`, attachments: [], providerId: 'persistence', model: 'verification-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() }); }, { threadId, cycle });
        const thread = JSON.parse(await readFile(workspacePath, 'utf8')).threads.find((item) => item.id === threadId);
        if (thread.messages.at(-1).status !== 'running') throw new Error(`The streaming persistence cycle ${cycle} ended before its checkpoint`);
        checkpoint = thread.messages.at(-1).content === 'First partial response';
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(checkpoint, true); await page.evaluate((id) => window.qiyao.stop(id), threadId);
      assert.equal((await page.evaluate(() => window.qiyao.load())).threads.find((item) => item.id === threadId).messages.at(-1).status, 'stopped');
    }
  } finally { reading = false; await reader; }
  assert.deepEqual(readErrors, []);
  const failures = await application.evaluateMain('globalThis.qiyaoFilesystemFailures');
  assert.ok(failures.every((error) => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && error.syscall === 'rename' && error.destination === 'workspace.json'));
  assert.deepEqual((await readdir(directory)).filter((name) => /^workspace\.json\..+\.tmp$/.test(name)), []);
  return { cycles, reads, sharingFailures: errors.length, transientFilesystemErrors: Object.fromEntries([...new Set(failures.map((error) => error.code))].map((code) => [code, failures.filter((error) => error.code === code).length])) };
}
