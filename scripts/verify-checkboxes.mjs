import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyCheckboxes({ page, application, create, fixtures, screenshots }) {
  const captures = []; const windowExpression = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  async function capture(name) {
    const value = await application.evaluateMain(`(async () => { const window = ${windowExpression}; return { png: (await window.capturePage()).toPNG().toString('base64'), size: window.getContentSize() }; })()`);
    const png = Buffer.from(value.png, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], value.size);
    await writeFile(join(screenshots, name), png); captures.push(name);
  }
  async function theme(value) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, value);
    await page.reload(); await page.getByRole('button', { name: '自动任务', exact: true }).click();
  }
  for (const mode of ['light', 'dark']) {
    await theme(mode);
    const taskName = `复选框选择验证 ${mode}`;
    const dialog = await create(taskName, 'CHECKBOX_SELECTION_ONLY'); await dialog.getByText('助手、项目与上下文', { exact: true }).click();
    const first = dialog.getByRole('checkbox', { name: fixtures[0].name, exact: true }); const second = dialog.getByRole('checkbox', { name: fixtures[1].name, exact: true });
    await first.scrollIntoViewIfNeeded();
    const size = await first.evaluate(element => { const input = getComputedStyle(element); const text = getComputedStyle(element.closest('label').querySelector('.checkbox-text')); return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, border: input.borderTopWidth, radius: input.borderRadius, font: text.fontSize, line: text.lineHeight, gap: text.paddingLeft }; });
    assert.deepEqual(size, { width: 18, height: 18, border: '1px', radius: '4px', font: '14px', line: '20px', gap: '8px' });
    assert.equal(await first.isChecked(), false);
    await first.hover(); const hover = mode === 'light' ? 'rgb(175, 175, 175)' : 'rgb(143, 143, 143)';
    await page.waitForFunction(({ name, expected }) => { const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input'); return input && getComputedStyle(input).borderTopColor === expected; }, { name: fixtures[0].name, expected: hover });
    await first.focus(); await first.press('Space'); assert.equal(await first.isChecked(), true);
    const focus = await first.evaluate(element => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset, color: getComputedStyle(element).outlineColor }));
    assert.deepEqual(focus, { width: '2px', offset: '2px', color: mode === 'light' ? 'rgb(1, 105, 204)' : 'rgb(2, 133, 255)' });
    await first.press('Space'); assert.equal(await first.isChecked(), false);
    await first.locator('xpath=ancestor::label').click(); assert.equal(await first.isChecked(), true);
    await first.focus(); await first.press('Space'); assert.equal(await first.isChecked(), false);
    try {
      await first.evaluate(element => { element.disabled = true; });
      const bounds = await first.boundingBox(); await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); assert.equal(await first.isChecked(), false);
      await first.evaluate(element => { element.checked = true; });
      await page.waitForFunction(({ name, expected }) => { const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input'); return input && getComputedStyle(input).backgroundColor === expected; }, { name: fixtures[0].name, expected: mode === 'light' ? 'rgb(175, 175, 175)' : 'rgb(33, 33, 33)' });
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); assert.equal(await first.isChecked(), true);
    } finally { await first.evaluate(element => { element.disabled = false; element.checked = false; }); }
    await first.evaluate(element => { element.indeterminate = true; });
    await page.waitForFunction(name => { const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input'); return input?.indeterminate && getComputedStyle(input.nextElementSibling, '::before').opacity === '0'; }, fixtures[0].name);
    await first.focus(); await first.press('Space'); assert.equal(await first.isChecked(), true); assert.equal(await first.evaluate(element => element.indeterminate), false);
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await first.evaluate(element => getComputedStyle(element).transitionDuration), '0s');
      assert.equal(await first.evaluate(element => getComputedStyle(element.nextElementSibling).transitionDuration), '0s');
      await page.emulateMedia({ forcedColors: 'active' });
      const contrast = await first.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, mark: getComputedStyle(element.nextElementSibling, '::after').backgroundColor }));
      assert.notEqual(contrast.background, contrast.mark);
    } finally { await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' }); }
    await first.scrollIntoViewIfNeeded();
    await page.waitForFunction(({ name, expected }) => { const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input'); return input && getComputedStyle(input).backgroundColor === expected; }, { name: fixtures[0].name, expected: mode === 'light' ? 'rgb(24, 24, 24)' : 'rgb(237, 237, 237)' }, { timeout: 10_000 });
    await capture(`checkbox-${mode}.png`);
    if (mode === 'dark') {
      await application.resize(760, 540); await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1.5)`);
      await page.waitForFunction(() => Math.abs(innerWidth - 760 / 1.5) < 2);
      await first.focus(); await first.press('Tab'); assert.equal(await second.evaluate(element => element === document.activeElement), true);
      const bounds = await second.evaluate(element => { const input = element.getBoundingClientRect(); const label = element.closest('label').getBoundingClientRect(); const text = element.closest('label').querySelector('.checkbox-text').getBoundingClientRect(); return { visible: input.top >= 0 && input.bottom <= innerHeight, wraps: text.height > 20, fits: label.right <= innerWidth + 1, overflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.deepEqual(bounds, { visible: true, wraps: true, fits: true, overflow: false }); await capture('checkbox-dark-narrow.png');
      await application.evaluateMain(`${windowExpression}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
    }
    await dialog.getByRole('button', { name: '保存', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    const saved = await page.evaluate(async name => (await window.qiyao.load()).automations.find(task => task.name === name), taskName);
    assert.deepEqual(saved.knowledgeCollectionIds, [fixtures[0].id]); assert.equal(saved.enabled, false);
    await page.locator(`[data-automation-id="${saved.id}"]`).getByRole('button', { name: '编辑任务', exact: true }).click();
    await dialog.getByText('助手、项目与上下文', { exact: true }).click(); assert.equal(await first.isChecked(), true); assert.equal(await second.isChecked(), false);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.evaluate(id => window.qiyao.removeAutomation(id), saved.id);
  }
  await theme('light');
  return { themes: ['light', 'dark'], keyboardAndLabel: true, persistedSelection: true, disabledAndMixedProbes: true, reducedMotion: true, forcedColorsCheckedProbe: true, narrowZoom: 1.5, screenshots: captures, boundary: 'Real automation form and saved selections; disabled and mixed states are temporary DOM probes. Forced colors are emulated, not physical OS accessibility evidence.' };
}
