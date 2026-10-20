import assert from 'node:assert/strict';
import { verifyThreadActionCompletion } from './verify-thread-action-completion.mjs';

export async function verifyThreadActions({ page, application, threads, originalTitle, capture, directory }) {
  const [target, deleted] = threads.filter(thread => !thread.pinned && !thread.archived);
  const sidebar = page.locator('.thread-list'), row = title => sidebar.getByRole('button', { name: title, exact: true });
  const menu = () => page.getByRole('menu', { name: '聊天操作', exact: true }), renamed = `${target.title}_RENAMED`;
  const open = async title => { await row(title).focus(); await row(title).press('Shift+F10'); await menu().waitFor(); };
  await open(target.title);
  assert.equal(await menu().getByRole('menuitem', { name: '重命名', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('End'); assert.equal(await menu().getByRole('menuitem', { name: '删除', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('ArrowDown'); assert.equal(await menu().getByRole('menuitem', { name: '重命名', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Escape'); await menu().waitFor({ state: 'hidden' }); assert.equal(await row(target.title).evaluate(element => document.activeElement === element), true);
  await open(target.title); await page.getByLabel('消息', { exact: true }).click(); await menu().waitFor({ state: 'hidden' }); assert.equal(await page.getByLabel('消息', { exact: true }).evaluate(element => document.activeElement === element), true);
  await open(target.title); await page.keyboard.press('Tab'); await menu().waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem'), false);
  await sidebar.getByRole('button', { name: `聊天操作：${target.title}`, exact: true }).click(); await menu().getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名聊天', exact: true }); await rename.getByLabel('聊天名称', { exact: true }).fill(renamed);
  assert.equal(await application.evaluateMain(`(() => {const handlers=require('electron').ipcMain._invokeHandlers, original=handlers.get('qiyao:invoke'); if(typeof original!=='function')return false; globalThis.nookThreadActionFailure=original; handlers.set('qiyao:invoke',(event,method,...args)=>{if(method==='updateThreadMetadata'&&args[0]?.id===${JSON.stringify(target.id)})throw new Error('PRIVATE_THREAD_ACTION_FAILURE');return original(event,method,...args);});return true;})()`), true);
  try { await rename.getByRole('button', { name: '保存', exact: true }).click(); await rename.getByRole('alert').waitFor(); assert.equal(await rename.getByLabel('聊天名称', { exact: true }).inputValue(), renamed); assert.equal((await rename.textContent()).includes('PRIVATE_THREAD_ACTION_FAILURE'), false); assert.equal(await row(target.title).count(), 1); }
  finally { await application.evaluateMain(`(() => {require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',globalThis.nookThreadActionFailure);delete globalThis.nookThreadActionFailure;})()`); }
  await rename.getByRole('button', { name: '保存', exact: true }).click(); await rename.waitFor({ state: 'hidden' }); await row(renamed).waitFor(); assert.equal(await row(originalTitle).getAttribute('aria-current'), 'page');
  await row(renamed).click({ button: 'right' }); await menu().waitFor(); await capture('113-thread-actions-light.png');
  const bounds = await menu().evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }; }); assert.ok(bounds.left >= 8 && bounds.right <= bounds.width - 8 && bounds.top >= 8 && bounds.bottom <= bounds.height - 8, JSON.stringify(bounds));
  await menu().getByRole('menuitem', { name: '置顶', exact: true }).click(); await sidebar.getByRole('region', { name: '已置顶', exact: true }).getByRole('button', { name: renamed, exact: true }).waitFor();
  await open(renamed); await menu().getByRole('menuitem', { name: '取消置顶', exact: true }).click(); await sidebar.getByRole('region', { name: '最近聊天', exact: true }).getByRole('button', { name: renamed, exact: true }).waitFor();
  await open(renamed); await menu().getByRole('menuitem', { name: '归档', exact: true }).click(); await row(renamed).waitFor({ state: 'hidden' });
  await open(deleted.title); await menu().getByRole('menuitem', { name: '删除', exact: true }).click(); const confirmation = page.getByRole('dialog', { name: '删除聊天？', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' }); await row(deleted.title).waitFor();
  await open(deleted.title); await menu().getByRole('menuitem', { name: '删除', exact: true }).click(); await confirmation.getByRole('button', { name: '删除', exact: true }).click(); await confirmation.waitFor({ state: 'hidden' }); await row(deleted.title).waitFor({ state: 'hidden' });
  const state = await page.evaluate(async ids => { const state = await window.qiyao.load(); return { target: state.threads.find(thread => thread.id === ids[0]), deleted: state.threads.some(thread => thread.id === ids[1]) }; }, [target.id, deleted.id]);
  assert.equal(state.target.title, renamed); assert.equal(state.target.archived, true); assert.equal(state.target.pinned, false); assert.equal(state.deleted, false);
  assert.equal(await row(originalTitle).getAttribute('aria-current'), 'page'); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'CHAT_NAV_DRAFT_KEEP');
  const completion = await verifyThreadActionCompletion({ page, application, originalTitle, directory, capture });
  return { ...completion, keyboard: true, pointerContext: true, focusReturn: true, outsideDismissal: true, tabDismissal: true, renameFailureRetry: true, pinUnpin: true, archive: true, deleteConfirmation: true, noActivationOrDraftLoss: true };
}
