import assert from 'node:assert/strict';

export async function dismissModalWithEscape(page, dialog) {
  const close = await dialog.getByRole('button', { name: '关闭', exact: true }).elementHandle();
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
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
}

export async function assertTextHint(page, trigger, text, { hoverTarget = trigger } = {}) {
  const hint = page.locator('.control-tooltip:popover-open');
  await page.mouse.move(1, 1); await hoverTarget.hover(); await hint.filter({ hasText: text }).waitFor();
  assert.equal(await hint.count(), 1);
  assert.equal(await hint.textContent(), text);
  assert.equal(await hint.locator('img').count(), 0);
  assert.equal(await trigger.getAttribute('title'), null);
  assert.equal(await trigger.getAttribute('aria-describedby'), await hint.getAttribute('id'));
  assert.deepEqual(await hint.evaluate(element => {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    return { role: element.getAttribute('role'), font: style.fontSize, radius: style.borderRadius, padding: style.padding,
      fits: rect.left >= 7 && rect.top >= 7 && rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7,
      referenceWidth: rect.width <= 300.1, literalText: element.childElementCount === 0 };
  }), { role: 'tooltip', font: '14px', radius: '8px', padding: '8px 12px', fits: true, referenceWidth: true, literalText: true });
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
}
