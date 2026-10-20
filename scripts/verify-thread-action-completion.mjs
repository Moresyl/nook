import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export async function verifyThreadActionCompletion({ page, application, originalTitle, directory, capture }) {
  const input = () => page.getByLabel('消息', { exact: true }), menu = () => page.getByRole('menu', { name: '聊天操作', exact: true });
  const owner = await page.evaluate(async () => { const state = await window.qiyao.load(); return state.threads.find(thread => thread.id === state.activeThreadId); });
  assert.equal(owner.title, originalTitle);
  await page.locator('.workspace-header .thread-title').click();
  const rename = page.getByRole('dialog', { name: '重命名聊天', exact: true }), name = rename.getByLabel('聊天名称', { exact: true });
  const changedTitle = `${originalTitle}_HEADER`; await name.fill(changedTitle);
  assert.equal(await application.evaluateMain(`(() => {const handlers=require('electron').ipcMain._invokeHandlers, original=handlers.get('qiyao:invoke');if(typeof original!=='function')return false;let release;const held=new Promise(resolve=>{release=resolve;});const fixture=globalThis.nookHeaderRenameFailure={original,release,calls:0};handlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='updateThreadMetadata'&&args[0]?.id===${JSON.stringify(owner.id)}){fixture.calls++;await held;throw new Error('PRIVATE_HEADER_RENAME_FAILURE');}return original(event,method,...args);});return true;})()`), true);
  try {
    await name.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    assert.equal(await application.evaluateMain('globalThis.nookHeaderRenameFailure.calls'), 0);
    await rename.getByRole('button', { name: '保存', exact: true }).click();
    await rename.getByRole('button', { name: '正在保存…', exact: true }).waitFor();
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); assert.equal(await rename.isVisible(), true);
    assert.equal(await application.evaluateMain('globalThis.nookHeaderRenameFailure.calls'), 1);
    await application.evaluateMain('globalThis.nookHeaderRenameFailure.release()'); await rename.getByRole('alert').waitFor();
    assert.equal(await name.inputValue(), changedTitle); assert.equal((await rename.textContent()).includes('PRIVATE_HEADER_RENAME_FAILURE'), false);
    await page.waitForFunction(() => document.querySelector('dialog[open] input[aria-label="聊天名称"]') === document.activeElement);
    assert.equal(await name.getAttribute('aria-describedby'), await rename.getByRole('alert').getAttribute('id'));
    const errorStyle = await rename.getByRole('alert').evaluate(element => ({ color: getComputedStyle(element).color, textColor: getComputedStyle(element.parentElement).color, margin: getComputedStyle(element).marginTop })); assert.notEqual(errorStyle.color, errorStyle.textColor); assert.equal(errorStyle.margin, '8px');
    await capture('115-header-rename-retry-light.png');
  } finally { await application.evaluateMain(`(() => {const fixture=globalThis.nookHeaderRenameFailure;fixture.release();require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',fixture.original);delete globalThis.nookHeaderRenameFailure;})()`); }
  await name.press('Enter'); await rename.waitFor({ state: 'hidden' }); await page.locator('.workspace-header .thread-title').getByText(changedTitle, { exact: true }).waitFor();
  await page.locator('.workspace-header .thread-title').click(); await name.fill(originalTitle); await name.press('Enter'); await rename.waitFor({ state: 'hidden' });
  const exportPath = join(directory, 'sidebar-menu-export.md');
  await application.evaluateMain("globalThis.nookSidebarSaveDialog=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:true});");
  try {
    const row = page.locator('.thread-list .thread-row[aria-current="page"]'); await row.focus(); await row.press('Shift+F10');
    await menu().getByRole('menuitem', { name: '导出', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some(element => element.textContent === '导出' && !element.disabled));
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem' && document.activeElement.textContent === '导出');
    assert.equal(await menu().isVisible(), true); await assert.rejects(readFile(exportPath), { code: 'ENOENT' });
    await application.evaluateMain(`require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(directory)}});`);
    await menu().getByRole('menuitem', { name: '导出', exact: true }).click(); await menu().getByRole('alert').waitFor();
    assert.equal((await menu().textContent()).includes(directory), false);
    await application.evaluateMain(`require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(exportPath)}});`);
    await menu().getByRole('menuitem', { name: '导出', exact: true }).click(); await menu().waitFor({ state: 'hidden' });
    const markdown = await readFile(exportPath, 'utf8'); assert.ok(markdown.startsWith(`# ${originalTitle}\n\n`));
    for (const message of owner.messages) assert.ok(markdown.includes(message.content));
    assert.equal((markdown.match(/^## You$/gm) ?? []).length, owner.messages.filter(message => message.role === 'user').length);
    assert.equal((markdown.match(/^## Nook$/gm) ?? []).length, owner.messages.filter(message => message.role !== 'user').length);
    assert.equal(markdown.includes('CHAT_NAV_DRAFT_KEEP'), false); assert.equal(markdown.includes('ORIGINAL_FIND_DRAFT_ATTACHMENT'), false);
    console.log('Sidebar menu export evidence', JSON.stringify({ bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex'), messages: owner.messages.length }));
  } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookSidebarSaveDialog;delete globalThis.nookSidebarSaveDialog;"); }
  assert.equal(await input().inputValue(), 'CHAT_NAV_DRAFT_KEEP');
  await page.getByRole('button', { name: '临时聊天', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.thread-list .thread-row[aria-current="page"]')?.textContent.includes('临时'));
  const temporaryId = await page.evaluate(async () => (await window.qiyao.load()).activeThreadId); assert.notEqual(temporaryId, owner.id);
  await input().fill('DELETE_CURRENT_DRAFT');
  const currentRow = () => page.locator('.thread-list .thread-row[aria-current="page"]'); await currentRow().focus(); await currentRow().press('Shift+F10');
  await menu().getByRole('menuitem', { name: '删除', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: '删除聊天？', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' }); assert.equal(await input().inputValue(), 'DELETE_CURRENT_DRAFT');
  await currentRow().focus(); await currentRow().press('Shift+F10'); await menu().getByRole('menuitem', { name: '删除', exact: true }).click(); await confirmation.getByRole('button', { name: '删除', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: '今天想做些什么？', exact: true }).waitFor();
  const retained = await page.evaluate(async ({ temporaryId, ownerId }) => { const state = await window.qiyao.load(); return { temporary: state.threads.some(thread => thread.id === temporaryId), draft: state.composerDrafts.some(draft => draft.threadId === temporaryId), owner: state.threads.find(thread => thread.id === ownerId) }; }, { temporaryId, ownerId: owner.id });
  assert.equal(retained.temporary, false); assert.equal(retained.draft, false); assert.deepEqual(retained.owner.messages, owner.messages);
  await page.keyboard.press('Control+k'); const palette = page.getByRole('dialog', { name: '搜索与命令', exact: true }); await palette.getByRole('combobox').fill(originalTitle); await palette.getByRole('option', { name: originalTitle, exact: true }).click(); await palette.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息"]')?.value === 'CHAT_NAV_DRAFT_KEEP');
  await page.getByRole('button', { name: '从这里创建分支', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('.workspace-header .thread-title')?.textContent.includes('· 分支'));
  const branchId = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.forkedFrom?.threadId === id)?.id, owner.id); assert.ok(branchId && branchId !== owner.id);
  await input().fill('DELETE_PERSISTENT_CURRENT_DRAFT');
  await currentRow().focus(); await currentRow().press('Shift+F10'); await menu().getByRole('menuitem', { name: '删除', exact: true }).click();
  await confirmation.getByRole('button', { name: '删除', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' }); await page.getByRole('heading', { name: '今天想做些什么？', exact: true }).waitFor();
  const persisted = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
  assert.equal(persisted.threads.some(thread => thread.id === branchId), false); assert.equal(persisted.composerDrafts.some(draft => draft.threadId === branchId), false); assert.deepEqual(persisted.threads.find(thread => thread.id === owner.id).messages, owner.messages);
  await page.keyboard.press('Control+k'); await palette.getByRole('combobox').fill(originalTitle); await palette.getByRole('option', { name: originalTitle, exact: true }).click(); await palette.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="消息"]')?.value === 'CHAT_NAV_DRAFT_KEEP');
  return { headerRenameFailureRetry: true, headerRenameBusyGuard: true, renameCompositionGuard: true, exportCancel: true, exportWriteFailureRetry: true, exportActualMarkdown: true, currentDeleteConfirmation: true, currentPersistentDelete: true, currentDraftRemovedOtherDraftRetained: true };
}
