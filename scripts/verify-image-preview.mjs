import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { imageBytes } from '../verification/attachment-fixtures.mjs';
import { verifyImageExports } from './verify-image-exports.mjs';

export async function verifyImagePreview({ page, application, directory, screenshots, verified, fixture }) {
  const board = `<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1000" fill="#f0f2f6"/><text x="100" y="150" font-size="64" font-family="sans-serif" fill="#202630">Nook / Project board</text><text x="100" y="215" font-size="28" font-family="sans-serif" fill="#657080">Local image preview · 1600 × 1000</text><rect x="100" y="290" width="440" height="530" rx="32" fill="#cbdcff"/><rect x="580" y="290" width="440" height="530" rx="32" fill="#d9e9de"/><rect x="1060" y="290" width="440" height="530" rx="32" fill="#eeddd0"/><text x="150" y="390" font-size="36" font-family="sans-serif" fill="#24344e">01 / Explore</text><text x="630" y="390" font-size="36" font-family="sans-serif" fill="#294536">02 / Create</text><text x="1110" y="390" font-size="36" font-family="sans-serif" fill="#563e2c">03 / Refine</text></svg>`;
  const large = await sharp(Buffer.from(board)).png().toBuffer(), small = await imageBytes();
  const original = await page.evaluate(async () => { const state = await window.qiyao.load(); return { draft: state.composerDrafts.find(item => !item.threadId), preferences: state.preferences, activeThreadId: state.activeThreadId }; });
  const requestCount = fixture.requests.length;
  const capture = async name => {
    await page.getByRole('dialog').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await application.evaluateMain("(async()=>{const window=require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')); const image=await window.capturePage();return{data:image.toPNG().toString('base64'),size:window.getContentSize()};})()");
    const bytes = Buffer.from(png.data, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], png.size); await writeFile(join(screenshots, name), bytes);
  };
  const currentImage = () => page.locator('.attachment-image-preview');
  const ready = async () => {
    await page.waitForFunction(() => { const image = document.querySelector('.attachment-image-preview'); return image?.complete && image.naturalWidth > 0 && image.width > 0; });
    await page.waitForFunction(() => document.querySelector('.image-preview-toolbar button[aria-label="原始尺寸"]')?.disabled === false, undefined, { timeout: 5_000 });
  };
  const geometry = () => page.evaluate(() => {
    const viewport = document.querySelector('.image-preview-viewport'), image = document.querySelector('.attachment-image-preview');
    const bounds = image.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, availableWidth: viewport.clientWidth, availableHeight: viewport.clientHeight, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
  });
  try {
    await application.resize(1280, 840);
    await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')).webContents.setZoomFactor(1)");
    await page.evaluate(async inputs => {
      const attachments = await window.qiyao.importAttachments(inputs);
      const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
      await window.qiyao.saveComposerDraft({ text: 'IMAGE_VIEWER_UNSENT', attachments, mode: 'chat', model: '', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() }); await window.qiyao.activateThread();
    }, [{ name: 'project-board.png', data: large.toString('base64') }, { name: 'readme.txt', data: Buffer.from('Unchanged document').toString('base64') }, { name: 'small-image.png', data: small.toString('base64') }]);
    await page.reload();
    await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await ready();
    let bounds = await geometry(); assert.ok(bounds.width <= bounds.availableWidth + 1 && bounds.height <= bounds.availableHeight + 1 && bounds.width > 320, JSON.stringify(bounds));
    assert.equal(await page.getByRole('button', { name: '上一张图片', exact: true }).isDisabled(), true);
    await capture('133-image-viewer-light.png');
    const imageExport = await verifyImageExports({ page, application, directory, capture, verified });
    await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await ready();
    await page.getByRole('button', { name: '原始尺寸', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.attachment-image-preview')?.width === 1600);
    await page.getByRole('button', { name: '放大图片', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.attachment-image-preview')?.width === 2400);
    const viewport = page.locator('.image-preview-viewport'); await viewport.focus(); await page.keyboard.press('0'); await page.waitForFunction(() => document.querySelector('.image-preview-toolbar [aria-pressed="true"]')?.textContent === '适应窗口');
    await page.keyboard.press('1'); await page.waitForFunction(() => document.querySelector('.attachment-image-preview')?.width === 1600);
    bounds = await geometry();
    const region = await viewport.boundingBox();
    const startX = region.x + region.width / 2, startY = region.y + region.height / 2;
    await page.mouse.move(startX, startY); await page.mouse.down(); await page.mouse.move(startX - 2, startY - 2);
    let movement = await geometry(); assert.equal(movement.scrollLeft, bounds.scrollLeft); assert.equal(movement.scrollTop, bounds.scrollTop);
    await page.mouse.move(startX - 4, startY);
    movement = await geometry(); assert.equal(movement.scrollLeft, bounds.scrollLeft + 4); assert.equal(movement.scrollTop, bounds.scrollTop);
    await page.mouse.move(startX - 2, startY - 2);
    movement = await geometry(); assert.equal(movement.scrollLeft, bounds.scrollLeft + 2); assert.equal(movement.scrollTop, bounds.scrollTop + 2);
    await page.mouse.move(startX - 90, startY - 60, { steps: 4 }); await page.mouse.up();
    const dragged = await geometry(); assert.ok(dragged.scrollLeft > bounds.scrollLeft + 40 && dragged.scrollTop > bounds.scrollTop + 20, JSON.stringify({ bounds, dragged }));
    await page.mouse.move(startX - 110, startY - 80);
    movement = await geometry(); assert.equal(movement.scrollLeft, dragged.scrollLeft); assert.equal(movement.scrollTop, dragged.scrollTop);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control'); await page.waitForFunction(() => document.querySelector('.attachment-image-preview')?.width > 1600);
    await viewport.focus(); for (let index = 0; index < 16; index++) await page.keyboard.press('Equal');
    assert.equal(await page.getByRole('button', { name: '放大图片', exact: true }).isDisabled(), true); assert.equal((await geometry()).width, 12800);
    for (let index = 0; index < 16; index++) await page.keyboard.press('Minus');
    assert.equal(await page.getByRole('button', { name: '缩小图片', exact: true }).isDisabled(), true); assert.equal((await geometry()).width, 160);
    await page.keyboard.press('0'); await currentImage().dblclick(); await page.waitForFunction(() => document.querySelector('.attachment-image-preview')?.width >= 1600);
    await viewport.focus(); await page.keyboard.press('0'); await page.keyboard.press('ArrowRight'); await ready();
    assert.equal(await page.getByRole('dialog').getByRole('heading').textContent(), 'small-image.png');
    assert.equal(await page.getByRole('button', { name: '下一张图片', exact: true }).isDisabled(), true); bounds = await geometry(); assert.equal(bounds.width, 48); assert.equal(bounds.height, 64);
    await page.keyboard.press('ArrowLeft'); await ready(); assert.equal((await geometry()).naturalWidth, 1600);
    await page.keyboard.press('End'); await ready(); assert.equal((await geometry()).naturalWidth, 48);
    await page.keyboard.press('End'); assert.equal(await page.getByRole('button', { name: '下一张图片', exact: true }).isDisabled(), true);
    await page.keyboard.press('Home'); await ready(); assert.equal((await geometry()).naturalWidth, 1600);
    await page.keyboard.press('Home'); assert.equal(await page.getByRole('button', { name: '上一张图片', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '预览 project-board.png');
    verified('native image viewer fits large and small images without upscaling, supports gallery arrows and Home/End boundaries, original size, bounded button/keyboard/Ctrl-wheel zoom, a latched 4px drag threshold and release, double-click, and restores opener focus after Escape without model HTTP');

    await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await ready();
    await currentImage().evaluate(image => { image.src = 'data:image/png;base64,broken'; });
    await page.getByRole('status').filter({ hasText: '无法显示这张图片' }).waitFor(); assert.equal(await page.getByRole('button', { name: '放大图片', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '重新加载', exact: true }).click(); await ready(); assert.equal((await geometry()).naturalWidth, 1600);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540);
    for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')).webContents.setZoomFactor(${zoom})`);
      await page.getByRole('button', { name: '预览 project-board.png', exact: true }).click(); await ready();
      const visible = await page.evaluate(() => [...document.querySelectorAll('.image-preview-dialog button,.image-preview-viewport')].map(element => { const r = element.getBoundingClientRect(); return { label: element.getAttribute('aria-label') ?? element.textContent, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 }; }));
      assert.ok(visible.every(item => item.visible), JSON.stringify({ zoom, visible })); bounds = await geometry(); assert.ok(bounds.width <= bounds.availableWidth + 1 && bounds.height <= bounds.availableHeight + 1);
      await capture(`134-image-viewer-dark-${zoom * 100}.png`); await page.keyboard.press('Escape');
    }
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'IMAGE_VIEWER_UNSENT'); assert.equal(fixture.requests.length, requestCount);
    const saved = await page.evaluate(async () => (await window.qiyao.load()).composerDrafts.find(item => !item.threadId)); assert.equal(saved.attachments.length, 3); assert.equal(saved.attachments[1].content, 'Unchanged document');
    verified('native image failure and retry retain valid local bytes; dark minimum-window controls stay visible at 100/125/150 percent while draft, document attachment and HTTP count remain unchanged');
    return imageExport;
  } catch (error) {
    const observation = await page.evaluate(() => {
      const image = document.querySelector('.attachment-image-preview'), area = document.querySelector('.image-preview-viewport');
      return { title: document.querySelector('.image-preview-dialog h2')?.textContent, width: image?.width, height: image?.height, complete: image?.complete, naturalWidth: image?.naturalWidth, scrollLeft: area?.scrollLeft, scrollTop: area?.scrollTop, controls: document.querySelector('.image-preview-toolbar')?.textContent, activeElement: document.activeElement?.getAttribute('aria-label') };
    }).catch(() => ({ unavailable: true }));
    console.error('Image preview failure observation', JSON.stringify(observation), error);
    await page.screenshot({ path: join(screenshots, '135-image-preview-failure.png') }).catch(() => {});
    throw error;
  } finally {
    await page.keyboard.press('Escape');
    await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().includes('index.html')).webContents.setZoomFactor(1)");
    await page.evaluate(async original => { await window.qiyao.savePreferences(original.preferences); await window.qiyao.saveComposerDraft(original.draft); await window.qiyao.activateThread(original.activeThreadId); }, original);
    await page.reload();
  }
}
