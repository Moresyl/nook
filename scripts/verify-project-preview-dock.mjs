import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyProjectPreviewDock({ page, application, projectId, mainWindow, previewWindow, screenshots, verified }) {
  const view = `${mainWindow}.contentView.children.find(v => v.webContents && !v.webContents.isDestroyed() && v.webContents.getURL().startsWith('nook-preview:'))`;
  const evaluate = code => application.evaluateMain(`(async()=>{const v=${view};return v ? v.webContents.executeJavaScript(${JSON.stringify(code)}) : null})()`);
  const wait = async code => { const end = Date.now() + 10_000; while (!await application.evaluateMain(code)) {
    if (Date.now() >= end) {
      console.error('Dock geometry failure', JSON.stringify(await page.evaluate(() => ({ hidden: document.hidden, viewport: document.querySelector('.project-preview-viewport')?.getBoundingClientRect().toJSON(), overlays: [...document.querySelectorAll('dialog[open],[role="dialog"],[role="menu"],[role="listbox"],[role="tooltip"],[popover]:popover-open,select:open')].map(element => ({ tag: element.tagName, role: element.getAttribute('role'), rect: element.getBoundingClientRect().toJSON() })) }))));
      console.error('Dock native failure', JSON.stringify(await application.evaluateMain(`(()=>{const v=${view};return v ? {visible:v.getVisible(),bounds:v.getBounds(),crashed:v.webContents.isCrashed()} : null})()`)));
      assert.fail('Docked preview did not reach the expected state');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } };
  const visible = `Boolean(${view}?.getVisible())`;
  const currentId = () => application.evaluateMain(`${view}?.webContents.id`);
  const captures = [], layouts = [];
  const ready = async () => {
    await page.mouse.move(1, 1);
    await wait(`(async()=>{const v=${view};return v?.getVisible() && v.webContents.executeJavaScript("document.body.dataset.ready === 'yes'")})()`);
  };
  async function capture(name) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Keep parent and child captures separate: a WebContents capture may not include native sibling views.
    const shots = await application.evaluateMain(`(async()=>{const w=${mainWindow}, v=${view};return [
      {name:'shell',png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()},
      {name:'content',png:(await v.webContents.capturePage()).toPNG().toString('base64'),size:[v.getBounds().width,v.getBounds().height]}
    ]})()`);
    for (const shot of shots) { const bytes = Buffer.from(shot.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], shot.size); const path = `project-dock-${name}-${shot.name}.png`; await writeFile(join(screenshots, path), bytes); captures.push(path); }
  }
  async function geometry(zoom) {
    await ready();
    const rect = await page.locator('.project-preview-viewport').evaluate(element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await wait(`(()=>{const v=${view};if(!v)return false; const r=v.getBounds();return r.x===${Math.ceil(rect.x * zoom)} && r.y===${Math.ceil(rect.y * zoom)} && r.width===${Math.floor((rect.x + rect.width) * zoom) - Math.ceil(rect.x * zoom)} && r.height===${Math.floor((rect.y + rect.height) * zoom) - Math.ceil(rect.y * zoom)}})()`);
    assert.ok(rect.width > 100 && rect.height > 30, `Usable preview area required: ${JSON.stringify(rect)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    layouts.push({ zoom, ...rect, native: await application.evaluateMain(`${view}.getBounds()`) });
  }

  await page.getByRole('button', { name: '并排预览', exact: true }).click(); await ready();
  assert.deepEqual(await evaluate("({text:document.querySelector('#result').textContent,script:window.relatedDraft,node:typeof require,bridge:typeof window.qiyao,remote:window.remoteBlocked,private:window.privateBlocked,origin:window.bridgeOriginBlocked})"), {
    text: 'UNSAVED_DATA_中文😀', script: 'SCRIPT_DRAFT_中文😀', node: 'undefined', bridge: 'undefined', remote: true, private: true, origin: true,
  });
  await geometry(1); await capture('light');
  verified('docked preview runs complete unsaved project resources in a separate offline sandbox aligned with its editor viewport');

  const beforeReload = await currentId(), beforeReloadToken = await application.evaluateMain(`new URL(${view}.webContents.getURL()).host`);
  const beforeReloadState = await page.evaluate(async id => {
    const state = await window.qiyao.load(), thread = state.threads.find(item => item.id === state.activeThreadId);
    return { drafts: state.editorDrafts.filter(item => item.projectId === id), activeThreadId: thread?.id ?? null, title: thread?.title ?? null,
      composerText: state.composerDrafts.find(item => item.threadId === thread?.id)?.text ?? '' };
  }, projectId);
  await page.reload();
  if (beforeReloadState.title !== null) await page.locator('.workspace-header').getByRole('button', { name: beforeReloadState.title, exact: true }).waitFor();
  else await page.getByRole('heading', { name: '今天想做些什么？', exact: true }).waitFor();
  console.log('Preview workbench reload children', await application.evaluateMain(`${mainWindow}.contentView.children.filter(v=>v.webContents && !v.webContents.isDestroyed()).map(v=>({id:v.webContents.id,url:v.webContents.getURL(),visible:v.getVisible()}))`));
  await wait(`!(${view})`);
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), beforeReloadState.composerText);
  assert.deepEqual(await page.evaluate(async id => {
    const state = await window.qiyao.load(); return { activeThreadId: state.activeThreadId ?? null, drafts: state.editorDrafts.filter(item => item.projectId === id) };
  }, projectId), { activeThreadId: beforeReloadState.activeThreadId, drafts: beforeReloadState.drafts });
  await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click();
  await page.locator('.project-list').getByRole('button', { name: '网页预览验证', exact: true }).click();
  await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'index.html', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.editor-actionbar .path-text')?.textContent === 'index.html' && document.querySelector('.editor-canvas .view-lines')?.textContent.includes('当前草稿'));
  await page.getByRole('button', { name: '并排预览', exact: true }).click(); await ready();
  assert.notEqual(await currentId(), beforeReload); assert.equal(await evaluate('window.previousStorage'), null);
  await page.evaluate(({ projectId, token }) => window.qiyao.closeProjectPreview(projectId, token), { projectId, token: beforeReloadToken });
  assert.equal(await application.evaluateMain(visible), true);
  assert.deepEqual(await evaluate("({text:document.querySelector('#result').textContent,script:window.relatedDraft})"), { text: 'UNSAVED_DATA_中文😀', script: 'SCRIPT_DRAFT_中文😀' });
  verified('actual workbench reload releases the old dock without losing editor drafts; reopening uses a fresh private session immune to stale close requests');

  const divider = page.getByRole('separator', { name: '调整编辑器与预览大小', exact: true });
  const priorShare = Number(await divider.getAttribute('aria-valuenow')); const vertical = await divider.getAttribute('aria-orientation') === 'horizontal';
  await divider.focus(); await divider.press(vertical ? 'ArrowDown' : 'ArrowRight'); assert.equal(Number(await divider.getAttribute('aria-valuenow')), priorShare + 5); await geometry(1);
  await divider.press('Home'); assert.equal(await divider.getAttribute('aria-valuenow'), '20'); await divider.press('End'); assert.equal(await divider.getAttribute('aria-valuenow'), '80');
  // Return to a balanced split through the same keyboard control.
  for (let index = 0; index < 6; index++) await divider.press(vertical ? 'ArrowUp' : 'ArrowLeft');
  const box = await divider.boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + (vertical ? 0 : 25), box.y + box.height / 2 + (vertical ? 25 : 0)); await page.mouse.up();
  assert.notEqual(await divider.getAttribute('aria-valuenow'), '50'); await geometry(1);
  const resizeSession = await currentId(), resizeDrafts = await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId);
  await evaluate("sessionStorage.setItem('resize-preserved', 'KEEP_中文😀')");
  const resizeChecks = [];
  const focusSession = await page.context().newCDPSession(page);
  const opened = page.context().waitForEvent('page');
  await application.evaluateMain(`(async () => { if (globalThis.nookResizeFocusProbe) throw new Error('Resize focus probe already exists'); const { BrowserWindow } = require('electron'); const probe = new BrowserWindow({ parent: ${mainWindow}, width: 160, height: 100, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); globalThis.nookResizeFocusProbe = probe; await probe.loadURL('about:blank'); })()`);
  const focusProbe = await opened; await focusProbe.waitForLoadState('load');
  // Match the existing tooltip lifecycle audit: observe actual focus instead of CDP emulation.
  await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  async function focusMain() {
    await application.evaluateMain(`globalThis.nookResizeFocusProbe.hide(); ${mainWindow}.show(); ${mainWindow}.focus(); ${mainWindow}.webContents.focus()`);
    await page.waitForFunction(() => document.hasFocus(), undefined, { timeout: 5000 });
    await wait(`${mainWindow}.isFocused() && ${mainWindow}.webContents.isFocused()`);
  }
  async function exerciseResize(axis, theme) {
    await focusMain();
    assert.equal(await divider.getAttribute('aria-orientation'), axis === 'vertical' ? 'vertical' : 'horizontal');
    await divider.dblclick(); assert.equal(await divider.getAttribute('aria-valuenow'), '50'); await ready();
    await divider.evaluate(element => element.blur()); await page.mouse.move(1, 1);
    assert.equal(await divider.evaluate(element => getComputedStyle(element, '::after').opacity), '0');
    await divider.hover(); assert.equal(await divider.evaluate(element => getComputedStyle(element, '::after').opacity), '1');
    await divider.focus(); await divider.press(axis === 'vertical' ? 'ArrowRight' : 'ArrowDown'); await divider.press(axis === 'vertical' ? 'ArrowLeft' : 'ArrowUp');
    const handleStyle = await divider.evaluate(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element), line = getComputedStyle(element, '::after');
      const editor = element.previousElementSibling.getBoundingClientRect(), preview = element.nextElementSibling.getBoundingClientRect();
      return { width: rect.width, height: rect.height, lineWidth: parseFloat(line.width), lineHeight: parseFloat(line.height), gradient: line.backgroundImage, focusVisible: element.matches(':focus-visible'), outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, editorWidth: editor.width, editorHeight: editor.height, previewWidth: preview.width, previewHeight: preview.height };
    });
    assert.equal(axis === 'vertical' ? handleStyle.width : handleStyle.height, 16); assert.equal(axis === 'vertical' ? handleStyle.lineWidth : handleStyle.lineHeight, 1);
    assert.equal(handleStyle.focusVisible, true); assert.equal(handleStyle.outlineWidth, '2px'); assert.equal(handleStyle.outlineOffset, '-2px'); assert.ok(handleStyle.gradient.includes('linear-gradient'));
    assert.ok(Math.abs(axis === 'vertical' ? handleStyle.editorWidth - handleStyle.previewWidth : handleStyle.editorHeight - handleStyle.previewHeight) <= 1, 'A reset split gives both panes equal usable space');
    const rect = await divider.boundingBox(); assert.ok(rect);
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const move = distance => page.mouse.move(x + (axis === 'vertical' ? distance : 0), y + (axis === 'horizontal' ? distance : 0));
    async function start() {
      await focusMain();
      await divider.evaluate(element => element.addEventListener('pointerdown', event => { element.dataset.testPointer = String(event.pointerId); }, { once: true }));
      await move(0); await page.mouse.down(); await wait(`!${visible}`);
      assert.equal(await divider.getAttribute('aria-valuenow'), '50', 'Starting a drag must not jump the divider');
    }
    await start(); await move(80); assert.notEqual(await divider.getAttribute('aria-valuenow'), '50');
    const moved = await divider.getAttribute('aria-valuenow');
    await divider.evaluate(element => {
      const pointerId = Number(element.dataset.testPointer) + 100;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', button: 0, buttons: 1, clientX: 1, clientY: 1 }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    });
    assert.equal(await divider.getAttribute('aria-valuenow'), moved, 'Other pointer and IME events must not steal or cancel the active drag'); assert.equal(await application.evaluateMain(visible), false);
    await page.keyboard.press('Escape'); assert.equal(await divider.getAttribute('aria-valuenow'), '50'); await ready();
    await move(120); assert.equal(await divider.getAttribute('aria-valuenow'), '50'); await page.mouse.up();
    for (const cancel of ['pointercancel', 'lostcapture']) {
      await start(); await move(60);
      await divider.evaluate((element, cancel) => { const pointerId = Number(element.dataset.testPointer); if (cancel === 'lostcapture') element.releasePointerCapture(pointerId); else element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'mouse' })); }, cancel);
      await page.waitForFunction(() => document.querySelector('.project-preview-divider')?.getAttribute('aria-valuenow') === '50'); await ready(); await page.mouse.up();
    }
    await start(); await move(50);
    console.log('Preview resize before native blur', JSON.stringify(await application.evaluateMain(`({windowFocused:${mainWindow}.isFocused(),rendererFocused:${mainWindow}.webContents.isFocused()})`)));
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await application.evaluateMain(`${mainWindow}.blur(); globalThis.nookResizeFocusProbe.show(); globalThis.nookResizeFocusProbe.focus()`);
    await page.waitForFunction(() => !document.hasFocus(), undefined, { timeout: 5000 });
    assert.deepEqual(await application.evaluateMain(`({mainFocused:${mainWindow}.isFocused(),probeFocused:globalThis.nookResizeFocusProbe.isFocused()})`), { mainFocused: false, probeFocused: true });
    await page.waitForFunction(() => document.querySelector('.project-preview-divider')?.getAttribute('aria-valuenow') === '50'); await page.mouse.up(); await focusMain(); await ready();
    await start(); await move(100); const committed = await divider.getAttribute('aria-valuenow'); assert.notEqual(committed, '50'); await page.mouse.up(); await ready(); assert.equal(await divider.getAttribute('aria-valuenow'), committed);
    await divider.dblclick(); assert.equal(await divider.getAttribute('aria-valuenow'), '50'); await ready(); await geometry(1);
    assert.equal(await currentId(), resizeSession); assert.equal(await evaluate("sessionStorage.getItem('resize-preserved')"), 'KEEP_中文😀');
    resizeChecks.push({ axis, theme, handleStyle, escapeRollback: true, lostCaptureRollback: true, syntheticPointerCancelRollback: true, syntheticOtherPointerAndImeIgnored: true, nativeBlurRollback: true, committedDragAndDoubleClickReset: true, nativeViewHiddenDuringDrag: true, samePreviewSession: true });
    await divider.focus(); await divider.press(axis === 'vertical' ? 'ArrowRight' : 'ArrowDown'); await divider.press(axis === 'vertical' ? 'ArrowLeft' : 'ArrowUp'); await capture(`resize-${theme}-${axis}`);
  }
  async function resizeTheme(theme) {
    await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await dismissModalWithEscape(page, settings); await ready();
  }
  try {
    for (const theme of ['light', 'dark']) {
      await resizeTheme(theme);
      await application.resize(1440, 900); await page.waitForFunction(() => document.querySelector('.editor-workspace')?.getAttribute('data-vertical') === 'false'); await exerciseResize('vertical', theme);
      await application.resize(760, 840); await page.waitForFunction(() => document.querySelector('.editor-workspace')?.getAttribute('data-vertical') === 'true'); await exerciseResize('horizontal', theme);
    }
    await resizeTheme('light');
  } finally {
    await application.evaluateMain('globalThis.nookResizeFocusProbe.destroy(); delete globalThis.nookResizeFocusProbe');
    await application.evaluateMain(`${mainWindow}.show(); ${mainWindow}.focus(); ${mainWindow}.webContents.focus()`);
    await focusSession.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await focusSession.detach();
  }
  assert.deepEqual(await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId), resizeDrafts);
  await application.resize(1280, 840); await ready(); await capture('resize-restored');
  const oldId = await currentId(), oldToken = await application.evaluateMain(`new URL(${view}.webContents.getURL()).host`);
  await page.getByRole('region', { name: '项目预览', exact: true }).getByRole('button', { name: '刷新', exact: true }).click();
  await wait(`Boolean(${view} && ${view}.webContents.id !== ${oldId})`); await ready(); assert.notEqual(await currentId(), oldId); assert.equal(await evaluate('window.previousStorage'), null);
  await page.evaluate(({ projectId, oldToken }) => window.qiyao.closeProjectPreview(projectId, oldToken), { projectId, oldToken }); assert.equal(await application.evaluateMain(visible), true);
  verified('pointer and keyboard split sizing preserve editing; refresh replaces the private session and stale close requests cannot destroy its replacement');

  const preservedId = await currentId(); await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor(); await wait(`!${visible}`);
  await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption('dark'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await dismissModalWithEscape(page, settings); await ready(); assert.equal(await currentId(), preservedId);
  await page.getByRole('button', { name: '隐藏文件树', exact: true }).click(); await application.resize(760, 540);
  for (const zoom of [1, 1.25, 1.5]) { await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction(value => Math.abs(innerWidth - 760 / value) < 2, zoom); await geometry(zoom); await capture(`dark-${zoom}`); }
  const compactId = await currentId(); await page.getByRole('button', { name: '编辑代码', exact: true }).click(); await wait(`!${visible}`);
  await page.locator('.editor-canvas .monaco-editor textarea.inputarea').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '查看预览', exact: true }).click(); await ready(); assert.equal(await currentId(), compactId);
  await application.evaluateMain(`${mainWindow}.focus(); ${view}.webContents.focus()`);
  await wait(`!${mainWindow}.webContents.isFocused()`);
  await application.evaluateMain(`${view}.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})`);
  await wait(`${mainWindow}.webContents.isFocused()`);
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); await ready();
  verified('native preview hides behind application settings without losing its session, follows dark minimum-window zoom and returns keyboard focus on Escape');

  await application.evaluateMain(`${view}.webContents.forcefullyCrashRenderer()`);
  await page.getByText('预览未能打开，草稿已保留。', { exact: true }).waitFor(); await wait(`!${visible}`);
  await page.getByRole('button', { name: '重试', exact: true }).click(); await ready(); assert.equal(await evaluate('window.previousStorage'), null);
  const draftsBefore = await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId);
  await page.getByRole('button', { name: '独立窗口', exact: true }).click();
  await wait(`(async()=>{const w=${previewWindow};return !${view} && w && w.webContents.executeJavaScript("document.body.dataset.ready === 'yes'")})()`);
  assert.deepEqual(await application.evaluateMain(`${previewWindow}.webContents.executeJavaScript("({text:document.querySelector('#result').textContent,script:window.relatedDraft,storage:window.previousStorage})")`), { text: 'UNSAVED_DATA_中文😀', script: 'SCRIPT_DRAFT_中文😀', storage: null });
  assert.deepEqual(await page.evaluate(async id => (await window.qiyao.load()).editorDrafts.filter(item => item.projectId === id), projectId), draftsBefore);
  await application.evaluateMain(`${previewWindow}.close()`); await wait(`!${previewWindow}`);
  await page.getByRole('button', { name: '并排预览', exact: true }).click(); await ready();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click(); await wait(`!${view}`);
  await page.waitForFunction(() => document.activeElement?.textContent === '并排预览');
  await page.getByRole('button', { name: '显示文件树', exact: true }).click();
  await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click(); await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption('light'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await dismissModalWithEscape(page, settings);
  verified('a real docked renderer crash shows a recoverable error, explicit retry creates a fresh session, and closing releases the view and returns focus');
  return { checks: 5, workbenchReloadVerified: true, staleOwnerCloseVerified: true, floatingTransferVerified: true, resizeChecks, resizeDraftsPreserved: true, layouts, screenshots: captures, captureBoundary: 'Separate actual parent-window and preview-content captures, not a composited full-native-window claim. Pointer cancel, extra pointer and IME cases are synthetic events; drag, Escape, double click, focus and native view visibility are actual native-window interactions.' };
}
