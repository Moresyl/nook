import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { verifyProjectBranchActions, verifyProjectBranchActionLayouts } from './verify-project-branch-actions.mjs';

const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
const nativeChildren = `${mainWindow}.contentView.children.filter(view=>view.webContents&&!view.webContents.isDestroyed())`;
function runGit(root, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['--no-pager', '-C', root, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } }, (error, stdout) => error ? reject(error) : resolve(stdout));
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function verifyProjectBranches({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  const initialRequests = modelRequests(), projectId = randomUUID(), otherId = randomUUID();
  const root = join(directory, '分支项目'), other = join(directory, '另一个分支项目'), linked = join(directory, '关联工作树');
  const projectName = `分支验证 ${projectId.slice(0, 8)}`, otherName = `空仓库 ${otherId.slice(0, 8)}`, target = 'feature/分支🧭', longBranch = `feature/${'保留完整中文分支'.repeat(6)}`;
  const original = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`), originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const captures = [], layouts = [];
  const wait = async predicate => { const deadline = Date.now() + 10_000; while (!await predicate()) { assert.ok(Date.now() < deadline, 'The owned branch fixture did not reach its expected state'); await new Promise(resolve => setTimeout(resolve, 100)); } };
  const exists = async path => Boolean(await stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
  const dialog = () => page.getByRole('dialog', { name: '项目分支', exact: true });
  const status = () => page.evaluate(id => window.qiyao.gitStatus(id), projectId);
  const tree = () => page.getByRole('tree', { name: '项目文件', exact: true });
  const item = path => tree().getByRole('treeitem', { name: path, exact: true });
  const editor = () => page.locator('.project-main-panel:not([hidden]) .monaco-editor textarea.inputarea');
  const lines = () => page.locator('.project-main-panel:not([hidden]) .monaco-editor .view-lines');
  async function files() { await page.getByRole('button', { name: '文件', exact: true }).click(); }
  async function openFile(path) { await files(); await item(path).waitFor(); await item(path).press('Enter'); await page.locator('.editor-actionbar .path-text').getByText(path, { exact: true }).waitFor(); await editor().waitFor(); }
  async function branches() { await page.getByRole('button', { name: '查看改动', exact: true }).click(); await page.getByRole('button', { name: '管理项目分支', exact: true }).click(); await dialog().waitFor(); await dialog().getByRole('button', { name: '刷新分支列表', exact: true }).waitFor(); await wait(async () => !await dialog().getByRole('button', { name: '刷新分支列表', exact: true }).isDisabled()); }
  async function choose(name) { await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(name); await dialog().getByRole('button', { name, exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await dialog().isVisible()) {
      assert.ok(await dialog().evaluate(element => [...element.querySelectorAll('button')].every(button => button.scrollWidth <= button.clientWidth)), 'Branch dialog button contents must fit their controls');
      assert.ok(await dialog().evaluate(element => [...element.querySelectorAll('.branch-name')].every(name => name.getBoundingClientRect().width > 0)), 'Listed branch names must remain visible');
    }
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `project-branches-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function theme(value) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
    await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(value); await page.waitForFunction(value => document.documentElement.dataset.theme === value, value); await dismissModalWithEscape(page, settings);
  }
  for (const path of [root, other]) {
    await mkdir(path); await runGit(path, ['init', '-q', '-b', 'main']);
    for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@localhost'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', '.git/hooks']]) await runGit(path, ['config', key, value]);
  }
  for (const [path, text] of [['clean.ts', 'export const clean = "CLEAN_A";\n'], ['dirty.ts', 'export const dirty = "DIRTY_A";\n'], ['vanishing.ts', 'VANISHING_A\n'], ['collision.txt', 'COLLISION_A\n'], ['base-only.txt', 'BASE_ONLY\n'], ['page.html', '<!doctype html><title>BRANCH_PAGE_A</title><h1>BRANCH_PAGE_A</h1>']]) await writeFile(join(root, path), text);
  await runGit(root, ['add', '--', 'clean.ts', 'dirty.ts', 'vanishing.ts', 'collision.txt', 'base-only.txt', 'page.html']); await runGit(root, ['commit', '-qm', 'Base']);
  const baseCommit = (await runGit(root, ['rev-parse', 'HEAD'])).trim(); assert.match(baseCommit, /^[a-f0-9]{40,64}$/);
  await runGit(root, ['switch', '-qc', target]);
  for (const [path, text] of [['clean.ts', 'export const clean = "CLEAN_B";\n'], ['dirty.ts', 'export const dirty = "DIRTY_B";\n'], ['collision.txt', 'COLLISION_B\n'], ['branch-only.txt', 'BRANCH_ONLY\n'], ['page.html', '<!doctype html><title>BRANCH_PAGE_B</title><h1>BRANCH_PAGE_B</h1>']]) await writeFile(join(root, path), text);
  await rm(join(root, 'base-only.txt')); await rm(join(root, 'vanishing.ts')); await runGit(root, ['add', '--', 'clean.ts', 'dirty.ts', 'collision.txt', 'branch-only.txt', 'base-only.txt', 'vanishing.ts', 'page.html']); await runGit(root, ['commit', '-qm', 'Target']); await runGit(root, ['switch', '-q', 'main']);
  const refs = [longBranch, 'occupied', ...Array.from({ length: 215 }, (_, index) => `list/${String(index).padStart(4, '0')}`)];
  await runGit(root, ['update-ref', '--stdin'], refs.map(name => `create refs/heads/${name} ${baseCommit}\n`).join('')); await runGit(root, ['worktree', 'add', '--quiet', linked, 'occupied']);
  await writeFile(join(root, 'keep-untracked.txt'), 'KEEP_UNTRACKED_中文🧭');
  await page.evaluate(async ({ projectId, otherId, root, other, projectName, otherName }) => {
    await window.qiyao.saveProject({ id: projectId, name: projectName, path: root, instructions: '', createdAt: Date.now() }); await window.qiyao.saveProject({ id: otherId, name: otherName, path: other, instructions: '', createdAt: Date.now() });
  }, { projectId, otherId, root, other, projectName, otherName });
  await page.reload();
  await page.locator('.primary-nav').getByRole('button', { name: /^新聊天/ }).click(); const previousDraft = await page.getByLabel('消息', { exact: true }).inputValue(), chatDraft = previousDraft || '分支操作期间保留的聊天草稿 中文🧭';
  if (!previousDraft) await page.getByLabel('消息', { exact: true }).fill(chatDraft);
  await waitForBridge(page, async text => (await window.qiyao.load()).composerDrafts.some(item => !item.threadId && item.text === text), chatDraft);
  await page.evaluate(() => window.qiyao.openQuickChat());
  let quick;
  await wait(async () => { quick = page.context().pages().find(candidate => !candidate.isClosed() && candidate.url().includes('view=quick-chat')); return Boolean(quick); });
  quick.setDefaultTimeout(5000); quick.setDefaultNavigationTimeout(5000);
  await waitForBridge(quick, () => typeof window.nookQuick?.load === 'function');
  assert.equal(await quick.evaluate(() => window.qiyao), undefined);
  assert.deepEqual(await quick.evaluate(() => [typeof window.nookQuick.gitBranches, typeof window.nookQuick.gitSwitchBranch, typeof window.nookQuick.gitCreateBranch, typeof window.nookQuick.gitRenameBranch, typeof window.nookQuick.gitDeleteBranch]), Array(5).fill('undefined'));
  await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  await theme('light'); await branches(); assert.equal(await dialog().locator('.branch-row').count(), 219);
  await dialog().getByLabel('查找分支', { exact: true }).fill('list/0214'); assert.equal(await dialog().locator('.branch-row').count(), 1); await dialog().getByRole('button', { name: 'list/0214', exact: true }).waitFor(); await capture('search'); await dismissModalWithEscape(page, dialog());
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '管理项目分支');
  verified('complete local branch listing includes 219 refs, literal Unicode and the last of 215 numbered branches; search and Escape restore trigger focus while Quick Chat exposes no branch mutation bridge');

  await branches(); await dialog().getByRole('button', { name: '新建分支', exact: true }).click(); const field = () => dialog().getByLabel('新分支名称', { exact: true });
  await field().fill('bad..name'); await dialog().getByRole('button', { name: '创建并切换', exact: true }).click(); await dialog().getByRole('alert').getByText('分支名称无效，请修改后重试。', { exact: true }).waitFor(); assert.equal(await field().inputValue(), 'bad..name'); await capture('invalid');
  await field().fill('main'); await dialog().getByRole('alert').getByText('分支已存在', { exact: true }).waitFor(); assert.equal(await dialog().getByRole('button', { name: '创建并切换', exact: true }).isDisabled(), true);
  const created = 'feature/界面🧭', hook = join(root, '.git/hooks/post-checkout'), gate = join(root, '.git/nook-hook-release');
  await writeFile(hook, '#!/bin/sh\n: > .git/nook-hook-started\nattempt=0\nwhile [ ! -f .git/nook-hook-release ] && [ "$attempt" -lt 100 ]; do\n sleep 0.05\n attempt=$((attempt + 1))\ndone\n: > .git/nook-hook-ended\n[ -f .git/nook-hook-release ]\n'); await chmod(hook, 0o755);
  try {
    await field().fill(created); await field().press('Enter'); await wait(() => exists(join(root, '.git/nook-hook-started')));
    assert.equal(await field().isDisabled(), true); assert.equal(await dialog().getByRole('button', { name: '关闭', exact: true }).isDisabled(), true); assert.equal(await dialog().getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
    await page.mouse.move(1, 1); await page.keyboard.press('Escape'); assert.equal(await dialog().isVisible(), true); await capture('busy');
  } finally { await writeFile(gate, 'release'); await wait(() => exists(join(root, '.git/nook-hook-ended'))); }
  await dialog().waitFor({ state: 'hidden' }); assert.equal((await status()).branch, created); await rm(hook);
  verified('real creation retains invalid input, prevents duplicate refs, accepts an Enter-created Unicode branch and locks inputs/cancel/Escape while the owned post-checkout hook is still pending');

  await openFile('clean.ts'); await openFile('vanishing.ts'); await openFile('dirty.ts'); await editor().focus(); await editor().press('Control+End'); await page.keyboard.insertText('// UNSAVED_BRANCH_中文🧭\n');
  await waitForBridge(page, async id => (await window.qiyao.load()).editorDrafts.some(item => item.projectId === id && item.path === 'dirty.ts' && item.text.includes('UNSAVED_BRANCH_中文🧭')), projectId);
  const dirtyDraft = (await page.evaluate(() => window.qiyao.load())).editorDrafts.find(item => item.projectId === projectId && item.path === 'dirty.ts'); assert.ok(dirtyDraft);
  await writeFile(join(root, 'collision.txt'), 'DO_NOT_OVERWRITE_中文🧭'); await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(target); await dialog().getByRole('button', { name: target, exact: true }).click();
  await dialog().getByRole('alert').waitFor(); assert.equal((await status()).branch, created); assert.equal(await readFile(join(root, 'collision.txt'), 'utf8'), 'DO_NOT_OVERWRITE_中文🧭'); assert.equal(await dialog().getByLabel('查找分支', { exact: true }).inputValue(), target); await capture('overwrite-error');
  await writeFile(join(root, 'collision.txt'), 'COLLISION_A\n'); await dialog().getByRole('button', { name: target, exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); assert.equal((await status()).branch, target); assert.equal(await readFile(join(root, 'keep-untracked.txt'), 'utf8'), 'KEEP_UNTRACKED_中文🧭');
  verified('a real overwriting switch is refused without changing HEAD or collision bytes; resolving the owned file permits retry and retains the unrelated untracked file');

  await files(); await page.getByRole('tab', { name: 'clean.ts', exact: true }).click(); await lines().getByText(/CLEAN_B/).waitFor(); await item('branch-only.txt').waitFor(); assert.equal(await item('base-only.txt').count(), 0);
  await page.getByRole('tab', { name: 'vanishing.ts', exact: true }).click(); await lines().getByText('VANISHING_A', { exact: true }).waitFor(); await page.getByRole('status').getByText(/新分支中有文件无法读取/).waitFor();
  await page.getByRole('tab', { name: 'dirty.ts 未保存', exact: true }).click(); await lines().getByText(/UNSAVED_BRANCH_中文/).waitFor(); assert.deepEqual((await page.evaluate(() => window.qiyao.load())).editorDrafts.find(item => item.projectId === projectId && item.path === 'dirty.ts'), dirtyDraft);
  await editor().focus(); await editor().press('Control+s'); const conflict = page.getByRole('dialog', { name: '文件已被其他操作修改', exact: true }); await conflict.waitFor(); await conflict.getByText(/确认内容后再次保存/).waitFor(); await capture('draft-conflict');
  assert.equal(await readFile(join(root, 'dirty.ts'), 'utf8'), 'export const dirty = "DIRTY_B";\n'); await conflict.getByRole('button', { name: '继续编辑', exact: true }).click(); await conflict.waitFor({ state: 'hidden' });
  verified('switching refreshes real clean Monaco contents and the file tree, retains unreadable clean tabs and the exact unsaved draft/baseline, and existing conflict comparison prevents overwriting the new branch file');

  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill('occupied'); assert.equal(await dialog().getByRole('button', { name: 'occupied', exact: true }).isDisabled(), true); await dialog().getByText('其他工作树', { exact: true }).waitFor();
  await assert.rejects(page.evaluate(id => window.qiyao.gitSwitchBranch(id, 'occupied'), projectId), /another worktree/); await assert.rejects(page.evaluate(() => window.qiyao.gitBranches('missing-project'))); await dismissModalWithEscape(page, dialog());
  await page.locator('.project-list').getByRole('button', { name: otherName, exact: true }).click(); await branches(); await dialog().getByRole('button', { name: '新建分支', exact: true }).click(); await field().fill('功能/初始🧭'); await dialog().getByRole('button', { name: '创建并切换', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  assert.equal((await page.evaluate(id => window.qiyao.gitStatus(id), otherId)).unborn, true); assert.equal((await page.evaluate(id => window.qiyao.gitStatus(id), otherId)).branch, '功能/初始🧭'); assert.equal((await status()).branch, target);
  await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  verified('an occupied worktree branch is visibly unavailable and native mutation is rejected; unknown projects fail and creating an unborn branch in another project leaves the original project branch/draft intact');

  await openFile('page.html'); const beforeViews = await application.evaluateMain(`${nativeChildren}.map(view=>view.webContents.id)`); await page.getByRole('button', { name: '并排预览', exact: true }).click();
  let dockId; await wait(async () => { const ids = await application.evaluateMain(`${nativeChildren}.map(view=>view.webContents.id)`); dockId = ids.find(id => !beforeViews.includes(id)); return dockId !== undefined; });
  const beforeWindows = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().map(window=>window.id)"); await page.getByRole('button', { name: '预览 HTML', exact: true }).click(); let previewId;
  await wait(async () => { const ids = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().map(window=>window.id)"); previewId = ids.find(id => !beforeWindows.includes(id)); return previewId !== undefined; });
  await application.evaluateMain(`${mainWindow}.focus()`); await writeFile(hook, '#!/bin/sh\necho PRIVATE_HOOK_OUTPUT >&2\nexit 1\n'); await chmod(hook, 0o755);
  await branches(); await dialog().getByRole('button', { name: '新建分支', exact: true }).click(); await field().fill('hook-验证'); await dialog().getByRole('button', { name: '创建并切换', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  assert.equal((await status()).branch, 'hook-验证'); await page.getByRole('status').getByText('分支已更新，但 Git 后续步骤报告错误。请检查仓库与钩子。', { exact: true }).waitFor();
  await wait(() => application.evaluateMain(`!require('electron').BrowserWindow.fromId(${previewId})&&${nativeChildren}.every(view=>view.webContents.id!==${dockId})`));
  assert.equal((await page.locator('body').innerText()).includes('PRIVATE_HOOK_OUTPUT'), false); await rm(hook); await capture('hook-warning');
  verified('a real failing post-checkout hook reports the already changed HEAD with a sanitized warning, refreshes the workbench and releases both owned floating and docked previews');

  const actions = await verifyProjectBranchActions({ page, projectId, root, branches, dialog, status, runGit, capture, dirtyDraft, verified });
  await choose(longBranch);
  const actionLayouts = [];
  for (const targetTheme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await theme(targetTheme); const size = targetTheme === 'light' ? [1280, 840] : [760, 540]; await application.resize(...size); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction(width => Math.abs(innerWidth - width) < 2, size[0] / zoom);
    await branches(); await dialog().getByRole('button', { name: '新建分支', exact: true }).click(); await field().fill(`feature/${'输入新分支名称'.repeat(6)}`);
    const geometry = await dialog().evaluate(element => {
      const viewport = { width: innerWidth, height: innerHeight }, rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('input,button')].map(control => { const r = control.getBoundingClientRect(); return { name: control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') && document.getElementById(control.getAttribute('aria-labelledby'))?.textContent || control.textContent, width: r.width, height: r.height, contentFits: control.tagName === 'INPUT' || control.scrollWidth <= control.clientWidth, visible: r.left >= 0 && r.top >= rect.top && r.right <= innerWidth && r.bottom <= Math.min(innerHeight, rect.bottom) }; });
      const wrapper = element.querySelector('.branch-create'), style = getComputedStyle(wrapper), inputStyle = getComputedStyle(wrapper.querySelector('input'));
      return { viewport, dialog: rect.toJSON(), controls, overflow: document.documentElement.scrollWidth > innerWidth, fieldPadding: style.padding, fieldGap: style.gap, fieldBackground: inputStyle.backgroundColor };
    });
    assert.equal(geometry.overflow, false); assert.ok(geometry.dialog.left >= 0 && geometry.dialog.top >= 0 && geometry.dialog.right <= geometry.viewport.width && geometry.dialog.bottom <= geometry.viewport.height);
    assert.ok(geometry.controls.every(control => control.visible && control.contentFits && control.width > 0 && control.height >= 20)); assert.equal(geometry.fieldPadding, '8px 12px 0px'); assert.equal(geometry.fieldGap, '4px'); assert.equal(geometry.fieldBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(await field().evaluate(element => element === document.activeElement), true); layouts.push({ theme: targetTheme, zoom, requestedSize: size, ...geometry }); await capture(`${targetTheme}-${zoom * 100}`); await dismissModalWithEscape(page, dialog());
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '管理项目分支');
    await verifyProjectBranchActionLayouts({ page, branches, dialog, longBranch, capture, theme: targetTheme, zoom, layouts: actionLayouts });
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${original.zoom})`); await application.resize(...original.size); await theme(originalTheme);
  verified('new branch fields adopt the current reference autofocus, accessible name, duplicate/disabled states and 4px/12px/8px spacing; all dialog controls fit six light/dark zoom cases and Escape restores trigger focus');

  page = await restart(); application = getApplication(); await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  assert.equal((await status()).branch, longBranch); await page.getByRole('tab', { name: 'dirty.ts 未保存', exact: true }).click(); await lines().getByText(/UNSAVED_BRANCH_中文/).waitFor();
  assert.deepEqual((await page.evaluate(() => window.qiyao.load())).editorDrafts.find(item => item.projectId === projectId && item.path === 'dirty.ts'), dirtyDraft); assert.equal(await readFile(join(root, 'keep-untracked.txt'), 'utf8'), 'KEEP_UNTRACKED_中文🧭'); await capture('restart');
  await page.locator('.primary-nav').getByRole('button', { name: /^新聊天/ }).click(); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), chatDraft); assert.equal(modelRequests(), initialRequests);
  verified('normal application restart retains the actual selected Git branch, exact dirty editor draft/baseline, unrelated file and chat draft without sending model requests');
  return { page, result: { checks: 8 + actions.checks, modelRequests: modelRequests() - initialRequests, localListSearchVerified: true, creationValidationBusyVerified: true, overwriteRetryVerified: true, editorRefreshDraftConflictVerified: true, worktreeProjectScopeVerified: true, hookStatePreviewCleanupVerified: true, referenceZoomKeyboardVerified: true, restartDraftsVerified: true, actions, actionLayouts, layouts, screenshots: captures, scope: 'Real local Git, refs, worktree, hooks, renderer/bridge and Monaco; owned fixtures and scripted input at fixed display scale. Local branch creation/switch/rename/merged-only deletion; remote credentials, physical input, accessibility, full reference design and final distribution remain pending.' } };
}
