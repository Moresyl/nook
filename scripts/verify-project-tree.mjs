import assert from 'node:assert/strict';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { waitForTerminalPrompt } from './terminal-prompt.mjs';
import { assertTextHint, dismissModalWithEscape } from './text-hint-verification.mjs';
import { verifyProjectTreeSticky } from './verify-project-tree-sticky.mjs';
import { collectProjectTreeRows, projectTreeItem, scrollProjectTreeItem } from './project-tree-viewport.mjs';

export async function verifyProjectTree({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart }) {
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().includes('index.html'))";
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  async function waitForMain(expression) {
    const deadline = Date.now() + 10_000;
    while (!await application.evaluateMain(expression)) { assert.ok(Date.now() < deadline, 'The owned main-process fixture did not reach its expected state'); await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  const root = join(directory, '文件树 项目'); const second = join(directory, '另一个项目'); const outside = join(directory, '项目外目录');
  await Promise.all([mkdir(root), mkdir(second), mkdir(outside)]);
  for (const path of ['source', 'source/资料', '空目录', '__proto__', '.git', 'node_modules']) await mkdir(join(root, path));
  await writeFile(join(outside, 'private.txt'), 'OUTSIDE_TREE_MUST_NOT_BE_READ'); await symlink(outside, join(root, 'outside-link'), 'junction');
  const originalContents = 'export const treeEvidence = "TREE_ORIGINAL";\n';
  let draftContents = `${originalContents}// TREE_DRAFT_UNSAVED_名字😀\n`;
  await writeFile(join(root, 'source/资料/代码.ts'), originalContents);
  await writeFile(join(root, '__proto__/note.txt'), 'TREE_PROTOTYPE_SAFE_PATH'); await writeFile(join(root, 'root.txt'), 'TREE_ROOT'); await writeFile(join(second, 'second.txt'), 'SECOND_PROJECT_ONLY');
  for (let index = 0; index < 220; index += 32) await Promise.all(Array.from({ length: Math.min(32, 220 - index) }, (_, offset) => writeFile(join(root, `file-${String(index + offset).padStart(4, '0')}.txt`), 'TREE_PAGE')));
  const projectId = randomUUID(); const secondId = randomUUID();
  const projectName = `文件树验证 ${projectId.slice(0, 8)}`, secondName = `第二个目录 ${secondId.slice(0, 8)}`;
  const switcherProjects = Array.from({ length: 6 }, (_, index) => ({ id: randomUUID(), name: `切换验证 ${index + 1} ${projectId.slice(0, 8)} · ${'保留完整项目名称'.repeat(8)}` }));
  await page.evaluate(async ({ projectId, secondId, projectName, secondName, root, second, switcherProjects }) => {
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
    await window.qiyao.saveProject({ id: secondId, name: secondName, path: second, instructions: '', createdAt: Date.now() });
    for (const project of switcherProjects) await window.qiyao.saveProject({ ...project, path: second, instructions: '', createdAt: Date.now() });
    await window.qiyao.saveProject({ id: projectId, name: projectName, path: root, instructions: '', createdAt: Date.now() });
  }, { projectId, secondId, projectName, secondName, root, second, switcherProjects });
  await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  const tree = () => page.getByRole('tree', { name: '项目文件', exact: true });
  const item = path => projectTreeItem(() => page, tree, path);
  const row = (path) => item(path).locator(':scope > .project-tree-row');
  const input = () => page.locator('.project-main-panel:not([hidden]) .monaco-editor textarea.inputarea');
  const treeSelectionStates = [];
  async function assertTreeSelection(theme) {
    const selected = row('source/资料/代码.ts'), other = row('source');
    const colors = await page.evaluate(theme => {
      const probe = document.createElement('span'); document.body.append(probe);
      const normalize = value => { probe.style.backgroundColor = value; return getComputedStyle(probe).backgroundColor; };
      try { return { selected: normalize(theme === 'light' ? 'color-mix(in oklab, #1a1c1f 5%, transparent)' : 'color-mix(in oklab, #ffffff 5%, transparent)'), hover: normalize(theme === 'light' ? 'color-mix(in oklab, #1a1c1f 5%, transparent)' : 'color-mix(in oklab, #ffffff 8%, transparent)') }; }
      finally { probe.remove(); }
    }, theme);
    const background = locator => locator.evaluate(element => getComputedStyle(element).backgroundColor);
    await page.locator('.inspector-toolbar').hover();
    assert.equal(await item('source/资料/代码.ts').getAttribute('aria-selected'), 'true');
    assert.equal(await background(selected), colors.selected);
    await selected.hover(); assert.equal(await background(selected), colors.selected);
    await other.hover(); assert.equal(await background(other), colors.hover); assert.equal(await background(selected), colors.selected);
    assert.equal(await item('source/资料/代码.ts').getAttribute('aria-selected'), 'true');
    if (theme === 'dark') assert.notEqual(colors.selected, colors.hover);
    await page.locator('.inspector-toolbar').hover();
    treeSelectionStates.push({ theme, ...colors, selectedRetainedOnHover: true });
  }
  const createdContents = `TREE_NEW_FILE_CONTENT😀${process.platform === 'win32' ? '\r\n' : '\n'}`;
  await item('source').waitFor(); assert.ok(await tree().getByRole('treeitem').count() < 70); assert.equal((await collectProjectTreeRows(page, tree())).length, 200);
  const sourcePosition = await page.evaluate(async id => (await window.qiyao.listDirectory(id, { path: '' })).entries.findIndex(entry => entry.relativePath === 'source') + 1, projectId);
  assert.ok(sourcePosition > 0); assert.equal(await item('source').getAttribute('aria-posinset'), String(sourcePosition)); assert.equal(await item('source').getAttribute('aria-setsize'), '224');
  await item('source').focus(); await page.keyboard.press('f');
  assert.equal(await item('file-0000.txt').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('f'); assert.equal(await item('file-0001.txt').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home'); await page.keyboard.type('file-0100');
  assert.equal(await item('file-0100.txt').evaluate(element => element === document.activeElement), true);
  assert.equal(await tree().locator('[aria-selected="true"]').count(), 0, 'Typing must only move focus, not open a file');
  assert.equal(await item('file-0100.txt').evaluate(element => { const row = element.querySelector('.project-tree-row').getBoundingClientRect(), view = element.closest('.project-tree').getBoundingClientRect(); return row.top >= view.top && row.bottom <= view.bottom; }), true);
  await page.keyboard.press('Home'); await page.keyboard.press('s');
  await item('source').evaluate(element => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', isComposing: true, bubbles: true })); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })); });
  assert.equal(await item('source').evaluate(element => element === document.activeElement), true); assert.equal(await item('source').getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '刷新文件', exact: true }).focus(); await item('source').focus(); await page.keyboard.press('f');
  assert.equal(await item('file-0000.txt').evaluate(element => element === document.activeElement), true, 'Leaving the tree resets the prefix');
  await page.waitForTimeout(750); await page.keyboard.press('s');
  assert.equal(await item('source').evaluate(element => element === document.activeElement), true, 'Expired prefix starts a new search');
  await page.keyboard.press('Home'); await page.keyboard.press('z'); assert.equal(await item('__proto__').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home');
  const treeTypography = await row('source').evaluate(element => {
    const style = getComputedStyle(element), label = element.querySelector('.project-tree-label');
    return { fontSize: style.fontSize, gap: style.columnGap, labelFontSize: getComputedStyle(label).fontSize, rowHeight: element.getBoundingClientRect().height };
  });
  assert.equal(treeTypography.fontSize, '13px'); assert.equal(treeTypography.labelFontSize, '13px'); assert.equal(treeTypography.gap, '5px'); assert.ok(treeTypography.rowHeight >= 28);
  const treeGeometry = await row('source').evaluate(element => {
    const style = getComputedStyle(element), icon = element.querySelector(':scope > svg').getBoundingClientRect();
    return { paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, lineHeight: style.lineHeight, radius: style.borderTopLeftRadius, iconWidth: icon.width, iconHeight: icon.height };
  });
  assert.deepEqual(treeGeometry, { paddingLeft: '3px', paddingRight: '3px', lineHeight: '28px', radius: '6px', iconWidth: 16, iconHeight: 16 });
  for (const path of ['.git', 'node_modules', 'outside-link']) assert.equal(await item(path).count(), 0);
  const boundary = await page.evaluate(async ({ projectId, outside }) => { try { await window.qiyao.listDirectory(projectId, { path: outside }); return 'UNEXPECTED'; } catch (error) { return String(error); } }, { projectId, outside }); assert.match(boundary, /outside/); assert.ok(!boundary.includes('OUTSIDE_TREE_MUST_NOT_BE_READ'));
  await writeFile(join(root, '000-added.txt'), 'ADDED_BETWEEN_PAGES');
  await tree().getByRole('button', { name: '加载更多 项目根目录', exact: true }).click(); await tree().getByRole('alert').waitFor(); assert.equal((await collectProjectTreeRows(page, tree())).length, 200);
  await tree().getByRole('button', { name: '重试目录 项目根目录', exact: true }).click(); await tree().getByRole('alert').waitFor({ state: 'hidden' });
  await tree().getByRole('button', { name: '加载更多 项目根目录', exact: true }).click(); await scrollProjectTreeItem(page, tree(), 'file-0219.txt'); assert.equal((await collectProjectTreeRows(page, tree())).length, 225); await scrollProjectTreeItem(page, tree(), '000-added.txt'); await item('000-added.txt').waitFor();
  await item('file-0219.txt').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '94-project-tree-pagination-light.png') });
  verified('actual scoped IPC pages retain every root entry, reject changed revisions before merging, retry successfully and omit internal folders/outside junctions');

  await row('空目录').click(); await item('空目录').getByText('空文件夹', { exact: true }).waitFor(); await row('空目录').click();
  await item('source').focus(); await item('source').press('End'); assert.equal(await item('root.txt').evaluate((element) => element === document.activeElement), true); await item('root.txt').press('ArrowUp'); assert.equal(await item('file-0219.txt').evaluate((element) => element === document.activeElement), true); await item('file-0219.txt').press('ArrowDown'); await item('root.txt').press('Home'); assert.equal(await item('__proto__').evaluate((element) => element === document.activeElement), true);
  await row('__proto__').click(); await row('__proto__/note.txt').click(); await page.locator('.monaco-editor .view-lines').getByText('TREE_PROTOTYPE_SAFE_PATH', { exact: true }).waitFor();
  await item('source').focus(); await item('source').press('ArrowRight'); await item('source/资料').waitFor(); await item('source').press('ArrowRight'); assert.equal(await item('source/资料').evaluate((element) => element === document.activeElement), true);
  await item('source/资料').press('ArrowRight'); await item('source/资料/代码.ts').waitFor(); await item('source/资料').press('ArrowRight'); assert.equal(await item('source/资料/代码.ts').evaluate((element) => element === document.activeElement), true);
  await item('source/资料/代码.ts').press('Enter'); await page.locator('.editor-actionbar .path-text').getByText('source/资料/代码.ts', { exact: true }).waitFor(); await input().waitFor(); await input().focus(); await input().press('Control+End'); await page.keyboard.insertText('// TREE_DRAFT_UNSAVED_名字😀\n');
  await waitForBridge(page, async ({ id, text }) => (await window.qiyao.load()).editorDrafts.some((draft) => draft.projectId === id && draft.path === 'source/资料/代码.ts' && draft.text === text), { id: projectId, text: draftContents }); assert.equal(await readFile(join(root, 'source/资料/代码.ts'), 'utf8'), originalContents);
  await item('source/资料/代码.ts').focus(); await item('source/资料/代码.ts').press('ArrowLeft'); assert.equal(await item('source/资料').evaluate((element) => element === document.activeElement), true); await item('source/资料').press('ArrowLeft'); assert.equal(await item('source/资料').getAttribute('aria-expanded'), 'false'); assert.equal(await item('source/资料/代码.ts').count(), 0);
  await page.getByRole('button', { name: '定位当前文件', exact: true }).click(); await item('source/资料/代码.ts').waitFor(); assert.equal(await item('source/资料/代码.ts').evaluate((element) => element === document.activeElement), true);
  await page.getByRole('button', { name: '收起所有目录', exact: true }).click(); assert.equal(await item('source').getAttribute('aria-expanded'), 'false'); assert.equal(await item('source/资料/代码.ts').count(), 0);
  await item('source').focus(); await item('source').press(' '); await item('source/资料').waitFor();
  await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await tree().getByRole('button', { name: '加载更多 项目根目录', exact: true }).waitFor({ state: 'hidden' }); await scrollProjectTreeItem(page, tree(), 'file-0219.txt'); await row('source/资料').click(); await item('source/资料/代码.ts').waitFor();
  await page.getByRole('button', { name: '新建文件', exact: true }).click(); const newFile = page.getByRole('dialog', { name: '新建文件', exact: true }); assert.equal(await newFile.getByLabel('相对路径', { exact: true }).inputValue(), 'source/资料/'); await newFile.getByLabel('相对路径', { exact: true }).fill('source/资料/新文件.txt'); await newFile.getByRole('button', { name: '创建', exact: true }).click(); await newFile.waitFor({ state: 'hidden' }); await page.locator('.editor-actionbar .path-text').getByText('source/资料/新文件.txt', { exact: true }).waitFor(); await input().waitFor(); await input().focus(); await page.keyboard.insertText('TREE_NEW_FILE_CONTENT😀\n'); await input().press('Control+s'); await page.locator('.editor-actionbar').getByRole('status').getByText('已保存', { exact: true }).waitFor(); assert.equal(await readFile(join(root, 'source/资料/新文件.txt'), 'utf8'), createdContents); await item('source/资料/新文件.txt').waitFor();
  await page.getByRole('tab', { name: /代码\.ts/ }).click(); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor(); await page.locator('.editor-actionbar').getByRole('status').getByText('草稿自动保存在工作台', { exact: true }).waitFor(); await page.screenshot({ path: join(screenshots, '95-project-tree-editor-light.png') });
  await item('source/资料/代码.ts').focus(); await item('source/资料/代码.ts').press('Shift+F10');
  await page.getByRole('menuitem', { name: '在此目录新建文件夹', exact: true }).click();
  const newFolder = page.getByRole('dialog', { name: '新建文件夹', exact: true }), folderName = newFolder.getByLabel('文件夹名称', { exact: true });
  assert.equal(await newFolder.getByText('创建位置：source/资料', { exact: true }).count(), 1);
  await folderName.fill('../outside'); assert.equal(await newFolder.getByRole('button', { name: '创建', exact: true }).isDisabled(), true);
  await folderName.fill('代码.ts'); await folderName.press('Enter'); await newFolder.getByRole('alert').waitFor(); assert.equal(await folderName.inputValue(), '代码.ts');
  await folderName.fill('新目录😀'); await folderName.press('Enter'); await newFolder.waitFor({ state: 'hidden' }); await item('source/资料/新目录😀').waitFor();
  assert.equal((await stat(join(root, 'source/资料/新目录😀'))).isDirectory(), true);
  assert.equal(await readFile(join(root, 'source/资料/代码.ts'), 'utf8'), originalContents);
  await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  verified('folder creation via the keyboard menu rejects invalid names and collisions, retries successfully, reveals the new directory and preserves the unsaved editor draft');
  const longFileName = `${'完整中文文件名称'.repeat(8)}.ts`, longFilePath = `source/资料/${longFileName}`;
  await writeFile(join(root, longFilePath), 'TREE_LONG_NAME_ORIGINAL');
  await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await item(longFilePath).waitFor();
  assert.equal(await row(longFilePath).locator('.project-tree-label').textContent(), longFileName);
  const longFileClipping = await row(longFilePath).evaluate(element => {
    const label = element.querySelector('.project-tree-label'), rect = element.getBoundingClientRect(), text = label.getBoundingClientRect();
    return { overflow: getComputedStyle(element).overflowX, textOverflow: getComputedStyle(label).textOverflow, clippedAtRowEdge: text.right > rect.right, rowWidth: rect.width, labelWidth: text.width };
  });
  assert.equal(longFileClipping.overflow, 'hidden'); assert.equal(longFileClipping.textOverflow, 'clip'); assert.equal(longFileClipping.clippedAtRowEdge, true);
  await assertTextHint(page, item(longFilePath), longFilePath, { hoverTarget: row(longFilePath) });
  await page.mouse.move(1, 1); await page.locator('.control-tooltip:popover-open').waitFor({ state: 'hidden' });
  assert.equal(await item('source/资料/代码.ts').getAttribute('aria-selected'), 'true');
  await page.screenshot({ path: join(screenshots, '103-project-tree-long-path-light.png') });
  const finder = () => page.getByRole('combobox', { name: '查找项目文件', exact: true });
  const searchResults = () => page.getByRole('listbox', { name: '项目文件查找结果', exact: true });
  await finder().fill('file-'); await searchResults().getByRole('option').nth(99).waitFor();
  assert.equal(await searchResults().getByRole('option').count(), 100);
  await page.getByRole('status').filter({ hasText: '结果不完整' }).waitFor();
  const limitNoticeVisible = await page.getByRole('status').filter({ hasText: '结果不完整' }).evaluate(element => {
    const rect = element.getBoundingClientRect(), panel = element.closest('.project-file-search-results').getBoundingClientRect();
    return rect.height > 0 && rect.top >= panel.top && rect.bottom <= panel.bottom && rect.bottom <= innerHeight;
  });
  assert.equal(limitNoticeVisible, true, 'Incomplete-result notice stays visible outside the scrolling results');
  await finder().press('End'); assert.equal(await searchResults().getByRole('option').nth(99).getAttribute('aria-selected'), 'true');
  await finder().press('ArrowUp'); assert.equal(await searchResults().getByRole('option').nth(98).getAttribute('aria-selected'), 'true');
  await finder().press('Home'); assert.equal(await searchResults().getByRole('option').first().getAttribute('aria-selected'), 'true');
  await page.screenshot({ path: join(screenshots, '106-project-file-search-limit-light.png') });
  await finder().fill('新文件'); await searchResults().getByRole('option', { name: 'source/资料/新文件.txt', exact: true }).waitFor();
  await finder().press('End'); await finder().press('Space');
  assert.equal(await searchResults().getByRole('option').count(), 1, 'Trailing whitespace keeps the same valid search result');
  await finder().evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })));
  await page.locator('.editor-actionbar .path-text').getByText('source/资料/代码.ts', { exact: true }).waitFor();
  await finder().press('Enter'); await page.locator('.editor-actionbar .path-text').getByText('source/资料/新文件.txt', { exact: true }).waitFor();
  await finder().fill('SOURCE\\资料/代码.ts'); await searchResults().getByRole('option', { name: 'source/资料/代码.ts', exact: true }).waitFor(); await finder().press('Enter');
  await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  assert.deepEqual(await page.evaluate(id => window.qiyao.searchProjectFiles(id, 'private'), projectId), { entries: [], truncated: false, skippedDirectories: 0 });
  await page.screenshot({ path: join(screenshots, '104-project-file-search-light.png') });
  await page.getByRole('button', { name: '定位当前文件', exact: true }).click(); await tree().waitFor();
  await page.locator('[role="treeitem"][aria-label="source/资料/代码.ts"]:focus').waitFor();
  assert.equal(await finder().inputValue(), '');
  assert.equal(await item('source/资料/代码.ts').evaluate(element => element === document.activeElement), true, 'Locate leaves search and focuses the visible active file');
  await finder().fill('同步'); await page.getByRole('status').getByText('没有匹配的文件。', { exact: true }).waitFor();
  await writeFile(join(root, 'source/资料/同步外部.txt'), 'EXTERNAL_REFRESH_EXACT\n');
  await page.getByRole('button', { name: '刷新文件', exact: true }).click();
  await searchResults().getByRole('option', { name: 'source/资料/同步外部.txt', exact: true }).waitFor();
  assert.equal(await finder().inputValue(), '同步', 'Refresh preserves the current query');
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await newFile.getByLabel('相对路径', { exact: true }).fill('source/资料/同步创建.txt');
  await newFile.getByRole('button', { name: '创建', exact: true }).click(); await newFile.waitFor({ state: 'hidden' });
  await page.locator('.editor-actionbar .path-text').getByText('source/资料/同步创建.txt', { exact: true }).waitFor();
  await input().focus(); await page.keyboard.insertText('CREATED_SEARCH_EXACT\n'); await input().press('Control+s');
  await searchResults().getByRole('option', { name: 'source/资料/同步创建.txt', exact: true }).waitFor();
  assert.equal(await searchResults().getByRole('option').count(), 2, 'Saving a new matching file updates the active search');
  assert.equal(await readFile(join(root, 'source/资料/同步创建.txt'), 'utf8'), `CREATED_SEARCH_EXACT${process.platform === 'win32' ? '\r\n' : '\n'}`);
  await finder().fill('代码'); await searchResults().getByRole('option', { name: 'source/资料/代码.ts', exact: true }).waitFor(); await finder().press('Enter');
  await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  await finder().press('Escape'); await tree().waitFor(); assert.equal(await finder().inputValue(), '');
  const workingLayout = await page.evaluate(() => {
    const list = document.querySelector('.project-list').getBoundingClientRect();
    const editor = document.querySelector('.editor-canvas').getBoundingClientRect();
    return { width: innerWidth, editorWidth: editor.width, switcherAboveEditor: list.bottom <= editor.top, headingHidden: !document.querySelector('.projects-page .page-heading').checkVisibility() };
  });
  await assertTreeSelection('light');
  assert.equal(workingLayout.switcherAboveEditor, true);
  assert.equal(workingLayout.headingHidden, true);
  if (workingLayout.width >= 1280) assert.ok(workingLayout.editorWidth >= 700, 'The normal desktop layout must reserve room for the actual editor');
  verified('native pointer and ARIA tree keyboard paths open nested Unicode/prototype-safe files, preserve unsaved drafts through collapse/refresh and create/save an exact file in the selected folder');

  const normalize = (path) => path.replaceAll('\\', '/').toLowerCase();
  await application.evaluateMain(`globalThis.qiyaoTreeFs=require('node:fs/promises');globalThis.qiyaoTreeRead=globalThis.qiyaoTreeFs.readdir;globalThis.qiyaoTreeMode='fail';globalThis.qiyaoTreeFs.readdir=async(path,...args)=>{const owned=String(path).replaceAll(String.fromCharCode(92),'/').toLowerCase()===${JSON.stringify(normalize(root))};if(owned&&globalThis.qiyaoTreeMode==='fail')throw Object.assign(new Error('PRIVATE_TREE_FILESYSTEM_FAILURE'),{code:'EIO'});const held=owned&&globalThis.qiyaoTreeMode==='hold';if(held){globalThis.qiyaoTreeHeld=true;await new Promise(resolve=>{globalThis.qiyaoTreeRelease=resolve;});}const entries=await globalThis.qiyaoTreeRead(path,...args);if(held)globalThis.qiyaoTreeHeldCompleted=true;return entries;};`);
  try {
    await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await tree().getByRole('alert').waitFor(); await scrollProjectTreeItem(page, tree(), 'file-0219.txt'); assert.ok(!(await tree().innerText()).includes('PRIVATE_TREE_FILESYSTEM_FAILURE')); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
    await finder().fill('代码'); await page.getByRole('alert').getByText('无法查找项目文件，请重试。', { exact: true }).waitFor();
    assert.ok(!(await page.locator('.project-file-finder').innerText()).includes('PRIVATE_TREE_FILESYSTEM_FAILURE'));
    await application.evaluateMain("globalThis.qiyaoTreeMode='normal'");
    await page.getByRole('button', { name: '重试查找', exact: true }).click(); await searchResults().getByRole('option', { name: 'source/资料/代码.ts', exact: true }).waitFor();
    await finder().press('Escape'); await tree().getByRole('button', { name: '重试目录 项目根目录', exact: true }).click(); await tree().getByRole('alert').waitFor({ state: 'hidden' });
    await application.evaluateMain("globalThis.qiyaoTreeMode='hold';globalThis.qiyaoTreeHeld=false;globalThis.qiyaoTreeHeldCompleted=false");
    await finder().fill('root.txt'); await waitForMain('globalThis.qiyaoTreeHeld');
    await finder().fill('新文件');
    await application.evaluateMain("globalThis.qiyaoTreeMode='normal';globalThis.qiyaoTreeRelease()"); await waitForMain('globalThis.qiyaoTreeHeldCompleted');
    await searchResults().getByRole('option', { name: 'source/资料/新文件.txt', exact: true }).waitFor();
    assert.equal(await searchResults().getByRole('option', { name: 'root.txt', exact: true }).count(), 0);
    await finder().press('Escape');
    await application.evaluateMain("globalThis.qiyaoTreeMode='hold';globalThis.qiyaoTreeHeld=false;globalThis.qiyaoTreeHeldCompleted=false"); await page.getByRole('button', { name: '刷新文件', exact: true }).click();
    await waitForMain('globalThis.qiyaoTreeHeld');
    await page.locator('.project-list').getByRole('button', { name: secondName, exact: true }).click(); await item('second.txt').waitFor(); await application.evaluateMain("globalThis.qiyaoTreeMode='normal';globalThis.qiyaoTreeRelease()"); await waitForMain('globalThis.qiyaoTreeHeldCompleted'); await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert.equal(await tree().getByRole('treeitem').count(), 1); assert.equal(await item('source').count(), 0);
  } finally { await application.evaluateMain("globalThis.qiyaoTreeFs.readdir=globalThis.qiyaoTreeRead;globalThis.qiyaoTreeRelease?.()"); }
  await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click(); await item('source/资料/代码.ts').waitFor(); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  verified('actual directory-read failure retains cached rows and dirty editor contents, successful retry recovers, and a delayed old-project response cannot replace the new project tree');

  const longName = `${projectName} · ${'较长项目名称'.repeat(12)}`;
  await page.evaluate(async ({ projectId, longName }) => { const state = await window.qiyao.load(); await window.qiyao.saveProject({ ...state.projects.find((project) => project.id === projectId), name: longName }); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }, { projectId, longName }); await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click(); await item('source/资料/代码.ts').waitFor(); await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const heading = page.locator('.project-inspector > .section-heading'); await assertTextHint(page, heading.getByRole('heading', { name: longName, exact: true }), longName); await assertTextHint(page, heading.locator('.path-text'), root); assert.equal(await heading.locator('.path-text').evaluate((element) => getComputedStyle(element).whiteSpace), 'nowrap');
  await assertTreeSelection('dark');
  await finder().fill('代码'); await searchResults().getByRole('option', { name: 'source/资料/代码.ts', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(screenshots, '105-project-file-search-dark-narrow.png') });
  await finder().press('Escape'); await tree().waitFor();
  await page.getByRole('button', { name: '终端', exact: true }).click(); await page.locator('.terminal-tabs').getByRole('button', { name: '新建终端', exact: true }).click();
  try {
    const startup = await waitForTerminalPrompt(() => page.evaluate(async (id) => { const terminals = await window.qiyao.terminalList(id); globalThis.qiyaoTreePromptPoll = { at: Date.now(), terminals: terminals.map((terminal) => ({ ...terminal, output: terminal.output.slice(-4096) })) }; return terminals; }, projectId));
    console.log('Project terminal cold-start timing', JSON.stringify(startup));
  } catch (error) {
    console.error('Project terminal startup diagnostics', JSON.stringify(await page.evaluate(async (id) => ({ at: Date.now(), lastPoll: globalThis.qiyaoTreePromptPoll, current: (await window.qiyao.terminalList(id)).map((terminal) => ({ ...terminal, output: terminal.output.slice(-4096) })) }), projectId).catch((failure) => ({ diagnosticError: String(failure) }))));
    console.error('Project terminal process diagnostics', JSON.stringify(await application.evaluateMain('globalThis.qiyaoTerminalProcessSnapshot()').catch(() => ({ diagnosticError: 'Main-process diagnostics unavailable' }))));
    // Preserve the original failure while distinguishing slow cold startup from a terminal that remains stalled.
    try {
      const startedAt = Date.now(); let current = [];
      do {
        current = await page.evaluate(async (id) => (await window.qiyao.terminalList(id)).map((terminal) => ({ ...terminal, output: terminal.output.slice(-4096) })), projectId);
        if (current.some((terminal) => terminal.output.includes('PS ')) || current.every((terminal) => terminal.status !== 'running')) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() - startedAt < 20_000);
      console.error('Project terminal after-failure observation', JSON.stringify({ startedAt, capturedAt: Date.now(), current }));
    } catch { console.error('Project terminal after-failure observation unavailable'); }
    throw error;
  } finally { await page.evaluate(() => { delete globalThis.qiyaoTreePromptPoll; }).catch(() => {}); }
  const terminalTiming = await application.evaluateMain('globalThis.qiyaoPtyDiagnostics?.at(-1)');
  assert.ok(Number.isInteger(terminalTiming?.pid) && terminalTiming.pid > 0); assert.ok(terminalTiming.chunks > 0); assert.ok(terminalTiming.firstDataAt >= terminalTiming.registeredAt); assert.ok(terminalTiming.lastDataAt >= terminalTiming.firstDataAt);
  console.log('Project terminal process timing', JSON.stringify(terminalTiming));
  const processSnapshot = await application.evaluateMain('globalThis.qiyaoTerminalProcessSnapshot()');
  assert.ok(processSnapshot.mainMemory.rss > 0); assert.ok(processSnapshot.systemMemory.free > 0 && processSnapshot.systemMemory.total >= processSnapshot.systemMemory.free); assert.ok(processSnapshot.applicationProcesses.some((process) => process.type === 'Browser'));
  console.log('Project terminal process snapshot', JSON.stringify(processSnapshot));
  const terminalSession = await page.evaluate(async (id) => (await window.qiyao.terminalList(id)).find((terminal) => terminal.output.includes('PS ')), projectId);
  assert.ok(terminalSession); await page.evaluate(async (id) => { await window.qiyao.terminalWrite(id, "Write-Output ('QIYAO_PS_VERSION_'+$PSVersionTable.PSVersion.Major)\r"); }, terminalSession.id);
  await waitForBridge(page, async (id) => (await window.qiyao.terminalList(id)).some((terminal) => /QIYAO_PS_VERSION_\d+/.test(terminal.output)), projectId);
  const shellRuntime = await page.evaluate(async (id) => { const terminal = (await window.qiyao.terminalList(id)).find((terminal) => /QIYAO_PS_VERSION_\d+/.test(terminal.output)); return { shell: terminal.shell, major: Number(terminal.output.match(/QIYAO_PS_VERSION_(\d+)/)[1]) }; }, projectId);
  assert.equal(shellRuntime.major, /pwsh\.exe$/i.test(shellRuntime.shell) ? 7 : 5); console.log('Project terminal selected shell runtime', JSON.stringify(shellRuntime));
  await application.evaluateMain(`
    globalThis.qiyaoProjectOriginalClone = globalThis.structuredClone;
    globalThis.qiyaoProjectWorkspaceCopies = 0;
    globalThis.structuredClone = (value, ...args) => {
      if (value?.schemaVersion === 1 && Array.isArray(value.threads) && Array.isArray(value.projects)) globalThis.qiyaoProjectWorkspaceCopies++;
      return globalThis.qiyaoProjectOriginalClone(value, ...args);
    };
  `);
  let projectWorkspaceCopies;
  try {
    await page.evaluate(async (id) => {
      for (let index = 0; index < 8; index++) {
        const terminals = await window.qiyao.terminalList(id);
        if (!terminals.some((terminal) => terminal.status === 'running')) throw new Error('The owned project terminal is no longer running');
      }
      const document = await window.qiyao.loadDocument(id, 'source/资料/代码.ts');
      if (!document.text.includes('TREE_ORIGINAL')) throw new Error('The owned project document changed unexpectedly');
    }, projectId);
    projectWorkspaceCopies = await application.evaluateMain('globalThis.qiyaoProjectWorkspaceCopies');
  } finally {
    await application.evaluateMain('globalThis.structuredClone=globalThis.qiyaoProjectOriginalClone;delete globalThis.qiyaoProjectOriginalClone;delete globalThis.qiyaoProjectWorkspaceCopies;');
  }
  assert.equal(projectWorkspaceCopies, 0, 'Project terminal and document IPC must not copy unrelated conversation history');
  console.log('Verified actual scoped project IPC without full workspace copies', JSON.stringify({ terminalReads: 8, documentReads: 1, workspaceCopies: projectWorkspaceCopies }));
  await page.getByRole('button', { name: '定位当前文件', exact: true }).click();
  const geometry = await page.evaluate(() => { const terminal = document.querySelector('.project-terminal').getBoundingClientRect(); const editor = document.querySelector('.editor-canvas').getBoundingClientRect(); return { top: terminal.top, bottom: terminal.bottom, height: terminal.height, editor: editor.height, windowHeight: innerHeight }; }); assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.windowHeight && geometry.height >= 100 && geometry.editor >= 60, JSON.stringify(geometry)); await page.screenshot({ path: join(screenshots, '96-project-tree-dark-narrow.png') });
  const toolbarLayout = await page.locator('.editor-files-toolbar').first().evaluate(element => {
    const bounds = element.getBoundingClientRect(), title = element.querySelector('span:not([role="tooltip"])').getBoundingClientRect();
    const buttons = [...element.querySelectorAll(':scope > button')].map(button => button.getBoundingClientRect());
    return { titleVisible: title.width > 0 && title.height > 0, buttons: buttons.length, contained: buttons.every(rect => rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom), oneRow: buttons.every(rect => Math.abs(rect.top - buttons[0].top) < 1) };
  });
  assert.deepEqual(toolbarLayout, { titleVisible: true, buttons: 5, contained: true, oneRow: true });
  const rowsBeforeHide = await collectProjectTreeRows(page, tree());
  await page.getByRole('button', { name: '隐藏文件树', exact: true }).focus(); await page.getByRole('button', { name: '隐藏文件树', exact: true }).press('Enter');
  assert.equal(await tree().count(), 0); assert.equal(await page.getByRole('button', { name: '显示文件树', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('button', { name: '显示文件树', exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.getByRole('button', { name: '显示文件树', exact: true }).press('Space');
  assert.deepEqual(await collectProjectTreeRows(page, tree()), rowsBeforeHide);
  await page.getByRole('button', { name: '查看改动', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '隐藏文件树', exact: true }).isDisabled(), true); await page.locator('.inspector-toolbar').getByRole('button', { name: '文件', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '隐藏文件树', exact: true }).isDisabled(), false); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  async function capture(path) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async () => { const window = ${mainWindow}; const image = await window.capturePage(); return { png: image.toPNG().toString('base64'), size: window.getContentSize() }; })()`); const png = Buffer.from(image.png, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], image.size); await writeFile(join(screenshots, path), png);
  }
  const zoomFactors = [1, 1.25, 1.5]; const layout = [];
  for (const zoom of zoomFactors) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction((width) => Math.abs(innerWidth - width) <= 2, 760 / zoom);
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.project-tabs'); const selected = document.querySelector('.project-row.selected'); const add = document.querySelector('.project-list-add');
      if (!viewport || !selected || !add) return false;
      const view = viewport.getBoundingClientRect(); const row = selected.getBoundingClientRect(); const action = add.getBoundingClientRect();
      return viewport.scrollWidth > viewport.clientWidth && row.left >= view.left - 1 && row.right <= view.right + 1 && action.left >= 0 && action.right <= view.left + 1 && action.width > 0;
    });
    assert.equal(await page.locator('.project-row.selected > button').first().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.project-list button[aria-pressed="true"]').count(), 1);
    if (zoom === 1.25) await page.getByRole('button', { name: '隐藏文件树', exact: true }).click();
    const marker = `TREE_SPACE_INPUT_${zoom * 100}`; await input().focus(); await input().press('Control+End'); await page.keyboard.insertText(`// ${marker}\n`); draftContents += `// ${marker}\n`;
    await waitForBridge(page, async ({ id, text }) => (await window.qiyao.load()).editorDrafts.some((draft) => draft.projectId === id && draft.path === 'source/资料/代码.ts' && draft.text === text), { id: projectId, text: draftContents });
    await page.locator('.monaco-editor .view-lines').getByText(new RegExp(marker)).waitFor();
    const terminalInput = page.locator('.xterm-helper-textarea'); await terminalInput.focus(); await page.keyboard.type(`echo ('SPACE'+'${zoom * 100}');Read-Host '>'`, { delay: 5 }); await terminalInput.press('Enter');
    await waitForBridge(page, async ({ id, marker }) => (await window.qiyao.terminalList(id)).some((terminal) => terminal.output.includes(marker)), { id: projectId, marker: `SPACE${zoom * 100}` });
    await page.locator('.xterm-accessibility-tree').getByText(`SPACE${zoom * 100}`, { exact: true }).waitFor();
    const bounds = await page.evaluate(() => {
      const terminal = document.querySelector('.project-terminal').getBoundingClientRect(); const editor = document.querySelector('.editor-canvas').getBoundingClientRect(); const button = document.querySelector('.inspector-toolbar [aria-label$="文件树"]').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth, terminal: { top: terminal.top, bottom: terminal.bottom, height: terminal.height }, editor: { left: editor.left, right: editor.right, width: editor.width, height: editor.height }, toggleFits: button.left >= 0 && button.right <= innerWidth && button.top >= 0 && button.bottom <= innerHeight };
    });
    await capture(`97-project-workspace-zoom-${zoom * 100}.png`);
    assert.equal(bounds.documentOverflow, false); assert.equal(bounds.toggleFits, true); assert.ok(bounds.terminal.top >= 0 && bounds.terminal.bottom <= bounds.height + 1 && bounds.terminal.height >= 88 && bounds.editor.height >= 60 && bounds.editor.width >= 140 && bounds.editor.left >= 0 && bounds.editor.right <= bounds.width + 1, JSON.stringify({ zoom, ...bounds }));
    const line = await page.locator('.monaco-editor .view-lines').getByText(new RegExp(marker)).boundingBox(); const canvas = await page.locator('.editor-canvas').boundingBox(); assert.ok(line && canvas && line.y >= canvas.y && line.y + line.height <= canvas.y + canvas.height + 1, 'The typed code line must fit within the editor canvas');
    layout.push({ zoom, fileTree: zoom === 1, sidebar: true, ...bounds });
    const add = await page.getByRole('button', { name: '添加项目', exact: true }).boundingBox(); assert.ok(add && add.x >= 0 && add.y >= 0 && add.x + add.width <= bounds.width + 1 && add.y + add.height <= bounds.height + 1, 'The compact layout must retain the add-project action');
    if (zoom === 1.5) {
      const opener = page.getByRole('button', { name: `编辑 ${longName}`, exact: true }); await opener.focus(); await opener.press('Enter'); const settings = page.getByRole('dialog', { name: '项目设置', exact: true }); await settings.waitFor(); assert.equal(await settings.getByLabel('项目名称', { exact: true }).inputValue(), longName); assert.equal(await settings.getByLabel('文件夹', { exact: true }).inputValue(), root); await capture('98-project-settings-zoom-150.png'); await dismissModalWithEscape(page, settings); assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
      await page.locator('.project-tabs').hover(); await page.mouse.wheel(-10_000, 0);
      await page.waitForFunction(() => document.querySelector('.project-tabs').scrollLeft < 1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.project-tabs').evaluate(element => element.scrollLeft), 0, 'Manual horizontal browsing must not snap back to the selected project');
      await application.evaluateMain(`globalThis.nookSwitcherOpenDialog=require('electron').dialog.showOpenDialog;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(root)}]});`);
      try {
        const addProject = page.getByRole('button', { name: '添加项目', exact: true }); await addProject.focus(); await addProject.press('Enter'); await settings.waitFor();
        assert.equal(await settings.getByLabel('文件夹', { exact: true }).inputValue(), root); await dismissModalWithEscape(page, settings);
        assert.equal(await addProject.evaluate(element => element === document.activeElement), true);
      } finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookSwitcherOpenDialog;delete globalThis.nookSwitcherOpenDialog"); }
      const firstRow = page.locator('.project-tabs .project-row').first(); const firstProject = firstRow.getByRole('button').first(); const firstName = await firstProject.innerText();
      await firstProject.focus(); await application.resize(800, 560);
      await page.waitForFunction(() => Math.abs(innerWidth - 800 / 1.5) < 2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await firstProject.evaluate(element => { const row = element.closest('.project-row').getBoundingClientRect(); const view = element.closest('.project-tabs').getBoundingClientRect(); return element === document.activeElement && row.left >= view.left - 1 && row.right <= view.right + 1; }), true);
      await firstProject.press('Tab'); const editFirst = firstRow.getByRole('button', { name: `编辑 ${firstName}`, exact: true });
      assert.equal(await editFirst.evaluate(element => element === document.activeElement), true); await editFirst.press('Enter'); await settings.waitFor();
      assert.equal(await settings.getByLabel('项目名称', { exact: true }).inputValue(), firstName); await dismissModalWithEscape(page, settings);
      assert.equal(await editFirst.evaluate(element => element === document.activeElement), true);
      await application.resize(760, 540); await page.waitForFunction(() => Math.abs(innerWidth - 760 / 1.5) < 2);
      await page.locator('.project-row.selected > button').first().focus();
      await page.locator('.monaco-editor .view-lines').getByText(new RegExp(marker)).waitFor();
      assert.equal(await page.locator('.project-row.selected > button').first().innerText(), longName);
      await capture('102-project-switcher-dark-narrow.png');
    }
    await terminalInput.focus();
    await terminalInput.press('Enter'); await waitForBridge(page, async ({ id, marker }) => (await window.qiyao.terminalList(id)).some((terminal) => terminal.output.slice(terminal.output.lastIndexOf(marker)).includes('PS ')), { id: projectId, marker: `SPACE${zoom * 100}` });
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await page.getByRole('button', { name: '显示文件树', exact: true }).click(); assert.deepEqual(await collectProjectTreeRows(page, tree()), rowsBeforeHide);
  assert.equal(await readFile(join(root, 'source/资料/代码.ts'), 'utf8'), originalContents);
  verified('keyboard file-tree visibility preserves cached expansion/focus/drafts, and the minimum window supports visible code input and real PTY commands at 100/125/150 percent native zoom with the sidebar retained');
  page = await restart(); application = getApplication(); await page.getByRole('button', { name: '项目', exact: true }).click(); await item('source/资料/代码.ts').waitFor(); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  const stored = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); assert.ok(stored.editorDrafts.some((draft) => draft.projectId === projectId && draft.path === 'source/资料/代码.ts' && draft.text === draftContents)); assert.equal(await readFile(join(root, 'source/资料/代码.ts'), 'utf8'), originalContents);
  await application.resize(1280, 840);
  verified('dark minimum-window long-name/path tree, editor and real PTY fit without overflow, normal close flushes the exact unsaved file and restart reveals its ancestors without writing the project file');
  const palette = () => page.getByRole('dialog', { name: '搜索与命令', exact: true });
  const search = () => palette().getByRole('combobox', { name: '搜索聊天与命令', exact: true });
  async function openCommand(title) { await page.keyboard.press('Control+Shift+P'); await search().fill(`>${title}`); await (title === '当前项目' ? palette().getByRole('option').first() : palette().getByRole('option', { name: title, exact: true })).waitFor(); }
  async function executeCommand(title, screenshot) {
    await openCommand(title); assert.equal(await palette().getByRole('option', { name: title, exact: true }).isDisabled(), false);
    if (screenshot) await capture(screenshot);
    await search().press('Enter'); await palette().waitFor({ state: 'hidden' });
  }
  const restoredRows = await collectProjectTreeRows(page, tree());
  await input().focus(); await executeCommand('隐藏文件树', '99-project-file-command-dark.png'); assert.equal(await tree().count(), 0); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  await executeCommand('显示文件树'); assert.deepEqual(await collectProjectTreeRows(page, tree()), restoredRows);
  await executeCommand('显示终端'); await page.locator('.terminal-tabs').getByRole('button', { name: '新建终端', exact: true }).click();
  console.log('Project command terminal cold-start timing', JSON.stringify(await waitForTerminalPrompt(() => page.evaluate((id) => window.qiyao.terminalList(id), projectId))));
  const terminalId = await page.evaluate(async (id) => (await window.qiyao.terminalList(id))[0].id, projectId);
  await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type("echo ('COMMAND'+'PANEL');Read-Host '>'", { delay: 5 }); await page.keyboard.press('Enter'); await page.locator('.xterm-accessibility-tree').getByText('COMMANDPANEL', { exact: true }).waitFor();
  await executeCommand('隐藏终端', '100-project-terminal-command-dark.png'); assert.equal(await page.locator('.project-terminal').count(), 0); assert.equal(await page.evaluate(async ({ id, terminalId }) => (await window.qiyao.terminalList(id)).some((terminal) => terminal.id === terminalId && terminal.output.includes('COMMANDPANEL')), { id: projectId, terminalId }), true);
  await executeCommand('显示终端'); await page.locator('.xterm-accessibility-tree').getByText('COMMANDPANEL', { exact: true }).waitFor(); await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.press('Enter'); await waitForBridge(page, async ({ id, terminalId }) => (await window.qiyao.terminalList(id)).some((terminal) => terminal.id === terminalId && terminal.output.slice(terminal.output.lastIndexOf('COMMANDPANEL')).includes('PS ')), { id: projectId, terminalId });
  await executeCommand('隐藏文件树'); await executeCommand('显示审阅面板'); assert.equal(await page.locator('.inspector-toolbar').getByRole('button', { name: '查看改动', exact: true }).getAttribute('aria-pressed'), 'true');
  await openCommand('当前项目'); assert.equal(await palette().getByRole('option', { name: '显示文件树', exact: true }).isDisabled(), true); assert.equal(await palette().getByRole('option', { name: '隐藏终端', exact: true }).isDisabled(), false); assert.equal(await palette().getByRole('option', { name: '隐藏审阅面板', exact: true }).isDisabled(), false); await capture('101-project-review-command-dark.png'); await page.keyboard.press('Escape');
  await executeCommand('隐藏审阅面板'); assert.equal(await tree().count(), 0); await input().waitFor(); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  await page.getByRole('button', { name: '资料库', exact: true }).click(); await openCommand('当前项目'); const unavailable = palette().getByRole('option'); assert.equal(await unavailable.count(), 3); assert.deepEqual(await unavailable.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-disabled'))), ['true', 'true', 'true']); await search().press('Enter'); assert.equal(await palette().isVisible(), true); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '项目', exact: true }).click(); await input().waitFor(); assert.equal(await tree().count(), 0); await page.locator('.xterm-accessibility-tree').getByText('COMMANDPANEL', { exact: true }).waitFor(); await executeCommand('显示文件树'); await item('source/资料/代码.ts').waitFor();
  assert.equal(await readFile(join(root, 'source/资料/代码.ts'), 'utf8'), originalContents);
  verified('native command-palette keyboard actions synchronize file/review/terminal controls, preserve exact dirty editor text and the same live PowerShell process/output, retain panel choices across navigation and disable project actions outside the project page');

  await executeCommand('隐藏终端'); await page.locator('.project-list').getByRole('button', { name: secondName, exact: true }).click(); await item('second.txt').waitFor(); await openCommand('显示终端');
  await application.evaluateMain("globalThis.qiyaoProjectIpc=require('electron').ipcMain;globalThis.qiyaoProjectInvoke=globalThis.qiyaoProjectIpc._invokeHandlers.get('qiyao:invoke');globalThis.qiyaoProjectHold=true;globalThis.qiyaoProjectIpc.removeHandler('qiyao:invoke');globalThis.qiyaoProjectIpc.handle('qiyao:invoke',async(event,command,...args)=>{if(command==='load'&&globalThis.qiyaoProjectHold){globalThis.qiyaoProjectHold=false;globalThis.qiyaoProjectHeld=true;await new Promise(resolve=>{globalThis.qiyaoProjectRelease=resolve;});}return globalThis.qiyaoProjectInvoke(event,command,...args);});");
  try {
    await search().press('Enter'); await waitForMain('globalThis.qiyaoProjectHeld'); await page.evaluate(async (id) => { await window.qiyao.removeProject(id); }, secondId); await application.evaluateMain('globalThis.qiyaoProjectRelease()');
    await palette().getByRole('alert').getByText('This command is no longer available. Refresh the command menu.', { exact: true }).waitFor(); assert.equal(await search().inputValue(), '>显示终端'); assert.equal(await page.locator('.project-terminal').count(), 0);
    await palette().getByRole('button', { name: '刷新命令', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.command-palette input[role="combobox"]')?.disabled === false); assert.equal(await palette().getByRole('option', { name: '显示终端', exact: true }).isDisabled(), true); assert.equal(await page.evaluate(async () => (await window.qiyao.load()).projects.some((project) => project.id === localStorage.getItem('qiyao.project'))), false);
  } finally { await application.evaluateMain("globalThis.qiyaoProjectRelease?.();globalThis.qiyaoProjectIpc.removeHandler('qiyao:invoke');globalThis.qiyaoProjectIpc.handle('qiyao:invoke',globalThis.qiyaoProjectInvoke)"); }
  await page.keyboard.press('Escape'); await page.locator('.project-list').getByRole('button', { name: longName, exact: true }).click(); await item('source/资料/代码.ts').waitFor(); await page.locator('.monaco-editor .view-lines').getByText(/TREE_DRAFT_UNSAVED_名字/).waitFor();
  verified('a project removed through actual IPC while a held load awaits completion invalidates the original palette action, retains its query/error, starts no terminal and becomes disabled on refresh without affecting the other project draft');
  const stickyFolders = await verifyProjectTreeSticky({ page, application, directory, capture, returnProjectName: longName });
  return { page, result: {
    virtualizedRows: { boundedMountedCount: true, allLoadedRowsReachableByScroll: true, rootLoadedCounts: [200, 225], completeSiblingMetadata: true },
    stickyFolders,
    checks: 8, projectCommandChecks: 2, fileSearch: { toolbarLocateVisibleFocus: true, toolbarRefreshRetainsQuery: true, savedFileRefreshesResults: true, limitNoticeVisible, nativePathLookup: true, cappedResultsDisclosed: true, keyboardSelection: true, composingEnterIgnored: true, trailingWhitespacePreserved: true, draftPreserved: true, retryRecovered: true, staleReplyIgnored: true, outsideJunctionExcluded: true, screenshot: '104-project-file-search-light.png' }, treeTypography, treeGeometry, longFileClipping, longPathScreenshot: '103-project-tree-long-path-light.png', treeSelectionStates, rootEntriesBeforeChange: 224, rootEntriesAfterChange: 225, zoomFactors, layout,
    projectSwitcher: { selectedVisibleAtAllZooms: true, fixedAddAction: true, manualWheelBrowsing: true, focusedProjectSurvivesResize: true, settingsKeyboardReturn: true, selectedDraftRetained: true },
    screenshots: ['94-project-tree-pagination-light.png', '95-project-tree-editor-light.png', '96-project-tree-dark-narrow.png', ...zoomFactors.map((zoom) => `97-project-workspace-zoom-${zoom * 100}.png`), '98-project-settings-zoom-150.png', '99-project-file-command-dark.png', '100-project-terminal-command-dark.png', '101-project-review-command-dark.png', '102-project-switcher-dark-narrow.png'],
    screenshotMethod: 'Electron BrowserWindow.capturePage with exact content-size assertions for all zoom and project-command captures',
    scope: 'Real project-directory IPC, revision-bound pagination, scoped Unicode directories/junction exclusion, pointer and native ARIA tree keyboard input, selected-folder file creation/save, persisted editor drafts, keyboard file-tree visibility/cache/focus retention, actual application close/restart and dark minimum-window code/PTY input at 100/125/150 percent zoom. The sidebar stays visible; the file tree is manually hidden at 125/150 percent. Short-height layouts retain the add-project action. The populated long-name/path project dialog at 150 percent preserves complete field values and restores focus after Escape. Overflowing project switches retain the selected row and separate add action across zoom; horizontal wheel browsing stays put, focused project buttons survive resize and Tab/Enter/Escape restore settings focus without changing the selected project or editor draft. PTY output is inspected while an actual Read-Host command awaits Enter, then returned to the project PowerShell prompt. Command-palette actions preserve the same live PTY and dirty editor contents, synchronize toolbar labels, retain choices across page navigation and disable unavailable contexts. An isolated held main-process IPC load proves that actual project removal invalidates an in-flight command. Owned read failures and a delayed directory response use isolated main-process fixtures. Physical folder picker, populated maximum-scale performance, full accessibility, full backup restore and other platforms remain separate checks.',
  } };
}
