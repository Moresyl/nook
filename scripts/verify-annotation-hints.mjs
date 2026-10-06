import assert from 'node:assert/strict';
import { assertTextHint } from './text-hint-verification.mjs';
import { captureDesktopScreenshot } from './desktop-screenshot.mjs';

export async function verifyAnnotationHints({ page, application, attachment, draft, screenshotPath }) {
  const state = await page.evaluate(() => window.qiyao.load());
  await page.evaluate(async ({ attachment, draft }) => {
    await window.qiyao.saveComposerDraft({ text: draft, attachments: [attachment], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: Date.now() });
  }, { attachment, draft });
  await page.reload();
  await page.getByRole('button', { name: `预览 ${attachment.name}`, exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Document evidence'));
  const internal = page.getByRole('link', { name: '跳转到文档位置', exact: true });
  const external = page.getByRole('link', { name: '打开链接：https://example.invalid/pdf', exact: true });
  const noteButton = page.getByRole('button', { name: '查看注释：Review', exact: true });
  const unavailable = page.locator('.annotationLayer span[aria-label="此链接不可用"]');
  await application.evaluateMain("globalThis.hintExternalOriginal=require('electron').shell.openExternal;globalThis.hintExternalCalls=[];require('electron').shell.openExternal=async url=>{globalThis.hintExternalCalls.push(url)};");
  try {
    for (const [trigger, text] of [[internal, '跳转到文档位置'], [external, 'https://example.invalid/pdf'], [noteButton, 'Review'], [unavailable, '此链接不可用']]) {
      await assertTextHint(page, trigger, text);
      assert.equal(await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).inputValue(), '1');
      assert.equal(await page.getByRole('dialog', { name: 'Review', exact: true }).count(), 0);
    }
    assert.deepEqual(await application.evaluateMain('globalThis.hintExternalCalls'), []);
    if (screenshotPath) {
      await page.mouse.move(1, 1); await external.hover(); await page.locator('.control-tooltip:popover-open').waitFor();
      await captureDesktopScreenshot(application, screenshotPath); await page.keyboard.press('Escape');
      await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).waitFor();
    }
    await unavailable.click(); await unavailable.press('Enter'); await unavailable.press('Space');
    assert.equal(await page.evaluate(() => globalThis.pdfInjected === true), false);
    assert.deepEqual(await application.evaluateMain('globalThis.hintExternalCalls'), []);
    await external.click({ button: 'middle' });
    assert.deepEqual(await application.evaluateMain('globalThis.hintExternalCalls'), []);
    await external.press('Enter');
    assert.deepEqual(await application.evaluateMain('globalThis.hintExternalCalls'), ['https://example.invalid/pdf']);
    const geometry = await page.locator('.annotationLayer > .linkAnnotation').evaluateAll(sections => sections.map(section => {
      const trigger = section.querySelector(':scope > a, :scope > span[aria-label]');
      const a = trigger.getBoundingClientRect(), b = section.getBoundingClientRect();
      return { directChild: trigger.parentElement === section, equalRect: ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < 0.1) };
    }));
    assert.equal(geometry.length, 3); assert.ok(geometry.every(item => item.directChild && item.equalRect));
    const size = await noteButton.evaluate(element => { const rect = element.getBoundingClientRect(); return [rect.width, rect.height]; });
    assert.deepEqual(size, [20, 20]);
    await noteButton.press('Enter');
    const note = page.getByRole('dialog', { name: 'Review', exact: true });
    await note.waitFor(); assert.equal(await note.locator('.pdf-note-content').textContent(), '<b>Plain note</b>');
    assert.equal(await note.locator('.pdf-note-content b').count(), 0);
    await note.getByRole('button', { name: '关闭注释', exact: true }).click();
    assert.equal(await noteButton.evaluate(element => element === document.activeElement), true);
    await internal.press('Enter');
    await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Budget 42'));
    assert.equal(await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).inputValue(), '2');
  } finally {
    await application.evaluateMain("require('electron').shell.openExternal=globalThis.hintExternalOriginal;delete globalThis.hintExternalOriginal;delete globalThis.hintExternalCalls;");
  }
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  await page.evaluate(async state => {
    const current = await window.qiyao.load();
    const previous = state.composerDrafts.find(item => item.threadId === current.activeThreadId);
    if (previous) await window.qiyao.saveComposerDraft(previous);
  }, state);
}
