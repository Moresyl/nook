import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export async function verifyModelComparisons({ page, application, getApplication, endpoint, directory, screenshots, fixture, verified, waitForBridge, restart }) {
  const beforeRequests = fixture.requests.length; const providerA = randomUUID(); const providerB = randomUUID(); const projectId = randomUUID(); const sourceId = randomUUID(); const question = 'COMPARE_SAME_QUESTION 中文 <img> {{literal}}';
  const attachment = { id: randomUUID(), name: '比较资料.txt', content: 'COMPARE_ATTACHMENT_EXACT' };
  const baseMessages = [{ id: randomUUID(), role: 'user', content: 'COMPARE_PREVIOUS_USER', attachments: [attachment], createdAt: 1, status: 'complete' }, { id: randomUUID(), role: 'assistant', content: 'COMPARE_PREVIOUS_REPLY', attachments: [], createdAt: 2, status: 'complete' }];
  const now = Date.now();
  const source = { id: sourceId, title: '模型比较原对话', providerId: providerA, model: 'one', assistantId: 'general', projectId, mode: 'agent', messages: baseMessages, pinned: false, archived: false, createdAt: now, updatedAt: now };
  await page.evaluate(async ({ providerA, providerB, endpoint, projectId, directory }) => {
    for (const [id, connection] of [[providerA, 'a'], [providerB, 'b']]) await window.qiyao.saveProvider({ id, name: `比较连接 ${connection.toUpperCase()}`, kind: 'openai', endpoint: new URL(`/model-comparison/${connection}/v1`, endpoint).href, models: ['one', 'two', 'fail', 'held'], hasKey: false }, `COMPARISON_${connection.toUpperCase()}_TEST_KEY`);
    await window.qiyao.saveProject({ id: projectId, name: '比较项目', path: directory, instructions: 'COMPARE_PROJECT_INSTRUCTIONS', createdAt: 1 });
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light', defaultProviderId: providerA, defaultModel: 'one' });
  }, { providerA, providerB, endpoint, projectId, directory });
  page = await restart(async () => {
    const path = join(directory, 'workspace.json'); const state = JSON.parse(await readFile(path, 'utf8')); state.threads.push(source); state.activeThreadId = sourceId;
    state.composerDrafts.push({ threadId: sourceId, providerId: providerA, model: 'one', assistantId: 'general', projectId, mode: 'agent', text: question, attachments: [attachment], mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: 1 }); await writeFile(path, JSON.stringify(state));
  }); application = getApplication(); await application.resize(1280, 840);
  const composer = () => page.getByLabel('消息', { exact: true }); const dialog = () => page.getByRole('dialog', { name: '模型比较', exact: true }); const captures = [];
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  async function capture(name) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await dialog().isVisible(), true); const result = await application.evaluateMain(`(async()=>{const window=${mainWindow};const image=await window.capturePage();return {png:image.toPNG().toString('base64'),size:window.getContentSize()};})()`); const bytes = Buffer.from(result.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], result.size); await writeFile(join(screenshots, name), bytes); captures.push(name); }
  async function open() { await page.getByRole('button', { name: '发送给多个模型比较', exact: true }).click(); await dialog().waitFor(); await dialog().getByLabel('比较连接 2', { exact: true }).selectOption(providerB); await dialog().getByLabel('比较模型 2', { exact: true }).selectOption('two'); }
  async function close() { await dialog().locator('.modal-footer').getByRole('button', { name: '关闭', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
  const groups = []; const group = async (groupId) => (await page.evaluate(() => window.qiyao.load())).threads.filter((thread) => thread.comparison?.groupId === groupId).sort((a, b) => a.comparison.index - b.comparison.index);
  async function currentGroup() { const state = await page.evaluate(() => window.qiyao.load()); return state.threads.findLast((thread) => thread.comparison)?.comparison.groupId; }
  async function waitCompleted(groupId) {
    const waitStartedAt = Date.now();
    try {
      await waitForBridge(page, async (groupId) => {
        const loadStartedAt = Date.now(); const state = await window.qiyao.load(); const loadedAt = Date.now();
        const threads = state.threads.filter((thread) => thread.comparison?.groupId === groupId);
        const matched = threads.every((thread) => thread.messages.at(-1)?.status !== 'running');
        window.__qiyaoComparisonCompletionPoll = { polledAt: loadedAt, sequence: (window.__qiyaoComparisonCompletionPoll?.sequence ?? 0) + 1, loadStartedAt, loadedAt, matched,
          replies: threads.map((thread) => ({ id: thread.id, model: thread.model, messages: thread.messages.length, status: thread.messages.at(-1)?.status, characters: thread.messages.at(-1)?.content.length, invocationStatus: thread.messages.at(-1)?.invocations?.at(-1)?.status })) };
        return matched;
      }, groupId);
    } catch (error) {
      const waitFailedAt = Date.now(); const requestTimelineAtFailure = structuredClone(fixture.timeline.slice(-16));
      const lastPoll = await page.evaluate(() => window.__qiyaoComparisonCompletionPoll ?? null).catch(() => null);
      const resourceCaptureStartedAt = Date.now();
      const resource = await application.evaluateMain('({capturedAt:Date.now(),memory:process.memoryUsage(),cpu:process.cpuUsage(),processes:require("electron").app.getAppMetrics()})').catch(() => null);
      const resourceCaptureCompletedAt = Date.now();
      console.error('Comparison completion diagnostics', JSON.stringify({ groupId, waitStartedAt, waitFailedAt, unchangedCompletionDeadlineMs: 10000, lastPoll, requestTimelineAtFailure, resourceCaptureStartedAt, resourceCaptureCompletedAt, resource }));
      throw error;
    } finally { await page.evaluate(() => { delete window.__qiyaoComparisonCompletionPoll; }).catch(() => {}); }
  }
  async function waitPartial() {
    const waitStartedAt = Date.now();
    try {
      await waitForBridge(page, () => {
        const inputs = Array.from(document.querySelectorAll('.comparison-result textarea'));
        const matched = inputs.every((input) => input.value.includes('PARTIAL'));
        window.__qiyaoComparisonPartialPoll = { polledAt: Date.now(), sequence: (window.__qiyaoComparisonPartialPoll?.sequence ?? 0) + 1, matched, count: inputs.length,
          visible: inputs.slice(-4).map((input) => ({ characters: input.value.length, tail: input.value.slice(-128), status: input.closest('.comparison-result')?.querySelector('.field-hint')?.textContent.slice(0, 64) })) };
        return matched;
      });
    }
    catch (error) {
      const waitFailedAt = Date.now();
      const lastPoll = await page.evaluate(() => window.__qiyaoComparisonPartialPoll).catch(() => null);
      const backendCaptureStartedAt = Date.now();
      const state = await page.evaluate(() => window.qiyao.load()).catch(() => null);
      const backendCaptureCompletedAt = Date.now();
      const visible = await page.evaluate(() => Array.from(document.querySelectorAll('.comparison-result')).map((item) => ({ text: item.querySelector('textarea')?.value.slice(0, 128), status: item.querySelector('.field-hint')?.textContent }))).catch(() => null);
      console.error('Comparison-stream diagnostics', JSON.stringify({ capturedAt: Date.now(), waitStartedAt, waitFailedAt, unchangedDeadlineMs: 10000, lastPoll, backendCaptureStartedAt, backendCaptureCompletedAt,
        requestTimeline: fixture.timeline.slice(-16), requests: fixture.requests.slice(-16).map(({ connection, model, messages }) => ({ connection, model, messages: messages.length })), visible, threads: state?.threads.filter((thread) => thread.comparison).slice(-16).map((thread) => ({ id: thread.id, comparison: thread.comparison, messages: thread.messages.length, original: thread.messages[thread.comparison.contextLength + 1] && { id: thread.messages[thread.comparison.contextLength + 1].id, status: thread.messages[thread.comparison.contextLength + 1].status, characters: thread.messages[thread.comparison.contextLength + 1].content.length, tail: thread.messages[thread.comparison.contextLength + 1].content.slice(-128) } })) }));
      throw error;
    } finally { await page.evaluate(() => { delete window.__qiyaoComparisonPartialPoll; }).catch(() => {}); }
  }
  const sourceBefore = await page.evaluate(() => window.qiyao.load()); const originalDraft = sourceBefore.composerDrafts.find((draft) => draft.threadId === sourceId);
  async function submitFirstGroup() {
    await page.evaluate(() => {
      const diagnostic = { installedAt: Date.now(), clicks: [], samples: 0, lastPoll: null };
      const onClick = (event) => { const button = event.target.closest?.('button'); if (button?.textContent?.trim() === '发送并比较') diagnostic.clicks.push({ at: Date.now(), trusted: event.isTrusted }); };
      document.addEventListener('click', onClick, true);
      const timer = setInterval(() => {
        const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === '发送并比较');
        diagnostic.samples += 1; diagnostic.lastPoll = { at: Date.now(), sendButtonPresent: Boolean(button), sendButtonDisabled: button?.disabled ?? null,
          responses: Array.from(document.querySelectorAll('.comparison-result')).slice(0, 4).map((item) => ({ text: item.querySelector('textarea')?.value.slice(0, 128), status: item.querySelector('.field-hint')?.textContent })) };
      }, 100);
      window.__qiyaoComparisonSetup = { diagnostic, clear: () => { clearInterval(timer); document.removeEventListener('click', onClick, true); } };
    });
    const waitStartedAt = Date.now();
    try {
      await dialog().getByRole('button', { name: '发送并比较', exact: true }).click();
      await dialog().getByLabel('回复 1', { exact: true }).waitFor();
      const diagnostic = await page.evaluate(() => window.__qiyaoComparisonSetup.diagnostic);
      assert.equal(diagnostic.clicks.length, 1); assert.equal(diagnostic.clicks[0].trusted, true);
      console.log('Comparison first-response timing', JSON.stringify({ waitStartedAt, completedAt: Date.now(), unchangedResponseDeadlineMs: 30000, diagnostic }));
    } catch (error) {
      const waitFailedAt = Date.now();
      const requestTimelineAtFailure = structuredClone(fixture.timeline.slice(-16));
      const requestsAtFailure = fixture.requests.slice(-16).map(({ connection, model, messages }) => ({ connection, model, messages: messages.length }));
      const diagnostic = await page.evaluate(() => window.__qiyaoComparisonSetup.diagnostic).catch(() => null);
      const backendCaptureStartedAt = Date.now();
      const backend = await page.evaluate(async () => { const state = await window.qiyao.load(); return { threads: state.threads.length, notes: state.notes.length,
        noteCharacters: state.notes.reduce((sum, note) => sum + note.content.length, 0), comparisons: state.threads.filter((thread) => thread.comparison).slice(-16).map((thread) => ({ id: thread.id, comparison: thread.comparison, messages: thread.messages.map((message) => ({ role: message.role, status: message.status, characters: message.content.length })).slice(-4) })) }; }).catch(() => null);
      const backendCaptureCompletedAt = Date.now();
      const applicationSnapshot = await application.evaluateMain('globalThis.qiyaoTerminalProcessSnapshot?.()').catch(() => null);
      console.error('Comparison first-response diagnostics', JSON.stringify({ waitStartedAt, waitFailedAt, unchangedResponseDeadlineMs: 30000, diagnostic, requestsAtFailure, requestTimelineAtFailure,
        backendCaptureStartedAt, backendCaptureCompletedAt, backend, requestTimelineAfterCapture: fixture.timeline.slice(-16), applicationSnapshot }));
      throw error;
    } finally { await page.evaluate(() => { window.__qiyaoComparisonSetup?.clear(); delete window.__qiyaoComparisonSetup; }).catch(() => {}); }
  }
  await open(); assert.equal(await dialog().getByLabel('本次比较问题', { exact: true }).inputValue(), question); await dialog().getByLabel('比较连接 2', { exact: true }).selectOption(providerA); await dialog().getByLabel('比较模型 2', { exact: true }).selectOption('one'); assert.equal(await dialog().getByRole('button', { name: '发送并比较', exact: true }).isEnabled(), false);
  await capture('117-model-comparison-config-light.png'); await close(); assert.equal(await composer().inputValue(), question); assert.equal(fixture.requests.length, beforeRequests);
  verified('native comparison setup preserves literal question, complete attachments and original owner/draft, rejects duplicate provider/model pairs and cancels without requesting a model');

  await open(); await submitFirstGroup(); await waitForBridge(page, () => document.querySelectorAll('.comparison-result').length === 2); await waitPartial();
  assert.equal(fixture.requests.length, beforeRequests + 2); const firstGroup = await currentGroup(); groups.push(firstGroup); const firstRequests = fixture.requests.slice(-2); assert.deepEqual(firstRequests[0].messages, firstRequests[1].messages); assert.deepEqual(firstRequests.map((request) => request.connection).sort(), ['a', 'b']);
  assert.equal(fixture.timeline.length, 2); for (const timing of fixture.timeline) { assert.ok(Number.isInteger(timing.receivedAt)); assert.ok(timing.partialSentAt >= timing.receivedAt); assert.equal(timing.messages, firstRequests[0].messages.length); assert.equal(timing.closedAt, undefined); }
  assert.equal(await page.evaluate(() => Object.hasOwn(window, '__qiyaoComparisonPartialPoll')), false);
  const sent = JSON.stringify(firstRequests[0].messages); for (const value of ['COMPARE_PREVIOUS_USER', 'COMPARE_PREVIOUS_REPLY', question, attachment.content, 'COMPARE_PROJECT_INSTRUCTIONS']) assert.ok(sent.includes(value));
  assert.equal(await dialog().locator('img').count(), 0); assert.equal(await dialog().getByLabel('回复 1', { exact: true }).getAttribute('readonly'), ''); await capture('118-model-comparison-stream-light.png'); fixture.finish(); await waitCompleted(firstGroup);
  for (const timing of fixture.timeline) { assert.ok(Number.isInteger(timing.completionQueuedAt)); assert.ok(timing.completionQueuedAt >= timing.partialSentAt); assert.ok(Number.isInteger(timing.completionFlushedAt)); assert.ok(timing.completionFlushedAt >= timing.completionQueuedAt); }
  assert.equal(await page.evaluate(() => Object.hasOwn(window, '__qiyaoComparisonCompletionPoll')), false);
  let state = await page.evaluate(() => window.qiyao.load()); assert.deepEqual(state.threads.find((thread) => thread.id === sourceId), source); assert.deepEqual(state.composerDrafts.find((draft) => draft.threadId === sourceId), originalDraft); assert.equal(state.activeThreadId, sourceId); await close(); assert.equal(await composer().inputValue(), question);
  verified('two real HTTP streams start before either completes with identical full context, question, attachments and assistant/project instructions; readonly previews keep markup inert and preserve the entire source and draft');

  await open(); await dialog().getByRole('button', { name: '添加比较模型', exact: true }).click(); await dialog().getByRole('button', { name: '添加比较模型', exact: true }).click();
  for (const [index, provider, model] of [[1, providerA, 'fail'], [2, providerB, 'held'], [3, providerA, 'one'], [4, providerB, 'two']]) { await dialog().getByLabel(`比较连接 ${index}`, { exact: true }).selectOption(provider); await dialog().getByLabel(`比较模型 ${index}`, { exact: true }).selectOption(model); }
  await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().getByLabel('回复 4', { exact: true }).waitFor(); await waitForBridge(page, () => Array.from(document.querySelectorAll('.comparison-result textarea')).slice(1).every((input) => input.value.includes('PARTIAL')));
  assert.equal(fixture.requests.length, beforeRequests + 6); const fourGroup = await currentGroup(); groups.push(fourGroup); fixture.finish(); await dialog().locator('.comparison-result').nth(1).getByRole('button', { name: '停止此回复', exact: true }).click(); await waitCompleted(fourGroup);
  assert.deepEqual((await group(fourGroup)).map((thread) => thread.messages.at(-1).status), ['error', 'stopped', 'complete', 'complete']); assert.ok((await dialog().locator('.comparison-result').nth(1).getByLabel('回复 2', { exact: true }).inputValue()).includes('held: PARTIAL')); await close(); assert.equal(await composer().inputValue(), question);
  verified('four independent real requests retain an actual HTTP failure and stopped partial response while the other two complete; native stopping targets only its selected reply');

  await open(); const primary = join(directory, 'workspace.json'); const beforeFailure = await readFile(primary); const beforeState = await page.evaluate(() => window.qiyao.load());
  await application.evaluateMain(`{const fs=require('node:fs/promises');globalThis.qiyaoComparisonRename=fs.rename;fs.rename=async(source,target)=>{if(target===${JSON.stringify(primary)})throw Object.assign(new Error('Fixture comparison write failure'),{code:'EIO'});return globalThis.qiyaoComparisonRename(source,target);};}`);
  try { await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().locator('.modal-content').getByRole('alert').waitFor(); assert.equal(fixture.requests.length, beforeRequests + 6); assert.deepEqual(await readFile(primary), beforeFailure); assert.deepEqual(await page.evaluate(() => window.qiyao.load()), beforeState); assert.equal(await dialog().getByLabel('本次比较问题', { exact: true }).inputValue(), question); await capture('119-model-comparison-save-error-light.png'); }
  finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.qiyaoComparisonRename;delete globalThis.qiyaoComparisonRename;"); }
  await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().getByLabel('回复 2', { exact: true }).waitFor(); await waitPartial(); const retryGroup = await currentGroup(); groups.push(retryGroup); fixture.finish(); await waitCompleted(retryGroup); await close();
  verified('actual group-save EIO preserves original history bytes, every live thread, original draft and comparison selections without any HTTP request; retry creates exactly two independent responses');

  await page.getByRole('button', { name: '临时聊天', exact: true }).click(); await page.getByLabel('临时聊天说明', { exact: true }).waitFor(); await composer().fill('COMPARE_TEMP_PRIVATE_QUESTION'); await open(); await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().getByLabel('回复 2', { exact: true }).waitFor(); await waitPartial(); const temporaryGroup = await currentGroup(); fixture.finish(); await waitCompleted(temporaryGroup); assert.ok((await group(temporaryGroup)).every((thread) => thread.temporary)); await close();
  await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click(); assert.equal(await composer().inputValue(), question);
  const first = (await group(firstGroup))[0]; first.title = '比较模型一继续'; await page.evaluate((thread) => window.qiyao.updateThread(thread), first); await page.reload(); await composer().waitFor(); await page.locator('.thread-list').getByRole('button', { name: first.title, exact: true }).click(); await page.getByLabel('模型提供商', { exact: true }).selectOption(providerB); await page.getByLabel('选择模型', { exact: true }).selectOption('two'); await composer().fill('COMPARE_SELECTED_CONTINUATION'); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await waitForBridge(page, async ({ id, count }) => { const thread = (await window.qiyao.load()).threads.find((item) => item.id === id); return thread?.messages.length === count + 2 && thread.messages.at(-2)?.content === 'COMPARE_SELECTED_CONTINUATION' && thread.messages.at(-1)?.status === 'running' && thread.messages.at(-1)?.content.includes('PARTIAL'); }, { id: first.id, count: first.messages.length }); assert.equal(fixture.requests.length, beforeRequests + 11); fixture.finish(); await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id)?.messages.at(-1)?.status === 'complete', first.id);
  assert.ok(JSON.stringify(fixture.requests.at(-1).messages).includes('one: COMPLETE')); assert.equal(fixture.requests.length, beforeRequests + 11); assert.equal(fixture.requests.at(-1).connection, 'b'); assert.equal(fixture.requests.at(-1).model, 'two'); await composer().fill('COMPARE_CHILD_DRAFT_KEEP'); await page.getByRole('button', { name: '查看模型比较', exact: true }).click(); assert.ok((await dialog().getByLabel('回复 1', { exact: true }).inputValue()).includes('one: COMPLETE')); assert.equal(await dialog().locator('.comparison-result').first().getByRole('heading', { level: 3 }).textContent(), '比较连接 A · one'); await close();
  await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click(); assert.equal(await composer().inputValue(), question); const backupPaths = [];
  for (const extension of ['json', 'json.gz']) {
    const backup = join(directory, `model-comparison.${extension}`); backupPaths.push(backup); await application.evaluateMain(`globalThis.qiyaoComparisonSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
    try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoComparisonSave;delete globalThis.qiyaoComparisonSave;"); }
    const bytes = await readFile(backup); const text = (extension.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'); assert.equal(text.includes('COMPARE_TEMP_PRIVATE_QUESTION'), false); assert.equal(text.includes(temporaryGroup), false); for (const id of groups) assert.ok(text.includes(id));
  }
  for (const backup of backupPaths) {
    await application.evaluateMain(`globalThis.qiyaoComparisonOpen=require('electron').dialog.showOpenDialog;globalThis.qiyaoComparisonMessage=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
    try { assert.ok(await page.evaluate(() => window.qiyao.importWorkspace())); } finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoComparisonOpen;require('electron').dialog.showMessageBox=globalThis.qiyaoComparisonMessage;delete globalThis.qiyaoComparisonOpen;delete globalThis.qiyaoComparisonMessage;"); }
  }
  page = await restart(); application = getApplication(); await application.resize(1280, 840); state = await page.evaluate(() => window.qiyao.load()); assert.equal(state.threads.some((thread) => thread.temporary || thread.comparison?.groupId === temporaryGroup), false); assert.equal(state.composerDrafts.find((draft) => draft.threadId === sourceId).text, question); assert.equal(state.composerDrafts.find((draft) => draft.threadId === first.id).text, 'COMPARE_CHILD_DRAFT_KEEP'); assert.equal(state.threads.find((thread) => thread.id === first.id).messages.length, 6); for (const id of groups) assert.ok((await group(id)).length >= 2);
  verified('selected native continuation uses only its model context and independent draft; actual JSON/gzip export and restore retain group identity, original reply position and full histories, exclude temporary groups, and normal restart retains regular drafts');

  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540); const layout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await waitForBridge(page, ({ zoom }) => Math.abs(innerWidth - 760 / zoom) <= 1 && Math.abs(innerHeight - 540 / zoom) <= 1, { zoom }); await open();
    const send = dialog().getByRole('button', { name: '发送并比较', exact: true }); await send.focus(); assert.equal(await send.evaluate((button) => button === document.activeElement), true); await capture(`120-model-comparison-config-dark-zoom-${zoom * 100}.png`); await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
    await page.locator('.thread-list').getByRole('button', { name: first.title, exact: true }).click(); await page.getByRole('button', { name: '查看模型比较', exact: true }).focus(); await page.keyboard.press('Enter'); await dialog().waitFor();
    const bounds = await dialog().evaluate((element) => { const header = element.querySelector('.modal-header').getBoundingClientRect(); const footer = element.querySelector('.modal-footer').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, headerTop: header.top, footerBottom: footer.bottom, overflow: document.documentElement.scrollWidth > innerWidth }; }); assert.equal(bounds.overflow, false); assert.ok(bounds.headerTop >= 0 && bounds.footerBottom <= bounds.height); layout.push({ zoom, ...bounds });
    const openButton = dialog().locator('.comparison-result').first().getByRole('button', { name: '打开此对话', exact: true }); await openButton.focus(); assert.equal(await openButton.evaluate((button) => button === document.activeElement), true); await capture(`121-model-comparison-results-dark-zoom-${zoom * 100}.png`); await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' }); await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); assert.equal(await composer().inputValue(), question); assert.equal(fixture.requests.length, beforeRequests + 11);
  verified('comparison setup and independently scrollable readonly results retain visible modal title/footer, native keyboard focus and Escape at 100%, 125% and 150% dark minimum-window zoom without making preview requests');
  return { page, result: { checks: 6, comparisonModelRequests: 11, parallelStreamsVerified: true, independentFailureStopVerified: true, atomicSaveRetryVerified: true, backupsRestartVerified: true, temporaryExclusionVerified: true, originalDraftRetainedVerified: true, originalModelIdentityVerified: true, layout, screenshots: captures, scope: 'Native two/four-model setup, duplicate exclusion/cancel, identical complete contexts/attachments/instructions over real HTTP, held streams, actual service failure and targeted stop, actual atomic-save EIO/retry, selected continuation and independent drafts, complete JSON/gzip export/restore, temporary persistence exclusion and normal restart, dark minimum-window zoom/keyboard and inert readonly previews. Native picker/confirmation responses are isolated fixtures; live external providers and physical system dialogs remain separate.' } };
}
