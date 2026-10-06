import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createPluginFixture } from '../verification/plugin-fixture.mjs';

/** Observe the exact owned renderer rather than whichever plugin window happens to be first. */
export async function crashPluginRuntime(application, id) {
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(await application.evaluateMain(`(() => {
      const windows = require('electron').BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && w.webContents.getURL() === 'qiyao-plugin://${id}/_qiyao/runtime.html');
      if (windows.length !== 1) return windows.length;
      const window = windows[0], contents = window.webContents;
      const record = { windowId: window.id, contentsId: contents.id, processId: contents.getOSProcessId(), startedAt: Date.now(), events: [] };
      const session = contents.session, originalClear = session.clearStorageData;
      const clear = async function (...args) {
        record.events.push({ event: 'storage-clear-start', at: Date.now() });
        try { const result = await originalClear.apply(this, args); record.events.push({ event: 'storage-clear-end', at: Date.now(), success: true }); return result; }
        catch (error) { record.events.push({ event: 'storage-clear-end', at: Date.now(), success: false }); throw error; }
      };
      session.clearStorageData = clear;
      const gone = (_event, details) => record.events.push({ event: 'render-process-gone', at: Date.now(), reason: details.reason, exitCode: details.exitCode });
      const closed = () => record.events.push({ event: 'closed', at: Date.now() });
      contents.on('render-process-gone', gone); window.on('closed', closed);
      globalThis.nookFinishCrashObservation = () => {
        if (session.clearStorageData === clear) session.clearStorageData = originalClear;
        if (!contents.isDestroyed()) contents.removeListener('render-process-gone', gone);
        window.removeListener('closed', closed); delete globalThis.nookFinishCrashObservation;
        return { ...record, capturedAt: Date.now(), destroyed: window.isDestroyed(), crashed: contents.isDestroyed() ? null : contents.isCrashed() };
      };
      contents.forcefullyCrashRenderer(); return windows.length;
    })()`), 1);
  return () => application.evaluateMain('globalThis.nookFinishCrashObservation()');
}

/** Exercises real renderer failure; records lifecycle metadata without plugin content or credentials. */
export async function verifyPluginCrash({ page, application, directory, domain, waitForBridge, verified }) {
  const source = join(directory, 'plugin-crash-fixture'); await createPluginFixture(source, domain);
  await application.evaluateMain(`globalThis.nookCrashOpenDialog = require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(source)}] });`);
  let plugin;
  try { plugin = (await page.evaluate(() => window.qiyao.importPlugin())).plugins.find(item => item.manifest.id === 'example.evidence'); }
  finally { await application.evaluateMain('require("electron").dialog.showOpenDialog = globalThis.nookCrashOpenDialog; delete globalThis.nookCrashOpenDialog;'); }
  assert.ok(plugin);
  const observations = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.evaluate(input => window.qiyao.savePlugin(input), { id: plugin.id, enabled: true, grants: plugin.manifest.permissions, projectIds: [] });
    await waitForBridge(page, async id => (await window.qiyao.pluginViews()).find(item => item.id === id)?.status === 'running', plugin.id);
    const finish = await crashPluginRuntime(application, plugin.id);
    try {
      await waitForBridge(page, async id => !(await window.qiyao.load()).plugins.find(item => item.id === id)?.enabled && (await window.qiyao.pluginViews()).find(item => item.id === id)?.status === 'error', plugin.id);
    } finally {
      const row = await finish();
      observations.push({ attempt, ...row }); console.log('Plugin crash observation', JSON.stringify(observations.at(-1)));
    }
    assert.ok(observations.at(-1).events.some(item => item.event === 'render-process-gone'));
    verified(`real plugin renderer crash ${attempt} disables the plugin and permits explicit recovery`);
  }
  return { checks: 3, observations };
}
