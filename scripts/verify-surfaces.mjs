import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyStartupFallback } from './verify-startup-fallback.mjs';
import { verifyStartupRecovery } from './verify-startup-recovery.mjs';

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
  const geometry = await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height, top: bounds.top, left: bounds.left, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  const fullscreen = geometry.viewportWidth < 768;
  const expectedWidth = fullscreen ? geometry.viewportWidth : Math.min(720, geometry.viewportWidth - 32);
  const expectedHeight = fullscreen ? geometry.viewportHeight : Math.min(460, geometry.viewportHeight - 40);
  const expectedTop = fullscreen ? 0 : (geometry.viewportHeight - expectedHeight) * 4 / 9;
  for (const [property, expected] of [['width', expectedWidth], ['height', expectedHeight], ['top', expectedTop], ['left', (geometry.viewportWidth - expectedWidth) / 2]]) {
    assert.ok(Math.abs(geometry[property] - expected) <= 1, `Settings ${property} follows the reference viewport geometry: ${geometry[property]} vs ${expected}`);
  }
  assert.equal(await page.getByRole('dialog').count(), 1);
  return geometry;
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

async function assertFieldStates(page, dialog, mode, screenshots) {
  const shortcut = dialog.getByLabel('唤起快捷键', { exact: true });
  const original = await shortcut.inputValue();
  const saved = await page.evaluate(async () => (await window.qiyao.load()).preferences.desktop ?? null);
  const heading = dialog.getByRole('heading', { name: '桌面入口', exact: true });
  const border = () => shortcut.evaluate((element) => getComputedStyle(element).borderTopColor);
  const palette = mode === 'light'
    ? { hover: 'rgba(0, 0, 0, 0.25)', focus: 'rgba(0, 0, 0, 0.5)', invalid: 'rgb(224, 46, 42)' }
    : { hover: 'rgba(255, 255, 255, 0.3)', focus: 'rgba(255, 255, 255, 0.5)', invalid: 'rgb(186, 38, 35)' };
  await heading.click();
  await shortcut.hover();
  assert.equal(await border(), palette.hover, `${mode} input hover uses the reference alpha border`);
  await shortcut.focus();
  assert.equal(await border(), palette.focus, `${mode} input focus uses the stronger neutral border`);
  assert.equal(await shortcut.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
  await shortcut.fill('');
  await page.waitForFunction(() => document.querySelector('.desktop-settings input[aria-invalid="true"]'));
  assert.equal(await shortcut.getAttribute('aria-invalid'), 'true');
  assert.equal(await border(), palette.invalid, 'Invalid styling takes priority over focus');
  assert.equal(await dialog.getByRole('button', { name: '应用快捷键', exact: true }).isEnabled(), false);
  await heading.click(); await shortcut.hover();
  assert.equal(await border(), palette.invalid, 'Invalid styling takes priority over hover');
  await shortcut.focus();
  await page.screenshot({ path: join(screenshots, `97-field-invalid-${mode}.png`) });
  await shortcut.fill(original);
  await page.waitForFunction(() => document.querySelector('.desktop-settings input[aria-invalid="false"]'));
  assert.equal(await shortcut.getAttribute('aria-invalid'), 'false');
  assert.equal(await border(), palette.focus, 'Correcting the field restores its focused appearance');
  assert.equal(await dialog.getByRole('button', { name: '应用快捷键', exact: true }).isEnabled(), false);
  assert.deepEqual(await page.evaluate(async () => (await window.qiyao.load()).preferences.desktop ?? null), saved, 'Invalid input must not alter the saved desktop preferences');
}

async function assertControlGeometry(page, dialog, mode) {
  const theme = dialog.getByLabel('主题', { exact: true });
  assert.equal(await theme.evaluate(element => getComputedStyle(element).fontWeight), '500', `${mode} select uses the global medium weight`);
  assert.equal(await dialog.getByRole('heading', { name: '外观与交互', exact: true }).evaluate(element => getComputedStyle(element).fontWeight), '600', `${mode} heading uses the global semibold weight`);
  assert.equal(await dialog.locator('.field-label').first().evaluate(element => getComputedStyle(element).fontWeight), '500', `${mode} field label uses the global medium weight`);
  assert.deepEqual(await theme.evaluate(element => {
    const style = getComputedStyle(element); const picker = getComputedStyle(element, '::picker(select)');
    return { left: style.paddingLeft, right: style.paddingRight, gap: style.gap, pickerPadding: picker.paddingTop };
  }), { left: '6px', right: '6px', gap: '4px', pickerPadding: '6px' });
  await theme.focus();
  assert.equal(await theme.evaluate(element => getComputedStyle(element).borderTopColor), mode === 'light' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)');
  await theme.click();
  await page.waitForFunction(() => document.querySelector('select:open'));
  const option = theme.getByRole('option', { name: '跟随系统', exact: true });
  const highlight = mode === 'light' ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)';
  await option.hover();
  assert.deepEqual(await option.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, height: style.height, radius: style.borderRadius, lineHeight: style.lineHeight };
  }), { background: highlight, height: '36px', radius: '10px', lineHeight: '20px' });
  assert.equal(await theme.locator('option:checked').evaluate(element => getComputedStyle(element).fontWeight), '600');
  await page.keyboard.press('Home');
  assert.equal(await option.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).backgroundColor), highlight);
  await page.keyboard.press('Escape');
  assert.equal(await theme.inputValue(), mode, 'Inspecting menu states must not change the selected theme');
  const apply = dialog.getByRole('button', { name: '应用快捷键', exact: true });
  assert.deepEqual(await apply.evaluate(element => {
    const style = getComputedStyle(element);
    return { height: style.height, left: style.paddingLeft, right: style.paddingRight, gap: style.gap };
  }), { height: '20px', left: '6px', right: '6px', gap: '3px' });
  // Isolated controls exercise native pressed states without saving settings or sending requests.
  await dialog.evaluate(element => {
    const probe = document.createElement('div'); probe.dataset.controlAudit = '';
    for (const tone of ['ghost', 'solid']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `button button-${tone}`;
      button.textContent = `Control audit ${tone}`; probe.append(button);
    }
    element.querySelector('.modal-content').prepend(probe);
  });
  try {
    for (const [tone, expected] of [['ghost', mode === 'light' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.16)'], ['solid', mode === 'light' ? 'rgb(65, 65, 65)' : 'rgb(220, 220, 220)']]) {
      const button = dialog.getByRole('button', { name: `Control audit ${tone}`, exact: true });
      await button.focus(); await page.keyboard.down('Space');
      try {
        await page.waitForFunction(({ tone, expected }) => {
          const element = document.querySelector(`[data-control-audit] .button-${tone}`);
          return element?.matches(':active') && getComputedStyle(element).backgroundColor === expected;
        }, { tone, expected });
      } finally { await page.keyboard.up('Space'); }
    }
  } finally { await dialog.locator('[data-control-audit]').evaluate(element => element.remove()); }
}

