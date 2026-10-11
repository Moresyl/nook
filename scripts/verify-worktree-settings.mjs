import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const runFile = promisify(execFile);
const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";
async function git(root, args) { return (await runFile('git', ['--no-pager', '-C', root, ...args], { windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout; }
export async function verifyWorktreeSettings({ page, application, getApplication, directory, screenshots, verified, waitForBridge, restart, modelRequests = () => 0 }) {
  const projectId = randomUUID(), projectName = `根目录项目 ${projectId.slice(0, 8)}`;
  const source = join(directory, '根目录 源项目'), root = join(directory, '管理 工作树 🧭'), alternative = join(directory, '另一个 工作树根目录');
  const primary = join(directory, 'workspace.json'), captures = [], errorLayouts = [], layouts = [], requestsBefore = modelRequests();
  const state = () => page.evaluate(async () => JSON.parse(JSON.stringify(await window.qiyao.load())));
  const originalPreferences = (await state()).preferences;
  const originalWindow = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const input = () => settings().getByLabel('工作树根目录', { exact: true });
  const save = () => settings().getByRole('button', { name: '保存工作树设置', exact: true });
  async function open() { await page.keyboard.press('Control+,'); await settings().waitFor(); await settings().getByRole('button', { name: '工作树', exact: true }).click(); await input().waitFor(); }
  async function close() { await dismissModalWithEscape(page, settings()); }
  async function reload() { await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `worktree-settings-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function failSave(name, captureBusy = false) {
    const beforeBytes = await readFile(primary), beforeState = await state();
    await application.evaluateMain(`(() => {
      const fs=require('node:fs/promises'), original=fs.rename;
      let release; const held=new Promise(resolve=>{release=resolve;});
      globalThis.nookRootSaveReceipt={original,release,entered:false};
      fs.rename=async(source,target)=>{if(target===${JSON.stringify(primary)}){globalThis.nookRootSaveReceipt.entered=true;await held;throw Object.assign(new Error('Fixture worktree root EIO'),{code:'EIO'});}return original(source,target);};
    })()`);
    try {
      await save().click();
      assert.equal(await application.evaluateMain(`(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookRootSaveReceipt.entered){if(Date.now()>=deadline)throw new Error('The held root save was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}return true;})()`), true);
      assert.equal(await settings().locator(':scope > .modal-header').getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
      assert.equal(await input().isDisabled(), true); assert.equal(await save().isDisabled(), true);
      assert.equal(await settings().locator('.settings-nav button').count(), 9);
      assert.equal(await settings().locator('.settings-nav').evaluate(nav => [...nav.querySelectorAll('button')].every(button => button.disabled)), true);
      await page.keyboard.press('Escape'); assert.equal(await settings().isVisible(), true);
      if (captureBusy) await capture('save-busy-light');
      await application.evaluateMain('globalThis.nookRootSaveReceipt.release()');
      const alert = settings().getByRole('alert'); await alert.waitFor();
      assert.deepEqual(await readFile(primary), beforeBytes); assert.deepEqual(await state(), beforeState);
      assert.equal(await input().inputValue(), captureBusy ? root : alternative);
      const bounds = await alert.evaluate(element => {
        const content=element.closest('.settings-detail'), rect=element.getBoundingClientRect(), container=content.getBoundingClientRect();
        return { top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,viewportTop:container.top+content.clientTop,viewportBottom:container.top+content.clientTop+content.clientHeight,viewportLeft:container.left+content.clientLeft,viewportRight:container.left+content.clientLeft+content.clientWidth,scrollTop:content.scrollTop,theme:document.documentElement.dataset.theme,text:element.textContent };
      });
      console.log('Worktree root save error viewport', JSON.stringify(bounds)); await capture(name); errorLayouts.push(bounds);
      assert.equal(bounds.text, '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。');
      assert.ok(bounds.top>=bounds.viewportTop&&bounds.bottom<=bounds.viewportBottom&&bounds.left>=bounds.viewportLeft&&bounds.right<=bounds.viewportRight, 'The complete root save error must fit the settings content viewport.');
      assert.equal(modelRequests(), requestsBefore);
    } finally { await application.evaluateMain("(()=>{const receipt=globalThis.nookRootSaveReceipt;require('node:fs/promises').rename=receipt.original;receipt.release();delete globalThis.nookRootSaveReceipt;})()"); }
  }
  await mkdir(source); await mkdir(root); await mkdir(alternative);
  await git(source, ['init', '-q', '-b', 'main']); await git(source, ['config', 'user.name', 'Nook verification']); await git(source, ['config', 'user.email', 'test@example.invalid']);
  await git(source, ['config', 'commit.gpgSign', 'false']); await git(source, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(source, '保留.txt'), 'BASE\n'); await writeFile(join(source, '暂存.txt'), 'INDEX_BASE\n'); await git(source, ['add', '--', '保留.txt', '暂存.txt']); await git(source, ['commit', '-qm', 'Base']);
  await writeFile(join(source, '保留.txt'), 'SOURCE_DIRTY_中文\n'); await writeFile(join(source, '暂存.txt'), 'INDEX_DIRTY\n'); await git(source, ['add', '--', '暂存.txt']); await writeFile(join(source, '未跟踪.txt'), 'UNTRACKED_KEEP\n');
  const originalStatus=await git(source, ['status', '--porcelain=v1', '-z']), originalIndex=await readFile(join(source, '.git/index'));
  await page.evaluate(project=>window.qiyao.saveProject(project), { id:projectId,name:projectName,path:source,instructions:'',createdAt:Date.now() });
  await page.evaluate(async()=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,theme:'light'});});
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280,840); await reload(); await open();
  const initialBytes=await readFile(primary); await input().fill('C:relative'); assert.equal(await input().getAttribute('aria-invalid'),'true'); assert.equal(await save().isDisabled(),true);
  await assert.rejects(page.evaluate(async()=>{const state=await window.qiyao.load();return window.qiyao.savePreferences({...state.preferences,worktrees:{root:'C:relative'}});}));
  assert.deepEqual(await readFile(primary),initialBytes); await input().fill(root); assert.equal(await save().isEnabled(),true); await capture('root-light');
  verified('native root settings reject relative paths in both UI and actual IPC without writing, accept an explicit Unicode absolute root and keep the legacy empty setting compatible');
  await failSave('save-error-light',true);
  verified('held actual root save disables all nine categories, header close and input, blocks Escape and duplicate submission, then exposes readable Chinese EIO feedback while preserving exact data and typed root with zero model requests');
  await save().click(); await settings().getByRole('status').getByText('已保存工作树设置。',{exact:true}).waitFor(); assert.equal((await state()).preferences.worktrees.root,root); await close(); await reload(); await open(); assert.equal(await input().inputValue(),root); await close();
  assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
  verified('successful retry and renderer reload retain the explicit root without moving files or changing the original repository HEAD, index or working state');
  await page.locator('.primary-nav').getByRole('button',{name:'项目',exact:true}).click(); await page.locator('.project-list').getByRole('button',{name:projectName,exact:true}).click();
  await page.getByRole('button',{name:'查看改动',exact:true}).click(); await page.getByRole('button',{name:'管理项目工作树',exact:true}).click();
  const treeDialog=page.getByRole('dialog',{name:'项目工作树',exact:true}); await treeDialog.waitFor();
  await waitForBridge(page,()=>{const button=document.querySelector('.worktree-dialog button[aria-label="刷新工作树列表"]');return Boolean(button&&!button.disabled);});
  const target=await treeDialog.getByLabel('工作树文件夹',{exact:true}).inputValue(); assert.equal(resolve(dirname(target)),resolve(root)); assert.match(target.split(/[\\/]/).at(-1),/^nook-[a-f0-9]{8}$/);
  await treeDialog.getByLabel('工作树分支',{exact:true}).fill('feature/root-managed'); await treeDialog.getByRole('button',{name:'创建工作树',exact:true}).click(); await treeDialog.getByLabel('工作树项目名称',{exact:true}).waitFor();
  assert.equal(await readFile(join(target,'保留.txt'),'utf8'),'BASE\n'); assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
  assert.equal(await readFile(join(source,'未跟踪.txt'),'utf8'),'UNTRACKED_KEEP\n'); assert.equal((await git(source,['branch','--show-current'])).trim(),'main'); assert.equal((await state()).projects.some(project=>resolve(project.path)===resolve(target)),false);
  await capture('actual-creation-light'); await dismissModalWithEscape(page,treeDialog);
  verified('the real creation form proposes a new editable path under the saved root and actual Git creation uses committed bytes while preserving source branch, staged index, dirty and untracked files without implicit project registration');
  const backup=join(directory,'worktree-root.nook.json.gz');
  await application.evaluateMain(`globalThis.nookRootSaveDialog=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
  try { assert.equal(await page.evaluate(()=>window.qiyao.exportWorkspace()),true); } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookRootSaveDialog;delete globalThis.nookRootSaveDialog;"); }
  const exported=JSON.stringify(JSON.parse(gunzipSync(await readFile(backup)).toString('utf8'))); assert.ok(exported.includes(JSON.stringify({root})));
  await page.evaluate(async()=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,worktrees:{root:''}});});
  await application.evaluateMain(`globalThis.nookRootOpenDialog=require('electron').dialog.showOpenDialog;globalThis.nookRootMessageDialog=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  try { assert.ok(await page.evaluate(()=>window.qiyao.importWorkspace())); } finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookRootOpenDialog;require('electron').dialog.showMessageBox=globalThis.nookRootMessageDialog;delete globalThis.nookRootOpenDialog;delete globalThis.nookRootMessageDialog;"); }
  page=await restart(); application=getApplication(); await open(); assert.equal(await input().inputValue(),root); await capture('restored-restart-light'); await close();
  assert.equal(await readFile(join(source,'保留.txt'),'utf8'),'SOURCE_DIRTY_中文\n'); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
  verified('real gzip backup, explicit restoration and normal native restart retain the saved root while keeping existing repository bytes and staged state intact');
  for (const theme of ['light','dark']) for (const zoom of [1,1.25,1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
    await page.evaluate(async theme=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,theme});},theme); await reload();
    await application.resize(760,540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page,({theme,zoom})=>document.documentElement.dataset.theme===theme&&Math.abs(innerWidth-760/zoom)<=1&&Math.abs(innerHeight-540/zoom)<=1,{theme,zoom});
    await open(); await input().fill(alternative); await failSave(`${theme}-${zoom*100}`);
    const geometry=await input().evaluate(element=>{const rect=element.getBoundingClientRect(), section=element.closest('.worktree-settings');return {width:rect.width,left:rect.left,right:rect.right,viewportWidth:innerWidth,headingMargin:getComputedStyle(section.querySelector('h3')).marginBottom,descriptionSize:getComputedStyle(section.querySelector('.muted')).fontSize};});
    assert.ok(geometry.width<=288&&geometry.width>0&&geometry.left>=0&&geometry.right<=geometry.viewportWidth); assert.equal(geometry.headingMargin,'8px'); assert.equal(geometry.descriptionSize,'12px'); layouts.push({theme,zoom,...geometry});
    await input().focus(); await page.keyboard.press('Tab'); assert.equal(await settings().evaluate(dialog=>dialog.contains(document.activeElement)),true); await close();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`); await application.resize(...originalWindow.size);
  await page.evaluate(async theme=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,theme});},originalPreferences.theme); await reload();
  await waitForBridge(page,theme=>document.documentElement.dataset.theme===theme,originalTheme); assert.equal(modelRequests(),requestsBefore);
  verified('all six actual light/dark minimum-window zoom cases retain the bounded root input, complete save errors, nine-category shell and modal keyboard containment without extra model requests');
  return {page,result:{checks:6,modelRequests:modelRequests()-requestsBefore,rootValidationVerified:true,busySaveVerified:true,saveFailurePreservationVerified:true,rootCreationVerified:true,backupRestartVerified:true,referenceZoomKeyboardVerified:true,root,target,errorLayouts,layouts,screenshots:captures,scope:'Real settings IPC, held atomic-save EIO, real Git creation with source preservation, gzip backup/restore and normal restart; six native zoom/theme cases with fixed test display scale. Root is an explicit existing directory; blank retains manual path entry. Automatic deletion, upstream fetching, snapshots, complete reference parity and physical system picker interaction remain separate.'}};
}
