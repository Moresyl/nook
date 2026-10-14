import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyChatFontSettings({ page, target, application, threadId, screenshots, verified, quick }) {
  const original = await page.evaluate(async id => { const state = await window.qiyao.load(); return { preferences: state.preferences, thread: state.threads.find(thread => thread.id === id) }; }, threadId);
  const index = quick ? original.thread.messages.findIndex(message => message.role === 'assistant') : original.thread.messages.length - 1;
  const content = `${original.thread.messages[index].content}\n\nInline \`FONT_INLINE\`.\n\n\`\`\`ts\nconst fontSample = "中文与 English";\n\`\`\``;
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
    for (const theme of ['light', 'dark']) for (const [chatFontSize, chatCodeFontSize] of [[24, 10], [10, 24]]) {
      await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1);${windowExpression}.setContentSize(${quick ? 420 : 1280},${quick ? 360 : 840})`);
      if (quick) await page.evaluate(preferences => window.qiyao.savePreferences(preferences), { ...original.preferences, theme, chatFontSize, chatCodeFontSize });
      else {
        await page.keyboard.press('Control+,');
        const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
        const search = dialog.getByRole('searchbox'); await search.fill('对话字号');
        await dialog.getByRole('option', { name: '对话字号，外观与交互', exact: true }).click();
        await setting('主题', theme, 'theme'); await setting('对话字号', String(chatFontSize), 'chatFontSize'); await setting('代码字号', String(chatCodeFontSize), 'chatCodeFontSize');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      }
      await target.reload(); await ready();
      const saved = await page.evaluate(async () => (await window.qiyao.load()).preferences);
      assert.equal(saved.chatFontSize, chatFontSize); assert.equal(saved.chatCodeFontSize, chatCodeFontSize);
      for (const zoom of [1, 1.5]) {
        await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(${zoom});${windowExpression}.setContentSize(${quick ? 420 : zoom === 1 ? 1280 : 760},${quick ? 360 : zoom === 1 ? 840 : 540})`);
        const body = target.locator('.markdown-body').filter({ hasText: 'FONT_INLINE' });
        const styles = await body.evaluate(element => { const size = selector => parseFloat(getComputedStyle(element.querySelector(selector)).fontSize); return { prose: parseFloat(getComputedStyle(element).fontSize), h1: size('h1'), inline: size('p code'), code: size('.code-fence pre'), header: size('.code-fence-header'), table: size('table'), body: parseFloat(getComputedStyle(document.body).fontSize), theme: document.documentElement.dataset.theme, clippedDocument: document.documentElement.scrollWidth > innerWidth }; });
        assert.equal(styles.prose, chatFontSize); assert.equal(styles.h1, chatFontSize * 1.5); assert.equal(styles.inline, chatCodeFontSize); assert.equal(styles.code, chatCodeFontSize); assert.equal(styles.header, 11); assert.equal(styles.table, chatFontSize * .875); assert.equal(styles.body, 14); assert.equal(styles.theme, theme); assert.equal(styles.clippedDocument, false);
        const user = target.locator('.user-bubble .plain-text').first();
        assert.equal(await user.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), chatFontSize);
        await body.locator('.code-fence').scrollIntoViewIfNeeded();
        await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const image = await application.evaluateMain(`(async()=>{const w=${windowExpression};return {png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()};})()`);
        const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
        const capture = `chat-fonts-${quick ? 'quick' : 'main'}-${theme}-${chatFontSize}-${chatCodeFontSize}-${zoom * 100}.png`;
        await writeFile(join(screenshots, capture), bytes); layouts.push({ theme, chatFontSize, chatCodeFontSize, zoom, styles, capture });
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
    assert.equal((await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId)).messages[index].content, content);
  } finally {
    await page.evaluate(preferences => window.qiyao.savePreferences(preferences), original.preferences);
    await page.evaluate(thread => window.qiyao.updateThread(thread), original.thread);
    await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1)`);
    await target.reload();
  }
  verified(`${quick ? 'restricted quick' : 'main'} independent conversation and code font preferences survive reload, apply to actual user/assistant content in both themes at native 100/150% zoom and preserve control sizes`);
  verified(`${quick ? 'restricted quick' : 'main'} font defaults clear both overrides without changing message content${quick ? '' : ', with searchable settings, keyboard focus and actual save controls'}`);
  return { layouts, defaultsRestored: true, settingsUiVerified: !quick, originalPreferencesRestored: true, originalThreadRestored: true, referenceRuntimeDefaultsVerified: false, actualGlyphFaceVerified: false };
}
