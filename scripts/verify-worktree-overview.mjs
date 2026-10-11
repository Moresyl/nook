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

export async function verifyWorktreeOverview({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  await page.evaluate(async () => {
    const state = await window.qiyao.load();
    await window.qiyao.savePreferences({ ...state.preferences, theme: state.preferences.theme === 'dark' ? 'light' : 'dark' });
    await window.qiyao.savePreferences(state.preferences);
  });
  const primary = join(directory, 'workspace.json'), originalBytes = await readFile(primary), originalState = JSON.parse(originalBytes);
  const originalWindow = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const source = join(directory, '列表 源项目'), child = join(directory, '已登记 中文工作树'), unregistered = join(directory, '未登记 工作树'), added = join(directory, '刷新 后工作树');
  const makeProject = (name, path) => ({ id: randomUUID(), name, path, instructions: '', createdAt: Date.now() });
  const sourceProject = makeProject('列表源项目', source), childProject = makeProject('中文工作树项目', child);
  const makeThread = (title, projectId, extra = {}) => ({ id: randomUUID(), title, projectId, model: '', pinned: false, archived: false, createdAt: 1, updatedAt: 2, messages: [], ...extra });
  const pin = makeThread('固定会话 · 中文', childProject.id, { pinned: true }), archive = makeThread('归档会话 · 中文', childProject.id, { archived: true }), normal = makeThread('源项目会话', sourceProject.id), unrelated = makeThread('其他项目会话', randomUUID());
  const captures = [], layouts = [], requestsBefore = modelRequests(), queryPages = [];
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const overview = () => settings().getByRole('region', { name: '已登记项目的工作树', exact: true });
  const refresh = () => overview().getByRole('button', { name: '刷新项目工作树', exact: true });
  const rows = () => overview().locator('.worktree-row');
  const state = () => page.evaluate(() => window.qiyao.load());
  async function syncState() { await application.evaluateMain(`${mainWindow}.webContents.send('nook:workspace-navigation',{settings:true})`); }
  async function settled() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await waitForBridge(page, () => document.querySelector('.worktree-overview')?.getAttribute('aria-busy') === 'false');
  }
  async function open() { await page.keyboard.press('Control+,'); await settings().waitFor(); await settings().getByRole('button', { name: '工作树', exact: true }).click(); await overview().waitFor(); await settled(); }
  async function close() { await dismissModalWithEscape(page, settings()); }
  async function seed(projects) {
    page = await restart(() => writeFile(primary, JSON.stringify({ ...originalState, projects, threads: [...originalState.threads, pin, archive, normal, unrelated] })));
    application = getApplication();
  }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `worktree-overview-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function intercept({ failed = false, held = false } = {}) {
    await application.evaluateMain(`(() => {
      const ipc=require('electron').ipcMain, original=ipc._invokeHandlers.get('qiyao:invoke');let release;const pending=new Promise(resolve=>{release=resolve;});
      globalThis.nookOverviewReceipt={original,release,calls:[],failed:${failed},held:${held}};
      ipc._invokeHandlers.set('qiyao:invoke',async(event,method,...args)=>{
        const receipt=globalThis.nookOverviewReceipt;
        if(method==='gitWorktrees'){receipt.calls.push(args[0]);if(receipt.held)await pending;if(receipt.failed&&args[0]===${JSON.stringify(sourceProject.id)})throw new Error('PRIVATE_KEY SECRET_PATH overview fixture');}
        return original(event,method,...args);
      });
    })()`);
  }
  async function receipt() { return application.evaluateMain('globalThis.nookOverviewReceipt.calls.slice()'); }
  async function release() { await application.evaluateMain('globalThis.nookOverviewReceipt.release()'); }
  async function restoreHandler() { await application.evaluateMain("(()=>{const receipt=globalThis.nookOverviewReceipt;require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',receipt.original);receipt.release();delete globalThis.nookOverviewReceipt;})()"); }
  await mkdir(source); await git(source, ['init', '-q', '-b', 'main']); await git(source, ['config', 'user.name', 'Nook verification']); await git(source, ['config', 'user.email', 'test@example.invalid']); await git(source, ['config', 'commit.gpgSign', 'false']);
  await writeFile(join(source, '保留.txt'), 'BASE\n'); await git(source, ['add', '.']); await git(source, ['commit', '-qm', 'Overview fixture']);
  await git(source, ['worktree', 'add', '-q', '-b', 'feature/中文', child]); await git(source, ['worktree', 'add', '-q', '-b', 'feature/unregistered', unregistered]);
  await writeFile(join(source, '保留.txt'), 'DIRTY_KEEP\n'); await writeFile(join(source, '未跟踪.txt'), 'UNTRACKED_KEEP\n');
  const index = await readFile(join(source, '.git/index')), status = await git(source, ['status', '--porcelain=v1', '-z']);
  await seed([sourceProject, childProject]);
  const temporaryState = await page.evaluate(() => window.qiyao.startTemporaryChat()), temporary = temporaryState.threads.find(thread => thread.temporary);
  assert.ok(temporary); await page.evaluate(thread => window.qiyao.updateThread(thread), { ...temporary, title: '临时会话不得关联', projectId: childProject.id });
  await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await open();
  assert.equal(await overview().locator('.worktree-overview-group').count(), 1); assert.equal(await rows().count(), 3);
  const childRow = () => rows().filter({ has: page.getByText('feature/中文', { exact: true }) });
  await childRow().locator('summary').click();
  assert.deepEqual(await childRow().locator('li > :is(button,span:not([role="tooltip"]))').allTextContents(), ['固定会话 · 中文', '已固定', '归档会话 · 中文', '已归档']);
  assert.equal(await overview().getByText('临时会话不得关联', { exact: true }).count(), 0); assert.equal(await overview().getByText('其他项目会话', { exact: true }).count(), 0);
  assert.match(await rows().filter({ has: page.getByText('feature/unregistered', { exact: true }) }).textContent(), /未登记项目/);
  await childRow().scrollIntoViewIfNeeded(); await capture('associations-light'); await close();
  verified('real Git repository families merge without implicit registration and associate only persistent project conversations, retaining pinned and archived labels');

  await git(source, ['worktree', 'add', '-q', '-b', 'feature/refreshed', added]); await open();
  await page.evaluate(thread => window.qiyao.updateThread(thread), { ...archive, title: '归档会话已更新', archived: false });
  await syncState(); await waitForBridge(page, () => document.querySelector('.worktree-overview')?.textContent.includes('归档会话已更新'));
  const beforeRefresh = await readFile(primary); await refresh().click(); await settled(); assert.equal(await rows().count(), 4);
  await childRow().locator('summary').click(); await childRow().getByRole('button', { name: '归档会话已更新', exact: true }).waitFor();
  assert.equal(await childRow().getByText('已归档', { exact: true }).count(), 0); assert.deepEqual(await readFile(primary), beforeRefresh);
  assert.equal((await state()).projects.length, 2); await capture('refresh-light'); await close();
  verified('manual refresh reads actual added worktrees and current conversation details without workspace writes, project creation or model requests');

  await intercept({ failed: true });
  try {
    await open(); const alert = overview().getByRole('alert'); await alert.waitFor();
    assert.equal(await alert.textContent(), '未能读取此项目的工作树。请检查仓库与 Git，然后刷新重试。');
    assert.equal(await rows().count(), 4); assert.doesNotMatch(await overview().innerText(), /PRIVATE_KEY|SECRET_PATH/);
    await alert.scrollIntoViewIfNeeded(); await capture('error-light'); await close();
    await application.evaluateMain('globalThis.nookOverviewReceipt.failed=false;globalThis.nookOverviewReceipt.held=true;globalThis.nookOverviewReceipt.calls=[];');
    await page.keyboard.press('Control+,'); await settings().getByRole('button', { name: '工作树', exact: true }).click();
    await application.evaluateMain("(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookOverviewReceipt.calls.length){if(Date.now()>=deadline)throw new Error('The held overview query was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()");
    assert.equal(await refresh().isDisabled(), true); await overview().scrollIntoViewIfNeeded(); await capture('loading-light');
    await close(); await release();
    await application.evaluateMain("(async()=>{await new Promise(resolve=>setTimeout(resolve,100));})()");
    assert.deepEqual(await receipt(), [sourceProject.id]);
    await application.evaluateMain('globalThis.nookOverviewReceipt.held=false;'); await open(); assert.equal(await rows().count(), 4); assert.equal(await overview().getByRole('alert').count(), 0); await capture('retry-light'); await close();
  } finally { await restoreHandler(); }
  verified('sanitized per-project errors preserve healthy repository rows, retry succeeds and closing a held read prevents the next project query');

  const extraProjects = [];
  for (let index = 0; index < 19; index++) {
    const path = join(directory, `分页 工作树 ${index + 1}`); await git(source, ['worktree', 'add', '-q', '-b', `feature/page-${index + 1}`, path]); extraProjects.push(makeProject(`分页项目 ${index + 1}`, path));
  }
  const pagedProjects = [sourceProject, childProject, ...extraProjects]; await seed(pagedProjects); await intercept();
  try {
    await open(); const first = await receipt(); assert.deepEqual(first, pagedProjects.slice(0, 20).map(project => project.id)); queryPages.push(first);
    assert.equal(await overview().locator('.worktree-overview-group').count(), 1); assert.equal(await rows().count(), 23);
    await overview().getByRole('button', { name: '下一页', exact: true }).click(); await settled();
    assert.deepEqual((await receipt()).slice(20), [pagedProjects[20].id]); queryPages.push((await receipt()).slice(20)); await capture('page-two-light');
    await overview().getByRole('button', { name: '上一页', exact: true }).click(); await settled(); assert.deepEqual((await receipt()).slice(21), first); queryPages.push((await receipt()).slice(21));
    await overview().getByRole('button', { name: '下一页', exact: true }).click(); await settled();
    await page.evaluate(id => window.qiyao.removeProject(id), pagedProjects[20].id); await syncState();
    await waitForBridge(page, () => !document.querySelector('.worktree-overview-pages')); await settled();
    assert.equal(await overview().getByRole('navigation', { name: '项目工作树分页', exact: true }).count(), 0);
    await page.evaluate(project => window.qiyao.saveProject(project), pagedProjects[20]); await syncState();
    await waitForBridge(page, () => Boolean(document.querySelector('.worktree-overview-pages'))); await settled();
    assert.match(await overview().getByRole('status').textContent(), /第 1 \/ 2 页/); await close();
  } finally { await restoreHandler(); }
  verified('twenty-one real registered worktrees query only twenty projects per page, navigate in both directions and retain the clamped first page when a removed project returns');

  await seed([sourceProject, childProject]); await intercept({ failed: true });
  try {
    for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
      await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
      await waitForBridge(page, ({ theme, zoom }) => document.documentElement.dataset.theme === theme && Math.abs(innerWidth - 760 / zoom) <= 1, { theme, zoom }); await open();
      const alert = overview().getByRole('alert'); await alert.scrollIntoViewIfNeeded();
      const bounds = await alert.evaluate(element => { const content = element.closest('.settings-detail'), rect = element.getBoundingClientRect(), viewport = content.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportTop: viewport.top + content.clientTop, viewportBottom: viewport.top + content.clientTop + content.clientHeight, viewportLeft: viewport.left + content.clientLeft, viewportRight: viewport.left + content.clientLeft + content.clientWidth }; });
      assert.ok(bounds.top >= bounds.viewportTop && bounds.bottom <= bounds.viewportBottom && bounds.left >= bounds.viewportLeft && bounds.right <= bounds.viewportRight, 'The complete overview error must fit the actual content viewport.'); await capture(`${theme}-${zoom * 100}-error`);
      const summary = rows().first().locator('summary'); await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await rows().first().locator('details').getAttribute('open'), '');
      const geometry = await overview().evaluate(element => { const content = element.closest('.settings-detail'); return { contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }; });
      assert.ok(geometry.contentScrollWidth <= geometry.contentWidth && geometry.documentWidth <= geometry.viewportWidth); layouts.push({ theme, zoom, error: bounds, ...geometry }); await capture(`${theme}-${zoom * 100}-rows`); await close();
    }
  } finally { await restoreHandler(); }
  verified('six light/dark minimum-window zoom cases expose complete errors through vertical scrolling and keyboard-operable conversation rows without horizontal overflow');

  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`); await application.resize(...originalWindow.size);
  assert.equal(await git(source, ['status', '--porcelain=v1', '-z']), status); assert.deepEqual(await readFile(join(source, '.git/index')), index);
  assert.equal(await readFile(join(source, '保留.txt'), 'utf8'), 'DIRTY_KEEP\n'); assert.equal(await readFile(join(source, '未跟踪.txt'), 'utf8'), 'UNTRACKED_KEEP\n'); assert.equal((await git(source, ['branch', '--show-current'])).trim(), 'main');
  page = await restart(() => writeFile(primary, originalBytes)); application = getApplication();
  assert.deepEqual((await state()).projects, originalState.projects); assert.equal((await state()).threads.some(thread => thread.id === pin.id), false); assert.equal(modelRequests(), requestsBefore);
  verified('normal restart restores the pre-test workspace and all real source branch, index, dirty and untracked bytes remain intact with zero model requests');
  return { page, result: { checks: 6, modelRequests: modelRequests() - requestsBefore, actualRepositoryAssociationVerified: true, refreshReadOnlyVerified: true, errorRetryCloseVerified: true, boundedPagingVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true, queryPages, layouts, screenshots: captures, scope: 'Real isolated Git fixtures and main-process worktree IPC; persisted fixture workspace is seeded only in the suite-owned profile and restored on success. Git error/held-read responses are intercepted only in the test process. Known-project inventory and persistent conversation labels are read-only. Opening/creating/deleting conversations, automatic cleanup, upstream refresh and full reference parity are separate.' } };
}
