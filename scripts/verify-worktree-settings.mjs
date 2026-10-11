import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  const choose = () => settings().getByRole('button', { name: '选择工作树文件夹', exact: true });
  const rootAlert = () => settings().locator('.worktree-settings > .inline-error[role="alert"]');
  async function open() { await page.keyboard.press('Control+,'); await settings().waitFor(); await settings().getByRole('button', { name: '工作树', exact: true }).click(); await input().waitFor(); }
  async function close() { await dismissModalWithEscape(page, settings()); }
  async function reload() { await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); }
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `worktree-settings-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  async function selectDirectory(result, captureName, failure = false) {
    const beforeBytes=await readFile(primary), beforeState=await state(), beforeInput=await input().inputValue();
    await application.evaluateMain(`(() => {
      const electron=require('electron'), owner=${mainWindow};let release;const held=new Promise(resolve=>{release=resolve;});
      globalThis.nookRootPickerReceipt={original:electron.dialog.showOpenDialog,release,calls:0,owner:false,options:null};
      electron.dialog.showOpenDialog=async(window,options)=>{const receipt=globalThis.nookRootPickerReceipt;receipt.calls++;receipt.owner=window===owner;receipt.options=options;await held;${failure ? "throw new Error('PRIVATE_KEY SECRET_PATH fixture directory failure');" : `return ${JSON.stringify(result)};`}};
    })()`);
    try {
      await choose().click();
      await application.evaluateMain(`(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookRootPickerReceipt.calls){if(Date.now()>=deadline)throw new Error('The native directory picker was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()`);
      assert.equal(await settings().locator(':scope > .modal-header').getByRole('button',{name:'关闭',exact:true}).isDisabled(),true);
      assert.equal(await input().isDisabled(),true);assert.equal(await save().isDisabled(),true);assert.equal(await choose().isDisabled(),true);
      assert.equal(await settings().locator('.settings-nav').evaluate(nav=>[...nav.querySelectorAll('button')].every(button=>button.disabled)),true);
      await settings().evaluate(dialog=>{window.nookPickerCancelEvents=[];dialog.addEventListener('cancel',event=>{const record={type:'cancel',cancelable:event.cancelable,closedBy:dialog.closedBy,headerDisabled:dialog.querySelector('.modal-header button')?.disabled,preventedBefore:event.defaultPrevented};window.nookPickerCancelEvents.push(record);queueMicrotask(()=>{record.preventedAfter=event.defaultPrevented;});},{once:true});dialog.addEventListener('close',()=>window.nookPickerCancelEvents.push({type:'close'}),{once:true});});
      assert.equal(await settings().evaluate(dialog=>dialog.closedBy),'none');
      for(let attempt=0;attempt<3;attempt++)await page.keyboard.press('Escape');
      console.log('Worktree picker held Escape observation',JSON.stringify(await page.evaluate(()=>({events:window.nookPickerCancelEvents,dialogOpen:Boolean(document.querySelector('dialog.settings-dialog[open]')),headerDisabled:document.querySelector('dialog.settings-dialog .modal-header button')?.disabled}))));
      assert.equal(await settings().isVisible(),true);
      assert.deepEqual(await readFile(primary),beforeBytes);assert.deepEqual(await state(),beforeState);
      if(captureName==='picker-cancel-busy-light')await capture(captureName);
      const untrusted=await application.evaluateMain(`(async()=>{const ipc=require('electron').ipcMain;try{await ipc._invokeHandlers.get('qiyao:invoke')({sender:${mainWindow}.webContents,senderFrame:{}},'chooseWorktreeRoot');return 'unexpected';}catch(error){return error.message;}})()`);
      assert.equal(untrusted,'Untrusted application request.');
      const receipt=await application.evaluateMain('({calls:globalThis.nookRootPickerReceipt.calls,owner:globalThis.nookRootPickerReceipt.owner,options:globalThis.nookRootPickerReceipt.options})');
      assert.deepEqual(receipt,{calls:1,owner:true,options:{title:'选择工作树根目录',properties:['openDirectory']}});
      await application.evaluateMain('globalThis.nookRootPickerReceipt.release()');
      try {await waitForBridge(page,()=>{const input=document.querySelector('.worktree-root-control input');return Boolean(input&&!input.disabled&&document.activeElement===input);});}
      catch(error){console.log('Worktree picker focus diagnostics',JSON.stringify(await page.evaluate(()=>({inputDisabled:document.querySelector('.worktree-root-control input')?.disabled,activeTag:document.activeElement?.tagName,activeLabel:document.activeElement?.getAttribute('aria-label'),activeId:document.activeElement?.id,inputId:document.querySelector('.worktree-root-control input')?.id,hasFocus:document.hasFocus()}))));throw error;}
      assert.deepEqual(await readFile(primary),beforeBytes);assert.deepEqual(await state(),beforeState);
      const rejected=failure||(!result.canceled&&(!result.filePaths.length||result.filePaths[0]==='relative'));
      if(rejected){const alert=rootAlert();await alert.waitFor();assert.equal(await alert.textContent(),'未能选择工作树文件夹，请重试。');assert.equal(await input().inputValue(),beforeInput);}
      else {assert.equal(await rootAlert().count(),0);assert.equal(await input().inputValue(),result.canceled?beforeInput:result.filePaths[0]);}
      if(captureName&&captureName!=='picker-cancel-busy-light')await capture(captureName);
      assert.equal(modelRequests(),requestsBefore);
    } finally {await application.evaluateMain("(()=>{const receipt=globalThis.nookRootPickerReceipt;require('electron').dialog.showOpenDialog=receipt.original;receipt.release();delete globalThis.nookRootPickerReceipt;})()");}
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
      assert.equal(await choose().isDisabled(), true);
      assert.equal(await settings().locator('.settings-nav button').count(), 9);
      assert.equal(await settings().locator('.settings-nav').evaluate(nav => [...nav.querySelectorAll('button')].every(button => button.disabled)), true);
      assert.equal(await settings().evaluate(dialog=>dialog.closedBy),'none');
      for(let attempt=0;attempt<3;attempt++)await page.keyboard.press('Escape'); assert.equal(await settings().isVisible(), true);
      if (captureBusy) await capture('save-busy-light');
      await application.evaluateMain('globalThis.nookRootSaveReceipt.release()');
      const alert = rootAlert(); await alert.waitFor();
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
  await selectDirectory({canceled:true,filePaths:['relative']},'picker-cancel-busy-light');
  await selectDirectory({canceled:false,filePaths:[alternative]},'picker-selected-light');
  await selectDirectory(null,'picker-error-light',true);
  await selectDirectory({canceled:false,filePaths:[]});
  await selectDirectory({canceled:false,filePaths:['relative']});
  await input().fill(root);
  verified('actual main IPC opens one owned directory-only dialog, blocks untrusted frames and busy dismissal, preserves typed input and all data on cancellation or sanitized rejection, and stages a selected Unicode root without implicitly saving');
  await failSave('save-error-light',true);
  verified('held actual root save disables all nine categories, header close and input, blocks Escape and duplicate submission, then exposes readable Chinese EIO feedback while preserving exact data and typed root with zero model requests');
  await save().click(); await settings().getByRole('status').getByText('已保存工作树设置。',{exact:true}).waitFor(); assert.equal((await state()).preferences.worktrees.root,root); await close(); await reload(); await open(); assert.equal(await input().inputValue(),root); await close();
  assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
  verified('successful retry and renderer reload retain the explicit root without moving files or changing the original repository HEAD, index or working state');
  await page.locator('.primary-nav').getByRole('button',{name:'项目',exact:true}).click(); await page.locator('.project-list').getByRole('button',{name:projectName,exact:true}).click();
  await page.getByRole('button',{name:'查看改动',exact:true}).click(); await page.getByRole('button',{name:'管理项目工作树',exact:true}).click();
  let treeDialog=page.getByRole('dialog',{name:'项目工作树',exact:true}); await treeDialog.waitFor();
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
  const defaultRoot=join(directory,'worktrees');
  treeDialog=page.getByRole('dialog',{name:'项目工作树',exact:true});
  const absent=async path=>{await assert.rejects(lstat(path),{code:'ENOENT'});};
  const beforeDefaultQuery=await readFile(primary), beforeDefaultState=await state();
  assert.equal(await page.evaluate(()=>window.qiyao.defaultWorktreeRoot()),defaultRoot);
  await absent(defaultRoot); assert.deepEqual(await readFile(primary),beforeDefaultQuery); assert.deepEqual(await state(),beforeDefaultState);
  const defaultUntrusted=await application.evaluateMain(`(async()=>{try{await require('electron').ipcMain._invokeHandlers.get('qiyao:invoke')({sender:${mainWindow}.webContents,senderFrame:{}},'defaultWorktreeRoot');return 'unexpected';}catch(error){return error.message;}})()`);
  assert.equal(defaultUntrusted,'Untrusted application request.');
  await open(); await input().fill(''); await save().click(); await settings().getByRole('status').getByText('已保存工作树设置。',{exact:true}).waitFor();
  await waitForBridge(page,expected=>document.querySelector('.worktree-root-control input')?.placeholder===expected,defaultRoot);
  assert.equal((await state()).preferences.worktrees.root,''); await absent(defaultRoot); await capture('default-root-light'); await close();
  await page.locator('.primary-nav').getByRole('button',{name:'项目',exact:true}).click(); await page.locator('.project-list').getByRole('button',{name:projectName,exact:true}).click();
  await page.getByRole('button',{name:'查看改动',exact:true}).click(); await page.getByRole('button',{name:'管理项目工作树',exact:true}).click(); await treeDialog.waitFor();
  await waitForBridge(page,()=>{const button=document.querySelector('.worktree-dialog button[aria-label="刷新工作树列表"]');return Boolean(button&&!button.disabled);});
  const defaultTarget=await treeDialog.getByLabel('工作树文件夹',{exact:true}).inputValue(); assert.equal(resolve(dirname(defaultTarget)),resolve(defaultRoot)); assert.match(defaultTarget.split(/[\\/]/).at(-1),/^nook-[a-f0-9]{8}$/);
  await absent(defaultRoot); await capture('default-proposal-light');
  for(const request of [{mode:'new',path:defaultTarget,branch:'main'},{mode:'new',path:'relative',branch:'feature/default-invalid'}])await assert.rejects(page.evaluate(({id,input})=>window.qiyao.gitCreateWorktree(id,input),{id:projectId,input:request}));
  await absent(defaultRoot); assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
  verified('the main-only default root query is read-only, blank settings show the profile-owned path and the real form proposes an editable child without creating files; duplicate and relative IPC requests leave the default directory absent');
  await treeDialog.getByLabel('工作树分支',{exact:true}).fill('feature/default-managed');
  await application.evaluateMain(`(()=>{const fs=require('node:fs/promises');let release;const held=new Promise(resolve=>{release=resolve;});globalThis.nookDefaultRootReceipt={original:fs.mkdir,release,entered:false,calls:0};fs.mkdir=async(path,...args)=>{if(path===${JSON.stringify(defaultRoot)}){const receipt=globalThis.nookDefaultRootReceipt;receipt.entered=true;receipt.calls++;await held;throw Object.assign(new Error('PRIVATE_KEY SECRET_PATH default directory EIO'),{code:'EIO'});}return globalThis.nookDefaultRootReceipt.original(path,...args);};})()`);
  try {
    await treeDialog.getByRole('button',{name:'创建工作树',exact:true}).click();
    await application.evaluateMain(`(async()=>{const deadline=Date.now()+5000;while(!globalThis.nookDefaultRootReceipt.entered){if(Date.now()>=deadline)throw new Error('The held default root preparation was not entered within five seconds.');await new Promise(resolve=>setTimeout(resolve,25));}})()`);
    const heldBytes=await readFile(primary),heldState=await state();
    console.log('Default root held control diagnostics',JSON.stringify(await treeDialog.evaluate(dialog=>[...dialog.querySelectorAll('input,select,button')].map(element=>({tag:element.tagName,label:element.getAttribute('aria-label'),text:element.textContent,disabled:element.disabled})))));
    assert.equal(await treeDialog.evaluate(dialog=>dialog.closedBy),'none');
    assert.equal(await treeDialog.evaluate(dialog=>[...dialog.querySelectorAll('input,select,button')].every(element=>element.disabled)),true);
    for(let attempt=0;attempt<3;attempt++)await page.keyboard.press('Escape'); assert.equal(await treeDialog.isVisible(),true);
    assert.deepEqual(await readFile(primary),heldBytes); assert.deepEqual(await state(),heldState); await absent(defaultRoot); await capture('default-busy-light');
    assert.equal(await application.evaluateMain('globalThis.nookDefaultRootReceipt.calls'),1);
    await application.evaluateMain('globalThis.nookDefaultRootReceipt.release()'); await treeDialog.getByRole('alert').waitFor();
    assert.equal(await treeDialog.getByRole('alert').textContent(),'默认工作树目录未能准备。请在设置中选择已有文件夹，再重试。');
    assert.equal(await treeDialog.getByLabel('工作树文件夹',{exact:true}).inputValue(),defaultTarget); assert.equal(await treeDialog.getByLabel('工作树分支',{exact:true}).inputValue(),'feature/default-managed');
    assert.deepEqual(await readFile(primary),heldBytes); assert.deepEqual(await state(),heldState); await absent(defaultRoot);
    assert.equal((await git(source,['branch','--list','feature/default-managed'])).trim(),''); assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex);
    await capture('default-error-light'); assert.equal(modelRequests(),requestsBefore);
  } finally {await application.evaluateMain("(()=>{const receipt=globalThis.nookDefaultRootReceipt;require('node:fs/promises').mkdir=receipt.original;receipt.release();delete globalThis.nookDefaultRootReceipt;})()");}
  verified('held actual default mkdir rejects with sanitized Chinese feedback, locks all create controls and three Escape attempts, preserves exact workspace bytes, source index, staged and dirty files, typed path and branch, and creates no directory or branch');
  await treeDialog.getByRole('button',{name:'创建工作树',exact:true}).click(); await treeDialog.getByLabel('工作树项目名称',{exact:true}).waitFor();
  assert.equal((await lstat(defaultRoot)).isDirectory(),true); assert.equal((await lstat(defaultRoot)).isSymbolicLink(),false); assert.equal(await readFile(join(defaultTarget,'保留.txt'),'utf8'),'BASE\n');
  assert.equal((await state()).preferences.worktrees.root,''); assert.equal((await state()).projects.some(project=>resolve(project.path)===resolve(defaultTarget)),false);
  assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex); assert.equal(await readFile(join(source,'未跟踪.txt'),'utf8'),'UNTRACKED_KEEP\n'); assert.equal((await git(source,['branch','--show-current'])).trim(),'main');
  await capture('default-created-light'); await dismissModalWithEscape(page,treeDialog);
  const defaultBackup=join(directory,'worktree-default-root.nook.json.gz');
  await application.evaluateMain(`globalThis.nookRootSaveDialog=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(defaultBackup)}});`);
  try {assert.equal(await page.evaluate(()=>window.qiyao.exportWorkspace()),true);} finally {await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookRootSaveDialog;delete globalThis.nookRootSaveDialog;");}
  assert.ok(JSON.stringify(JSON.parse(gunzipSync(await readFile(defaultBackup)).toString('utf8'))).includes(JSON.stringify({root:''})));
  await page.evaluate(async root=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,worktrees:{root}});},root);
  await application.evaluateMain(`globalThis.nookRootOpenDialog=require('electron').dialog.showOpenDialog;globalThis.nookRootMessageDialog=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(defaultBackup)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  try {assert.ok(await page.evaluate(()=>window.qiyao.importWorkspace()));} finally {await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.nookRootOpenDialog;require('electron').dialog.showMessageBox=globalThis.nookRootMessageDialog;delete globalThis.nookRootOpenDialog;delete globalThis.nookRootMessageDialog;");}
  page=await restart(); application=getApplication(); await open(); assert.equal(await input().inputValue(),''); assert.equal(await input().getAttribute('placeholder'),defaultRoot); assert.equal(await page.evaluate(()=>window.qiyao.defaultWorktreeRoot()),defaultRoot);
  assert.equal(await readFile(join(defaultTarget,'保留.txt'),'utf8'),'BASE\n'); assert.equal(await git(source,['status','--porcelain=v1','-z']),originalStatus); assert.deepEqual(await readFile(join(source,'.git/index')),originalIndex); await capture('default-restored-light');
  await input().fill(root); await save().click(); await settings().getByRole('status').getByText('已保存工作树设置。',{exact:true}).waitFor(); await close();
  verified('retry prepares only the profile-owned default directory and creates a committed Git worktree without persisting the derived root or registering a project; real gzip restore and normal restart retain blank configuration and existing local Git files without copying them into the workspace backup');
  for (const theme of ['light','dark']) for (const zoom of [1,1.25,1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
    await page.evaluate(async theme=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,theme});},theme); await reload();
    await application.resize(760,540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page,({theme,zoom})=>document.documentElement.dataset.theme===theme&&Math.abs(innerWidth-760/zoom)<=1&&Math.abs(innerHeight-540/zoom)<=1,{theme,zoom});
    await open(); await input().fill(alternative); await failSave(`${theme}-${zoom*100}`);
    const geometry=await input().evaluate(element=>{const rect=element.getBoundingClientRect(), section=element.closest('.worktree-settings');return {width:rect.width,left:rect.left,right:rect.right,viewportWidth:innerWidth,headingMargin:getComputedStyle(section.querySelector('h3')).marginBottom,descriptionSize:getComputedStyle(section.querySelector('.muted')).fontSize};});
    assert.ok(geometry.width<=288&&geometry.width>0&&geometry.left>=0&&geometry.right<=geometry.viewportWidth); assert.equal(geometry.headingMargin,'8px'); assert.equal(geometry.descriptionSize,'12px'); layouts.push({theme,zoom,...geometry});
    await input().focus(); await page.keyboard.press('Tab'); assert.equal(await choose().evaluate(button=>document.activeElement===button),true);
    const pickerGeometry=await choose().evaluate(button=>{const rect=button.getBoundingClientRect(),content=button.closest('.settings-detail'),bounds=content.getBoundingClientRect();return {pickerLeft:rect.left,pickerRight:rect.right,pickerTop:rect.top,pickerBottom:rect.bottom,contentLeft:bounds.left+content.clientLeft,contentRight:bounds.left+content.clientLeft+content.clientWidth,contentTop:bounds.top+content.clientTop,contentBottom:bounds.top+content.clientTop+content.clientHeight};});
    assert.ok(pickerGeometry.pickerLeft>=pickerGeometry.contentLeft&&pickerGeometry.pickerRight<=pickerGeometry.contentRight&&pickerGeometry.pickerTop>=pickerGeometry.contentTop&&pickerGeometry.pickerBottom<=pickerGeometry.contentBottom,'The keyboard-focused directory picker must fit the actual content viewport.');Object.assign(layouts.at(-1),pickerGeometry);
    await page.keyboard.press('Tab');assert.equal(await settings().evaluate(dialog=>dialog.contains(document.activeElement)),true);await close();
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${originalWindow.zoom})`); await application.resize(...originalWindow.size);
  await page.evaluate(async theme=>{const state=await window.qiyao.load();await window.qiyao.savePreferences({...state.preferences,theme});},originalPreferences.theme); await reload();
  await waitForBridge(page,theme=>document.documentElement.dataset.theme===theme,originalTheme); assert.equal(modelRequests(),requestsBefore);
  verified('all six actual light/dark minimum-window zoom cases retain the bounded root input, complete save errors, nine-category shell and modal keyboard containment without extra model requests');
  return {page,result:{checks:10,modelRequests:modelRequests()-requestsBefore,rootValidationVerified:true,busySaveVerified:true,saveFailurePreservationVerified:true,rootCreationVerified:true,backupRestartVerified:true,referenceZoomKeyboardVerified:true,directoryPickerVerified:true,pickerCases:5,defaultRootVerified:true,defaultRootFailureVerified:true,defaultRootBackupRestartVerified:true,defaultRoot,defaultTarget,root,target,errorLayouts,layouts,screenshots:captures,scope:'Real settings IPC with five isolated held directory responses; explicit and blank profile-owned roots, read-only default discovery, invalid request rejection before mkdir, held sanitized mkdir and atomic-save EIO with source preservation, real Git retries, two gzip restore cycles and normal restarts; six native zoom/theme cases. Workspace backups retain preferences and do not contain Git worktree files. Automatic deletion, upstream fetching, snapshots, complete reference parity and physical system picker interaction remain separate.'}};
}
