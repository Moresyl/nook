import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyCheckboxes({ page, application, create, fixtures, screenshots }) {
  const captures = []; const markMotion = []; const windowExpression = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
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
    const drawing = await first.evaluate(element => {
      const mark = element.nextElementSibling;
      const read = pseudo => { const style = getComputedStyle(mark, pseudo); return { properties: style.transitionProperty, durations: style.transitionDuration, delays: style.transitionDelay, transform: style.transform }; };
      return { before: read('::before'), after: read('::after') };
    });
    assert.deepEqual(drawing, {
      before: { properties: 'transform, opacity', durations: '0.1s, 0.2s', delays: '0.08s, 0s', transform: 'matrix(0, 0, 0, 0, 0, 0)' },
      after: { properties: 'transform', durations: '0.1s', delays: '0.16s', transform: 'matrix(0, 0, 0, 0, 0, 0)' },
    }, `${mode} unchecked mark retains both drawing segments and their independent delays`);
    await first.hover(); const hover = mode === 'light' ? 'rgb(175, 175, 175)' : 'rgb(143, 143, 143)';
    await page.waitForFunction(({ name, expected }) => { const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input'); return input && getComputedStyle(input).borderTopColor === expected; }, { name: fixtures[0].name, expected: hover });
    await first.focus();
    await first.evaluate(element => {
      const mark = element.nextElementSibling;
      const observation = { events: [], listener: undefined };
      observation.listener = event => {
        if (event.propertyName === 'transform' && ['::before', '::after'].includes(event.pseudoElement)) observation.events.push({ type: event.type, pseudo: event.pseudoElement, elapsedSeconds: event.elapsedTime, observedAt: performance.now() });
      };
      mark.__nookMarkDrawing = observation;
      for (const type of ['transitionstart', 'transitionend']) mark.addEventListener(type, observation.listener);
    });
    try {
      await first.press('Space'); assert.equal(await first.isChecked(), true);
      await page.waitForFunction(name => {
        const input = [...document.querySelectorAll('.checkbox-label')].find(label => label.textContent === name)?.querySelector('input');
        return input?.nextElementSibling.__nookMarkDrawing.events.filter(event => event.type === 'transitionend').length === 2;
      }, fixtures[0].name);
      const observed = await first.evaluate(element => {
        const mark = element.nextElementSibling;
        return { events: mark.__nookMarkDrawing.events, transforms: ['::before', '::after'].map(pseudo => getComputedStyle(mark, pseudo).transform), connected: mark.isConnected, checked: element.checked };
      });
      assert.deepEqual(observed.transforms, ['matrix(1, 0, 0, 1, 0, 0)', 'matrix(1, 0, 0, 1, 0, 0)']);
      assert.equal(observed.connected && observed.checked, true);
      assert.equal(observed.events.length, 4);
      for (const pseudo of ['::before', '::after']) {
        const events = observed.events.filter(event => event.pseudo === pseudo);
        assert.deepEqual(events.map(event => [event.type, event.elapsedSeconds]), [['transitionstart', 0], ['transitionend', 0.1]]);
        assert.ok(events[1].observedAt >= events[0].observedAt);
      }
      assert.ok(observed.events.findIndex(event => event.type === 'transitionstart' && event.pseudo === '::before') < observed.events.findIndex(event => event.type === 'transitionstart' && event.pseudo === '::after'));
      markMotion.push({ theme: mode, drawing, observed, clockAdvanced: false, timersReplaced: false });
    } finally {
      await first.evaluate(element => {
        const mark = element.nextElementSibling, observation = mark.__nookMarkDrawing;
        for (const type of ['transitionstart', 'transitionend']) mark.removeEventListener(type, observation.listener);
        delete mark.__nookMarkDrawing;
      });
    }
    const focus = await first.evaluate(element => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset, color: getComputedStyle(element).outlineColor }));
    assert.deepEqual(focus, { width: '2px', offset: '2px', color: mode === 'light' ? 'rgb(1, 105, 204)' : 'rgb(2, 133, 255)' });
    await first.press('Space'); assert.equal(await first.isChecked(), false);
    assert.equal(await first.evaluate(element => getComputedStyle(element.nextElementSibling).opacity), '0', 'Unchecking hides the mark immediately');
    await first.locator('xpath=ancestor::label').click(); assert.equal(await first.isChecked(), true);
    await first.focus(); await first.press('Space'); assert.equal(await first.isChecked(), false);
    await first.locator('xpath=ancestor::label').locator('.checkbox-text').dblclick();
    assert.equal(await first.isChecked(), false, 'Two native label clicks toggle twice');
    assert.equal(await first.evaluate(() => getSelection().toString()), '', 'Repeated label clicks do not select the label text');
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
      assert.deepEqual(await first.evaluate(element => ['::before', '::after'].map(pseudo => getComputedStyle(element.nextElementSibling, pseudo).transitionDuration)), ['0s', '0s']);
      await first.press('Space'); assert.equal(await first.isChecked(), false);
      assert.deepEqual(await first.evaluate(element => ['::before', '::after'].map(pseudo => getComputedStyle(element.nextElementSibling, pseudo).transform)), ['matrix(0, 0, 0, 0, 0, 0)', 'matrix(0, 0, 0, 0, 0, 0)']);
      await first.press('Space'); assert.equal(await first.isChecked(), true);
      assert.deepEqual(await first.evaluate(element => ['::before', '::after'].map(pseudo => getComputedStyle(element.nextElementSibling, pseudo).transform)), ['matrix(1, 0, 0, 1, 0, 0)', 'matrix(1, 0, 0, 1, 0, 0)']);
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
    await dismissModalWithEscape(page, dialog); await page.evaluate(id => window.qiyao.removeAutomation(id), saved.id);
  }
  await theme('light');
  return { themes: ['light', 'dark'], keyboardAndLabel: true, repeatedLabelClicks: true, immediateUncheckedMark: true, persistedSelection: true, disabledAndMixedProbes: true, markMotion, reducedMotion: true, forcedColorsCheckedProbe: true, narrowZoom: 1.5, screenshots: captures, boundary: 'Real automation form, native keyboard and repeated label clicks, actual pseudo-element transition events and saved selections. Timers and animation clocks are unchanged. Disabled and mixed states are temporary DOM probes. Reduced motion and forced colors are emulated, not physical OS accessibility evidence.' };
}
