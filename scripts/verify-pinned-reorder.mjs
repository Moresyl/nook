import assert from 'node:assert/strict';

export async function verifyPinnedReorder({ page, application, pinnedRows, originalTitle, capture }) {
  const section = page.locator('.thread-list').getByRole('region', { name: '已置顶', exact: true });
  const [first, second] = pinnedRows; const row = item => section.getByRole('button', { name: item.title, exact: true });
  const selected = () => page.locator('.thread-list').getByRole('button', { name: originalTitle, exact: true });
  const order = async () => section.locator('.thread-row').evaluateAll(elements => elements.map(element => element.dataset.pinnedId));
  const expectFirst = async id => { await page.waitForFunction(id => document.querySelector('.thread-row[data-pinned-id]')?.getAttribute('data-pinned-id') === id, id); assert.equal((await order())[0], id); };
  const snapshot = async () => page.evaluate(async ids => (await window.qiyao.load()).threads.filter(thread => ids.includes(thread.id)), pinnedRows.map(thread => thread.id));
  await row(second).focus(); await row(second).press('Alt+ArrowUp'); await expectFirst(second.id);
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-pinned-id') === id, second.id);
  assert.equal(await selected().getAttribute('aria-current'), 'page', 'Keyboard reorder never switches the active conversation');
  const beforeEdge = await snapshot(); await row(second).press('Alt+ArrowUp'); assert.deepEqual(await snapshot(), beforeEdge);
  for (const init of [{ key: 'ArrowDown', altKey: true, isComposing: true }, { key: 'Process', altKey: true }, { key: 'ArrowDown', altKey: true, keyCode: 229 }]) await row(second).evaluate((element, init) => element.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true })), init);
  assert.deepEqual(await snapshot(), beforeEdge, 'Composition events do not reorder pinned chats');
  const staleRejected = await page.evaluate(async thread => { try { await window.qiyao.updateThread(thread); return false; } catch (error) { return /pinned order changed/.test(String(error)); } }, second);
  assert.equal(staleRejected, true, 'A stale metadata update cannot erase the saved rank');
  async function begin() { await row(second).scrollIntoViewIfNeeded(); await row(first).scrollIntoViewIfNeeded(); const source = await row(first).boundingBox(); assert.ok(source); await page.mouse.move(source.x + 45, source.y + source.height / 2); await page.mouse.down(); return { x: source.x + 45, y: source.y + source.height / 2 }; }
  const origin = await begin(); await page.mouse.move(origin.x + 2, origin.y);
  assert.equal(await section.locator('[data-dragging]').count(), 0); await page.mouse.up();
  assert.equal(await row(first).getAttribute('aria-current'), 'page', 'Movement below four pixels remains a normal click');
  assert.deepEqual(await snapshot(), beforeEdge);
  await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: '搜索与命令', exact: true });
  await palette.getByRole('combobox').fill(originalTitle); await palette.getByRole('option', { name: originalTitle, exact: true }).click(); await palette.waitFor({ state: 'hidden' }); await selected().waitFor();
  let dragAttempt = 0;
  async function dragToSecond() {
    const start = await begin(); await page.mouse.move(start.x + 5, start.y);
    await section.locator('[data-dragging]').waitFor();
    const target = await row(second).boundingBox(), viewport = await page.locator('.thread-list').boundingBox(); assert.ok(target && viewport);
    assert.ok(target.y >= viewport.y && target.y + target.height <= viewport.y + viewport.height, 'The drag destination is inside the visible scroll viewport before moving the pointer');
    await page.mouse.move(target.x + 45, target.y + 4, { steps: 6 });
    console.log('Pinned drag geometry', JSON.stringify({ attempt: ++dragAttempt, start, target, state: await section.evaluate((element, point) => { const viewport = element.closest('.thread-list'), bounds = viewport.getBoundingClientRect(), hit = document.elementFromPoint(point.x, point.y)?.closest('[data-pinned-id]'); return { scrollTop: viewport.scrollTop, viewport: { top: bounds.top, bottom: bounds.bottom }, hit: hit?.getAttribute('data-pinned-id'), dragging: element.querySelector('[data-dragging]')?.getAttribute('data-pinned-id'), drop: element.querySelector('[data-drop-side]')?.getAttribute('data-pinned-id'), side: element.querySelector('[data-drop-side]')?.getAttribute('data-drop-side') }; }, { x: target.x + 45, y: target.y + 4 }) }));
    await capture(`112-pinned-drag-layout-${dragAttempt}.png`);
    await page.waitForFunction(id => document.querySelector(`[data-pinned-id="${CSS.escape(id)}"]`)?.getAttribute('data-drop-side') === 'before', second.id);
  }
  await dragToSecond(); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await section.locator('[data-dragging], [data-drop-side]').count(), 0); assert.deepEqual(await snapshot(), beforeEdge); assert.equal(await selected().getAttribute('aria-current'), 'page');
  await begin(); await page.mouse.move(500, 300); await page.mouse.up();
  assert.equal(await section.locator('[data-dragging], [data-drop-side]').count(), 0);
  assert.deepEqual(await snapshot(), beforeEdge, 'Moving directly outside the pinned list releases capture without saving a move');
  assert.equal(await selected().getAttribute('aria-current'), 'page');
  await begin(); const viewport = page.locator('.thread-list'); const bounds = await viewport.boundingBox(); assert.ok(bounds);
  await page.mouse.move(bounds.x + 45, bounds.y + bounds.height - 4);
  await page.waitForFunction(id => { const element = document.querySelector(`[data-pinned-id="${CSS.escape(id)}"]`), viewport = document.querySelector('.thread-list'); const row = element.getBoundingClientRect(), bounds = viewport.getBoundingClientRect(); return viewport.scrollTop > 0 && row.top >= bounds.top && row.bottom <= bounds.bottom; }, pinnedRows.at(-1).id);
  await page.keyboard.press('Escape'); await page.mouse.up();
  const stoppedAt = await viewport.evaluate(element => element.scrollTop);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await viewport.evaluate(element => element.scrollTop), stoppedAt, 'Cancelling a drag stops edge scrolling');
  assert.deepEqual(await snapshot(), beforeEdge);
  await dragToSecond(); await capture('111-pinned-reorder-pointer-light.png'); await page.mouse.up(); await expectFirst(first.id);
  assert.equal(await selected().getAttribute('aria-current'), 'page', 'A completed drag suppresses the following activation click');
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP');
  assert.equal(await application.evaluateMain(`(() => { const handlers=require('electron').ipcMain._invokeHandlers, original=handlers.get('qiyao:invoke'); if(typeof original!=='function') return false; let release; const held=new Promise(resolve=>{release=resolve;}); const fixture=globalThis.nookPinnedOrderFailure={original,release,calls:0}; handlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='reorderPinnedThread'){fixture.calls++;await held;throw new Error('PRIVATE_PIN_ORDER_FAILURE');}return original(event,method,...args);});return true;})()`), true);
  try {
    const beforeFailure = await snapshot(); await row(first).focus(); await row(first).press('Alt+ArrowDown');
    await page.waitForFunction(() => [...document.querySelectorAll('.thread-row[data-pinned-id]')].every(element => element.disabled));
    await row(first).evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })));
    assert.equal(await application.evaluateMain('globalThis.nookPinnedOrderFailure.calls'), 1);
    await application.evaluateMain('globalThis.nookPinnedOrderFailure.release()');
    await section.getByRole('alert').getByText('无法保存置顶顺序，请重试。', { exact: true }).waitFor();
    assert.equal((await section.textContent()).includes('PRIVATE_PIN_ORDER_FAILURE'), false);
    assert.deepEqual(await snapshot(), beforeFailure);
    await page.waitForFunction(id => document.activeElement?.getAttribute('data-pinned-id') === id, first.id);
  } finally { await application.evaluateMain(`(() => {const fixture=globalThis.nookPinnedOrderFailure;fixture.release();require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',fixture.original);delete globalThis.nookPinnedOrderFailure;})()`); }
  await row(first).press('Alt+ArrowDown'); await expectFirst(second.id); await section.getByRole('alert').waitFor({ state: 'hidden' });
  assert.equal(await selected().getAttribute('aria-current'), 'page');
  const final = await snapshot();
  assert.deepEqual(final.map(({ pinOrder, ...thread }) => thread), pinnedRows, 'Sorting preserves exact messages and timestamps');
  assert.equal(final.find(thread => thread.id === second.id).pinOrder, 0);
  return { keyboard: true, compositionGuard: true, staleMetadataRejected: true, fourPixelThreshold: true, escapeCancellation: true, outsideDropCancellation: true, edgeScrollCancellation: true, pointerReorder: true, noActivation: true, failedSaveRetry: true, expectedFirstId: second.id };
}
