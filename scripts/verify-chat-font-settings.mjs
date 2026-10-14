import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyChatFontSettings({ page, target, application, threadId, screenshots, verified, quick }) {
  const original = await page.evaluate(async id => { const state = await window.qiyao.load(); return { preferences: state.preferences, thread: state.threads.find(thread => thread.id === id) }; }, threadId);
  const index = quick ? original.thread.messages.findIndex(message => message.role === 'assistant') : original.thread.messages.length - 1;
  const content = `${original.thread.messages[index].content}\n\n## Inline \`FONT_HEADING\`\n\nInline \`FONT_INLINE_${'identifier_'.repeat(32)}中文\`.\n\nעברית \`مرحبا 中文\`.\n\n\`\`\`ts\nconst fontSample = "中文与 English";\n\`\`\``;
  const fixture = { ...original.thread, messages: original.thread.messages.map((message, position) => position === index ? { ...message, content } : message) };
  const selector = quick ? "new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat'" : "w.webContents.getURL().startsWith('qiyao://app/')&&!new URL(w.webContents.getURL()).searchParams.has('view')";
  const windowExpression = `require('electron').BrowserWindow.getAllWindows().find(w=>${selector})`;
  const layouts = [];
  async function ready() { await target.locator('.markdown-body').filter({ hasText: 'FONT_INLINE' }).waitFor(); }
  async function setting(label, value, field) {
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    const control = dialog.getByLabel(label, { exact: true }); await control.focus();
    assert.equal(await control.evaluate(element => document.activeElement === element), true);
    await control.selectOption(value);
    await page.waitForFunction(async ({ field, value }) => (await window.qiyao.load()).preferences[field] === (value === '' ? undefined : field === 'theme' ? value : Number(value)), { field, value });
    await control.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.settings-detail:not([hidden]) select:disabled'));
  }
  try {
    await page.evaluate(thread => window.qiyao.updateThread(thread), fixture); await target.reload(); await ready();
    for (const theme of ['light', 'dark']) for (const [chatFontSize, chatCodeFontSize] of [[24, 10], [10, 24], [10, undefined], [undefined, 24]]) {
      await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1);${windowExpression}.setContentSize(${quick ? 420 : 1280},${quick ? 360 : 840})`);
      if (quick) await page.evaluate(preferences => window.qiyao.savePreferences(preferences), { ...original.preferences, theme, chatFontSize, chatCodeFontSize });
      else {
        await page.keyboard.press('Control+,');
        const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
        const search = dialog.getByRole('searchbox'); await search.fill('对话字号');
        await dialog.getByRole('option', { name: '对话字号，外观与交互', exact: true }).click();
        await setting('主题', theme, 'theme'); await setting('对话字号', chatFontSize === undefined ? '' : String(chatFontSize), 'chatFontSize'); await setting('代码字号', chatCodeFontSize === undefined ? '' : String(chatCodeFontSize), 'chatCodeFontSize');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      }
      await target.reload(); await ready();
      const saved = await page.evaluate(async () => (await window.qiyao.load()).preferences);
      assert.equal(saved.chatFontSize, chatFontSize); assert.equal(saved.chatCodeFontSize, chatCodeFontSize);
      for (const zoom of [1, 1.5]) {
        await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(${zoom});${windowExpression}.setContentSize(${quick ? 420 : zoom === 1 ? 1280 : 760},${quick ? 360 : zoom === 1 ? 840 : 540})`);
        const body = target.locator('.markdown-body').filter({ hasText: 'FONT_INLINE' });
        const styles = await body.evaluate(element => { const size = selector => parseFloat(getComputedStyle(element.querySelector(selector)).fontSize), inline = getComputedStyle(element.querySelector('p code')); return { prose: parseFloat(getComputedStyle(element).fontSize), h1: size('h1'), inline: size('p code'), headingInline: size('h2 code'), inlineDecoration: { radius: inline.borderRadius, padding: inline.padding, direction: inline.direction, isolation: inline.unicodeBidi, decorationBreak: inline.boxDecorationBreak, wrap: inline.overflowWrap }, code: size('.code-fence pre'), header: size('.code-fence-header'), table: size('table'), body: parseFloat(getComputedStyle(document.body).fontSize), theme: document.documentElement.dataset.theme, clippedDocument: document.documentElement.scrollWidth > innerWidth }; });
        const proseSize = chatFontSize ?? 14;
        assert.equal(styles.prose, proseSize); assert.equal(styles.h1, proseSize * 1.5); assert.ok(Math.abs(styles.inline - proseSize * .92) < .001); assert.ok(Math.abs(styles.headingInline - proseSize * 1.25 * .92) < .001); assert.equal(styles.code, chatCodeFontSize ?? 12); assert.equal(styles.header, 13); assert.equal(styles.table, Math.max(chatCodeFontSize ?? 12, proseSize * .875)); assert.equal(styles.body, 14); assert.equal(styles.theme, theme); assert.equal(styles.clippedDocument, false);
        const fence = await body.locator('.code-fence').last().evaluate(element => {
          const style = getComputedStyle(element), pre = getComputedStyle(element.querySelector('pre')), header = getComputedStyle(element.querySelector('header')), button = getComputedStyle(element.querySelector('button'));
          return { radius: style.borderRadius, cornerShape: CSS.supports('corner-shape', 'superellipse(1.1)') ? style.cornerShape : null, lineHeight: parseFloat(pre.lineHeight), padding: pre.padding, headerHeight: header.minHeight, headerPadding: header.padding, headerWeight: header.fontWeight, headerBorder: header.borderBottomWidth, buttonWidth: button.width, buttonHeight: button.height, wide: matchMedia('(width >= 48rem)').matches };
        });
        assert.deepEqual(fence, { radius: '20px', cornerShape: fence.cornerShape === null ? null : 'superellipse(1.1)', lineHeight: Math.max((chatCodeFontSize ?? 12) * 1.5, 20), padding: fence.wide ? '0px 20px 12px' : '0px 16px 12px', headerHeight: '48px', headerPadding: fence.wide ? '6px 6px 6px 20px' : '6px 6px 6px 16px', headerWeight: '500', headerBorder: '0px', buttonWidth: '36px', buttonHeight: '36px', wide: fence.wide });
        assert.deepEqual(styles.inlineDecoration, { radius: '6px', padding: '1px 6px', direction: 'ltr', isolation: 'isolate', decorationBreak: 'clone', wrap: 'anywhere' });
        const user = target.locator('.user-bubble .plain-text').first();
        assert.equal(await user.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), proseSize);
        await body.locator('.code-fence').scrollIntoViewIfNeeded();
        await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const image = await application.evaluateMain(`(async()=>{const w=${windowExpression};return {png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()};})()`);
        const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
        const capture = `chat-fonts-${quick ? 'quick' : 'main'}-${theme}-${chatFontSize ?? 'default'}-${chatCodeFontSize ?? 'default'}-${zoom * 100}.png`;
        await writeFile(join(screenshots, capture), bytes);
        await body.locator('.markdown-table').scrollIntoViewIfNeeded();
        const tableBounds = await body.locator('.markdown-table').evaluate(element => { const rect = element.getBoundingClientRect(), panel = element.closest('.transcript-scroll, .quick-chat-transcript'), panelRect = panel.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth, panelRight: panelRect.left + panel.clientWidth, panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth }; });
        assert.ok(tableBounds.left >= 0 && tableBounds.right <= tableBounds.panelRight + 1 && tableBounds.right <= tableBounds.viewport + 1, JSON.stringify(tableBounds)); assert.ok(tableBounds.panelScrollWidth <= tableBounds.panelClientWidth + 1, JSON.stringify(tableBounds));
        await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const tableImage = await application.evaluateMain(`(async()=>{const w=${windowExpression};return {png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()};})()`);
        const tableBytes = Buffer.from(tableImage.png, 'base64'); assert.deepEqual([tableBytes.readUInt32BE(16), tableBytes.readUInt32BE(20)], tableImage.size);
        const tableCapture = capture.replace('chat-fonts-', 'chat-table-fonts-'); await writeFile(join(screenshots, tableCapture), tableBytes);
        layouts.push({ theme, chatFontSize: chatFontSize ?? null, chatCodeFontSize: chatCodeFontSize ?? null, zoom, styles, fence, tableBounds, capture, tableCapture });
      }
    }
    if (!quick) {
      await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1);${windowExpression}.setContentSize(1280,840)`);
      await page.keyboard.press('Control+,'); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
      await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
      await setting('对话字号', '', 'chatFontSize'); await setting('代码字号', '', 'chatCodeFontSize');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    } else {
      const { chatFontSize, chatCodeFontSize, ...defaults } = original.preferences;
      await page.evaluate(preferences => window.qiyao.savePreferences(preferences), defaults);
    }
    await target.reload(); await ready();
    assert.deepEqual(await target.evaluate(() => ['--chat-font-size', '--chat-code-font-size'].map(name => document.documentElement.style.getPropertyValue(name))), ['', '']);
    assert.equal(await target.locator('.markdown-body').filter({ hasText: 'FONT_INLINE' }).evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 14);
    assert.deepEqual(await target.locator('.markdown-body').filter({ hasText: 'FONT_INLINE' }).locator('.code-fence pre').last().evaluate(element => { const style = getComputedStyle(element); return { fontSize: style.fontSize, lineHeight: style.lineHeight }; }), { fontSize: '12px', lineHeight: '20px' });
    assert.equal((await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId)).messages[index].content, content);
  } finally {
    await page.evaluate(preferences => window.qiyao.savePreferences(preferences), original.preferences);
    await page.evaluate(thread => window.qiyao.updateThread(thread), original.thread);
    await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1)`);
    await target.reload();
  }
  verified(`${quick ? 'restricted quick' : 'main'} independent conversation and code font preferences survive reload, apply to actual user/assistant content in both themes at native 100/150% zoom and preserve control sizes`);
  verified(`${quick ? 'restricted quick' : 'main'} font defaults clear both overrides without changing message content${quick ? '' : ', with searchable settings, keyboard focus and actual save controls'}`);
  verified(`${quick ? 'restricted quick' : 'main'} table fonts respect independent code-size and relative-prose floors, inline code follows paragraph/heading sizes with cloned backgrounds, and one-sided defaults retain native panel edges across themes/zoom`);
  return { layouts, defaultsRestored: true, settingsUiVerified: !quick, originalPreferencesRestored: true, originalThreadRestored: true, referenceRuntimeDefaultsVerified: false, actualGlyphFaceVerified: false };
}
