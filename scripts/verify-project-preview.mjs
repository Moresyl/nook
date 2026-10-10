import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyProjectPreviewDock } from './verify-project-preview-dock.mjs';

const previewWindow = "require('electron').BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed() && w.webContents.getURL().startsWith('nook-preview:'))";
const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed() && w.webContents.getURL().startsWith('qiyao://app/') && new URL(w.webContents.getURL()).searchParams.get('view') !== 'quick-chat')";
export async function verifyProjectPreview({ page, application, directory, screenshots, waitForBridge, verified }) {
  const root = join(directory, '网页预览'); await mkdir(root);
  const projectId = 'preview-verification'; const requests = [];
  let editorFonts;
  const editorAppearance = [];
  const server = createServer((request, response) => { requests.push(request.url); response.end('REMOTE'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = `http://127.0.0.1:${server.address().port}/blocked`;
  const disk = '<h1>DISK_ORIGINAL</h1>';
  const draft = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>当前草稿 · 网页预览</h1><p id="result">Loading</p><button onclick="this.textContent=\'已交互\'">点击试试</button><script src="app.js"></script></body></html>';
  await Promise.all([
    writeFile(join(root, 'index.html'), disk), writeFile(join(root, 'styles.css'), 'body{font:16px system-ui;background:#f3f3f3;color:#181818;padding:40px}h1{font-size:28px}button{padding:8px 16px}'),
    writeFile(join(root, 'data.json'), JSON.stringify({ text: 'LOCAL_DATA_中文😀' })), writeFile(join(root, '.private.json'), 'PRIVATE'),
    writeFile(join(root, 'app.js'), `window.previousStorage=localStorage.getItem('preview');localStorage.setItem('preview','isolated');Promise.all([fetch('data.json').then(r=>r.json()).then(data=>{document.querySelector('#result').textContent=data.text}),fetch(${JSON.stringify(remote)}).then(()=>{window.remoteBlocked=false},()=>{window.remoteBlocked=true}),fetch('.private.json').then(r=>{window.privateBlocked=r.status===404}),fetch('qiyao://app/index.html').then(()=>{window.bridgeOriginBlocked=false},()=>{window.bridgeOriginBlocked=true})]).then(()=>{document.body.dataset.ready='yes'});`),
  ]);
  const read = expression => application.evaluateMain(`(async()=>{const w=${previewWindow};return w ? w.webContents.executeJavaScript(${JSON.stringify(expression)}) : null})()`);
  const wait = async expression => { const end = Date.now() + 10_000; while (!await application.evaluateMain(expression)) { assert.ok(Date.now() < end, 'Preview did not reach its expected state'); await new Promise(resolve => setTimeout(resolve, 100)); } };
  // Electron can resolve beforeunload before CDP sees its dialog notification.
  // Handle that late notification without Playwright's unhandled automatic dismissal.
  const observedPages = [];
  const handleDialog = dialog => { void dialog.dismiss().catch(() => {}); };
  const onPage = child => { observedPages.push(child); child.on('dialog', handleDialog); };
  page.context().on('page', onPage);
  const navigationAppearance = () => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme, bodyColor: getComputedStyle(document.body).color,
    buttons: [...document.querySelectorAll('.primary-nav button, .sidebar-footer .nav-row')].map(element => ({
      text: element.textContent, disabled: element.disabled, color: getComputedStyle(element).color, opacity: getComputedStyle(element).opacity,
      colorTransitions: element.getAnimations().filter(animation => animation.transitionProperty === 'color').map(animation => ({ state: animation.playState, currentTime: animation.currentTime })),
    })),
  }));
  async function captureEditor(name, theme) {
    const initial = await navigationAppearance();
    await page.waitForFunction(theme => {
      if (document.documentElement.dataset.theme !== theme || document.querySelector('dialog[open],[role="dialog"]')) return false;
      const buttons = [...document.querySelectorAll('.primary-nav button, .sidebar-footer .nav-row')], color = getComputedStyle(document.body).color;
      return buttons.length >= 8 && buttons.every(element => !element.disabled && getComputedStyle(element).opacity === '1' && getComputedStyle(element).color === color);
    }, theme, { timeout: 5_000 });
    const settled = await navigationAppearance();
    assert.equal(settled.theme, theme); assert.ok(settled.buttons.length >= 8);
    for (const button of settled.buttons) { assert.equal(button.disabled, false); assert.equal(button.opacity, '1'); assert.equal(button.color, settled.bodyColor); }
    editorAppearance.push({ name, theme, initial, settled });
    console.log('Preview editor capture appearance', JSON.stringify({ name, initial, settled }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const w=${mainWindow};const image=await w.capturePage();return {png:image.toPNG().toString('base64'),size:w.getContentSize()}})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    await writeFile(join(screenshots, name), bytes);
  }
  try {
    await page.evaluate(async ({ projectId, root }) => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); await window.qiyao.saveProject({ id: projectId, name: '网页预览验证', path: root, instructions: '', createdAt: 1 }); }, { projectId, root });
    await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: '网页预览验证', exact: true }).click();
    await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'index.html', exact: true }).click();
    const input = page.locator('.project-main-panel:not([hidden]) .monaco-editor textarea.inputarea'); await input.focus(); await input.press('ControlOrMeta+A');
    await input.evaluate((element, text) => { const data = new DataTransfer(); data.setData('text/plain', text); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, draft);
    await waitForBridge(page, async ({ projectId, draft }) => (await window.qiyao.load()).editorDrafts.some(item => item.projectId === projectId && item.text === draft), { projectId, draft });
    const originalAssets = Object.fromEntries(await Promise.all(['styles.css', 'app.js', 'data.json'].map(async path => [path, await readFile(join(root, path), 'utf8')])));
    const relatedDrafts = {
      'styles.css': `${originalAssets['styles.css']} body{background:#e3e8ef}`,
      'app.js': `${originalAssets['app.js']} window.relatedDraft='SCRIPT_DRAFT_中文😀';`,
      'data.json': JSON.stringify({ text: 'UNSAVED_DATA_中文😀' }),
    };
    for (const [path, text] of Object.entries(relatedDrafts)) {
      await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: path, exact: true }).click();
      await page.waitForFunction(({ path, prefix }) => document.querySelector('.editor-actionbar .path-text')?.textContent === path && document.querySelector('.editor-canvas .view-lines')?.textContent.replace(/\s/g, '').includes(prefix), { path, prefix: originalAssets[path].replace(/\s/g, '').slice(0, 40) });
      await input.focus(); await input.press('ControlOrMeta+A');
      await input.evaluate((element, text) => { const data = new DataTransfer(); data.setData('text/plain', text); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, text);
      await waitForBridge(page, async ({ projectId, path, text }) => (await window.qiyao.load()).editorDrafts.some(item => item.projectId === projectId && item.path === path && item.text === text), { projectId, path, text });
    }
    await page.getByRole('tab', { name: /^index\.html/ }).click();
    await page.waitForFunction(() => document.querySelector('.editor-actionbar .path-text')?.textContent === 'index.html' && document.querySelector('.editor-canvas .view-lines')?.textContent.includes('当前草稿'));
    await page.getByRole('button', { name: '预览 HTML', exact: true }).click();
    await wait(`(async()=>{const w=${previewWindow};return w && w.webContents.executeJavaScript("document.body.dataset.ready === 'yes'")})()`);
    assert.deepEqual(await read("({text:document.querySelector('#result').textContent,background:getComputedStyle(document.body).backgroundColor,storage:window.previousStorage,script:window.relatedDraft})"), { text: 'UNSAVED_DATA_中文😀', background: 'rgb(227, 232, 239)', storage: null, script: 'SCRIPT_DRAFT_中文😀' });
    await read("document.querySelector('button').click()"); assert.equal(await read("document.querySelector('button').textContent"), '已交互');
    assert.equal(await readFile(join(root, 'index.html'), 'utf8'), disk);
    for (const [path, text] of Object.entries(originalAssets)) assert.equal(await readFile(join(root, path), 'utf8'), text);
    verified('HTML preview executes the current HTML, CSS, script and JSON draft snapshot without changing any project file');

    assert.deepEqual(await read("({node:typeof require,bridge:typeof window.qiyao,remote:window.remoteBlocked,private:window.privateBlocked,origin:window.bridgeOriginBlocked})"), { node: 'undefined', bridge: 'undefined', remote: true, private: true, origin: true });
    assert.equal(await read(`window.open(${JSON.stringify(remote)}) === null`), true);
    const beforeUrl = await application.evaluateMain(`${previewWindow}.webContents.getURL()`);
    await read(`location.href=${JSON.stringify(remote)};true`); assert.equal(await application.evaluateMain(`${previewWindow}.webContents.getURL()`), beforeUrl); assert.deepEqual(requests, []);
    const capture = await application.evaluateMain(`(async()=>{const image=await ${previewWindow}.capturePage();return image.toPNG().toString('base64')})()`);
    await writeFile(join(screenshots, 'project-html-preview.png'), Buffer.from(capture, 'base64'));
    verified('preview has no application bridge or Node access and blocks outside HTTP, hidden assets, app resources, popups and navigation');

    const previousWindowId = await application.evaluateMain(`${previewWindow}.id`);
    await page.getByRole('button', { name: '预览 HTML', exact: true }).click();
    await wait(`(async()=>{const w=${previewWindow};return w && w.id !== ${previousWindowId} && w.webContents.executeJavaScript("document.body.dataset.ready === 'yes'")})()`);
    assert.equal(await read('window.previousStorage'), null);
    assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed() && w.webContents && !w.webContents.isDestroyed() && w.webContents.getURL().startsWith('nook-preview:')).length"), 1);
    await read("window.onbeforeunload=event=>{event.preventDefault();event.returnValue='keep'};true");
    await application.evaluateMain(`${previewWindow}.close()`); await wait(`!${previewWindow}`);
    const docked = await verifyProjectPreviewDock({ page, application, projectId, mainWindow, previewWindow, screenshots, verified });
    const fontSession = await page.context().newCDPSession(page);
    try {
      await fontSession.send('DOM.enable'); await fontSession.send('CSS.enable');
      const { root: documentRoot } = await fontSession.send('DOM.getDocument');
      const { nodeId } = await fontSession.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '.editor-actionbar > .button' });
      editorFonts = { computed: await page.locator('.editor-actionbar > .button').first().evaluate(element => getComputedStyle(element).fontFamily), ...(await fontSession.send('CSS.getPlatformFontsForNode', { nodeId })) };
      console.log('Preview entry rendered fonts', JSON.stringify(editorFonts));
    } finally { await fontSession.detach(); }
    await captureEditor('project-preview-editor-light.png', 'light');
    await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.getByRole('button', { name: '外观与交互', exact: true }).click();
    await settings.getByLabel('主题', { exact: true }).selectOption('dark'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await dismissModalWithEscape(page, settings);
    await page.getByRole('button', { name: '隐藏文件树', exact: true }).click(); await application.resize(760, 540);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1.5)`); await page.waitForFunction(() => Math.abs(innerWidth - 760 / 1.5) < 2);
    const bounds = await page.getByRole('button', { name: '预览 HTML', exact: true }).evaluate(element => { const rect = element.getBoundingClientRect(); return { visible: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }; });
    assert.deepEqual(bounds, { visible: true, overflow: false });
    await page.getByRole('button', { name: '预览 HTML', exact: true }).focus(); await captureEditor('project-preview-editor-dark-narrow.png', 'dark');
    await page.getByRole('button', { name: '预览 HTML', exact: true }).press('Enter');
    await wait(`(async()=>{const w=${previewWindow};return w && w.webContents.executeJavaScript("document.body.dataset.ready === 'yes'")})()`);
    await application.evaluateMain(`${previewWindow}.close()`); await wait(`!${previewWindow}`);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
    verified('preview entry remains visible and keyboard-operable in light and dark minimum-window 150 percent layout');
    await input.focus(); await input.press('ControlOrMeta+A'); await input.press('Backspace');
    await page.getByRole('button', { name: '预览 HTML', exact: true }).click();
    await wait(`Boolean(${previewWindow})`); assert.equal(await read('document.body.textContent'), '');
    assert.equal(await readFile(join(root, 'index.html'), 'utf8'), disk);
    verified('reopening gets fresh session storage, unload handlers cannot trap the window, and an empty draft stays empty');

    for (const path of ['index.html', ...Object.keys(relatedDrafts)]) {
      await page.getByRole('button', { name: `关闭 ${path}`, exact: true }).click(); await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
      await page.getByRole('dialog', { name: '保留文件改动？', exact: true }).waitFor({ state: 'hidden' });
    }
    const removalToken = await page.evaluate(id => window.qiyao.previewProjectDocked(id, { path: 'index.html', text: '' }), projectId);
    assert.ok(removalToken);
    const removalView = `${mainWindow}.contentView.children.find(v => v.webContents && !v.webContents.isDestroyed() && v.webContents.getURL().startsWith('nook-preview:'))`;
    assert.equal(await application.evaluateMain(`new URL(${removalView}.webContents.getURL()).host`), removalToken);
    await page.evaluate(id => window.qiyao.removeProject(id), projectId); await wait(`!${previewWindow} && !${removalView}`);
    docked.projectRemovalVerified = true;
    assert.deepEqual(requests, []);
    verified('removing the owning project closes its preview and leaves the original project files unchanged');
    return { checks: 10, docked, screenshots: ['project-html-preview.png', 'project-preview-editor-light.png', 'project-preview-editor-dark-narrow.png', ...docked.screenshots], editorFonts, editorAppearance, outsideHttpRequests: requests.length, boundary: 'Local floating and docked project HTML preview; DOM paste fixture and scripted page interaction. Not physical clipboard evidence, a React bundler, generated-artifact editor, remote browser or complete sandbox audit.' };
  } finally { page.context().off('page', onPage); for (const child of observedPages) child.off('dialog', handleDialog); await new Promise(resolve => server.close(resolve)); }
}
