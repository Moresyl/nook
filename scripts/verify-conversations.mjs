import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyConversations({ page, application, directory, screenshots, calls, verified, waitForBridge, restart }) {
  async function theme(value) {
    await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '外观与交互', exact: true }).click();
    await page.getByLabel('主题', { exact: true }).selectOption(value); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  }
  await application.resize(1280, 840); await page.waitForFunction(() => innerWidth === 1280); await theme('light');
  const provider = (await page.evaluate(() => window.qiyao.load())).providers.find((item) => item.kind === 'ollama'); assert.ok(provider);
  await page.keyboard.press('Control+n'); await page.getByLabel('模型提供商', { exact: true }).selectOption(provider.id);
  const composer = page.getByLabel('消息', { exact: true });
  async function send(text) {
    await composer.fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await waitForBridge(page, async (value) => (await window.qiyao.load()).threads.some((thread) => thread.messages.at(-2)?.content === value && thread.messages.at(-1)?.status === 'complete'), text);
    await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  }
  await send('MESSAGE_EDIT_BEFORE');
  const attachment = join(directory, 'history-evidence.txt'); await writeFile(attachment, 'MESSAGE_ATTACHMENT_EVIDENCE');
  await application.evaluateMain(`globalThis.qiyaoHistoryOpenDialog=require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(attachment)}]});`);
  try { await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByText('history-evidence.txt', { exact: true }).waitFor(); }
  finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoHistoryOpenDialog; delete globalThis.qiyaoHistoryOpenDialog;"); }
  await send('MESSAGE_EDIT_ORIGINAL');
  const original = (await page.evaluate(() => window.qiyao.load())).threads.find((item) => item.title === 'MESSAGE_EDIT_BEFORE'); assert.ok(original); assert.equal(original.messages.length, 4);
  const assistant = page.getByLabel('助手回复', { exact: true }).last();
  await composer.fill('保留草稿'); await assistant.hover();
  await assistant.locator('strong').evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const beforeQuote = calls.length; await assistant.getByRole('button', { name: '引用消息', exact: true }).click();
  const quote = await composer.inputValue(); assert.ok(quote.startsWith('保留草稿\n\n')); assert.ok(quote.includes('> 真实流式回复')); assert.ok(!quote.includes('这是通过') && !quote.includes('| 项目 |'));
  assert.equal(calls.length, beforeQuote);
  await page.waitForFunction(() => { const input = document.querySelector('textarea[aria-label="消息"]'); return input && document.activeElement === input && input.selectionStart === input.value.length && input.selectionEnd === input.value.length; });
  await composer.fill('保留草稿'); assert.equal(await composer.inputValue(), '保留草稿');
  await composer.evaluate(async (input) => {
    input.setSelectionRange(0, 2);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (input.selectionStart !== 0 || input.selectionEnd !== 2) throw new Error('Quote focus changed a later text selection.');
  });
  assert.equal(await composer.inputValue(), '保留草稿');
  verified('selected-passage quoting preserves the existing draft, focuses the composer and makes no provider request');
  const user = page.getByLabel('你的消息', { exact: true }).last();
  async function edit() { await user.hover(); await user.getByRole('button', { name: '编辑消息', exact: true }).click(); await page.getByRole('dialog', { name: '编辑消息', exact: true }).waitFor(); }
  await edit(); const editor = page.getByLabel('消息内容', { exact: true }); assert.equal(await editor.inputValue(), 'MESSAGE_EDIT_ORIGINAL');
  await page.getByRole('dialog', { name: '编辑消息', exact: true }).getByRole('button', { name: '预览 history-evidence.txt', exact: true }).click();
  await page.getByRole('dialog', { name: 'history-evidence.txt', exact: true }).getByText('MESSAGE_ATTACHMENT_EVIDENCE', { exact: true }).waitFor();
  await page.getByRole('dialog', { name: 'history-evidence.txt', exact: true }).getByRole('button', { name: '完成', exact: true }).click();
  await editor.fill('  '); assert.equal(await page.getByRole('button', { name: '在新分支中发送', exact: true }).isEnabled(), false);
  await editor.fill('CANCELED_EDIT'); await page.keyboard.press('Control+n'); assert.equal(await page.getByRole('dialog', { name: '编辑消息', exact: true }).count(), 1); await page.keyboard.press('Escape');
  assert.equal(await composer.inputValue(), '保留草稿'); assert.deepEqual((await page.evaluate(() => window.qiyao.load())).threads.find((item) => item.id === original.id), original);
  await edit(); await editor.fill('MESSAGE_EDIT_REPLACEMENT'); await page.screenshot({ path: join(screenshots, '30-message-editor-light.png') });
  await page.getByRole('button', { name: '在新分支中发送', exact: true }).click(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.some((thread) => thread.forkedFrom?.threadId === id && thread.forkedFrom.kind === 'edit' && thread.messages.at(-1)?.status === 'complete'), original.id);
  let state = await page.evaluate(() => window.qiyao.load()); const branch = state.threads.find((item) => item.forkedFrom?.threadId === original.id && item.forkedFrom.kind === 'edit'); assert.ok(branch);
  assert.deepEqual(state.threads.find((item) => item.id === original.id), original); assert.equal(branch.messages.length, 4); assert.equal(branch.messages[2].content, 'MESSAGE_EDIT_REPLACEMENT'); assert.deepEqual(branch.messages[2].attachments, original.messages[2].attachments);
  const request = calls.at(-1); assert.ok(JSON.stringify(request.messages).includes('MESSAGE_ATTACHMENT_EVIDENCE')); assert.ok(!JSON.stringify(request.messages).includes('MESSAGE_EDIT_ORIGINAL')); assert.equal(request.messages.filter((item) => item.role === 'user').length, 2);
  assert.equal(await composer.inputValue(), '保留草稿');
  const beforeRetry = calls.length; await page.getByRole('button', { name: '重新生成', exact: true }).click(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  await waitForBridge(page, async ({ id, messageId }) => { const thread = (await window.qiyao.load()).threads.find((item) => item.id === id); return thread?.messages.at(-1)?.id !== messageId && thread?.messages.at(-1)?.status === 'complete'; }, { id: branch.id, messageId: branch.messages.at(-1).id });
  state = await page.evaluate(() => window.qiyao.load()); assert.equal(calls.length, beforeRetry + 1); assert.equal(state.threads.find((item) => item.id === branch.id).messages.length, 4); assert.deepEqual(state.threads.find((item) => item.id === original.id), original);
  verified('native editing preserves original history and attachments in a new linked branch, retains the composer draft and retries without duplicate user messages');
  await page.getByRole('button', { name: '打开原对话', exact: true }).click(); assert.equal(await composer.inputValue(), '保留草稿'); await theme('dark');
  await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540); await edit(); await editor.fill('STALE_EDIT_MUST_NOT_SEND');
  await page.screenshot({ path: join(screenshots, '31-message-editor-dark-narrow.png') });
  const geometry = await page.getByRole('dialog', { name: '编辑消息', exact: true }).evaluate((element) => { const footer = element.querySelector('.modal-footer').getBoundingClientRect(); return { top: footer.top, bottom: footer.bottom, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }; });
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height); assert.equal(geometry.overflow, false);
  await page.evaluate(async (thread) => { await window.qiyao.updateThread({ ...thread, messages: thread.messages.map((message, index) => index === 3 ? { ...message, content: 'CONCURRENT_HISTORY_EVIDENCE' } : message) }); }, original);
  const beforeStale = calls.length; await page.getByRole('button', { name: '在新分支中发送', exact: true }).click(); await page.getByRole('dialog', { name: '编辑消息', exact: true }).getByText(/conversation changed/).waitFor();
  assert.equal(await editor.inputValue(), 'STALE_EDIT_MUST_NOT_SEND'); assert.equal(calls.length, beforeStale);
  state = await page.evaluate(() => window.qiyao.load()); assert.equal(state.threads.filter((item) => item.forkedFrom?.threadId === original.id && item.forkedFrom.kind === 'edit').length, 1); assert.equal(state.threads.find((item) => item.id === original.id).messages[3].content, 'CONCURRENT_HISTORY_EVIDENCE');
  await page.keyboard.press('Escape'); page = await restart();
  await page.locator('.thread-list').getByRole('button', { name: 'MESSAGE_EDIT_BEFORE · 编辑', exact: true }).click(); await page.getByRole('button', { name: '打开原对话', exact: true }).waitFor(); await page.getByText('history-evidence.txt', { exact: true }).waitFor();
  verified('stale native edits retain their draft and reject concurrent history replacement; dark minimum-window controls and saved branch ancestry survive actual app restart');
  return page;
}
