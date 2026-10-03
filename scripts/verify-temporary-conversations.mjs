import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export async function verifyTemporaryConversations({ page, application, getApplication, endpoint, directory, screenshots, verified, waitForBridge, restart, calls }) {
  const providerId = randomUUID(); const prompt = 'TEMP_CHAT_PRIVATE_PROMPT_SECRET'; const attachmentSecret = 'TEMP_CHAT_ATTACHMENT_SECRET'; const draftSecret = 'TEMP_CHAT_UNSENT_SECRET';
  const provider = { id: providerId, name: '临时聊天验收', kind: 'ollama', endpoint, models: ['verification-model'], hasKey: false };
  await page.evaluate(async (provider) => {
    await window.qiyao.saveProvider(provider); const state = await window.qiyao.load();
    await window.qiyao.savePreferences({ ...state.preferences, theme: 'light', defaultProviderId: provider.id, defaultModel: 'verification-model' });
  }, provider);
  const regular = await page.evaluate((providerId) => window.qiyao.submit({ providerId, model: 'verification-model', text: 'REGULAR_TEMP_CHAT_KEEP', attachments: [] }), providerId);
  await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id)?.messages.at(-1)?.status === 'complete', regular.threadId);
  await page.evaluate(async ({ id, providerId }) => {
    await window.qiyao.saveComposerDraft({ threadId: id, providerId, model: 'verification-model', text: 'REGULAR_THREAD_KEEP', attachments: [{ id: 'regular-attachment', name: '普通资料.txt', content: 'REGULAR_ATTACHMENT_KEEP' }], updatedAt: 1 });
    await window.qiyao.activateThread(id);
  }, { id: regular.threadId, providerId });
  page = await restart(); application = getApplication(); await application.resize(1280, 840);
  const input = () => page.getByLabel('消息', { exact: true }); const files = () => Promise.all(['workspace.json', 'workspace.backup.json'].map((name) => readFile(join(directory, name), 'utf8')));
  const privateData = new Set([prompt, attachmentSecret, draftSecret]); const temporaryIds = new Set();
  const assertPrivateAbsent = (text) => { for (const value of [...privateData, ...temporaryIds]) assert.equal(text.includes(value), false, 'Temporary conversation data must not appear in persistent history or backups.'); };
  const assertHistory = async () => { for (const file of await files()) assertPrivateAbsent(file); };
  assert.equal(await input().inputValue(), 'REGULAR_THREAD_KEEP');
  await page.keyboard.press('Control+n'); await input().fill('REGULAR_NEW_KEEP');
  await waitForBridge(page, async () => (await window.qiyao.load()).composerDrafts.find((draft) => !draft.threadId)?.text === 'REGULAR_NEW_KEEP');
  await page.locator('.thread-list').getByRole('button', { name: 'REGULAR_TEMP_CHAT_KEEP', exact: true }).click(); await input().fill('REGULAR_UI_DRAFT_KEEP');
  await waitForBridge(page, async (id) => (await window.qiyao.load()).composerDrafts.find((draft) => draft.threadId === id)?.text === 'REGULAR_UI_DRAFT_KEEP', regular.threadId);
  const before = await files(); const beforeCalls = calls.length;
  await page.getByRole('button', { name: '临时聊天', exact: true }).click(); await page.getByLabel('临时聊天说明', { exact: true }).waitFor();
  let state = await page.evaluate(() => window.qiyao.load()); const id = state.activeThreadId; const temporary = state.threads.find((thread) => thread.id === id);
  assert.equal(temporary.temporary, true); assert.equal(temporary.messages.length, 0); temporaryIds.add(id);
  assert.equal(await page.getByLabel('模型提供商', { exact: true }).inputValue(), providerId); assert.equal(await page.getByLabel('选择模型', { exact: true }).inputValue(), 'verification-model');
  const attachedPath = join(directory, 'temporary-chat-attachment.txt'); await writeFile(attachedPath, attachmentSecret);
  async function attach() {
    await application.evaluateMain(`globalThis.qiyaoTemporaryOpenDialog=require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(attachedPath)}]});`);
    try { await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByRole('button', { name: '移除 temporary-chat-attachment.txt', exact: true }).waitFor(); }
    finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoTemporaryOpenDialog; delete globalThis.qiyaoTemporaryOpenDialog;"); }
  }
  await input().fill(draftSecret); await attach(); await waitForBridge(page, async (id) => (await window.qiyao.load()).composerDrafts.find((draft) => draft.threadId === id)?.attachments.length === 1, id);
  assert.deepEqual(await files(), before); assert.equal(calls.length, beforeCalls);
  verified('temporary chat creation, native attachment import and unsent input stay in memory without touching either persisted history file or requesting a model');

  await page.locator('.thread-list').getByRole('button', { name: 'REGULAR_TEMP_CHAT_KEEP', exact: true }).click(); assert.equal(await input().inputValue(), 'REGULAR_UI_DRAFT_KEEP'); await page.getByRole('button', { name: '移除 普通资料.txt', exact: true }).waitFor();
  await page.keyboard.press('Control+n'); assert.equal(await input().inputValue(), 'REGULAR_NEW_KEEP');
  await page.locator('.thread-list').getByRole('button', { name: '临时 · 临时聊天', exact: true }).click(); assert.equal(await input().inputValue(), draftSecret); await page.getByRole('button', { name: '移除 temporary-chat-attachment.txt', exact: true }).waitFor();
  await page.locator('.thread-list').getByRole('button', { name: 'REGULAR_TEMP_CHAT_KEEP', exact: true }).click();
  await page.locator('.thread-list').getByRole('button', { name: '临时 · 临时聊天', exact: true }).click(); assert.equal(calls.length, beforeCalls); await assertHistory();
  verified('switching temporary, regular and new chats preserves three independent drafts and their attachments without sending or persisting temporary content');

  await input().fill(prompt); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  try {
    await waitForBridge(page, async (id) => {
      const state = await window.qiyao.load(); const thread = state.threads.find((thread) => thread.id === id); const last = thread?.messages.at(-1);
      window.__qiyaoTemporaryFirstPoll = { polledAt: Date.now(), expectedThreadId: id, activeThreadId: state.activeThreadId, temporary: thread?.temporary, messages: thread?.messages.length, last: last && { id: last.id, status: last.status, characters: last.content.length, tail: last.content.slice(-128) } };
      return last?.status === 'complete';
    }, id);
  } catch (error) {
    const diagnostic = await page.evaluate(async () => {
      const state = await window.qiyao.load();
      return { capturedAt: Date.now(), lastPoll: window.__qiyaoTemporaryFirstPoll, activeThreadId: state.activeThreadId,
        threads: state.threads.filter((thread) => thread.temporary).slice(-12).map((thread) => { const last = thread.messages.at(-1); return { id: thread.id, temporary: thread.temporary, messages: thread.messages.length, last: last && { id: last.id, status: last.status, characters: last.content.length, tail: last.content.slice(-128) } }; }),
        visible: { provider: document.querySelector('[aria-label="模型提供商"]')?.value, model: document.querySelector('[aria-label="选择模型"]')?.value, temporaryDisclosure: Boolean(document.querySelector('[aria-label="临时聊天说明"]')), lastReply: Array.from(document.querySelectorAll('article.message-assistant')).at(-1)?.textContent.slice(-256), sendButton: document.querySelector('[aria-label="发送消息"]')?.disabled } };
    }).catch(() => null);
    console.error('Temporary-send diagnostics', JSON.stringify({ expectedThreadId: id, requestsBefore: beforeCalls, requestsNow: calls.length, recentRequests: calls.slice(beforeCalls).slice(-8).map((request) => ({ model: request.model, messages: request.messages?.length })), diagnostic }));
    throw error;
  } finally { await page.evaluate(() => { delete window.__qiyaoTemporaryFirstPoll; }).catch(() => {}); }
  assert.equal(calls.length, beforeCalls + 1); assert.ok(JSON.stringify(calls.at(-1)).includes(prompt)); assert.ok(JSON.stringify(calls.at(-1)).includes(attachmentSecret));
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await waitForBridge(page, async (id) => { const state = await window.qiyao.load(); return state.threads.some((thread) => thread.temporary && thread.forkedFrom?.threadId === id && thread.forkedFrom.kind === 'reply') && state.threads.find((thread) => thread.id === id)?.messages.at(-1)?.status === 'complete'; }, id);
  assert.equal(calls.length, beforeCalls + 2);
  await page.locator('article.message-user').first().getByRole('button', { name: '从这里创建分支', exact: true }).click();
  await waitForBridge(page, async (id) => { const state = await window.qiyao.load(); return state.threads.find((thread) => thread.id === state.activeThreadId)?.forkedFrom?.threadId === id; }, id);
  state = await page.evaluate(() => window.qiyao.load()); const branchId = state.activeThreadId; assert.equal(state.threads.find((thread) => thread.id === branchId).temporary, true);
  await input().fill('slow TEMP_CHAT_STOPPED_SECRET'); privateData.add('TEMP_CHAT_STOPPED_SECRET'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id)?.messages.at(-1)?.content.includes('First partial response'), branchId);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id)?.messages.at(-1)?.status === 'stopped', branchId);
  await page.locator('article.message-user').first().getByRole('button', { name: '编辑消息', exact: true }).click(); await page.getByLabel('消息内容', { exact: true }).fill('TEMP_CHAT_EDIT_DRAFT_SECRET'); privateData.add('TEMP_CHAT_EDIT_DRAFT_SECRET');
  await waitForBridge(page, async (id) => (await window.qiyao.load()).messageDrafts.some((draft) => draft.threadId === id && draft.content === 'TEMP_CHAT_EDIT_DRAFT_SECRET'), branchId); await page.keyboard.press('Escape');
  state = await page.evaluate(() => window.qiyao.load()); for (const thread of state.threads.filter((thread) => thread.temporary)) temporaryIds.add(thread.id); assert.equal(temporaryIds.size, 3); assert.equal(calls.length, beforeCalls + 3);
  const conversionErrors = await page.evaluate(async ([temporaryId, regularId]) => { const state = await window.qiyao.load(); const messages = []; for (const id of [temporaryId, regularId]) { const thread = state.threads.find((thread) => thread.id === id); const changed = { ...thread }; if (thread.temporary) delete changed.temporary; else changed.temporary = true; try { await window.qiyao.updateThread(changed); } catch (error) { messages.push(String(error)); } } return messages; }, [id, regular.threadId]);
  assert.equal(conversionErrors.length, 2); assert.ok(conversionErrors.every((message) => message.includes('storage mode'))); await assertHistory();
  verified('actual temporary sends, regenerated archives, message branches, stopped partial replies and editing drafts retain their temporary storage mode and never enter persistent history');

  await input().fill(draftSecret); await attach();
  for (const extension of ['json', 'json.gz']) {
    const backup = join(directory, `temporary-excluded.${extension}`);
    await application.evaluateMain(`globalThis.qiyaoTemporarySaveDialog=require('electron').dialog.showSaveDialog; require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
    try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); }
    finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoTemporarySaveDialog; delete globalThis.qiyaoTemporarySaveDialog;"); }
    const bytes = await readFile(backup); const text = (extension.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'); assertPrivateAbsent(text);
    const restored = JSON.parse(text); assert.equal(restored.threads.some((thread) => thread.temporary), false); assert.equal(restored.activeThreadId, regular.threadId);
    assert.equal(restored.composerDrafts.find((draft) => draft.threadId === regular.threadId).text, 'REGULAR_UI_DRAFT_KEEP'); assert.equal(restored.composerDrafts.find((draft) => !draft.threadId).text, 'REGULAR_NEW_KEEP');
  }
  const exported = join(directory, 'temporary-user-export.md');
  await application.evaluateMain(`globalThis.qiyaoTemporarySaveDialog=require('electron').dialog.showSaveDialog; require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(exported)}});`);
  try { assert.equal(await page.evaluate((id) => window.qiyao.exportThread(id), branchId), true); }
  finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoTemporarySaveDialog; delete globalThis.qiyaoTemporarySaveDialog;"); }
  assert.ok((await readFile(exported, 'utf8')).includes(prompt)); await assertHistory();
  verified('actual JSON and gzip workspace exports omit all temporary histories and drafts while preserving regular data; an explicitly requested chat export still saves its selected content');

  const screenshotNames = ['112-temporary-chat-light.png']; await page.screenshot({ path: join(screenshots, screenshotNames[0]) });
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540);
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))"; const layout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page, ({ zoom }) => Math.abs(innerWidth - 760 / zoom) <= 1 && Math.abs(innerHeight - 540 / zoom) <= 1, { zoom });
    await input().focus();
    const geometry = await page.getByLabel('临时聊天说明', { exact: true }).evaluate((element) => { const hint = element.getBoundingClientRect(); const input = document.querySelector('textarea[aria-label="消息"]').getBoundingClientRect(); const send = document.querySelector('button[aria-label="发送消息"]').getBoundingClientRect(); return { hintTop: hint.top, hintBottom: hint.bottom, inputTop: input.top, inputBottom: input.bottom, sendBottom: send.bottom, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, focus: document.activeElement?.getAttribute('aria-label') }; });
    assert.equal(geometry.overflow, false); assert.equal(geometry.focus, '消息'); assert.ok(geometry.hintTop >= 0 && geometry.hintBottom <= geometry.height); assert.ok(geometry.inputTop >= 0 && geometry.inputBottom <= geometry.height && geometry.sendBottom <= geometry.height); layout.push({ zoom, ...geometry });
    const name = `113-temporary-chat-dark-zoom-${Math.round(zoom * 100)}.png`; screenshotNames.push(name);
    const capture = await application.evaluateMain(`(async()=>{const window=${mainWindow}; const image=await window.webContents.capturePage(); return {bytes:image.toPNG().toString('base64'),imageSize:image.getSize(),contentSize:window.getContentSize()};})()`);
    assert.deepEqual([capture.imageSize.width, capture.imageSize.height], capture.contentSize);
    await writeFile(join(screenshots, name), Buffer.from(capture.bytes, 'base64'));
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); await assertHistory();
  verified('temporary chat disclosure, focused input and send controls remain readable and inside the dark minimum window at 100%, 125% and 150% native zoom');

  page = await restart(); application = getApplication(); await application.resize(1280, 840); state = await page.evaluate(() => window.qiyao.load());
  assert.equal(state.threads.some((thread) => thread.temporary || temporaryIds.has(thread.id)), false); assert.equal(state.composerDrafts.some((draft) => temporaryIds.has(draft.threadId)), false); assert.equal(state.messageDrafts.some((draft) => temporaryIds.has(draft.threadId)), false);
  assert.equal(state.activeThreadId, regular.threadId); assert.equal(await input().inputValue(), 'REGULAR_UI_DRAFT_KEEP'); await page.getByRole('button', { name: '移除 普通资料.txt', exact: true }).waitFor();
  assert.equal(await page.getByLabel('模型提供商', { exact: true }).inputValue(), providerId); assert.equal(await page.getByLabel('选择模型', { exact: true }).inputValue(), 'verification-model');
  assert.equal(await page.getByLabel('临时聊天说明', { exact: true }).count(), 0); assert.equal(state.composerDrafts.find((draft) => !draft.threadId).text, 'REGULAR_NEW_KEEP'); assert.equal(calls.length, beforeCalls + 3); await assertHistory();
  verified('normal close and actual application restart erase temporary conversations, reply versions, composer attachments and editing drafts, then restore the last regular conversation and independent new-chat draft');
  return { page, result: { checks: 6, temporaryModelRequests: 3, persistenceExcludedVerified: true, backupsExcludedVerified: true, restartClearedVerified: true, storageModeImmutableVerified: true, regularDraftsRetainedVerified: true, layout, screenshots: screenshotNames, scope: 'Actual temporary creation, isolated draft/attachment switching, local HTTP sends/retry/stop, native branches/editing drafts, original JSON/gzip backup export, explicit Markdown export, immutable existing storage modes, minimum-window zoom and normal restart. Native file dialog responses are isolated fixtures; model providers and explicit exports/tool/plugin actions retain their own results.' } };
}
