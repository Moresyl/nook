import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

async function observeSettingsCopies(application) {
  assert.equal(await application.evaluateMain(`(() => {
    const handlers = require('electron').ipcMain._invokeHandlers;
    if (!(handlers instanceof Map) || typeof handlers.get('qiyao:invoke') !== 'function') return false;
    const original = handlers.get('qiyao:invoke'), originalClone = globalThis.structuredClone;
    const context = new (require('node:async_hooks').AsyncLocalStorage)(); const events = [];
    const clone = function (...args) {
      const row = context.getStore();
      if (row && args[0]?.schemaVersion === 1 && Array.isArray(args[0]?.threads)) row.workspaceCopies += 1;
      if (row && typeof args[0]?.id === 'string' && Array.isArray(args[0]?.messages)) row.threadCopies += 1;
      return originalClone.apply(this, args);
    };
    const handler = function (...args) {
      if (!['saveProvider', 'savePreferences'].includes(args[1])) return original.apply(this, args);
      const row = { operation: args[1], workspaceCopies: 0, threadCopies: 0, startedAt: Date.now() };
      if (events.length < 8) events.push(row);
      return context.run(row, async () => {
        try { const result = await original.apply(this, args); row.success = true; row.resultThreadCount = result.threads.length; return result; }
        finally { row.finishedAt = Date.now(); }
      });
    };
    globalThis.structuredClone = clone; handlers.set('qiyao:invoke', handler);
    globalThis.qiyaoFinishSettingsCopies = () => {
      if (handlers.get('qiyao:invoke') === handler) handlers.set('qiyao:invoke', original);
      if (globalThis.structuredClone === clone) globalThis.structuredClone = originalClone;
      context.disable(); delete globalThis.qiyaoFinishSettingsCopies; return events;
    };
    return true;
  })()`), true);
}

async function observeComparisonBackup(application, mainWindow) {
  assert.equal(await application.evaluateMain(`(() => {
    const handlers = require('electron').ipcMain._invokeHandlers;
    const contents = ${mainWindow}?.webContents;
    if (!(handlers instanceof Map) || typeof handlers.get('qiyao:invoke') !== 'function' || !contents) return false;
    const events = []; const append = row => { events.push(row); if (events.length > 64) events.shift(); };
    const original = handlers.get('qiyao:invoke'); const originalClone = globalThis.structuredClone; const originalSend = contents.send;
    const fs = require('node:fs/promises'); const originalOpen = fs.open; const originalRename = fs.rename;
    const basename = require('node:path').basename;
    const fileRestorers = new Set();
    const fileKind = path => {
      const name = basename(String(path));
      return name.startsWith('workspace.backup.json') ? 'backup' : name.startsWith('workspace.json') ? 'workspace' : undefined;
    };
    const timed = async (operation, file, invoke) => {
      const row = { operation, file, startedAt: Date.now() }; append(row);
      try { const result = await invoke(); row.success = true; return result; }
      catch (error) { row.success = false; throw error; }
      finally { row.finishedAt = Date.now(); }
    };
    const open = async function (...args) {
      const file = fileKind(args[0]);
      if (!file) return originalOpen.apply(this, args);
      const handle = await timed('file-open', file, () => originalOpen.apply(this, args));
      const originals = new Map();
      const restore = () => { for (const [name, entry] of originals) if (handle[name] === entry.wrapper) handle[name] = entry.original; fileRestorers.delete(restore); };
      for (const name of ['writeFile', 'sync', 'close']) {
        const original = handle[name];
        const wrapper = async function (...values) {
          try { return await timed('file-' + name, file, () => original.apply(this, values)); }
          finally { if (name === 'close') restore(); }
        };
        originals.set(name, { original, wrapper }); handle[name] = wrapper;
      }
      fileRestorers.add(restore); return handle;
    };
    const rename = function (...args) {
      const file = fileKind(args[1]);
      return file ? timed('file-rename', file, () => originalRename.apply(this, args)) : originalRename.apply(this, args);
    };
    const observed = new Set(['saveComposerDraft', 'activateThread', 'exportWorkspace', 'finishDraftFlush']);
    const handler = async function (...args) {
      if (!observed.has(args[1])) return original.apply(this, args);
      const row = { operation: args[1], startedAt: Date.now(), ...(args[1] === 'activateThread' && Array.isArray(args[3]) ? { batchedDrafts: args[3].length } : {}) }; append(row);
      try { const result = await original.apply(this, args); row.success = true; return result; }
      catch (error) { row.success = false; throw error; }
      finally { row.finishedAt = Date.now(); }
    };
    const clone = function (...args) {
      if (args[0]?.schemaVersion !== 1 || !Array.isArray(args[0]?.threads)) return originalClone.apply(this, args);
      const row = { operation: 'workspace-clone', startedAt: Date.now(), threads: args[0].threads.length }; append(row);
      try { return originalClone.apply(this, args); } finally { row.finishedAt = Date.now(); }
    };
    const send = function (...args) {
      if (args[0] === 'qiyao:flush-drafts') append({ operation: 'request-renderer-flush', startedAt: Date.now() });
      return originalSend.apply(this, args);
    };
    handlers.set('qiyao:invoke', handler); globalThis.structuredClone = clone; contents.send = send;
    fs.open = open; fs.rename = rename;
    globalThis.qiyaoFinishComparisonBackupObserver = () => {
      if (handlers.get('qiyao:invoke') === handler) handlers.set('qiyao:invoke', original);
      if (globalThis.structuredClone === clone) globalThis.structuredClone = originalClone;
      if (contents.send === send) contents.send = originalSend;
      if (fs.open === open) fs.open = originalOpen;
      if (fs.rename === rename) fs.rename = originalRename;
      for (const restore of [...fileRestorers]) restore();
      delete globalThis.qiyaoFinishComparisonBackupObserver;
      return { events, capturedAt: Date.now(), memory: process.memoryUsage(), cpu: process.cpuUsage(), pendingRequests: process._getActiveRequests().map(request => request.constructor.name) };
    };
    return true;
  })()`), true);
}

