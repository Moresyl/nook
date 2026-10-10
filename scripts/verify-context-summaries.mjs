import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const containsText = (messages, text) => messages.some(message => message.content === text || Array.isArray(message.content) && message.content.some(item => item.text === text));

export async function verifyContextSummaries({ page, application, getApplication, directory, screenshots, endpoint, fixture, verified, waitForBridge, restart, errors }) {
  const captures = [], layouts = [];
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat'&&(window.webContents.getURL().includes('workbench')||window.webContents.getURL().includes('index.html')))";
  async function capture(filename) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await application.evaluateMain(`(async()=>{const window=${mainWindow};return (await window.capturePage()).toPNG().toString('base64')})()`);
    await writeFile(join(screenshots, filename), Buffer.from(png, 'base64')); captures.push(filename);
  }
  await page.evaluate(endpoint => window.qiyao.saveProvider({ id: 'context-fixture', name: '上下文验证', kind: 'openai', endpoint: `${endpoint.replace(/\/v1$/, '')}/context-summary/v1`, models: ['summary', 'held', 'fail'], hasKey: false }, 'CONTEXT_FIXTURE_KEY'), endpoint);
  let threadId;
  for (let index = 0; index < 3; index++) {
    threadId = (await page.evaluate(({ threadId, index }) => window.qiyao.submit({ threadId, providerId: 'context-fixture', model: 'summary', text: `CONTEXT_ORIGINAL_${index}`, attachments: index ? [] : [{ id: 'document', name: '保留原文.txt', content: 'CONTEXT_ATTACHMENT_ORIGINAL' }] }), { threadId, index })).threadId;
    await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'complete', threadId);
  }
  await page.evaluate(async id => { await window.qiyao.activateThread(id); }, threadId); await page.reload();
  await page.getByLabel('模型提供商', { exact: true }).selectOption('context-fixture'); await page.getByLabel('选择模型', { exact: true }).selectOption('summary');
  const original = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  assert.equal(original.messages.length, 6);
  await page.getByRole('button', { name: '管理会话上下文', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '会话上下文', exact: true });
  await dialog.getByLabel('保留最近轮数', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: '生成新摘要', exact: true }).click();
  try { await waitForBridge(page, () => document.querySelector('.context-summary-text')?.value.startsWith('SUMMARY_GENERATED_')); }
  catch (error) { console.error('Summary fixture failure requests', JSON.stringify(fixture.requests)); console.error('Summary preview failure value', await dialog.getByLabel('摘要内容', { exact: true }).inputValue().catch(() => 'unavailable')); throw error; }
  assert.equal(fixture.requests.filter(row => row.summary).length, 1); const request = fixture.requests.find(row => row.summary);
  assert.equal(request.messages.length, 5); assert.ok(JSON.stringify(request.messages).includes('CONTEXT_ATTACHMENT_ORIGINAL')); assert.ok(!JSON.stringify(request.messages).includes('CONTEXT_ORIGINAL_2'));
  assert.equal((await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId)).contextSummaries, undefined);
  assert.equal(await dialog.locator('img').count(), 0);
  verified('real native summary preview uses the exact prefix and attachments with no tools and does not persist before applying');
  const edited = 'NATIVE_EDITED_SUMMARY\n约束与待完成项\n<img src=x> {{literal}} 😀';
  await dialog.getByLabel('摘要内容', { exact: true }).fill(edited);
  await capture('context-summary-preview.png');
  await dialog.getByRole('button', { name: '保存并使用摘要', exact: true }).click();
  await waitForBridge(page, async ({ id, edited }) => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.contextSummaries?.[0]?.content === edited, { id: threadId, edited });
  let saved = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  assert.deepEqual(saved.messages, original.messages); assert.equal(saved.contextSummaries[0].messageCount, 4); assert.deepEqual(saved.contextSummaries[0].invocations[0].tokens, { inputTokens: 70, outputTokens: 20, totalTokens: 90 });
  await dialog.getByRole('button', { name: '查看 token 用量', exact: true }).click();
  await page.getByRole('dialog', { name: 'Token 用量', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await page.getByRole('button', { name: '管理会话上下文', exact: true }).click(); dialog = page.getByRole('dialog', { name: '会话上下文', exact: true });
    await application.evaluateMain(`(()=>{const window=${mainWindow};window.setContentSize(760,620);window.webContents.setZoomFactor(${zoom})})()`);
    await page.waitForFunction(({ theme, zoom }) => document.documentElement.dataset.theme === theme && Math.abs(innerWidth - 760 / zoom) <= 1, { theme, zoom }, { timeout: 5_000 });
    await dialog.getByText(/^覆盖前/).waitFor({ state: 'visible', timeout: 5_000 });
    await capture(`context-summary-saved-${theme}-${Math.round(zoom * 100)}.png`);
    const bounds = await dialog.evaluate(node => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, overflow: node.scrollWidth > node.clientWidth }; });
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1 && !bounds.overflow);
    layouts.push({ theme, zoom, contained: true, horizontalOverflow: false, nativeSize: [760, 620] });
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  }
  await application.evaluateMain(`(()=>{const window=${mainWindow};window.setContentSize(1280,840);window.webContents.setZoomFactor(1)})()`);
  await page.evaluate(id => window.qiyao.submit({ threadId: id, providerId: 'context-fixture', model: 'summary', text: 'CONTEXT_AFTER_SUMMARY', attachments: [] }), threadId);
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'complete', threadId);
  const compact = fixture.requests.at(-1); assert.ok(containsText(compact.messages, edited)); assert.ok(JSON.stringify(compact.messages).includes('CONTEXT_ORIGINAL_2')); assert.ok(!JSON.stringify(compact.messages).includes('CONTEXT_ATTACHMENT_ORIGINAL'));
  verified('edited summary persists exact original messages and actual usage; the next native HTTP request sends summary plus recent turns');
  const mainDrafts = await page.evaluate(async () => (await window.qiyao.load()).composerDrafts);
  await page.getByRole('button', { name: '快速聊天', exact: true }).click();
  const quickDeadline = Date.now() + 10_000; let quick;
  while (Date.now() < quickDeadline) {
    quick = page.context().pages().find(candidate => !candidate.isClosed() && new URL(candidate.url()).searchParams.get('view') === 'quick-chat');
    if (quick) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(quick, 'The restricted quick-chat page must appear within the original bridge deadline.');
  quick.setDefaultTimeout(5_000); quick.setDefaultNavigationTimeout(5_000);
  quick.on('pageerror', error => errors.push(error.message));
  await quick.getByRole('textbox', { name: '消息', exact: true }).waitFor();
  await quick.evaluate(async id => { const state = await window.nookQuick.load(); await window.nookQuick.activate(id, state.revision); }, threadId);
  await quick.reload(); await quick.getByRole('textbox', { name: '消息', exact: true }).fill('CONTEXT_QUICK_SUMMARY');
  await quick.getByLabel('模型提供商', { exact: true }).selectOption('context-fixture'); await quick.getByLabel('选择模型', { exact: true }).selectOption('summary');
  await quick.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForBridge(quick, async () => { const state = await window.nookQuick.load(); return state.thread?.messages.at(-2)?.content === 'CONTEXT_QUICK_SUMMARY' && state.thread.messages.at(-1)?.status === 'complete'; });
  assert.ok(containsText(fixture.requests.at(-1).messages, edited)); assert.equal(await quick.evaluate(() => window.qiyao === undefined && !('generateContextSummary' in window.nookQuick) && !('changeContextSummary' in window.nookQuick)), true);
  assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).composerDrafts), mainDrafts);
  await quick.evaluate(() => window.nookQuick.windowAction('hide'));
  verified('restricted quick chat sends the same verified summary while preserving main drafts and exposing no workspace mutation bridge');
  await page.reload(); await page.getByRole('button', { name: '管理会话上下文', exact: true }).click(); dialog = page.getByRole('dialog', { name: '会话上下文', exact: true });
  await dialog.getByText('生成选项', { exact: true }).click();
  await dialog.getByLabel('摘要模型', { exact: true }).selectOption('held'); await dialog.getByRole('button', { name: '生成新摘要', exact: true }).click();
  await waitForBridge(page, () => document.querySelector('.context-summary-dialog')?.textContent.includes('正在生成摘要'));
  await dialog.getByRole('button', { name: '停止生成', exact: true }).click();
  await waitForBridge(page, () => document.querySelector('.context-summary-dialog button') && [...document.querySelectorAll('.context-summary-dialog button')].some(node => node.textContent === '生成新摘要' && !node.disabled));
  assert.equal((await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId)).contextSummaries.length, 1);
  await dialog.getByLabel('摘要模型', { exact: true }).selectOption('fail'); await dialog.getByRole('button', { name: '生成新摘要', exact: true }).click(); await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('alert').scrollIntoViewIfNeeded();
  await capture('context-summary-provider-error.png');
  assert.equal(await dialog.getByLabel('摘要内容', { exact: true }).inputValue(), edited);
  verified('native summary cancellation and provider failure preserve the previous saved summary and editable content');
  await dialog.getByRole('button', { name: '恢复完整上下文', exact: true }).click(); await waitForBridge(page, async id => !(await window.qiyao.load()).threads.find(thread => thread.id === id)?.activeContextSummaryId, threadId);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.evaluate(id => window.qiyao.submit({ threadId: id, providerId: 'context-fixture', model: 'summary', text: 'CONTEXT_RESTORED', attachments: [] }), threadId);
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'complete', threadId);
  assert.ok(JSON.stringify(fixture.requests.at(-1).messages).includes('CONTEXT_ATTACHMENT_ORIGINAL')); assert.ok(!containsText(fixture.requests.at(-1).messages, edited));
  saved = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  await page.evaluate(({ id, summaryId }) => window.qiyao.changeContextSummary({ action: 'select', threadId: id, summaryId }), { id: threadId, summaryId: saved.contextSummaries[0].id });
  await page.evaluate(async id => { const state = await window.qiyao.load(), thread = state.threads.find(thread => thread.id === id); await window.qiyao.updateThread({ ...thread, messages: thread.messages.map((message, index) => index ? message : { ...message, content: 'CONTEXT_CHANGED_ORIGINAL' }) }); }, threadId);
  await page.reload(); await page.getByRole('button', { name: '管理会话上下文', exact: true }).click(); dialog = page.getByRole('dialog', { name: '会话上下文', exact: true });
  await dialog.getByText('原文已变化，此摘要不能使用。发送时会恢复完整上下文，请重新生成。', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 }); assert.equal(await dialog.getByRole('button', { name: '保存并使用摘要', exact: true }).isDisabled(), true);
  await dialog.getByText('原文已变化，此摘要不能使用。发送时会恢复完整上下文，请重新生成。', { exact: true }).scrollIntoViewIfNeeded();
  await capture('context-summary-expired.png');
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.evaluate(id => window.qiyao.submit({ threadId: id, providerId: 'context-fixture', model: 'summary', text: 'CONTEXT_EXPIRED_FALLBACK', attachments: [] }), threadId);
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'complete', threadId);
  assert.ok(JSON.stringify(fixture.requests.at(-1).messages).includes('CONTEXT_CHANGED_ORIGINAL')); assert.ok(!containsText(fixture.requests.at(-1).messages, edited));
  verified('restore-full and edited-prefix invalidation both send the original complete context through the native model gateway');
  const beforeRestart = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  page = await restart(); application = getApplication();
  const afterRestart = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId); assert.deepEqual(afterRestart, JSON.parse(JSON.stringify(beforeRestart)));
  verified('normal native restart retains every raw message, attachment, summary version, selection and actual usage');
  return { page, result: { checks: 6, threadId, requestCount: fixture.requests.length, summaryRequests: fixture.requests.filter(row => row.summary).length, originalMessages: original.messages.length, finalMessages: afterRestart.messages.length, readonlyPreviewVerified: true, actualContextRequestsVerified: true, cancellationFailureVerified: true, expiredFullContextVerified: true, restartHistoryVerified: true, restrictedQuickChatVerified: true, layouts, screenshots: captures, workspace: directory } };
}
