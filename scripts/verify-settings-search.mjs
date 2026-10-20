import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPluginFixture } from '../verification/plugin-fixture.mjs';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { settingsInteractionsBlocked } from './settings-interaction-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
export async function verifySettingsSearch({ page, application, directory, screenshots, verified, waitForBridge, modelRequests = () => 0 }) {
  let before = await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load())));
  const originalAtEntry = before; let ownedPluginId;
  if (!before.plugins.length) {
    const source = join(directory, 'settings-draft-plugin-' + randomUUID()); await createPluginFixture(source, '127.0.0.1');
    await application.evaluateMain(`globalThis.nookSettingsDraftPluginDialog=require('electron').dialog.showOpenDialog;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(source)}]});`);
    try { const next = await page.evaluate(() => window.qiyao.importPlugin()); assert.equal(next.plugins.length, 1); ownedPluginId = next.plugins[0].id; }
    finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookSettingsDraftPluginDialog;delete globalThis.nookSettingsDraftPluginDialog;"); }
    await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); before = await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load())));
  }
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
  for (const event of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Process' }]) {
    const active = await search().getAttribute('aria-activedescendant');
    await search().evaluate((element, event) => element.dispatchEvent(new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true })), event);
    assert.equal(await panel().getAttribute('aria-label'), '模型连接', 'IME confirmation must not navigate to a settings result');
    assert.equal(await search().getAttribute('aria-activedescendant'), active);
  }
  await search().press('Enter'); await assertFocus('主题');
  await page.keyboard.press('Control+f'); assert.equal(await search().evaluate(element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), true);
  await search().fill('<img src=x onerror=alert(1)>'); assert.equal(await results().getByRole('option').count(), 0); assert.equal(await settings().locator('.settings-sidebar').getByRole('status').textContent(), '没有匹配的设置');
  await clear(); assert.equal(await settings().locator('.settings-nav button').count(), 9);
  await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540);
  await search().fill('外观');
  const options = results().getByRole('option'), lastId = await options.last().getAttribute('id');
  assert.ok(await options.count() > 5);
  await options.first().hover(); await search().focus(); await search().press('End');
  await page.waitForFunction(id => document.querySelector('[aria-label="搜索设置"]')?.getAttribute('aria-activedescendant') === id, lastId);
  assert.ok(await results().evaluate(element => element.scrollTop > 0), 'Keyboard selection scrolls the result list');
  await options.first().dispatchEvent('mouseover', { bubbles: true });
  assert.equal(await search().getAttribute('aria-activedescendant'), lastId, 'A stationary pointer boundary event must not replace the keyboard selection');
  await options.first().hover();
  assert.equal(await search().getAttribute('aria-activedescendant'), await options.first().getAttribute('id'), 'Actual pointer movement still selects a result');
  await search().press('Enter'); assert.equal(await panel().getAttribute('aria-label'), '外观与交互');
  await clear(); await application.resize(...originalWindow.size); await page.waitForFunction(width => innerWidth === width, originalWindow.size[0]);
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
  await destination('唤起快捷键', '唤起快捷键，外观与交互'); const originalAccelerator = await panel().getByLabel('唤起快捷键', { exact: true }).inputValue(); await panel().getByLabel('唤起快捷键', { exact: true }).fill('Ctrl+Alt+F11');
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

  const confirmation = () => page.getByRole('dialog', { name: '放弃未保存的更改？', exact: true });
  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().waitFor();
  assert.equal(await settings().isVisible(), true); assert.equal(await confirmation().locator('.modal-header button').count(), 0);
  assert.equal(await confirmation().getByRole('button', { name: '继续编辑', exact: true }).evaluate(element => document.activeElement === element), true);
  await capture('discard-drafts'); await page.keyboard.press('Enter'); await confirmation().waitFor({ state: 'hidden' }); assert.equal(await settings().isVisible(), true);
  await destination('模型连接', '模型连接'); assert.equal(await panel().getByLabel('API 密钥', { exact: true }).inputValue(), 'SETTINGS_SEARCH_PRIVATE_DRAFT');
  const back = panel().getByRole('button', { name: '← 返回连接列表', exact: true }); await back.click(); await confirmation().waitFor();
  await capture('discard-provider'); await page.keyboard.press('Escape'); await confirmation().waitFor({ state: 'hidden' });
  assert.equal(await back.evaluate(element => document.activeElement === element), true); assert.equal(await panel().getByLabel('连接名称', { exact: true }).inputValue(), '未保存连接 中文😀');
  await back.click(); await confirmation().getByRole('button', { name: '放弃更改', exact: true }).click(); await panel().getByLabel('API 密钥', { exact: true }).waitFor({ state: 'hidden' });
  await destination('唤起快捷键', '唤起快捷键，外观与交互'); assert.equal(await panel().getByLabel('唤起快捷键', { exact: true }).inputValue(), 'Ctrl+Alt+F11'); await panel().getByLabel('唤起快捷键', { exact: true }).fill(originalAccelerator);
  await destination('记忆', '记忆'); assert.equal(await panel().getByLabel('记忆内容', { exact: true }).inputValue(), '未保存记忆 中文😀');
  await panel().getByRole('button', { name: '取消编辑', exact: true }).click(); await confirmation().waitFor(); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
  await panel().getByLabel('记忆内容', { exact: true }).fill(''); await panel().getByRole('button', { name: '取消编辑', exact: true }).click();
  await destination('工作树根目录', '工作树根目录，工作树'); const originalKeepCount = await panel().getByLabel('保留工作树数量', { exact: true }).inputValue();
  await root.fill('E:/保护未保存 根目录'); await panel().getByLabel('保留工作树数量', { exact: true }).fill('');
  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await root.inputValue(), 'E:/保护未保存 根目录'); assert.equal(await panel().getByLabel('保留工作树数量', { exact: true }).inputValue(), ''); await root.fill(originalRoot); await panel().getByLabel('保留工作树数量', { exact: true }).fill(originalKeepCount);
  await destination('唤起快捷键', '唤起快捷键，外观与交互'); await panel().getByLabel('唤起快捷键', { exact: true }).fill('');
  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await panel().getByLabel('唤起快捷键', { exact: true }).inputValue(), ''); await panel().getByLabel('唤起快捷键', { exact: true }).fill(originalAccelerator);
  await destination('添加服务器', '添加服务器，MCP 工具'); await panel().getByRole('button', { name: '添加服务器', exact: true }).click();
  await panel().getByLabel('连接方式', { exact: true }).selectOption('http'); await panel().getByLabel('服务器名称', { exact: true }).fill('未保存 MCP 中文😀'); await panel().getByLabel('访问令牌', { exact: true }).fill('SETTINGS_MCP_PRIVATE_DRAFT');
  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().waitFor(); await capture('discard-mcp'); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await panel().getByLabel('服务器名称', { exact: true }).inputValue(), '未保存 MCP 中文😀'); assert.equal(await panel().getByLabel('访问令牌', { exact: true }).inputValue(), 'SETTINGS_MCP_PRIVATE_DRAFT');
  const saveFailure = '保存服务器失败，请重试。';
  await application.evaluateMain(`(()=>{const handlers=require('electron').ipcMain._invokeHandlers,original=handlers.get('qiyao:invoke');let release;const held=new Promise(resolve=>{release=resolve;});globalThis.nookSettingsDraftSave={original,release,entered:false,calls:0};handlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='saveMcpServer'){globalThis.nookSettingsDraftSave.entered=true;globalThis.nookSettingsDraftSave.calls++;await held;throw new Error(${JSON.stringify(saveFailure)});}return original(event,method,...args);});})()`);
  try {
    await panel().getByRole('button', { name: '保存服务器', exact: true }).click();
    await application.evaluateMain("(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookSettingsDraftSave.entered){if(Date.now()>=deadline)throw new Error('The held MCP save was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()");
    assert.equal(await panel().evaluate(element => [...element.querySelectorAll('button,input,select,textarea')].every(control => control.disabled)), true);
    assert.equal(await settingsInteractionsBlocked(settings()), true); assert.equal(await settings().evaluate(element => element.closedBy), 'none');
    assert.equal(await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await settings().isVisible(), true); assert.equal(await confirmation().isVisible(), false);
    assert.equal(await application.evaluateMain('globalThis.nookSettingsDraftSave.calls'), 1);
    await application.evaluateMain('globalThis.nookSettingsDraftSave.release()'); await settings().getByRole('alert').waitFor();
    assert.equal(await settings().getByRole('alert').locator('.toast-message').textContent(), saveFailure);
    assert.equal(await panel().getByLabel('服务器名称', { exact: true }).inputValue(), '未保存 MCP 中文😀'); assert.equal(await panel().getByLabel('访问令牌', { exact: true }).inputValue(), 'SETTINGS_MCP_PRIVATE_DRAFT');
    assert.equal(await panel().getByRole('button', { name: '保存服务器', exact: true }).isDisabled(), false); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before);
    if (beforeBytes) assert.deepEqual(await readFile(join(directory, 'workspace.json')), beforeBytes);
    await settings().getByRole('button', { name: '关闭提示', exact: true }).click();
    await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().waitFor(); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
    assert.equal(await panel().getByLabel('访问令牌', { exact: true }).inputValue(), 'SETTINGS_MCP_PRIVATE_DRAFT');
  } finally { await application.evaluateMain("(()=>{const receipt=globalThis.nookSettingsDraftSave;require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',receipt.original);receipt.release();delete globalThis.nookSettingsDraftSave;})()"); }
  await panel().getByRole('button', { name: '← 返回服务器列表', exact: true }).click(); await confirmation().getByRole('button', { name: '放弃更改', exact: true }).click();
  await destination('本地插件', '本地插件'); const fixturePlugin = before.plugins[0];
  await panel().locator('.row-content').filter({ has: page.getByText(fixturePlugin.manifest.name, { exact: true }) }).first().click();
  await panel().getByText('启用插件', { exact: true }).click(); assert.equal(await panel().getByRole('switch', { name: '启用插件', exact: true }).isChecked(), !fixturePlugin.enabled);
  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().waitFor(); await capture('discard-plugin'); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await panel().getByRole('switch', { name: '启用插件', exact: true }).isChecked(), !fixturePlugin.enabled); await panel().getByText('启用插件', { exact: true }).click();
  await panel().getByRole('button', { name: '← 返回插件列表', exact: true }).click();
  assert.equal(await confirmation().isVisible(), false); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before);
  if (beforeBytes) assert.deepEqual(await readFile(join(directory, 'workspace.json')), beforeBytes);
  verified('dirty settings require explicit discard; default Enter and Escape retain edits and return focus, scoped discard preserves other drafts, reverting all forms permits direct close, and an injected held MCP save failure locks all settings while preserving exact drafts and workspace bytes');

  await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click();
  await settings().waitFor({ state: 'hidden' }); assert.equal(await confirmation().isVisible(), false);
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await waitForBridge(page, theme => document.documentElement.dataset.theme === theme, theme);
    await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await open();
    await search().fill('工作树'); await search().press('End'); assert.equal(await results().getByRole('option', { selected: true }).textContent(), '保留工作树数量工作树');
    const geometry = await settings().evaluate(dialog => { const box = dialog.getBoundingClientRect(), search = dialog.querySelector('.settings-search-control'), input = search.querySelector('input'), style = getComputedStyle(search), inputStyle = getComputedStyle(input), searchBox = search.getBoundingClientRect(), sidebar = dialog.querySelector('.settings-sidebar').getBoundingClientRect(), outline = parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset)); return { contained: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, sidebarOverflow: dialog.querySelector('.settings-sidebar').scrollWidth > dialog.querySelector('.settings-sidebar').clientWidth + 1, panelOverflow: dialog.querySelector('.settings-detail:not([hidden])').scrollWidth > dialog.querySelector('.settings-detail:not([hidden])').clientWidth + 1, search: { height: searchBox.height, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, gap: style.gap, radius: style.borderRadius, fontSize: inputStyle.fontSize, lineHeight: inputStyle.lineHeight, inputBorder: inputStyle.borderTopWidth, background: style.backgroundColor, focusOutline: style.outlineWidth, focusContained: searchBox.left - outline >= sidebar.left && searchBox.right + outline <= sidebar.right && searchBox.top - outline >= sidebar.top && searchBox.bottom + outline <= sidebar.bottom } }; });
    assert.equal(geometry.contained, true); assert.equal(geometry.sidebarOverflow, false); assert.equal(geometry.panelOverflow, false);
    assert.equal(await settings().getByRole('searchbox', { name: '搜索设置', exact: true }).evaluate(element => getComputedStyle(element).boxShadow), 'none', `${theme}/${zoom} search input has no redundant field outline`);
    assert.ok(Math.abs(geometry.search.height - 36) < 0.1, JSON.stringify(geometry.search));
    for (const [key, expected] of Object.entries({ paddingLeft: '12px', paddingRight: '12px', gap: '8px', radius: '999px', fontSize: '14px', lineHeight: '18px', inputBorder: '0px', focusContained: true })) assert.equal(geometry.search[key], expected, `${theme}/${zoom} settings search ${key}`);
    // Chromium snaps authored outline widths to complete device pixels at fractional zoom.
    assert.ok(Math.abs(parseFloat(geometry.search.focusOutline) - Math.floor(2 * zoom) / zoom) < 0.05, `${theme}/${zoom} settings search ${JSON.stringify(geometry.search)}`);
    await capture(`${theme}-${zoom}-results`); await destination('工作树根目录', '工作树根目录，工作树'); await assertFocus('工作树根目录'); await capture(`${theme}-${zoom}-target`);
    await search().fill('没有此设置 中文😀'); await capture(`${theme}-${zoom}-empty`); await clear();
    await destination('添加记忆', '添加记忆，记忆'); await panel().getByRole('button', { name: '添加记忆', exact: true }).click(); await panel().getByLabel('记忆内容', { exact: true }).fill('缩放下保留的草稿 中文😀');
    await settings().locator('.modal-header').getByRole('button', { name: '关闭', exact: true }).click(); await confirmation().waitFor();
    const discard = await confirmation().evaluate(dialog => { const box = dialog.getBoundingClientRect(), style = getComputedStyle(dialog), buttons = [...dialog.querySelectorAll('.modal-footer button')]; return { width: box.width, expectedWidth: Math.min(420, innerWidth * .92), radius: style.borderRadius, contained: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, heightBounded: box.height <= innerHeight * .92 + 1, buttonsVisible: buttons.length === 2 && buttons.every(button => { const bounds = button.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && button.offsetHeight >= 32 && parseFloat(getComputedStyle(button).minHeight) >= 32 && bounds.left >= box.left && bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom; }), defaultCancelFocus: document.activeElement === buttons[0], closeControls: dialog.querySelectorAll('.modal-header button').length }; });
    assert.ok(Math.abs(discard.width - discard.expectedWidth) < 1, JSON.stringify(discard));
    assert.equal(discard.radius, '16px'); for (const flag of ['contained', 'heightBounded', 'buttonsVisible', 'defaultCancelFocus']) assert.equal(discard[flag], true, `${theme}/${zoom} ${flag}`); assert.equal(discard.closeControls, 0);
    await capture(`${theme}-${zoom}-discard-confirm`); await confirmation().getByRole('button', { name: '继续编辑', exact: true }).click(); assert.equal(await panel().getByLabel('记忆内容', { exact: true }).inputValue(), '缩放下保留的草稿 中文😀'); await capture(`${theme}-${zoom}-discard-retained`);
    layouts.push({ theme, zoom, ...geometry, searchStyleVerified: true, discard }); await dismissModalWithEscape(page, settings());
  }
  verified('six native light and dark minimum-window zoom cases preserve bounded search results, empty states, target focus and independent scrolling');
  verified('compact unsaved-settings confirmations fit all six native theme and zoom cases, focus the safe action, hide the ordinary close control and retain exact memory drafts on cancellation');

  await application.resize(...originalWindow.size); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`);
  await page.evaluate(async preferences => { await window.qiyao.savePreferences(preferences); }, before.preferences); await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await open();
  assert.equal(await search().inputValue(), ''); assert.equal(await panel().getAttribute('aria-label'), '模型连接'); assert.equal(await panel().getByLabel('API 密钥', { exact: true }).count(), 0);
  await dismissModalWithEscape(page, settings()); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), before); assert.equal(modelRequests(), requestsBefore);
  verified('closing and reopening settings resets session-only searches and drafts while restoring original preferences without sending model requests');
  if (ownedPluginId) { await page.evaluate(id => window.qiyao.removePlugin(id), ownedPluginId); await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))), originalAtEntry); }
  return { page, result: { checks: 8, modelRequests: modelRequests() - requestsBefore, keyboardVerified: true, destinationFocusVerified: true, draftRetentionVerified: true, heldPickerVerified: true, sessionResetVerified: true, explicitDiscardVerified: true, discardKeyboardFocusVerified: true, scopedDiscardVerified: true, revertedDraftVerified: true, compactDiscardLayoutsVerified: true, allSettingsFormsVerified: true, protectedForms: ['models', 'desktop', 'worktrees', 'mcp', 'plugins', 'memories'], layouts, screenshots: captures, scope: 'Real renderer, preload and main bridge. Original six search checks retained with explicit dirty-form discard, plus two behavior and compact-layout groups covering all six draft forms. An owned disabled fixture plugin is imported only if no plugin exists and removed on successful cleanup. Native picker response is held and cancelled inside the isolated test process. Six actual shell theme/zoom cases; physical picker interaction and complete reference parity remain separate.' } };
}
