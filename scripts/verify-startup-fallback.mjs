import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Inspect the built entry document with scripts disabled, before React can replace it. */
export async function verifyStartupFallback({ page, application, screenshots }) {
  const opened = page.context().waitForEvent('page');
  const id = await application.evaluateMain(`(() => {
    const { BrowserWindow } = require('electron');
    const source = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/'));
    const probe = new BrowserWindow({ width: 760, height: 540, useContentSize: true, show: false, webPreferences: { javascript: false, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    probe.once('ready-to-show', () => probe.showInactive());
    void probe.loadURL(source.webContents.getURL());
    return probe.id;
  })()`);
  try {
    const probe = await opened;
    await probe.waitForLoadState('domcontentloaded');
    const loader = probe.getByRole('status', { name: '正在打开 Nook', exact: true });
    await loader.waitFor();
    for (const colorScheme of ['light', 'dark']) {
      await probe.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
      const state = await loader.evaluate(element => {
        const mark = element.querySelector('.startup-mark');
        const rect = mark.getBoundingClientRect();
        const style = getComputedStyle(mark);
        return { width: rect.width, height: rect.height, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2, viewportWidth: innerWidth, viewportHeight: innerHeight, background: getComputedStyle(element).backgroundColor, draggable: getComputedStyle(element).getPropertyValue('-webkit-app-region'), fade: style.animationDuration, delay: style.animationDelay, shimmer: getComputedStyle(mark, '::after').animationName, svg: Boolean(mark.querySelector('svg[aria-hidden="true"]')) };
      });
      assert.equal(state.width, 56); assert.equal(state.height, 56);
      assert.equal(state.centerX, state.viewportWidth / 2); assert.equal(state.centerY, state.viewportHeight / 2);
      assert.equal(state.background, colorScheme === 'dark' ? 'rgb(33, 33, 33)' : 'rgb(255, 255, 255)');
      assert.equal(state.draggable, 'drag'); assert.equal(state.fade, '0.18s'); assert.equal(state.delay, '0.06s');
      assert.equal(state.shimmer, 'startup-shimmer'); assert.equal(state.svg, true);
      // Page scripts are disabled, so polling must not depend on a page rAF callback.
      const opacity = () => loader.evaluate(element => getComputedStyle(element.querySelector('.startup-mark')).opacity);
      const deadline = Date.now() + 5_000;
      while (await opacity() !== '1' && Date.now() < deadline) await setTimeout(100);
      assert.equal(await opacity(), '1', 'The startup logo finishes fading in');
      await probe.screenshot({ path: join(screenshots, `104-startup-${colorScheme}.png`) });
    }
    const motion = () => loader.evaluate(element => {
      const mark = element.querySelector('.startup-mark');
      return { fade: getComputedStyle(mark).animationName, opacity: getComputedStyle(mark).opacity, shimmer: getComputedStyle(mark, '::after').animationName, overlay: getComputedStyle(mark, '::after').display };
    });
    const stopped = { fade: 'none', opacity: '1', shimmer: 'none', overlay: 'none' };
    await probe.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(await motion(), stopped);
    await probe.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal((await motion()).shimmer, 'startup-shimmer');
    await probe.evaluate(() => { document.documentElement.dataset.reducedMotion = 'true'; });
    assert.deepEqual(await motion(), stopped);
    assert.equal(await page.locator('.startup-loader').count(), 0, 'The real renderer replaces the static startup fallback');
  } finally {
    await application.evaluateMain(`require('electron').BrowserWindow.fromId(${id})?.destroy()`);
  }
}
