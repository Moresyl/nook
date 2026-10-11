import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const runFile = promisify(execFile);
const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
async function git(root, args) { return (await runFile('git', ['--no-pager', '-C', root, ...args], { windowsHide: true, timeout: 30_000, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } })).stdout; }
export async function verifyProjectWorktrees({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  const projectId = randomUUID(), root = join(directory, '工作树源项目'), target = join(directory, '独立 工作树'), existingTarget = join(directory, '已有分支 工作树'), hookTarget = join(directory, '钩子 工作树');
  const projectName = `工作树验证 ${projectId.slice(0, 8)}`, branch = 'feature/中文🧭', registeredName = `独立项目 ${projectId.slice(0, 8)}`;
  const captures = [], layouts = [], initialRequests = modelRequests(); let rowLayout;
  const original = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`), originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const wait = async predicate => { const deadline = Date.now() + 10_000; while (!await predicate()) { assert.ok(Date.now() < deadline, 'The owned worktree fixture did not reach its expected state'); await new Promise(resolve => setTimeout(resolve, 100)); } };
  const exists = async path => Boolean(await stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
  const dialog = () => page.getByRole('dialog', { name: '项目工作树', exact: true });
  const state = () => page.evaluate(() => window.qiyao.load());
  const trees = () => page.evaluate(id => window.qiyao.gitWorktrees(id), projectId);
  async function show() {
    await page.getByRole('button', { name: '查看改动', exact: true }).click(); await page.getByRole('button', { name: '管理项目工作树', exact: true }).click(); await dialog().waitFor();
    await wait(async () => !await dialog().getByRole('button', { name: '刷新工作树列表', exact: true }).isDisabled());
  }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `project-worktrees-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function close() { await dialog().getByRole('button', { name: '关闭', exact: true }).last().click(); await dialog().waitFor({ state: 'hidden' }); }
  async function theme(value) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
    await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(value); await page.waitForFunction(value => document.documentElement.dataset.theme === value, value); await dismissModalWithEscape(page, settings);
  }
  await mkdir(root); await git(root, ['init', '-q', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Nook test'], ['user.email', 'test@localhost'], ['commit.gpgSign', 'false'], ['core.autocrlf', 'false']]) await git(root, ['config', key, value]);
  await writeFile(join(root, 'dirty.ts'), 'export const value = "BASE";\n'); await writeFile(join(root, 'page.html'), '<!doctype html><title>WORKTREE_SOURCE_PREVIEW</title><h1>WORKTREE_SOURCE_PREVIEW</h1>');
  await git(root, ['add', '--', 'dirty.ts', 'page.html']); await git(root, ['commit', '-qm', 'Base']); await git(root, ['branch', 'available']);
  await writeFile(join(root, 'dirty.ts'), 'export const value = "STAGED";\n'); await git(root, ['add', '--', 'dirty.ts']); await writeFile(join(root, 'dirty.ts'), 'export const value = "WORKING";\n'); await writeFile(join(root, 'keep.txt'), 'KEEP_中文🧭');
  await page.evaluate(async ({ projectId, root, projectName }) => window.qiyao.saveProject({ id: projectId, name: projectName, path: root, instructions: 'SOURCE_INSTRUCTIONS', createdAt: Date.now() }), { projectId, root, projectName }); await page.reload();
  await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  const file = page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'dirty.ts', exact: true }); await file.waitFor(); await file.press('Enter');
  const editor = page.locator('.project-main-panel:not([hidden]) .monaco-editor textarea.inputarea'); await editor.waitFor(); await editor.focus(); await editor.press('Control+End'); await page.keyboard.insertText('// UNSAVED_WORKTREE_中文🧭\n');
  await waitForBridge(page, async id => (await window.qiyao.load()).editorDrafts.some(item => item.projectId === id && item.text.includes('UNSAVED_WORKTREE_中文')), projectId);
  const draft = (await state()).editorDrafts.find(item => item.projectId === projectId), sourceStatus = await page.evaluate(id => window.qiyao.gitStatus(id), projectId), index = await readFile(join(root, '.git/index'));
  await page.evaluate(() => window.qiyao.openQuickChat()); let quick;
  await wait(async () => { quick = page.context().pages().find(candidate => !candidate.isClosed() && candidate.url().includes('view=quick-chat')); return Boolean(quick); });
  quick.setDefaultTimeout(5000); await waitForBridge(quick, () => typeof window.nookQuick?.load === 'function');
  assert.deepEqual(await quick.evaluate(() => [typeof window.nookQuick.gitWorktrees, typeof window.nookQuick.gitCreateWorktree]), ['undefined', 'undefined']);
  await quick.locator('.quick-chat-shell').hover(); await quick.getByRole('button', { name: '隐藏快速聊天', exact: true }).click();
  await wait(() => application.evaluateMain("!require('electron').BrowserWindow.getAllWindows().find(window=>new URL(window.webContents.getURL()).searchParams.get('view')==='quick-chat').isVisible()")); await application.evaluateMain(`${mainWindow}.focus()`);
  await show(); assert.equal((await trees()).length, 1); assert.equal(await dialog().getByRole('button', { name: '创建工作树', exact: true }).isDisabled(), true);
  await dialog().getByLabel('工作树分支', { exact: true }).fill('main'); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(target); await dialog().getByRole('alert').getByText('分支已存在', { exact: true }).waitFor();
  await dialog().getByLabel('工作树分支', { exact: true }).fill('bad..name'); await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await dialog().getByRole('alert').getByText('分支名称无效，请修改后重试。', { exact: true }).waitFor();
  await dialog().getByLabel('工作树分支', { exact: true }).fill(branch); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(join(root, 'nested')); await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await dialog().getByRole('alert').getByText('请选择现有工作树之外的文件夹。', { exact: true }).waitFor();
  await mkdir(target); await writeFile(join(target, 'sentinel'), 'KEEP_TARGET'); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(target); await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await dialog().getByRole('alert').getByText('目标文件夹已存在，请选择新的文件夹。', { exact: true }).waitFor();
  assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'KEEP_TARGET'); assert.deepEqual(await page.evaluate(id => window.qiyao.gitStatus(id), projectId), sourceStatus); await capture('validation'); await rm(target, { recursive: true });
  verified('main-only worktree bridge lists the real repository; invalid/duplicate refs, nested and occupied destinations retain source state and existing bytes without exposing a Quick Chat capability');

  const hook = join(root, '.git/hooks/post-checkout'), gate = join(root, '.git/nook-worktree-release');
  await writeFile(hook, '#!/bin/sh\ncommon=$(git rev-parse --git-common-dir)\n: > "$common/nook-worktree-started"\nattempt=0\nwhile [ ! -f "$common/nook-worktree-release" ] && [ "$attempt" -lt 100 ]; do\n sleep 0.05\n attempt=$((attempt + 1))\ndone\n: > "$common/nook-worktree-ended"\n[ -f "$common/nook-worktree-release" ]\n'); await chmod(hook, 0o755);
  try {
    await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await wait(() => exists(join(root, '.git/nook-worktree-started')));
    assert.equal(await dialog().getByLabel('工作树分支', { exact: true }).isDisabled(), true); assert.equal(await dialog().getByRole('button', { name: '关闭', exact: true }).first().isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await dialog().isVisible(), true); await capture('busy');
  } finally { await writeFile(gate, 'release'); await wait(() => exists(join(root, '.git/nook-worktree-ended'))); }
  await dialog().getByLabel('工作树项目名称', { exact: true }).waitFor(); await rm(hook);
  assert.equal(await readFile(join(target, 'dirty.ts'), 'utf8'), 'export const value = "BASE";\n'); assert.deepEqual(await page.evaluate(id => window.qiyao.gitStatus(id), projectId), sourceStatus); assert.deepEqual(await readFile(join(root, '.git/index')), index); assert.deepEqual((await state()).editorDrafts.find(item => item.projectId === projectId), draft);
  assert.equal((await state()).projects.some(item => item.path.replaceAll('\\', '/') === target.replaceAll('\\', '/')), false);
  verified('held native post-checkout prevents duplicate submission, input changes and Escape; actual new tree uses committed content while source HEAD/index/working files and exact editor draft stay unchanged and no project is implicitly saved');

  await dialog().getByLabel('工作树项目名称', { exact: true }).fill(registeredName); const workspaceBytes = await readFile(join(directory, 'workspace.json'));
  await application.evaluateMain("globalThis.nookWorktreeRename=require('node:fs/promises').rename;require('node:fs/promises').rename=async(from,to)=>{if(String(to).endsWith('workspace.json'))throw Object.assign(new Error('PRIVATE_WORKTREE_SAVE_FAILURE'),{code:'EIO'});return globalThis.nookWorktreeRename(from,to);};");
  try {
    await dialog().getByRole('button', { name: '添加为项目', exact: true }).click(); await dialog().getByRole('alert').getByText('工作树已保留，但项目登记未能保存。请重试“添加为项目”，无需重新创建。', { exact: true }).waitFor();
    assert.deepEqual(await readFile(join(directory, 'workspace.json')), workspaceBytes); assert.equal((await trees()).length, 2); assert.equal(await dialog().getByLabel('工作树项目名称', { exact: true }).inputValue(), registeredName); assert.equal((await dialog().innerText()).includes('PRIVATE_WORKTREE_SAVE_FAILURE'), false); await capture('registration-retry');
  } finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.nookWorktreeRename;delete globalThis.nookWorktreeRename;"); }
  await dialog().getByRole('button', { name: '添加为项目', exact: true }).click(); await dialog().getByRole('button', { name: '打开项目', exact: true }).waitFor();
  const registered = (await state()).projects.find(item => item.name === registeredName); assert.ok(registered); assert.notEqual(registered.id, projectId); assert.equal(registered.instructions, ''); assert.equal((await trees()).length, 2);
  rowLayout = await dialog().locator('.worktree-row').evaluate(element => ({ gap: getComputedStyle(element).gap, padding: getComputedStyle(element).padding, titleSize: getComputedStyle(element.querySelector('.worktree-title')).fontSize, titleWeight: getComputedStyle(element.querySelector('.worktree-title')).fontWeight, pathSize: getComputedStyle(element.querySelector('.path-text')).fontSize }));
  assert.deepEqual(rowLayout, { gap: '8px', padding: '12px', titleSize: '14px', titleWeight: '500', pathSize: '12px' }); await capture('created');
  await dialog().getByRole('button', { name: '打开项目', exact: true }).click(); await page.locator('.section-heading h3').getByText(registeredName, { exact: true }).waitFor();
  assert.equal((await page.evaluate(id => window.qiyao.gitStatus(id), registered.id)).branch, branch); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  verified('atomic project-save EIO preserves exact vault bytes and the completed worktree/result; retry registers one independent project and opens its real branch without repeating creation or copying source instructions');

  await show(); await dialog().getByRole('button', { name: '已有分支', exact: true }).click();
  const options = await dialog().getByLabel('工作树分支', { exact: true }).locator('option').allTextContents(); assert.ok(options.includes('available')); assert.ok(!options.includes('main')); assert.ok(!options.includes(branch));
  await dialog().getByLabel('工作树分支', { exact: true }).selectOption('available'); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(existingTarget); await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await dialog().getByLabel('工作树项目名称', { exact: true }).waitFor();
  assert.equal((await git(existingTarget, ['branch', '--show-current'])).trim(), 'available'); assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'main'); await close();
  await show(); await dialog().getByText('已有工作树 · 3', { exact: true }).click(); const row = dialog().locator('.worktree-row').filter({ hasText: branch }); await row.getByRole('button', { name: '查看', exact: true }).click(); assert.equal(await dialog().getByRole('button', { name: '添加为项目', exact: true }).count(), 0); await dialog().getByRole('button', { name: '打开项目', exact: true }).waitFor(); await close();
  verified('existing-branch UI offers only free local refs and preserves source HEAD; listed registered worktrees can be reused without duplicate project creation');

  await page.getByRole('button', { name: '文件', exact: true }).click(); await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'page.html', exact: true }).press('Enter'); await page.getByRole('button', { name: '预览 HTML', exact: true }).waitFor();
  const beforeWindows = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().map(window=>window.id)"); await page.getByRole('button', { name: '预览 HTML', exact: true }).click(); let previewId;
  await wait(async () => { previewId = (await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().map(window=>window.id)")).find(id => !beforeWindows.includes(id)); return previewId !== undefined; }); await application.evaluateMain(`${mainWindow}.focus()`);
  await writeFile(hook, '#!/bin/sh\necho PRIVATE_WORKTREE_HOOK >&2\nexit 1\n'); await chmod(hook, 0o755);
  await show(); await dialog().getByLabel('工作树分支', { exact: true }).fill('hook-branch'); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(hookTarget); await dialog().getByRole('button', { name: '创建工作树', exact: true }).click(); await dialog().getByLabel('工作树项目名称', { exact: true }).waitFor();
  await dialog().getByRole('status').getByText('工作树已创建，但 Git 钩子报告错误或更新了分支。上方显示实际分支，请检查后再使用。', { exact: true }).waitFor(); assert.equal((await dialog().innerText()).includes('PRIVATE_WORKTREE_HOOK'), false);
  assert.equal(await application.evaluateMain(`Boolean(require('electron').BrowserWindow.fromId(${previewId}))`), true); assert.equal((await git(hookTarget, ['branch', '--show-current'])).trim(), 'hook-branch'); assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'main'); await capture('hook-warning'); await rm(hook); await close();
  await application.evaluateMain(`require('electron').BrowserWindow.fromId(${previewId}).close()`);
  verified('failing real post-checkout reports the actual completed tree with a sanitized warning and retains source floating preview because the source branch did not change');

  for (const targetTheme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await theme(targetTheme); const size = targetTheme === 'light' ? [1280, 840] : [760, 540]; await application.resize(...size); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction(width => Math.abs(innerWidth - width) < 2, size[0] / zoom);
    await show(); await dialog().getByLabel('工作树分支', { exact: true }).fill(`feature/${'完整中文分支'.repeat(7)}`); await dialog().getByLabel('工作树文件夹', { exact: true }).fill(join(directory, '中文长路径'.repeat(12)));
    await dialog().locator('.modal-content').evaluate(element => { element.scrollTop = 0; });
    const geometry = await dialog().evaluate(element => {
      const rect = element.getBoundingClientRect(), content = element.querySelector('.modal-content'), form = element.querySelector('.worktree-form'), style = getComputedStyle(form);
      const controls = [...element.querySelectorAll('.modal-header button,.modal-footer button')].map(control => { const r = control.getBoundingClientRect(); return { width: r.width, height: r.height, contentFits: control.scrollWidth <= control.clientWidth, visible: r.left >= 0 && r.top >= rect.top && r.right <= innerWidth && r.bottom <= Math.min(innerHeight, rect.bottom) }; });
      return { viewport: { width: innerWidth, height: innerHeight }, dialog: rect.toJSON(), controls, overflow: document.documentElement.scrollWidth > innerWidth, fieldPadding: style.padding, fieldGap: style.gap, fieldBackground: getComputedStyle(form.querySelector('input')).backgroundColor, contentScrollable: content.scrollHeight > content.clientHeight };
    });
    assert.equal(geometry.overflow, false); assert.ok(geometry.dialog.left >= 0 && geometry.dialog.top >= 0 && geometry.dialog.right <= geometry.viewport.width && geometry.dialog.bottom <= geometry.viewport.height); assert.ok(geometry.controls.every(control => control.visible && control.contentFits && control.width > 0 && control.height >= 20));
    if (geometry.viewport.width < 768) assert.equal(geometry.dialog.height, geometry.viewport.height, 'Narrow worktree dialogs must use the full reference viewport height');
    assert.equal(geometry.fieldPadding, '8px 12px 0px'); assert.equal(geometry.fieldGap, '4px'); assert.equal(geometry.fieldBackground, 'rgba(0, 0, 0, 0)');
    const fields = [];
    for (const label of ['工作树分支', '起始版本', '工作树文件夹']) {
      const control = dialog().getByLabel(label, { exact: true }); await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
      const bounds = await control.evaluate(element => { const r = element.getBoundingClientRect(), c = element.closest('.modal-content').getBoundingClientRect(); return { control: r.toJSON(), content: c.toJSON(), viewport: { width: innerWidth, height: innerHeight }, reachable: r.top >= c.top && r.bottom <= c.bottom && r.left >= 0 && r.right <= innerWidth && r.width > 0 }; });
      assert.equal(bounds.reachable, true, JSON.stringify({ label, theme: targetTheme, zoom, ...bounds }));
      fields.push({ label, ...bounds });
    }
    layouts.push({ theme: targetTheme, zoom, requestedSize: size, fields, ...geometry }); await dialog().locator('.modal-content').evaluate(element => { element.scrollTop = 0; }); await capture(`${targetTheme}-${zoom * 100}`); await dismissModalWithEscape(page, dialog()); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '管理项目工作树');
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${original.zoom})`); await application.resize(...original.size); await theme(originalTheme);
  verified('shared reference-backed form spacing and transparent inputs fit six light/dark native zoom cases; header/footer stay visible, all fields are scroll-reachable and Escape restores the worktree trigger');

  page = await restart(); application = getApplication(); await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: projectName, exact: true }).click();
  await page.getByRole('tab', { name: 'dirty.ts 未保存', exact: true }).click(); await page.locator('.project-main-panel:not([hidden]) .monaco-editor .view-lines').getByText(/UNSAVED_WORKTREE_中文/).waitFor();
  assert.deepEqual((await state()).editorDrafts.find(item => item.projectId === projectId), draft); assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'KEEP_中文🧭'); assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'main'); assert.equal((await trees()).length, 4);
  assert.deepEqual((await state()).projects.find(item => item.id === registered.id), registered); await page.locator('.project-list').getByRole('button', { name: registeredName, exact: true }).click(); assert.equal((await page.evaluate(id => window.qiyao.gitStatus(id), registered.id)).branch, branch); assert.equal(modelRequests(), initialRequests); await capture('restart');
  verified('normal native restart retains all real worktrees, one independent registered project, source dirty editor baseline and untracked bytes with zero model requests');
  return { page, result: { checks: 7, modelRequests: modelRequests() - initialRequests, bridgeValidationVerified: true, creationBusySourcePreservationVerified: true, registrationRetryVerified: true, existingBranchReuseVerified: true, hookSourcePreviewVerified: true, referenceZoomKeyboardVerified: true, restartDraftsVerified: true, rowLayout, layouts, screenshots: captures, scope: 'Real Git repositories/worktrees/hooks and native main/Quick bridges, Monaco, atomic project-save EIO and restart; fixed display scale and scripted input. Worktree deletion/pruning, managed roots, task orchestration, broader accessibility and complete reference parity remain separate gates.' } };
}
