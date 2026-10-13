import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";

async function navigationState(page) {
  return page.evaluate(() => ({
    at: performance.now(), theme: document.documentElement.dataset.theme,
    bodyColor: getComputedStyle(document.body).color,
    buttons: [...document.querySelectorAll('.primary-nav button, .sidebar-footer .nav-row')].map(element => {
      const style = getComputedStyle(element);
      return { text: element.textContent, disabled: element.disabled, color: style.color, opacity: style.opacity,
        transition: style.transitionDuration, animations: element.getAnimations().map(animation => ({ property: animation.transitionProperty, state: animation.playState, currentTime: animation.currentTime })) };
    }),
  }));
}

async function readyNavigation(page) {
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('.primary-nav button, .sidebar-footer .nav-row')];
    const color = getComputedStyle(document.body).color;
    return buttons.length >= 8 && buttons.every(element => !element.disabled && getComputedStyle(element).opacity === '1' && getComputedStyle(element).color === color);
  });
  const state = await navigationState(page);
  assert.ok(state.buttons.length >= 8);
  for (const button of state.buttons) {
    assert.equal(button.disabled, false); assert.equal(button.opacity, '1'); assert.equal(button.color, state.bodyColor);
  }
  return state;
}

async function capture(page, application, screenshots, filename) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const native = await application.evaluateMain(`(() => { const { app, screen } = require('electron'); const window = ${mainWindow}; return { forcedDeviceScale: app.commandLine.getSwitchValue('force-device-scale-factor'), bounds: window.getBounds(), contentSize: window.getContentSize(), zoom: window.webContents.getZoomFactor(), displayScale: screen.getDisplayMatching(window.getBounds()).scaleFactor }; })()`);
  assert.equal(native.forcedDeviceScale, '');
  const image = await application.evaluateMain(`(async () => { const image = await (${mainWindow}).capturePage(); return { png: image.toPNG().toString('base64'), size: image.getSize() }; })()`);
  const bytes = Buffer.from(image.png, 'base64');
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert.ok(Math.abs(viewport.devicePixelRatio - native.displayScale * native.zoom) < 0.01);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [image.size.width, image.size.height]);
  assert.equal(viewport.overflow, false);
  await writeFile(join(screenshots, filename), bytes);
  return { filename, native, viewport, pngSize: image.size };
}

async function sharedButtonState(button) {
  const state = await button.evaluate(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    return { minHeight: style.minHeight, height: box.height, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, gap: style.gap, fontSize: style.fontSize,
      opacity: style.opacity, background: style.backgroundColor, focused: element === document.activeElement, focusVisible: element.matches(':focus-visible'),
      hovered: element.matches(':hover'), pressed: element.matches(':active'), disabled: element.disabled, outline: style.outlineWidth,
      contained: box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 };
  });
  for (const [key, expected] of Object.entries({ minHeight: '24px', paddingLeft: '8px', paddingRight: '8px', gap: '4px', fontSize: '12px', contained: true })) assert.equal(state[key], expected, `shared button ${key}`);
  assert.ok(Math.abs(state.height - 24) < 1);
  return state;
}