async function assertIconTooltip(page, dialog, mode, screenshots) {
  const close = dialog.locator('.modal-header').getByRole('button', { name: '关闭', exact: true });
  const hint = page.locator('.control-tooltip:popover-open');
  await dialog.getByRole('heading', { name: '外观与交互', exact: true }).hover();
  await close.hover(); await hint.waitFor();
  assert.equal(await hint.textContent(), '关闭');
  assert.equal(await close.getAttribute('title'), null, 'The styled hint must not compete with a native title popup');
  assert.equal(await close.getAttribute('aria-describedby'), await hint.getAttribute('id'));
  assert.deepEqual(await hint.evaluate(element => {
    const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return { role: element.getAttribute('role'), inModal: Boolean(element.closest('dialog:modal')), fits: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
      font: style.fontSize, radius: style.borderRadius, padding: style.padding, pointerEvents: style.pointerEvents };
  }), { role: 'tooltip', inModal: true, fits: true, font: '14px', radius: '8px', padding: '8px 12px', pointerEvents: 'none' });
  await page.screenshot({ path: join(screenshots, `100-tooltip-${mode}.png`) });
  await dialog.getByRole('heading', { name: '外观与交互', exact: true }).hover();
  await hint.waitFor({ state: 'hidden' });
  await close.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await close.evaluate(element => element === document.activeElement), true);
  await hint.waitFor();
  await page.keyboard.press('Tab'); await hint.waitFor({ state: 'hidden' });
  assert.equal(await close.getAttribute('aria-describedby'), null);
}

