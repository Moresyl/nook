import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mcpPdfFixtureBytes } from '../verification/mcp-pdf-fixture-data.mjs';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

export async function verifyMcpPdf({ page, application, getApplication, root, directory, screenshots, verified, waitForBridge, restart, endpoint, calls }) {
  const id = randomUUID(), name = 'PDF 阅读验证 MCP', providerId = randomUUID(), draftText = 'MCP_PDF_KEEP_DRAFT 中文';
  const bytes = mcpPdfFixtureBytes(), sha256 = createHash('sha256').update(bytes).digest('hex');
  const beforeRequests = calls.length, captures = [], layout = [];
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  await page.evaluate(async ({ id, name, fixture, command, providerId, endpoint, draftText }) => {
    await window.qiyao.saveMcpServer({ id, name, transport: 'stdio', command, args: [fixture], enabled: true, timeout: 5000 }, { env: {} }); await window.qiyao.mcpConnect(id);
    await window.qiyao.saveProvider({ id: providerId, name: 'PDF 文本验证连接', kind: 'openai', endpoint, models: ['verification-model'], hasKey: false }, 'local-verification-key');
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
    await window.qiyao.activateThread(); await window.qiyao.saveComposerDraft({ text: draftText, attachments: [{ id: 'mcp-pdf-existing', name: 'existing.txt', content: 'KEEP_EXISTING_ATTACHMENT' }], providerId, model: 'verification-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() });
  }, { id, name, providerId, endpoint, draftText, fixture: join(root, 'verification/mcp-pdf-fixture.mjs'), command: process.execPath }); await page.reload();
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true }), content = () => page.getByLabel('MCP 内容预览', { exact: true }), preview = () => page.getByRole('dialog', { name: 'mcp-resource.pdf', exact: true });
  async function open() {
    if (!await settings().isVisible()) { await page.keyboard.press('Control+,'); await settings().waitFor(); }
    await page.getByRole('button', { name: 'MCP 工具', exact: true }).click();
    const back = page.getByRole('button', { name: '← 返回服务器列表', exact: true }); if (await back.isVisible()) await back.click();
    await page.locator('.extension-server').filter({ hasText: name }).getByRole('button', { name: '资源与提示词', exact: true }).click();
  }
  async function resource(key = 'document') { await page.getByRole('button', { name: '资源', exact: true }).click(); await page.getByLabel('服务器资源', { exact: true }).selectOption(`fixture://pdf/${key}`); await page.getByRole('button', { name: '读取资源', exact: true }).click(); await content().waitFor(); }
  async function view() { await content().getByRole('button', { name: '预览文档 fixture://pdf/document', exact: true }).click(); await preview().waitFor(); await waitForBridge(page, () => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false' && document.querySelector('.pdfPreviewPage .textLayer')?.textContent.includes('evidence')); }
  async function capture(filename) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const encoded = await application.evaluateMain(`${mainWindow}.capturePage().then(image => image.toPNG().toString('base64'))`); await writeFile(join(screenshots, filename), Buffer.from(encoded, 'base64')); captures.push(filename); }
  await open(); await resource();
  const parsed = await page.evaluate(async id => { const item = (await window.qiyao.mcpReadResource(id, 'fixture://pdf/document')).binaryItems[0]; return window.qiyao.mcpPreviewBinary(item); }, id);
  assert.equal(parsed.original.sha256, sha256); assert.equal(parsed.original.bytes, bytes.length);
  assert.equal(await page.evaluate(async reference => { try { await window.qiyao.readDocumentOriginal(reference); return false; } catch { return true; } }, parsed.original), true);
  await view();
  const ink = await preview().locator('canvas').evaluate(canvas => { const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && data[i] < 200) ink++; return ink; }); assert.ok(ink > 50);
  await page.keyboard.press('Control+f'); const search = preview().getByRole('searchbox', { name: '搜索 PDF', exact: true }); assert.equal(await search.evaluate(element => element === document.activeElement), true); await search.fill('Budget');
  await waitForBridge(page, () => document.querySelector('input[aria-label="PDF 页码"]')?.value === '2' && document.querySelector('.pdf-search [role=status]')?.textContent === '1 / 1');
  const exported = join(directory, 'MCP 原始文档.pdf');
  await application.evaluateMain(`globalThis.nookPdfSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(exported)}});`);
  try { await preview().getByRole('button', { name: '保存 PDF 原件', exact: true }).click(); await waitForBridge(page, () => ![...document.querySelectorAll('dialog[open] button')].some(button => button.textContent === '正在保存…')); assert.deepEqual(await readFile(exported), bytes); }
  finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookPdfSave;delete globalThis.nookPdfSave;"); }
  await preview().getByRole('button', { name: '完成', exact: true }).click();
  const workspacePreview = await readFile(join(directory, 'workspace.json'), 'utf8'); assert.ok(!workspacePreview.includes(sha256) && !workspacePreview.includes(bytes.toString('base64'))); assert.equal(calls.length, beforeRequests);
  verified('real MCP PDF worker extraction, local unowned preview, selectable canvas text, Ctrl+F cross-page search and exact original export do not persist the PDF or send a model request');

  await resource('broken'); await content().getByRole('button', { name: '预览文档 fixture://pdf/broken', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not preview this MCP PDF' }).waitFor(); assert.equal(await preview().count(), 0); assert.ok(!(await page.getByRole('alert').innerText()).includes('MCP_PDF_PRIVATE_INVALID'));
  await resource(); await view(); await preview().getByRole('button', { name: '完成', exact: true }).click();
  verified('a corrupt real MCP PDF worker result produces a sanitized recoverable error and a valid PDF preview retry succeeds');

  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click(); await page.getByRole('button', { name: '停止订阅所选资源', exact: true }).waitFor();
  await application.evaluateMain(`globalThis.nookPdfPriorWorker=require('node:worker_threads').Worker;require('node:worker_threads').Worker=class extends globalThis.nookPdfPriorWorker{constructor(path,options){super(path,options);this.pdfFixture=options?.workerData?.name==='mcp-resource.pdf';}emit(event,...args){if(this.pdfFixture&&event==='message'&&!globalThis.nookPdfHeld?.released){globalThis.nookPdfHeld={worker:this,args,listeners:this.rawListeners('message'),released:false};return true;}if(globalThis.nookPdfHeld?.worker===this&&!globalThis.nookPdfHeld.released&&event==='exit'){globalThis.nookPdfHeld.exit=args;return true;}return super.emit(event,...args);}};`);
  try {
    await content().getByRole('button', { name: '预览文档 fixture://pdf/document', exact: true }).click();
    const deadline = Date.now() + 10000; while (!await application.evaluateMain('Boolean(globalThis.nookPdfHeld)')) { assert.ok(Date.now() < deadline, 'PDF worker must complete within the original bridge wait'); await new Promise(resolve => setTimeout(resolve, 100)); }
    await page.evaluate(id => window.qiyao.mcpReadResource(id, 'fixture://pdf/change'), id); await content().getByText(/MCP_PDF_REVISION_1/).waitFor();
    const released = await application.evaluateMain('(()=>{const held=globalThis.nookPdfHeld;held.released=true;for(const listener of held.listeners)listener.apply(held.worker,held.args);if(held.exit)held.worker.emit("exit",...held.exit);return {listeners:held.listeners.length,format:held.args[0]?.attachment?.source?.format};})()');
    assert.ok(released.listeners >= 2); assert.equal(released.format, 'pdf');
    await waitForBridge(page, () => !document.querySelector('.section-heading button')?.disabled); assert.equal(await preview().count(), 0);
  } finally { await application.evaluateMain('const held=globalThis.nookPdfHeld;if(held&&!held.released){held.released=true;for(const listener of held.listeners)listener.apply(held.worker,held.args);if(held.exit)held.worker.emit("exit",...held.exit);}require("node:worker_threads").Worker=globalThis.nookPdfPriorWorker;delete globalThis.nookPdfPriorWorker;delete globalThis.nookPdfHeld;'); }
  await view(); await page.evaluate(id => window.qiyao.mcpReadResource(id, 'fixture://pdf/change'), id); await preview().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '停止订阅所选资源', exact: true }).click();
  verified('actual resource-subscription updates invalidate both an already open PDF and a held completed real PDF-worker reply without reopening obsolete content');

  await application.resize(760, 540);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload(); await open();
    for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`); await waitForBridge(page, ({ zoom }) => Math.abs(innerWidth - 760 / zoom) <= 1, { zoom }); await resource();
      const button = content().getByRole('button', { name: '预览文档 fixture://pdf/document', exact: true }); await button.focus(); await page.keyboard.press('Enter'); await preview().waitFor(); await waitForBridge(page, () => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false');
      const bounds = await preview().evaluate(element => { const rect = element.getBoundingClientRect(); const controls = [...element.querySelectorAll('.modal-header button,.modal-footer button,.pdf-toolbar button,.pdf-search input')]; return { width: innerWidth, height: innerHeight, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, controlsVisible: controls.every(control => { const box = control.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0 && box.bottom <= innerHeight + 1; }), overflow: document.documentElement.scrollWidth > innerWidth }; });
      assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1 && bounds.controlsVisible && !bounds.overflow, JSON.stringify(bounds)); layout.push({ theme, zoom, ...bounds });
      await capture(`mcp-pdf-${theme}-${zoom * 100}.png`); await dismissModalWithEscape(page, preview()); assert.equal(await settings().isVisible(), true); assert.equal(await button.evaluate(element => element === document.activeElement), true);
    }
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840); await dismissModalWithEscape(page, settings());
  verified('MCP PDF controls, focus return and nested Escape remain visible and usable at minimum-window 100/125/150 percent in light and dark themes');

  // Return the fixture to its original bytes by reconnecting its actual stdio process.
  await page.evaluate(async id => { await window.qiyao.mcpDisconnect(id); await window.qiyao.mcpConnect(id); }, id); await open(); await resource();
  await page.getByRole('button', { name: '提示词', exact: true }).click(); await page.getByLabel('服务器提示词', { exact: true }).selectOption('document');
  await page.getByRole('button', { name: '加载提示词', exact: true }).click(); await content().waitFor(); await view(); await preview().getByRole('button', { name: '完成', exact: true }).click();
  assert.equal((await content().locator('.extension-preview').textContent()).trim(), '[user]'); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draftText); assert.equal(calls.length, beforeRequests);
  const workspacePath = join(directory, 'workspace.json'), savedWorkspace = join(directory, 'mcp-pdf-before-failure.json');
  await rename(workspacePath, savedWorkspace); await mkdir(workspacePath);
  try {
    await content().getByRole('button', { name: '添加到聊天 fixture://pdf/document', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: /draft|save|workspace|保存|写入/i }).waitFor(); assert.equal(await settings().isVisible(), true);
    assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draftText);
  } finally { await rmdir(workspacePath); await rename(savedWorkspace, workspacePath); }
  await content().getByRole('button', { name: '添加到聊天 fixture://pdf/document', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '预览 mcp-resource.pdf', exact: true }).waitFor();
  const input = page.getByLabel('消息', { exact: true }); assert.equal(await input.inputValue(), draftText); assert.equal(await input.evaluate(element => element === document.activeElement && element.selectionStart === element.value.length && element.selectionEnd === element.value.length), true);
  let state = await page.evaluate(() => window.qiyao.load()), savedDraft = state.composerDrafts.find(item => !item.threadId); assert.equal(savedDraft.attachments.length, 2); assert.equal(savedDraft.providerId, providerId); assert.equal(savedDraft.model, 'verification-model'); assert.equal(savedDraft.attachments[0].name, 'existing.txt'); assert.equal(calls.length, beforeRequests);
  const pdf = savedDraft.attachments.find(file => file.original); assert.equal(pdf.original.sha256, sha256); assert.deepEqual(Buffer.from(await page.evaluate(async reference => Array.from(await window.qiyao.readDocumentOriginal(reference)), pdf.original)), bytes);
  verified('a binary-only actual MCP prompt previews without text insertion; explicit PDF add survives a real filesystem save rejection, retains settings and draft, retries without duplicates, persists the original and restores the composer caret without sending');

  page = await restart(); application = getApplication(); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draftText); await page.getByRole('button', { name: '预览 mcp-resource.pdf', exact: true }).click(); await waitForBridge(page, () => document.querySelector('.pdf-scroll')?.getAttribute('aria-busy') === 'false'); await preview().getByRole('button', { name: '完成', exact: true }).click(); assert.deepEqual(await readFile(join(directory, 'document-originals', sha256)), bytes);
  verified('normal actual desktop restart restores the MCP PDF original, reader, existing attachment and unsent draft');

  const backup = join(directory, 'mcp-pdf-backup.json');
  await application.evaluateMain(`globalThis.nookPdfSave=require('electron').dialog.showSaveDialog;require('electron').dialog.showSaveDialog=async()=>({canceled:false,filePath:${JSON.stringify(backup)}});`);
  try { assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true); } finally { await application.evaluateMain("require('electron').dialog.showSaveDialog=globalThis.nookPdfSave;delete globalThis.nookPdfSave;"); }
  const bundle = JSON.parse(await readFile(backup, 'utf8')), originals = bundle.documentOriginals.filter(item => item.reference.sha256 === sha256); assert.equal(originals.length, 1); assert.equal(originals[0].data, bytes.toString('base64'));
  const originalPath = join(directory, 'document-originals', sha256); await rename(originalPath, join(directory, 'mcp-pdf-before-restore.bin'));
  await application.evaluateMain(`globalThis.nookPdfOpen=require('electron').dialog.showOpenDialog;globalThis.nookPdfConfirm=require('electron').dialog.showMessageBox;require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(backup)}]});require('electron').dialog.showMessageBox=async()=>({response:1});`);
  await application.evaluateMain(`(() => {
    const handlers = require('electron').ipcMain._invokeHandlers;
    const original = handlers.get('qiyao:invoke');
    let release; const held = new Promise(resolve => { release = resolve; });
    globalThis.nookPdfRestoreReceipt = { original, release, entered: false };
    handlers.set('qiyao:invoke', async (...args) => {
      const result = await original(...args);
      if (args[1] === 'importWorkspace') { globalThis.nookPdfRestoreReceipt.entered = true; await held; }
      return result;
    });
  })()`);
  try {
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: '数据与备份', exact: true }).click();
    await page.getByRole('button', { name: '恢复备份…', exact: true }).click();
    await page.getByText('正在处理备份…', { exact: true }).waitFor();
    await waitForBridge(page, async reference => { try { return (await window.qiyao.load()).composerDrafts.some(draft => draft.attachments.some(file => file.original?.sha256 === reference.sha256)) && (await window.qiyao.readDocumentOriginal(reference)).length > 0; } catch { return false; } }, pdf.original);
    await capture('mcp-pdf-restore-busy-shell.png');
    assert.equal(await settings().getByRole('button', { name: '关闭', exact: true }).isDisabled(), true, 'Backup recovery must retain the modal until its complete restore acknowledgement reaches the UI');
    assert.equal(await settings().getByRole('button', { name: '模型连接', exact: true }).isDisabled(), true, 'Pending restore must retain its settings page');
    await page.keyboard.press('Escape');
    assert.equal(await settings().isVisible(), true, 'Escape must not dismiss an in-progress workspace restore');
  } finally {
    await application.evaluateMain("(() => {const receipt=globalThis.nookPdfRestoreReceipt;require('electron').ipcMain._invokeHandlers.set('qiyao:invoke',receipt.original);receipt.release();require('electron').dialog.showOpenDialog=globalThis.nookPdfOpen;require('electron').dialog.showMessageBox=globalThis.nookPdfConfirm;delete globalThis.nookPdfOpen;delete globalThis.nookPdfConfirm;})()");
  }
  await waitForBridge(page, () => !document.querySelector('.settings-detail [role="status"]'));
  assert.equal(await application.evaluateMain('globalThis.nookPdfRestoreReceipt.entered'), true);
  await application.evaluateMain('delete globalThis.nookPdfRestoreReceipt');
  await settings().getByRole('button', { name: '关闭', exact: true }).click(); assert.deepEqual(await readFile(originalPath), bytes); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draftText);
  verified('complete backup deduplicates the exact MCP PDF, live restore reconstructs a missing original, and delayed acknowledgement keeps close, Escape and navigation blocked until the restored UI preserves the unsent draft');

  await page.getByLabel('消息', { exact: true }).fill('MCP_PDF_SEND_EXTRACTED_TEXT'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.load()).threads.some(thread => thread.messages.at(-1)?.status === 'complete' && thread.messages.some(message => message.content === 'MCP_PDF_SEND_EXTRACTED_TEXT')));
  assert.equal(calls.length, beforeRequests + 1); const raw = JSON.stringify(calls.at(-1)); assert.ok(raw.includes('Document evidence') && raw.includes('Budget 42') && raw.includes('KEEP_EXISTING_ATTACHMENT'));
  for (const forbidden of [bytes.toString('base64'), sha256, '%PDF-', 'application/pdf']) assert.equal(raw.includes(forbidden), false);
  verified('only an explicit send makes one actual local model HTTP request containing extracted PDF text and the existing attachment, with no PDF bytes, hash or local identity');
  return { page, result: { checks: 8, explicitModelRequests: 1, previewPersisted: false, originalSha256: sha256, exactOriginalVerified: true, promptPdfVerified: true, textOnlyModelTransportVerified: true, staleSubscriptionVerified: true, filesystemRetryVerified: true, restartVerified: true, backupRestoreVerified: true, restoreCompletionVerified: true, layout, screenshots: captures, scope: 'Real stdio PDF resources and binary-only prompt, actual import/PDF renderer workers, corrupt-file recovery, delayed worker/subscription invalidation, local ownership, exact export, light/dark minimum-window zoom and keyboard/Escape, real filesystem draft-save rejection and idempotent retry, restart, complete backup/live missing-original restore and one explicit local model request. Native picker responses and a held restore acknowledgement at the main IPC boundary are isolated fixtures; external servers and physical picker interaction remain separate.' } };
}
