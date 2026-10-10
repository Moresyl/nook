import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().startsWith('qiyao://app/')&&new URL(w.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
export async function verifyToolActivities({ page, application, getApplication, directory, screenshots, endpoint, fixture, verified, waitForBridge, restart, errors }) {
  page.setDefaultTimeout(5000);
  const original = await page.evaluate(() => window.qiyao.load()), originalGeometry = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const providerId = 'tool-activity-provider', projectId = 'tool-activity-project', captures = [], layouts = [], threadIds = [];
  await page.evaluate(async ({ endpoint, directory, providerId, projectId }) => {
    await window.qiyao.saveProvider({ id: providerId, name: '工具记录验证', kind: 'openai', endpoint: new URL('/tool-activity/v1', endpoint).href, models: ['tool-model'], hasKey: false }, 'local-verification-key');
    await window.qiyao.saveProject({ id: projectId, name: '工具记录验证项目', path: `${directory}/project-fixture`, instructions: '', createdAt: 1 });
  }, { endpoint, directory, providerId, projectId });
  await page.reload(); await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click();
  await page.locator('.project-list').getByRole('button', { name: '工具记录验证项目', exact: true }).click();
  const row = () => page.locator('.tool-activity').last(), toggle = () => row().locator('.tool-activity-toggle'), body = () => row().locator('.tool-detail');
  async function activity() { return page.evaluate(async () => (await window.qiyao.load()).threads.findLast(thread => thread.providerId === 'tool-activity-provider')?.messages.at(-1)?.activities?.[0]); }
  async function start(marker) {
    await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click();
    await page.locator('.project-list').getByRole('button', { name: '工具记录验证项目', exact: true }).click();
    await page.getByRole('button', { name: '新建项目聊天', exact: true }).click();
    await page.getByLabel('模型提供商', { exact: true }).selectOption(providerId); await page.getByLabel('选择模型', { exact: true }).selectOption('tool-model'); await page.getByLabel('工作模式', { exact: true }).selectOption('agent');
    await page.getByLabel('消息', { exact: true }).fill(marker); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('dialog', { name: '审批命令执行', exact: true }).waitFor();
    threadIds.push(await page.evaluate(async () => (await window.qiyao.load()).threads.findLast(thread => thread.providerId === 'tool-activity-provider').id));
    assert.equal(await toggle().getAttribute('aria-expanded'), 'false'); assert.equal(await row().locator('.tool-status').textContent(), '等待审批');
    assert.equal(await body().getAttribute('inert'), '');
  }
  async function allow() {
    await page.getByRole('dialog').getByRole('button', { name: '允许这次执行', exact: true }).click();
    await waitForBridge(page, () => document.querySelector('.tool-running pre[aria-label="结果原文"]')?.textContent.includes('TOOL_FIRST_OUTPUT'));
    assert.equal(await toggle().getAttribute('aria-expanded'), 'true'); assert.equal(await row().locator('.tool-status').textContent(), '执行中');
  }
  async function capture(filename, surface = page, quick = false) {
    await surface.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const selector = quick ? "require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat')" : mainWindow;
    const value = await application.evaluateMain(`(async()=>{const window=${selector};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const png = Buffer.from(value.png, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], value.size);
    await writeFile(join(screenshots, filename), png); captures.push({ filename, size: value.size });
  }
  await start('工具记录拒绝验证'); await page.getByRole('dialog').getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByText('工具记录拒绝验证已结束。', { exact: true }).waitFor();
  assert.equal(await row().locator('.tool-status').textContent(), '失败'); assert.equal(await toggle().getAttribute('aria-expanded'), 'false'); assert.equal((await activity()).output, 'The user denied command execution.');
  verified('tool activity waiting/denied states come from the native approval and execution engine');
  await start('工具记录停止验证'); await allow(); await toggle().click();
  await fixture.release('工具记录停止验证', 'next'); await waitForBridge(page, () => document.querySelector('.tool-running pre[aria-label="结果原文"]')?.textContent.includes('TOOL_NEXT_OUTPUT'));
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '停止生成', exact: true }).click(); await page.getByText('已停止生成', { exact: true }).waitFor();
  assert.equal(await row().locator('.tool-status').textContent(), '已停止'); assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  verified('manual collapse survives native streaming output and actual command cancellation');
  await start('工具记录完成验证'); await allow();
  assert.deepEqual(await page.evaluate(async () => ({ write: (await navigator.permissions.query({ name: 'clipboard-write' })).state, read: (await navigator.permissions.query({ name: 'clipboard-read' })).state })), { write: 'granted', read: 'denied' });
  const unownedPermissions = await application.evaluateMain("(async()=>{const BrowserWindow=require('electron').BrowserWindow;const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});try{await window.loadURL('qiyao://app/index.html');return await window.webContents.executeJavaScript(\"Promise.all(['clipboard-write','clipboard-read'].map(async name=>(await navigator.permissions.query({name})).state))\");}finally{window.destroy();}})()");
  assert.deepEqual(unownedPermissions, ['denied', 'denied']);
  await page.evaluate(() => { const original = navigator.clipboard.writeText.bind(navigator.clipboard); window.ownedCopiedText = []; navigator.clipboard.writeText = text => { window.ownedCopiedText.push(text); return original(text); }; });
  assert.equal(await row().getByLabel('输入原文', { exact: true }).textContent(), fixture.inputs.get('工具记录完成验证'));
  await row().getByRole('button', { name: '复制输入原文', exact: true }).click(); await row().getByRole('button', { name: '已复制输入原文', exact: true }).waitFor();
  assert.equal(await application.evaluateMain("require('electron').clipboard.readText()"), fixture.inputs.get('工具记录完成验证'));
  await page.evaluate(() => { window.ownedToolClipboard = { original: navigator.clipboard.writeText.bind(navigator.clipboard), pending: null }; navigator.clipboard.writeText = () => new Promise(resolve => { window.ownedToolClipboard.pending = resolve; }); });
  await row().getByRole('button', { name: '复制结果原文', exact: true }).click(); await fixture.release('工具记录完成验证', 'next');
  await waitForBridge(page, () => document.querySelector('.tool-running pre[aria-label="结果原文"]')?.textContent.includes('TOOL_NEXT_OUTPUT'));
  await page.evaluate(() => window.ownedToolClipboard.pending());
  assert.equal(await row().getByRole('button', { name: '已复制结果原文', exact: true }).count(), 0);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('owned clipboard rejection'); }; });
  await row().getByRole('button', { name: '复制结果原文', exact: true }).click(); await row().getByRole('alert').waitFor();
  assert.equal(await row().getByRole('alert').textContent(), '无法复制，请重试或选取原文。');
  await page.evaluate(() => { navigator.clipboard.writeText = window.ownedToolClipboard.original; delete window.ownedToolClipboard; });
  const rawOutput = await row().getByLabel('结果原文', { exact: true }).textContent(); await row().getByRole('button', { name: '复制结果原文', exact: true }).click(); await row().getByRole('button', { name: '已复制结果原文', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.ownedCopiedText.at(-1)), rawOutput);
  assert.equal(await application.evaluateMain("require('electron').clipboard.readText()"), process.platform === 'win32' ? rawOutput.replace(/\r?\n/g, '\r\n') : rawOutput); assert.ok(rawOutput.includes('9007199254740993')); assert.equal(await row().locator('img').count(), 0);
  await capture('tool-activities-running.png'); await row().getByLabel('结果原文', { exact: true }).focus(); await fixture.release('工具记录完成验证', 'finish');
  await page.getByText('工具记录完成验证已结束。', { exact: true }).waitFor();
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false'); assert.equal(await toggle().evaluate(element => element === document.activeElement), true); assert.equal(await body().getAttribute('inert'), '');
  verified('exact native clipboard copy, denied/retried copy, streaming stale completion guard and focus-safe automatic collapse');
  await toggle().press('Enter'); assert.equal(await toggle().getAttribute('aria-expanded'), 'true'); assert.equal(await body().getAttribute('inert'), null); await toggle().press('Space'); assert.equal(await toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(await row().locator('.tool-status').textContent(), '已完成'); assert.match(await row().locator('.tool-duration').getAttribute('aria-label'), /^耗时 \d+\.\d 秒$/);
  await toggle().click(); assert.ok((await activity()).output.includes('TOOL_FINAL_OUTPUT'));
  verified('completed native records provide keyboard disclosure, inert hidden details and genuine elapsed time');
  const finishedThread = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadIds.at(-1));
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
    await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme);
    await waitForBridge(page, theme => document.documentElement.dataset.theme === theme, theme); await dismissModalWithEscape(page, settings);
    await application.evaluateMain(`${mainWindow}.setContentSize(760,620);${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page, ({ zoom, theme }) => Math.abs(innerWidth - 760 / zoom) <= 1 && document.documentElement.dataset.theme === theme, { zoom, theme });
    await toggle().scrollIntoViewIfNeeded();
    const layout = await row().evaluate(element => {
      const button = element.querySelector('.tool-activity-toggle'), style = getComputedStyle(button), detail = getComputedStyle(element.querySelector('.tool-detail-inner')), pre = element.querySelector('pre'), rect = element.getBoundingClientRect(), control = button.getBoundingClientRect(), scroller = element.closest('.transcript-scroll').getBoundingClientRect();
      return { fontSize: style.fontSize, parentFontSize: getComputedStyle(element.closest('.assistant-prose')).fontSize, gap: style.gap, padding: detail.padding, duration: getComputedStyle(element.querySelector('.tool-detail')).transitionDuration, contained: rect.left >= 0 && rect.right <= innerWidth + 1, controlVisible: control.top >= Math.max(0, scroller.top) && control.bottom <= Math.min(innerHeight, scroller.bottom), summaryWidth: element.querySelector('.tool-summary').getBoundingClientRect().width, controlHeight: control.height, outputScrollBounded: pre.clientHeight <= 192, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(layout.fontSize, layout.parentFontSize); assert.equal(layout.gap, '4px'); assert.equal(layout.padding, '8px 0px 4px 24px'); assert.equal(layout.duration, '0.3s, 0.3s'); assert.equal(layout.contained, true); assert.equal(layout.controlVisible, true); assert.ok(layout.summaryWidth >= 16); assert.ok(layout.controlHeight >= 20); assert.equal(layout.outputScrollBounded, true); assert.equal(layout.horizontalOverflow, false);
    layouts.push({ theme, zoom, ...layout }); await capture(`tool-activities-${theme}-${zoom * 100}.png`);
  }
  verified('tool activity summaries and bounded original text fit native light/dark minimum windows at 100/125/150 percent zoom');
  await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await body().evaluate(element => getComputedStyle(element).transitionDuration), '0s'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  verified('tool disclosure respects reduced-motion preference');
  await application.evaluateMain(`${mainWindow}.setContentSize(1280,840);${mainWindow}.webContents.setZoomFactor(1)`);
  await page.evaluate(() => window.qiyao.openQuickChat());
  const deadline = Date.now() + 10_000; let quick;
  while (!quick && Date.now() < deadline) { quick = page.context().pages().find(candidate => !candidate.isClosed() && new URL(candidate.url()).searchParams.get('view') === 'quick-chat'); if (!quick) await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(quick); quick.setDefaultTimeout(5000); quick.on('pageerror', error => errors.push(error.message));
  await quick.getByLabel('快速聊天会话', { exact: true }).selectOption(threadIds.at(-1)); await quick.locator('.tool-complete').waitFor();
  assert.equal(await quick.evaluate(() => window.qiyao), undefined); assert.equal(await quick.locator('.tool-activity-toggle').getAttribute('aria-expanded'), 'false');
  await quick.locator('.tool-activity-toggle').click(); const quickOutput = await quick.getByLabel('结果原文', { exact: true }).textContent(); assert.equal(quickOutput, finishedThread.messages.at(-1).activities[0].output);
  await quick.evaluate(() => { const original = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = text => { window.ownedQuickCopiedText = text; return original(text); }; });
  await quick.getByRole('button', { name: '复制结果原文', exact: true }).click(); await quick.getByRole('button', { name: '已复制结果原文', exact: true }).waitFor(); assert.equal(await quick.evaluate(() => window.ownedQuickCopiedText), quickOutput); assert.equal(await application.evaluateMain("require('electron').clipboard.readText()"), process.platform === 'win32' ? quickOutput.replace(/\r?\n/g, '\r\n') : quickOutput);
  await quick.locator('.tool-activity-toggle').scrollIntoViewIfNeeded(); await capture('tool-activities-quick.png', quick, true); await quick.evaluate(() => window.nookQuick.windowAction('hide'));
  verified('restricted native quick chat shares exact tool records, independent disclosure choices and original clipboard copy');
  await page.getByLabel('消息', { exact: true }).fill('TOOL_ACTIVITY_UNSENT_DRAFT');
  await waitForBridge(page, async id => (await window.qiyao.load()).composerDrafts.some(draft => draft.threadId === id && draft.text === 'TOOL_ACTIVITY_UNSENT_DRAFT'), threadIds.at(-1));
  const before = await page.evaluate(() => window.qiyao.load()), requestCount = fixture.requests.length;
  page = await restart(); application = getApplication(); await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: '工具记录验证项目', exact: true }).click();
  await page.locator('.thread-list > button').filter({ hasText: '工具记录完成验证' }).click(); await page.locator('.tool-complete').waitFor();
  const after = await page.evaluate(() => window.qiyao.load()); for (const id of threadIds) assert.deepEqual(after.threads.find(thread => thread.id === id), JSON.parse(JSON.stringify(before.threads.find(thread => thread.id === id))));
  assert.equal(await toggle().getAttribute('aria-expanded'), 'false'); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'TOOL_ACTIVITY_UNSENT_DRAFT'); assert.equal(fixture.requests.length, requestCount);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')).threads.filter(thread => threadIds.includes(thread.id)), after.threads.filter(thread => threadIds.includes(thread.id)));
  await capture('tool-activities-restart.png');
  await page.evaluate(async preferences => { await window.qiyao.savePreferences(preferences); }, original.preferences); await application.evaluateMain(`${mainWindow}.setContentSize(${originalGeometry.size.join(',')});${mainWindow}.webContents.setZoomFactor(${originalGeometry.zoom})`);
  verified('actual restart preserves exact tool inputs/results/timestamps and unsent draft without replaying commands');
  return { page, result: { checks: 8, nativeStates: ['waiting', 'running', 'complete', 'error', 'stopped'], scopedClipboardPermission: true, exactOriginalCopy: true, staleClipboardGuard: true, deniedCopyRetry: true, focusBeforeInert: true, manualStreamingCollapse: true, restrictedQuickChat: true, reducedMotion: true, actualRestart: true, commandRequests: requestCount, layouts, screenshots: captures } };
}
