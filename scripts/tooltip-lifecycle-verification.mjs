import assert from 'node:assert/strict';

/** Observe actual renderer timers without advancing time or changing their delays. */
export async function verifyTooltipLifecycle({ page, application, mainWindow, composer }) {
  const first = page.getByRole('button', { name: '收起侧边栏', exact: true });
  const second = page.getByRole('button', { name: '关闭窗口', exact: true });
  const hint = page.locator('.control-tooltip:popover-open');
  const draft = await composer.inputValue();
  await composer.focus(); await composer.hover(); await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const audit = { stage: '', startedAt: 0, timers: [], events: [], original: window.setTimeout };
    const observe = event => {
      if (event.type === 'beforetoggle' && event.target.getAttribute('role') !== 'tooltip') return;
      audit.events.push({ type: event.type, state: event.newState, time: performance.now() });
    };
    document.addEventListener('pointerover', observe, true);
    document.addEventListener('beforetoggle', observe, true);
    window.addEventListener('blur', observe);
    window.addEventListener('focus', observe);
    window.setTimeout = function (callback, delay, ...args) {
      if (audit.stage) audit.timers.push({ delay: Number(delay ?? 0), time: performance.now() });
      return Reflect.apply(audit.original, window, [callback, delay, ...args]);
    };
    window.nookTooltipAudit = { audit, stop() {
      window.setTimeout = audit.original;
      document.removeEventListener('pointerover', observe, true);
      document.removeEventListener('beforetoggle', observe, true);
      window.removeEventListener('blur', observe);
      window.removeEventListener('focus', observe);
      delete window.nookTooltipAudit;
    } };
  });
  const observations = [];
  let focusSession;
  let focusProbeCreated = false;
  const focusNativeWindow = async () => {
    await application.evaluateMain(`(() => { globalThis.nookTooltipFocusProbe.hide(); const main = ${mainWindow}; main.show(); main.focus(); main.webContents.focus(); })()`);
    await page.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5_000 });
    assert.deepEqual(await application.evaluateMain(`({ mainFocused: ${mainWindow}.isFocused(), probeFocused: globalThis.nookTooltipFocusProbe.isFocused() })`), { mainFocused: true, probeFocused: false });
  };
  const blurNativeWindow = async () => {
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const state = await application.evaluateMain(`(() => { const main = ${mainWindow}; main.blur(); globalThis.nookTooltipFocusProbe.show(); globalThis.nookTooltipFocusProbe.focus(); return { mainFocused: main.isFocused(), probeFocused: globalThis.nookTooltipFocusProbe.isFocused() }; })()`);
    console.log('Tooltip native focus transfer', JSON.stringify(state));
    await page.waitForFunction(() => !document.hasFocus(), undefined, { timeout: 5_000 });
    assert.deepEqual(await application.evaluateMain(`({ mainFocused: ${mainWindow}.isFocused(), probeFocused: globalThis.nookTooltipFocusProbe.isFocused() })`), { mainFocused: false, probeFocused: true });
  };
  const stage = name => page.evaluate(name => Object.assign(window.nookTooltipAudit.audit, { stage: name, startedAt: performance.now(), timers: [], events: [] }), name);
  const record = async () => {
    const row = await page.evaluate(() => {
      const { stage, startedAt, timers, events } = window.nookTooltipAudit.audit;
      return { stage, startedAt, timers, events, hintCount: document.querySelectorAll('.control-tooltip:popover-open').length };
    });
    observations.push(row); return row;
  };
  const quiet = async () => {
    const start = await page.evaluate(() => performance.now());
    await page.waitForFunction(start => performance.now() - start >= 350, start, { timeout: 5_000 });
  };
  const delayed = async (target, name) => {
    await stage(name); await target.hover(); await hint.waitFor();
    const row = await record();
    assert.deepEqual(row.timers.filter(timer => timer.delay === 200 || timer.delay === 500).map(timer => timer.delay), [200], `${name}: the cold native hover uses the reference delay`);
    const entered = row.events.find(event => event.type === 'pointerover');
    const opened = row.events.find(event => event.type === 'beforetoggle' && event.state === 'open');
    assert.ok(entered && opened && opened.time - entered.time >= 190, `${name}: actual opening waits for the real timer`);
  };
  try {
    await delayed(first, 'cold hover');
    await stage('open handoff'); await second.hover(); await hint.filter({ hasText: /^关闭窗口$/ }).waitFor();
    assert.equal((await record()).timers.some(timer => timer.delay === 200), false);
    assert.equal(await hint.count(), 1);
    await stage('recent closed handoff'); await composer.hover(); await hint.waitFor({ state: 'hidden' });
    await first.hover(); await hint.filter({ hasText: /^收起侧边栏$/ }).waitFor();
    assert.equal((await record()).timers.some(timer => timer.delay === 200), false);
    await composer.hover(); await hint.waitFor({ state: 'hidden' }); await quiet();
    await delayed(second, 'expired handoff');
    await page.keyboard.press('Escape'); await hint.waitFor({ state: 'hidden' });
    await stage('pointer move after Escape');
    const bounds = await second.boundingBox(); await page.mouse.move(bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2);
    await hint.waitFor(); assert.equal((await record()).timers.some(timer => timer.delay === 200), true);
    for (const action of ['leave', 'Escape', 'window blur']) {
      await composer.hover(); await page.keyboard.press('Escape');
      if (action === 'window blur') {
        // The original Playwright CDP attachment enables focus emulation by default.
        const opened = page.context().waitForEvent('page');
        await application.evaluateMain(`(async () => { if (globalThis.nookTooltipFocusProbe) throw new Error('Tooltip focus probe already exists'); const { BrowserWindow } = require('electron'); const probe = new BrowserWindow({ parent: ${mainWindow}, width: 160, height: 100, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); globalThis.nookTooltipFocusProbe = probe; await probe.loadURL('about:blank'); })()`);
        focusProbeCreated = true;
        const probe = await opened; await probe.waitForLoadState('load');
        focusSession = await page.context().newCDPSession(page);
        await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        await focusNativeWindow();
      }
      await stage(`pending ${action}`); await first.hover();
      if (action === 'leave') await composer.hover();
      else if (action === 'Escape') await page.keyboard.press('Escape');
      else {
        await blurNativeWindow();
      }
      await quiet(); assert.equal(await hint.count(), 0, `${action} cancels an actual pending hint`); await record();
      if (action === 'window blur') await focusNativeWindow();
    }
    await composer.hover(); await delayed(first, 'hover after native focus return');
    await blurNativeWindow();
    await hint.waitFor({ state: 'hidden' });
    await focusNativeWindow();
    await application.evaluateMain('globalThis.nookTooltipFocusProbe.destroy(); delete globalThis.nookTooltipFocusProbe');
    focusProbeCreated = false;
    await application.evaluateMain(`${mainWindow}.focus()`);
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await focusSession.detach(); focusSession = undefined;
    await composer.focus(); await composer.hover(); await first.focus();
    await stage('keyboard focus'); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await hint.waitFor(); assert.equal((await record()).timers.some(timer => timer.delay === 200), false);
    await first.hover(); await composer.hover(); await hint.waitFor({ state: 'hidden' });
    assert.equal(await first.evaluate(element => document.activeElement === element), true, 'Pointer leave dismisses even a keyboard hint without moving focus');
    await stage('context menu dismissal');
    await first.hover(); await hint.waitFor(); await first.click({ button: 'right' }); await hint.waitFor({ state: 'hidden' }); await record();
    await page.keyboard.press('Escape'); await composer.hover();
    const activation = page.locator('.primary-nav').getByRole('button', { name: /^新聊天/ });
    await stage('click suppression'); await activation.hover(); await hint.filter({ hasText: /^新聊天$/ }).waitFor();
    const activatedElement = await activation.elementHandle();
    await activation.click(); await hint.waitFor({ state: 'hidden' });
    assert.equal(await activatedElement.evaluate(element => element.isConnected), true, 'The clicked trigger remains mounted for the pointer-move check');
    const activationBounds = await activation.boundingBox(); await page.mouse.move(activationBounds.x + 3, activationBounds.y + 3);
    await quiet(); assert.equal(await hint.count(), 0, 'Click suppression prevents pointer-move reopening');
    await record(); await activatedElement.dispose();
    await stage('fresh pointer entry after click'); await composer.hover(); await activation.hover(); await hint.filter({ hasText: /^新聊天$/ }).waitFor(); await record();
    await composer.focus(); await composer.hover(); await page.keyboard.press('Escape');
    await stage('synthetic touch guard'); await first.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true });
    await quiet(); assert.equal(await hint.count(), 0); assert.equal((await record()).timers.some(timer => timer.delay === 200), false);
    assert.equal(await composer.inputValue(), draft);
    return { passed: true, observations, sourceOpenDelayMs: 200, sourceSkipIntervalMs: 300, clockAdvanced: false, originalTimeoutCallbacksRetained: true, focusEmulationDisabledOnlyDuringNativeBlur: true, originalFocusEmulationRestored: true,
      scope: 'Actual source Electron input, popover events, unchanged timer delegation, native focus transfer to an owned sandboxed blank child window, keyboard and sidebar activation. The auxiliary window is destroyed and focus emulation restored. Touch uses a synthetic PointerEvent and is not physical touch acceptance. The default noninteractive branch closes immediately; the separate interactive grace triangle is outside this component.' };
  } catch (error) {
    console.error('Tooltip lifecycle failure observation', JSON.stringify({ observations, current: await record(), nativeFocused: await application.evaluateMain(`${mainWindow}.isFocused()`), rendererFocused: await page.evaluate(() => document.hasFocus()) }));
    throw error;
  } finally {
    if (focusProbeCreated) await application.evaluateMain('globalThis.nookTooltipFocusProbe.destroy(); delete globalThis.nookTooltipFocusProbe');
    if (focusSession) {
      await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await focusSession.detach();
    }
    await page.evaluate(() => window.nookTooltipAudit?.stop());
  }
}
