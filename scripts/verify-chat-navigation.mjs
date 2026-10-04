import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyChatNavigation({ page, application, getApplication, endpoint, directory, screenshots, fixture, verified, waitForBridge, restart }) {
  const threadId = randomUUID(); const threadTitle = `BODY_SCOPE_EXCLUDED_${threadId}`; const providerId = randomUUID(); const messages = [];
  for (let index = 0; index < 20; index++) {
    messages.push({ id: randomUUID(), role: 'user', content: `NAV_USER_${index} 中文😀\n${index === 0 || index === 5 ? 'needle.a* [literal] <img>\n' : ''}${'请保留这条消息的原文。\n'.repeat(3)}`, createdAt: index * 2 + 1, status: 'complete', attachments: [] });
    let content = index === 0 ? `Inline **cross** node match. needle.a* [literal]\n\n\`\`\`ts\n${'const padding = 0;\n'.repeat(32)}CODE_NEEDLE = "needle.a*";\n${' '.repeat(200)}HORIZONTAL_FIND_TARGET\n\`\`\`` : `NAV_REPLY_${index}\n\n${index === 2 ? 'Σ σ ς\n\n' : ''}${'这是已经保存的助手回复。\n\n'.repeat(3)}`;
    if (index === 0) content += '\n\n```mermaid\ngraph LR\n  SOURCE_GRAPH_ID[可见节点]\n```';
    messages.push({ id: randomUUID(), role: 'assistant', content, createdAt: index * 2 + 2, status: 'complete', attachments: [] });
  }
  const attachment = { id: randomUUID(), name: 'BODY_SCOPE_EXCLUDED.txt', content: 'ORIGINAL_FIND_DRAFT_ATTACHMENT' };
  await page.evaluate(async ({ providerId, endpoint }) => {
    await window.qiyao.saveProvider({ id: providerId, name: '聊天导航验证', kind: 'openai', endpoint: new URL('/chat-navigation/v1', endpoint).href, models: ['chat-navigation-model'], hasKey: false }, 'CHAT_NAVIGATION_TEST_KEY');
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
  }, { providerId, endpoint });
  page = await restart(async () => {
    const path = join(directory, 'workspace.json'); const state = JSON.parse(await readFile(path, 'utf8'));
    const createdAt = Date.now();
    state.threads.push({ id: threadId, title: threadTitle, model: 'chat-navigation-model', providerId, pinned: false, archived: false, createdAt, updatedAt: createdAt, messages });
    await writeFile(path, JSON.stringify(state));
  }); application = getApplication();
  await page.evaluate(async ({ threadId, providerId, attachment }) => { await window.qiyao.saveComposerDraft({ threadId, text: 'CHAT_NAV_DRAFT_KEEP', attachments: [attachment], providerId, model: 'chat-navigation-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() }); await window.qiyao.activateThread(threadId); }, { threadId, providerId, attachment });
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";
  async function nativeZoom(zoom) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    const [width, height] = await application.evaluateMain(`${mainWindow}.getContentSize()`);
    await page.waitForFunction(({ zoom, width, height }) => Math.abs(innerWidth - width / zoom) <= 1 && Math.abs(innerHeight - height / zoom) <= 1, { zoom, width, height });
  }
  await page.reload(); await application.resize(1280, 840); await nativeZoom(1); await page.getByLabel('消息', { exact: true }).waitFor();
  const rail = () => page.getByRole('navigation', { name: '用户消息导航', exact: true }); const marker = (number) => rail().getByRole('button', { name: `跳转到第 ${number} 条用户消息`, exact: true });
  const find = () => page.getByRole('search', { name: '查找当前聊天', exact: true }); const input = () => find().getByRole('textbox', { name: '查找文字', exact: true }); const counter = () => find().getByRole('status', { name: '查找结果', exact: true });
  async function capture(name) { await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};const image=await window.capturePage();return {png:image.toPNG().toString('base64'),size:window.getContentSize()};})()`); const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size); await writeFile(join(screenshots, name), bytes); }
  async function search(query, count) { await input().fill(query); await counter().getByText(count ? `1 / ${count}` : '无匹配结果', { exact: true }).waitFor(); await page.waitForFunction((count) => (CSS.highlights.get('qiyao-chat-search')?.size ?? 0) === count, count); }
  assert.equal(await rail().getByRole('button').count(), 20); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP');
  await marker(1).click(); await page.waitForFunction((id) => { const article = [...document.querySelectorAll('[data-message-id]')].find((element) => element.dataset.messageId === id); const scroll = document.querySelector('.transcript-scroll'); return article.getBoundingClientRect().top >= scroll.getBoundingClientRect().top && article.getBoundingClientRect().top < scroll.getBoundingClientRect().top + 70; }, messages[0].id);
  await marker(1).focus(); await marker(1).press('ArrowDown'); assert.equal(await marker(2).evaluate((element) => element === document.activeElement), true); await marker(2).press('Enter'); await page.waitForFunction(() => document.querySelector('.message-navigation button[aria-current="true"]')?.getAttribute('aria-label') === '跳转到第 2 条用户消息'); await marker(2).press('Home'); assert.equal(await marker(1).evaluate((element) => element === document.activeElement), true);
  await marker(1).hover(); await page.getByRole('tooltip').getByText(/NAV_USER_0/).waitFor(); const reference = await marker(1).locator('.message-navigation-marker').evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })); assert.deepEqual(reference, { width: 26, height: 2 }); await capture('102-message-navigation-light.png');
  const animation = marker(1).locator('.message-navigation-marker > span'); assert.equal(await animation.evaluate((element) => getComputedStyle(element).transitionDuration), '0.16s'); await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await animation.evaluate((element) => getComputedStyle(element).transitionDuration), '0s'); await page.emulateMedia({ reducedMotion: 'no-preference' }); assert.equal(await animation.evaluate((element) => getComputedStyle(element).transitionDuration), '0.16s');
  const first = await marker(1).boundingBox(); const third = await marker(3).boundingBox(); assert.ok(first && third); await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down(); await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2, { steps: 4 }); await page.mouse.up(); await page.waitForFunction(() => document.querySelector('.message-navigation button[aria-current="true"]')?.getAttribute('aria-label') === '跳转到第 3 条用户消息');
  const fade = await page.locator('.transcript-scroll').evaluate((element) => ({ top: element.style.getPropertyValue('--top-fade'), bottom: element.style.getPropertyValue('--bottom-fade'), mask: getComputedStyle(element).maskImage })); assert.equal(fade.top, '1rem'); assert.equal(fade.bottom, '1rem'); assert.ok(fade.mask.includes('linear-gradient'));
  verified('reference-sized user-message rail previews exact literal text and supports pointer jump, roving native keyboard focus and captured-pointer scrubbing; current-turn tracking and both one-rem scroll fades follow the actual transcript');

  await page.getByLabel('消息', { exact: true }).focus(); await page.keyboard.press('Control+f'); await input().waitFor(); await search('needle.a*', 4); await capture('103-chat-find-light.png');
  const themeColors = await page.evaluate(() => ({ bar: getComputedStyle(document.querySelector('.chat-find')).backgroundColor, surface: getComputedStyle(document.querySelector('.app-shell')).backgroundColor, highlight: getComputedStyle(document.body, '::highlight(qiyao-chat-search)').color, text: getComputedStyle(document.body).color })); assert.equal(themeColors.bar, themeColors.surface); assert.equal(themeColors.highlight, themeColors.text);
  await input().press('Enter'); await counter().getByText('2 / 4', { exact: true }).waitFor(); await input().press('Shift+Enter'); await counter().getByText('1 / 4', { exact: true }).waitFor(); await find().getByRole('button', { name: '上一个匹配', exact: true }).click(); await counter().getByText('4 / 4', { exact: true }).waitFor(); await find().getByRole('button', { name: '下一个匹配', exact: true }).click(); await counter().getByText('1 / 4', { exact: true }).waitFor();
  await search('cross node', 1); assert.equal(await page.evaluate(() => [...CSS.highlights.get('qiyao-chat-search-current')][0].toString()), 'cross node'); await search('Σ', 3); await search('<img>', 2); assert.equal(await page.locator('.user-bubble img').count(), 0); await search('BODY_SCOPE_EXCLUDED', 0); assert.equal(await find().getByRole('button', { name: '下一个匹配', exact: true }).isDisabled(), true);
  await search('HORIZONTAL_FIND_TARGET', 1); const rangeBounds = await page.evaluate(() => { const range = [...CSS.highlights.get('qiyao-chat-search-current')][0]; const rect = range.getClientRects()[0]; const pre = range.startContainer.parentElement.closest('pre'); const scroll = document.querySelector('.transcript-scroll').getBoundingClientRect(); const box = pre.getBoundingClientRect(); return { text: range.toString(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scrollLeft: pre.scrollLeft, preLeft: box.left, preRight: box.right, scrollTop: scroll.top, scrollBottom: scroll.bottom }; }); assert.equal(rangeBounds.text, 'HORIZONTAL_FIND_TARGET'); assert.ok(rangeBounds.scrollLeft > 0 && rangeBounds.left >= rangeBounds.preLeft && rangeBounds.right <= rangeBounds.preRight && rangeBounds.top >= rangeBounds.scrollTop && rangeBounds.bottom <= rangeBounds.scrollBottom, JSON.stringify(rangeBounds)); await capture('104-chat-find-code-light.png');
  const codeNode = await page.evaluateHandle(() => [...CSS.highlights.get('qiyao-chat-search-current')][0].startContainer); await page.getByLabel('消息', { exact: true }).fill('CHAT_NAV_DRAFT_CHANGED'); assert.equal(await codeNode.evaluate((node) => node.isConnected && Boolean(node.parentElement?.closest('pre'))), true); await input().focus(); await input().press('Enter'); assert.equal(await page.evaluate(() => [...CSS.highlights.get('qiyao-chat-search-current')][0].toString()), 'HORIZONTAL_FIND_TARGET'); await codeNode.dispose(); await page.getByLabel('消息', { exact: true }).fill('CHAT_NAV_DRAFT_KEEP');
  await input().focus(); await search('SOURCE_GRAPH_ID', 0); const diagram = page.locator('.code-fence[data-language="mermaid"]').first(); await diagram.getByRole('button', { name: '显示图表源码', exact: true }).click(); await counter().getByText('1 / 1', { exact: true }).waitFor(); await page.waitForFunction(() => [...(CSS.highlights.get('qiyao-chat-search-current') ?? [])][0]?.toString() === 'SOURCE_GRAPH_ID'); await input().focus(); await input().press('Enter'); assert.equal(await page.evaluate(() => Boolean([...CSS.highlights.get('qiyao-chat-search-current')][0].startContainer.parentElement.closest('pre'))), true); await diagram.getByRole('button', { name: '显示图表', exact: true }).click(); await counter().getByText('无匹配结果', { exact: true }).waitFor(); await page.waitForFunction(() => !CSS.highlights.has('qiyao-chat-search'));
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP'); assert.deepEqual(await page.locator('.message[data-message-id]').evaluateAll((elements) => elements.map((element) => element.dataset.messageId)), messages.map((message) => message.id));
  await input().press('Escape'); await find().waitFor({ state: 'hidden' }); assert.equal(await page.getByLabel('消息', { exact: true }).evaluate((element) => element === document.activeElement), true); assert.equal(await page.evaluate(() => CSS.highlights.has('qiyao-chat-search')), false); assert.equal(fixture.requests.length, 0);
  verified('native Ctrl-F finds only displayed message bodies with exact literal/Unicode offsets and cross-format ranges, wraps previous/next keyboard and buttons, scrolls an actual wide code block into view and clears highlights while restoring the untouched composer without a model request');

  await page.keyboard.press('Control+Shift+p'); const palette = page.getByRole('dialog', { name: '搜索与命令', exact: true }); await palette.getByRole('combobox').fill('>查找当前聊天'); await palette.getByRole('combobox').press('Enter'); await palette.waitFor({ state: 'hidden' }); await input().waitFor(); await page.waitForFunction(() => document.querySelector('.chat-find input') === document.activeElement); await search('needle.a*', 4); await page.getByRole('button', { name: '资料库', exact: true }).click(); await find().waitFor({ state: 'hidden' }); await page.keyboard.press('Control+Shift+p'); await palette.getByRole('combobox').fill('>查找当前聊天'); assert.equal(await palette.getByRole('option', { name: '查找当前聊天', exact: true }).isDisabled(), true); await page.keyboard.press('Escape'); await page.locator('.thread-list').getByRole('button', { name: threadTitle, exact: true }).click(); await find().waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => CSS.highlights.has('qiyao-chat-search')), false);
  const state = await page.evaluate(() => window.qiyao.load()); assert.deepEqual(state.threads.find((thread) => thread.id === threadId).messages, messages); assert.equal(state.composerDrafts.find((draft) => draft.threadId === threadId).text, 'CHAT_NAV_DRAFT_KEEP'); assert.deepEqual(state.composerDrafts.find((draft) => draft.threadId === threadId).attachments, [attachment]); assert.equal(fixture.requests.length, 0);
  verified('actual command-menu find opens and focuses the same bar, leaving the chat removes stale highlights and disables its context-bound command, and returning preserves the exact saved history, draft and attachment without sending');

  const observerInstalled = await application.evaluateMain(String.raw`(() => {
    const handlers = require('electron').ipcMain._invokeHandlers;
    if (!(handlers instanceof Map) || typeof handlers.get('qiyao:invoke') !== 'function') return false;
    const target = ${JSON.stringify(threadId)};
    const data = globalThis.qiyaoChatNavigationObservations = { installedAt: Date.now(), loads: [], clones: [], files: [] };
    const append = (list, row) => { list.push(row); if (list.length > 64) list.shift(); };
    const summarize = state => { const thread = state?.threads?.find(item => item.id === target); const last = thread?.messages.at(-1);
      return { messageCount: thread?.messages.length, status: last?.status, characters: last?.content.length, hasNeedle: last?.content.includes('STREAM_FIND_NEEDLE') }; };
    const originalHandler = handlers.get('qiyao:invoke');
    const handler = async function (...args) {
      if (args[1] !== 'load') return originalHandler.apply(this, args);
      const row = { startedAt: Date.now() }; append(data.loads, row);
      try { const state = await originalHandler.apply(this, args); row.returnedAt = Date.now(); row.thread = summarize(state); return state; }
      finally { row.finishedAt = Date.now(); }
    };
    const originalClone = globalThis.structuredClone;
    const clone = function (...args) {
      const startedAt = Date.now(); const result = originalClone.apply(this, args);
      if (args[0]?.schemaVersion === 1 && Array.isArray(args[0]?.threads)) append(data.clones,
        { startedAt, completedAt: Date.now(), threads: args[0].threads.length, thread: summarize(result) });
      return result;
    };
    const fs = require('node:fs/promises'); const path = require('node:path'); const originalOpen = fs.open; const restorers = new Set(); let active = true;
    const open = async function (...args) {
      const handle = await originalOpen.apply(this, args); const name = typeof args[0] === 'string' ? path.basename(args[0]) : '';
      if (!active || !/^workspace\.(?:backup\.)?json(?:\.|$)|^workspace\.checkpoints\.json(?:\.|$)/.test(name)) return handle;
      const originals = new Map();
      for (const method of ['writeFile', 'sync']) {
        const original = handle[method]; originals.set(method, original);
        handle[method] = async function (...values) {
          const row = { file: name.startsWith('workspace.backup.') ? 'backup' : name.startsWith('workspace.checkpoints.') ? 'journal' : 'primary', method, startedAt: Date.now() }; append(data.files, row);
          try { return await original.apply(this, values); } finally { row.completedAt = Date.now(); }
        };
      }
      const originalClose = handle.close;
      const restore = () => { for (const [method, original] of originals) handle[method] = original; handle.close = originalClose; restorers.delete(restore); };
      handle.close = async function (...values) { try { return await originalClose.apply(this, values); } finally { restore(); } };
      restorers.add(restore); return handle;
    };
    handlers.set('qiyao:invoke', handler); globalThis.structuredClone = clone; fs.open = open;
    globalThis.qiyaoRestoreChatNavigationObservers = () => {
      active = false;
      if (handlers.get('qiyao:invoke') === handler) handlers.set('qiyao:invoke', originalHandler);
      if (globalThis.structuredClone === clone) globalThis.structuredClone = originalClone;
      if (fs.open === open) fs.open = originalOpen;
      for (const restore of [...restorers]) restore();
    };
    return true;
  })()`);
  assert.equal(observerInstalled, true);
  const streamStartedAt = Date.now();
  let streamPhase = 'submit';
  try {
    await page.evaluate(async ({ threadId, providerId }) => { await window.qiyao.submit({ threadId, providerId, model: 'chat-navigation-model', text: 'CHAT_NAV_STREAM_REQUEST', attachments: [], mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [] }); }, { threadId, providerId });
    streamPhase = 'partial';
    await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id).messages.at(-1)?.content.includes('STREAM_FIND_NEEDLE'), threadId);
    streamPhase = 'find-partial';
    await page.keyboard.press('Control+f'); await search('STREAM_FIND_NEEDLE', 1); await search('needle.a*', 4);
    const before = await page.locator('.transcript-scroll').evaluate((element) => element.scrollTop);
    fixture.finish(); streamPhase = 'complete';
    await waitForBridge(page, async (id) => (await window.qiyao.load()).threads.find((thread) => thread.id === id).messages.at(-1)?.status === 'complete', threadId);
    streamPhase = 'find-complete';
    assert.ok(Math.abs(await page.locator('.transcript-scroll').evaluate((element) => element.scrollTop) - before) <= 2);
    await search('STREAM_FIND_NEEDLE', 2); assert.equal(fixture.requests.length, 1); assert.equal(await rail().getByRole('button').count(), 21); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP');
    const native = await application.evaluateMain('({observations:globalThis.qiyaoChatNavigationObservations,capturedAt:Date.now()})');
    assert.ok(native.observations.loads.length > 0); assert.ok(native.observations.clones.length > 0); assert.ok(native.observations.files.some(row => row.method === 'sync'));
    console.log('Chat navigation streaming observations', JSON.stringify({ streamStartedAt, completedAt: Date.now(), originalDeadlineMs: 10000, originalPollIntervalMs: 100, requests: fixture.requests.length, native }));
  } catch (error) {
    const failedAt = Date.now();
    const native = await application.evaluateMain('({observations:globalThis.qiyaoChatNavigationObservations,transport:globalThis.qiyaoModelTransportEvents?.filter(item=>item.path.startsWith("/chat-navigation/")).slice(-4),memory:process.memoryUsage(),cpu:process.cpuUsage(),capturedAt:Date.now()})').catch(() => null);
    console.error('Chat navigation streaming failure observations', JSON.stringify({ streamStartedAt, failedAt, streamPhase, originalDeadlineMs: 10000, originalPollIntervalMs: 100, requests: fixture.requests.length, native }));
    throw error;
  } finally {
    fixture.finish();
    await application.evaluateMain('globalThis.qiyaoRestoreChatNavigationObservers?.()').catch(() => {});
  }
  verified('real held HTTP streaming updates the find index and user-turn rail, retains the earlier result and manual reading position through appended reply text, and preserves the independent composer draft without another provider request');

  if (process.env.QIYAO_TEST_CHAT_NAVIGATION_ONLY) {
    await nativeZoom(1.25);
  }
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540); await nativeZoom(1); await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540 && document.querySelector('.workspace-header button[aria-label="查找当前聊天"]')?.disabled === false); await page.keyboard.press('Control+f'); await input().waitFor(); await search('needle.a*', 4); const layout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await nativeZoom(zoom); await search('cross node', 1); await input().press('Enter');
    const bounds = await page.evaluate(() => { const bar = document.querySelector('.chat-find').getBoundingClientRect(); const region = document.querySelector('.transcript-region').getBoundingClientRect(); const close = document.querySelector('.chat-find [aria-label="关闭查找"]').getBoundingClientRect(); const marker = document.querySelector('.message-navigation-marker').getBoundingClientRect(); const rail = document.querySelector('.message-navigation').getBoundingClientRect(); const result = [...CSS.highlights.get('qiyao-chat-search-current')][0].getClientRects()[0]; const controls = [...document.querySelectorAll('.composer textarea,.composer .send-button,.model-selectors select,.composer .attachment-preview-button,.workspace-header .header-actions button')].map((element) => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label'), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; }); return { controls, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth, bar: { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom }, close: { left: close.left, right: close.right, top: close.top, bottom: close.bottom }, region: { width: region.width, height: region.height }, marker: { left: marker.left, right: marker.right, top: marker.top, bottom: marker.bottom }, rail: { top: rail.top, bottom: rail.bottom }, result: { top: result.top, bottom: result.bottom } }; }); assert.equal(bounds.overflow, false); assert.ok(bounds.close.left >= 0 && bounds.close.right <= bounds.width && bounds.close.top >= 0 && bounds.close.bottom <= bounds.height && bounds.region.height >= 40 && bounds.marker.left >= 0 && bounds.marker.right <= bounds.width, JSON.stringify({ zoom, ...bounds })); assert.equal(bounds.controls.length, 11); assert.ok(Math.abs(bounds.controls.find((control) => control.label === '发送消息').width - 32) < 1); assert.ok(bounds.controls.every((control) => control.width > 0 && control.height > 0 && control.left >= 0 && control.right <= bounds.width + 1 && control.top >= 0 && control.bottom <= bounds.height), JSON.stringify({ zoom, controls: bounds.controls, width: bounds.width, height: bounds.height })); assert.ok(bounds.marker.top >= bounds.rail.top && bounds.marker.bottom <= bounds.rail.bottom && bounds.result.top >= bounds.bar.bottom && bounds.result.bottom <= bounds.bar.bottom + bounds.region.height, JSON.stringify({ zoom, ...bounds })); layout.push({ zoom, ...bounds }); await capture(`105-chat-find-dark-zoom-${zoom * 100}.png`);
    const tools = page.locator('.composer-tools > button,.composer-tools > select'); const toolCount = await tools.count(); await tools.first().focus(); for (let index = 0; index < toolCount; index++) { assert.equal(await tools.nth(index).evaluate((element) => element === document.activeElement), true); const visible = await tools.nth(index).evaluate((element) => { const rect = element.getBoundingClientRect(); const box = element.parentElement.getBoundingClientRect(); return { label: element.getAttribute('aria-label'), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, visible: rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 }; }); assert.equal(visible.visible, true, JSON.stringify({ zoom, index, ...visible })); await page.keyboard.press('Tab'); } assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).evaluate((element) => element === document.activeElement), true); await input().focus(); await input().press('Enter');
  }
  await input().focus(); await input().press('Escape'); await nativeZoom(1); page = await restart(); application = getApplication(); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP'); assert.equal(await find().count(), 0); assert.equal(await rail().getByRole('button').count(), 21); assert.equal(await page.evaluate(() => CSS.highlights.has('qiyao-chat-search')), false); assert.equal(fixture.requests.length, 1);
  const stored = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); assert.equal(stored.threads.find((thread) => thread.id === threadId).messages.length, 42); assert.deepEqual(stored.composerDrafts.find((draft) => draft.threadId === threadId).attachments, [attachment]); await application.resize(1280, 840);
  verified('the real dark minimum window keeps find, close and message rail within bounds at 100/125/150 percent native zoom, and normal close/restart retains exact history and the composer attachment while clearing ephemeral query/highlight state');
  return { page, result: { checks: 5, modelRequests: fixture.requests.length, layout, screenshots: ['102-message-navigation-light.png', '103-chat-find-light.png', '104-chat-find-code-light.png', ...[100, 125, 150].map((zoom) => `105-chat-find-dark-zoom-${zoom}.png`)], screenshotMethod: 'Complete native Electron BrowserWindow.capturePage with exact content-size assertions', scope: 'Current-chat message-only literal find; native keyboard, pointer and captured-pointer rail navigation; reference 26-by-2-pixel markers and one-rem edge fades; exact original UTF-16 offsets, inline Markdown spans, Unicode/metacharacters and actual code overflow; command context/focus, no-send history/draft/attachment retention; real held HTTP streaming and manual reading position; actual normal close/restart and dark 760x540 layout at 100/125/150 percent zoom. Maximum-scale, full accessibility, cross-platform and richer graphical branch navigation remain separate work.' } };
}