async function assertTooltipEdges(page, screenshots) {
  const sidebar = page.getByRole('button', { name: '收起侧边栏', exact: true });
  const close = page.getByRole('button', { name: '关闭窗口', exact: true });
  const hint = page.locator('.control-tooltip:popover-open');
  await sidebar.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await hint.filter({ hasText: /^收起侧边栏$/ }).waitFor();
  await close.hover(); await hint.filter({ hasText: /^关闭窗口$/ }).waitFor();
  assert.equal(await hint.count(), 1, 'Hovering another icon replaces the keyboard hint');
  assert.equal(await sidebar.getAttribute('aria-describedby'), null);
  assert.equal(await sidebar.evaluate(element => element === document.activeElement), true, 'Hovering a hint does not steal keyboard focus');
  assert.equal(await hint.evaluate(element => element.getBoundingClientRect().right <= innerWidth - 7), true);
  await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
  assert.equal(await sidebar.evaluate(element => element === document.activeElement), true);
  // Move the owned window's icon temporarily to exercise the lower-edge flip.
  const originalStyle = await close.getAttribute('style');
  await close.evaluate(element => { element.style.position = 'fixed'; element.style.inset = 'auto 8px 8px auto'; });
  try {
    await page.getByRole('heading', { name: /./ }).first().hover();
    await close.hover(); await hint.waitFor();
    const buttonBounds = await close.boundingBox(); const hintBounds = await hint.boundingBox();
    assert.ok(hintBounds.y + hintBounds.height <= buttonBounds.y, 'A bottom-edge hint flips above its icon');
    assert.ok(hintBounds.x >= 8 && hintBounds.y >= 8);
    await page.screenshot({ path: join(screenshots, '101-tooltip-edge.png') });
    await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
  } finally { await close.evaluate((element, style) => { if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style); }, originalStyle); }
  await sidebar.click();
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  assert.equal(await hint.count(), 0, 'Clicking an icon and unmounting its old trigger removes the hint');
}

