import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export async function verifyAssistantRecipes({ page, application, getApplication, directory, screenshots, calls, waitForBridge, verified, restart }) {
  const assistantId = randomUUID(); const prefix = 'RECIPE_ORIGINAL_DRAFT😀\n';
  const attachment = { id: 'recipe-context', name: '上下文.txt', content: 'RECIPE_ATTACHMENT_EXACT' };
  const content = '方式：{{风格}}\n内容：{{文本}}\n原型：{{__proto__}}\nRECIPE_NATIVE';
  const initialCalls = calls.length;
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  async function capture(name) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async () => { const window = ${mainWindow}; return { png: (await window.capturePage()).toPNG().toString('base64'), size: window.getContentSize() }; })()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size); assert.deepEqual(image.size, name.includes('-dark-') ? [760, 540] : [1280, 840]);
    await writeFile(join(screenshots, name), bytes);
  }
  await page.evaluate(async ({ assistantId, prefix, attachment }) => {
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
    await window.qiyao.saveAssistant({ id: assistantId, name: '配方助手😀', description: '明确使用时选择', instructions: 'RECIPE_ASSISTANT_INSTRUCTIONS' });
    await window.qiyao.saveComposerDraft({ text: prefix, attachments: [attachment], assistantId: 'general', model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: Date.now() });
    await window.qiyao.activateThread();
  }, { assistantId, prefix, attachment }); await page.reload(); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 840);
  const manager = async () => { await page.getByRole('button', { name: '助手', exact: true }).click(); await page.getByRole('tab', { name: '提示模板', exact: true }).click(); };
  const editor = () => page.getByRole('dialog', { name: '编辑提示模板', exact: true });
  const using = () => page.getByRole('dialog', { name: '使用提示模板', exact: true });
  await manager(); await page.getByRole('button', { name: '创建模板', exact: true }).click();
  await editor().getByLabel('模板名称', { exact: true }).fill('助手配方😀'); await editor().getByLabel('模板内容', { exact: true }).fill(content);
  await editor().getByLabel('模板助手', { exact: true }).selectOption(assistantId);
  await editor().getByText('变量设置：风格', { exact: true }).click();
  await editor().getByLabel('参数名称 风格', { exact: true }).fill('写作方式'); await editor().getByLabel('参数说明 风格', { exact: true }).fill('保留原文中的标记。');
  const choices = editor().getByLabel('下拉选项 风格', { exact: true }); await choices.fill('简洁'); await choices.press('End'); await choices.press('Enter'); await page.keyboard.insertText('展开');
  assert.equal(await choices.inputValue(), '简洁\n展开'); await editor().getByLabel('默认值 风格', { exact: true }).fill('简洁');
  await editor().getByText('变量设置：文本', { exact: true }).click(); await editor().getByText('参数 文本 必填', { exact: true }).click();
  await editor().getByText('变量设置：__proto__', { exact: true }).click(); await editor().getByLabel('默认值 __proto__', { exact: true }).fill('PROTO_LITERAL😀');
  await capture('126-assistant-recipe-parameters-light.png');
  await editor().locator('.modal-content').evaluate((element) => { element.scrollTop = 0; });
  await capture('126-assistant-recipe-editor-light.png'); await editor().getByRole('button', { name: '保存', exact: true }).click(); await editor().waitFor({ state: 'hidden' });
  let recipe = await page.evaluate(() => (window.qiyao.load()).then((state) => state.promptTemplates.find((item) => item.title === '助手配方😀')));
  assert.equal(recipe.assistantId, assistantId); assert.deepEqual(recipe.parameters.find((item) => item.key === '风格').choices, ['简洁', '展开']);
  assert.equal(recipe.parameters.find((item) => item.key === '文本').required, false); assert.equal(recipe.parameters.find((item) => item.key === '__proto__').defaultValue, 'PROTO_LITERAL😀');
  assert.equal(calls.length, initialCalls);
  const row = () => page.locator(`[data-template-id="${recipe.id}"]`);
  verified('native recipe editor selects an existing assistant and saves exact Unicode parameter names, hints, optional/default/prototype values and keyboard-entered choices without losing a newline or sending a model request');

  await row().getByRole('button', { name: '使用模板', exact: true }).click();
  assert.equal(await using().getByLabel('变量 写作方式', { exact: true }).inputValue(), '简洁'); assert.equal(await using().getByLabel('变量 文本', { exact: true }).inputValue(), '');
  assert.equal(await using().getByLabel('变量 __proto__', { exact: true }).inputValue(), 'PROTO_LITERAL😀'); await using().getByRole('button', { name: '取消', exact: true }).click();
  const beforeUse = await page.evaluate(() => window.qiyao.load()); const beforeDraft = beforeUse.composerDrafts.find((draft) => !draft.threadId);
  assert.equal(beforeDraft.text, prefix); assert.equal(beforeDraft.assistantId, 'general'); assert.deepEqual(beforeDraft.attachments, [attachment]);
  await row().getByRole('button', { name: '使用模板', exact: true }).click(); await using().getByLabel('变量 写作方式', { exact: true }).selectOption('展开');
  const literal = '字面 <img src="https://example.invalid/recipe"> $& {{风格}}\n😀'; await using().getByLabel('变量 文本', { exact: true }).fill(literal);
  const expanded = `方式：展开\n内容：${literal}\n原型：PROTO_LITERAL😀\nRECIPE_NATIVE`;
  assert.equal(await using().getByLabel('提示预览', { exact: true }).inputValue(), expanded); assert.equal(await using().locator('img').count(), 0);
  await using().getByRole('button', { name: '追加到草稿', exact: true }).click(); await using().waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), `${prefix}\n\n${expanded}`); assert.equal(await page.getByLabel('选择助手', { exact: true }).inputValue(), assistantId);
  await waitForBridge(page, async ({ text, assistantId }) => (await window.qiyao.load()).composerDrafts.some((draft) => !draft.threadId && draft.text === text && draft.assistantId === assistantId), { text: `${prefix}\n\n${expanded}`, assistantId });
  const inserted = (await page.evaluate(() => window.qiyao.load())).composerDrafts.find((draft) => !draft.threadId); assert.deepEqual(inserted.attachments, [attachment]); assert.equal(inserted.mode, 'chat'); assert.equal(inserted.model, ''); assert.equal(calls.length, initialCalls);
  verified('native choice/default/optional preview keeps markup inert and cancellation preserves the exact prior draft and assistant; explicit insertion atomically selects its linked assistant while retaining attachments and context with zero model requests');

  await manager(); await row().locator('.row-content').click(); await editor().getByLabel('模板名称', { exact: true }).fill('关联移除后重试😀');
  await page.evaluate((id) => window.qiyao.removeAssistant(id), assistantId); await editor().getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText(/The linked assistant no longer exists/).waitFor(); assert.equal(await editor().isVisible(), true); assert.equal(await editor().getByLabel('模板名称', { exact: true }).inputValue(), '关联移除后重试😀');
  const unbound = (await page.evaluate(() => window.qiyao.load())).promptTemplates.find((item) => item.id === recipe.id); assert.equal(unbound.assistantId, undefined); assert.equal(unbound.title, recipe.title); assert.deepEqual(unbound.parameters, recipe.parameters);
  await editor().getByLabel('模板助手', { exact: true }).selectOption('general'); await editor().getByRole('button', { name: '保存', exact: true }).click(); await editor().waitFor({ state: 'hidden' });
  recipe = (await page.evaluate(() => window.qiyao.load())).promptTemplates.find((item) => item.id === recipe.id); assert.equal(recipe.assistantId, 'general');
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540); await manager();
  const layout = [];
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction((width) => Math.abs(innerWidth - width) <= 2, 760 / zoom);
    await row().getByRole('button', { name: '使用模板', exact: true }).click(); const done = using().getByRole('button', { name: '追加到草稿', exact: true }); await done.focus();
    const geometry = await using().evaluate((dialog) => { const header = dialog.querySelector('.modal-header').getBoundingClientRect(); const footer = dialog.querySelector('.modal-footer').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, top: header.top, bottom: footer.bottom, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1); assert.equal(geometry.overflow, false); assert.equal(await done.evaluate((element) => element === document.activeElement), true); layout.push({ zoom, ...geometry });
    await capture(`127-assistant-recipe-dark-zoom-${Math.round(zoom * 100)}.png`);
    await dismissModalWithEscape(page, using()); assert.equal(await row().getByRole('button', { name: '使用模板', exact: true }).evaluate((element) => element === document.activeElement), true);
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); assert.equal(calls.length, initialCalls);
  verified('actual assistant removal clears only its recipe binding; a stale edit fails without discarding entered text or parameter metadata, valid retry succeeds, and dark minimum-window choice controls retain title/footer, native focus and Escape at three zoom levels');

  const backupPath = join(directory, 'assistant-recipes-backup.json.gz'); const normalized = JSON.parse(JSON.stringify(recipe));
  await application.evaluateMain(`globalThis.qiyaoRecipeSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>(${JSON.stringify({ canceled: false, filePath: backupPath })});`);
  try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); } finally { await application.evaluateMain('require("electron").dialog.showSaveDialog=globalThis.qiyaoRecipeSave'); }
  const backup = JSON.parse(gunzipSync(await readFile(backupPath)).toString('utf8')); assert.deepEqual(backup.promptTemplates.find((item) => item.id === recipe.id), normalized);
  await page.evaluate((id) => window.qiyao.removePromptTemplate(id), recipe.id);
  await application.evaluateMain(`globalThis.qiyaoRecipeOpen=require('electron').dialog.showOpenDialog;globalThis.qiyaoRecipeConfirm=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>(${JSON.stringify({ canceled: false, filePaths: [backupPath] })});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  try { const restored = await page.evaluate(() => window.qiyao.importWorkspace()); assert.deepEqual(restored.promptTemplates.find((item) => item.id === recipe.id), normalized); }
  finally { await application.evaluateMain('require("electron").dialog.showOpenDialog=globalThis.qiyaoRecipeOpen;require("electron").dialog.showMessageBox=globalThis.qiyaoRecipeConfirm'); }
  page = await restart(); application = getApplication(); const restored = await page.evaluate(() => window.qiyao.load()); assert.deepEqual(restored.promptTemplates.find((item) => item.id === recipe.id), normalized);
  const restoredDraft = restored.composerDrafts.find((draft) => !draft.threadId); assert.equal(restoredDraft.text, inserted.text); assert.deepEqual(restoredDraft.attachments, inserted.attachments); assert.equal(calls.length, initialCalls);
  verified('real gzip export/import and application restart preserve exact recipe association, parameter metadata, Unicode/prototype defaults and the existing rendered draft/attachments without requesting a model');
  return { page, result: { checks: 4, recipeModelRequests: 0, assistantBindingVerified: true, defaultOptionalChoicesVerified: true, deletedAssistantRecoveryVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true, layout,
    screenshots: ['126-assistant-recipe-editor-light.png', '126-assistant-recipe-parameters-light.png', ...[100, 125, 150].map((zoom) => `127-assistant-recipe-dark-zoom-${zoom}.png`)],
    scope: 'Actual library/composer recipe forms, keyboard choice editing, literal default/optional/prototype expansion, explicit assistant selection and untouched context, actual stale-assistant rejection/retry, three native zoom/focus/Escape checks, real gzip backup and normal restart. Picker/confirmation responses are isolated fixtures; physical picker and wider platform/accessibility checks remain separate.' } };
}
