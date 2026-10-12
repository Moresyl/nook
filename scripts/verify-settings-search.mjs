import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { settingsInteractionsBlocked } from './settings-interaction-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
export async function verifySettingsSearch({ page, application, directory, screenshots, verified, waitForBridge, modelRequests = () => 0 }) {
  const before = await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load())));
  const beforeBytes = await readFile(join(directory, 'workspace.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const originalWindow = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const captures = [], layouts = [], requestsBefore = modelRequests();
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const search = () => settings().getByRole('searchbox', { name: '搜索设置', exact: true });
  const results = () => settings().getByRole('listbox', { name: '设置搜索结果', exact: true });
  const panel = () => settings().locator('.settings-detail:not([hidden])');
  async function open() { await page.keyboard.press('Control+,'); await settings().waitFor(); await search().waitFor(); }
  async function clear() { await search().focus(); await search().press('Escape'); assert.equal(await settings().isVisible(), true); assert.equal(await search().inputValue(), ''); }
  async function destination(query, label) { await search().fill(query); await results().getByRole('option', { name: label, exact: true }).click(); }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `settings-search-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function assertFocus(label) {
    assert.equal(await panel().getByLabel(label, { exact: true }).evaluate(element => document.activeElement === element), true);
    const layout = await panel().getByLabel(label, { exact: true }).evaluate(element => { const visual = element.matches('input[role="switch"]') ? element.nextElementSibling : element; const box = visual.getBoundingClientRect(), scope = element.closest('.settings-detail').getBoundingClientRect(), style = getComputedStyle(visual), edge = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)); return { contained: box.top - edge >= scope.top && box.bottom + edge <= scope.bottom && box.left - edge >= scope.left && box.right + edge <= scope.right, top: box.top, bottom: box.bottom, left: box.left, right: box.right, scopeTop: scope.top, scopeBottom: scope.bottom, scopeLeft: scope.left, scopeRight: scope.right }; });
    if (!layout.contained) await capture(`focus-failure-${captures.length}`);
    assert.equal(layout.contained, true, JSON.stringify({ label, ...layout }));
  }
  await open(); assert.equal(await search().evaluate(element => document.activeElement === element), true);
  assert.equal(await settingsInteractionsBlocked(settings()), false);
  assert.equal(await settings().locator('.settings-nav button').count(), 9);
  await search().fill('主题'); assert.equal(await search().getAttribute('aria-activedescendant'), null);
  await search().press('Enter'); assert.equal(await panel().getAttribute('aria-label'), '模型连接');
  await search().evaluate(element => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, isComposing: true })); });
  assert.equal(await search().getAttribute('aria-activedescendant'), null);
  await search().press('ArrowDown'); assert.equal(await results().getByRole('option', { selected: true }).count(), 1);
  await search().press('Enter'); await assertFocus('主题');
  await page.keyboard.press('Control+f'); assert.equal(await search().evaluate(element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), true);
  await search().fill('<img src=x onerror=alert(1)>'); assert.equal(await results().getByRole('option').count(), 0); assert.equal(await settings().locator('.settings-sidebar').getByRole('status').textContent(), '没有匹配的设置');
  await clear(); assert.equal(await settings().locator('.settings-nav button').count(), 9);
  verified('settings search preserves IME composition, starts without a selection, supports keyboard activation and Ctrl F, and clears empty results with Escape without closing');

  const targets = [['工作树根目录', '工作树根目录，工作树'], ['保留工作树数量', '保留工作树数量，工作树'], ['创建工作树前刷新上游', '创建工作树前刷新上游，工作树'], ['主题', '主题，外观与交互'], ['按 Enter 发送消息', '按 Enter 发送消息，外观与交互'], ['显示系统托盘', '显示系统托盘，外观与交互'], ['快捷键打开', '快捷键打开，外观与交互'], ['唤起快捷键', '唤起快捷键，外观与交互']];
  for (const [query, label] of targets) { await destination(query, label); await assertFocus(query); }
  for (const [query, label, button] of [['导出工作台', '导出工作台，数据与备份', '导出备份…'], ['恢复工作台', '恢复工作台，数据与备份', '恢复备份…'], ['导入技能', '导入技能，本地技能', '导入技能…'], ['导入插件', '导入插件，本地插件', '导入插件…'], ['添加记忆', '添加记忆，记忆', '添加记忆'], ['添加服务器', '添加服务器，MCP 工具', '添加服务器']]) { await destination(query, label); assert.equal(await panel().getByRole('button', { name: button, exact: true }).evaluate(element => document.activeElement === element), true); }
  for (const category of ['模型连接', 'MCP 工具', '本地技能', '本地插件', '记忆', '工作树', '外观与交互', '数据与备份', '关于 Nook']) { await destination(category, category); assert.equal(await panel().getAttribute('aria-label'), category); assert.equal(await panel().evaluate(element => document.activeElement === element), true); }
  verified('settings results route all nine categories and focus existing enabled fields or actions without executing them or changing persisted data');

  await clear(); await settings().getByRole('button', { name: '模型连接', exact: true }).click();
  const add = panel().getByRole('button', { name: '添加连接', exact: true });
  if (await add.count()) await add.click(); else await panel().getByRole('button', { name: '添加模型连接', exact: true }).click();
  await panel().getByLabel('连接名称', { exact: true }).fill('未保存连接 中文😀'); await panel().getByLabel('API 密钥', { exact: true }).fill('SETTINGS_SEARCH_PRIVATE_DRAFT'); await panel().getByLabel('模型', { exact: true }).fill('draft-model-1\ndraft-model-2');
  await destination('API 密钥', 'API 密钥，模型连接'); await assertFocus('API 密钥');
  await destination('唤起快捷键', '唤起快捷键，外观与交互'); await panel().getByLabel('唤起快捷键', { exact: true }).fill('Ctrl+Alt+F11');
  await destination('工作树根目录', '工作树根目录，工作树'); const root = panel().getByLabel('工作树根目录', { exact: true }); const originalRoot = await root.inputValue(); await root.fill('E:/未保存 工作树 😀');
  await destination('添加记忆', '添加记忆，记忆'); await panel().getByRole('button', { name: '添加记忆', exact: true }).click(); await panel().getByLabel('记忆内容', { exact: true }).fill('未保存记忆 中文😀');
  await destination('模型连接', '模型连接'); assert.equal(await panel().getByLabel('连接名称', { exact: true }).inputValue(), '未保存连接 中文😀'); assert.equal(await panel().getByLabel('API 密钥', { exact: true }).inputValue(), 'SETTINGS_SEARCH_PRIVATE_DRAFT'); assert.equal(await panel().getByLabel('模型', { exact: true }).inputValue(), 'draft-model-1\ndraft-model-2');
  await destination('唤起快捷键', '唤起快捷键，外观与交互'); assert.equal(await panel().getByLabel('唤起快捷键', { exact: true }).inputValue(), 'Ctrl+Alt+F11');
  await destination('工作树根目录', '工作树根目录，工作树'); assert.equal(await root.inputValue(), 'E:/未保存 工作树 😀'); await root.fill(originalRoot);
  await destination('记忆', '记忆'); assert.equal(await panel().getByLabel('记忆内容', { exact: true }).inputValue(), '未保存记忆 中文😀');
  assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before);
  if (beforeBytes) assert.deepEqual(await readFile(join(directory, 'workspace.json')), beforeBytes);
  verified('category and field navigation retain unsaved model names, password drafts, model lists, desktop shortcuts, worktree roots and memory forms while leaving persistent data unchanged');

  await destination('工作树根目录', '工作树根目录，工作树'); await clear();
  await application.evaluateMain(`(()=>{const dialog=require('electron').dialog;let release;const held=new Promise(resolve=>{release=resolve;});globalThis.nookSettingsSearchPicker={original:dialog.showOpenDialog,release,entered:false};dialog.showOpenDialog=async()=>{globalThis.nookSettingsSearchPicker.entered=true;await held;return {canceled:true,filePaths:[]};};})()`);
  try {
    await panel().getByRole('button', { name: '选择工作树文件夹', exact: true }).click();
    await application.evaluateMain(`(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookSettingsSearchPicker.entered){if(Date.now()>=deadline)throw new Error('Settings picker was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()`);
    assert.equal(await search().isDisabled(), true); assert.equal(await settings().locator('.settings-nav button').evaluateAll(buttons => buttons.length === 9 && buttons.every(button => button.disabled)), true);
    assert.equal(await settingsInteractionsBlocked(settings()), true);
    await page.keyboard.press('Escape'); assert.equal(await settings().isVisible(), true); assert.equal(await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
    await application.evaluateMain('globalThis.nookSettingsSearchPicker.release()'); await waitForBridge(page, () => { const search = document.querySelector('.settings-search-control input'); return Boolean(search && !search.disabled); });
  } finally { await application.evaluateMain("(()=>{const receipt=globalThis.nookSettingsSearchPicker;require('electron').dialog.showOpenDialog=receipt.original;receipt.release();delete globalThis.nookSettingsSearchPicker;})()"); }
  assert.equal(await root.inputValue(), originalRoot); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before);
  verified('held native picker disables settings search, navigation and dismissal, then restores controls after cancellation without modifying drafts or data');

  await dismissModalWithEscape(page, settings());
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await waitForBridge(page, theme => document.documentElement.dataset.theme === theme, theme);
    await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await open();
    await search().fill('工作树'); await search().press('End'); assert.equal(await results().getByRole('option', { selected: true }).textContent(), '保留工作树数量工作树');
    const geometry = await settings().evaluate(dialog => { const box = dialog.getBoundingClientRect(), search = dialog.querySelector('.settings-search-control'), input = search.querySelector('input'), style = getComputedStyle(search), inputStyle = getComputedStyle(input), searchBox = search.getBoundingClientRect(), sidebar = dialog.querySelector('.settings-sidebar').getBoundingClientRect(), outline = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)); return { contained: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, sidebarOverflow: dialog.querySelector('.settings-sidebar').scrollWidth > dialog.querySelector('.settings-sidebar').clientWidth + 1, panelOverflow: dialog.querySelector('.settings-detail:not([hidden])').scrollWidth > dialog.querySelector('.settings-detail:not([hidden])').clientWidth + 1, search: { height: searchBox.height, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, gap: style.gap, radius: style.borderRadius, fontSize: inputStyle.fontSize, lineHeight: inputStyle.lineHeight, inputBorder: inputStyle.borderTopWidth, background: style.backgroundColor, focusOutline: style.outlineWidth, focusContained: searchBox.left - outline >= sidebar.left && searchBox.right + outline <= sidebar.right && searchBox.top - outline >= sidebar.top && searchBox.bottom + outline <= sidebar.bottom } }; });
    assert.equal(geometry.contained, true); assert.equal(geometry.sidebarOverflow, false); assert.equal(geometry.panelOverflow, false);
    assert.ok(Math.abs(geometry.search.height - 36) < 0.1, JSON.stringify(geometry.search));
    for (const [key, expected] of Object.entries({ paddingLeft: '12px', paddingRight: '12px', gap: '8px', radius: '999px', fontSize: '14px', lineHeight: '18px', inputBorder: '0px', focusContained: true })) assert.equal(geometry.search[key], expected, `${theme}/${zoom} settings search ${key}`);
    // Chromium snaps authored outline widths to complete device pixels at fractional zoom.
    assert.ok(Math.abs(parseFloat(geometry.search.focusOutline) - Math.floor(2 * zoom) / zoom) < 0.05, `${theme}/${zoom} settings search ${JSON.stringify(geometry.search)}`);
    await capture(`${theme}-${zoom}-results`); await destination('工作树根目录', '工作树根目录，工作树'); await assertFocus('工作树根目录'); await capture(`${theme}-${zoom}-target`);
    await search().fill('没有此设置 中文😀'); await capture(`${theme}-${zoom}-empty`); layouts.push({ theme, zoom, ...geometry, searchStyleVerified: true }); await clear(); await dismissModalWithEscape(page, settings());
  }
  verified('six native light and dark minimum-window zoom cases preserve bounded search results, empty states, target focus and independent scrolling');

  await application.resize(...originalWindow.size); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`);
  await page.evaluate(async preferences => { await window.qiyao.savePreferences(preferences); }, before.preferences); await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await open();
  assert.equal(await search().inputValue(), ''); assert.equal(await panel().getAttribute('aria-label'), '模型连接'); assert.equal(await panel().getByLabel('API 密钥', { exact: true }).count(), 0);
  await dismissModalWithEscape(page, settings()); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before); assert.equal(modelRequests(), requestsBefore);
  verified('closing and reopening settings resets session-only searches and drafts while restoring original preferences without sending model requests');
  return { page, result: { checks: 6, modelRequests: modelRequests() - requestsBefore, keyboardVerified: true, destinationFocusVerified: true, draftRetentionVerified: true, heldPickerVerified: true, sessionResetVerified: true, layouts, screenshots: captures, scope: 'Real renderer, preload and main bridge. Native picker response is held and cancelled inside the isolated test process. Six actual shell theme/zoom cases; physical picker interaction and complete reference parity remain separate.' } };
}
