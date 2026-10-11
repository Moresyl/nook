import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { documentBytes } from '../verification/attachment-fixtures.mjs';

export async function verifyQuickChat({ page, application, getApplication, directory, screenshots, endpoint, calls, errors, verified, waitForBridge, restart }) {
  const initialCalls = calls.length, layout = [], minimumLayout = [], captures = [], bytes = documentBytes('pdf', { outline: true, annotations: true });
  const retainedMainDraft = `MAIN_QUICK_CHAT_RETAINED ${randomUUID()}`;
  const originalSha256 = createHash('sha256').update(bytes).digest('hex'), file = join(directory, 'quick-chat.pdf'); await writeFile(file, bytes);
  const preferences = await page.evaluate(async () => (await window.qiyao.load()).preferences);
  await page.evaluate(async ({ endpoint, directory }) => {
    await window.qiyao.saveProvider({ id: 'quick-native', name: 'Quick native fixture', kind: 'openai', endpoint, models: ['verification-model'], hasKey: false }, 'local-verification-key');
    await window.qiyao.saveProject({ id: 'quick-project', name: 'Quick native project', path: `${directory}/project-fixture`, instructions: 'Quick native scope', createdAt: 1 });
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, defaultProviderId: 'quick-native', defaultModel: 'verification-model', theme: 'light' });
  }, { endpoint, directory });
  await page.reload(); await page.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await page.getByRole('button', { name: /^新聊天\s*Ctrl/ }).click();
  await page.getByLabel('模型提供商', { exact: true }).selectOption('quick-native');
  await page.getByLabel('选择模型', { exact: true }).selectOption('verification-model');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(retainedMainDraft);
  await waitForBridge(page, async text => (await window.qiyao.load()).composerDrafts.some(draft => !draft.threadId && draft.text === text && draft.providerId === 'quick-native' && draft.model === 'verification-model'), retainedMainDraft);
  const mainDrafts = await page.evaluate(async () => (await window.qiyao.load()).composerDrafts);
  async function open() {
    await page.getByRole('button', { name: '快速聊天', exact: true }).click();
    const deadline = Date.now() + 10_000; let quick;
    while (Date.now() < deadline) {
      quick = page.context().pages().find(candidate => !candidate.isClosed() && new URL(candidate.url()).searchParams.get('view') === 'quick-chat');
      if (quick) break; await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(quick, 'The independent quick-chat page must appear within the bridge deadline.');
    quick.setDefaultTimeout(5000); quick.setDefaultNavigationTimeout(5000); quick.on('pageerror', error => errors.push(error.message));
    await quick.getByRole('textbox', { name: '消息', exact: true }).waitFor(); return quick;
  }
  let quick = await open();
  async function capture(filename) {
    await quick.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain("(async()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()");
    const png = Buffer.from(image.png, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, filename), png); captures.push({ filename, size: image.size });
  }
  assert.equal(await quick.evaluate(() => window.qiyao), undefined);
  const isolation = await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat'); const prefs=window.webContents.getLastWebPreferences(); return {sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,pinned:window.isAlwaysOnTop()};})()");
  assert.equal(isolation.sandbox, true); assert.equal(isolation.contextIsolation, true); assert.equal(isolation.nodeIntegration, false); assert.equal(isolation.pinned, true);
  assert.deepEqual(await quick.evaluate(() => Object.keys(window.nookQuick).sort()), ['load', 'save', 'send', 'stop', 'activate', 'openWorkspace', 'windowAction', 'attachFiles', 'importAttachments', 'readDocumentOriginal', 'exportDocumentOriginal', 'openExternal', 'pendingApprovals', 'resolveApproval', 'onBeforeClose', 'onRun', 'onRefresh'].sort());
  verified('quick chat opens a separate sandbox and restricted preload without the full workspace bridge');

  const input = () => quick.getByRole('textbox', { name: '消息', exact: true });
  await quick.getByRole('button', { name: '新的快速聊天', exact: true }).click();
  await waitForBridge(quick, async () => !(await window.nookQuick.load()).draft.threadId);
  await verifyMinimumLayout('empty');
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await quick.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await application.evaluateMain("globalThis.nookRefreshIpc=require('electron').ipcMain;globalThis.nookRefreshInvoke=globalThis.nookRefreshIpc._invokeHandlers.get('nook:quick-chat');globalThis.nookRefreshTrace=[];globalThis.nookRefreshHold=true;globalThis.nookRefreshHeld=false;globalThis.nookRefreshIpc.removeHandler('nook:quick-chat');globalThis.nookRefreshIpc.handle('nook:quick-chat',async(event,command,...args)=>{const result=await globalThis.nookRefreshInvoke(event,command,...args);if(command==='load')globalThis.nookRefreshTrace.push({event:'captured',theme:result.context.preferences.theme,at:Date.now()});if(command==='load'&&globalThis.nookRefreshHold){globalThis.nookRefreshHold=false;globalThis.nookRefreshHeld=true;await new Promise(resolve=>{globalThis.nookRefreshRelease=resolve;});}if(command==='load')globalThis.nookRefreshTrace.push({event:'returned',theme:result.context.preferences.theme,at:Date.now()});return result;});");
  try {
    await quick.evaluate(() => window.dispatchEvent(new Event('focus')));
    const deadline = Date.now() + 5000;
    while (!await application.evaluateMain('globalThis.nookRefreshHeld')) { assert.ok(Date.now() < deadline, 'The old quick snapshot must be held within the operation deadline.'); await new Promise(resolve => setTimeout(resolve, 25)); }
    await input().fill('QUICK_REFRESH_DRAFT_RETAINED');
    await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); });
    await quick.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await application.evaluateMain('globalThis.nookRefreshRelease();');
    await quick.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await quick.evaluate(() => document.documentElement.dataset.theme), 'dark'); assert.equal(await input().inputValue(), 'QUICK_REFRESH_DRAFT_RETAINED');
    assert.equal(calls.length, initialCalls); assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).composerDrafts), mainDrafts);
    if (process.env.NOOK_TEST_QUICK_REFRESH_DIAGNOSTICS) console.log('Quick refresh success trace', JSON.stringify(await application.evaluateMain('globalThis.nookRefreshTrace')));
  } catch (error) {
    if (process.env.NOOK_TEST_QUICK_REFRESH_DIAGNOSTICS) console.log('Quick refresh failure trace', JSON.stringify({ trace: await application.evaluateMain('globalThis.nookRefreshTrace'), renderer: await quick.evaluate(() => ({ theme: document.documentElement.dataset.theme, focused: document.hasFocus(), status: document.querySelector('[role=status]')?.textContent })) }));
    throw error;
  } finally {
    await application.evaluateMain("globalThis.nookRefreshRelease?.();globalThis.nookRefreshIpc.removeHandler('nook:quick-chat');globalThis.nookRefreshIpc.handle('nook:quick-chat',globalThis.nookRefreshInvoke);delete globalThis.nookRefreshIpc;delete globalThis.nookRefreshInvoke;delete globalThis.nookRefreshHold;delete globalThis.nookRefreshHeld;delete globalThis.nookRefreshRelease;delete globalThis.nookRefreshTrace;");
  }
  await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.webContents.setZoomFactor(1);window.setSize(640,580);})()");
  await input().fill('QUICK_PDF_READ');
  await application.evaluateMain(`globalThis.nookQuickOpen=require('electron').dialog.showOpenDialog;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(file)}]});`);
  try { await quick.getByRole('button', { name: '添加附件', exact: true }).click(); }
  finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookQuickOpen;delete globalThis.nookQuickOpen;"); }
  await waitForBridge(quick, async () => (await window.nookQuick.load()).draft.attachments.length === 1);
  const attached = await quick.evaluate(() => window.nookQuick.load()); assert.equal(attached.draft.text, 'QUICK_PDF_READ'); assert.equal(attached.draft.attachments[0].original.sha256, originalSha256);
  assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).composerDrafts), mainDrafts); assert.equal(calls.length, initialCalls);
  await input().fill(`QUICK_PDF_READ\n${'长输入与附件仍需保留全部操作。\n'.repeat(32)}`);
  await quick.getByLabel('选择项目', { exact: true }).selectOption('quick-project');
  await quick.getByLabel('工作模式', { exact: true }).selectOption('agent');
  await verifyMinimumLayout('attachment-long-input');
  assert.ok((await input().inputValue()).includes('长输入与附件')); assert.equal((await quick.evaluate(() => window.nookQuick.load())).draft.attachments[0].original.sha256, originalSha256);
  await quick.getByLabel('工作模式', { exact: true }).selectOption('chat'); await quick.getByLabel('选择项目', { exact: true }).selectOption(''); await input().fill('QUICK_PDF_READ');
  await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.webContents.setZoomFactor(1);window.setSize(640,580);})()");
  await quick.getByRole('button', { name: '预览 quick-chat.pdf', exact: true }).click();
  await quick.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Document evidence'));
  await quick.getByRole('button', { name: '下一页', exact: true }).click(); await quick.waitForFunction(() => document.querySelector('.textLayer')?.textContent.includes('Budget 42'));
  await capture('quick-chat-pdf.png'); await quick.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  verified('quick-chat drafts and the actual PDF worker/viewer preserve exact originals while retaining every main-window draft and making no model request');

  await quick.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForBridge(quick, async () => (await window.nookQuick.load()).thread?.messages.at(-1).status === 'complete');
  const sent = await quick.evaluate(() => window.nookQuick.load()), threadId = sent.thread.id;
  assert.equal(sent.draft.text, ''); assert.equal(sent.draft.attachments.length, 0); assert.equal(calls.length, initialCalls + 1);
  const request = JSON.stringify(calls.at(-1)); assert.ok(request.includes('QUICK_PDF_READ') && request.includes('Budget 42')); assert.ok(!request.includes(bytes.toString('base64')) && !request.includes(originalSha256));
  await quick.locator('.assistant-prose').getByText('真实流式回复', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).composerDrafts), mainDrafts);
  verified('quick-chat send consumes only its acknowledged draft, renders the real HTTP stream and sends extracted PDF text without original bytes');

  await input().fill('slow QUICK_STOP'); await quick.getByRole('button', { name: '发送消息', exact: true }).click();
  try { await quick.getByText('First partial response', { exact: true }).waitFor(); }
  catch (error) {
    console.error('Quick-chat stream observation', await quick.evaluate(async () => ({ body: document.body.innerText, messages: (await window.nookQuick.load()).thread?.messages, hidden: document.querySelector('.quick-chat-body')?.hidden })).catch(() => 'The quick-chat page is unavailable.'));
    await quick.screenshot({ path: join(screenshots, 'quick-chat-stream-failure.png') }).catch(() => {});
    throw error;
  }
  await quick.getByRole('button', { name: '停止生成', exact: true }).click();
  await waitForBridge(quick, async () => (await window.nookQuick.load()).thread.messages.at(-1).status === 'stopped');
  const other = await page.evaluate(() => window.qiyao.submit({ providerId: 'quick-native', model: 'verification-model', projectId: 'quick-project', mode: 'agent', text: '停止 MAIN_QUICK_SCOPE', attachments: [] }));
  await waitForBridge(page, async id => (await window.qiyao.pendingApprovals()).some(request => request.threadId === id), other.threadId);
  await quick.getByRole('button', { name: '新的快速聊天', exact: true }).click(); await quick.getByLabel('选择项目', { exact: true }).selectOption('quick-project'); await quick.getByLabel('工作模式', { exact: true }).selectOption('agent');
  await input().fill('停止 QUICK_APPROVAL_SCOPE'); await quick.getByRole('button', { name: '发送消息', exact: true }).click(); const ownApprovalWaitStarted = Date.now();
  try { await quick.getByRole('dialog', { name: '审批新建文件', exact: true }).waitFor(); }
  catch (error) {
    console.error('Quick-chat own approval timeout observation', JSON.stringify({ elapsedMs: Date.now() - ownApprovalWaitStarted, context: await quick.evaluate(async () => { const context = await window.nookQuick.load(); return { threadId: context.thread?.id, title: context.thread?.title, lastMessage: context.thread?.messages.at(-1), approvals: await window.nookQuick.pendingApprovals(), alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent), dialogs: [...document.querySelectorAll('dialog[open]')].map(element => element.getAttribute('aria-label') || element.textContent.slice(0, 240)) }; }).catch(() => 'The quick-chat page is unavailable.') }));
    await quick.screenshot({ path: join(screenshots, 'quick-chat-own-approval-timeout.png') }).catch(() => {});
    throw error;
  }
  const pending = await quick.evaluate(() => window.nookQuick.pendingApprovals()), all = await page.evaluate(() => window.qiyao.pendingApprovals());
  assert.equal(pending.length, 1); assert.equal(all.length, 2); const foreign = all.find(request => request.threadId === other.threadId); assert.ok(foreign);
  assert.equal(await quick.evaluate(async id => { try { await window.nookQuick.resolveApproval(id, false); return false; } catch { return true; } }, foreign.id), true);
  await quick.getByRole('dialog').getByRole('button', { name: '停止任务', exact: true }).click();
  await waitForBridge(quick, async () => (await window.nookQuick.load()).thread.messages.at(-1).status === 'stopped');
  assert.ok((await page.evaluate(() => window.qiyao.pendingApprovals())).some(request => request.id === foreign.id)); await page.evaluate(id => window.qiyao.stop(id), other.threadId);
  await quick.getByLabel('快速聊天会话', { exact: true }).selectOption(threadId);
  verified('quick-chat stop retains partial text and resolves only its own real approval while leaving the other main-window run pending');

  await input().fill('QUICK_HANDOFF_UNSENT'); await quick.getByRole('button', { name: '在工作台中打开', exact: true }).click();
  await waitForBridge(page, async id => (await window.qiyao.load()).activeThreadId === id, threadId);
  await page.locator('.transcript').getByText('QUICK_PDF_READ', { exact: true }).waitFor(); assert.equal(await input().inputValue(), 'QUICK_HANDOFF_UNSENT');
  assert.ok(await page.evaluate(async text => (await window.qiyao.load()).composerDrafts.some(draft => !draft.threadId && draft.text === text), retainedMainDraft));
  verified('handoff opens the same saved conversation in the main workbench without consuming quick input or replacing the main new-chat draft');

  await verifyMinimumLayout('conversation');
  async function verifyMinimumLayout(state) { for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await quick.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await application.evaluateMain(`(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.setSize(420,360);window.webContents.setZoomFactor(${zoom});})()`);
    for (const label of ['添加附件', '选择助手', '选择项目', ...(state === 'attachment-long-input' ? ['工作模式'] : [])]) {
      const control = quick.getByLabel(label, { exact: true }); await control.focus();
      assert.equal(await control.evaluate(element => { const bounds = element.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); return Boolean(hit && (hit === element || element.contains(hit))); }), true, `${label} must remain reachable by keyboard in the minimum window.`);
    }
    await input().focus();
    await capture(`quick-chat-minimum-${state}-${theme}-${zoom}.png`);
    const controls = await visibleControls();
    const overflow = await quick.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    assert.equal(overflow, false); assert.ok(controls.length >= 5 && controls.every(control => control.visible), `Minimum native window controls must remain usable: ${JSON.stringify({ state, theme, zoom, controls })}`);
    minimumLayout.push({ state, theme, zoom, nativeSize: [420, 360], controlsVisible: true, overflow: false, toolsKeyboardVerified: true });
  } }
  async function visibleControls() {
    return quick.evaluate(() => [...document.querySelectorAll('.quick-chat-conversation select, .quick-chat-composer textarea, .quick-chat-composer .send-button, .quick-chat-composer .model-selectors select')].map(element => {
      const bounds = element.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { label: element.getAttribute('aria-label'), visible: bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1 && Boolean(hit && (hit === element || element.contains(hit))) };
    }));
  }
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await quick.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await application.evaluateMain(`(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.setSize(420,580);window.webContents.setZoomFactor(${zoom});})()`);
    const send = quick.getByRole('button', { name: '发送消息', exact: true }), hide = quick.getByRole('button', { name: '隐藏快速聊天', exact: true }); await hide.focus();
    const bounds = await send.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0);
    const viewport = await quick.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight }));
    assert.equal(viewport.overflow, false); assert.ok(bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1);
    assert.equal(await hide.evaluate(element => getComputedStyle(element).opacity), '1');
    await capture(`quick-chat-${theme}-${zoom}.png`); layout.push({ theme, zoom, overflow: false, controlsVisible: true });
  }
  await quick.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await quick.getByRole('button', { name: '隐藏快速聊天', exact: true }).evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  verified('quick chat fits both 420 by 360 and 420 by 580 native windows in both themes at 100, 125 and 150 percent zoom with keyboard-visible controls and reduced motion');

  await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.webContents.setZoomFactor(1);window.setSize(640,580);})()");
  await quick.getByRole('button', { name: '取消窗口置顶', exact: true }).click(); await quick.getByRole('button', { name: '窗口置顶', exact: true }).waitFor();
  await quick.getByRole('button', { name: '收起快速聊天', exact: true }).click(); await quick.getByRole('button', { name: '展开快速聊天', exact: true }).waitFor();
  assert.equal(await input().isVisible(), false); await capture('quick-chat-collapsed.png');
  await quick.getByRole('button', { name: '展开快速聊天', exact: true }).click(); assert.equal(await input().inputValue(), 'QUICK_HANDOFF_UNSENT');
  await quick.keyboard.press('Escape');
  const hiddenDeadline = Date.now() + 5000; let hidden = false;
  while (Date.now() < hiddenDeadline) {
    hidden = await application.evaluateMain("!require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat').isVisible()");
    if (hidden) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(hidden, true, 'Escape must save and hide quick chat within the operation deadline.');
  const accelerator = await application.evaluateMain("(()=>{const shortcut=require('electron').globalShortcut;for(const key of ['Ctrl+Alt+Shift+F12','Ctrl+Alt+Shift+F11','Ctrl+Alt+Shift+F10','Ctrl+Alt+Shift+F9']){if(shortcut.isRegistered(key))continue;if(shortcut.register(key,()=>{})){shortcut.unregister(key);return key;}}return null;})()"); assert.ok(accelerator, 'The quick-chat test needs an actually available global accelerator.');
  await application.evaluateMain("globalThis.nookQuickShortcut=require('electron').globalShortcut;globalThis.nookQuickShortcutRegister=globalThis.nookQuickShortcut.register;globalThis.nookQuickShortcut.register=(key,callback)=>{const result=globalThis.nookQuickShortcutRegister.call(globalThis.nookQuickShortcut,key,callback);if(result)globalThis.nookQuickShortcutCallback=callback;return result;};");
  try { await page.evaluate(async accelerator => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, desktop: { ...(state.preferences.desktop ?? {}), trayEnabled: false, closeToTray: false, shortcutEnabled: true, accelerator, shortcutTarget: 'quick-chat' } }); }, accelerator); }
  finally { await application.evaluateMain("globalThis.nookQuickShortcut.register=globalThis.nookQuickShortcutRegister;delete globalThis.nookQuickShortcutRegister;delete globalThis.nookQuickShortcut;"); }
  await application.evaluateMain("globalThis.nookQuickShortcutCallback();delete globalThis.nookQuickShortcutCallback;");
  assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat').isVisible()"), true);
  const samePage = quick; quick = await open(); assert.equal(quick, samePage); assert.equal(await input().inputValue(), 'QUICK_HANDOFF_UNSENT');
  verified('pin, native compact resize, Escape hide/reopen and the actually registered quick-chat-target hotkey callback retain the same window and unsent draft');

  await application.evaluateMain("globalThis.nookQuickRename=require('node:fs/promises').rename;require('node:fs/promises').rename=async(from,to)=>{if(String(to).endsWith('workspace.json'))throw Object.assign(new Error('Synthetic quick-chat save failure'),{code:'EIO'});return globalThis.nookQuickRename(from,to);};");
  try {
    await input().fill('QUICK_FILESYSTEM_RETRY'); await quick.getByRole('alert').waitFor(); assert.equal(await input().inputValue(), 'QUICK_FILESYSTEM_RETRY'); assert.equal((await quick.evaluate(() => window.nookQuick.load())).draft.text, 'QUICK_HANDOFF_UNSENT');
    await quick.getByRole('alert').getByText('本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。', { exact: true }).waitFor();
    await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.setSize(420,360);window.webContents.setZoomFactor(1.5);})()");
    await capture('quick-chat-minimum-save-error.png');
    const controls = await visibleControls(); assert.ok(controls.length >= 5 && controls.every(control => control.visible), `Save errors must keep minimum-window input and model controls usable: ${JSON.stringify(controls)}`);
    const dismiss = quick.getByRole('button', { name: '关闭提示', exact: true });
    async function dismissalVisible() { return dismiss.evaluate(element => { const bounds = element.getBoundingClientRect(), alert = element.closest('[role=alert]').getBoundingClientRect(), body = element.closest('.quick-chat-body').getBoundingClientRect(); return bounds.y >= alert.y && bounds.bottom <= Math.min(alert.bottom, body.bottom, innerHeight) && bounds.x >= alert.x && bounds.right <= alert.right; }); }
    assert.equal(await dismissalVisible(), true, 'The entire error dismissal must fit its native clipped surface.');
    await quick.getByRole('alert').focus(); await quick.getByRole('alert').press('End');
    await quick.waitForFunction(() => document.querySelector('[role=alert]')?.scrollTop > 0);
    assert.equal(await quick.getByRole('alert').evaluate(element => element.scrollTop > 0), true, 'The complete error must be readable by keyboard scrolling.');
    assert.equal(await dismissalVisible(), true, 'The error dismissal must stay visible after scrolling the complete message.'); await capture('quick-chat-minimum-save-error-end.png');
    await dismiss.click(); assert.equal(await input().inputValue(), 'QUICK_FILESYSTEM_RETRY');
    await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');window.webContents.setZoomFactor(1);window.setSize(640,580);})()");
  }
  finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.nookQuickRename;delete globalThis.nookQuickRename;"); }
  await quick.getByRole('button', { name: '隐藏快速聊天', exact: true }).focus(); await quick.getByRole('button', { name: '隐藏快速聊天', exact: true }).click(); quick = await open();
  assert.equal(await input().inputValue(), 'QUICK_FILESYSTEM_RETRY'); assert.equal((await quick.evaluate(() => window.nookQuick.load())).draft.text, 'QUICK_FILESYSTEM_RETRY');
  verified('an actual workspace rename failure retains quick input and its saved predecessor, then the same draft saves successfully on retry');

  const backup = join(directory, 'quick-chat-backup.json.gz');
  await application.evaluateMain(`globalThis.nookQuickSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
  try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); }
  finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookQuickSave;delete globalThis.nookQuickSave;"); }
  const saved = JSON.parse(gunzipSync(await readFile(backup)).toString('utf8')), bundles = saved.documentOriginals.filter(bundle => bundle.reference.sha256 === originalSha256);
  assert.equal(bundles.length, 1); assert.equal(bundles[0].data, bytes.toString('base64')); const oldRevision = saved.quickChat.revision;
  await unlink(join(directory, 'document-originals', originalSha256));
  await application.evaluateMain(`globalThis.nookQuickRestoreOpen=require('electron').dialog.showOpenDialog;globalThis.nookQuickConfirm=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  try { assert.ok(await page.evaluate(() => window.qiyao.importWorkspace())); }
  finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookQuickRestoreOpen;require('electron').dialog.showMessageBox=globalThis.nookQuickConfirm;delete globalThis.nookQuickRestoreOpen;delete globalThis.nookQuickConfirm;"); }
  await waitForBridge(quick, async revision => (await window.nookQuick.load()).revision !== revision, oldRevision);
  assert.equal(await quick.evaluate(async revision => { try { await window.nookQuick.send(revision); return false; } catch { return true; } }, oldRevision), true);
  page = await restart(); application = getApplication(); quick = await open();
  assert.equal(await input().inputValue(), 'QUICK_FILESYSTEM_RETRY'); const recovered = await quick.evaluate(() => window.nookQuick.load());
  assert.equal(recovered.thread.id, threadId); assert.equal(createHash('sha256').update(await readFile(join(directory, 'document-originals', originalSha256))).digest('hex'), originalSha256);
  assert.equal(Buffer.from(await quick.evaluate(async reference => Array.from(await window.nookQuick.readDocumentOriginal(reference)), recovered.thread.messages[0].attachments[0].original)).equals(bytes), true);
  assert.equal(calls.length - initialCalls, 4); await page.evaluate(async preferences => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, ...preferences }); }, preferences);
  verified('combined-window backup deduplicates exact PDFs, restores missing originals and invalidates stale send revisions, then recovers quick input through an actual normal close/restart');
  return { page, result: { checks: 9, quickModelRequests: 3, mainFixtureRequests: 1, originalSha256, layout, minimumLayout, independentDraftsVerified: true, restrictedBridgeVerified: true,
    exactOriginalVerified: true, textOnlyTransportVerified: true, stopOwnerVerified: true, approvalScopeVerified: true, handoffVerified: true, windowStateVerified: true, shortcutTargetVerified: true, filesystemRetryVerified: true, backupRestartVerified: true, staleRevisionVerified: true,
    refreshRaceVerified: true, minimumErrorVerified: true, captures, screenshotMethod: 'Complete Electron BrowserWindow.capturePage with exact native content-size assertions' } };
}
