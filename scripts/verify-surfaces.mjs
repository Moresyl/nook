import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";

async function captureSurface(page, application, path) {
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('heading', { name: '外观与交互', exact: true }).waitFor();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const capture = await application.evaluateMain(`(async () => { const window = ${mainWindow}; const image = await window.capturePage(); return { png: image.toPNG().toString('base64'), size: window.getContentSize() }; })()`);
  const png = Buffer.from(capture.png, 'base64');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], capture.size, 'Native screenshots must contain the entire unscaled content bounds');
  await writeFile(path, png);
}

async function assertModalLayout(page, dialog) {
  const layout = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const close = element.querySelector('[aria-label="关闭"]').getBoundingClientRect();
    return {
      modal: element.matches(':modal'),
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      contentOverflow: element.querySelector('.modal-content').scrollWidth > element.querySelector('.modal-content').clientWidth,
      fits: bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
      closeVisible: close.top >= 0 && close.bottom <= innerHeight && close.left >= 0 && close.right <= innerWidth,
    };
  });
  assert.deepEqual(layout, { modal: true, documentOverflow: false, contentOverflow: false, fits: true, closeVisible: true });
  assert.equal(await page.getByRole('dialog').count(), 1);
}

async function assertFocusBoundary(page, dialog) {
  await page.getByLabel('消息', { exact: true }).evaluate((element) => element.focus());
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, 'The background composer must remain inert');
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press(key);
      assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement) && !document.activeElement.matches(':disabled')), true, 'Keyboard focus must remain in the native dialog and skip disabled controls');
    }
  }
}

async function motionState(page) {
  return page.evaluate(() => {
    // A temporary CSS probe checks the same indicator class without sending a model request.
    const probe = document.createElement('span');
    probe.className = 'stream-dot'; probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'fixed'; probe.style.visibility = 'hidden';
    document.body.append(probe);
    try {
      const style = getComputedStyle(probe);
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        animation: style.animationName,
        duration: style.animationDuration,
        buttonTransition: getComputedStyle(document.querySelector('.settings-nav .button')).transitionDuration,
        toggleTransition: getComputedStyle(document.querySelector('.toggle-track > span')).transitionDuration,
      };
    } finally { probe.remove(); }
  });
}

export async function verifySurfaces({ page, application, screenshots, verified }) {
  await application.resize(1280, 840);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await page.reload();
  const draft = 'SURFACE_AUDIT_RETAINS_UNSENT_DRAFT';
  await page.getByLabel('消息', { exact: true }).fill(draft);
  const opener = page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ });
  const open = async () => { await opener.focus(); await opener.press('Enter'); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor(); return dialog; };
  let dialog = await open();
  await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
  const theme = dialog.getByLabel('主题', { exact: true });
  assert.deepEqual(await theme.evaluate((element) => { const style = getComputedStyle(element); return { height: style.height, radius: style.borderRadius, font: style.fontSize }; }), { height: '22px', radius: '6px', font: '12px' });
  assert.deepEqual(await dialog.locator('.toggle-track').first().evaluate((element) => { const track = getComputedStyle(element); const thumb = getComputedStyle(element.firstElementChild); return [track.width, track.height, thumb.width, thumb.height]; }), ['32px', '19px', '13px', '13px']);
  await assertModalLayout(page, dialog);
  await captureSurface(page, application, join(screenshots, '91-surface-controls-light.png'));
  verified('shared labeled controls and native light dialog retain the reference input/toggle dimensions and visible close action');

  const toggle = dialog.getByRole('switch', { name: '按 Enter 发送消息', exact: true });
  const original = await toggle.isChecked();
  await toggle.focus(); await toggle.press('Space');
  await page.waitForFunction((expected) => document.querySelector('.toggle-label input').checked === expected, !original);
  assert.equal(await page.evaluate(async () => (await window.qiyao.load()).preferences.enterToSend), !original);
  assert.equal(await toggle.evaluate((element) => getComputedStyle(element.nextElementSibling).outlineWidth), '2px');
  await toggle.press('Space');
  await page.waitForFunction((expected) => document.querySelector('.toggle-label input').checked === expected, original);
  assert.equal(await page.evaluate(async () => (await window.qiyao.load()).preferences.enterToSend), original);
  await assertFocusBoundary(page, dialog);
  verified('native keyboard toggles persist and restore the preference, show the focus ring, and modal Tab/Shift Tab skip disabled controls while the background stays inert');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const normal = await motionState(page);
  assert.deepEqual(normal, { reduced: false, animation: 'token-pulse', duration: '1.25s', buttonTransition: '0.18s, 0.18s', toggleTransition: '0.15s' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await motionState(page), { reduced: true, animation: 'none', duration: '0s', buttonTransition: '0s', toggleTransition: '0s' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.deepEqual(await motionState(page), normal);
  verified('dynamic reduced-motion media disables and restores shared button/toggle transitions and the isolated streaming-indicator CSS animation');

  await theme.selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  await application.resize(760, 540);
  const zooms = [1, 1.25, 1.5];
  const categories = ['模型连接', 'MCP 工具', '本地技能', '本地插件', '外观与交互', '数据与备份', '关于栖曜'];
  for (const zoom of zooms) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction((expected) => Math.abs(innerWidth - expected) <= 2, 760 / zoom);
    dialog = await open();
    await assertFocusBoundary(page, dialog);
    for (const category of categories) {
      await dialog.getByRole('button', { name: category, exact: true }).click();
      await assertModalLayout(page, dialog);
    }
    await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
    if (zoom !== 1) await captureSurface(page, application, join(screenshots, zoom === 1.25 ? '92-surface-controls-dark-narrow.png' : '93-surface-settings-zoomed.png'));
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  await application.resize(1280, 840);
  verified('all seven settings categories fit the real dark minimum window at 100/125/150 percent Electron zoom, retain native focus and restore the opener/draft after Escape');
  return { checks: 4, settingsCategories: categories, zoomFactors: zooms, screenshots: ['91-surface-controls-light.png', '92-surface-controls-dark-narrow.png', '93-surface-settings-zoomed.png'], screenshotMethod: 'Electron BrowserWindow.capturePage with exact content-size assertions', scope: 'Real Electron shared control dimensions, native modal focus/inert background/Escape restoration, keyboard preference persistence, dynamic reduced-motion media, and seven empty/new-workspace settings categories at the dark minimum window with three zoom factors. Streaming motion uses a temporary CSS-class probe. This does not establish physical OS accessibility, populated/max-scale forms, every surface/control state, font redistribution rights or complete UI adoption.' };
}
