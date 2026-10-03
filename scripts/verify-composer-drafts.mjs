import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyComposerDrafts({ page, application, getApplication, directory, screenshots, calls, verified, waitForBridge, restart }) {
  await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && innerHeight === 540);
  let state = await page.evaluate(() => window.qiyao.load());
  const branch = state.threads.find((thread) => thread.forkedFrom?.kind === 'edit'); const original = state.threads.find((thread) => thread.id === branch.forkedFrom.threadId); assert.ok(branch && original);
  const provider = state.providers.find((item) => item.kind === 'ollama'); assert.ok(provider);
  const input = () => page.getByLabel('消息', { exact: true });
  const open = async (thread) => { await page.locator('.thread-list').getByRole('button', { name: thread.title, exact: true }).click(); };
  await open(branch); await input().fill('DRAFT_BRANCH_UNSENT'); await page.getByLabel('选择助手', { exact: true }).selectOption('writer');
  const attachment = join(directory, 'composer-draft.txt'); await writeFile(attachment, 'DURABLE_ATTACHMENT_EVIDENCE');
  await application.evaluateMain(`globalThis.qiyaoDraftOpenDialog=require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(attachment)}]});`);
  try { await page.getByRole('button', { name: '添加附件', exact: true }).click(); await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).waitFor(); }
  finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoDraftOpenDialog; delete globalThis.qiyaoDraftOpenDialog;"); }
  const skill = state.skills.find((item) => item.enabled);
  if (skill) { await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); const control = page.getByRole('dialog', { name: '工具与技能', exact: true }).getByRole('switch', { name: skill.name, exact: true }); if (!await control.isChecked()) await control.locator('..').click(); assert.equal(await control.isChecked(), true); await page.getByRole('button', { name: '完成', exact: true }).click(); }
  await open(original); await input().fill('DRAFT_ORIGINAL_UNSENT'); assert.equal(await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).count(), 0);
  await page.keyboard.press('Control+n'); await input().fill('DRAFT_NEW_UNSENT'); await open(branch); assert.equal(await input().inputValue(), 'DRAFT_BRANCH_UNSENT'); await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).waitFor(); assert.equal(await page.getByLabel('选择助手', { exact: true }).inputValue(), 'writer');
  const before = calls.length;
  verified('conversation switching keeps separate unsent/new-chat drafts, attachments and assistant/skill selections without sending');

  const backup = join(directory, 'composer-backup.json');
  await application.evaluateMain(`globalThis.qiyaoDraftSaveDialog=require('electron').dialog.showSaveDialog; require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
  try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); }
  finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.qiyaoDraftSaveDialog; delete globalThis.qiyaoDraftSaveDialog;"); }
  const savedBackup = JSON.parse(await readFile(backup, 'utf8')); const savedDraft = savedBackup.composerDrafts.find((draft) => draft.threadId === branch.id); assert.equal(savedDraft.text, 'DRAFT_BRANCH_UNSENT'); assert.equal(savedDraft.attachments[0].content, 'DURABLE_ATTACHMENT_EVIDENCE');
  await input().fill('REPLACED_BEFORE_RESTORE'); await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).click();
  await application.evaluateMain(`globalThis.qiyaoDraftOpenDialog=require('electron').dialog.showOpenDialog; globalThis.qiyaoDraftMessageDialog=require('electron').dialog.showMessageBox; require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]}); require('electron').dialog.showMessageBox=async()=>({response:1});`);
  try {
    await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '数据与备份', exact: true }).click(); await page.getByRole('button', { name: '恢复备份…', exact: true }).click();
    await waitForBridge(page, async (id) => (await window.qiyao.load()).composerDrafts.find((draft) => draft.threadId === id)?.text === 'DRAFT_BRANCH_UNSENT', branch.id);
    await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click(); await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).waitFor(); assert.equal(await input().inputValue(), 'DRAFT_BRANCH_UNSENT');
  } finally { await application.evaluateMain("require('electron').dialog.showOpenDialog=globalThis.qiyaoDraftOpenDialog; require('electron').dialog.showMessageBox=globalThis.qiyaoDraftMessageDialog; delete globalThis.qiyaoDraftOpenDialog; delete globalThis.qiyaoDraftMessageDialog;"); }
  state = await page.evaluate(() => window.qiyao.load()); const restoredDraft = state.composerDrafts.find((draft) => draft.threadId === branch.id);
  if (skill) { const restoredSkill = state.skills.find((item) => item.name === skill.name); assert.notEqual(restoredSkill.id, skill.id); assert.deepEqual(restoredDraft.skillIds, [restoredSkill.id]); }
  assert.equal(calls.length, before);
  await page.screenshot({ path: join(screenshots, '32-composer-draft-dark-narrow.png') });
  const geometry = await input().evaluate((element) => ({ top: element.getBoundingClientRect().top, bottom: element.closest('.composer-wrap').getBoundingClientRect().bottom, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth })); assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height); assert.equal(geometry.overflow, false);
  verified('native backup flushes the latest composer before export and restores draft attachments and remapped skill selections into the live UI');

  const workspacePath = join(directory, 'workspace.json'); const heldPath = join(directory, 'workspace.fixture-held.json');
  await rename(workspacePath, heldPath); await mkdir(workspacePath);
  await application.evaluateMain("globalThis.qiyaoDraftMessageDialog=require('electron').dialog.showMessageBox; globalThis.qiyaoDraftCloseErrors=[]; require('electron').dialog.showMessageBox=async(_parent,options)=>{ globalThis.qiyaoDraftCloseErrors.push(options.message); return {response:0}; };");
  try {
    await input().fill('DRAFT_LATEST_NATIVE_CLOSE'); await page.evaluate(() => window.qiyao.windowAction('close'));
    const deadline = Date.now() + 8000;
    while (!(await application.evaluateMain('globalThis.qiyaoDraftCloseErrors.length'))) { if (Date.now() > deadline) throw new Error('The failed draft close was not rejected'); await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.equal(await input().inputValue(), 'DRAFT_LATEST_NATIVE_CLOSE'); const failures = await application.evaluateMain('globalThis.qiyaoDraftCloseErrors'); assert.ok(failures.some((message) => ['草稿未能保存，窗口已保留。', '界面没有完成草稿保存。'].includes(message)), JSON.stringify(failures));
    const rejected = await page.evaluate(async () => { try { await window.qiyao.exportWorkspace(); return ''; } catch (error) { return error.message; } }); assert.match(rejected, /drafts could not be saved/i);
    await application.evaluateMain("require('electron').Menu.getApplicationMenu().items[0].submenu.items[0].click()");
    const menuDeadline = Date.now() + 7000;
    while (!(await application.evaluateMain("globalThis.qiyaoDraftCloseErrors.includes('备份未完成')"))) { if (Date.now() > menuDeadline) throw new Error('The native backup menu did not report its draft save failure'); await new Promise((resolve) => setTimeout(resolve, 50)); }
  } finally {
    await rmdir(workspacePath); await rename(heldPath, workspacePath);
    await application.evaluateMain("require('electron').dialog.showMessageBox=globalThis.qiyaoDraftMessageDialog; delete globalThis.qiyaoDraftMessageDialog; delete globalThis.qiyaoDraftCloseErrors;");
  }
  await application.evaluateMain("globalThis.qiyaoDraftMessageDialog=require('electron').dialog.showMessageBox; globalThis.qiyaoLateCloseMessages=[]; require('electron').dialog.showMessageBox=async(_parent,options)=>{ globalThis.qiyaoLateCloseMessages.push(options.message); return {response:0}; };");
  try {
    await page.evaluate(() => { globalThis.qiyaoSlowCloseCompleted = false; globalThis.qiyaoSlowCloseUnsubscribe = window.qiyao.onBeforeClose(() => new Promise((resolve) => setTimeout(() => { globalThis.qiyaoSlowCloseCompleted = true; resolve(); }, 6500))); });
    await page.evaluate(() => window.qiyao.windowAction('close')); await page.waitForFunction(() => globalThis.qiyaoSlowCloseCompleted);
    assert.ok((await application.evaluateMain('globalThis.qiyaoLateCloseMessages')).includes('界面没有完成草稿保存。')); assert.equal(await input().inputValue(), 'DRAFT_LATEST_NATIVE_CLOSE');
    assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().filter(window=>window.webContents.getURL().startsWith('qiyao://app/')).length"), 1);
  } finally {
    await page.evaluate(() => { globalThis.qiyaoSlowCloseUnsubscribe(); delete globalThis.qiyaoSlowCloseUnsubscribe; delete globalThis.qiyaoSlowCloseCompleted; });
    await application.evaluateMain("require('electron').dialog.showMessageBox=globalThis.qiyaoDraftMessageDialog; delete globalThis.qiyaoDraftMessageDialog; delete globalThis.qiyaoLateCloseMessages;");
  }
  verified('a timed-out native close retains the window after cancellation and safely ignores its late successful draft-save receipt');
  page = await restart(); application = getApplication(); assert.equal(await input().inputValue(), 'DRAFT_LATEST_NATIVE_CLOSE'); await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).waitFor();
  state = await page.evaluate(() => window.qiyao.load()); assert.equal(state.activeThreadId, branch.id); assert.equal(state.composerDrafts.find((draft) => !draft.threadId)?.text, 'DRAFT_NEW_UNSENT'); assert.equal(state.composerDrafts.find((draft) => draft.threadId === original.id)?.text, 'DRAFT_ORIGINAL_UNSENT');
  verified('failed native draft saves keep the window and entered text, prevent backup, and recover latest text/attachments/active conversation after a real close and restart');

  await page.evaluate((url) => window.qiyao.saveProvider({ id: 'draft-no-key', name: 'Draft missing key', kind: 'openai', endpoint: url, models: ['verification-model'], hasKey: false }), provider.endpoint); await page.reload(); await input().waitFor();
  await page.getByLabel('模型提供商', { exact: true }).selectOption('draft-no-key'); await page.getByRole('button', { name: '发送消息', exact: true }).click(); await page.getByRole('alert').getByText(/API key/).waitFor();
  assert.equal(await input().inputValue(), 'DRAFT_LATEST_NATIVE_CLOSE'); assert.equal(calls.length, before); assert.equal((await page.evaluate(() => window.qiyao.load())).threads.find((thread) => thread.id === branch.id).messages.length, branch.messages.length);
  await page.getByLabel('模型提供商', { exact: true }).selectOption(provider.id); await page.getByLabel('选择助手', { exact: true }).selectOption('');
  if (await page.getByRole('button', { name: '选择工具与技能', exact: true }).count()) { await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); const switches = page.getByRole('dialog', { name: '工具与技能', exact: true }).getByRole('switch', { checked: true }); while (await switches.count()) await switches.first().locator('..').click(); await page.getByRole('button', { name: '完成', exact: true }).click(); }
  await application.evaluateMain(`globalThis.qiyaoDraftRename=require('node:fs/promises').rename; globalThis.qiyaoDraftWriteHeld=false; globalThis.qiyaoDraftWriteReleased=false; require('node:fs/promises').rename=async(from,to)=>{ if(!globalThis.qiyaoDraftWriteHeld && String(to).startsWith(${JSON.stringify(join(directory, 'workspace.'))})) { globalThis.qiyaoDraftWriteHeld=true; await new Promise(resolve=>{globalThis.qiyaoDraftWriteRelease=resolve;}); globalThis.qiyaoDraftWriteReleased=true; } return globalThis.qiyaoDraftRename(from,to); };`);
  try {
    await input().fill('DRAFT_SEND_WHILE_NAVIGATING'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const heldDeadline = Date.now() + 8000; while (!(await application.evaluateMain('globalThis.qiyaoDraftWriteHeld'))) { if (Date.now() >= heldDeadline) throw new Error('The draft write did not reach the controlled persistence boundary.'); await new Promise((resolve) => setTimeout(resolve, 50)); }
    await page.keyboard.press('Control+n'); await input().fill('DRAFT_NEW_DURING_SEND');
    assert.deepEqual(await application.evaluateMain('({held:globalThis.qiyaoDraftWriteHeld,released:globalThis.qiyaoDraftWriteReleased})'), { held: true, released: false });
    await application.evaluateMain('globalThis.qiyaoDraftWriteRelease()');
    await waitForBridge(page, async (id) => { const state = await window.qiyao.load(); return !state.composerDrafts.some((draft) => draft.threadId === id) && state.threads.find((thread) => thread.id === id)?.messages.at(-1)?.status === 'complete'; }, branch.id);
    assert.equal(await input().inputValue(), 'DRAFT_NEW_DURING_SEND'); await open(branch);
  } finally { await application.evaluateMain("globalThis.qiyaoDraftWriteRelease?.(); require('node:fs/promises').rename=globalThis.qiyaoDraftRename; delete globalThis.qiyaoDraftRename; delete globalThis.qiyaoDraftWriteHeld; delete globalThis.qiyaoDraftWriteReleased; delete globalThis.qiyaoDraftWriteRelease;"); }
  assert.equal(await input().inputValue(), ''); assert.equal(await page.getByRole('button', { name: '移除 composer-draft.txt', exact: true }).count(), 0); assert.ok(JSON.stringify(calls.at(-1).messages).includes('DURABLE_ATTACHMENT_EVIDENCE'));
  await input().fill('DRAFT_DELETE_MUST_NOT_RETURN'); await page.getByRole('button', { name: '删除聊天', exact: true }).click(); await page.getByRole('dialog', { name: '删除聊天？', exact: true }).getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('heading', { name: '让想法，有处落地。' }).waitFor();
  state = await page.evaluate(() => window.qiyao.load()); assert.ok(!state.threads.some((thread) => thread.id === branch.id) && !state.composerDrafts.some((draft) => draft.threadId === branch.id)); assert.equal(await input().inputValue(), 'DRAFT_NEW_DURING_SEND');
  verified('provider validation keeps the native draft; sending during navigation consumes its original draft once without overwriting new input, and deletion removes only its owner');
  return page;
}
