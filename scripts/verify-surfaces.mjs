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
  const composer = page.getByLabel('消息', { exact: true });
  const resizingDraft = '调整窗口宽度时，这份尚未发送的草稿应当完整保留，并根据实际换行重新分配输入空间。'.repeat(4);
  await composer.fill(resizingDraft);
  const wideHeight = await composer.evaluate((element) => element.clientHeight);
  await application.resize(760, 840);
  await page.waitForFunction((height) => document.querySelector('textarea[aria-label="消息"]').clientHeight > height, wideHeight);
  assert.equal(await composer.inputValue(), resizingDraft);
  await application.resize(1280, 840);
  await page.waitForFunction((height) => document.querySelector('textarea[aria-label="消息"]').clientHeight === height, wideHeight);
  assert.equal(await composer.inputValue(), resizingDraft);
  assert.equal(await composer.evaluate((element) => element === document.activeElement), true);
  await composer.fill('较长的多行草稿\n'.repeat(40));
  assert.equal(await composer.evaluate((element) => element.clientHeight <= 200 && element.scrollHeight > element.clientHeight), true, 'Long drafts must scroll within the input height limit');
  const draft = 'SURFACE_AUDIT_RETAINS_UNSENT_DRAFT';
  await page.getByLabel('消息', { exact: true }).fill(draft);
  assert.ok(await composer.evaluate((element) => element.clientHeight) < wideHeight, 'Replacing a long draft must shrink the composer');
  const opener = page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ });
  const open = async () => { await opener.focus(); await opener.press('Enter'); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor(); return dialog; };
  let dialog = await open();
  await dialog.getByRole('button', { name: '添加连接', exact: true }).click();
  await dialog.getByLabel('连接名称', { exact: true }).fill('示例模型连接');
  await dialog.getByLabel('模型', { exact: true }).fill('example-model');
  await dialog.getByRole('button', { name: '保存连接', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await dialog.getByLabel('连接名称', { exact: true }).inputValue(), '示例模型连接');
  assert.equal(await dialog.getByRole('button', { name: '模型连接', exact: true }).isVisible(), true);
  await assertModalLayout(page, dialog);
  await page.screenshot({ path: join(screenshots, '96-surface-connection-scroll.png') });
  await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
  assert.deepEqual(await dialog.evaluate((element) => { const rect = element.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; }), [720, 460]);
  const detail = dialog.locator('.settings-detail');
  const navigationBefore = await dialog.locator('.settings-nav').boundingBox();
  await detail.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  assert.ok(await detail.evaluate((element) => element.scrollTop > 0), 'Long settings must scroll inside their detail pane');
  assert.deepEqual(await dialog.locator('.settings-nav').boundingBox(), navigationBefore, 'Scrolling settings must not move their category navigation');
  await dialog.getByRole('button', { name: '关于 Nook', exact: true }).click();
  await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
  assert.equal(await detail.evaluate((element) => element.scrollTop), 0, 'A new settings category starts at its heading');
  const theme = dialog.getByLabel('主题', { exact: true });
  const selectedOption = theme.locator('option:checked');
  const changeOptionLabel = (text) => selectedOption.evaluate((element, text) => { element.textContent = text; const select = element.closest('select'); const index = select.selectedIndex; select.selectedIndex = -1; select.selectedIndex = index; }, text);
  const originalOptionText = await selectedOption.textContent();
  const longOptionText = '长名称应在收起时保持单行并保留下拉箭头'.repeat(8);
  await changeOptionLabel(longOptionText);
  await page.waitForFunction((text) => document.querySelector('.settings-detail selectedcontent')?.textContent === text, longOptionText);
  assert.equal(await theme.evaluate((element) => element.getBoundingClientRect().height), 22, 'Long selected content must not stretch a shared control');
  assert.equal(await theme.locator('selectedcontent').evaluate((element) => getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth), true, 'Only the closed display truncates the full option label');
  await changeOptionLabel(originalOptionText);
  assert.deepEqual(await theme.evaluate((element) => { const style = getComputedStyle(element); return { height: style.height, radius: style.borderRadius, font: style.fontSize }; }), { height: '22px', radius: '6px', font: '12px' });
  assert.equal(await theme.evaluate((element) => getComputedStyle(element).appearance), 'base-select');
  await theme.click();
  await page.waitForFunction(() => document.querySelector('select:open'));
  await captureSurface(page, application, join(screenshots, '94-surface-select-light.png'));
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Closing the select must keep its parent dialog open');
  await theme.focus(); await theme.press('Space'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await page.evaluate(async () => (await window.qiyao.load()).preferences.theme), 'dark');
  await page.waitForFunction(() => document.querySelector('.modal select')?.value === 'dark' && document.querySelector('.modal')?.getAnimations({ subtree: true }).every((animation) => animation.playState !== 'running'));
  await theme.click();
  await page.waitForFunction(() => { const option = document.querySelector('select:open option'); return option && option.getBoundingClientRect().height > 0 && option.checkVisibility({ visibilityProperty: true }); });
  await captureSurface(page, application, join(screenshots, '95-surface-select-dark.png'));
  await page.keyboard.press('Escape');
  await theme.selectOption('light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
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
  const categories = ['模型连接', 'MCP 工具', '本地技能', '本地插件', '外观与交互', '数据与备份', '关于 Nook'];
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
  return { checks: 4, settingsCategories: categories, zoomFactors: zooms, screenshots: ['91-surface-controls-light.png', '92-surface-controls-dark-narrow.png', '93-surface-settings-zoomed.png', '94-surface-select-light.png', '95-surface-select-dark.png'], screenshotMethod: 'Electron BrowserWindow.capturePage with exact content-size assertions', scope: 'Real Electron 720x460 settings, independent category/detail scrolling, shared control dimensions and styled native select keyboard selection, native modal focus/inert background/Escape restoration, keyboard preference persistence, dynamic reduced-motion media, and seven empty/new-workspace settings categories at the dark minimum window with three zoom factors. Streaming motion uses a temporary CSS-class probe. This does not establish physical OS accessibility, populated/max-scale forms, every surface/control state, font redistribution rights or complete UI adoption.' };
}