export async function verifyModelComparisons({ page, application, getApplication, endpoint, directory, screenshots, fixture, verified, waitForBridge, restart }) {
  const beforeRequests = fixture.requests.length; const providerA = randomUUID(); const providerB = randomUUID(); const projectId = randomUUID(); const sourceId = randomUUID(); const question = 'COMPARE_SAME_QUESTION 中文 <img> {{literal}}';
  const attachment = { id: randomUUID(), name: '比较资料.txt', content: 'COMPARE_ATTACHMENT_EXACT' };
  const baseMessages = [{ id: randomUUID(), role: 'user', content: 'COMPARE_PREVIOUS_USER', attachments: [attachment], createdAt: 1, status: 'complete' }, { id: randomUUID(), role: 'assistant', content: 'COMPARE_PREVIOUS_REPLY', attachments: [], createdAt: 2, status: 'complete' }];
  const now = Date.now();
  const source = { id: sourceId, title: `模型比较原对话 ${sourceId.slice(0, 8)}`, providerId: providerA, model: 'one', assistantId: 'general', projectId, mode: 'agent', messages: baseMessages, pinned: false, archived: false, createdAt: now, updatedAt: now };
  await observeSettingsCopies(application); let settingsTransactions;
  try {
  await page.evaluate(async ({ providerA, providerB, endpoint, projectId, directory }) => {
    for (const [id, connection] of [[providerA, 'a'], [providerB, 'b']]) await window.qiyao.saveProvider({ id, name: `比较连接 ${connection.toUpperCase()}`, kind: 'openai', endpoint: new URL(`/model-comparison/${connection}/v1`, endpoint).href, models: ['one', 'two', 'fail', 'held'], hasKey: false }, `COMPARISON_${connection.toUpperCase()}_TEST_KEY`);
    await window.qiyao.saveProject({ id: projectId, name: '比较项目', path: directory, instructions: 'COMPARE_PROJECT_INSTRUCTIONS', createdAt: 1 });
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light', defaultProviderId: providerA, defaultModel: 'one' });
  }, { providerA, providerB, endpoint, projectId, directory });
  } finally {
    settingsTransactions = await application.evaluateMain('globalThis.qiyaoFinishSettingsCopies?.()');
    console.log('Comparison settings transactions', JSON.stringify(settingsTransactions));
  }
  assert.deepEqual(settingsTransactions.map(({ operation, workspaceCopies, success }) => ({ operation, workspaceCopies, success })), [
    { operation: 'saveProvider', workspaceCopies: 0, success: true },
    { operation: 'saveProvider', workspaceCopies: 0, success: true },
    { operation: 'savePreferences', workspaceCopies: 0, success: true },
  ]);
  for (const row of settingsTransactions) assert.equal(row.threadCopies, row.resultThreadCount);
  page = await restart(async () => {
    const path = join(directory, 'workspace.json'); const state = JSON.parse(await readFile(path, 'utf8')); state.threads.push(source); state.activeThreadId = sourceId;
    state.composerDrafts.push({ threadId: sourceId, providerId: providerA, model: 'one', assistantId: 'general', projectId, mode: 'agent', text: question, attachments: [attachment], mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: 1 }); await writeFile(path, JSON.stringify(state));
  }); application = getApplication(); await application.resize(1280, 840);
  const composer = () => page.getByLabel('消息', { exact: true }); const dialog = () => page.getByRole('dialog', { name: '模型比较', exact: true }); const captures = [];
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  async function capture(name) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await dialog().isVisible(), true); const result = await application.evaluateMain(`(async()=>{const window=${mainWindow};const image=await window.capturePage();return {png:image.toPNG().toString('base64'),size:window.getContentSize()};})()`); const bytes = Buffer.from(result.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], result.size); await writeFile(join(screenshots, name), bytes); captures.push(name); }
  async function open() { await page.getByRole('button', { name: '发送给多个模型比较', exact: true }).click(); await dialog().waitFor(); await dialog().getByLabel('比较连接 2', { exact: true }).selectOption(providerB); await dialog().getByLabel('比较模型 2', { exact: true }).selectOption('two'); }
  async function close() { await dialog().locator('.modal-footer').getByRole('button', { name: '关闭', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
  const groups = []; const group = (groupId) => page.evaluate(async (id) => (await window.qiyao.load()).threads.filter((thread) => thread.comparison?.groupId === id).sort((a, b) => a.comparison.index - b.comparison.index), groupId);
  async function currentGroup() { return page.evaluate(async () => (await window.qiyao.load()).threads.findLast((thread) => thread.comparison)?.comparison.groupId); }
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
  // Only this complete draft is used here; avoid serializing unrelated large histories through CDP.
  const originalDraft = await page.evaluate(async id => (await window.qiyao.load()).composerDrafts.find(draft => draft.threadId === id), sourceId);
  async function submitGroup(expectedReplies) {
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
      await dialog().getByLabel(`回复 ${expectedReplies}`, { exact: true }).waitFor();
      const diagnostic = await page.evaluate(() => window.__qiyaoComparisonSetup.diagnostic);
      assert.equal(diagnostic.clicks.length, 1); assert.equal(diagnostic.clicks[0].trusted, true);
      console.log('Comparison response timing', JSON.stringify({ expectedReplies, waitStartedAt, completedAt: Date.now(), unchangedResponseDeadlineMs: 30000, diagnostic }));
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
      console.error('Comparison response diagnostics', JSON.stringify({ expectedReplies, waitStartedAt, waitFailedAt, unchangedResponseDeadlineMs: 30000, diagnostic, requestsAtFailure, requestTimelineAtFailure,
        backendCaptureStartedAt, backendCaptureCompletedAt, backend, requestTimelineAfterCapture: fixture.timeline.slice(-16), applicationSnapshot }));
      throw error;
    } finally { await page.evaluate(() => { window.__qiyaoComparisonSetup?.clear(); delete window.__qiyaoComparisonSetup; }).catch(() => {}); }
  }
  await open(); assert.equal(await dialog().getByLabel('本次比较问题', { exact: true }).inputValue(), question); await dialog().getByLabel('比较连接 2', { exact: true }).selectOption(providerA); await dialog().getByLabel('比较模型 2', { exact: true }).selectOption('one'); assert.equal(await dialog().getByRole('button', { name: '发送并比较', exact: true }).isEnabled(), false);
  await capture('117-model-comparison-config-light.png'); await close(); assert.equal(await composer().inputValue(), question); assert.equal(fixture.requests.length, beforeRequests);
  verified('native comparison setup preserves literal question, complete attachments and original owner/draft, rejects duplicate provider/model pairs and cancels without requesting a model');

  await open(); await submitGroup(1); await waitForBridge(page, () => document.querySelectorAll('.comparison-result').length === 2); await waitPartial();
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
  await submitGroup(4); await waitForBridge(page, () => Array.from(document.querySelectorAll('.comparison-result textarea')).slice(1).every((input) => input.value.includes('PARTIAL')));
  assert.equal(fixture.requests.length, beforeRequests + 6); const fourGroup = await currentGroup(); groups.push(fourGroup); fixture.finish(); await dialog().locator('.comparison-result').nth(1).getByRole('button', { name: '停止此回复', exact: true }).click(); await waitCompleted(fourGroup);
  assert.deepEqual((await group(fourGroup)).map((thread) => thread.messages.at(-1).status), ['error', 'stopped', 'complete', 'complete']); assert.ok((await dialog().locator('.comparison-result').nth(1).getByLabel('回复 2', { exact: true }).inputValue()).includes('held: PARTIAL')); await close(); assert.equal(await composer().inputValue(), question);
  verified('four independent real requests retain an actual HTTP failure and stopped partial response while the other two complete; native stopping targets only its selected reply');

  const primary = join(directory, 'workspace.json'); const failureLayouts = [];
  async function failSave(theme, zoom, filename, captureBusy = false) {
  const beforeFailure = await readFile(primary); const beforeState = await page.evaluate(() => window.qiyao.load());
  await application.evaluateMain(`(() => {
    const fs = require('node:fs/promises'); const original = fs.rename;
    let release; const held = new Promise(resolve => { release = resolve; });
    globalThis.nookComparisonSaveReceipt = { original, release, entered: false };
    fs.rename = async (source, target) => {
      if (target === ${JSON.stringify(primary)}) { globalThis.nookComparisonSaveReceipt.entered = true; await held; throw Object.assign(new Error('Fixture comparison write failure'), { code: 'EIO' }); }
      return original(source, target);
    };
  })()`);
  try {
    await dialog().getByRole('button', { name: '发送并比较', exact: true }).click();
    assert.equal(await application.evaluateMain(`(async () => {
      const deadline = Date.now() + 5000;
      while (!globalThis.nookComparisonSaveReceipt.entered) {
        if (Date.now() >= deadline) throw new Error('The actual comparison save did not reach the held rename within five seconds.');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return true;
    })()`), true);
    assert.equal(await dialog().locator(':scope > .modal-header').getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
    assert.equal(await dialog().locator(':scope > .modal-footer').getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
    assert.equal(await dialog().getByRole('button', { name: '发送并比较', exact: true }).isDisabled(), true);
    assert.equal(await dialog().getByLabel('比较连接 1', { exact: true }).isDisabled(), true);
    if (captureBusy) await capture('model-comparison-save-busy-light.png');
    await page.keyboard.press('Escape'); assert.equal(await dialog().isVisible(), true);
    assert.equal(fixture.requests.length, beforeRequests + 6);
    await application.evaluateMain('globalThis.nookComparisonSaveReceipt.release()');
    const alert = dialog().locator('.modal-content').getByRole('alert'); await alert.waitFor();
    assert.equal(fixture.requests.length, beforeRequests + 6); assert.deepEqual(await readFile(primary), beforeFailure); assert.deepEqual(await page.evaluate(() => window.qiyao.load()), beforeState); assert.equal(await dialog().getByLabel('本次比较问题', { exact: true }).inputValue(), question);
    const feedbackBounds = await alert.evaluate((element) => {
      const content = element.closest('.modal-content'); const rect = element.getBoundingClientRect(); const container = content.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportTop: container.top + content.clientTop, viewportBottom: container.top + content.clientTop + content.clientHeight, viewportLeft: container.left + content.clientLeft, viewportRight: container.left + content.clientLeft + content.clientWidth, scrollTop: content.scrollTop, text: element.textContent, width: innerWidth, height: innerHeight, theme: document.documentElement.dataset.theme };
    });
    console.log('Comparison save failure viewport', JSON.stringify(feedbackBounds));
    await capture(filename); failureLayouts.push({ zoom, ...feedbackBounds });
    assert.equal(feedbackBounds.theme, theme);
    assert.equal(feedbackBounds.text, '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。');
    assert.ok(feedbackBounds.top >= feedbackBounds.viewportTop && feedbackBounds.bottom <= feedbackBounds.viewportBottom && feedbackBounds.left >= feedbackBounds.viewportLeft && feedbackBounds.right <= feedbackBounds.viewportRight, 'The actual save error must be fully readable within the modal content viewport without manual scrolling.');
  }
  finally { await application.evaluateMain("(() => {const receipt=globalThis.nookComparisonSaveReceipt;require('node:fs/promises').rename=receipt.original;receipt.release();delete globalThis.nookComparisonSaveReceipt;})()"); }
  }
  await open(); await failSave('light', 1, '119-model-comparison-save-error-light.png', true);
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await close(); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await composer().waitFor(); await application.resize(760, 540);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page, ({ theme, zoom }) => document.documentElement.dataset.theme === theme && Math.abs(innerWidth - 760 / zoom) <= 1 && Math.abs(innerHeight - 540 / zoom) <= 1, { theme, zoom });
    await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click(); await open();
    await failSave(theme, zoom, `model-comparison-save-error-${theme}-zoom-${zoom * 100}.png`);
  }
  await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().getByLabel('回复 2', { exact: true }).waitFor();
  const retryHeading = await dialog().locator('.comparison-result').first().getByRole('heading', { level: 3 }).evaluate(element => {
    const rect = element.getBoundingClientRect(); const content = element.closest('.modal-content'); const viewport = content.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportTop: viewport.top + content.clientTop, viewportBottom: viewport.top + content.clientTop + content.clientHeight, scrollTop: content.scrollTop };
  });
  console.log('Comparison retry first heading viewport', JSON.stringify(retryHeading)); await capture('model-comparison-retry-first-reply-dark-150.png');
  assert.ok(retryHeading.top >= retryHeading.viewportTop && retryHeading.bottom <= retryHeading.viewportBottom, 'A successful retry must reveal the first reply heading without retaining the error-form scroll position.');
  await waitPartial(); const retryGroup = await currentGroup(); groups.push(retryGroup);
  const manualScroll = await dialog().locator(':scope > .modal-content').evaluate(content => { content.scrollTop = Math.min(80, (content.scrollHeight - content.clientHeight) / 2); return content.scrollTop; });
  assert.ok(manualScroll > 0, 'The narrow result viewport must permit manual scrolling.');
  fixture.finish(); await waitCompleted(retryGroup);
  const completedScroll = await dialog().locator(':scope > .modal-content').evaluate(content => content.scrollTop);
  assert.equal(completedScroll, manualScroll, 'Completing streamed replies must preserve the user-selected scroll position within the same group.');
  await close();
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  verified('held actual group save disables header/footer close and settings, rejects Escape, then exposes the complete Chinese EIO alert within the scroll viewport while preserving original history/draft/selections and zero requests; retry creates exactly two independent responses');

  await page.getByRole('button', { name: '临时聊天', exact: true }).click(); await page.getByLabel('临时聊天说明', { exact: true }).waitFor(); await composer().fill('COMPARE_TEMP_PRIVATE_QUESTION'); await open(); await dialog().getByRole('button', { name: '发送并比较', exact: true }).click(); await dialog().getByLabel('回复 2', { exact: true }).waitFor(); await waitPartial(); const temporaryGroup = await currentGroup(); fixture.finish(); await waitCompleted(temporaryGroup); assert.ok((await group(temporaryGroup)).every((thread) => thread.temporary)); await close();
  await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click(); assert.equal(await composer().inputValue(), question);
  const first = (await group(firstGroup))[0]; first.title = `比较模型一继续 ${first.id}`; await page.evaluate((thread) => window.qiyao.updateThread(thread), first); await page.reload(); await composer().waitFor(); await page.locator('.thread-list').getByRole('button', { name: first.title, exact: true }).click(); await page.getByLabel('模型提供商', { exact: true }).selectOption(providerB); await page.getByLabel('选择模型', { exact: true }).selectOption('two'); await composer().fill('COMPARE_SELECTED_CONTINUATION');
  const observerInstalled = await getApplication().evaluateMain(`(() => {
    const handlers = require('electron').ipcMain._invokeHandlers;
    const contents = require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/'))?.webContents;
    if (!(handlers instanceof Map) || typeof handlers.get('qiyao:invoke') !== 'function' || !contents) return false;
    const target = ${JSON.stringify(first.id)};
    const data = globalThis.qiyaoComparisonContinuationObservations = { installedAt: Date.now(), loads: [], clones: [], wholeWorkspaceCopies: 0, sends: [], operations: [] };
    const append = (list, row) => { try { list.push(row); if (list.length > 64) list.shift(); } catch {} };
    const summarizeThread = thread => {
      const last = thread?.messages.at(-1);
      return { threadFound: Boolean(thread), messageCount: thread?.messages.length,
        lastUserMatches: thread?.messages.at(-2)?.content === 'COMPARE_SELECTED_CONTINUATION',
        lastStatus: last?.status, contentCharacters: last?.content.length, hasPartial: last?.content.includes('PARTIAL') };
    };
    const summarize = state => summarizeThread(state?.threads?.find(item => item.id === target));
    const originalHandler = handlers.get('qiyao:invoke');
    const handler = async function (...args) {
      if (['saveComposerDraft', 'activateThread', 'submit'].includes(args[1])) {
        const operation = { method: args[1], startedAt: Date.now() }; append(data.operations, operation);
        try { const result = await originalHandler.apply(this, args); operation.success = true; return result; }
        catch (error) { operation.success = false; throw error; }
        finally { operation.finishedAt = Date.now(); }
      }
      if (args[1] !== 'load') return originalHandler.apply(this, args);
      const row = { startedAt: Date.now() };
      try {
        const state = await originalHandler.apply(this, args);
        try { row.returnedAt = Date.now(); row.thread = summarize(state); } catch {}
        return state;
      } finally { try { row.finishedAt = Date.now(); append(data.loads, row); } catch {} }
    };
    const originalClone = globalThis.structuredClone;
    const clone = function (...args) {
      const startedAt = Date.now();
      const result = originalClone.apply(this, args);
      try {
        if (args[0]?.schemaVersion === 1 && Array.isArray(args[0]?.threads)) data.wholeWorkspaceCopies++;
        if (args[0]?.id === target && Array.isArray(args[0]?.messages)) append(data.clones,
          { startedAt, completedAt: Date.now(), thread: summarizeThread(result) });
      } catch {}
      return result;
    };
    const originalSend = contents.send;
    const send = function (...args) {
      const event = args[1];
      if (args[0] !== 'qiyao:run' || event?.threadId !== target) return originalSend.apply(this, args);
      const row = { startedAt: Date.now() };
      try { row.hasState = Boolean(event.state); row.deltaCharacters = event.delta?.length; row.hasPartialDelta = event.delta?.includes('PARTIAL');
        if (event.state) row.thread = summarize(event.state); } catch {}
      try { return originalSend.apply(this, args); }
      finally { try { row.completedAt = Date.now(); append(data.sends, row); } catch {} }
    };
    handlers.set('qiyao:invoke', handler); globalThis.structuredClone = clone; contents.send = send;
    globalThis.qiyaoRestoreComparisonContinuationObservers = () => {
      if (handlers.get('qiyao:invoke') === handler) handlers.set('qiyao:invoke', originalHandler);
      if (globalThis.structuredClone === clone) globalThis.structuredClone = originalClone;
      if (contents.send === send) contents.send = originalSend;
    };
    return true;
  })()`);
  assert.equal(observerInstalled, true, 'The exact owned native process must support all continuation observations.');
  await page.evaluate(() => { globalThis.qiyaoComparisonContinuationPolls = []; });
  const sendStartedAt = Date.now();
  let continuationPhase = 'partial';
  const collectContinuation = async () => ({ phase: continuationPhase, sendStartedAt, capturedAt: Date.now(), originalDeadlineMs: 10_000, originalPollIntervalMs: 100,
    expectedServerRequests: beforeRequests + 11, serverRequests: fixture.requests.length, timeline: fixture.timeline.slice(-4),
    rendererPolls: await page.evaluate(() => globalThis.qiyaoComparisonContinuationPolls).catch(() => undefined),
    native: await getApplication().evaluateMain('({observations:globalThis.qiyaoComparisonContinuationObservations,closeOperations:globalThis.qiyaoCloseOperations?.slice(-16),transport:globalThis.qiyaoModelTransportEvents?.filter(item=>item.path.startsWith("/model-comparison/")).slice(-4),memory:process.memoryUsage(),cpu:process.cpuUsage(),capturedAt:Date.now()})').catch(() => undefined) });
  try {
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await waitForBridge(page, async ({ id, count }) => {
      const startedAt = Date.now();
      const thread = (await window.qiyao.load()).threads.find((item) => item.id === id);
      const reached = thread?.messages.length === count + 2 && thread.messages.at(-2)?.content === 'COMPARE_SELECTED_CONTINUATION' && thread.messages.at(-1)?.status === 'running' && thread.messages.at(-1)?.content.includes('PARTIAL');
      globalThis.qiyaoComparisonContinuationPolls.push({ phase: 'partial', startedAt, completedAt: Date.now(), expectedMessageCount: count + 2, messageCount: thread?.messages.length,
        lastUserMatches: thread?.messages.at(-2)?.content === 'COMPARE_SELECTED_CONTINUATION', lastStatus: thread?.messages.at(-1)?.status,
        hasPartial: thread?.messages.at(-1)?.content.includes('PARTIAL'), reached: Boolean(reached) });
      if (globalThis.qiyaoComparisonContinuationPolls.length > 16) globalThis.qiyaoComparisonContinuationPolls.shift();
      return reached;
    }, { id: first.id, count: first.messages.length });
    assert.equal(fixture.requests.length, beforeRequests + 11);
    console.log('Comparison continuation partial observations', JSON.stringify(await collectContinuation()));
    fixture.finish(); continuationPhase = 'complete';
    await waitForBridge(page, async (id) => {
      const startedAt = Date.now();
      const thread = (await window.qiyao.load()).threads.find((thread) => thread.id === id);
      const reached = thread?.messages.at(-1)?.status === 'complete';
      globalThis.qiyaoComparisonContinuationPolls.push({ phase: 'complete', startedAt, completedAt: Date.now(), messageCount: thread?.messages.length,
        lastStatus: thread?.messages.at(-1)?.status, hasPartial: thread?.messages.at(-1)?.content.includes('PARTIAL'), reached });
      if (globalThis.qiyaoComparisonContinuationPolls.length > 16) globalThis.qiyaoComparisonContinuationPolls.shift();
      return reached;
    }, first.id);
    const continuation = await collectContinuation();
    assert.ok(continuation.native.observations.loads.length > 0);
    assert.ok(continuation.native.observations.clones.length > 0);
    assert.equal(continuation.native.observations.wholeWorkspaceCopies, 0);
    assert.ok(continuation.native.observations.clones.some(row => row.thread.hasPartial));
    assert.ok(continuation.native.observations.sends.some(event => event.hasPartialDelta));
    assert.equal(continuation.native.transport.at(-1).statusCode, 200);
    console.log('Comparison continuation completed observations', JSON.stringify(continuation));
  } catch (error) {
    console.error('Comparison continuation failure observations', JSON.stringify(await collectContinuation()));
    throw error;
  } finally {
    await getApplication().evaluateMain('globalThis.qiyaoRestoreComparisonContinuationObservers?.()').catch(() => {});
  }
  await observeComparisonBackup(application, mainWindow);
  assert.ok(JSON.stringify(fixture.requests.at(-1).messages).includes('one: COMPLETE')); assert.equal(fixture.requests.length, beforeRequests + 11); assert.equal(fixture.requests.at(-1).connection, 'b'); assert.equal(fixture.requests.at(-1).model, 'two'); await composer().fill('COMPARE_CHILD_DRAFT_KEEP'); await page.getByRole('button', { name: '查看模型比较', exact: true }).click(); assert.ok((await dialog().getByLabel('回复 1', { exact: true }).inputValue()).includes('one: COMPLETE')); assert.equal(await dialog().locator('.comparison-result').first().getByRole('heading', { level: 3 }).textContent(), '比较连接 A · one'); await close();
  await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click(); assert.equal(await composer().inputValue(), question); const backupPaths = [];
  for (const extension of ['json', 'json.gz']) {
    const backup = join(directory, `model-comparison.${extension}`); backupPaths.push(backup); await application.evaluateMain(`globalThis.qiyaoComparisonSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
    if (extension !== 'json') await observeComparisonBackup(application, mainWindow);
    try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); }
    finally {
      console.log('Comparison backup flush observations', extension, JSON.stringify(await application.evaluateMain('globalThis.qiyaoFinishComparisonBackupObserver?.()').catch(() => ({ unavailable: true }))));
      await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoComparisonSave;delete globalThis.qiyaoComparisonSave;");
    }
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
    const send = dialog().getByRole('button', { name: '发送并比较', exact: true }); await send.focus(); assert.equal(await send.evaluate((button) => button === document.activeElement), true); await capture(`120-model-comparison-config-dark-zoom-${zoom * 100}.png`); await dismissModalWithEscape(page, dialog());
    await page.locator('.thread-list').getByRole('button', { name: first.title, exact: true }).click(); await page.getByRole('button', { name: '查看模型比较', exact: true }).focus(); await page.keyboard.press('Enter'); await dialog().waitFor();
    const bounds = await dialog().evaluate((element) => { const header = element.querySelector('.modal-header').getBoundingClientRect(); const footer = element.querySelector('.modal-footer').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, headerTop: header.top, footerBottom: footer.bottom, overflow: document.documentElement.scrollWidth > innerWidth }; }); assert.equal(bounds.overflow, false); assert.ok(bounds.headerTop >= 0 && bounds.footerBottom <= bounds.height); layout.push({ zoom, ...bounds });
    const openButton = dialog().locator('.comparison-result').first().getByRole('button', { name: '打开此对话', exact: true }); await openButton.focus(); assert.equal(await openButton.evaluate((button) => button === document.activeElement), true); await capture(`121-model-comparison-results-dark-zoom-${zoom * 100}.png`); await dismissModalWithEscape(page, dialog()); await page.locator('.thread-list').getByRole('button', { name: source.title, exact: true }).click();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); assert.equal(await composer().inputValue(), question); assert.equal(fixture.requests.length, beforeRequests + 11);
  verified('comparison setup and independently scrollable readonly results retain visible modal title/footer, native keyboard focus and Escape at 100%, 125% and 150% dark minimum-window zoom without making preview requests');
  return { page, result: { checks: 6, settingsTransactions, comparisonModelRequests: 11, parallelStreamsVerified: true, independentFailureStopVerified: true, atomicSaveRetryVerified: true, busyDismissalVerified: true, saveFailureViewportVerified: true, saveFailureLayouts: failureLayouts, retryHeading, backupsRestartVerified: true, temporaryExclusionVerified: true, originalDraftRetainedVerified: true, originalModelIdentityVerified: true, layout, screenshots: captures, scope: 'Native two/four-model setup, duplicate exclusion/cancel, identical complete contexts/attachments/instructions over real HTTP, held streams, actual service failure and targeted stop, actual atomic-save EIO/retry, selected continuation and independent drafts, complete JSON/gzip export/restore, temporary persistence exclusion and normal restart, dark minimum-window zoom/keyboard and inert readonly previews. Native picker/confirmation responses are isolated fixtures; live external providers and physical system dialogs remain separate.' } };
}
