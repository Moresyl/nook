import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function verifyImageExports({ page, application, directory, screenshots, capture, verified }) {
  const original = await page.evaluate(async () => (await window.qiyao.load()).composerDrafts.find(draft => !draft.threadId));
  const image = original.attachments.find(file => file.name === 'project-board.png'), bytes = Buffer.from(image.image.data, 'base64');
  const path = join(directory, 'image-export.jpg'), stalePath = join(directory, 'image-export-delayed.jpg');
  await writeFile(path, 'keep destination until a successful export');
  await application.evaluateMain(`(() => {
    const dialog = require('electron').dialog;
    globalThis.nookImageExportFixture = { original: dialog.showSaveDialog, mode: 'cancel', calls: [] };
    dialog.showSaveDialog = async (parent, options) => {
      const fixture = globalThis.nookImageExportFixture;
      fixture.calls.push({ parent: parent.id, options });
      if (fixture.mode === 'cancel') return { canceled: true };
      if (fixture.mode === 'hold') return new Promise(resolve => { fixture.release = resolve; });
      return { canceled: false, filePath: fixture.mode === 'fail' ? ${JSON.stringify(join(directory, 'image-export-missing', 'image.jpg'))} : ${JSON.stringify(path)} };
    };
  })()`);
  const button = () => page.getByRole('button', { name: '保存 JPEG', exact: true });
  const setMode = mode => application.evaluateMain(`globalThis.nookImageExportFixture.mode=${JSON.stringify(mode)}`);
  const layouts = [], quickLayouts = [];
  try {
    await button().click(); await button().waitFor();
    assert.equal(await page.locator('.image-export-message').count(), 0);
    assert.equal(await readFile(path, 'utf8'), 'keep destination until a successful export');
    const calls = await application.evaluateMain('globalThis.nookImageExportFixture.calls');
    assert.equal(calls.length, 1); assert.equal(calls[0].options.defaultPath, 'project-board.jpg');
    assert.deepEqual(calls[0].options.filters, [{ name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] }]);
    verified('image export uses a main-process JPEG save dialog and cancel preserves the existing destination and source attachment');

    await page.keyboard.press('Escape'); await application.resize(760, 540);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload();
      for (const zoom of [1, 1.25, 1.5]) {
        await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')).webContents.setZoomFactor(${zoom})`);
        await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click();
        await setMode('fail'); await button().click(); await page.getByRole('alert').filter({ hasText: '无法保存图片' }).waitFor();
        if (zoom === 1 && theme === 'light') assert.equal(await readFile(path, 'utf8'), 'keep destination until a successful export');
        else assert.deepEqual(await readFile(path), bytes);
        const geometry = await page.evaluate(() => {
          const elements = [...document.querySelectorAll('.image-preview-toolbar button,.image-export-message,.image-preview-viewport')];
          return { actualTheme: document.documentElement.dataset.theme, contained: elements.every(element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }), pageContained: document.documentElement.scrollWidth <= innerWidth };
        });
        assert.equal(geometry.actualTheme, theme); assert.equal(geometry.contained, true); assert.equal(geometry.pageContained, true);
        const screenshot = `136-image-export-${theme}-${zoom * 100}.png`; await capture(screenshot);
        await setMode('save'); await button().click(); await page.getByText('JPEG 图片已保存。', { exact: true }).waitFor();
        assert.deepEqual(await readFile(path), bytes);
        layouts.push({ theme, zoom, ...geometry, failureRetried: true, exactJpegBytes: true, screenshot });
        await page.keyboard.press('Escape');
      }
    }
    verified('JPEG export failure and retry preserve exact normalized bytes with contained feedback and controls in six light/dark minimum-window zoom layouts');

    await application.resize(1280, 840);
    await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')).webContents.setZoomFactor(1)");
    await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await setMode('hold'); await button().click();
    const pendingButton = page.getByRole('button', { name: '正在保存…', exact: true }); assert.equal(await pendingButton.isDisabled(), true);
    const duplicate = await page.evaluate(async file => { try { await window.qiyao.exportAttachmentImage(file); return ''; } catch (error) { return String(error); } }, image);
    assert.match(duplicate, /Another image export/);
    await page.locator('.image-preview-viewport').focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('dialog').getByRole('heading', { name: 'small-image.png', exact: true }).waitFor();
    await application.evaluateMain(`globalThis.nookImageExportFixture.release({canceled:false,filePath:${JSON.stringify(stalePath)}})`);
    await page.waitForFunction(() => document.querySelector('.image-preview-dialog h2')?.textContent === 'small-image.png');
    await application.evaluateMain(`(async()=>{const fs=require('node:fs/promises');const start=Date.now();while(Date.now()-start<5000){try{await fs.access(${JSON.stringify(stalePath)});return;}catch{await new Promise(resolve=>setTimeout(resolve,25));}}throw Error('Image export did not finish');})()`);
    assert.deepEqual(await readFile(stalePath), bytes); assert.equal(await page.locator('.image-export-message').count(), 0);
    const saved = await page.evaluate(async () => (await window.qiyao.load()).composerDrafts.find(draft => !draft.threadId));
    assert.deepEqual(saved, original);
    verified('a delayed JPEG export remains bound to the requested image after gallery navigation without replacing the new preview feedback or changing the draft');
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '快速聊天', exact: true }).click();
    let quick;
    for (let attempt = 0; attempt < 100; attempt++) {
      quick = page.context().pages().find(candidate => !candidate.isClosed() && new URL(candidate.url()).searchParams.get('view') === 'quick-chat');
      if (quick) break; await page.waitForTimeout(50);
    }
    assert.ok(quick); await quick.getByRole('textbox', { name: '消息', exact: true }).waitFor();
    const quickErrors = [], onQuickError = error => quickErrors.push(error.message); quick.on('pageerror', onQuickError);
    const quickWindow = await application.evaluateMain("(()=>{const w=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');return{size:w.getSize(),zoom:w.webContents.getZoomFactor()};})()");
    const quickOriginal = await quick.evaluate(() => window.nookQuick.load());
    try {
      await quick.evaluate(async file => { const state = await window.nookQuick.load(); await window.nookQuick.save({ ...state.draft, attachments: [file], updatedAt: Date.now() }, state.revision); }, image); await quick.reload();
      await quick.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await setMode('save');
      await quick.getByRole('button', { name: '保存 JPEG', exact: true }).click(); await quick.getByText('JPEG 图片已保存。', { exact: true }).waitFor();
      assert.deepEqual(await readFile(path), bytes);
      const parent = await application.evaluateMain('globalThis.nookImageExportFixture.calls.at(-1).parent');
      assert.equal(await application.evaluateMain(`new URL(require('electron').BrowserWindow.fromId(${parent}).webContents.getURL()).searchParams.get('view')`), 'quick-chat');
      verified('quick chat exports the same exact JPEG through its isolated content bridge and parents the save dialog to its own window');
      await quick.keyboard.press('Escape');
      for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
        await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
        await quick.reload(); await quick.getByRole('textbox', { name: '消息', exact: true }).waitFor();
        await application.evaluateMain(`(()=>{const w=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');w.setSize(420,360);w.webContents.setZoomFactor(${zoom});w.show();w.focus();})()`);
        await quick.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await setMode('fail');
        await quick.getByRole('button', { name: '保存 JPEG', exact: true }).click(); await quick.getByRole('alert').filter({ hasText: '无法保存图片' }).waitFor();
        await quick.waitForFunction(() => { const image = document.querySelector('.attachment-image-preview'); return image?.complete && image.naturalWidth > 0; });
        const warning = quick.getByRole('region', { name: '图片转换说明', exact: true });
        await warning.focus(); await quick.keyboard.press('ArrowDown');
        await quick.waitForFunction(() => { const warning = document.querySelector('.image-preview-warnings'); return warning.scrollHeight <= warning.clientHeight || warning.scrollTop > 0; });
        await quick.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await quick.evaluate(() => {
          const elements = [...document.querySelectorAll('.image-preview-toolbar button,.image-export-message,.image-preview-viewport,.image-preview-dialog .modal-header button')], image = document.querySelector('.attachment-image-preview').getBoundingClientRect();
          return { actualTheme: document.documentElement.dataset.theme, imageVisible: image.width > 0 && image.height >= 24, imageAreaHeight: document.querySelector('.image-preview-viewport').getBoundingClientRect().height, contained: elements.every(element => { const r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; }), pageContained: document.documentElement.scrollWidth <= innerWidth };
        });
        assert.equal(geometry.actualTheme, theme); assert.equal(geometry.contained, true); assert.equal(geometry.pageContained, true); assert.equal(geometry.imageVisible, true); assert.ok(geometry.imageAreaHeight >= 32);
        const screenshot = `137-image-export-quick-${theme}-${zoom * 100}.png`;
        const captured = await application.evaluateMain("(async()=>{const w=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');return{data:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()};})()");
        const png = Buffer.from(captured.data, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], captured.size);
        await writeFile(join(screenshots, screenshot), png);
        await setMode('save'); await quick.getByRole('button', { name: '保存 JPEG', exact: true }).click(); await quick.getByText('JPEG 图片已保存。', { exact: true }).waitFor();
        assert.deepEqual(await readFile(path), bytes); quickLayouts.push({ theme, zoom, ...geometry, failureRetried: true, exactJpegBytes: true, warningKeyboard: true, screenshot });
        verified(`quick image export preserves a visible image, all controls and exact retry bytes at 420x360 in ${theme} at ${zoom * 100}%`); await quick.keyboard.press('Escape');
      }
    } finally {
      await quick.keyboard.press('Escape');
      await quick.evaluate(async draft => { const state = await window.nookQuick.load(); await window.nookQuick.save(draft, state.revision); }, quickOriginal.draft); await quick.reload();
      await quick.getByRole('textbox', { name: '消息', exact: true }).waitFor();
      await application.evaluateMain(`(()=>{const w=require('electron').BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat');w.setSize(...${JSON.stringify(quickWindow.size)});w.webContents.setZoomFactor(${quickWindow.zoom});const main=require('electron').BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('index.html')&&!w.webContents.getURL().includes('view=quick-chat'));main.webContents.setZoomFactor(1);})()`);
      await quick.evaluate(() => window.nookQuick.windowAction('hide'));
      await application.evaluateMain("(()=>{const window=require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html'));window.show();window.focus();})()");
      quick.off('pageerror', onQuickError);
    }
    assert.deepEqual(quickErrors, []);
    return { cancelPreservedDestination: true, failureRetried: true, exactJpegBytes: true, delayedImageIsolation: true, draftUnchanged: true, quickChatVerified: true, sha256: createHash('sha256').update(bytes).digest('hex'), layouts, quickLayouts, scope: 'Actual Electron main and quick-chat bridges, main-process validation and atomic JPEG writes. The native save-dialog boundary is intercepted; no physical dialog or original-image export is claimed.' };
  } finally {
    await application.evaluateMain("if(globalThis.nookImageExportFixture){const fixture=globalThis.nookImageExportFixture; fixture.release?.({canceled:true}); require('electron').dialog.showSaveDialog=fixture.original; delete globalThis.nookImageExportFixture;}");
    await page.keyboard.press('Escape');
  }
}
