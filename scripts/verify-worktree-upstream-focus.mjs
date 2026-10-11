import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

export async function observeWorktreeUpstreamFocus({ page, application, directory, waitForBridge }) {
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
  await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor(); await settings.getByRole('button', { name: '工作树', exact: true }).click();
  const control = settings.getByRole('switch', { name: '创建工作树前刷新上游', exact: true }); await control.locator('..').waitFor();
  const observations = [];
  async function record(stage) {
    const snapshot = await control.evaluate(element => {
      const active = document.activeElement, label = element.parentElement, content = label.closest('.settings-detail');
      const rect = target => { const box = target.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
      return { active: { tag: active?.tagName, role: active?.getAttribute('role'), label: active?.getAttribute('aria-label'), text: active?.textContent?.slice(0, 80) }, focused: active === element, checked: element.checked, disabled: element.disabled, input: rect(element), label: rect(label), scrollTop: content.scrollTop, loading: document.querySelector('.worktree-overview')?.getAttribute('aria-busy') };
    }); observations.push({ stage, ...snapshot }); console.log('Worktree upstream focus observation', JSON.stringify({ stage, ...snapshot }));
  }
  await record('before-focus'); await control.focus(); await record('programmatic-focus'); await page.keyboard.press('Tab'); await record('tab'); await page.keyboard.press('Shift+Tab'); await record('shift-tab');
  await waitForBridge(page, () => document.querySelector('.worktree-overview')?.getAttribute('aria-busy') === 'false');
  await control.locator('..').evaluate(element => element.scrollIntoView({ block: 'nearest' })); await control.focus(); await record('loaded-visible-focus'); await page.keyboard.press('Tab'); await record('loaded-visible-tab'); await page.keyboard.press('Shift+Tab'); await record('loaded-visible-shift-tab');
  await dismissModalWithEscape(page, settings);
  await application.evaluateMain("(()=>{const ipc=require('electron').ipcMain,original=ipc._invokeHandlers.get('qiyao:invoke');let release;const pending=new Promise(resolve=>{release=resolve;});globalThis.nookFocusRead={original,release,entered:false};ipc._invokeHandlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='gitWorktrees'){globalThis.nookFocusRead.entered=true;await pending;}return original(event,method,...args);});})()");
  try {
    await page.keyboard.press('Control+,'); await settings.waitFor(); await settings.getByRole('button', { name: '工作树', exact: true }).click(); await control.locator('..').waitFor();
    await application.evaluateMain('(async()=>{const deadline=Date.now()+4500;while(!globalThis.nookFocusRead.entered){if(Date.now()>=deadline)throw new Error("Focus read did not enter within five seconds");await new Promise(resolve=>setTimeout(resolve,25));}})()');
    assert.equal(await page.locator('.worktree-overview').getAttribute('aria-busy'), 'true'); await control.focus(); await record('held-list-focus'); await page.keyboard.press('Tab'); await record('held-list-tab');
    await application.evaluateMain('globalThis.nookFocusRead.release()'); await waitForBridge(page, () => document.querySelector('.worktree-overview')?.getAttribute('aria-busy') === 'false'); await record('list-arrived'); await page.keyboard.press('Shift+Tab'); await record('list-arrived-shift-tab');
    assert.equal(await control.evaluate(element => document.activeElement === element), false);
  } finally { await application.evaluateMain("(()=>{const receipt=globalThis.nookFocusRead;require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',receipt.original);receipt.release();delete globalThis.nookFocusRead;})()"); }
  const state = await page.evaluate(() => window.qiyao.load()); assert.equal(state.preferences.worktrees.upstreamRefresh, 'best-effort');
  await writeFile(join(directory, 'worktree-upstream-focus-observations.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), observations, scope: 'Read-only native focus observations on a copied failed profile. This is diagnostic evidence, not focused or complete feature acceptance.' }, null, 2));
}
