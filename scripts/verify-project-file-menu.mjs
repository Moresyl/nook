import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { projectTreeItem } from './project-tree-viewport.mjs';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

export async function verifyProjectFileMenu({ page, application, capture, select, projectId, root }) {
  const tree = () => page.getByRole('tree', { name: '项目文件', exact: true });
  const item = path => projectTreeItem(() => page, tree, path);
  const menu = () => page.getByRole('menu', { name: '文件操作', exact: true });
  const action = name => menu().getByRole('menuitem', { name, exact: true });
  const file = 'm-large/entry-0000.txt', next = 'm-large/entry-0001.txt';
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";
  const absoluteFile = await realpath(join(root, file)), absoluteFolder = await realpath(join(root, 'm-large'));
  const entryActionLayouts = [];
  async function open(path, keyboard = true) {
    if (keyboard) { await item(path).focus(); await page.keyboard.press('Shift+F10'); }
    else await item(path).click({ button: 'right' });
    await menu().waitFor();
  }
  async function focused(locator) { assert.equal(await locator.evaluate(element => element === document.activeElement), true); }
  async function waitForMain(expression) {
    const deadline = Date.now() + 5000;
    while (!await application.evaluateMain(expression)) {
      assert.ok(Date.now() < deadline, 'The held native path operation did not reach its checkpoint');
      await page.waitForTimeout(20);
    }
  }
  const geometry = [];
  await open('m-large', false); await focused(action('展开目录'));
  assert.equal(await page.locator('.editor-actionbar').count(), 0);
  await action('展开目录').click(); await menu().waitFor({ state: 'hidden' }); await item(file).waitFor();
  await open(file); await focused(action('打开文件'));
  await page.keyboard.press('End'); await focused(action('在此目录新建文件夹'));
  await page.keyboard.press('ArrowDown'); await focused(action('打开文件'));
  await page.keyboard.press('ArrowUp'); await focused(action('在此目录新建文件夹'));
  await page.keyboard.press('Home'); await focused(action('打开文件'));
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  assert.equal(await menu().isVisible(), true);
  await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' }); await focused(item(file));
  await item(file).press('ContextMenu'); await menu().waitFor(); await page.keyboard.press('Tab'); await menu().waitFor({ state: 'hidden' });
  await open(file); await action('在此目录新建文件').click();
  const dialog = page.getByRole('dialog', { name: '新建文件', exact: true }); await dialog.waitFor();
  assert.equal(await dialog.getByLabel('相对路径', { exact: true }).inputValue(), 'm-large/'); await dismissModalWithEscape(page, dialog);
  // Match the existing renderer clipboard fixture: no physical clipboard writes.
  await page.evaluate(() => {
    window.nookFileCopyDescriptor = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
    window.nookFileCopyMode = 'success'; window.nookFileCopyCalls = 0;
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: async text => {
      window.nookFileCopyCalls++; window.nookFileCopiedPath = text;
      if (window.nookFileCopyMode === 'reject') throw new Error('PRIVATE_FILE_COPY_ERROR');
      if (window.nookFileCopyMode === 'pending') await new Promise(resolve => { window.nookFileCopyResolve = resolve; });
    } });
  });
  await application.evaluateMain(`globalThis.nookFileRevealOriginal=require('electron').shell.showItemInFolder;globalThis.nookFileRevealCalls=[];globalThis.nookFileRevealFail=false;require('electron').shell.showItemInFolder=path=>{globalThis.nookFileRevealCalls.push(path);if(globalThis.nookFileRevealFail)throw new Error('PRIVATE_REVEAL_ERROR')};globalThis.nookFileInvoke=require('electron').ipcMain._invokeHandlers.get('qiyao:invoke');require('electron').ipcMain.removeHandler('qiyao:invoke');require('electron').ipcMain.handle('qiyao:invoke',async(event,command,...args)=>{const invoke=globalThis.nookFileInvoke;if(command==='projectEntryPath'&&globalThis.nookFilePathHold){globalThis.nookFilePathStarted=true;await new Promise(resolve=>{globalThis.nookFilePathRelease=resolve});const result=await invoke(event,command,...args);globalThis.nookFilePathCompleted=true;return result}return invoke(event,command,...args)});`);
  try {
    await open(file); await action('复制相对路径').press('Enter'); await menu().waitFor({ state: 'hidden' }); await focused(item(file));
    assert.equal(await page.evaluate(() => window.nookFileCopiedPath), file);
    await page.evaluate(() => { window.nookFileCopyMode = 'reject'; });
    await open(file); await action('复制相对路径').press('Enter');
    await menu().getByRole('alert').getByText('无法复制路径，请重试。', { exact: true }).waitFor(); await focused(action('复制相对路径'));
    assert.equal((await menu().innerText()).includes('PRIVATE_FILE_COPY_ERROR'), false);
    await page.evaluate(() => { window.nookFileCopyMode = 'success'; });
    await action('复制相对路径').press('Enter'); await menu().waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.nookFileCopyMode = 'pending'; window.nookFileCopyCalls = 0; });
    await open(file); await action('复制相对路径').click();
    await page.waitForFunction(() => Boolean(window.nookFileCopyResolve));
    assert.equal(await menu().locator('[role="menuitem"]:disabled').count(), 6);
    await page.keyboard.press('Escape'); assert.equal(await menu().isVisible(), true);
    await open(next, false); await focused(action('打开文件'));
    await page.evaluate(async () => { window.nookFileCopyResolve(); await new Promise(resolve => requestAnimationFrame(resolve)); });
    assert.equal(await menu().isVisible(), true); await focused(action('打开文件'));
    assert.equal(await page.evaluate(() => window.nookFileCopyCalls), 1);
    await page.keyboard.press('Escape'); await focused(item(next));
    await page.evaluate(() => { window.nookFileCopyMode = 'success'; });
    await open(file); await action('复制完整路径').press('Enter'); await menu().waitFor({ state: 'hidden' }); await focused(item(file));
    assert.equal(await page.evaluate(() => window.nookFileCopiedPath), absoluteFile);
    await open('m-large'); await action('复制完整路径').press('Enter'); await menu().waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.nookFileCopiedPath), absoluteFolder);
    await page.evaluate(() => { window.nookFileCopyMode = 'reject'; });
    await open(file); await action('复制完整路径').press('Enter'); await menu().getByRole('alert').waitFor(); await focused(action('复制完整路径'));
    await page.evaluate(() => { window.nookFileCopyMode = 'success'; }); await action('复制完整路径').press('Enter'); await menu().waitFor({ state: 'hidden' });
    await open('m-large'); await action('在文件资源管理器中显示').press('Enter'); await menu().waitFor({ state: 'hidden' });
    assert.equal(await application.evaluateMain('globalThis.nookFileRevealCalls.at(-1)'), absoluteFolder);
    for (const path of ['../outside', '.git/config', 'missing-file']) {
      const rejected = await page.evaluate(async ({ projectId, path }) => { try { await window.qiyao.projectEntryPath(projectId, path); return false; } catch { return true; } }, { projectId, path });
      assert.equal(rejected, true);
    }
    const invalidProject = await page.evaluate(async () => { try { await window.qiyao.projectEntryPath('unknown-project', 'file'); return false; } catch { return true; } });
    assert.equal(invalidProject, true);
    await application.evaluateMain('globalThis.nookFilePathHold=true;globalThis.nookFilePathStarted=false;globalThis.nookFilePathCompleted=false');
    await page.evaluate(() => { window.nookFileCopyCalls = 0; });
    await open(file); await action('复制完整路径').click();
    await waitForMain('globalThis.nookFilePathStarted');
    assert.equal(await menu().locator('[role="menuitem"]:disabled').count(), 6);
    await page.keyboard.press('Escape'); assert.equal(await menu().isVisible(), true);
    await open(next, false); await application.evaluateMain('globalThis.nookFilePathHold=false;globalThis.nookFilePathRelease()');
    await waitForMain('globalThis.nookFilePathCompleted');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.nookFileCopyCalls), 0, 'An unmounted menu never writes a late resolved absolute path');
    assert.equal(await menu().isVisible(), true); await focused(action('打开文件')); await page.keyboard.press('Escape');
    await application.resize(760, 540);
    for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
        await page.keyboard.press('Control+Shift+p');
        const palette = page.getByRole('dialog', { name: '搜索与命令', exact: true });
        await palette.getByRole('combobox').fill(theme === 'light' ? '>切换到浅色主题' : '>切换到深色主题');
        await page.keyboard.press('Enter'); await palette.waitFor({ state: 'hidden' });
      }
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
      await page.waitForFunction(zoom => Math.abs(innerWidth - 760 / zoom) <= 1, zoom);
      await open(file); await action('复制完整路径').press('Enter'); await menu().waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.nookFileCopiedPath), absoluteFile);
      await application.evaluateMain('globalThis.nookFileRevealFail=true');
      await open(file); await action('在文件资源管理器中显示').press('Enter');
      await menu().getByRole('alert').getByText('无法在文件资源管理器中显示，请刷新文件树后重试。', { exact: true }).waitFor();
      await focused(action('在文件资源管理器中显示')); assert.equal((await menu().innerText()).includes('PRIVATE_REVEAL_ERROR'), false);
      const measured = await menu().evaluate(element => {
        const rect = element.getBoundingClientRect(), alert = element.querySelector('[role="alert"]').getBoundingClientRect();
        return { actualTheme: document.documentElement.dataset.theme, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, chrome: document.querySelector('.window-chrome').getBoundingClientRect().bottom, errorContained: alert.top >= rect.top && alert.bottom <= rect.bottom };
      });
      assert.ok(measured.actualTheme === theme && measured.left >= 8 && measured.right <= measured.width - 7 && measured.top >= measured.chrome + 7 && measured.bottom <= measured.height - 7 && measured.errorContained, JSON.stringify(measured));
      const screenshot = `121-project-file-path-actions-${theme}-${zoom * 100}.png`; await capture(screenshot);
      await application.evaluateMain('globalThis.nookFileRevealFail=false');
      await action('在文件资源管理器中显示').press('Enter'); await menu().waitFor({ state: 'hidden' }); await focused(item(file));
      assert.equal(await application.evaluateMain('globalThis.nookFileRevealCalls.at(-1)'), absoluteFile);
      entryActionLayouts.push({ theme, zoom, ...measured, absolutePathCopied: true, revealRetried: true, screenshot });
    }
  } finally {
    await application.evaluateMain(`globalThis.nookFilePathRelease?.();require('electron').shell.showItemInFolder=globalThis.nookFileRevealOriginal;require('electron').ipcMain.removeHandler('qiyao:invoke');require('electron').ipcMain.handle('qiyao:invoke',globalThis.nookFileInvoke);for(const key of ['nookFileRevealOriginal','nookFileRevealCalls','nookFileRevealFail','nookFileInvoke','nookFilePathHold','nookFilePathStarted','nookFilePathCompleted','nookFilePathRelease'])delete globalThis[key]`);
    await page.evaluate(() => {
      window.nookFileCopyResolve?.();
      if (window.nookFileCopyDescriptor) Object.defineProperty(navigator.clipboard, 'writeText', window.nookFileCopyDescriptor);
      else delete navigator.clipboard.writeText;
      for (const key of ['nookFileCopyDescriptor', 'nookFileCopyMode', 'nookFileCopyCalls', 'nookFileCopiedPath', 'nookFileCopyResolve']) delete window[key];
    });
    const palette = page.getByRole('dialog', { name: '搜索与命令', exact: true });
    if (await palette.isVisible()) await dismissModalWithEscape(page, palette);
  }
  await open(file); await tree().evaluate(element => { element.scrollTop += 300; });
  await menu().waitFor({ state: 'hidden' });
  assert.ok(await tree().evaluate(element => element.scrollTop) > 200, 'Scroll dismissal does not focus and reveal the old anchor');
  await application.resize(760, 540);
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction(zoom => Math.abs(innerWidth - 760 / zoom) <= 1, zoom);
    await open(file);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    assert.equal(await menu().isVisible(), true, 'A queued resize notification with unchanged dimensions does not dismiss a newly opened menu');
    const measured = await menu().evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, chrome: document.querySelector('.window-chrome').getBoundingClientRect().bottom }; });
    assert.ok(measured.left >= 8 && measured.right <= measured.width - 7 && measured.top >= measured.chrome + 7 && measured.bottom <= measured.height - 7, JSON.stringify(measured));
    geometry.push({ zoom, ...measured });
    if (zoom === 1.5) await capture('119-project-file-menu-dark.png');
    await page.keyboard.press('Escape'); await focused(item(file));
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  await open(file); await page.getByPlaceholder('查找文件路径…').click(); await menu().waitFor({ state: 'hidden' });
  await open(file); await action('打开文件').click(); await menu().waitFor({ state: 'hidden' });
  await page.locator('.editor-actionbar .path-text').getByText(file, { exact: true }).waitFor();
  await page.locator('.monaco-editor .view-lines').getByText('LARGE_TREE', { exact: true }).waitFor();
  await open('m-large'); await action('收起目录').click(); await menu().waitFor({ state: 'hidden' });
  assert.equal(await item('m-large').getAttribute('aria-expanded'), 'false');
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await page.reload(); await select(); await open('m-large', false); await action('展开目录').click(); await item(file).waitFor();
  await open(file); await focused(action('打开文件')); await capture('120-project-file-menu-light.png');
  await application.resize(1000, 720); await menu().waitFor({ state: 'hidden' }); await focused(item(file));
  return { pointerAndKeyboard: true, rovingFocus: true, compositionEscape: true, outsideAndScrollDismissal: true, unchangedResizeRetainsMenu: true, changedResizeDismissesMenu: true, themes: ['light', 'dark'], openAndDirectoryToggle: true, newFileParent: true, copyFailureRetry: true, lateCopyIsolation: true, absolutePathCopy: true, absolutePathFailureRetry: true, latePathIsolation: true, revealDispatch: true, revealFailureRetry: true, invalidPathRejected: true, entryActionLayouts, geometry, clipboardScope: 'Renderer writeText fixture verifies exact relative/absolute paths, errors and pending writes; physical clipboard unchanged and not verified.', revealScope: 'Actual main-process path validation dispatches to an intercepted Electron shell.showItemInFolder; physical Explorer selection is a separate check.' };
}
