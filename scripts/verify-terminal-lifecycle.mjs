import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { waitForTerminalPrompt } from './terminal-prompt.mjs';

export async function verifyTerminalLifecycle({ page, application, getApplication, directory, projectDirectory, verified, waitForBridge, restart }) {
  assert.equal(process.platform, 'win32', 'This lifecycle reproduction exercises Windows ConPTY and owned process trees.');
  const projectId = randomUUID(); const cases = [];
  const childFile = join(directory, 'terminal-owned-child.cjs');
  await writeFile(childFile, "console.log('NOOK_OWNED_CHILD_PID:' + process.pid);setInterval(() => {}, 1000);\n");
  await page.evaluate(({ id, path }) => window.qiyao.saveProject({ id, name: '终端退出验证', path, instructions: '', createdAt: 1 }), { id: projectId, path: projectDirectory });
  const processExists = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  async function waitForGone(pids) {
    const deadline = Date.now() + 10_000;
    while (pids.some(processExists)) { assert.ok(Date.now() < deadline, `Owned terminal processes remain after close: ${pids.filter(processExists).join(',')}`); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  for (let round = 1; round <= 2; round++) for (const mode of ['natural-exit', 'explicit-close', 'application-close']) {
    const session = await page.evaluate(id => window.qiyao.terminalOpen(id, { cols: 100, rows: 24 }), projectId);
    await waitForTerminalPrompt(() => page.evaluate(id => window.qiyao.terminalList(id), projectId));
    const diagnostic = await application.evaluateMain('globalThis.qiyaoPtyDiagnostics.at(-1)');
    assert.ok(Number.isInteger(diagnostic.pid) && diagnostic.pid > 0); assert.equal(processExists(diagnostic.pid), true);
    const ownedPids = [diagnostic.pid];
    if (mode === 'natural-exit') {
      await page.evaluate(id => window.qiyao.terminalWrite(id, "Write-Output ('NOOK_FINAL_'+'OUTPUT');exit 7\r"), session.id);
      await waitForBridge(page, async ({ projectId, id }) => (await window.qiyao.terminalList(projectId)).some(item => item.id === id && item.status === 'exited' && item.exitCode === 7 && item.output.includes('NOOK_FINAL_OUTPUT')), { projectId, id: session.id });
      await waitForGone(ownedPids);
      await page.evaluate(id => window.qiyao.terminalClose(id), session.id);
    } else {
      const quote = value => `'${value.replaceAll("'", "''")}'`;
      await page.evaluate(({ id, command }) => window.qiyao.terminalWrite(id, command), { id: session.id, command: `& ${quote(process.execPath)} ${quote(childFile)}\r` });
      await waitForBridge(page, async ({ projectId, id }) => /NOOK_OWNED_CHILD_PID:\d+/.test((await window.qiyao.terminalList(projectId)).find(item => item.id === id)?.output ?? ''), { projectId, id: session.id });
      const childPid = await page.evaluate(async ({ projectId, id }) => Number((await window.qiyao.terminalList(projectId)).find(item => item.id === id).output.match(/NOOK_OWNED_CHILD_PID:(\d+)/)[1]), { projectId, id: session.id });
      assert.ok(childPid > 0); assert.equal(processExists(childPid), true); ownedPids.push(childPid);
      if (mode === 'explicit-close') { await page.evaluate(id => window.qiyao.terminalClose(id), session.id); await waitForGone(ownedPids); }
    }
    const startedAt = Date.now(); page = await restart(); application = getApplication();
    await waitForGone(ownedPids); assert.deepEqual(await page.evaluate(id => window.qiyao.terminalList(id), projectId), []);
    const record = { round, mode, ownedPids, restartMs: Date.now() - startedAt, processesGone: true }; cases.push(record);
    console.log('Terminal lifecycle observation', JSON.stringify(record));
    verified(`Windows terminal ${mode} round ${round} preserves final output where applicable, removes owned processes and restarts within existing deadlines`);
  }
  return { page, result: { checks: 6, cases, boundary: 'Real Windows PTY and owned Node descendants through application IPC, two rounds per lifecycle. Not physical terminal input, all shell versions or proof of the intermittent full-suite exit cause.' } };
}
