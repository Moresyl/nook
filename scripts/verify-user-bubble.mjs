import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const longMessage = `中文消息，保留换行与原文。😀\n<img src=x onerror=window.qiyaoAttack=true>\n${'连续长文字与very_long_identifier_'.repeat(32)}\n结束。`;

export async function userBubbleGeometry(page) {
  const bubbles = await page.locator('.message-user .user-bubble').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect(), article = node.closest('article').getBoundingClientRect(), style = getComputedStyle(node);
    return { width: bounds.width, articleWidth: article.width, rightGap: article.right - bounds.right,
      radius: style.borderTopLeftRadius, padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      maxWidth: style.maxWidth, cornerShape: style.cornerShape, background: style.backgroundColor, color: style.color,
      overflow: node.scrollWidth - node.clientWidth, content: node.querySelector('[data-message-content]').textContent };
  }));
  assert.ok(bubbles.length, 'A real saved user message is required for the layout audit.');
  for (const bubble of bubbles) {
    assert.equal(bubble.maxWidth, '70%'); assert.equal(bubble.radius, '22px');
    assert.deepEqual(bubble.padding, ['10px', '16px', '10px', '16px']);
    assert.equal(bubble.cornerShape, 'superellipse(1.5)');
    assert.ok(bubble.width <= bubble.articleWidth * .7 + 1, JSON.stringify(bubble));
    assert.ok(Math.abs(bubble.rightGap) <= 1, JSON.stringify(bubble));
    assert.ok(bubble.overflow <= 1, JSON.stringify(bubble));
    assert.ok(bubble.background.includes('0.05'), 'The message surface must use the themed five-percent foreground mix.');
  }
  return bubbles;
}

export async function verifyUserMessageLayout({ page, application, threadId, screenshots, verified }) {
  const text = longMessage;
  const original = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  await page.evaluate(async ({ thread, text }) => {
    await window.qiyao.updateThread({ ...thread, messages: thread.messages.map((message, index) => index === 0 ? { ...message, content: text, attachments: [{ id: 'message-layout-text', name: `${'中文附件名'.repeat(18)}.txt`, content: 'MESSAGE_LAYOUT_ATTACHMENT_EXACT' }] } : message) });
  }, { thread: original, text });
  const layout = [], mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).searchParams.has('view'))";
  async function capture(filename) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, filename), bytes); return { filename, size: image.size };
  }
  for (const theme of ['light', 'dark']) for (const { width, height, zoom } of [{ width: 1280, height: 840, zoom: 1 }, ...[1, 1.25, 1.5].map(zoom => ({ width: 760, height: 540, zoom }))]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
    await application.resize(width, height);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction(({ width, height, zoom }) => Math.abs(innerWidth - width / zoom) <= 1 && Math.abs(innerHeight - height / zoom) <= 1, { width, height, zoom });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bubble = page.locator('.message-user .user-bubble').first(); await bubble.scrollIntoViewIfNeeded();
    const geometry = await userBubbleGeometry(page); assert.equal(geometry[0].content, text);
    assert.equal(await bubble.locator('img,script').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('.transcript-scroll').evaluate(node => node.scrollTo({ top: 0 }));
    const start = await capture(`message-layout-${theme}-${width}-${zoom * 100}-start.png`);
    await page.locator('.message-user').first().getByRole('button', { name: '复制消息', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qiyaoVerificationCopy), text);
    const stored = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id).messages[0], threadId);
    assert.equal(stored.content, text); assert.equal(stored.attachments[0].content, 'MESSAGE_LAYOUT_ATTACHMENT_EXACT');
    const end = await capture(`message-layout-${theme}-${width}-${zoom * 100}-end.png`);
    layout.push({ theme, width, height, zoom, geometry, captures: [start, end] });
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  await page.evaluate(async thread => { await window.qiyao.updateThread(thread); }, original);
  await page.reload(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  verified('saved Chinese multiline user messages and long attachment names retain exact literal text, copy and persisted originals within the reference bubble at both themes and 100/125/150 percent native zoom');
  return { layout, exactCopyAndStoredSource: true, escapedMarkup: true, attachmentContentRetained: true,
    screenshotMethod: 'Complete native BrowserWindow.capturePage, PNG dimensions matched to the content size; long messages audited at the start and end scroll positions.',
    scope: 'Ordinary right-aligned messages; compact, leading, accented and temporary reference variants are not implemented by this audit. Clipboard writes use the existing renderer fixture.' };
}

export async function verifyQuickUserMessageLayout({ page, quick, threadId, verifyLayout }) {
  const original = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  await page.evaluate(async ({ thread, text }) => { await window.qiyao.updateThread({ ...thread, messages: thread.messages.map((message, index) => index === 0 ? { ...message, content: text } : message) }); }, { thread: original, text: longMessage });
  await quick.locator('.message-user [data-message-content]').first().getByText(longMessage, { exact: true }).waitFor();
  await verifyLayout('user-message-long');
  const stored = await quick.evaluate(() => window.nookQuick.load());
  assert.equal(stored.thread.messages[0].content, longMessage);
  assert.deepEqual(stored.thread.messages[0].attachments, original.messages[0].attachments);
  assert.equal(await quick.locator('.message-user img, .message-user script').count(), 0);
  assert.equal(await quick.evaluate(() => typeof window.qiyao), 'undefined');
  await page.evaluate(async thread => { await window.qiyao.updateThread(thread); }, original);
  await quick.locator('.message-user [data-message-content]').first().getByText(original.messages[0].content, { exact: true }).waitFor();
}