export async function verifySystemDpiHome({ page, application, getApplication, screenshots, verified, waitForBridge, restart }) {
  const draft = '首页就绪草稿：中文与 emoji 🧭';
  await page.getByLabel('消息', { exact: true }).fill(draft);
  await waitForBridge(page, async text => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === text), draft);
  const scenarios = [];
  for (const theme of ['light', 'dark']) for (const size of [[1280, 840], [760, 540]]) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    const initial = await navigationState(page);
    const ready = await readyNavigation(page);
    await application.resize(...size);
    await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(${zoom})`);
    const contentSize = await application.evaluateMain(`(${mainWindow}).getContentSize()`);
    await page.waitForFunction(({ contentSize, zoom }) => Math.abs(innerWidth * zoom - contentSize[0]) <= 2 && Math.abs(innerHeight * zoom - contentSize[1]) <= 2, { contentSize, zoom });
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    const opener = page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ });
    await opener.focus(); await opener.press('Enter');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
    await dialog.locator('.settings-nav').getByRole('button', { name: '记忆', exact: true }).click();
    const add = dialog.getByRole('button', { name: '添加记忆', exact: true }); await add.waitFor();
    const defaults = await sharedButtonState(add); assert.equal(defaults.disabled, false); assert.equal(defaults.opacity, '1');
    await add.focus(); await add.press('ArrowRight');
    const keyboard = await sharedButtonState(add); assert.equal(keyboard.focused, true); assert.equal(keyboard.focusVisible, true); assert.ok(parseFloat(keyboard.outline) >= 1);
    const focusImage = await capture(page, application, screenshots, `shared-button-focus-${theme}-${size[0]}-${zoom}.png`);
    await add.hover();
    await page.waitForFunction(() => [...document.querySelectorAll('.settings-detail:not([hidden]) button')].every(element => element.getAnimations().every(animation => animation.playState !== 'running')));
    const hover = await sharedButtonState(add); assert.equal(hover.hovered, true); assert.notEqual(hover.background, defaults.background);
    await page.mouse.down();
    let pressed;
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('.settings-detail:not([hidden]) button')].every(element => element.getAnimations().every(animation => animation.playState !== 'running')));
      pressed = await sharedButtonState(add); assert.equal(pressed.pressed, true); assert.notEqual(pressed.background, hover.background);
    } finally { await page.mouse.up(); }
    const save = dialog.getByRole('button', { name: '保存记忆', exact: true }); await save.waitFor(); await save.scrollIntoViewIfNeeded();
    const disabled = await sharedButtonState(save); assert.equal(disabled.disabled, true); assert.equal(disabled.opacity, '0.25');
    const memoriesBefore = await page.evaluate(async () => (await window.qiyao.load()).memories);
    await save.evaluate(element => { element.focus(); element.click(); });
    assert.equal(await save.evaluate(element => document.activeElement === element), false);
    assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).memories), memoriesBefore);
    const disabledImage = await capture(page, application, screenshots, `shared-button-disabled-${theme}-${size[0]}-${zoom}.png`);
    await dialog.getByRole('button', { name: '取消编辑', exact: true }).click();
    await dismissModalWithEscape(page, dialog);
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    const settled = await readyNavigation(page);
    const composer = await page.locator('.home .composer').evaluate(element => {
      const style = getComputedStyle(element);
      return { radius: style.borderRadius, shadow: style.boxShadow, viewportWidth: innerWidth, compact: matchMedia('(width < 40rem)').matches };
    });
    assert.equal(composer.radius, '22px');
    assert.equal(composer.compact, composer.viewportWidth < 640);
    if (theme === 'light') assert.ok(composer.shadow.includes(composer.compact ? ' 40px 8px' : ' 80px 8px'));
    const image = await capture(page, application, screenshots, `system-dpi-home-${theme}-${size[0]}-${zoom}.png`);
    scenarios.push({ theme, requestedSize: size, zoom, initial, ready, settled, composer, sharedButton: { defaults, keyboard, hover, pressed, disabled, focusImage, disabledImage }, image });
    verified(`unforced system DPI home ${theme} ${size.join('x')} ${zoom * 100}%: shared button geometry, keyboard/hover/pressed/disabled states, settings return and exact draft`);
  }
  await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(1)`);
  page = await restart(); application = getApplication();
  const initial = await navigationState(page);
  const ready = await readyNavigation(page);
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  const image = await capture(page, application, screenshots, 'system-dpi-home-restarted-ready.png');
  verified('normal unforced system-DPI restart retains the Chinese draft and reaches enabled settled homepage navigation');
  return { page, result: { checks: 13, scenarios, restart: { initial, ready, image }, productChanged: false, systemScaleChanged: false, forcedDeviceScale: false,
    scope: 'Actual host scaling, both homepage themes, two requested sizes and three page zooms. Also verifies real shared memory buttons in default, keyboard focus, hover, pressed and disabled states; invalid disabled saving neither takes focus nor changes stored memories. Records navigation colors, settings keyboard return and exact draft on normal restart. Physical input, complete controls, other pages/displays and full visual acceptance remain separate.' } };
}
