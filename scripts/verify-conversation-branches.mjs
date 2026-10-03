import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export async function verifyConversationBranches({ page, application, getApplication, endpoint, directory, screenshots, verified, waitForBridge, restart, modelRequests }) {
  const beforeRequests = modelRequests(); const rootId = randomUUID(); const childId = randomUUID(); const leafId = randomUUID(); const staleId = randomUUID(); const providerId = randomUUID();
  const messageId = randomUUID(); const attachment = { id: randomUUID(), name: '分支资料.txt', content: 'BRANCH_ATTACHMENT_EXACT' };
  const baseMessages = [{ id: messageId, role: 'user', content: 'BRANCH_ORIGINAL_QUESTION', createdAt: 1, status: 'complete', attachments: [attachment] }, { id: randomUUID(), role: 'assistant', content: 'BRANCH_ORIGINAL_REPLY <img> {{literal}} 中文😀', createdAt: 2, status: 'complete', attachments: [] }];
  const thread = (id, title, createdAt, parent, kind = 'branch') => ({ id, title, model: 'branch-model', providerId, pinned: false, archived: id === childId, createdAt, updatedAt: createdAt, messages: structuredClone(baseMessages), ...(parent ? { forkedFrom: { threadId: parent, messageId, kind } } : {}) });
  const threads = [thread(rootId, '栖曜分支根 <img> 中文😀', 1), thread(childId, '保留的编辑分支', 2, rootId, 'edit'), thread(leafId, '二层分支', 3, childId), thread(staleId, '待删除的回复版本', 4, rootId, 'reply'), ...Array.from({ length: 201 }, (_, index) => thread(randomUUID(), `分页分支 ${String(index).padStart(3, '0')}`, index + 5, rootId, 'message'))];
  threads[1].messages.at(-1).content = 'BRANCH_CHILD_CONTEXT_EXACT';
  const draft = (threadId, text) => ({ threadId, text, attachments: [attachment], providerId, model: 'branch-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() });
  await page.evaluate(async ({ providerId, endpoint }) => {
    await window.qiyao.saveProvider({ id: providerId, name: '分支导航验证', kind: 'openai', endpoint: new URL('/branches/v1', endpoint).href, models: ['branch-model'], hasKey: false }, '');
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
  }, { providerId, endpoint });
  page = await restart(async () => {
    const path = join(directory, 'workspace.json'); const state = JSON.parse(await readFile(path, 'utf8'));
    state.threads.push(...threads); state.composerDrafts.push(draft(rootId, 'ROOT_DRAFT_KEEP'), draft(childId, 'CHILD_DRAFT_KEEP')); state.activeThreadId = rootId;
    await writeFile(path, JSON.stringify(state));
  }); application = getApplication(); await application.resize(1280, 840);
  const composer = () => page.getByLabel('消息', { exact: true });
  const dialog = () => page.getByRole('dialog', { name: '对话分支', exact: true });
  const navigationError = () => dialog().locator('.modal-content').getByRole('alert');
  const selectRow = (id) => dialog().locator(`.branch-node[data-thread-id="${id}"]`);
  async function open() { await page.getByRole('button', { name: '查看对话分支', exact: true }).click(); await dialog().waitFor(); }
  async function choose(id) { await selectRow(id).click(); await dialog().getByRole('button', { name: '打开所选对话', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog.branch-navigation')); await waitForBridge(page, async (id) => (await window.qiyao.load()).activeThreadId === id, id); }
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";
  async function capture(name) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};const image=await window.capturePage();return {png:image.toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size); await writeFile(join(screenshots, name), bytes);
  }
  async function headerGeometry(expectedCount, zoom) {
    const controls = await page.locator('.header-actions button').evaluateAll((buttons) => buttons.map((button) => { const rect = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, withinWindow: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight }; }));
    assert.equal(controls.length, expectedCount); assert.ok(controls.every((control) => control.withinWindow), JSON.stringify({ zoom, controls }));
    assert.equal(await page.locator('.thread-title').getAttribute('title'), threads[1].title);
    assert.ok(await page.locator('.thread-title > span').evaluate((element) => element.getBoundingClientRect().width >= 16), 'The minimum-window header must retain visible title text alongside every action.');
    return controls;
  }
  assert.equal(await composer().inputValue(), 'ROOT_DRAFT_KEEP'); await open();
  assert.equal(await dialog().locator('.branch-node').count(), 200); assert.equal(await dialog().getByText('1–200 / 205', { exact: true }).count(), 1);
  assert.equal(await selectRow(rootId).getAttribute('aria-current'), 'page'); assert.equal(await selectRow(childId).getAttribute('aria-pressed'), 'false');
  assert.equal(await selectRow(leafId).locator('..').evaluate((element) => element.style.getPropertyValue('--branch-depth')), '2');
  await dialog().getByRole('button', { name: '下一页', exact: true }).click(); assert.equal(await dialog().locator('.branch-node').count(), 5); assert.equal(await dialog().getByText('201–205 / 205', { exact: true }).count(), 1);
  await dialog().getByRole('button', { name: '上一页', exact: true }).click(); await dialog().getByLabel('搜索对话分支', { exact: true }).fill('<img>'); assert.equal(await dialog().locator('.branch-node').count(), 1); assert.equal(await dialog().locator('img,iframe').count(), 0);
  await dialog().getByLabel('搜索对话分支', { exact: true }).fill(''); await selectRow(childId).click(); assert.equal(await dialog().getByRole('textbox', { name: /^最后一条消息预览/ }).inputValue(), 'BRANCH_CHILD_CONTEXT_EXACT'); await capture('106-branch-navigation-light.png');
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await composer().inputValue(), 'ROOT_DRAFT_KEEP'); assert.equal(modelRequests(), beforeRequests);
  verified('the actual branch dialog lists 205 connected paths in complete 200-entry pages, retains exact hierarchy and archived metadata, searches literal Unicode/markup text and previews without sending a model request');

  await composer().fill('ROOT_DRAFT_EDIT_BEFORE_BRANCH'); await open(); await choose(childId); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP');
  const selected = await page.evaluate(() => window.qiyao.load()); assert.deepEqual(selected.threads.find((item) => item.id === childId), threads[1]); assert.equal(selected.composerDrafts.find((item) => item.threadId === rootId).text, 'ROOT_DRAFT_EDIT_BEFORE_BRANCH'); assert.deepEqual(selected.composerDrafts.find((item) => item.threadId === rootId).attachments, [attachment]);
  await open(); await dialog().getByRole('button', { name: '打开原对话', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog.branch-navigation')); await waitForBridge(page, async (id) => (await window.qiyao.load()).activeThreadId === id, rootId); assert.equal(await composer().inputValue(), 'ROOT_DRAFT_EDIT_BEFORE_BRANCH'); assert.equal(modelRequests(), beforeRequests);
  verified('switching an archived branch and returning to its original preserves every exact message/context and each owner draft/attachment, including input entered before the debounce');

  await application.evaluateMain("globalThis.qiyaoBranchRename=require('node:fs/promises').rename; const rename=globalThis.qiyaoBranchRename; require('node:fs/promises').rename=async(...args)=>{if(String(args[1]).endsWith('workspace.json'))throw Object.assign(new Error('QIYAO_BRANCH_WRITE_FAILURE'),{code:'EIO'});return rename(...args);};");
  try {
    await composer().fill('ROOT_FAILED_SWITCH_DRAFT'); await open(); await selectRow(childId).click(); await dialog().getByRole('button', { name: '打开所选对话', exact: true }).click(); await navigationError().waitFor();
    assert.equal(await navigationError().evaluate((element) => { const rect = element.getBoundingClientRect(); const scroll = element.closest('.modal-content').getBoundingClientRect(); return rect.top >= scroll.top && rect.bottom <= scroll.bottom; }), true);
    assert.equal(await composer().inputValue(), 'ROOT_FAILED_SWITCH_DRAFT'); assert.equal((await page.evaluate(() => window.qiyao.load())).activeThreadId, rootId); assert.equal(modelRequests(), beforeRequests); await capture('107-branch-navigation-error-light.png');
  } finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.qiyaoBranchRename; delete globalThis.qiyaoBranchRename;"); }
  await dialog().getByRole('button', { name: '打开所选对话', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('dialog.branch-navigation')); await waitForBridge(page, async (id) => (await window.qiyao.load()).activeThreadId === id, childId); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP');
  const toast = page.getByRole('button', { name: '关闭提示', exact: true }); if (await toast.count()) await toast.click();
  verified('actual workspace EIO blocks branch navigation before draft loss, keeps the selected dialog and current input, sends no request and permits a successful retry with the same independent drafts');

  await application.resize(760, 540); const parentHeaderLayout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); parentHeaderLayout.push({ zoom, controls: await headerGeometry(8, zoom) });
    if (zoom === 1.5) await capture('110-branch-header-with-parent-light-zoom-150.png');
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);

  await open(); await selectRow(staleId).click(); await page.evaluate((id) => window.qiyao.deleteThread(id), staleId); await dialog().getByRole('button', { name: '打开所选对话', exact: true }).click(); await navigationError().waitFor();
  assert.equal(await selectRow(staleId).count(), 0); assert.equal(await dialog().getByRole('button', { name: '打开所选对话', exact: true }).isEnabled(), false); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP');
  await dialog().getByRole('button', { name: '取消', exact: true }).click(); await page.evaluate((id) => window.qiyao.deleteThread(id), rootId); await page.reload(); await composer().waitFor(); await open();
  assert.equal(await dialog().getByRole('button', { name: '打开原对话', exact: true }).count(), 0); assert.match(await selectRow(childId).textContent(), /原对话已删除/); assert.equal(await dialog().getByText('1–200 / 203', { exact: true }).count(), 1); assert.equal(modelRequests(), beforeRequests);
  await dialog().getByRole('button', { name: '取消', exact: true }).click();
  verified('actual selected-path deletion refreshes the graph and prevents stale navigation, while deletion of the original keeps all 203 surviving descendants/siblings and their complete context');

  const backupPath = join(directory, 'branch-history-backup.json.gz');
  await application.evaluateMain(`globalThis.qiyaoBranchSave=require('electron').dialog.showSaveDialog; require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backupPath)}});`);
  try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoBranchSave; delete globalThis.qiyaoBranchSave;"); }
  const backup = JSON.parse(gunzipSync(await readFile(backupPath)).toString('utf8')); const beforeRestore = await page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load()))); assert.deepEqual(backup.threads, beforeRestore.threads); assert.deepEqual(backup.composerDrafts, beforeRestore.composerDrafts);
  await page.evaluate((id) => window.qiyao.deleteThread(id), leafId);
  await application.evaluateMain(`globalThis.qiyaoBranchOpen=require('electron').dialog.showOpenDialog;globalThis.qiyaoBranchConfirm=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backupPath)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  let restored;
  try { restored = await page.evaluate(() => window.qiyao.importWorkspace()); } finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoBranchOpen;require('electron').dialog.showMessageBox=globalThis.qiyaoBranchConfirm;delete globalThis.qiyaoBranchOpen;delete globalThis.qiyaoBranchConfirm;"); }
  const restoredIds = (before, after) => { assert.equal(after.length, before.length); return new Map(before.map((item, index) => { assert.notEqual(after[index].id, item.id); return [item.id, after[index].id]; })); };
  const skillIds = restoredIds(backup.skills, restored.skills); const pluginIds = restoredIds(backup.plugins, restored.plugins);
  const expectedThreads = structuredClone(backup.threads); const expectedDrafts = structuredClone(backup.composerDrafts);
  for (const item of [...expectedThreads, ...expectedDrafts]) {
    if (item.skillIds) item.skillIds = item.skillIds.map((id) => { assert.ok(skillIds.has(id)); return skillIds.get(id); });
    if (item.pluginIds) item.pluginIds = item.pluginIds.map((id) => { assert.ok(pluginIds.has(id)); return pluginIds.get(id); });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(restored.threads)), expectedThreads); assert.deepEqual(JSON.parse(JSON.stringify(restored.composerDrafts)), expectedDrafts); page = await restart(); application = getApplication(); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP');
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540); const layout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    const headerControls = await headerGeometry(7, zoom);
    if (zoom === 1.5) await capture('109-branch-header-dark-zoom-150.png');
    await open(); await dialog().getByRole('textbox', { name: '搜索对话分支', exact: true }).focus(); await page.keyboard.press('Tab'); assert.equal(await selectRow(childId).evaluate((element) => element === document.activeElement), true);
    const bounds = await dialog().evaluate((element) => { const header = element.querySelector('.modal-header').getBoundingClientRect(); const footer = element.querySelector('.modal-footer').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, header: { top: header.top, bottom: header.bottom }, footer: { top: footer.top, bottom: footer.bottom }, overflow: document.documentElement.scrollWidth > innerWidth }; });
    assert.equal(bounds.overflow, false); assert.ok(bounds.header.top >= 0 && bounds.footer.bottom <= bounds.height); layout.push({ zoom, ...bounds, headerControls }); await capture(`108-branch-navigation-dark-zoom-${zoom * 100}.png`); await dialog().getByRole('button', { name: '取消', exact: true }).click();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); assert.equal(modelRequests(), beforeRequests);
  verified('real gzip backup replacement and normal restart retain every branch/owner draft, and native dark 760×540 layouts keep dialog controls and keyboard focus accessible at 100/125/150 percent zoom');
  const workspacePath = join(directory, 'workspace.json'); const validWorkspace = await readFile(workspacePath, 'utf8');
  page = await restart(async () => { const state = JSON.parse(validWorkspace); state.threads.push(structuredClone(state.threads.find((item) => item.id === childId))); await writeFile(workspacePath, JSON.stringify(state)); }); application = getApplication(); await application.resize(1280, 840);
  assert.equal(await page.evaluate(async (id) => (await window.qiyao.load()).threads.filter((item) => item.id === id).length, childId), 2);
  const ambiguousWorkspace = await readFile(workspacePath, 'utf8'); await open(); await navigationError().waitFor();
  assert.equal(await dialog().locator('.branch-node').count(), 0); assert.equal(await dialog().getByRole('button', { name: '打开所选对话', exact: true }).isEnabled(), false); await capture('111-branch-navigation-ambiguous-dark.png');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '查看对话分支', exact: true }).waitFor(); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP');
  assert.equal(await readFile(workspacePath, 'utf8'), ambiguousWorkspace); assert.equal(modelRequests(), beforeRequests);
  page = await restart(() => writeFile(workspacePath, validWorkspace)); application = getApplication(); await application.resize(1280, 840); await open();
  assert.equal(await dialog().getByText('1–200 / 203', { exact: true }).count(), 1); await dialog().getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await composer().inputValue(), 'CHILD_DRAFT_KEEP'); assert.equal(modelRequests(), beforeRequests);
  verified('actual schema-valid duplicate conversation IDs show a recoverable branch-dialog error without crashing, requesting a model or changing workspace bytes; restoring the complete valid file recovers all paths and the independent draft');
  return { page, result: { checks: 6, familyThreadsInitially: 205, survivingThreads: 203, pageSize: 200, ambiguousHistoryRecoveryVerified: true, modelRequests: 0, layout, parentHeaderLayout, screenshots: ['106-branch-navigation-light.png', '107-branch-navigation-error-light.png', ...[100, 125, 150].map((zoom) => `108-branch-navigation-dark-zoom-${zoom}.png`), '109-branch-header-dark-zoom-150.png', '110-branch-header-with-parent-light-zoom-150.png', '111-branch-navigation-ambiguous-dark.png'], scope: 'Complete graph navigation, literal preview/search, archived and missing-parent paths, independent contexts/drafts/attachments, actual filesystem failure/retry and selected-path deletion, gzip recovery/normal restart, exact ambiguous-history failure/recovery and dark minimum-window keyboard/zoom. Original-parent navigation remains available; all eight parent-present and seven parent-absent header controls stay within the window at each zoom. Picker responses are isolated fixtures; no physical system-picker acceptance is claimed.' } };
}
