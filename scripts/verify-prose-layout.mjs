import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proseReply, tableSource } from '../verification/prose-layout-fixture.mjs';
import { installTableClipboardFixture, assertTableClipboard, verifyTableClipboard } from './table-clipboard-verification.mjs';

export async function verifyProseLayout({ page, target = page, application, threadId, screenshots, verified, quick = false }) {
  const original = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  const index = quick ? original.messages.findIndex(message => message.role === 'assistant') : original.messages.length - 1;
  assert.ok(index >= 0 && original.messages[index].role === 'assistant');
  await page.evaluate(thread => window.qiyao.updateThread(thread), { ...original, messages: original.messages.map((message, position) => position === index ? { ...message, content: proseReply } : message) });
  if (!quick) await target.reload();
  const body = target.locator('.markdown-body').filter({ hasText: 'PROSE_LAYOUT_END' }); await body.waitFor();
  await target.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, writable: true, value: async text => { window.qiyaoVerificationCopy = text; } }); });
  const windowSelector = quick ? "new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat'" : "w.webContents.getURL().startsWith('qiyao://app/')&&!new URL(w.webContents.getURL()).searchParams.has('view')";
  const windowExpression = `require('electron').BrowserWindow.getAllWindows().find(w=>${windowSelector})`;
  const cases = quick ? [1, 1.25, 1.5].map(zoom => ({ width: 420, height: 360, zoom })) : [{ width: 1280, height: 840, zoom: 1 }, ...[1, 1.25, 1.5].map(zoom => ({ width: 760, height: 540, zoom }))];
  const layouts = [];
  async function capture(name) {
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const w=${windowExpression};return {png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, name), bytes); return { filename: name, size: image.size };
  }
  for (const theme of ['light', 'dark']) for (const { width, height, zoom } of cases) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    if (!quick) { await target.reload(); await body.waitFor(); }
    await target.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await installTableClipboardFixture(target);
    await application.evaluateMain(`${windowExpression}.setSize(${width},${height})`);
    await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(${zoom})`);
    try { await target.waitForFunction(({ width, height, zoom }) => Math.abs(innerWidth - width / zoom) < 2 && Math.abs(innerHeight - height / zoom) < 2, { width, height, zoom }); }
    catch (error) { console.log('Prose window geometry', JSON.stringify({ theme, width, height, zoom, actual: await target.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio })), native: await application.evaluateMain(`(()=>{const w=${windowExpression};return {size:w.getContentSize(),zoom:w.webContents.getZoomFactor()};})()`) })); throw error; }
    const geometry = await body.evaluate(element => {
      const style = getComputedStyle(element), paragraphs = [...element.querySelectorAll(':scope > p')].slice(0, 3).map(p => ({ han: p.hasAttribute('data-markdown-han-text'), top: getComputedStyle(p).marginTop, bottom: getComputedStyle(p).marginBottom }));
      const heading = element.querySelector('h1'), quote = element.querySelector('blockquote'), list = element.querySelector('ul');
      return { fontSize: style.fontSize, lineHeight: style.lineHeight, paragraphs, heading: { fontSize: getComputedStyle(heading).fontSize, lineHeight: getComputedStyle(heading).lineHeight }, list: { inset: getComputedStyle(list).paddingInlineStart, itemInset: getComputedStyle(list.firstElementChild).paddingInlineStart }, quote: { color: getComputedStyle(quote).color, textColor: style.color, border: getComputedStyle(quote).borderLeftWidth, inset: getComputedStyle(quote).paddingInlineStart, bar: getComputedStyle(quote, '::after').width }, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.fontSize, '14px'); assert.equal(geometry.lineHeight, '22.75px');
    assert.deepEqual(geometry.paragraphs, [{ han: true, top: '0px', bottom: '4px' }, { han: true, top: '14px', bottom: '14px' }, { han: false, top: '14px', bottom: '14px' }]);
    assert.deepEqual(geometry.heading, { fontSize: '21px', lineHeight: '28px' }); assert.deepEqual(geometry.list, { inset: '22.75px', itemInset: '5.25px' });
    assert.equal(geometry.quote.color, geometry.quote.textColor); assert.equal(geometry.quote.border, '0px'); assert.equal(geometry.quote.inset, '21px'); assert.equal(geometry.quote.bar, '3.5px'); assert.equal(geometry.overflow, false);
    await body.locator('p').first().scrollIntoViewIfNeeded(); const top = await capture(`prose-${quick ? 'quick' : 'main'}-${theme}-${width}-${zoom * 100}-top.png`);
    const table = body.locator('.markdown-table'); await table.scrollIntoViewIfNeeded(); const scroll = table.locator('.markdown-table-scroller').first();
    const overflow = await scroll.evaluate(element => element.scrollWidth > element.clientWidth + 1);
    let previewCapture;
    if (overflow) {
      assert.equal(await scroll.getAttribute('role'), 'region'); const expand = table.getByRole('button', { name: '展开表格', exact: true }); await expand.press('Enter');
      const dialog = target.getByRole('dialog', { name: '表格预览', exact: true }); await dialog.waitFor(); assert.ok((await dialog.locator('table').innerText()).includes('PROSE_TABLE_EXACT_'));
      assert.equal(await dialog.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; }), true);
      assert.equal(await dialog.evaluate(element => element.getBoundingClientRect().height <= Math.min(innerHeight - 24, element.querySelector('table').getBoundingClientRect().height + 104) + 1), true, 'The preview must fit its table content without a viewport-sized empty region.');
      const previewRegion = dialog.getByRole('region', { name: '可横向滚动的表格', exact: true });
      await previewRegion.focus(); await previewRegion.press('ArrowRight'); await target.waitForFunction(() => document.querySelector('.markdown-table-preview .markdown-table-scroller').scrollLeft > 0);
      await previewRegion.evaluate(element => { element.scrollTo({ left: 0, top: element.scrollHeight, behavior: 'instant' }); });
      assert.equal(await previewRegion.evaluate(element => element.querySelector('tbody tr:last-child').getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1), true);
      await previewRegion.evaluate(element => { element.scrollTo({ left: 0, top: 0, behavior: 'instant' }); });
      previewCapture = await capture(`prose-${quick ? 'quick' : 'main'}-${theme}-${width}-${zoom * 100}-preview.png`);
      await dialog.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.equal(await expand.evaluate(element => document.activeElement === element), true);
    }
    await table.getByRole('button', { name: '复制表格', exact: true }).press('Space'); await table.getByRole('status').getByText('已复制表格。', { exact: true }).waitFor();
    await assertTableClipboard(target, tableSource); const bottom = await capture(`prose-${quick ? 'quick' : 'main'}-${theme}-${width}-${zoom * 100}-table.png`);
    const stored = quick ? (await target.evaluate(() => window.nookQuick.load())).thread : await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
    assert.equal(stored.messages[index].content, proseReply); layouts.push({ theme, width, height, zoom, geometry, tableOverflow: overflow, captures: [top, bottom, previewCapture].filter(Boolean) });
  }
  assert.ok(layouts.some(layout => layout.tableOverflow), 'A real overflowing table must exercise keyboard preview and restored focus.');
  const table = body.locator('.markdown-table');
  await installTableClipboardFixture(target, 'reject');
  await table.getByRole('button', { name: '复制表格', exact: true }).click(); await table.getByRole('alert').waitFor(); assert.ok(!(await target.locator('body').innerText()).includes('PRIVATE_TABLE_COPY_ERROR'));
  await installTableClipboardFixture(target, 'pending');
  await table.getByRole('button', { name: '复制表格', exact: true }).click(); assert.equal(await table.getByRole('button', { name: '复制表格', exact: true }).isDisabled(), true);
  await target.waitForFunction(() => window.qiyaoTableCopyResolve && window.nookTableCopyCalls === 1); await target.evaluate(() => window.qiyaoTableCopyResolve()); await table.getByRole('status').waitFor(); await assertTableClipboard(target, tableSource);
  if (!quick) {
    await target.keyboard.press('Control+f'); const search = target.getByRole('search', { name: '查找当前聊天', exact: true }); const input = search.getByRole('textbox', { name: '查找文字', exact: true });
    for (const query of ['已复制表格。', '复制表格']) { await input.fill(query); await search.getByRole('status', { name: '查找结果', exact: true }).getByText('无匹配结果', { exact: true }).waitFor(); }
    await input.fill('English cross node'); await search.getByRole('status', { name: '查找结果', exact: true }).getByText('1 / 1', { exact: true }).waitFor();
    assert.equal(await target.evaluate(() => [...CSS.highlights.get('qiyao-chat-search-current')][0].toString()), 'English cross node'); await search.getByRole('button', { name: '关闭查找', exact: true }).click();
  } else assert.equal(await target.evaluate(() => typeof window.qiyao), 'undefined');
  const tableClipboard = await verifyTableClipboard({ page, target, application, threadId, index, quick, verified });
  await target.evaluate(() => { navigator.clipboard.writeText = async text => { window.qiyaoVerificationCopy = text; }; });
  await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1)`); await page.evaluate(thread => window.qiyao.updateThread(thread), original);
  if (!quick) await target.reload(); else await body.waitFor({ state: 'detached' });
  verified(`${quick ? 'restricted quick' : 'main'} Markdown prose, Han paragraph spacing, semantic headings/lists/quotes, exact table source copy, denied-copy retry, pending prevention, overflow preview keyboard focus and saved originals in both themes at native zoom`);
  return { layouts, copyFormat: 'Exact original Markdown and semantic HTML in one clipboard item.', tableClipboard, physicalClipboardVerified: tableClipboard.physical.verified === true, rootFontSize: 14, typographyScope: 'Reference relative metrics at the existing 14px body; reference runtime font defaults and actual glyph selection remain unverified.' };
}
