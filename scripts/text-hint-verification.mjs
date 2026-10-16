import assert from 'node:assert/strict';

export async function dismissModalWithEscape(page, dialog) {
  const close = await dialog.locator(':scope > .modal-header').getByRole('button', { name: '关闭', exact: true }).elementHandle();
  assert.ok(close, 'The modal must expose its close control');
  try {
    await page.waitForFunction(button => button.isConnected && !button.disabled, close, { timeout: 5_000 });
  } finally { await close.dispose(); }
  await page.mouse.move(1, 1);
  const hint = page.locator('.control-tooltip:popover-open');
  if (await hint.count()) {
    assert.equal(await hint.count(), 1);
    assert.equal(await hint.evaluate(element => Boolean(element.closest('dialog:modal'))), true);
    const focused = await page.evaluateHandle(() => document.activeElement);
    try {
      await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
      assert.equal(await dialog.isVisible(), true, 'Escape dismisses the active hint before its parent modal');
      assert.equal(await focused.evaluate(element => document.activeElement === element), true);
    } finally { await focused.dispose(); }
  }
  const settings = await dialog.evaluate(element => element.classList.contains('settings-dialog'));
  await page.keyboard.press('Escape');
  if (settings) {
    await page.waitForFunction(() => !document.querySelector('dialog.settings-dialog[open]') || Boolean(document.querySelector('dialog.settings-discard-dialog[open]')));
    const confirmation = page.getByRole('dialog', { name: '放弃未保存的更改？', exact: true });
    if (await confirmation.isVisible()) {
      assert.equal(await dialog.isVisible(), true, 'Dirty settings remain open until explicit discard');
      assert.equal(await confirmation.getByRole('button', { name: '继续编辑', exact: true }).evaluate(element => document.activeElement === element), true);
      assert.equal(await confirmation.locator('.modal-header button').count(), 0);
      await confirmation.getByRole('button', { name: '放弃更改', exact: true }).click();
    }
  }
  await dialog.waitFor({ state: 'hidden' });
}

export async function assertTextHint(page, trigger, text, { hoverTarget = trigger } = {}) {
  const hint = page.locator('.control-tooltip:popover-open');
  await page.mouse.move(1, 1); await hoverTarget.hover(); await hint.filter({ hasText: text }).waitFor();
  assert.equal(await hint.count(), 1);
  assert.equal(await hint.textContent(), text);
  assert.equal(await hint.locator('img').count(), 0);
  assert.equal(await trigger.getAttribute('title'), null);
  assert.equal(await trigger.getAttribute('aria-describedby'), await hint.getAttribute('id'));
  const metrics = await hint.evaluate(element => {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d'); context.fillStyle = style.borderTopColor; context.fillRect(0, 0, 1, 1);
    return { role: element.getAttribute('role'), font: style.fontSize, radius: style.borderRadius, padding: style.padding,
      lineHeight: style.lineHeight, weight: style.fontWeight, align: style.textAlign, borderWidth: style.borderTopWidth,
      whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
      background: style.backgroundColor, color: style.color, borderPixel: [...context.getImageData(0, 0, 1, 1).data],
      dark: document.documentElement.dataset.theme === 'dark', pixelRatio: devicePixelRatio,
      mixSupported: CSS.supports('color', 'color-mix(in oklab, white 5%, transparent)'),
      fits: rect.left >= 7 && rect.top >= 7 && rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7,
      referenceWidth: rect.width <= 320.1, literalText: element.childElementCount === 0,
      unclipped: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1 };
  });
  const { dark, pixelRatio, mixSupported, borderPixel, borderWidth, ...style } = metrics;
  assert.deepEqual(style, { role: 'tooltip', font: '14px', radius: '16px', padding: '5px 12px', lineHeight: '18px', weight: '430',
    align: 'center', whiteSpace: 'normal', overflowWrap: 'anywhere', background: dark ? 'rgb(45, 45, 45)' : 'rgb(26, 28, 31)',
    color: dark ? 'rgb(223, 223, 223)' : 'rgb(255, 255, 255)', fits: true, referenceWidth: true, literalText: true, unclipped: true });
  assert.equal(mixSupported, true, 'The actual Electron runtime must support the reference border blend');
  assert.ok([1, 1.25, 1.5].includes(pixelRatio), 'The owned native harness fixes display scale and varies actual page zoom');
  // Chromium snaps this one-CSS-pixel border to one device pixel at these zooms.
  assert.ok(Math.abs(parseFloat(borderWidth) * pixelRatio - 1) < .001, 'Tooltip border retains one physical pixel at every tested zoom');
  assert.equal(borderPixel[3], 13);
  for (const channel of borderPixel.slice(0, 3)) assert.ok(Math.abs(channel - (dark ? 223 : 255)) <= 10, 'Tooltip border retains its text color at five percent alpha');
  // Keep keyboard acceptance independent of pointer leave during focus scrolling.
  await page.mouse.move(1, 1); await hint.waitFor({ state: 'hidden' });
  await trigger.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.equal(await trigger.evaluate(element => document.activeElement === element && element.matches(':focus-visible')), true);
  await hint.filter({ hasText: text }).waitFor();
  if (process.env.QIYAO_TEST_TOOLTIP_DIAGNOSTICS) console.log('Text hint keyboard dismissal', JSON.stringify(await trigger.evaluate(element => ({
    description: element.getAttribute('aria-describedby'), active: document.activeElement === element,
    modal: Boolean(element.closest('dialog:modal')), hints: [...document.querySelectorAll('.control-tooltip:popover-open')].map(tip => ({ id: tip.id, text: tip.textContent?.slice(0, 512) })),
  }))));
  await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  assert.equal(await trigger.getAttribute('aria-describedby'), null);
  return metrics;
}
