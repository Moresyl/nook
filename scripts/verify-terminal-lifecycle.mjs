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
  // Hold only the application's exit listener after the real native callback
  // arrives, so cleanup acknowledgement and its timeout are independently tested.
  await application.evaluateMain(`(() => {
    const applicationRequire = require('node:module').createRequire(require('node:path').join(require('electron').app.getAppPath(), 'package.json'));
    const prototype = applicationRequire('node-pty/lib/terminal').Terminal.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'onExit');
    globalThis.nookHeldTerminalExits = []; globalThis.nookHoldTerminalExit = true; globalThis.nookExitSubscriptions = 0;
    Object.defineProperty(prototype, 'onExit', { ...descriptor, get() {
      const subscribe = descriptor.get.call(this);
      return listener => { globalThis.nookExitSubscriptions++; return subscribe(event => {
        if (globalThis.nookHoldTerminalExit) globalThis.nookHeldTerminalExits.push(() => listener(event));
        else listener(event);
      }); };
    } });
    globalThis.nookRestoreTerminalSubscription = () => Object.defineProperty(prototype, 'onExit', descriptor);
    const dialog = require('electron').dialog, show = dialog.showMessageBox;
    globalThis.nookTerminalCloseErrors = [];
    dialog.showMessageBox = async (...args) => { globalThis.nookTerminalCloseErrors.push(args.at(-1)); return { response: 0, checkboxChecked: false }; };
    globalThis.nookRestoreTerminalDialog = () => { dialog.showMessageBox = show; };
  })()`);
  try {
    const terminal = await page.evaluate(id => window.qiyao.terminalOpen(id, { cols: 100, rows: 24 }), projectId);
    assert.equal(await application.evaluateMain('globalThis.nookExitSubscriptions'), 1);
    await application.evaluateMain('globalThis.nookRestoreTerminalSubscription()');
    await waitForTerminalPrompt(() => page.evaluate(id => window.qiyao.terminalList(id), projectId));
    await application.evaluateMain("require('electron').app.quit()");
    const deadline = Date.now() + 9000;
    while (!(await application.evaluateMain('globalThis.nookTerminalCloseErrors.length'))) {
      assert.ok(Date.now() < deadline, 'Missing terminal acknowledgement must retain the window and report cleanup failure');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await page.isClosed(), false);
    assert.ok(await application.evaluateMain('globalThis.nookHeldTerminalExits.length > 0'));
    assert.equal((await page.evaluate(id => window.qiyao.terminalList(id), projectId)).some(item => item.id === terminal.id), true);
    await application.evaluateMain('globalThis.nookHoldTerminalExit = false; globalThis.nookHeldTerminalExits.splice(0).forEach(release => release())');
    await waitForBridge(page, async ({ projectId, id }) => (await window.qiyao.terminalList(projectId)).some(item => item.id === id && item.status === 'exited'), { projectId, id: terminal.id });
  } finally {
    await application.evaluateMain('globalThis.nookRestoreTerminalSubscription(); globalThis.nookHoldTerminalExit = false; globalThis.nookHeldTerminalExits.splice(0).forEach(release => release()); globalThis.nookRestoreTerminalDialog()');
  }
  // An application-level retry must go through cleanup again, not skip it because
  // a previous attempt left the global quitting flag set.
  await application.close({ quit: true });
  page = await restart(); application = getApplication();
  assert.deepEqual(await page.evaluate(id => window.qiyao.terminalList(id), projectId), []);
  verified('a held native terminal exit acknowledgement retains the app on timeout and permits normal quit retry after the callback is released');
  return { page, result: { checks: 7, cases, exitAcknowledgementTimeoutRetained: true, applicationQuitRetryVerified: true, boundary: 'Real Windows PTY and owned Node descendants through application IPC, two rounds per lifecycle plus an isolated held application callback after native delivery. Not physical terminal input, all shell versions or proof of the intermittent full-suite exit cause.' } };
}
