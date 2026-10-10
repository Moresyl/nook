import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { documentBytes } from '../verification/attachment-fixtures.mjs';

export async function verifyPdfPreview({ page, application, directory, screenshots, verified, restart }) {
  const bytes = documentBytes('pdf', { outline: true, annotations: true });
  const reference = await page.evaluate(async data => {
    const preferences = (await window.qiyao.load()).preferences;
    await window.qiyao.savePreferences({ ...preferences, theme: 'light' });
    const [file] = await window.qiyao.importAttachments([{ name: 'preview-original.pdf', data }]);
    await window.qiyao.activateThread();
    await window.qiyao.saveComposerDraft({ text: '', attachments: [file], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: Date.now() });
    return file.original;
  }, bytes.toString('base64'));
  assert.ok(reference);
  await page.reload();
  const open = async () => {
    await page.getByRole('button', { name: '预览 preview-original.pdf', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.pdfPreviewPage .textLayer')?.textContent.includes('Document evidence'));
  };
  await application.resize(1280, 840); await open();
  const pixels = await page.locator('.pdfPreviewPage canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 200 && data[i + 1] < 200 && data[i + 2] < 200) ink++;
    return ink;
  });
  assert.ok(pixels > 50); assert.equal(await page.getByRole('button', { name: '上一页', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), false);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Budget 42'));
  assert.equal(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Document evidence'));
  await page.screenshot({ path: join(screenshots, 'pdf-original-light.png') });
  verified('PDF original renders real canvas ink and selectable text from the isolated import worker');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const outline = page.getByRole('navigation', { name: 'PDF 目录', exact: true });
  await outline.getByRole('button', { name: 'Budget details', exact: true }).waitFor();
  assert.equal(await outline.getByRole('button', { name: 'External reference', exact: true }).isDisabled(), true);
  await page.screenshot({ path: join(screenshots, 'pdf-outline-light.png') });
  await outline.getByRole('button', { name: 'Budget details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Budget 42'));
  assert.equal(await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).inputValue(), '2');
  assert.ok(await page.locator('.pdf-scroll').evaluate(element => element.scrollTop) > 0);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await outline.getByRole('button', { name: 'Evidence chapter', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Document evidence'));
  assert.equal(await page.locator('.pdf-scroll').evaluate(element => element.scrollTop), 0);
  verified('nested PDF outline resolves named page coordinates and explicit page targets while external actions remain inactive');
  const search = page.getByRole('searchbox', { name: '搜索 PDF', exact: true });
  await page.keyboard.press('Control+f');
  assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await search.fill('BUDGET');
  await page.waitForFunction(() => document.querySelector('.pdf-search [role=status]')?.textContent === '1 / 1' && [...(CSS.highlights.get('nook-pdf-search-current') ?? [])].some(range => range.toString() === 'Budget'));
  assert.equal(await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).inputValue(), '2');
  await page.screenshot({ path: join(screenshots, 'pdf-search-light.png') });
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await outline.getByRole('button', { name: 'Budget details', exact: true }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pdfPreviewPage canvas'), scroller = document.querySelector('.pdf-scroll');
    return canvas && scroller && scroller.getAttribute('aria-busy') === 'false' && Math.abs(scroller.scrollTop - parseFloat(canvas.style.width) / 612 * 192) < 2;
  });
  await page.locator('.pdf-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.getByRole('button', { name: '下一个 PDF 匹配', exact: true }).click();
  await page.waitForFunction(() => { const range = [...(CSS.highlights.get('nook-pdf-search-current') ?? [])][0]; const box = range?.getBoundingClientRect(), scroll = document.querySelector('.pdf-scroll')?.getBoundingClientRect(); return box && scroll && box.top >= scroll.top && box.bottom <= scroll.bottom; });
  await search.fill('d');
  await page.waitForFunction(() => document.querySelector('.pdf-search [role=status]')?.textContent === '1 / 3');
  await search.press('Shift+Enter');
  await page.waitForFunction(() => document.querySelector('.pdf-search [role=status]')?.textContent === '3 / 3' && document.querySelector('input[aria-label="PDF 页码"]')?.value === '2');
  await search.fill('[');
  await page.waitForFunction(() => document.querySelector('.pdf-search [role=status]')?.textContent === '0 / 0' && !CSS.highlights.has('nook-pdf-search-current'));
  await search.fill('');
  await page.waitForFunction(() => !CSS.highlights.has('nook-pdf-search'));
  await page.getByRole('spinbutton', { name: 'PDF 页码', exact: true }).fill('1');
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Document evidence'));
  verified('PDF full-document search jumps across pages, highlights exact literal ranges, cycles backwards and clears obsolete highlights');
  const internalLink = page.getByRole('link', { name: '跳转到文档位置', exact: true });
  await internalLink.click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.textLayer')?.textContent.includes('Budget 42'));
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('button', { name: '查看注释：Review', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'Review', exact: true });
  assert.equal(await note.locator('.pdf-note-content').textContent(), '<b>Plain note</b>');
  assert.equal(await note.locator('.pdf-note-content b').count(), 0);
  await page.screenshot({ path: join(screenshots, 'pdf-note-light.png') });
  await note.getByRole('button', { name: '关闭注释', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '查看注释：Review', exact: true }).evaluate(element => element === document.activeElement), true);
  await application.evaluateMain("globalThis.pdfExternalOriginal=require('electron').shell.openExternal;globalThis.pdfExternalCalls=[];require('electron').shell.openExternal=async url=>{globalThis.pdfExternalCalls.push(url)};");
  try {
    await page.getByRole('link', { name: '打开链接：https://example.invalid/pdf', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await application.evaluateMain('globalThis.pdfExternalCalls'), ['https://example.invalid/pdf']);
  } finally { await application.evaluateMain("require('electron').shell.openExternal=globalThis.pdfExternalOriginal;delete globalThis.pdfExternalOriginal;delete globalThis.pdfExternalCalls;"); }
  assert.equal(await page.locator('.annotationLayer a').count(), 2);
  assert.equal(await page.evaluate(() => globalThis.pdfInjected === true), false);
  const linkPosition = () => internalLink.evaluate(link => { const rect = link.getBoundingClientRect(), root = link.closest('.pdfPreviewPage').getBoundingClientRect(); return [(rect.left - root.left) / root.width, (rect.top - root.top) / root.height, rect.width / root.width]; });
  const beforePosition = await linkPosition();
  const before = await page.locator('.pdfPreviewPage canvas').evaluate(canvas => canvas.getBoundingClientRect().width);
  await page.getByRole('button', { name: '放大 PDF', exact: true }).click();
  await page.waitForFunction(width => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && Number.parseFloat(document.querySelector('.pdfPreviewPage canvas')?.style.width ?? '0') > width, before);
  await internalLink.waitFor();
  await page.waitForFunction(expected => {
    const link = document.querySelector('.annotationLayer a[aria-label="跳转到文档位置"]');
    if (!link || document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') !== 'false') return false;
    const rect = link.getBoundingClientRect(), root = link.closest('.pdfPreviewPage').getBoundingClientRect();
    const actual = [(rect.left - root.left) / root.width, (rect.top - root.top) / root.height, rect.width / root.width];
    return expected.every((value, index) => Math.abs(value - actual[index]) < 0.002);
  }, beforePosition);
  const afterPosition = await linkPosition();
  beforePosition.forEach((value, index) => assert.ok(Math.abs(value - afterPosition[index]) < 0.002, JSON.stringify({ beforePosition, afterPosition, index })));
  verified('PDF internal and external links, inert script actions, plain-text notes and zoom-aligned annotation rectangles work in the real viewer');
  await page.getByRole('button', { name: '适合宽度', exact: true }).click();
  await page.getByRole('button', { name: '查看提取文本', exact: true }).click();
  assert.match(await page.locator('.attachment-text-preview').textContent(), /Document evidence/);
  await page.getByRole('button', { name: '查看 PDF 原件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false');
  const selected = await page.locator('.textLayer').evaluate(layer => { const range = document.createRange(); range.selectNodeContents(layer); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
  assert.match(selected, /Document evidence/);
  verified('PDF zoom, text/original switching and native text selection survive viewer disposal and recreation');
  const exported = join(directory, 'exported-original.pdf');
  await application.evaluateMain(`globalThis.pdfSaveDialog=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(exported)}});`);
  try {
    const predecessor = Buffer.from('KEEP_EXISTING_PDF_DESTINATION');
    await writeFile(exported, predecessor);
    await application.evaluateMain(`globalThis.nookPdfRename=require('node:fs/promises').rename;require('node:fs/promises').rename=async(from,to)=>{if(to===${JSON.stringify(exported)})throw Object.assign(new Error('Synthetic PDF export failure'),{code:'EIO'});return globalThis.nookPdfRename(from,to);};`);
    try {
      await page.getByRole('button', { name: '保存 PDF 原件', exact: true }).click();
      await page.getByRole('alert').getByText('本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '保存 PDF 原件', exact: true }).isEnabled(), true);
      assert.deepEqual(await readFile(exported), predecessor);
      assert.deepEqual(Buffer.from(await page.evaluate(async ref => Array.from(await window.qiyao.readDocumentOriginal(ref)), reference)), bytes);
      assert.equal((await readdir(directory)).some(name => name.startsWith('exported-original.pdf.') && name.endsWith('.tmp')), false);
      await page.screenshot({ path: join(screenshots, 'pdf-original-export-save-error.png') });
    } finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.nookPdfRename;delete globalThis.nookPdfRename;"); }
    await page.getByRole('button', { name: '保存 PDF 原件', exact: true }).click();
    await page.getByRole('button', { name: '保存 PDF 原件', exact: true }).waitFor();
    assert.deepEqual(await readFile(exported), bytes);
    assert.equal(await page.getByRole('alert').count(), 0);
  } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.pdfSaveDialog;delete globalThis.pdfSaveDialog;"); }
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  const denied = await page.evaluate(async ref => { try { await window.qiyao.readDocumentOriginal({ ...ref, sha256: '0'.repeat(64) }); return false; } catch { return true; } }, reference);
  assert.equal(denied, true);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); });
  await application.resize(760, 540); await page.reload(); await open();
  const geometry = await page.getByRole('dialog').evaluate(dialog => {
    const content = dialog.querySelector('.modal-content'), footer = dialog.querySelector('.modal-footer').getBoundingClientRect(), rect = dialog.getBoundingClientRect();
    return { outerScroll: content.scrollHeight > content.clientHeight + 1, overflowX: dialog.scrollWidth > dialog.clientWidth + 1, footerVisible: footer.bottom <= innerHeight && footer.top >= 0, fitsWindow: rect.top >= 0 && rect.bottom <= innerHeight };
  });
  assert.deepEqual(geometry, { outerScroll: false, overflowX: false, footerVisible: true, fitsWindow: true });
  await page.screenshot({ path: join(screenshots, 'pdf-original-dark-minimum.png') });
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  page = await restart();
  const restored = await page.evaluate(async ref => Array.from(await window.qiyao.readDocumentOriginal(ref)), reference);
  assert.deepEqual(Buffer.from(restored), bytes);
  verified('PDF native export retains the destination and original after an actual filesystem failure with Chinese recovery copy, retries exact bytes, denies unowned references and survives restart with a dark minimum-window preview');
  return { page, result: { checks: 6, pixels, originalBytes: bytes.length, canvasTextVerified: true, outlineTargetsVerified: true, fullDocumentSearchVerified: true, linksNotesZoomVerified: true, exportOwnershipRestartVerified: true, exportFilesystemRetryVerified: true, nativeSaveDialogIntercepted: true, screenshots: ['pdf-original-light.png', 'pdf-original-dark-minimum.png', 'pdf-outline-light.png', 'pdf-search-light.png', 'pdf-note-light.png', 'pdf-original-export-save-error.png'] } };
}
