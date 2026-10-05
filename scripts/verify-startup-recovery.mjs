import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyStartupRecovery({ page, application, screenshots, waitForBridge }) {
  const draft = 'STARTUP_RECOVERY_RETAINS_SAVED_DRAFT';
  await page.keyboard.press('Control+n');
  await page.getByLabel('消息', { exact: true }).fill(draft);
  await waitForBridge(page, async expected => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === expected), draft);
  assert.equal(await page.evaluate(async expected => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === expected), draft), true);
  await application.evaluateMain(`(() => {
    const ipc = require('electron').ipcMain;
    globalThis.nookStartupRecovery = { original: ipc._invokeHandlers.get('qiyao:invoke'), mode: 'reject', calls: 0, events: [] };
    ipc.removeHandler('qiyao:invoke');
    ipc.handle('qiyao:invoke', async (event, method, ...args) => {
      const fixture = globalThis.nookStartupRecovery;
      if (['load', 'saveComposerDraft', 'activateThread'].includes(method)) fixture.events.push({ method, mode: fixture.mode, length: args[0]?.text?.length });
      if (method === 'load') {
        fixture.calls++;
        if (fixture.mode === 'reject') throw new Error('STARTUP_PRIVATE_DETAIL_SENTINEL');
        if (fixture.mode === 'hold') await new Promise(resolve => { fixture.release = resolve; });
      }
      const result = await fixture.original(event, method, ...args);
      if (method === 'load') fixture.events.push({ method: 'loaded', drafts: result.composerDrafts.map(item => ({ length: item.text.length, thread: Boolean(item.threadId) })) });
      return result;
    });
  })()`);
  try {
    await page.reload();
    const failure = page.getByRole('alert').filter({ hasText: '暂时无法打开工作台' });
    await failure.waitFor();
    assert.equal(await failure.getAttribute('aria-busy'), 'false');
    assert.equal((await page.locator('body').innerText()).includes('STARTUP_PRIVATE_DETAIL_SENTINEL'), false);
    // The old generic toast timer erased this startup failure after 12 seconds.
    await page.waitForTimeout(13_000);
    assert.equal(await failure.isVisible(), true, 'Initial-load failure must remain visible until recovery');
    await page.screenshot({ path: join(screenshots, '105-startup-error.png') });
    const retry = page.getByRole('button', { name: '重新加载', exact: true });
    await retry.focus(); await Promise.all([page.waitForEvent('domcontentloaded'), page.keyboard.press('Enter')]);
    await failure.waitFor();
    assert.ok(await application.evaluateMain('globalThis.nookStartupRecovery.calls') >= 2, 'Keyboard retry must really load again');
    await application.resize(760, 540);
    await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540);
    assert.equal(await retry.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth; }), true);
    await page.screenshot({ path: join(screenshots, '105-startup-error-narrow.png') });
    await application.evaluateMain("globalThis.nookStartupRecovery.mode = 'hold'");
    await Promise.all([page.waitForEvent('domcontentloaded'), retry.click()]);
    const loading = page.getByRole('status').filter({ hasText: '正在打开你的工作台…' });
    await loading.waitFor();
    assert.equal(await loading.getAttribute('aria-busy'), 'true');
    assert.equal(await retry.count(), 0, 'Reloading must remove the stale failure and retry action');
    await application.evaluateMain("globalThis.nookStartupRecovery.mode = 'pass'; globalThis.nookStartupRecovery.release()");
    await page.getByLabel('消息', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    assert.equal(await failure.count(), 0);
  } finally {
    console.log('Startup recovery IPC sequence', JSON.stringify(await application.evaluateMain('globalThis.nookStartupRecovery.events')));
    await application.evaluateMain(`(() => {
      const ipc = require('electron').ipcMain;
      const fixture = globalThis.nookStartupRecovery;
      fixture.mode = 'pass'; fixture.release?.();
      ipc.removeHandler('qiyao:invoke'); ipc.handle('qiyao:invoke', fixture.original);
    })()`);
    await application.resize(1280, 840);
  }
}
