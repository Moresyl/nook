import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('qiyao://app/') && new URL(w.webContents.getURL()).searchParams.get('view') !== 'quick-chat')";

export async function verifyEditorTabs({ page, application, screenshots, projectId, root, waitForBridge }) {
  const captures = [], layouts = [];
  const selected = () => page.locator('.editor-tabs [aria-selected="true"]');
  const tab = path => page.getByRole('tab', { name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: 未保存)?$`) });
  const originalDrafts = await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId);
  async function capture(name) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const w=${mainWindow};return {png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()}})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, name), bytes); captures.push(name);
  }
  await page.getByRole('button', { name: '隐藏文件树', exact: true }).click();
  await application.resize(760, 540);
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1.5)`);
  await page.waitForFunction(() => Math.abs(innerWidth - 760 / 1.5) < 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const initial = await page.locator('.editor-tabs [aria-selected="true"]').evaluate(element => {
    const row = element.getBoundingClientRect(), viewport = element.closest('.editor-tabs').getBoundingClientRect();
    return { selectedVisible: row.left >= viewport.left - 1 && row.right <= viewport.right + 1, row: row.toJSON(), viewport: viewport.toJSON() };
  });
  console.log('Editor selected tab initial geometry', JSON.stringify(initial));
  await capture('editor-tabs-initial.png');
  assert.equal(initial.selectedVisible, true, 'The selected file tab must remain visible without clicking or focusing it after resize');
  await selected().focus();
  for (const [key, path] of [['Home', 'index.html'], ['ArrowLeft', 'data.json'], ['ArrowRight', 'index.html'], ['End', 'data.json'], ['ArrowLeft', 'app.js']]) {
    await selected().press(key);
    await page.waitForFunction(path => document.querySelector('.editor-tabs [aria-selected="true"]')?.getAttribute('aria-label') === `${path} 未保存`, path);
    assert.equal(await tab(path).evaluate(element => element === document.activeElement), true);
    const semantics = await tab(path).evaluate(element => ({ controls: element.getAttribute('aria-controls'), id: element.id, panel: document.getElementById(element.getAttribute('aria-controls'))?.getAttribute('aria-labelledby'), panelRole: document.getElementById(element.getAttribute('aria-controls'))?.getAttribute('role') }));
    assert.equal(semantics.panel, semantics.id); assert.equal(semantics.panelRole, 'tabpanel');
    assert.equal(await page.locator('.editor-tabs [role="tab"][tabindex="0"]').count(), 1);
  }
  await selected().press('Control+Home'); assert.equal(await selected().getAttribute('aria-label'), 'app.js 未保存');
  await selected().evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, isComposing: true })));
  assert.equal(await selected().getAttribute('aria-label'), 'app.js 未保存');
  await selected().press('Delete'); const modal = page.getByRole('dialog', { name: '保留文件改动？', exact: true }); await modal.waitFor();
  await capture('editor-tabs-close-cancel.png'); await modal.getByRole('button', { name: '取消', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  assert.equal(await tab('app.js').evaluate(element => element === document.activeElement), true);
  await selected().press('Home');
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
    await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await dismissModalWithEscape(page, settings);
    const size = theme === 'light' ? [1280, 840] : [760, 540]; await application.resize(...size);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction(width => Math.abs(innerWidth - width) < 2, size[0] / zoom);
    await page.waitForFunction(() => [...document.querySelectorAll('.primary-nav button, .sidebar-footer .nav-row')].every(element => getComputedStyle(element).color === getComputedStyle(document.body).color));
    const geometry = await page.evaluate(() => {
      const selected = document.querySelector('.editor-tabs [aria-selected="true"]'), row = selected.closest('.editor-tab').getBoundingClientRect(), viewport = selected.closest('.editor-tabs').getBoundingClientRect(), body = document.querySelector('.editor-body').getBoundingClientRect();
      const actions = [...document.querySelectorAll('.editor-actionbar > .button')].map(element => ({ name: element.getAttribute('aria-label'), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, visible: element.getBoundingClientRect().left >= 0 && element.getBoundingClientRect().right <= innerWidth && element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().bottom <= innerHeight }));
      return { selectedVisible: row.left >= viewport.left - 1 && row.right <= viewport.right + 1, overflow: document.documentElement.scrollWidth > innerWidth, compact: body.width <= 600, actions, body: body.toJSON(), viewport: viewport.toJSON() };
    });
    assert.equal(geometry.selectedVisible, true); assert.equal(geometry.overflow, false); assert.equal(geometry.actions.length, 3);
    for (const action of geometry.actions) { assert.equal(action.visible, true); if (geometry.compact) { assert.equal(action.width, 24); assert.equal(action.height, 24); } }
    layouts.push({ theme, zoom, ...geometry }); await capture(`editor-tabs-${theme}-${zoom * 100}.png`);
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  await page.getByRole('button', { name: '显示文件树', exact: true }).click();
  const tree = page.getByRole('tree', { name: '项目文件', exact: true });
  await tree.getByRole('treeitem', { name: 'notes.txt', exact: true }).click(); await tab('notes.txt').focus(); await tab('notes.txt').press('Delete');
  await tab('notes.txt').waitFor({ state: 'detached' }); assert.equal(await selected().evaluate(element => element === document.activeElement), true);
  await tree.getByRole('treeitem', { name: 'notes.txt', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.editor-actionbar .path-text')?.textContent === 'notes.txt' && document.querySelector('.editor-canvas .view-lines')?.textContent.includes('EDITOR_NOTES_ORIGINAL'));
  const input = page.locator('.editor-canvas textarea.inputarea'); await input.focus(); await input.press('ControlOrMeta+A'); const noteDraft = 'EDITOR_RETRY_中文😀';
  await input.evaluate((element, text) => { const data = new DataTransfer(); data.setData('text/plain', text); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, noteDraft);
  await waitForBridge(page, async ({ projectId, noteDraft }) => (await window.qiyao.load()).editorDrafts.some(item => item.projectId === projectId && item.path === 'notes.txt' && item.text === noteDraft), { projectId, noteDraft });
  const target = join(root, 'notes.txt').replaceAll('\\', '/').toLowerCase();
  await application.evaluateMain(`globalThis.nookEditorRename=require('node:fs/promises').rename;globalThis.nookEditorFailed=0;require('node:fs/promises').rename=async(from,to)=>{if(String(to).replaceAll(String.fromCharCode(92),'/').toLowerCase()===${JSON.stringify(target)}){globalThis.nookEditorFailed++;throw Object.assign(new Error('PRIVATE_EDITOR_RETRY_FAILURE'),{code:'EIO'});}return globalThis.nookEditorRename(from,to);};`);
  try {
    await tab('notes.txt').focus(); await tab('notes.txt').press('Delete'); await modal.waitFor(); await modal.getByRole('button', { name: '保存并关闭', exact: true }).click();
    await modal.getByRole('alert').waitFor(); assert.equal(await application.evaluateMain('globalThis.nookEditorFailed'), 1);
    assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'EDITOR_NOTES_ORIGINAL'); assert.equal(await modal.isVisible(), true); assert.equal(await tab('notes.txt').count(), 1);
    assert.ok(!(await modal.innerText()).includes('PRIVATE_EDITOR_RETRY_FAILURE'));
    await modal.getByRole('alert').getByText('项目文件未能保存，草稿已保留。请检查磁盘空间和文件夹权限，再重试。', { exact: true }).waitFor();
    await capture('editor-tabs-save-failure.png');
  } finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.nookEditorRename;delete globalThis.nookEditorRename;delete globalThis.nookEditorFailed"); }
  await modal.getByRole('button', { name: '关闭提示', exact: true }).click(); await modal.getByRole('button', { name: '保存并关闭', exact: true }).click();
  await modal.waitFor({ state: 'hidden' }); await tab('notes.txt').waitFor({ state: 'detached' }); assert.equal(await selected().evaluate(element => element === document.activeElement), true);
  assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), noteDraft);
  const finalDrafts = await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId);
  for (const original of originalDrafts) assert.deepEqual(finalDrafts.find(item => item.path === original.path), original);
  await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor(); await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption('light'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await dismissModalWithEscape(page, settings);
  console.log('Editor tab layouts', JSON.stringify(layouts));
  return { selectedVisibilityVerified: true, keyboardNavigationVerified: true, dirtyCancelVerified: true, cleanCloseFocusVerified: true, saveFailureRetryVerified: true, originalDraftsRetained: true, layouts, screenshots: captures };
}
