import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window=>!window.isDestroyed()&&window.webContents.getURL().startsWith('qiyao://app/')&&new URL(window.webContents.getURL()).searchParams.get('view')!=='quick-chat')";

export async function verifyMemories({ page, application, directory, screenshots, projectDirectory, waitForBridge, verified }) {
  const captures = ['memory-settings-light.png', 'memory-settings-dark.png'], deletionLayouts = [];
  async function capture(name) {
    await page.mouse.move(1, 1); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async()=>{const window=${mainWindow};return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    const filename = `memory-delete-${name}-shell.png`; await writeFile(join(screenshots, filename), bytes); captures.push(filename);
  }
  const projectId = 'memory-verification-project';
  await page.evaluate(async ({ projectId, projectDirectory }) => {
    await window.qiyao.saveProject({ id: projectId, name: '记忆验证项目', path: projectDirectory, instructions: '', createdAt: 1 });
  }, { projectId, projectDirectory });
  await page.reload();
  await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '记忆', exact: true }).click();
  await dialog.getByRole('button', { name: '添加记忆', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: '保存记忆', exact: true }).isDisabled(), true);
  const content = '记忆验证：保留中文与 emoji 😀 <img src=x onerror=alert(1)>';
  await dialog.getByLabel('记忆内容', { exact: true }).fill(content);
  await dialog.getByLabel('适用范围', { exact: true }).selectOption(projectId);
  await dialog.getByRole('button', { name: '保存记忆', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.load()).memories.some((item) => item.projectId === 'memory-verification-project'));
  const item = (await page.evaluate(() => window.qiyao.load())).memories.find((entry) => entry.projectId === projectId);
  assert.ok(item); assert.equal(item.content, content); assert.equal(await dialog.locator('img').count(), 0);
  const persisted = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); assert.deepEqual(persisted.memories.find((entry) => entry.id === item.id), item);
  await dialog.getByRole('button', { name: new RegExp('^记忆验证：') }).click();
  await dialog.getByLabel('适用范围', { exact: true }).selectOption('');
  await dialog.locator('.toggle-label').filter({ hasText: '在后续聊天中使用' }).click();
  assert.equal(await dialog.getByRole('switch', { name: '在后续聊天中使用', exact: true }).isChecked(), false);
  await dialog.getByRole('button', { name: '保存记忆', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.load()).memories.some((entry) => entry.content.startsWith('记忆验证：') && !entry.enabled && !entry.projectId));
  verified('memory settings persist explicit Unicode entries, escape markup, edit scope and disable future use');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (theme) => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await application.resize(theme === 'light' ? 1280 : 760, theme === 'light' ? 840 : 540);
    await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click(); await dialog.getByRole('button', { name: '记忆', exact: true }).click();
    await dialog.getByLabel('搜索记忆', { exact: true }).fill('不存在的记忆'); await dialog.getByText('没有匹配的记忆', { exact: true }).waitFor();
    await dialog.getByLabel('搜索记忆', { exact: true }).fill('记忆验证');
    await dialog.getByRole('button', { name: new RegExp('^记忆验证：') }).waitFor();
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: join(screenshots, `memory-settings-${theme}.png`) });
  }
  verified('memory search and disabled scope survive reload in light and narrow dark settings');
  await dialog.getByRole('button', { name: `删除记忆 ${content}`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除记忆？', exact: true }); await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await page.evaluate(() => window.qiyao.load())).memories.some((entry) => entry.id === item.id));
  const remove = () => dialog.getByRole('button', { name: `删除记忆 ${content}`, exact: true });
  await remove().click(); assert.equal(await confirmation.getByRole('button', { name: '取消', exact: true }).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Enter'); await confirmation.waitFor({ state: 'hidden' }); assert.equal(await remove().evaluate(element => document.activeElement === element), true);
  await remove().click(); await page.keyboard.press('Escape'); await confirmation.waitFor({ state: 'hidden' }); assert.equal(await remove().evaluate(element => document.activeElement === element), true);
  const beforeFailure = await readFile(join(directory, 'workspace.json'));
  await application.evaluateMain(`(()=>{const handlers=require('electron').ipcMain._invokeHandlers,original=handlers.get('qiyao:invoke');let release;const held=new Promise(resolve=>{release=resolve;});globalThis.nookMemoryDeleteTest={original,release,entered:false,calls:0};handlers.set('qiyao:invoke',async(event,method,...args)=>{if(method==='removeMemory'){globalThis.nookMemoryDeleteTest.entered=true;globalThis.nookMemoryDeleteTest.calls++;await held;throw new Error('删除记忆失败，请重试。');}return original(event,method,...args);});})()`);
  try {
    await remove().click(); await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await waitForBridge(page, () => document.querySelector('.memory-delete-dialog .modal-footer button')?.disabled === true);
    assert.equal(await application.evaluateMain('globalThis.nookMemoryDeleteTest.entered'), true);
    for (const name of ['取消', '确认删除', '关闭']) assert.equal(await confirmation.getByRole('button', { name, exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape'); assert.equal(await confirmation.isVisible(), true); await capture('pending');
    await application.evaluateMain('globalThis.nookMemoryDeleteTest.release()'); await confirmation.getByRole('alert').waitFor();
    assert.equal(await confirmation.getByRole('alert').textContent(), '删除未完成，请重试。'); assert.equal(await confirmation.locator('.memory-delete-content').textContent(), content);
    assert.equal(await confirmation.getByRole('button', { name: '确认删除', exact: true }).isEnabled(), true);
    assert.equal(await application.evaluateMain('globalThis.nookMemoryDeleteTest.calls'), 1); assert.deepEqual(await readFile(join(directory, 'workspace.json')), beforeFailure);
    await capture('failure'); await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.getByRole('button', { name: '关闭提示', exact: true }).click();
  } finally {
    await application.evaluateMain("(()=>{const test=globalThis.nookMemoryDeleteTest;if(test){test.release();require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',test.original);delete globalThis.nookMemoryDeleteTest;}})()");
  }
  verified('memory deletion defaults to cancel, restores trigger focus, blocks dismissal while pending and retains exact memory and persisted bytes after one failed delete');
  const currentMemory = (await page.evaluate(() => window.qiyao.load())).memories.find(entry => entry.id === item.id);
  const longContent = ('记忆验证：中文😀 <img src=x onerror=alert(1)>\n' + 'LONG_UNBROKEN_MEMORY_'.repeat(12) + '\n').repeat(7).slice(0, 2000).trim();
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await dismissModalWithEscape(page, dialog);
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await waitForBridge(page, theme => document.documentElement.dataset.theme === theme, theme);
    await application.resize(760, 540); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.keyboard.press('Control+,'); await dialog.waitFor(); await dialog.getByRole('button', { name: '记忆', exact: true }).click();
    await remove().click(); await confirmation.waitFor(); await capture(`${theme}-${zoom}-short`);
    const geometry = await confirmation.evaluate(element => { const rect=element.getBoundingClientRect(),style=getComputedStyle(element),heading=getComputedStyle(element.querySelector('h2')),body=element.querySelector('.modal-content'),footer=element.querySelector('.modal-footer'),buttons=[...footer.querySelectorAll('button')];return {width:rect.width,expectedWidth:Math.min(520,innerWidth*.92),radius:style.borderRadius,heading:{size:heading.fontSize,lineHeight:heading.lineHeight,weight:heading.fontWeight,spacing:heading.letterSpacing},contained:rect.left>=-1&&rect.top>=-1&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,bounded:rect.height<=innerHeight*.92+1,bodyPadding:getComputedStyle(body).paddingLeft,footerPadding:getComputedStyle(footer).paddingTop,buttonsVisible:buttons.length===2&&buttons.every(button=>{const box=button.getBoundingClientRect();return button.offsetHeight>=32&&box.left>=rect.left&&box.right<=rect.right&&box.top>=rect.top&&box.bottom<=rect.bottom;}),cancelFocused:document.activeElement===buttons[0],closeControls:element.querySelectorAll('.modal-header button').length}; });
    assert.ok(Math.abs(geometry.width-geometry.expectedWidth)<1); assert.equal(geometry.radius,'20px'); assert.deepEqual(geometry.heading,{size:'20px',lineHeight:'28px',weight:'590',spacing:'-0.36px'});
    assert.equal(geometry.bodyPadding,'20px'); assert.equal(geometry.footerPadding,'20px'); for(const flag of ['contained','bounded','buttonsVisible','cancelFocused'])assert.equal(geometry[flag],true,`${theme}/${zoom} ${flag}`);assert.equal(geometry.closeControls,1);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(async memory => { await window.qiyao.saveMemory(memory); }, {...currentMemory,content:longContent});
    await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor(); await page.keyboard.press('Control+,'); await dialog.waitFor(); await dialog.getByRole('button', { name: '记忆', exact: true }).click();
    await dialog.getByRole('button', { name: `删除记忆 ${longContent.slice(0,120)}`, exact:true }).click();
    assert.equal(await confirmation.locator('.memory-delete-content').textContent(),longContent); assert.equal(await confirmation.locator('img').count(),0);
    const overflow = await confirmation.locator('.modal-content').evaluate(element=>({horizontal:element.scrollWidth>element.clientWidth+1,vertical:element.scrollHeight>element.clientHeight+1}));assert.equal(overflow.horizontal,false);assert.equal(overflow.vertical,true);
    await capture(`${theme}-${zoom}-long`); await confirmation.locator('.modal-content').evaluate(element=>{element.scrollTop=element.scrollHeight;}); await capture(`${theme}-${zoom}-scrolled`);
    assert.equal(await confirmation.getByRole('button', {name:'取消',exact:true}).isVisible(),true);
    await confirmation.getByRole('button', {name:'取消',exact:true}).click();await page.evaluate(async memory=>{await window.qiyao.saveMemory(memory);},currentMemory);
    deletionLayouts.push({theme,zoom,...geometry,longContentEscaped:true,independentScrollVerified:true});
  }
  await page.emulateMedia({reducedMotion:'no-preference'}); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`);
  await page.reload(); await page.getByLabel('消息',{exact:true}).waitFor();await page.keyboard.press('Control+,');await dialog.waitFor();await dialog.getByRole('button',{name:'记忆',exact:true}).click();
  verified('memory deletion uses the measured default dialog geometry in six light/dark zoom cases with reduced motion, escaped long text, independent scrolling and visible actions');
  await dialog.getByRole('button', { name: `删除记忆 ${content}`, exact: true }).click(); await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  await waitForBridge(page, async () => !(await window.qiyao.load()).memories.some((entry) => entry.content.startsWith('记忆验证：')));
  await confirmation.waitFor({ state: 'hidden' });
  await page.evaluate(async (projectId) => {
    await window.qiyao.saveMemory({ id: crypto.randomUUID(), content: 'PROJECT_REMOVAL_MEMORY', projectId, enabled: true });
    await window.qiyao.removeProject(projectId);
  }, projectId);
  assert.equal((await page.evaluate(() => window.qiyao.load())).memories.some((entry) => entry.projectId === projectId), false);
  await dismissModalWithEscape(page, dialog);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await page.reload(); await application.resize(1280, 840);
  verified('memory deletion supports cancel and confirm, and removing a project removes its scoped memories');
  return { checks: 5, screenshots: captures, deletionLayouts, safeCancelVerified:true, deleteFailureRetentionVerified:true, pendingDismissalLocked:true, longDeleteContentVerified:true, scope: 'Original three CRUD/scope/search/deletion groups retained, plus safe cancellation, held failure and six default-dialog theme/zoom long-content layouts. Engine scope and temporary-chat isolation remain separately tested. Physical DPI and full reference parity are separate.' };
}
