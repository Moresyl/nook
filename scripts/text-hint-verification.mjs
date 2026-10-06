import assert from 'node:assert/strict';

export async function assertTextHint(page, trigger, text) {
  const hint = page.locator('.control-tooltip:popover-open');
  await trigger.hover(); await hint.filter({ hasText: text }).waitFor();
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
  await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  assert.equal(await trigger.getAttribute('aria-describedby'), null);
}
