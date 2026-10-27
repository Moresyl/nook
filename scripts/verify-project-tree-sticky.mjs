import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectTreeItem, scrollProjectTreeItem } from './project-tree-viewport.mjs';
import { verifyProjectFileMenu } from './verify-project-file-menu.mjs';

export async function verifyProjectTreeSticky({ page, application, directory, capture, returnProjectName }) {
  const id = randomUUID(), name = `目录滚动验证 ${id.slice(0, 8)}`, root = join(directory, `sticky-tree-${id}`);
  const nested = 'a-parent/b-nested';
  await mkdir(join(root, nested), { recursive: true });
  await mkdir(join(root, 'm-large'));
  for (let start = 0; start < 1000; start += 32) await Promise.all(Array.from({ length: Math.min(32, 1000 - start) }, (_, offset) => writeFile(join(root, 'm-large', `entry-${String(start + offset).padStart(4, '0')}.txt`), 'LARGE_TREE')));
  await writeFile(join(root, 'a-parent/parent-after.txt'), 'PARENT_END');
  for (let start = 0; start < 220; start += 32) await Promise.all(Array.from({ length: Math.min(32, 220 - start) }, (_, offset) => writeFile(join(root, nested, `file-${String(start + offset).padStart(4, '0')}.txt`), 'STICKY_FILE')));
  for (let start = 0; start < 80; start += 32) await Promise.all(Array.from({ length: Math.min(32, 80 - start) }, (_, offset) => writeFile(join(root, `z-${String(start + offset).padStart(3, '0')}.txt`), 'AFTER_SUBTREE')));
  const preferences = await page.evaluate(async ({ id, name, root }) => { const state = await window.qiyao.load(); await window.qiyao.saveProject({ id, name, path: root, instructions: '', createdAt: Date.now() }); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); return state.preferences; }, { id, name, root });
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";
  const tree = () => page.getByRole('tree', { name: '项目文件', exact: true });
  const item = path => projectTreeItem(() => page, tree, path);
  const row = path => item(path).locator(':scope > .project-tree-row');
  const indentation = [];
  const guideStates = [];
  async function assertGuides(theme, zoom) {
    const path = `${nested}/file-0000.txt`;
    await item('a-parent').focus(); await page.mouse.move(1, 1);
    await item(path).waitFor();
    const guides = row(path).locator('.project-tree-guide');
    assert.equal(await guides.count(), 2);
    const waitOpacity = async expected => {
      await page.waitForFunction(({ path, expected }) => {
        const node = [...document.querySelectorAll('.project-tree [role="treeitem"]')].find(element => element.getAttribute('aria-label') === path);
        const guides = [...node.querySelectorAll(':scope > .project-tree-row > .project-tree-guide')];
        return guides.length === expected.length && guides.every((guide, index) => Number(getComputedStyle(guide).opacity) === expected[index]);
      }, { path, expected });
    };
    await waitOpacity([0, 0]);
    await tree().hover(); await waitOpacity([0.75, 0.75]);
    await item(path).focus(); await page.mouse.move(1, 1); await waitOpacity([0, 1]);
    const sibling = row(`${nested}/file-0001.txt`).locator('.project-tree-guide[data-active]');
    assert.equal(await sibling.count(), 1, 'The focused parent guide continues through sibling rows');
    const geometry = await guides.evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect(), row = element.parentElement.getBoundingClientRect();
      return { left: bounds.left - row.left, width: bounds.width, height: bounds.height, pointerEvents: style.pointerEvents, duration: style.transitionDuration, color: style.backgroundColor, hidden: element.getAttribute('aria-hidden'), tabIndex: element.tabIndex };
    }));
    const color = await page.evaluate(() => { const probe = document.createElement('span'); probe.style.backgroundColor = 'color-mix(in lab, #84848a 25%, transparent)'; document.body.append(probe); try { return getComputedStyle(probe).backgroundColor; } finally { probe.remove(); } });
    for (let index = 0; index < geometry.length; index++) {
      const guide = geometry[index]; assert.ok(Math.abs(guide.left - [10.25, 19][index]) < 0.1); assert.equal(guide.width, 1); assert.equal(guide.height, 28);
      assert.equal(guide.pointerEvents, 'none'); assert.equal(guide.hidden, 'true'); assert.equal(guide.tabIndex, -1); assert.equal(guide.duration, '0.15s'); assert.equal(guide.color, color);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try { assert.equal(await guides.first().evaluate(element => getComputedStyle(element).transitionDuration), '0s'); await item(nested).focus(); await waitOpacity([1, 0]); }
    finally { await page.emulateMedia({ reducedMotion: null }); }
    await item('a-parent').focus(); await waitOpacity([0, 0]);
    const previousMaxHeight = await tree().evaluate(element => { const previous = element.style.maxHeight; element.style.maxHeight = '48px'; return previous; });
    try {
      await page.waitForFunction(() => document.querySelector('.project-tree').style.getPropertyValue('--tree-sticky-enabled') === '0');
      const shortRows = await tree().locator('.project-tree-row[data-sticky]').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element), row = element.getBoundingClientRect(), guide = element.querySelector('.project-tree-guide');
        return { position: style.position, top: style.top, guideTop: guide ? guide.getBoundingClientRect().top - row.top : 0 };
      }));
      assert.ok(shortRows.length >= 2); assert.ok(shortRows.every(row => row.position === 'relative' && row.top === '0px' && Math.abs(row.guideTop) < 0.1), JSON.stringify(shortRows));
    } finally { await tree().evaluate((element, previous) => { element.style.maxHeight = previous; }, previousMaxHeight); }
    await page.waitForFunction(() => document.querySelector('.project-tree').style.getPropertyValue('--tree-sticky-enabled') === '1');
    guideStates.push({ theme, zoom, geometry, hoverOpacity: 0.75, focusedParentOpacity: 1, reducedMotion: true, siblingContinuation: true, rootClearsActiveGuide: true, constrainedShortViewport: true });
  }
  async function assertIndentation(path, expectedPadding) {
    await scrollProjectTreeItem(page, tree(), path);
    const measured = await row(path).evaluate(element => {
      const bounds = element.getBoundingClientRect(), icon = element.querySelector(':scope > svg'), label = element.querySelector('.project-tree-label');
      return { padding: Number.parseFloat(getComputedStyle(element).paddingLeft), icons: element.querySelectorAll('svg').length, iconWidth: icon.getBoundingClientRect().width, iconLeft: icon.getBoundingClientRect().left - bounds.left, labelLeft: label.getBoundingClientRect().left - bounds.left };
    });
    assert.equal(measured.padding, expectedPadding); assert.equal(measured.icons, 1); assert.equal(measured.iconWidth, 16);
    assert.ok(Math.abs(measured.iconLeft - expectedPadding) < 0.1, JSON.stringify(measured));
    assert.ok(Math.abs(measured.labelLeft - expectedPadding - 21) < 0.1, JSON.stringify(measured));
    indentation.push({ path, ...measured });
  }
  async function select() { await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name, exact: true }).click(); if (await page.getByRole('button', { name: '显示文件树', exact: true }).count()) await page.getByRole('button', { name: '显示文件树', exact: true }).click(); }
  async function open() { if (await item('a-parent').getAttribute('aria-expanded') === 'false') await row('a-parent').click(); if (await item(nested).getAttribute('aria-expanded') === 'false') await row(nested).click(); await scrollProjectTreeItem(page, tree(), `${nested}/file-0100.txt`); }
  async function visible(path) { return item(path).evaluate(element => { const row = element.querySelector(':scope > .project-tree-row').getBoundingClientRect(), viewport = element.closest('.project-tree').getBoundingClientRect(); return document.activeElement === element && row.top >= viewport.top && row.bottom <= viewport.bottom; }); }
  async function scrollInside() { await row(`${nested}/file-0100.txt`).scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
  async function geometry() { return tree().evaluate(element => { const bounds = element.getBoundingClientRect(), paths = ['a-parent', 'a-parent/b-nested']; return { height: element.clientHeight, scroll: element.scrollTop, rows: paths.map(path => { const node = [...element.querySelectorAll('[role="treeitem"]')].find(item => item.getAttribute('aria-label') === path), row = node.querySelector(':scope > .project-tree-row'), rect = row.getBoundingClientRect(); return { top: rect.top - bounds.top, bottom: rect.bottom - bounds.top, canonicalTop: node.getBoundingClientRect().top - bounds.top, position: getComputedStyle(row).position, layers: getComputedStyle(row).backgroundImage }; }) }; }); }
  try {
    await application.resize(1280, 840); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await page.reload(); await select(); await open(); await scrollInside();
    await assertIndentation('a-parent', 3); await assertIndentation(nested, 11.75); await assertIndentation(`${nested}/file-0100.txt`, 24.25); await assertIndentation('a-parent/parent-after.txt', 15.5); await assertIndentation('z-000.txt', 3);
    await assertGuides('light', 1); await item(`${nested}/file-0100.txt`).focus(); await scrollInside();
    const light = await geometry(); console.log('Sticky tree geometry', JSON.stringify(light)); await capture('116-project-tree-sticky-light.png'); assert.ok(light.scroll > 500); assert.equal(light.rows[0].position, 'sticky'); assert.ok(Math.abs(light.rows[0].top) < 1, JSON.stringify(light)); assert.ok(Math.abs(light.rows[1].top - 28) < 1, JSON.stringify(light)); assert.ok(light.rows.every(row => row.canonicalTop < 0 && row.layers.includes('linear-gradient')));
    assert.equal(await item('a-parent').count(), 1); assert.equal(await item(nested).count(), 1, 'Sticky presentation does not duplicate accessible nodes');
    await item(`${nested}/file-0100.txt`).focus(); await page.keyboard.press('Home'); assert.equal(await visible('a-parent'), true);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); assert.equal(await visible(`${nested}/file-0000.txt`), true);
    const focus = await item(`${nested}/file-0000.txt`).evaluate(element => ({ top: element.querySelector('.project-tree-row').getBoundingClientRect().top, ancestorBottom: element.parentElement.parentElement.querySelector(':scope > .project-tree-row').getBoundingClientRect().bottom })); assert.ok(focus.top >= focus.ancestorBottom, 'Focused file is not covered by its ancestor');
    assert.equal(await page.locator('.editor-actionbar').count(), 0, 'Directory navigation never opens a file');
    await tree().getByRole('button', { name: `加载更多 ${nested}`, exact: true }).click(); await scrollProjectTreeItem(page, tree(), `${nested}/file-0219.txt`);
    await scrollInside();
    const delta = await item('a-parent').evaluate(element => element.getBoundingClientRect().bottom - element.closest('.project-tree').getBoundingClientRect().top - 18);
    await tree().hover(); await page.mouse.wheel(0, delta);
    await page.waitForFunction(() => { const tree = document.querySelector('.project-tree'), node = [...tree.querySelectorAll('[role="treeitem"]')].find(item => item.getAttribute('aria-label') === 'a-parent'), bottom = node.getBoundingClientRect().bottom - tree.getBoundingClientRect().top; return bottom > 15 && bottom < 21; });
    const pushed = await geometry(); assert.ok(pushed.rows[0].top < 0 && pushed.rows[0].bottom > 0 && pushed.rows[0].bottom < 21, 'An ending subtree pushes its ancestor out of the viewport');
    await scrollInside(); await row('a-parent').click(); await item(nested).waitFor({ state: 'hidden' }); assert.equal(await visible('a-parent'), true, 'Clicking the sticky ancestor collapses it and keeps its canonical focus visible');
    await open(); await scrollInside(); await item(nested).focus(); await page.keyboard.press('ArrowLeft'); await item(`${nested}/file-0100.txt`).waitFor({ state: 'hidden' }); assert.equal(await visible(nested), true);
    await page.keyboard.press('ArrowRight'); await scrollProjectTreeItem(page, tree(), `${nested}/file-0100.txt`);
    await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); });
    await page.reload(); await select(); await open(); await application.resize(760, 540);
    for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
      await page.waitForFunction(zoom => Math.abs(innerWidth - 760 / zoom) <= 1, zoom);
      await item(`${nested}/file-0100.txt`).focus(); await page.keyboard.press('ArrowDown'); assert.equal(await visible(`${nested}/file-0101.txt`), true, `Focus remains visible at zoom ${zoom}`);
      const measured = await geometry(); assert.ok(measured.height > 28); assert.equal(await item('a-parent').count(), 1);
      await assertIndentation(nested, 11.75); await assertIndentation(`${nested}/file-0101.txt`, 24.25);
      await assertGuides('dark', zoom); await item(`${nested}/file-0101.txt`).focus();
      assert.equal(await page.locator('.editor-body > .empty').evaluate(element => { const viewport = element.parentElement.getBoundingClientRect(); return [...element.querySelectorAll('h3,p')].every(item => { const rect = item.getBoundingClientRect(); return rect.top >= viewport.top && rect.bottom <= Math.min(viewport.bottom, innerHeight) && rect.left >= viewport.left && rect.right <= viewport.right; }); }), true, `Empty-editor title and instructions fit at zoom ${zoom}`);
    }
    await page.keyboard.press('Escape'); await page.mouse.move(1, 1); await page.getByRole('tooltip').waitFor({ state: 'hidden' });
    await capture('117-project-tree-sticky-dark.png');
    await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await item(`${nested}/file-0101.txt`).waitFor();
    const search = page.getByPlaceholder('查找文件路径…'); await search.fill('file-0101'); await page.getByRole('listbox', { name: '项目文件查找结果', exact: true }).waitFor(); assert.equal(await tree().isVisible(), false);
    await search.press('Escape'); await tree().waitFor(); await item(`${nested}/file-0100.txt`).focus(); await page.keyboard.press('ArrowDown'); assert.equal(await visible(`${nested}/file-0101.txt`), true);
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
    const deepParts = Array.from({ length: 10 }, (_, index) => index ? `level-${index}` : 'c-deep');
    await mkdir(join(root, ...deepParts), { recursive: true }); await writeFile(join(root, ...deepParts, 'leaf.txt'), 'DEEP_TREE');
    await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await scrollProjectTreeItem(page, tree(), 'c-deep');
    for (let index = 0; index < deepParts.length; index++) {
      const path = deepParts.slice(0, index + 1).join('/'); await item(path).focus(); await page.keyboard.press('ArrowRight');
      await item(index === deepParts.length - 1 ? `${path}/leaf.txt` : `${path}/${deepParts[index + 1]}`).waitFor();
      await assertIndentation(path, 3 + index * 8.75);
    }
    const leaf = `${deepParts.join('/')}/leaf.txt`; await assertIndentation(leaf, 94.25);
    await item(leaf).focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await visible(deepParts.join('/')), true);
    await page.keyboard.press('Escape'); await page.mouse.move(1, 1); await page.getByRole('tooltip').waitFor({ state: 'hidden' }); await capture('118-project-tree-deep-dark.png');
    await item('m-large').focus(); await page.keyboard.press('ArrowRight');
    const more = tree().getByRole('button', { name: '加载更多 m-large', exact: true });
    for (const count of [200, 400, 600, 800]) { await more.getByText(`加载更多 · ${count} / 1000`, { exact: true }).waitFor(); await more.click(); }
    await more.waitFor({ state: 'hidden' });
    await item('m-large').focus(); await page.keyboard.type('entry-0999');
    const last = tree().getByRole('treeitem', { name: 'm-large/entry-0999.txt', exact: true });
    await last.waitFor(); assert.equal(await last.evaluate(element => element === document.activeElement), true);
    assert.equal(await last.getAttribute('aria-posinset'), '1000'); assert.equal(await last.getAttribute('aria-setsize'), '1000');
    const mountedRows = await tree().getByRole('treeitem').count(); assert.ok(mountedRows < 80, `A thousand loaded files mounted ${mountedRows} tree nodes`);
    assert.equal(await visible('m-large/entry-0999.txt'), true);
    await page.keyboard.press('ArrowLeft'); assert.equal(await visible('m-large'), true);
    await page.keyboard.press('ArrowRight'); await item('m-large/entry-0000.txt').waitFor(); assert.equal(await visible('m-large/entry-0000.txt'), true);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); assert.equal(await last.count(), 0); assert.equal(await item('m-large').getAttribute('aria-expanded'), 'false');
    const fileMenu = await verifyProjectFileMenu({ page, application, capture, select, projectId: id, root });
    return { fileMenu, virtualizedLargeDirectory: { files: 1000, pages: 5, mountedRows, keyboardLastAndFirst: true, completeSiblingMetadata: true, collapseRetainedFocus: true }, guideStates, indentation, deepLevels: 11, ancestorStack: true, subtreePushOff: true, pointerCollapse: true, keyboardCanonicalFocus: true, noDuplicateTreeItems: true, pagination: true, refreshAndSearch: true, emptyEditorCopyVisible: true, zooms: [1, 1.25, 1.5], screenshots: ['116-project-tree-sticky-light.png', '117-project-tree-sticky-dark.png', '118-project-tree-deep-dark.png', '119-project-file-menu-dark.png'] };
  } finally {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
    await page.evaluate(async preferences => { await window.qiyao.savePreferences(preferences); }, preferences);
    await page.locator('.project-list').getByRole('button', { name: returnProjectName, exact: true }).click();
    const cleanupDeadline = Date.now() + 5000;
    while (true) {
      try { await page.evaluate(async id => { await window.qiyao.removeProject(id); }, id); break; }
      catch (error) { if (!error.message.includes('The workspace is busy. Retry worktree cleanup after current actions finish.') || Date.now() >= cleanupDeadline) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    await page.reload(); await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click();
    await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  }
}
