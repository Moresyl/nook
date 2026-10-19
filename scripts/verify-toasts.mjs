import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";

export async function verifyToasts({ page, application, screenshots, verified }) {
  const notify = async messages => application.evaluateMain(`${mainWindow}.webContents.send('qiyao:automation', { error: ${JSON.stringify(messages[0])} });` + messages.slice(1).map(message => `${mainWindow}.webContents.send('qiyao:automation', { error: ${JSON.stringify(message)} });`).join(''));
  const viewport = page.getByRole('region', { name: '通知', exact: true });
  const cards = viewport.getByRole('alert');
  const texts = () => viewport.locator('.toast-message').allTextContents();
  const close = () => viewport.getByRole('button', { name: '关闭提示', exact: true });
  const composer = page.getByLabel('消息', { exact: true });
  const draft = await composer.inputValue();
  const sidebarLayout = () => page.locator('.sidebar').evaluate(element => ({
    compact: innerWidth <= 640,
    rows: [...element.querySelectorAll('.nav-row')].map(row => {
      const bounds = row.getBoundingClientRect(), style = getComputedStyle(row), icon = row.querySelector('svg').getBoundingClientRect();
      return { height: bounds.height, radius: style.borderRadius, font: style.fontSize, icon: [icon.width, icon.height], fits: icon.top >= bounds.top && icon.bottom <= bounds.bottom && row.scrollWidth <= row.clientWidth };
    }),
  }));
  const capture = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async () => { const window = ${mainWindow}; return { png: (await window.capturePage()).toPNG().toString('base64'), size: window.getContentSize() }; })()`);
    const png = Buffer.from(image.png, 'base64');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, name), png);
  };
  const clear = async () => { while (await close().count()) await close().first().click(); };
  await application.resize(1280, 840);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await page.reload(); await composer.waitFor(); await composer.fill(draft); await composer.focus();
  const wideSidebar = await sidebarLayout();
  assert.equal(wideSidebar.compact, false); assert.equal(wideSidebar.rows.length, 10);
  assert.ok(wideSidebar.rows.every(row => row.height === 36 && row.radius === '10px' && row.font === '14px' && row.icon.join(',') === '24,24' && row.fits));
  await notify(['通知一', '通知二', '通知三', '通知四', '通知五', '通知二']);
  await cards.nth(2).waitFor(); await cards.first().hover();
  assert.deepEqual(await texts(), ['通知一', '通知二', '通知三']);
  await page.waitForTimeout(5_200);
  assert.deepEqual(await texts(), ['通知一', '通知二', '通知三']);
  await capture('106-toast-queue-light.png');
  await close().first().click();
  assert.deepEqual(await texts(), ['通知二', '通知三', '通知四']);
  verified('native IPC error notifications retain distinct queued messages, coalesce exact duplicates, show at most three and pause visible lifetimes during hover');

  await close().first().focus(); await page.mouse.move(1, 80);
  await notify(['通知二']);
  assert.equal(await close().first().evaluate(element => element === document.activeElement), true, 'Refreshing a duplicate retains its existing keyboard target');
  await page.waitForTimeout(5_200);
  assert.equal(await cards.count(), 3);
  await close().first().press('Enter');
  assert.deepEqual(await texts(), ['通知三', '通知四', '通知五']);
  assert.equal(await close().first().evaluate(element => element === document.activeElement), true);
  while (await close().count()) await close().first().press('Enter');
  assert.equal(await composer.evaluate(element => element === document.activeElement), true);
  verified('keyboard focus pauses notification dismissal, Enter closes only its own item, waiting items receive their visible lifetime and final dismissal restores the composer');

  const focusSession = await page.context().newCDPSession(page);
  try {
    // As in the existing native tooltip audit, suspend Playwright's always-focused emulation.
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await application.evaluateMain(`${mainWindow}.focus(); ${mainWindow}.webContents.focus()`);
    await page.waitForFunction(() => document.hasFocus(), undefined, { polling: 100, timeout: 5_000 });
    await notify(['隐藏窗口仍保留这条提示']); await cards.first().waitFor();
    await application.evaluateMain(`${mainWindow}.hide()`);
    assert.deepEqual(await application.evaluateMain(`({ visible: ${mainWindow}.isVisible(), focused: ${mainWindow}.isFocused() })`), { visible: false, focused: false });
    await page.waitForFunction(() => !document.hasFocus(), undefined, { polling: 100, timeout: 5_000 });
    await page.waitForTimeout(5_200);
    assert.equal(await cards.count(), 1);
    await application.evaluateMain(`${mainWindow}.show(); ${mainWindow}.focus(); ${mainWindow}.webContents.focus()`);
    await page.waitForFunction(() => document.hasFocus(), undefined, { polling: 100, timeout: 5_000 });
    await page.mouse.move(1, 80); await composer.focus();
    await page.waitForFunction(() => !document.querySelector('.toast'), undefined, { timeout: 7_000 });
  } finally {
    await application.evaluateMain(`${mainWindow}.show(); ${mainWindow}.focus(); ${mainWindow}.webContents.focus()`);
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await focusSession.detach();
  }
  verified('a real hidden and unfocused native window pauses the notification clock and the remaining visible lifetime resumes after showing and focusing it');

  await page.keyboard.press('Control+,');
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.waitFor(); await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
  await dialog.getByLabel('主题', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await application.resize(760, 540);
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1.5)`);
  const narrowSidebar = await sidebarLayout();
  assert.equal(narrowSidebar.compact, true); assert.equal(narrowSidebar.rows.length, 10);
  assert.ok(narrowSidebar.rows.every(row => Math.abs(row.height - 36) < .1 && row.radius === '10px' && row.font === '0px' && row.fits));
  await notify(['保存失败\n中文与 English、עברית مرحبا', 'LONG_TOKEN_' + 'abcdefghij'.repeat(30)]);
  await cards.nth(1).waitFor(); await close().first().focus();
  const layout = await viewport.evaluate(element => {
    const bounds = element.getBoundingClientRect(), card = element.querySelector('.toast'), style = getComputedStyle(card);
    return {
      modal: element.parentElement.matches('dialog:modal'),
      fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
      noOverflow: [...element.querySelectorAll('.toast')].every(item => item.scrollWidth <= item.clientWidth),
      font: style.fontSize, radius: style.borderRadius, lineHeight: style.lineHeight,
      gap: getComputedStyle(element).gap, whiteSpace: getComputedStyle(card.querySelector('.toast-message')).whiteSpace,
      closeSize: [...element.querySelectorAll('button')].map(item => [item.offsetWidth, item.offsetHeight]),
      direction: card.querySelector('.toast-message').getAttribute('dir'),
    };
  });
  assert.deepEqual(layout, { modal: true, fits: true, noOverflow: true, font: '14px', radius: '12px', lineHeight: '19.6px', gap: '8px', whiteSpace: 'pre-wrap', closeSize: [[24, 24], [24, 24]], direction: 'auto' });
  await capture('107-toast-modal-dark-narrow.png');
  await clear(); assert.equal(await dialog.isVisible(), true);
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  await dialog.getByLabel('主题', { exact: true }).selectOption('light');
  await dismissModalWithEscape(page, dialog);
  assert.equal(await composer.inputValue(), draft);
  verified('native modal notifications remain in the dialog top layer, wrap mixed-direction and unbroken text at minimum window and 150 percent zoom, retain measured reference dimensions and preserve the draft');
  verified('all ten navigation rows use measured 36px height, 10px corners and 24px icon areas in the wide sidebar and keep icons within compact rows at 150 percent zoom');
  return { checks: 5, screenshots: ['106-toast-queue-light.png', '107-toast-modal-dark-narrow.png'], layout, sidebar: { wide: wideSidebar, narrow: narrowSidebar }, visibleLimit: 3, defaultDurationMs: 5_000, focusEmulationDisabledOnlyDuringNativeVisibilityCheck: true, originalFocusEmulationRestored: true, scope: 'Native IPC fixture notifications, real timer/hover/focus/window blur, FIFO waiting and duplicate refresh, dialog top-layer portal, keyboard dismissal/focus return, ten wide/compact navigation rows, measured dark narrow layout and full native screenshots. No physical screen-reader, swipe, every recent-chat state or complete reference UI claim.' };
}