async function assertButtonTooltips(page, application, screenshots, draft) {
  const hint = page.locator('.control-tooltip:popover-open');
  const settings = page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ });
  await settings.hover(); await hint.filter({ hasText: /^设置$/ }).waitFor();
  assert.equal(await settings.getAttribute('title'), null);
  await settings.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.waitFor();
  assert.equal(await settings.getAttribute('aria-describedby'), null, 'Keyboard activation dismisses the button hint');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.equal(await settings.evaluate(element => element === document.activeElement), true);
  const composer = page.getByLabel('消息', { exact: true });
  await composer.fill('');
  const compare = page.getByRole('button', { name: '发送给多个模型比较', exact: true });
  assert.equal(await compare.isDisabled(), true);
  await compare.hover(); await hint.filter({ hasText: /^发送给多个模型比较$/ }).waitFor();
  assert.equal(await compare.getAttribute('aria-describedby'), await hint.getAttribute('id'));
  await page.screenshot({ path: join(screenshots, '102-button-tooltip-disabled.png') });
  await composer.fill(draft);
  await page.getByRole('button', { name: '临时聊天', exact: true }).click();
  await page.locator('.thread-title').click();
  const rename = page.getByRole('dialog', { name: '重命名聊天', exact: true });
  const title = '<img src=x> 长标题完整展示与安全换行 '.repeat(6).trim();
  await rename.getByLabel('聊天名称', { exact: true }).fill(title);
  await rename.getByRole('button', { name: '保存', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  try {
    await application.resize(760, 540);
    const thread = page.locator('.thread-title');
    await thread.hover(); await hint.filter({ hasText: title }).waitFor();
    assert.equal(await hint.textContent(), title);
    assert.equal(await hint.locator('img').count(), 0, 'Tooltip content remains escaped text');
    assert.equal(await hint.evaluate(element => {
      const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return rect.width <= 320 && rect.height > 2 * parseFloat(style.lineHeight) && rect.left >= 8 && rect.right <= innerWidth - 8 && element.scrollHeight <= element.clientHeight;
    }), true, 'Long button descriptions wrap without being truncated or escaping the viewport');
    await page.screenshot({ path: join(screenshots, '103-button-tooltip-long.png') });
    await application.resize(1280, 840);
    await hint.waitFor({ state: 'hidden' });
  } finally {
    await page.getByRole('button', { name: '删除聊天', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '删除聊天？', exact: true });
    await confirmation.getByRole('button', { name: '删除', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    await application.resize(1280, 840);
  }
  assert.equal(await composer.inputValue(), draft, 'Tooltip checks preserve the original new-chat draft');
}

async function assertTooltipModalScope(page, draft) {
  const trigger = page.getByRole('button', { name: '资料库', exact: true });
  const hint = page.locator('.control-tooltip:popover-open');
  const composer = page.getByLabel('消息', { exact: true });
  for (const pending of [true, false]) {
    await composer.focus(); await composer.hover();
    await trigger.hover();
    if (!pending) await hint.filter({ hasText: /^资料库$/ }).waitFor();
    await page.keyboard.press('Control+,');
    const dialog = page.getByRole('dialog', { name: '设置', exact: true });
    await dialog.waitFor();
    // Observe beyond the 500 ms hover delay, including a hint queued before the modal opens.
    await page.waitForTimeout(600);
    assert.equal(await hint.evaluateAll(elements => elements.some(element => !element.closest('dialog:modal'))), false, 'Opening a modal must dismiss active and pending background hints');
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await composer.inputValue(), draft);
    assert.equal(await composer.evaluate(element => element === document.activeElement), true);
  }
}

export async function verifySurfaces({ page, application, screenshots, verified, waitForBridge }) {
  await verifyStartupFallback({ page, application, screenshots });
  await verifyStartupRecovery({ page, application, screenshots, waitForBridge });
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
  await assertTooltipModalScope(page, draft);
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
  const checkedSwitchStates = [];
  // Exercise the real switch in both themes; disabled is a temporary CSS-state probe.
  if (original) {
    await toggle.focus(); await toggle.press('Space');
    await waitForBridge(page, async () => !(await window.qiyao.load()).preferences.enterToSend && !document.querySelector('.toggle-label input').checked);
  }
  for (const [mode, off, hover, disabled] of [
    ['light', 'rgb(223, 223, 223)', 'rgb(205, 205, 205)', 'rgb(237, 237, 237)'],
    ['dark', 'rgb(65, 65, 65)', 'rgb(79, 79, 79)', 'rgb(48, 48, 48)'],
  ]) {
    await theme.selectOption(mode);
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, mode);
    await dialog.getByRole('heading', { name: '外观与交互', exact: true }).hover();
    const trackColor = () => toggle.evaluate((element) => getComputedStyle(element.nextElementSibling).backgroundColor);
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await trackColor(), off, `${mode} unchecked switch follows the reference palette`);
    await toggle.locator('..').hover();
    assert.equal(await trackColor(), hover, `${mode} unchecked switch has a distinct hover state`);
    await toggle.evaluate((element) => { element.disabled = true; element.closest('label').classList.add('disabled'); });
    try {
      assert.equal(await trackColor(), disabled, `${mode} disabled switch does not inherit hover color`);
      assert.equal(await toggle.evaluate((element) => getComputedStyle(element.closest('label')).opacity), '0.25');
      assert.equal(await toggle.evaluate((element) => getComputedStyle(element.nextElementSibling.firstElementChild).backgroundColor), 'rgb(255, 255, 255)');
    } finally {
      await toggle.evaluate((element) => { element.disabled = false; element.closest('label').classList.remove('disabled'); });
    }
    await captureSurface(page, application, join(screenshots, `96-switch-${mode}.png`));
    await toggle.focus(); await toggle.press('ArrowRight');
    assert.equal(await toggle.evaluate((element) => getComputedStyle(element.nextElementSibling).outlineColor), mode === 'light' ? 'rgb(1, 105, 204)' : 'rgb(2, 133, 255)', 'Switch keyboard focus uses the reference ring color');
    await toggle.press('Space');
    await page.waitForFunction(() => {
      const input = document.querySelector('.toggle-label input');
      return input.checked && getComputedStyle(input.nextElementSibling).backgroundColor === 'rgb(51, 156, 255)';
    });
    assert.equal(await page.evaluate(async () => (await window.qiyao.load()).preferences.enterToSend), true);
    assert.equal(await trackColor(), 'rgb(51, 156, 255)', `${mode} checked switch follows the desktop application accent override`);
    await toggle.locator('..').hover();
    assert.equal(await trackColor(), 'rgb(51, 156, 255)', 'Checked hover preserves its enabled color');
    await toggle.evaluate(element => { element.disabled = true; element.closest('label').classList.add('disabled'); });
    try {
      const pixel = await toggle.evaluate(element => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d'); context.fillStyle = getComputedStyle(element.nextElementSibling).backgroundColor;
        context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data);
      });
      for (const [index, expected] of [51, 156, 255, 128].entries()) assert.ok(Math.abs(pixel[index] - expected) <= 1, 'Disabled checked track uses the reference half-transparent accent');
      const bounds = await toggle.locator('..').boundingBox();
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      assert.equal(await toggle.isChecked(), true, 'Clicking a disabled checked switch does not toggle it');
      assert.equal(await page.evaluate(async () => (await window.qiyao.load()).preferences.enterToSend), true);
      checkedSwitchStates.push({ theme: mode, enabledColor: 'rgb(51, 156, 255)', disabledRgba: pixel, disabledClickPreserved: true });
    } finally { await toggle.evaluate(element => { element.disabled = false; element.closest('label').classList.remove('disabled'); }); }
    await captureSurface(page, application, join(screenshots, `99-switch-checked-${mode}.png`));
    await toggle.focus(); await toggle.press('Space');
    await waitForBridge(page, async () => !(await window.qiyao.load()).preferences.enterToSend && !document.querySelector('.toggle-label input').checked);
    await assertFieldStates(page, dialog, mode, screenshots);
    await assertControlGeometry(page, dialog, mode);
    await assertIconTooltip(page, dialog, mode, screenshots);
  }
  await theme.selectOption('light');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  if (original) {
    await toggle.focus(); await toggle.press('Space');
    await waitForBridge(page, async () => (await window.qiyao.load()).preferences.enterToSend && document.querySelector('.toggle-label input').checked);
  }
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
  const categories = ['模型连接', 'MCP 工具', '本地技能', '本地插件', '记忆', '外观与交互', '数据与备份', '关于 Nook'];
  const geometryChecks = [];
  for (const [width, height, zoom] of [
    ...zooms.map(zoom => [760, 540, zoom]),
    ...zooms.map(zoom => [1280, 540, zoom]),
    [768, 540, 1],
  ]) {
    await application.resize(width, height);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction((expected) => Math.abs(innerWidth - expected) <= 2, width / zoom);
    dialog = await open();
    geometryChecks.push({ windowWidth: width, windowHeight: height, zoom, ...await assertModalLayout(page, dialog) });
    await assertFocusBoundary(page, dialog);
    for (const category of categories) {
      await dialog.getByRole('button', { name: category, exact: true }).click();
      await assertModalLayout(page, dialog);
    }
    await dialog.getByRole('button', { name: '外观与交互', exact: true }).click();
    if (width === 760 && zoom !== 1) await captureSurface(page, application, join(screenshots, zoom === 1.25 ? '92-surface-controls-dark-narrow.png' : '93-surface-settings-zoomed.png'));
    if (width === 1280 && zoom === 1.5) await captureSurface(page, application, join(screenshots, '98-surface-short-wide.png'));
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('dialog .control-tooltip:popover-open').count(), 0, 'Closing a modal must remove its own hints; restored keyboard focus may show the opener hint');
    assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  await application.resize(1280, 840);
  await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 840);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await assertTooltipEdges(page, screenshots);
  await assertButtonTooltips(page, application, screenshots, draft);
  verified('all seven settings categories follow reference viewport geometry in minimum and short-wide windows at 100/125/150 percent Electron zoom and the 768px boundary, retain native focus and restore the opener/draft after Escape');
  return { checks: 4, startupFallback: { passed: true, scope: 'Built entry document in isolated Electron window with page scripts disabled; system theme and reduced-motion emulation; normal renderer replacement' }, startupRecovery: { passed: true, scope: 'Isolated initial-load IPC rejection and delay; persistent error, keyboard retry, narrow layout and exact saved-draft restoration; not corrupt-vault recovery' }, settingsCategories: categories, zoomFactors: zooms, geometryChecks, checkedSwitchStates, screenshots: ['91-surface-controls-light.png', '92-surface-controls-dark-narrow.png', '93-surface-settings-zoomed.png', '94-surface-select-light.png', '95-surface-select-dark.png', '96-switch-light.png', '96-switch-dark.png', '97-field-invalid-light.png', '97-field-invalid-dark.png', '98-surface-short-wide.png', '99-switch-checked-light.png', '99-switch-checked-dark.png', '100-tooltip-light.png', '100-tooltip-dark.png', '101-tooltip-edge.png', '102-button-tooltip-disabled.png', '103-button-tooltip-long.png', '104-startup-light.png', '104-startup-dark.png', '105-startup-error.png', '105-startup-error-narrow.png'], screenshotMethod: 'Electron BrowserWindow.capturePage with exact content-size assertions for surface captures; Playwright screenshot for invalid shortcut fields', scope: 'Real Electron settings with measured reference viewport dimensions/position at seven window/zoom combinations, independent category/detail scrolling, shared control dimensions, real select hover/keyboard-highlight/selection states in both themes, native modal focus/inert background/Escape restoration, keyboard preference persistence, light/dark switch off/hover/checked/disabled palettes and ignored disabled clicks, reference keyboard focus rings, shared button and icon tooltip hover/keyboard focus/modal scope/theme metrics/viewport fit/single-active replacement/Escape/pointer and keyboard activation dismissal, disabled-button descriptions, escaped and wrapped long titles, resize dismissal and new-chat draft restoration, real invalid shortcut input with hover/focus priority and saved-preference preservation, dynamic reduced-motion media, and seven empty/new-workspace settings categories. Streaming motion, switch disabled state and button pressed states use temporary CSS-state probes. This does not establish physical OS accessibility, populated/max-scale forms, every surface/control state, font redistribution rights or complete UI adoption.' };
}
