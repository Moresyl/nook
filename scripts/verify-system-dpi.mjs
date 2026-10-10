import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";

async function nativeGeometry(application) {
  return application.evaluateMain(`(() => { const { app, screen } = require('electron'); const window = ${mainWindow}; const display = screen.getDisplayMatching(window.getBounds()); return { forcedDeviceScale: app.commandLine.getSwitchValue('force-device-scale-factor'), bounds: window.getBounds(), contentBounds: window.getContentBounds(), contentSize: window.getContentSize(), zoom: window.webContents.getZoomFactor(), display: { id: display.id, scaleFactor: display.scaleFactor, bounds: display.bounds, workArea: display.workArea } }; })()`);
}

async function capture(page, application, screenshots, filename) {
  const native = await nativeGeometry(application);
  assert.equal(native.forcedDeviceScale, '');
  const image = await application.evaluateMain(`(async () => { const image = await (${mainWindow}).capturePage(); return { png: image.toPNG().toString('base64'), size: image.getSize(), scaleFactors: image.getScaleFactors() }; })()`);
  const bytes = Buffer.from(image.png, 'base64');
  assert.ok(bytes.length > 1000);
  await writeFile(join(screenshots, filename), bytes);
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio, visualWidth: visualViewport.width, visualHeight: visualViewport.height }));
  assert.ok(Math.abs(viewport.devicePixelRatio - native.display.scaleFactor * native.zoom) < 0.01, 'Renderer device pixels must follow the actual display scale and page zoom');
  return { filename, native, viewport, pngSize: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)], nativeImageSize: image.size, imageScaleFactors: image.scaleFactors };
}

async function assertSettings(page, dialog) {
  const layout = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect(), close = element.querySelector('[aria-label="关闭"]').getBoundingClientRect();
    const content = element.querySelector('.modal-content');
    return { modal: element.matches(':modal'), documentOverflow: document.documentElement.scrollWidth > innerWidth, contentOverflow: content.scrollWidth > content.clientWidth, closeVisible: close.top >= 0 && close.bottom <= innerHeight && close.left >= 0 && close.right <= innerWidth, width: rect.width, height: rect.height, top: rect.top, left: rect.left, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  assert.equal(layout.modal, true); assert.equal(layout.documentOverflow, false); assert.equal(layout.contentOverflow, false); assert.equal(layout.closeVisible, true);
  const fullscreen = layout.viewportWidth < 768;
  const width = fullscreen ? layout.viewportWidth : Math.min(720, layout.viewportWidth - 32);
  const height = fullscreen ? layout.viewportHeight : Math.min(460, layout.viewportHeight - 40);
  const top = fullscreen ? 0 : (layout.viewportHeight - height) * 4 / 9;
  for (const [key, expected] of [['width', width], ['height', height], ['top', top], ['left', (layout.viewportWidth - width) / 2]]) assert.ok(Math.abs(layout[key] - expected) <= 1, `Settings ${key} follows the existing reference geometry at actual system DPI: ${layout[key]} vs ${expected}`);
  await page.getByLabel('消息', { exact: true }).evaluate(element => element.focus());
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
  for (const key of ['Tab', 'Shift+Tab']) for (let index = 0; index < 12; index++) {
    await page.keyboard.press(key);
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement) && !document.activeElement.matches(':disabled')), true);
  }
  return layout;
}

export async function verifySystemDpi({ page, application, getApplication, screenshots, verified, waitForBridge, restart }) {
  const captures = [], scenarios = [], initial = await nativeGeometry(application);
  assert.equal(initial.forcedDeviceScale, ''); assert.ok(initial.display.scaleFactor > 0);
  const draft = '系统缩放草稿：中文与 emoji 🧭';
  await page.getByLabel('消息', { exact: true }).fill(draft);
  await waitForBridge(page, async text => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === text), draft);
  for (const theme of ['light', 'dark']) for (const size of [[1280, 840], [760, 540]]) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await application.resize(...size);
    await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(${zoom})`);
    const native = await nativeGeometry(application);
    // Bind the renderer to the observed native content bounds; do not substitute nominal requested sizes.
    await page.waitForFunction(({ contentSize, zoom }) => Math.abs(innerWidth * zoom - contentSize[0]) <= 2 && Math.abs(innerHeight * zoom - contentSize[1]) <= 2, native);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const opener = page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ });
    await opener.focus(); await opener.press('Enter');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
    await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
    await dialog.getByRole('heading', { name: '外观与交互', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('主题', { exact: true }).inputValue(), theme);
    const layout = await assertSettings(page, dialog);
    const filename = `system-dpi-settings-${theme}-${size[0]}-${zoom}.png`;
    const screenshot = await capture(page, application, screenshots, filename); captures.push(screenshot);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    scenarios.push({ theme, requestedSize: size, zoom, layout, screenshot: filename, native: screenshot.native, viewport: screenshot.viewport });
    verified(`actual system DPI ${screenshot.native.display.scaleFactor}: ${theme} settings at requested ${size.join('x')} and ${zoom * 100}% page zoom retain reference geometry, inert background, native keyboard focus and exact draft`);
  }
  await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(1)`);
  page = await restart(); application = getApplication();
  assert.equal((await nativeGeometry(application)).forcedDeviceScale, '');
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  captures.push(await capture(page, application, screenshots, 'system-dpi-restarted-draft.png'));
  verified('normal actual application restart under unforced display scaling retains the exact Chinese draft without a model request');
  return { page, result: { checks: 13, initial, scenarios, screenshots: captures, forcedDeviceScale: false, productDefaultScaleChanged: false, systemScaleChanged: false, completeSystemDpiAcceptance: false, scope: 'Actual host display scaling in the existing candidate, two native requested sizes, both themes and 100/125/150% page zoom. Observed native/renderer geometry, existing settings layout formulas, keyboard/inert background/Escape focus and persisted Chinese draft across normal restart. Full BrowserWindow.capturePage images retain their native representations; physical input, other monitors/scales, all settings controls/pages and complete system-DPI acceptance remain separate.' } };
}
