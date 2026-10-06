import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export async function verifyPromptTransfer({ page, application, getApplication, directory, screenshots, calls, waitForBridge, verified, restart }) {
  const firstId = randomUUID(); const secondId = randomUUID(); const unboundId = randomUUID(); const assistantId = randomUUID();
  const initialCalls = calls.length; const draftText = 'PROMPT_TRANSFER_ORIGINAL😀\n保持草稿';
  const attachment = { id: 'prompt-transfer-context', name: '上下文😀.txt', content: 'PROMPT_TRANSFER_CONTEXT' };
  const instructions = 'PROMPT_TRANSFER_INSTRUCTIONS😀\n<img src="https://example.invalid/prompt-profile" onerror="alert(1)">\n' + '完整保留关联助手指令。'.repeat(120);
  const content = '风格：{{风格}}\n文本：{{文本}}\n原型：{{__proto__}}\n<img src="https://example.invalid/prompt-body">\n' + '完整保留模板原文。'.repeat(150);
  const parameters = [{ key: '风格', label: '写作方式', description: '选择后再手动使用', required: true, defaultValue: '简洁😀', choices: ['简洁😀', '完整'] }, { key: '文本', description: '可留空的文字', required: false }, { key: '__proto__', required: true, defaultValue: 'PROTO_LITERAL😀' }];
  const first = { id: firstId, title: '可分享模板😀', description: '保留原文与参数', content, parameters, assistantId };
  const second = { ...first, id: secondId, title: '共享助手模板😀' };
  const unbound = { id: unboundId, title: '未关联模板😀', description: '保持当前助手', content: 'UNBOUND_LITERAL {{文本}}', parameters: [{ key: '文本', required: false }] };
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  const manager = async () => { await page.getByRole('button', { name: '助手', exact: true }).click(); await page.getByRole('tab', { name: '提示模板', exact: true }).click(); };
  const importing = () => page.getByRole('dialog', { name: '导入提示模板', exact: true });
  const inspect = () => page.evaluate(async () => { const state = await window.qiyao.load(); return JSON.parse(JSON.stringify({ assistants: state.assistants, promptTemplates: state.promptTemplates, composerDrafts: state.composerDrafts.map(({ updatedAt, ...draft }) => draft), activeThreadId: state.activeThreadId })); });
  const ready = () => waitForBridge(page, () => [...document.querySelectorAll('button')].find((button) => button.textContent === '导入模板')?.disabled === false);
  async function capture(name) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const image = await application.evaluateMain(`(async () => { const window = ${mainWindow}; return { png: (await window.capturePage()).toPNG().toString('base64'), size: window.getContentSize() }; })()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], image.size);
    assert.deepEqual(image.size, name.includes('-dark-') ? [760, 540] : [1280, 840]); await writeFile(join(screenshots, name), bytes);
  }
  const fingerprint = async () => createHash('sha256').update(await readFile(join(directory, 'workspace.json'))).digest('hex');
  await page.evaluate(async ({ assistantId, instructions, first, second, unbound, draftText, attachment }) => {
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
    await window.qiyao.saveAssistant({ id: assistantId, name: state.assistants.find((item) => item.id === 'general').name, description: '共享配置副本', instructions });
    for (const template of [first, second, unbound]) await window.qiyao.savePromptTemplate(template);
    await window.qiyao.saveComposerDraft({ text: draftText, attachments: [attachment], assistantId: 'general', model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], knowledgeCollectionIds: [], updatedAt: Date.now() });
    await window.qiyao.activateThread();
  }, { assistantId, instructions, first, second, unbound, draftText, attachment });
  await page.reload(); await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 840); await manager();
  const original = await inspect(); const originalDraft = original.composerDrafts.find((draft) => !draft.threadId);
  assert.equal(originalDraft.text, draftText); assert.deepEqual(originalDraft.attachments, [attachment]);
  const singlePath = join(directory, '单个模板😀.json'); const allPath = join(directory, '全部模板😀.json.gz');
  const inputPath = join(directory, '选择模板😀.data'); const plainPath = join(directory, '选择模板😀.json'); const invalidPath = join(directory, '无效模板😀.json');
  await application.evaluateMain('globalThis.qiyaoPromptTransferSave=require("electron").dialog.showSaveDialog;globalThis.qiyaoPromptTransferOpen=require("electron").dialog.showOpenDialog;');
  const pickSave = (path, canceled = false) => application.evaluateMain(`require('electron').dialog.showSaveDialog=async()=>(${JSON.stringify({ canceled, filePath: path })});`);
  const pickOpen = (path, canceled = false) => application.evaluateMain(`require('electron').dialog.showOpenDialog=async()=>(${JSON.stringify({ canceled, filePaths: path ? [path] : [] })});`);
  let added;
  const layout = [];
  try {
    await pickSave(singlePath); await page.getByRole('button', { name: `导出模板 ${first.title}`, exact: true }).click(); await ready();
    const single = JSON.parse(await readFile(singlePath, 'utf8'));
    assert.equal(single.format, 'qiyao-prompt-templates'); assert.equal(single.version, 1); assert.equal(single.templates.length, 1); assert.equal(single.assistants.length, 1);
    assert.deepEqual(single.templates[0], { title: first.title, description: first.description, content, parameters, assistantIndex: 0 });
    assert.equal(single.assistants[0].instructions, instructions);
    await pickSave(allPath); await page.getByRole('button', { name: '导出全部模板', exact: true }).click(); await ready();
    const all = JSON.parse(gunzipSync(await readFile(allPath)).toString('utf8')); assert.equal(all.templates.length, original.promptTemplates.length);
    const shared = all.templates.filter((item) => [first.title, second.title].includes(item.title)); assert.equal(shared.length, 2); assert.equal(shared[0].assistantIndex, shared[1].assistantIndex);
    assert.equal(all.assistants.filter((item) => item.instructions === instructions).length, 1);
    for (const template of all.templates) { assert.equal(Object.hasOwn(template, 'id'), false); assert.equal(Object.hasOwn(template, 'assistantId'), false); }
    for (const assistant of all.assistants) assert.deepEqual(Object.keys(assistant).sort(), ['description', 'instructions', 'name']);
    await pickSave(inputPath + '.gz'); assert.equal(await page.evaluate((ids) => window.qiyao.exportPrompts(ids), [firstId, secondId, unboundId]), true);
    const exported = gunzipSync(await readFile(inputPath + '.gz')); const bundle = JSON.parse(exported.toString('utf8')); assert.equal(bundle.templates.length, 3); assert.equal(bundle.assistants.length, 1);
    await writeFile(inputPath, await readFile(inputPath + '.gz')); await writeFile(plainPath, exported);
    await pickSave(undefined, true); await page.getByRole('button', { name: '导出全部模板', exact: true }).click(); await ready();
    await pickOpen(undefined, true); await page.getByRole('button', { name: '导入模板', exact: true }).click(); await ready(); assert.equal(await importing().count(), 0);
    assert.deepEqual(await inspect(), original); assert.equal(calls.length, initialCalls); await capture('128-prompt-transfer-library-light.png');
    verified('native single/all template export and actual selected gzip data preserve complete parameters, deduplicate shared assistant profiles, omit source IDs and preserve the workspace on picker cancellation');

    await pickOpen(plainPath); await page.getByRole('button', { name: '导入模板', exact: true }).click(); await importing().waitFor();
    assert.equal(await importing().getByLabel('模板内容', { exact: true }).inputValue(), content); assert.equal(await importing().getByLabel('助手工作指令', { exact: true }).inputValue(), instructions);
    await importing().getByText('变量：风格 · 写作方式 · 必填', { exact: true }).click(); assert.equal(await importing().getByLabel('下拉选项 风格', { exact: true }).inputValue(), '简洁😀\n完整');
    assert.equal(await importing().getByLabel('默认值 风格', { exact: true }).inputValue(), '简洁😀');
    await importing().getByText('变量：__proto__ · 必填', { exact: true }).click(); assert.equal(await importing().getByLabel('默认值 __proto__', { exact: true }).inputValue(), 'PROTO_LITERAL😀');
    await importing().getByLabel('查看模板', { exact: true }).selectOption('2'); assert.equal(await importing().getByLabel('关联助手', { exact: true }).inputValue(), '未关联助手');
    await importing().getByLabel('查看模板', { exact: true }).selectOption('0'); assert.equal(await importing().locator('img').count(), 0); await capture('129-prompt-import-preview-light.png');
    await importing().getByRole('button', { name: '取消', exact: true }).click(); assert.deepEqual(await inspect(), original);
    await pickOpen(inputPath); await page.getByRole('button', { name: '导入模板', exact: true }).click(); await importing().waitFor(); assert.equal(await importing().getByLabel('模板内容', { exact: true }).inputValue(), content);
    await dismissModalWithEscape(page, importing()); assert.deepEqual(await inspect(), original);
    await writeFile(invalidPath, JSON.stringify({ ...bundle, credentials: { key: 'PROMPT_PRIVATE_FIXTURE' } })); await pickOpen(invalidPath); await page.getByRole('button', { name: '导入模板', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.ok(!(await page.getByRole('alert').innerText()).includes(directory)); assert.equal(await importing().count(), 0); await page.getByRole('button', { name: '关闭提示', exact: true }).click();
    assert.deepEqual(await inspect(), original); assert.equal(calls.length, initialCalls);
    verified('actual plain and content-detected gzip import shows complete inert template, variable and assistant previews; cancel/Escape and invalid private fields leave all templates, assistants, draft and model requests unchanged');

    await pickOpen(inputPath); await page.getByRole('button', { name: '导入模板', exact: true }).click(); await importing().waitFor(); await importing().getByLabel('查看模板', { exact: true }).selectOption('1');
    const beforeFailure = await fingerprint();
    await application.evaluateMain("globalThis.qiyaoPromptTransferRename=require('node:fs/promises').rename;require('node:fs/promises').rename=async(from,to)=>{if(String(to).endsWith('workspace.json'))throw Object.assign(new Error('Synthetic template persistence failure'),{code:'EIO'});return globalThis.qiyaoPromptTransferRename(from,to);};");
    try {
      await importing().getByRole('button', { name: '添加 3 个模板', exact: true }).click(); await page.getByRole('alert').waitFor();
      assert.deepEqual(await inspect(), original); assert.equal(await fingerprint(), beforeFailure); assert.equal(await importing().getByLabel('查看模板', { exact: true }).inputValue(), '1');
      assert.equal(await importing().getByLabel('模板内容', { exact: true }).inputValue(), content); assert.equal(await importing().getByLabel('助手工作指令', { exact: true }).inputValue(), instructions);
      await capture('130-prompt-import-write-error-light.png'); await page.getByRole('button', { name: '关闭提示', exact: true }).click();
    } finally { await application.evaluateMain("require('node:fs/promises').rename=globalThis.qiyaoPromptTransferRename;"); }
    await importing().getByRole('button', { name: '添加 3 个模板', exact: true }).click(); await importing().waitFor({ state: 'hidden' });
    added = await inspect(); const originals = new Set(original.promptTemplates.map((item) => item.id)); const newTemplates = added.promptTemplates.filter((item) => !originals.has(item.id));
    assert.equal(newTemplates.length, 3); assert.equal(added.assistants.length, original.assistants.length + 1);
    const newAssistant = added.assistants.find((item) => !original.assistants.some((old) => old.id === item.id)); assert.equal(newAssistant.instructions, instructions); assert.notEqual(newAssistant.id, assistantId);
    for (const template of newTemplates.filter((item) => [first.title, second.title].includes(item.title))) { assert.equal(template.assistantId, newAssistant.id); assert.deepEqual(template.parameters, parameters); assert.equal(template.content, content); }
    assert.equal(newTemplates.find((item) => item.title === unbound.title).assistantId, undefined);
    for (const item of original.promptTemplates) assert.deepEqual(added.promptTemplates.find((candidate) => candidate.id === item.id), item);
    for (const item of original.assistants) assert.deepEqual(added.assistants.find((candidate) => candidate.id === item.id), item);
    assert.deepEqual(added.composerDrafts, original.composerDrafts); assert.equal(added.activeThreadId, original.activeThreadId); assert.equal(calls.length, initialCalls);
    verified('actual destination EIO preserves exact primary bytes and the selected complete preview; retry atomically creates fresh templates and one shared fresh assistant while retaining same-name originals, unbound templates and the exact composer context');

    await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); }); await page.reload(); await application.resize(760, 540); await manager();
    for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await page.waitForFunction((width) => Math.abs(innerWidth - width) <= 2, 760 / zoom);
      const libraryGeometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('*')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, text: element.textContent?.slice(0, 80) })) }));
      if (libraryGeometry.scrollWidth > libraryGeometry.width + 1) console.error('Prompt transfer library overflow', { zoom, ...libraryGeometry });
      assert.ok(libraryGeometry.scrollWidth <= libraryGeometry.width + 1);
      await pickOpen(inputPath); await page.getByRole('button', { name: '导入模板', exact: true }).click(); await importing().waitFor(); const done = importing().getByRole('button', { name: '添加 3 个模板', exact: true }); await done.focus();
      const geometry = await importing().evaluate((dialog) => { const header = dialog.querySelector('.modal-header').getBoundingClientRect(); const footer = dialog.querySelector('.modal-footer').getBoundingClientRect(); const body = dialog.querySelector('.modal-content'); return { width: innerWidth, height: innerHeight, top: header.top, bottom: footer.bottom, scrollable: body.scrollHeight > body.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; });
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1); assert.equal(geometry.overflow, false); assert.equal(geometry.scrollable, true); assert.equal(await done.evaluate((element) => element === document.activeElement), true); layout.push({ zoom, ...geometry });
      await capture(`131-prompt-import-dark-zoom-${Math.round(zoom * 100)}.png`); await dismissModalWithEscape(page, importing());
      assert.equal(await page.getByRole('button', { name: '导入模板', exact: true }).evaluate((element) => element === document.activeElement), true);
    }
    await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); assert.equal(calls.length, initialCalls);
    verified('native template library and long import previews retain visible title/footer, scrollable content, keyboard focus and Escape restoration at dark minimum-window 100/125/150 percent zoom without automatic model use');

    const backupPath = join(directory, '模板完整备份😀.json.gz'); await pickSave(backupPath); assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true);
    const backup = JSON.parse(gunzipSync(await readFile(backupPath)).toString('utf8')); assert.deepEqual(backup.promptTemplates, added.promptTemplates); assert.deepEqual(backup.assistants, added.assistants);
    const importedIds = added.promptTemplates.filter((item) => !original.promptTemplates.some((old) => old.id === item.id)).map((item) => item.id);
    await page.evaluate(async (ids) => { for (const id of ids) await window.qiyao.removePromptTemplate(id); }, importedIds);
    await pickOpen(backupPath); await application.evaluateMain('globalThis.qiyaoPromptTransferConfirm=require("electron").dialog.showMessageBox;require("electron").dialog.showMessageBox=async()=>({response:1});');
    try { await page.evaluate(() => window.qiyao.importWorkspace()); } finally { await application.evaluateMain('require("electron").dialog.showMessageBox=globalThis.qiyaoPromptTransferConfirm'); }
    page = await restart(); application = getApplication(); const restored = await inspect();
    assert.deepEqual(restored.promptTemplates, added.promptTemplates); assert.deepEqual(restored.assistants, added.assistants); assert.deepEqual(restored.composerDrafts, original.composerDrafts);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draftText); assert.equal(await page.getByLabel('选择助手', { exact: true }).inputValue(), 'general'); assert.equal(calls.length, initialCalls);
    verified('actual complete gzip backup restore and normal application restart preserve imported fresh shared bindings, full parameters and same-name originals while retaining the exact rendered draft, attachments and zero model requests');
  } finally {
    await application.evaluateMain('if(globalThis.qiyaoPromptTransferSave)require("electron").dialog.showSaveDialog=globalThis.qiyaoPromptTransferSave;if(globalThis.qiyaoPromptTransferOpen)require("electron").dialog.showOpenDialog=globalThis.qiyaoPromptTransferOpen;').catch(() => {});
  }
  return { page, result: { checks: 5, transferModelRequests: 0, exportModesVerified: true, inertPreviewCancelVerified: true, atomicImportRetryVerified: true, sharedFreshAssociationsVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true, layout,
    screenshots: ['128-prompt-transfer-library-light.png', '129-prompt-import-preview-light.png', '130-prompt-import-write-error-light.png', ...[100, 125, 150].map((zoom) => `131-prompt-import-dark-zoom-${zoom}.png`)],
    scope: 'Actual native library exports and plain/gzip/content-detected input, full inert parameter/profile preview, cancellation, actual atomic-write rejection/retry, fresh shared associations, native minimum-window zoom/focus/Escape, complete gzip backup and normal restart with zero model requests. System-picker and confirmation results are intercepted only in this isolated process; physical picker and wider platform checks remain separate.' } };
}
