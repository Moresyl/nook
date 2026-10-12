import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyCommandPaletteLayouts({ page, application, palette, query, screenshots }) {
  const original = await page.evaluate(() => window.qiyao.load());
  const originalQuery = await query().inputValue();
  const layouts = [], captures = [];
  const paint = async () => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await palette().evaluate(async element => {
      const animations = element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.allSettled(animations.map(animation => animation.finished));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  async function setTheme(theme) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) === theme) return;
    await query().fill(`>切换到${theme === 'light' ? '浅' : '深'}色主题`);
    await query().press('Enter');
    await palette().waitFor({ state: 'hidden' });
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await page.keyboard.press('Control+Shift+p');
    await palette().waitFor();
  }
  async function capture(filename) {
    await paint();
    const state = await palette().evaluate(element => ({
      query: element.querySelector('[role="combobox"]').value,
      selectedLabel: element.querySelector('[aria-selected="true"]')?.getAttribute('aria-label') ?? null,
      optionCount: element.querySelectorAll('[role="option"]').length,
    }));
    const image = await application.evaluateMain(`(async()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())});return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64');
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.deepEqual([width, height], image.size);
    await writeFile(join(screenshots, filename), bytes);
    captures.push({ filename, width, height, nativeSize: image.size, ...state });
  }
  try {
    await paint();
    const wideWidth = await palette().evaluate(element => element.getBoundingClientRect().width);
    assert.ok(Math.abs(wideWidth - 520) < 1, `Global command search should use its scoped 520px width, received ${wideWidth}`);
    await application.resize(760, 540);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      for (const zoom of [1, 1.25, 1.5]) {
        await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())}).webContents.setZoomFactor(${zoom});`);
        await query().fill('>');
        await query().press('End');
        await paint();
        const row = await palette().evaluate(element => {
          const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
          const input = element.querySelector('[role="combobox"]');
          const list = element.querySelector('[role="listbox"]');
          const active = document.getElementById(input.getAttribute('aria-activedescendant'));
          return { ...rect(element), width: element.getBoundingClientRect().width, viewportWidth: innerWidth, viewportHeight: innerHeight,
            documentWidth: document.documentElement.scrollWidth, contentWidth: element.clientWidth, contentScrollWidth: element.scrollWidth,
            background: getComputedStyle(element).backgroundColor, radius: getComputedStyle(element).borderRadius,
            focused: document.activeElement === input, input: rect(input), footer: rect(element.querySelector('.modal-footer')),
            list: rect(list), selected: rect(active), selectedLabel: active.getAttribute('aria-label'),
            selectedOpacity: getComputedStyle(active).opacity, selectedBackground: getComputedStyle(active).backgroundColor,
          };
        });
        await capture(`command-palette-${theme}-${zoom * 100}-shell.png`);
        assert.equal(row.focused, true);
        assert.equal(row.selectedOpacity, '1');
        assert.notEqual(row.selectedBackground, 'rgba(0, 0, 0, 0)', 'The active command must retain its visible selection background.');
        assert.ok(Math.abs(row.width - Math.min(520, row.viewportWidth * .92)) < 1);
        assert.ok(Math.abs(row.left + row.right - row.viewportWidth) < 1, 'Global search must remain horizontally centered after native zoom.');
        assert.ok(Math.abs(row.top - Math.max(16, (row.viewportHeight - Math.min(504, row.viewportHeight * .9)) / 2)) < 1, 'Global search must use its bounded reference top position.');
        assert.ok(row.left >= 0 && row.right <= row.viewportWidth && row.top >= 0 && row.bottom <= row.viewportHeight);
        assert.ok(row.contentScrollWidth <= row.contentWidth && row.documentWidth <= row.viewportWidth);
        for (const control of [row.input, row.footer]) assert.ok(control.top >= row.top && control.bottom <= row.bottom && control.left >= row.left && control.right <= row.right);
        assert.ok(row.selected.top >= row.list.top && row.selected.bottom <= row.list.bottom && row.selected.bottom > row.selected.top, JSON.stringify({ theme, zoom, selected: row.selected, list: row.list }));
        assert.equal(row.background, theme === 'light' ? 'rgb(249, 249, 249)' : 'rgb(65, 65, 65)');
        assert.equal(row.radius, '16px');
        await query().fill('>NO_MATCH_COMMAND_LAYOUT');
        await palette().getByRole('status').getByText('没有匹配的聊天或命令。').waitFor();
        assert.equal(await palette().getByRole('option').count(), 0);
        const empty = await palette().evaluate(element => {
          const status = element.querySelector('[role="status"]').getBoundingClientRect();
          const dialog = element.getBoundingClientRect();
          return { top: status.top, bottom: status.bottom, dialogTop: dialog.top, dialogBottom: dialog.bottom, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.ok(empty.top >= empty.dialogTop && empty.bottom <= empty.dialogBottom && empty.dialogBottom <= empty.viewportHeight);
        assert.equal(empty.overflow, false);
        await capture(`command-palette-empty-${theme}-${zoom * 100}-shell.png`);
        layouts.push({ theme, zoom, ...row, empty });
      }
    }
    return { layouts, captures, screenshots: captures.map(row => row.filename), sixThemeZoomLayoutsVerified: true };
  } finally {
    await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())}).webContents.setZoomFactor(1);`);
    await application.resize(1280, 840);
    await setTheme(original.preferences.theme);
    await query().fill(originalQuery);
  }
}
