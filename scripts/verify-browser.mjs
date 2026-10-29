import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { verifyBrowserTabs } from './verify-browser-tabs.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/') && new URL(window.webContents.getURL()).searchParams.get('view') !== 'quick-chat')";

export async function verifyBrowser({ page, application, getApplication, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  const initialModelRequests = modelRequests();
  let failRequests = true;
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/failed' && failRequests) { response.destroy(); return; }
    if (request.url === '/slow') return;
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/two' }); response.end(); return; }
    const title = request.url === '/two' ? '第二页 · 中文🧭' : '网页样本 · 中文🧭';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>${title}</title><style>body{font:16px system-ui;margin:24px;color:#282828;background:#fff}a,button{margin:8px}p{max-width:40rem}</style></head><body><h1>${title}</h1><p>真实网页正文 &lt;literal&gt; 中文 🧭</p><a id="next" href="/two">下一页</a><a id="first" href="/one">第一页</a><button id="popup" onclick="window.open('/two')">打开新窗口</button><button id="private" onclick="location.href='qiyao://app/index.html'">私有地址</button><script>document.body.dataset.ready='yes';document.body.dataset.isolation=[typeof window.qiyao,typeof require,typeof process].join('/');</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // A public test-only self-signed key; never used by the application or a public server.
  const secure = createSecureServer({ key: await readFile(new URL('../verification/browser-error-key.pem', import.meta.url)), cert: await readFile(new URL('../verification/browser-error-certificate.pem', import.meta.url)) }, (_request, response) => response.end('Certificate fixture'));
  await new Promise(resolve => secure.listen(0, '127.0.0.1', resolve));
  const refused = createServer(); await new Promise(resolve => refused.listen(0, '127.0.0.1', resolve));
  const refusedUrl = `http://127.0.0.1:${refused.address().port}/private?token=browser-fixture-secret#private-fragment`;
  await new Promise(resolve => refused.close(resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith(${JSON.stringify(origin)}))`;
  const site = code => application.evaluateMain(`(()=>{const view=${view};return view ? view.webContents.executeJavaScript(${JSON.stringify(code)}) : null})()`);
  const clickSite = async selector => {
    const point = await site(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`);
    const event = { button: 'left', clickCount: 1, ...point };
    await application.evaluateMain(`(()=>{const contents=${view}.webContents;contents.focus();contents.sendInputEvent({...${JSON.stringify(event)},type:'mouseDown'});contents.sendInputEvent({...${JSON.stringify(event)},type:'mouseUp'});})()`);
  };
  const wait = async code => {
    const deadline = Date.now() + 10_000;
    while (!await application.evaluateMain(code)) {
      assert.ok(Date.now() < deadline, 'Browser contents did not reach the expected native state');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  const ready = async (title, path) => {
    const expectedUrl = origin + path;
    await page.getByRole('button', { name: '重新加载网页', exact: true }).waitFor();
    await wait(`(async()=>{const view=${view};return view?.getVisible() && view.webContents.getURL()===${JSON.stringify(expectedUrl)} && !view.webContents.isLoading() && (await view.webContents.executeJavaScript('document.body.dataset.ready')) === 'yes'})()`);
    try { await page.waitForFunction(url => document.querySelector('.browser-toolbar input')?.value === url, expectedUrl); }
    catch (error) { console.log('Browser address diagnostics', { expectedUrl, nativeUrl: await application.evaluateMain(`${view}.webContents.getURL()`), state: await page.evaluate(() => window.qiyao.openBrowser()), address: await page.getByLabel('网址', { exact: true }).inputValue() }); throw error; }
    assert.equal(await site('document.title'), title);
  };
  const navigate = async path => {
    await page.getByLabel('网址', { exact: true }).fill(origin + path);
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), origin + path);
    await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click();
  };
  const captures = [], layouts = [], failureLayouts = [];
  const failureRegion = () => page.getByRole('region', { name: '网页加载失败', exact: true });
  const expectFailure = async (reason, code) => {
    await page.getByRole('heading', { name: '无法访问此站点', exact: true }).waitFor({ timeout: 20_000 });
    await waitForBridge(page, async ({ reason, code }) => { const state = await window.qiyao.openBrowser(); return state.failureReason === reason && state.failureCode === code && !state.loading; }, { reason, code });
    await wait(`!${view}.getVisible()`);
    const text = await failureRegion().innerText();
    assert.ok(!text.includes('browser-fixture-secret') && !text.includes('private-fragment') && !text.includes('/private'));
    assert.equal(await page.getByRole('button', { name: '进入网页', exact: true }).isEnabled(), false);
  };
  async function capture(name, includeContent = true) {
    await page.mouse.move(1, 1);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const images = await application.evaluateMain(`(async()=>{const window=${mainWindow},view=${view};return [
      {kind:'shell',png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()},
      ...(${includeContent} && view ? [{kind:'content',png:(await view.webContents.capturePage()).toPNG().toString('base64'),size:[view.getBounds().width,view.getBounds().height]}] : [])]})()`);
    for (const image of images) {
      const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
      const filename = `browser-${name}-${image.kind}.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
    }
  }
  const draft = '浏览网页时保留的聊天草稿：中文🧭';
  try {
    await page.locator('.primary-nav').getByRole('button', { name: /^新聊天/ }).click();
    await page.getByLabel('消息', { exact: true }).fill(draft);
    await waitForBridge(page, async text => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === text), draft);
    await page.keyboard.press('Control+Shift+p');
    const commands = page.getByRole('dialog', { name: '搜索与命令', exact: true }); await commands.waitFor();
    await commands.getByRole('combobox', { name: '搜索聊天与命令', exact: true }).fill('>打开浏览器');
    await page.keyboard.press('Enter'); await commands.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.primary-nav').getByRole('button', { name: '浏览器', exact: true }).evaluate(element => element.classList.contains('selected')), true);
    await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor();
    await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).waitFor();
    await page.getByLabel('网址', { exact: true }).fill('file:///private');
    await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '请输入不含用户名和密码' }).waitFor();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '请输入不含用户名和密码' }).waitFor();
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), 'file:///private');
    assert.equal(requests.length, 0); await capture('invalid-address', false);
    verified('browser navigation is an implemented command and sidebar entry with a labeled address field and literal rejection/retry of non-web URLs without a network request');

    await navigate('/one'); await ready('网页样本 · 中文🧭', '/one');
    const contentsId = await application.evaluateMain(`${view}.webContents.id`);
    view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.id === ${contentsId})`;
    assert.equal(await site('document.body.dataset.isolation'), 'undefined/undefined/undefined');
    assert.equal(await site('document.querySelector("p").textContent'), '真实网页正文 <literal> 中文 🧭');
    const isolation = await application.evaluateMain(`(()=>{const view=${view},prefs=view.webContents.getLastWebPreferences();return {sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,preload:!!prefs.preload,privateSession:view.webContents.session!==require('electron').session.defaultSession}})()`);
    assert.deepEqual(isolation, { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: false, privateSession: true });
    assert.equal(await site("new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('unexpected'), error => resolve(error.code)))"), 1);
    await page.getByRole('status').filter({ hasText: '网站请求的权限未授予' }).waitFor();
    await site("localStorage.setItem('nook-browser-fixture', 'private_中文🧭'); document.cookie='nook_private=fixture;path=/'; true");
    verified('actual Chromium website scripts and Unicode content load in a separate private sandbox without Node or the application bridge');

    await clickSite('#next'); await ready('第二页 · 中文🧭', '/two');
    console.log('Browser native history', await application.evaluateMain(`${view}.webContents.navigationHistory.getAllEntries().map(({url,title})=>({url,title}))`));
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), origin + '/two');
    await page.getByRole('button', { name: '返回上一页', exact: true }).click(); await ready('网页样本 · 中文🧭', '/one');
    await page.getByRole('button', { name: '前进到下一页', exact: true }).click(); await ready('第二页 · 中文🧭', '/two');
    verified('real website links update the address and native history, and toolbar back/forward navigate the same private contents');

    await navigate('/redirect'); await ready('第二页 · 中文🧭', '/two');
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), origin + '/two');
    const windowsBefore = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().length");
    const unsubmittedAddress = 'https://draft.example/尚未打开';
    await page.getByLabel('网址', { exact: true }).fill(unsubmittedAddress);
    await clickSite('#popup');
    await page.getByRole('status').filter({ hasText: '请在地址栏打开链接' }).waitFor();
    assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().length"), windowsBefore);
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), unsubmittedAddress);
    await clickSite('#private');
    await page.getByRole('status').filter({ hasText: '仅支持 HTTP 和 HTTPS 网页' }).waitFor();
    assert.equal(await application.evaluateMain(`${view}.webContents.getURL()`), origin + '/two');
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), unsubmittedAddress);
    await page.getByLabel('网址', { exact: true }).fill(origin + '/two');
    verified('HTTP redirects remain in the website panel while popups and private application navigation are rejected without replacing the workbench');

    await page.getByRole('button', { name: '进入网页', exact: true }).click();
    await application.evaluateMain(`${view}.webContents.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:['control']})`);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.browser-toolbar input'));
    await page.locator('.primary-nav').getByRole('button', { name: /^新聊天/ }).click();
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    await wait(`!${view}.getVisible()`);
    await page.locator('.primary-nav').getByRole('button', { name: '浏览器', exact: true }).click(); await ready('第二页 · 中文🧭', '/two');
    assert.equal(await site("localStorage.getItem('nook-browser-fixture')"), 'private_中文🧭');
    const browserTabs = await verifyBrowserTabs({ page, application, mainWindow, originalOrigin: origin, originalContentsId: contentsId, screenshots, verified });
    view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.id === ${browserTabs.activeContentsId})`;
    const previousToken = (await page.evaluate(() => window.qiyao.openBrowser())).token;
    await page.reload(); await page.getByRole('heading', { name: '今天想做些什么？', exact: true }).waitFor();
    console.log('Browser workbench reload children', await application.evaluateMain(`${mainWindow}.contentView.children.filter(view=>view.webContents && !view.webContents.isDestroyed()).map(view=>({id:view.webContents.id,url:view.webContents.getURL(),visible:view.getVisible()}))`));
    await wait(`!(${view})`);
    await wait(`${mainWindow}.contentView.children.every(view=>!view.webContents || view.webContents.isDestroyed() || !${JSON.stringify(browserTabs.liveContentsIds)}.includes(view.webContents.id))`);
    browserTabs.workbenchReloadAllTabsVerified = true;
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    await page.locator('.primary-nav').getByRole('button', { name: '浏览器', exact: true }).click();
    await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor();
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), '');
    assert.notEqual((await page.evaluate(() => window.qiyao.openBrowser())).token, previousToken);
    await page.evaluate(token => window.qiyao.closeBrowser(token), previousToken);
    view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith(${JSON.stringify(origin)}))`;
    await navigate('/two'); await ready('第二页 · 中文🧭', '/two');
    const reloadedContentsId = await application.evaluateMain(`${view}.webContents.id`);
    view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.id === ${reloadedContentsId})`;
    assert.equal(await site("localStorage.getItem('nook-browser-fixture')"), null);
    assert.equal(await site("document.cookie.includes('nook_private=fixture')"), false);
    await site("localStorage.setItem('nook-browser-fixture', 'private_中文🧭'); document.cookie='nook_private=fixture;path=/'; true");
    verified('the site returns Ctrl L focus to the address field; switching pages retains the website/draft, while actual workbench reload releases the old view and stale close cannot destroy its fresh private replacement');

    await navigate('/slow'); await page.getByRole('button', { name: '停止加载网页', exact: true }).click();
    await page.getByRole('button', { name: '重新加载网页', exact: true }).waitFor();
    const stoppedUrl = await application.evaluateMain(`${view}.webContents.getURL()`);
    if (stoppedUrl.startsWith(origin)) assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), stoppedUrl);
    await navigate('/failed'); await expectFailure('generic', 'ERR_FAILED');
    assert.equal(await page.getByRole('button', { name: '进入网页', exact: true }).isEnabled(), false);
    await wait(`!${view}.getVisible()`); await capture('load-error', false);
    failRequests = false; await page.getByRole('button', { name: '重试', exact: true }).click(); await ready('网页样本 · 中文🧭', '/failed');
    verified('actual pending navigation can be stopped; a real connection failure hides the content, preserves the address and succeeds through the same retry action');

    await page.getByLabel('网址', { exact: true }).fill(refusedUrl); await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click();
    await expectFailure('refused', 'ERR_CONNECTION_REFUSED'); await capture('refused', false);
    await application.evaluateMain(`(async()=>{const contents=${view}.webContents;contents.debugger.attach('1.3');await contents.debugger.sendCommand('Network.enable');await contents.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1})})()`);
    try { await navigate('/one'); await expectFailure('offline', 'ERR_INTERNET_DISCONNECTED'); await capture('offline', false); }
    finally { await application.evaluateMain(`(async()=>{const contents=${view}.webContents;await contents.debugger.sendCommand('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});contents.debugger.detach()})()`); }
    await page.getByLabel('网址', { exact: true }).fill(`https://127.0.0.1:${secure.address().port}/private?token=browser-fixture-secret`);
    await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click(); await expectFailure('certificate', 'ERR_CERT_AUTHORITY_INVALID'); await capture('certificate', false);
    verified('real refused sockets, Chromium offline emulation and a local untrusted TLS certificate publish distinct safe reasons without leaking the failed path or query');

    await navigate('/slow'); const pendingDraft = 'https://draft.example/超时后保留🧭';
    await page.getByLabel('网址', { exact: true }).fill(pendingDraft); await expectFailure('timeout', 'ERR_TIMED_OUT');
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), pendingDraft); await capture('timeout', false);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await waitForBridge(page, async url => { const state = await window.qiyao.openBrowser(); return state.loading && state.url === url && !state.failureReason && !state.failureCode; }, origin + '/slow');
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), pendingDraft);
    await navigate('/failed'); await ready('网页样本 · 中文🧭', '/failed');
    verified('the actual fifteen-second deadline reports timeout, retains an address edited during loading, and retries the failed URL without submitting or replacing that draft');

    await page.keyboard.press('Control+,'); const dialog = page.getByRole('dialog', { name: '设置', exact: true }); await dialog.waitFor();
    await wait(`!${view}.getVisible()`); await dismissModalWithEscape(page, dialog); await ready('网页样本 · 中文🧭', '/failed');
    verified('the shared native viewport observer hides website contents under the real settings modal and restores them after semantic Escape dismissal');

    for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
      await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
      await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme); await dismissModalWithEscape(page, settings);
      const size = theme === 'light' ? [1280, 840] : [760, 540]; await application.resize(...size);
      await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(${zoom})`);
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width: Math.round(size[0] / zoom), height: Math.round(size[1] / zoom) });
      await ready('网页样本 · 中文🧭', '/failed');
      const rect = await page.locator('.browser-viewport').evaluate(element => element.getBoundingClientRect().toJSON());
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const expected = { x: Math.ceil(Math.max(0, rect.left) * zoom), y: Math.ceil(Math.max(0, rect.top) * zoom),
        right: Math.min(size[0], Math.floor(Math.min(viewport.width, rect.right) * zoom)), bottom: Math.min(size[1], Math.floor(Math.min(viewport.height, rect.bottom) * zoom)) };
      console.log('Browser layout comparison', { theme, zoom, rect, native: await application.evaluateMain(`${view}.getBounds()`), viewport, expected });
      await wait(`(()=>{const bounds=${view}.getBounds();return bounds.x===${expected.x} && bounds.y===${expected.y} && bounds.width===${expected.right - expected.x} && bounds.height===${expected.bottom - expected.y}})()`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(rect.width > 150 && rect.height > 100);
      const navigation = await page.locator('.primary-nav .selected').evaluate(element => {
        const row = element.getBoundingClientRect(), viewport = element.closest('.sidebar-main').getBoundingClientRect();
        return { current: element.getAttribute('aria-current'), selectedVisible: row.top >= viewport.top - 1 && row.bottom <= viewport.bottom + 1 && row.left >= viewport.left - 1 && row.right <= viewport.right + 1, row: row.toJSON(), viewport: viewport.toJSON() };
      });
      console.log('Browser selected navigation', { theme, zoom, ...navigation });
      assert.equal(navigation.selectedVisible, true, 'The selected browser navigation must remain visible after resize and zoom');
      assert.equal(navigation.current, 'page');
      layouts.push({ theme, zoom, requestedSize: size, viewport: rect, windowViewport: viewport, navigation, expected, native: await application.evaluateMain(`${view}.getBounds()`) });
      await capture(`${theme}-${zoom}`);
      console.log('Browser document before failure', await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight })));
      await page.getByLabel('网址', { exact: true }).fill(refusedUrl); await page.locator('.browser-toolbar').getByRole('button', { name: '打开', exact: true }).click();
      await expectFailure('refused', 'ERR_CONNECTION_REFUSED');
      const summaryVisible = await failureRegion().locator('[role="alert"]').evaluate(element => { const rect = element.getBoundingClientRect(), region = element.closest('.browser-load-error').getBoundingClientRect(); return rect.top >= region.top - 1 && rect.bottom <= region.bottom + 1; });
      assert.equal(summaryVisible, true); await capture(`error-${theme}-${zoom}`, false);
      const region = failureRegion(), details = region.locator('details'), summary = details.locator('summary');
      await summary.focus(); await page.keyboard.press('Space'); assert.equal(await details.getAttribute('open'), '');
      await region.focus(); await page.keyboard.press('End');
      await details.getByText('如果使用代理，请检查系统网络设置。公司或学校网络的访问限制可向网络管理员咨询。', { exact: true }).scrollIntoViewIfNeeded();
      const geometry = await region.evaluate(element => {
        const rect = element.getBoundingClientRect(), content = element.querySelector('.browser-load-error-content').getBoundingClientRect();
        return { region: rect.toJSON(), content: content.toJSON(), documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewportWidth: innerWidth, viewportHeight: innerHeight }, contained: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight, detailsOpen: element.querySelector('details').open, focusable: element.tabIndex === 0, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
      });
      console.log('Browser error content geometry', { theme, zoom, ...geometry });
      if (geometry.overflow) console.log('Browser document overflow elements', await page.evaluate(() => [...document.body.querySelectorAll('*')].filter(element => element.getBoundingClientRect().bottom > innerHeight && !element.closest('.browser-load-error, dialog:not([open])')).slice(0, 20).map(element => ({ tag: element.tagName, className: String(element.className), position: getComputedStyle(element).position, rect: element.getBoundingClientRect().toJSON() }))));
      assert.equal(geometry.contained, true); assert.equal(geometry.overflow, false); assert.equal(geometry.detailsOpen, true); assert.equal(geometry.focusable, true);
      await capture(`error-details-${theme}-${zoom}`, false);
      await region.focus(); await page.keyboard.press('Tab');
      const retryGeometry = await region.getByRole('button', { name: '重试', exact: true }).evaluate(button => { const rect = button.getBoundingClientRect(), region = button.closest('.browser-load-error').getBoundingClientRect(); return { focused: document.activeElement === button, visible: rect.top >= region.top - 1 && rect.bottom <= region.bottom + 1 && rect.left >= region.left - 1 && rect.right <= region.right + 1, button: rect.toJSON(), region: region.toJSON() }; });
      console.log('Browser error retry focus', { theme, zoom, ...retryGeometry });
      const retryVisible = retryGeometry.focused && retryGeometry.visible; assert.equal(retryVisible, true);
      failureLayouts.push({ theme, zoom, ...geometry, summaryVisible, retryVisible, nativeHidden: !await application.evaluateMain(`${view}.getVisible()`), hostOnly: true });
      await navigate('/failed'); await ready('网页样本 · 中文🧭', '/failed');
    }
    verified('both browser shell themes retain reference shared controls and correctly bounded native website views at wide/minimum windows and 100/125/150 percent page zoom');
    verified('load-error content and keyboard-operated details stay inside a separately scrollable region with a reachable retry control in six theme/zoom layouts');

    await application.evaluateMain(`(${mainWindow}).webContents.setZoomFactor(1)`);
    page = await restart(); application = getApplication();
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
    await page.locator('.primary-nav').getByRole('button', { name: '浏览器', exact: true }).click();
    await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor();
    assert.equal(await page.getByLabel('网址', { exact: true }).inputValue(), ''); await capture('restarted-empty', false);
    view = `${mainWindow}.contentView.children.find(view => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL().startsWith(${JSON.stringify(origin)}))`;
    await navigate('/one'); await ready('网页样本 · 中文🧭', '/one');
    assert.equal(await site("localStorage.getItem('nook-browser-fixture')"), null);
    assert.equal(await site("document.cookie.includes('nook_private=fixture')"), false);
    await page.keyboard.press('Control+t'); await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor();
    await page.locator('.browser-tab').first().getByRole('button', { name: /^关闭网页标签/ }).click();
    const blank = await page.evaluate(() => window.qiyao.openBrowser());
    const blankView = `${mainWindow}.contentView.children.find(view=>view.webContents&&!view.webContents.isDestroyed()&&!view.webContents.getURL())`;
    // Empty contents have no renderer until initialized; only this fixture loads about:blank.
    await application.evaluateMain(`(async()=>{const contents=${blankView}.webContents;await contents.loadURL('about:blank');contents.forcefullyCrashRenderer()})()`);
    await page.getByRole('heading', { name: '无法访问此站点', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '打开一个网页', exact: true }).count(), 0); await capture('blank-crash', false);
    await failureRegion().getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('heading', { name: '打开一个网页', exact: true }).waitFor();
    const replacement = await page.evaluate(() => window.qiyao.openBrowser()); assert.notEqual(replacement.token, blank.token); assert.equal(replacement.error, null);
    verified('normal restart retains the chat draft and resets private website storage/history; retry also replaces a crashed blank tab with a fresh owner');
    assert.equal(modelRequests(), initialModelRequests);
    return { page, result: { checks: 17, isolation, layouts, tabs: browserTabs, screenshots: captures, requests, modelRequests: modelRequests() - initialModelRequests,
      failures: { checks: 3, connectionRefusedVerified: true, offlineVerified: true, certificateVerified: true, timeoutVerified: true, pendingDraftRetained: true, retryDraftRetained: true, detailsKeyboardVerified: true, sanitizedHostVerified: true, blankRecoveryVerified: true, layouts: failureLayouts },
      nativeHistoryVerified: true, pendingAddressStopVerified: true, sameUrlRedirectVerified: true, unsubmittedAddressRetained: true, popupPrivateNavigationDenied: true, failureRetryVerified: true, keyboardFocusVerified: true, draftRetained: true, modalOcclusionVerified: true, privateRestartVerified: true, workbenchReloadVerified: true, staleOwnerCloseVerified: true,
      scope: 'Actual private WebContentsView with local HTTP/TLS fixtures, refused sockets, Chromium offline emulation, fifteen-second timeout, retained pending URL draft, retry, keyboard error details, blank renderer crash/replacement, history, redirect, popup/private-scheme rejection, Ctrl L focus, modal occlusion, six fixed-device-scale theme/zoom cases and normal restart. Only the blank-crash fixture initializes about:blank through main-process test control. DNS mapping is covered by unit tests; live DNS, public services, physical input, permission grants, downloads, saved tabs/history, other monitors/platforms and full design acceptance remain separate. Shell and native content captures are separate originals.' } };
  } finally { server.closeAllConnections(); secure.closeAllConnections(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => secure.close(resolve))]); }
}
