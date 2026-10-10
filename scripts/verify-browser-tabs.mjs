import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

export async function verifyBrowserTabs({ page, application, mainWindow, originalOrigin, originalContentsId, screenshots, verified }) {
  let fail = true; const held = [], captures = [], layouts = [];
  const server = createServer((request, response) => {
    if (request.url === '/held') { held.push(response); return; }
    if (request.url === '/failed' && fail) { response.destroy(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>标签 ${request.url} · 中文🧭</title></head><body><h1>标签 ${request.url} · 中文🧭</h1><script>document.body.dataset.ready='yes';document.body.dataset.isolation=[typeof window.qiyao,typeof require,typeof process].join('/')</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const original = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`), theme = await page.evaluate(() => document.documentElement.dataset.theme);
  const children = `${mainWindow}.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed())`;
  const ids = () => application.evaluateMain(`${children}.map(v=>v.webContents.id)`);
  const view = id => `${children}.find(v=>v.webContents.id===${id})`;
  const read = (id, code) => application.evaluateMain(`(async()=>{const v=${view(id)};return v?v.webContents.executeJavaScript(${JSON.stringify(code)}):null})()`);
  const wait = async code => { const deadline = Date.now() + 10_000; while (!await application.evaluateMain(code)) { assert.ok(Date.now() < deadline, 'Browser tabs did not reach the expected owned native state'); await new Promise(resolve => setTimeout(resolve, 100)); } };
  const tabs = () => page.locator('.browser-tabs [role="tab"]');
  const select = async index => { await tabs().nth(index).click(); await page.waitForFunction(index => document.querySelectorAll('.browser-tabs [role="tab"]')[index]?.getAttribute('aria-selected') === 'true', index); };
  const navigate = async (id, path, targetOrigin = origin) => {
    await page.getByLabel('网址', { exact: true }).fill(targetOrigin + path); await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click();
    await wait(`(async()=>{const v=${view(id)};return v?.getVisible()&&!v.webContents.isLoading()&&v.webContents.getURL()===${JSON.stringify(targetOrigin + path)}&&await v.webContents.executeJavaScript("document.body.dataset.ready==='yes'")})()`);
  };
  async function create() {
    const before = await ids(); await page.getByRole('button', { name: '新建浏览器标签页', exact: true }).click();
    await page.waitForFunction(count => document.querySelectorAll('.browser-tabs [role="tab"]').length === count + 1, before.length);
    const added = (await ids()).filter(id => !before.includes(id)); assert.equal(added.length, 1); return added[0];
  }
  async function capture(name, id) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const images = await application.evaluateMain(`(async()=>{const w=${mainWindow},v=${id ? view(id) : 'null'};return [{kind:'shell',png:(await w.capturePage()).toPNG().toString('base64'),size:w.getContentSize()},...(v?[{kind:'content',png:(await v.webContents.capturePage()).toPNG().toString('base64'),size:[v.getBounds().width,v.getBounds().height]}]:[])]})()`);
    for (const item of images) { const bytes = Buffer.from(item.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], item.size); const file = `browser-tabs-${name}-${item.kind}.png`; await writeFile(join(screenshots, file), bytes); captures.push(file); }
  }
  const key = async (id, keyCode, modifiers = ['control']) => { await application.evaluateMain(`(()=>{const c=${view(id)}.webContents;c.focus();c.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});c.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}})})()`); };
  try {
    await navigate(originalContentsId, '/first'); const firstToken = (await page.evaluate(() => window.qiyao.openBrowser())).token;
    await read(originalContentsId, "localStorage.setItem('tabs-shared','TEMP_中文🧭');document.cookie='tabs_shared=yes;path=/';true");
    const firstAddress = 'https://draft.example/第一份未提交🧭'; await page.getByLabel('网址', { exact: true }).fill(firstAddress);
    const second = await create(); await navigate(second, '/second'); const secondToken = (await page.evaluate(() => window.qiyao.openBrowser())).token;
    const shared = await read(second, "({storage:localStorage.getItem('tabs-shared'),cookie:document.cookie.includes('tabs_shared=yes'),isolation:document.body.dataset.isolation})");
    assert.deepEqual(shared, { storage: 'TEMP_中文🧭', cookie: true, isolation: 'undefined/undefined/undefined' });
    assert.equal(await application.evaluateMain(`${view(second)}.webContents.session===${view(originalContentsId)}.webContents.session`), true);
    const secondAddress = 'https://draft.example/第二份未提交😀'; await page.getByLabel('网址', { exact: true }).fill(secondAddress);
    const third = await create(); await navigate(third, '/third');
    await select(0); assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), firstAddress);
    await select(1); assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), secondAddress);
    await select(0); await wait(`${view(originalContentsId)}.getVisible()&&!${view(second)}.getVisible()&&!${view(third)}.getVisible()`);
    const histories = await application.evaluateMain(`[${originalContentsId},${second},${third}].map(id=>${children}.find(v=>v.webContents.id===id).webContents.navigationHistory.getAllEntries().map(e=>e.url))`);
    assert.ok(histories[0].some(url => url === origin + '/first')); assert.ok(!histories[1].includes(origin + '/first')); assert.ok(histories[1].includes(origin + '/second'));
    await capture('independent-drafts', originalContentsId);
    verified('three actual native browser tabs retain independent history/address drafts, share transient same-origin cookies/storage, and expose no Node/application bridge while only the selected tab is visible');

    await select(1); await page.getByLabel('网址', { exact: true }).fill(origin + '/failed'); await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click(); await select(0);
    await wait(`!${view(second)}.webContents.isLoading()`); await tabs().nth(1).getByLabel('加载失败', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), firstAddress); assert.equal(await page.locator('.browser-error').count(), 0);
    await select(1); await page.getByRole('alert').filter({ hasText: '网页无法加载' }).waitFor(); await capture('background-failure');
    fail = false; await page.getByRole('button', { name: '重试', exact: true }).click(); await wait(`${view(second)}.getVisible()&&!${view(second)}.webContents.isLoading()`); assert.equal(await read(second, 'document.title'), '标签 /failed · 中文🧭');
    await page.getByLabel('网址', { exact: true }).fill(origin + '/held'); await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click(); await page.getByRole('button', { name: '停止加载网页', exact: true }).waitFor();
    await select(0); await page.locator('.browser-tab').nth(1).getByRole('button', { name: /^关闭网页标签/ }).click(); await wait(`!(${view(second)})`);
    await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 2);
    for (const response of held) if (!response.destroyed) response.end('<title>LATE_CLOSED_PAGE</title>');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await tabs().count(), 2); assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), firstAddress); assert.equal(await read(originalContentsId, "localStorage.getItem('tabs-shared')"), 'TEMP_中文🧭');
    await page.evaluate(token => window.qiyao.closeBrowser(token), secondToken); assert.equal(await tabs().count(), 2);
    verified('a background connection failure stays with its tab and retries successfully; closing a held background navigation releases its actual view without losing the selected address draft or shared session');

    await tabs().nth(0).focus(); await tabs().nth(0).press('End'); assert.equal(await tabs().nth(1).evaluate(element => element === document.activeElement && element.getAttribute('aria-selected') === 'true'), true);
    await tabs().nth(1).press('ArrowRight'); assert.equal(await tabs().nth(0).evaluate(element => element === document.activeElement && element.getAttribute('aria-selected') === 'true'), true);
    await tabs().nth(0).press('ArrowLeft'); await tabs().nth(1).press('Home'); assert.equal(await tabs().nth(0).evaluate(element => element === document.activeElement && element.getAttribute('aria-selected') === 'true'), true);
    await key(originalContentsId, 'Tab'); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]')[1].getAttribute('aria-selected') === 'true');
    await key(third, 'Tab', ['control', 'shift']); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]')[0].getAttribute('aria-selected') === 'true');
    const before = await ids(); await key(originalContentsId, 'T'); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 3);
    const keyboardTab = (await ids()).find(id => !before.includes(id)); assert.ok(keyboardTab); await page.waitForFunction(() => document.activeElement === document.querySelector('.browser-toolbar input'));
    await navigate(keyboardTab, '/keyboard'); await key(keyboardTab, 'W'); await wait(`!(${view(keyboardTab)})`); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 2);
    await tabs().nth(0).focus(); await tabs().nth(0).press('Delete'); await wait(`!(${view(originalContentsId)})`); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 1);
    assert.equal(await tabs().nth(0).evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('.browser-tabs [role="tab"][tabindex="0"]').count(), 1);
    verified('tab arrow/Home/End/Delete controls and actual website Ctrl T/W/Tab/Shift Tab operate on the correct owner, create/close real native views and restore a valid tab/address focus');

    await key(third, 'W'); await wait(`!(${view(third)})`); await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor(); await page.waitForFunction(() => document.querySelectorAll('.browser-tabs [role="tab"]').length === 1);
    const fresh = (await ids())[0]; assert.ok(fresh); assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), '');
    const freshToken = (await page.evaluate(() => window.qiyao.openBrowser())).token; assert.notEqual(freshToken, firstToken);
    await navigate(fresh, '/first'); assert.deepEqual(await read(fresh, "({storage:localStorage.getItem('tabs-shared'),cookie:document.cookie.includes('tabs_shared=yes')})"), { storage: null, cookie: false });
    await page.evaluate(token => window.qiyao.closeBrowser(token), firstToken); assert.ok((await ids()).includes(fresh)); await capture('fresh-last-close');
    verified('closing the last native tab creates a fresh blank tab with cleared transient cookies/storage; stale tokens cannot close the replacement');

    const other = await create(); await navigate(other, '/second'); const selected = await create(); await navigate(selected, '/third');
    for (const [index, id] of [fresh, other, selected].entries()) await read(id, `document.title=${JSON.stringify(`标签 ${index + 1} · ${'保留完整的中文网页标题🧭'.repeat(8)}`)};true`);
    for (const targetTheme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
      await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor(); await wait(`${children}.every(v=>!v.getVisible())`);
      await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(targetTheme); await page.waitForFunction(value => document.documentElement.dataset.theme === value, targetTheme); await dismissModalWithEscape(page, settings);
      const size = targetTheme === 'light' ? [1280, 840] : [760, 540]; await application.resize(...size); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction(width => Math.abs(innerWidth - width) < 2, size[0] / zoom);
      await wait(`${view(selected)}.getVisible()&&${children}.filter(v=>v.getVisible()).length===1`);
      await page.waitForFunction(() => { const button = document.querySelector('.browser-tabs [aria-selected="true"]'), row = button.closest('.browser-tab').getBoundingClientRect(), viewport = button.closest('.browser-tabs').getBoundingClientRect(); return row.left >= viewport.left - 1 && row.right <= viewport.right + 1; });
      const geometry = await page.evaluate(() => {
        const tab = document.querySelector('.browser-tabs [aria-selected="true"]'), row = tab.closest('.browser-tab').getBoundingClientRect(), strip = tab.closest('.browser-tabs').getBoundingClientRect(), add = document.querySelector('.browser-tabbar > button').getBoundingClientRect(), viewport = document.querySelector('.browser-viewport').getBoundingClientRect();
        return { selectedVisible: row.left >= strip.left - 1 && row.right <= strip.right + 1, addVisible: add.left >= 0 && add.right <= innerWidth && add.top >= 0 && add.bottom <= innerHeight, addWidth: add.width, addHeight: add.height, overflow: document.documentElement.scrollWidth > innerWidth, tabCount: document.querySelectorAll('.browser-tabs [role="tab"]').length, panelLinked: tab.getAttribute('aria-controls') === document.querySelector('.browser-viewport').id && document.querySelector('.browser-viewport').getAttribute('aria-labelledby') === tab.id, viewport: viewport.toJSON(), windowViewport: { width: innerWidth, height: innerHeight } };
      });
      assert.equal(geometry.selectedVisible, true); assert.equal(geometry.addVisible, true); assert.equal(geometry.addWidth, 24); assert.equal(geometry.addHeight, 24); assert.equal(geometry.overflow, false); assert.equal(geometry.tabCount, 3); assert.equal(geometry.panelLinked, true);
      const x = Math.ceil(Math.max(0, geometry.viewport.x) * zoom), y = Math.ceil(Math.max(0, geometry.viewport.y) * zoom);
      const expected = { x, y, width: Math.min(size[0], Math.floor(Math.min(geometry.windowViewport.width, geometry.viewport.right) * zoom)) - x, height: Math.min(size[1], Math.floor(Math.min(geometry.windowViewport.height, geometry.viewport.bottom) * zoom)) - y };
      const native = await application.evaluateMain(`${view(selected)}.getBounds()`); assert.deepEqual(native, expected); layouts.push({ theme: targetTheme, zoom, requestedSize: size, ...geometry, expected, native }); await capture(`${targetTheme}-${zoom * 100}`, selected);
    }
    verified('three long-title tabs keep the selected label, 24px new-tab action and linked panel visible with one correctly bounded native page under modals and six light/dark zoom layouts');
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${original.zoom})`); await application.resize(...original.size);
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor(); await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme); await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme); await dismissModalWithEscape(page, settings);
    await select(1); await navigate(other, '/one', originalOrigin); await select(2); await navigate(selected, '/two', originalOrigin); await select(0); await navigate(fresh, '/two', originalOrigin);
    await read(fresh, "localStorage.setItem('nook-browser-fixture','private_中文🧭');document.cookie='nook_private=fixture;path=/';true");
    console.log('Browser multi-tab layouts', JSON.stringify(layouts));
    return { checks: 5, independentHistoryDraftsVerified: true, sharedTransientSessionVerified: true, selectedViewOnlyVerified: true, backgroundFailureCloseVerified: true, nativeShortcutsVerified: true, lastCloseFreshVerified: true, layouts, screenshots: captures, activeContentsId: fresh, liveContentsIds: [fresh, other, selected] };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
