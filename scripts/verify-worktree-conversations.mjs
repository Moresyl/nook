import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const runFile = promisify(execFile);
const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
async function git(root, args) { return (await runFile('git', ['--no-pager', '-C', root, ...args], { windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout; }

export async function verifyWorktreeConversations({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: state.preferences.theme === 'light' ? 'dark' : 'light' }); await window.qiyao.savePreferences(state.preferences); });
  const primary = join(directory, 'workspace.json'), originalBytes = await readFile(primary), originalState = JSON.parse(originalBytes);
  const originalWindow = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const source = join(directory, '会话 源项目'), child = join(directory, '会话 中文工作树'), relocated = join(directory, '变更后 项目');
  const makeProject = (name, path) => ({ id: randomUUID(), name, path, instructions: '', createdAt: Date.now() });
  const sourceProject = makeProject('会话源项目', source), childProject = makeProject('会话工作树', child), projects = [sourceProject, childProject];
  const makeThread = (title, projectId, extra = {}) => ({ id: randomUUID(), title, projectId, model: '', pinned: false, archived: false, createdAt: 1, updatedAt: 2, messages: [], ...extra });
  const sourceChat = makeThread('源项目原会话', sourceProject.id), archived = makeThread(`归档会话 · ${'保留中文标题'.repeat(15)}`, childProject.id, { pinned: true, archived: true });
  const attachment = { id: randomUUID(), name: '保留附件.txt', content: 'EXACT_ATTACHMENT_KEEP\n', source: { format: 'text', bytes: 22 } };
  const draft = (text, projectId, threadId) => ({ threadId, text, projectId, model: '', mode: 'chat', attachments: [attachment], mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 2 });
  const sourceDraft = draft('SOURCE_DRAFT_KEEP', sourceProject.id, sourceChat.id), archiveDraft = draft('ARCHIVED_DRAFT_KEEP', childProject.id, archived.id), newDraft = draft('NEW_DRAFT_KEEP', sourceProject.id);
  const captures = [], layouts = [], keyboardLayouts = [], requestsBefore = modelRequests();
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const overview = () => settings().getByRole('region', { name: '已登记项目的工作树', exact: true });
  const childRow = () => overview().locator('.worktree-row').filter({ has: page.getByText('feature/会话', { exact: true }) });
  const linkedChat = () => childRow().getByRole('button', { name: archived.title, exact: true });
  const input = () => page.getByLabel('消息', { exact: true });
  const state = () => page.evaluate(() => window.qiyao.load());
  async function open() {
    await page.keyboard.press('Control+,'); await settings().waitFor(); await settings().getByRole('button', { name: '工作树', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await waitForBridge(page, () => document.querySelector('.worktree-overview')?.getAttribute('aria-busy') === 'false');
    await childRow().locator('summary').click();
  }
  async function close() { await dismissModalWithEscape(page, settings()); }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `worktree-conversations-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function holdLoad(failed = false) {
    await application.evaluateMain(`(()=>{const ipc=require('electron').ipcMain,original=ipc._invokeHandlers.get('qiyao:invoke');let release;const pending=new Promise(resolve=>{release=resolve;});globalThis.nookConversationLoad={original,release,entered:false};ipc._invokeHandlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='load'){globalThis.nookConversationLoad.entered=true;${failed ? "throw new Error('PRIVATE_KEY SECRET_PATH fixture');" : 'await pending;'}}return original(event,method,...args);});})()`);
  }
  async function restoreLoad() { await application.evaluateMain("(()=>{const receipt=globalThis.nookConversationLoad;require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',receipt.original);receipt.release();delete globalThis.nookConversationLoad;})()"); }
  async function entered(expression) { await application.evaluateMain(`(async()=>{const deadline=Date.now()+5000;while(!(${expression})){if(Date.now()>=deadline)throw new Error('The held conversation boundary was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()`); }
  async function draftSaved(threadId, text) {
    await waitForBridge(page, async ({ threadId, text }) => (await window.qiyao.load()).composerDrafts.some(draft => draft.threadId === threadId && draft.text === text), { threadId, text });
    const actual = (await state()).composerDrafts.find(draft => draft.threadId === threadId); assert.deepEqual(actual.attachments, [attachment]); return actual;
  }
  await mkdir(source); await git(source, ['init', '-q', '-b', 'main']); await git(source, ['config', 'user.name', 'Nook verification']); await git(source, ['config', 'user.email', 'test@example.invalid']); await git(source, ['config', 'commit.gpgSign', 'false']);
  await writeFile(join(source, '保留.txt'), 'BASE\n'); await git(source, ['add', '.']); await git(source, ['commit', '-qm', 'Conversation fixture']); await git(source, ['worktree', 'add', '-q', '-b', 'feature/会话', child]);
  await mkdir(relocated); await git(relocated, ['init', '-q', '-b', 'main']);
  await writeFile(join(source, '保留.txt'), 'DIRTY_KEEP\n'); await writeFile(join(source, '未跟踪.txt'), 'UNTRACKED_KEEP\n');
  const index = await readFile(join(source, '.git/index')), status = await git(source, ['status', '--porcelain=v1', '-z']);
  page = await restart(() => writeFile(primary, JSON.stringify({ ...originalState, preferences: { ...originalState.preferences, theme: 'light' }, projects, threads: [...originalState.threads, sourceChat, archived], activeThreadId: sourceChat.id, composerDrafts: [...originalState.composerDrafts.filter(draft => draft.threadId), sourceDraft, archiveDraft, newDraft] })));
  application = getApplication(); assert.equal(await input().inputValue(), sourceDraft.text); await input().fill('SOURCE_LATEST_KEEP'); await open(); await linkedChat().click(); await settings().waitFor({ state: 'hidden' });
  assert.equal(await input().inputValue(), archiveDraft.text); assert.equal((await state()).activeThreadId, archived.id); assert.deepEqual((await state()).threads.find(thread => thread.id === archived.id), archived);
  await draftSaved(sourceChat.id, 'SOURCE_LATEST_KEEP'); await capture('archived-open-light');
  verified('actual linked pinned and archived conversation navigation preserves its flags, exact target draft and attachment, and saves the latest source draft without sending');

  await open(); await childRow().getByRole('button', { name: '新建项目聊天', exact: true }).click(); await settings().waitFor({ state: 'hidden' });
  assert.equal(await input().inputValue(), newDraft.text); assert.equal((await state()).activeThreadId, undefined); const selected = await draftSaved(undefined, newDraft.text); assert.equal(selected.projectId, childProject.id);
  assert.equal((await state()).threads.length, originalState.threads.length + 2); await draftSaved(archived.id, archiveDraft.text); await capture('new-project-chat-light');
  verified('new project chat selects the actual registered worktree context and retains the independent new-chat draft and attachment without inventing a conversation or making HTTP requests');

  await open(); const beforeFailure = await readFile(primary), beforeState = await state();
  const checkpoint = join(directory, 'workspace.checkpoints.json'), beforeCheckpoint = await readFile(checkpoint);
  await application.evaluateMain(`(()=>{const fs=require('node:fs/promises'),original=fs.rename;let release;const pending=new Promise(resolve=>{release=resolve;});globalThis.nookConversationSave={original,release,entered:false};fs.rename=async(source,target)=>{if(target===${JSON.stringify(checkpoint)}){globalThis.nookConversationSave.entered=true;await pending;throw Object.assign(new Error('Fixture navigation EIO'),{code:'EIO'});}return original(source,target);};})()`);
  try {
    await linkedChat().click(); await entered('globalThis.nookConversationSave.entered');
    assert.equal(await settings().evaluate(dialog => [...dialog.querySelectorAll('button')].every(button => button.disabled)), true); assert.equal(await settings().getByLabel('工作树根目录', { exact: true }).isDisabled(), true);
    assert.equal(await settings().evaluate(dialog => dialog.closedBy), 'none'); for (let attempt = 0; attempt < 3; attempt++) await page.keyboard.press('Escape'); assert.equal(await settings().isVisible(), true); await capture('navigation-held-light');
    await application.evaluateMain('globalThis.nookConversationSave.release()'); await settings().getByRole('alert').waitFor(); assert.equal(await settings().getByRole('alert').textContent(), '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。'); assert.deepEqual(await readFile(primary), beforeFailure); assert.deepEqual(await readFile(checkpoint), beforeCheckpoint); assert.deepEqual(await state(), beforeState); assert.equal(await input().inputValue(), newDraft.text); await capture('navigation-error-light');
  } finally { await application.evaluateMain("(()=>{const receipt=globalThis.nookConversationSave;require('node:fs/promises').rename=receipt.original;receipt.release();delete globalThis.nookConversationSave;})()"); }
  await linkedChat().click(); await settings().waitFor({ state: 'hidden' }); assert.equal(await input().inputValue(), archiveDraft.text);
  await input().fill('ARCHIVED_RESTART_KEEP'); await draftSaved(archived.id, 'ARCHIVED_RESTART_KEEP'); page = await restart(); application = getApplication(); assert.equal(await input().inputValue(), 'ARCHIVED_RESTART_KEEP'); await capture('retry-restart-light');
  for (const kind of ['conversation', 'project']) {
    await open(); await holdLoad();
    try {
      await linkedChat().click(); await entered('globalThis.nookConversationLoad.entered');
      if (kind === 'conversation') await page.evaluate(thread => window.qiyao.updateThread(thread), { ...archived, projectId: sourceProject.id });
      else await page.evaluate(project => window.qiyao.saveProject(project), { ...childProject, path: relocated });
      const changedBytes = await readFile(primary); await application.evaluateMain('globalThis.nookConversationLoad.release()'); await settings().getByRole('alert').waitFor();
      assert.equal(await settings().getByRole('alert').textContent(), kind === 'conversation' ? '关联会话已变更，请刷新工作树列表后重试。' : '关联项目已变更，请刷新工作树列表后重试。'); assert.deepEqual(await readFile(primary), changedBytes); assert.equal(await input().inputValue(), 'ARCHIVED_RESTART_KEEP'); await capture(`stale-${kind}-light`);
    } finally { await restoreLoad(); }
    await close();
    if (kind === 'conversation') await page.evaluate(thread => window.qiyao.updateThread(thread), archived); else await page.evaluate(project => window.qiyao.saveProject(project), childProject);
    await page.reload(); await input().waitFor();
  }
  verified('held actual activation EIO locks the complete settings surface and preserves disk/draft state, retry and normal restart succeed, and delayed reads reject reassigned conversations or relocated projects');

  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload(); await input().waitFor();
    await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await waitForBridge(page, ({ theme, zoom }) => document.documentElement.dataset.theme === theme && Math.abs(innerWidth - 760 / zoom) <= 1, { theme, zoom }); await open();
    await linkedChat().focus(); await page.keyboard.press('Tab'); assert.equal(await settings().evaluate(dialog => dialog.contains(document.activeElement)), true);
    await settings().evaluate(() => document.activeElement.scrollIntoView({ block: 'nearest' }));
    const keyboardLayout = await settings().evaluate(() => { const element = document.activeElement, rect = element.getBoundingClientRect(), style = getComputedStyle(element), content = element.closest('.settings-detail'), parent = content.getBoundingClientRect(); return { label: element.textContent.trim(), outline: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportTop: parent.top + content.clientTop, viewportBottom: parent.top + content.clientTop + content.clientHeight, viewportLeft: parent.left + content.clientLeft, viewportRight: parent.left + content.clientLeft + content.clientWidth }; });
    assert.equal(keyboardLayout.label, '新建项目聊天'); assert.ok(keyboardLayout.outline > 0); assert.ok(keyboardLayout.top - keyboardLayout.outline >= keyboardLayout.viewportTop && keyboardLayout.bottom + keyboardLayout.outline <= keyboardLayout.viewportBottom && keyboardLayout.left - keyboardLayout.outline >= keyboardLayout.viewportLeft && keyboardLayout.right + keyboardLayout.outline <= keyboardLayout.viewportRight); keyboardLayouts.push({ theme, zoom, ...keyboardLayout });
    const titleLayout = await linkedChat().evaluate(element => { const style = getComputedStyle(element); return { display: style.display, align: style.textAlign, ellipsis: style.textOverflow, width: element.clientWidth, scrollWidth: element.scrollWidth }; });
    assert.equal(titleLayout.display, 'block'); assert.equal(titleLayout.align, 'left'); assert.equal(titleLayout.ellipsis, 'ellipsis'); assert.ok(titleLayout.width > 0 && titleLayout.scrollWidth > titleLayout.width);
    await capture(`${theme}-${zoom * 100}-links`);
    await holdLoad(true);
    try {
      await linkedChat().click(); await settings().getByRole('alert').waitFor(); assert.equal(await settings().getByRole('alert').textContent(), '未能打开项目聊天，请重试。'); assert.doesNotMatch(await settings().innerText(), /PRIVATE_KEY|SECRET_PATH/);
      const geometry = await settings().getByRole('alert').evaluate(element => { const content = element.closest('.settings-detail'), rect = element.getBoundingClientRect(), bounds = content.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportTop: bounds.top + content.clientTop, viewportBottom: bounds.top + content.clientTop + content.clientHeight, viewportLeft: bounds.left + content.clientLeft, viewportRight: bounds.left + content.clientLeft + content.clientWidth, contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }; });
      assert.ok(geometry.top >= geometry.viewportTop && geometry.bottom <= geometry.viewportBottom && geometry.left >= geometry.viewportLeft && geometry.right <= geometry.viewportRight && geometry.contentScrollWidth <= geometry.contentWidth && geometry.documentWidth <= geometry.viewportWidth); layouts.push({ theme, zoom, ...geometry }); await capture(`${theme}-${zoom * 100}-error`);
    } finally { await restoreLoad(); }
    await close();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`); await application.resize(...originalWindow.size);
  assert.equal(await git(source, ['status', '--porcelain=v1', '-z']), status); assert.deepEqual(await readFile(join(source, '.git/index')), index); assert.equal(await readFile(join(source, '保留.txt'), 'utf8'), 'DIRTY_KEEP\n'); assert.equal(await readFile(join(source, '未跟踪.txt'), 'utf8'), 'UNTRACKED_KEEP\n');
  page = await restart(() => writeFile(primary, originalBytes)); application = getApplication(); assert.deepEqual((await state()).projects, originalState.projects); assert.equal(modelRequests(), requestsBefore);
  verified('six actual minimum-window theme/zoom cases retain keyboard-reachable bounded conversation actions and complete sanitized errors, and normal restoration preserves source Git bytes with zero model requests');
  return { page, result: { checks: 4, modelRequests: modelRequests() - requestsBefore, linkedConversationVerified: true, projectDraftVerified: true, heldFailureRetryRestartVerified: true, staleTargetsVerified: true, sanitizedErrorsVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true, layouts, keyboardLayouts, screenshots: captures, scope: 'Actual registered-project conversation navigation and draft persistence; suite-owned workspace and Git fixtures, real atomic rename EIO and isolated held/load error boundaries. New project chat selects an existing draft and creates no persistent conversation until normal explicit sending. Git deletion, unregistered-path registration, upstream fetching and complete reference parity remain separate.' } };
}
