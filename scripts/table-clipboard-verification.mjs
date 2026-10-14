import assert from 'node:assert/strict';
import { proseReply, tableSource } from '../verification/prose-layout-fixture.mjs';

export async function installTableClipboardFixture(target, mode = 'success') {
  await target.evaluate(mode => {
    window.nookTableNativeWrite ??= navigator.clipboard.write.bind(navigator.clipboard);
    window.nookTableCopyCalls = 0;
    window.qiyaoTableCopyResolve = undefined; window.nookTableCopyReject = undefined;
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, writable: true, value: async items => {
      window.nookTableCopyCalls++; window.nookTableCopyItems = items.length;
      window.nookTableCopyTypes = [...items[0].types].sort();
      window.qiyaoVerificationCopy = await (await items[0].getType('text/plain')).text();
      window.nookTableCopyHtml = await (await items[0].getType('text/html')).text();
      if (mode === 'reject') throw new Error('PRIVATE_TABLE_COPY_ERROR');
      if (mode === 'pending') await new Promise((resolve, reject) => { window.qiyaoTableCopyResolve = resolve; window.nookTableCopyReject = reject; });
    } });
  }, mode);
}
export async function assertTableClipboard(target, source) {
  const copy = await target.evaluate(() => ({ text: window.qiyaoVerificationCopy, html: window.nookTableCopyHtml, types: window.nookTableCopyTypes, items: window.nookTableCopyItems }));
  assert.equal(copy.text, source); assert.equal(copy.items, 1); assert.deepEqual(copy.types, ['text/html', 'text/plain']);
  const structure = await target.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html'), table = document.querySelector('table');
    return { tables: document.querySelectorAll('table').length, rows: table?.rows.length, cells: [...table?.rows[1].cells ?? []].map(cell => cell.textContent), alignments: [...table?.rows[0].cells ?? []].map(cell => cell.style.textAlign), bold: table?.querySelector('strong')?.textContent, resources: document.querySelectorAll('img,script,iframe,object,embed,[src],[onerror]').length };
  }, copy.html);
  assert.equal(structure.tables, 1); assert.equal(structure.rows, 3); assert.deepEqual(structure.alignments, ['left', 'center', 'right', '']);
  assert.equal(structure.cells[1], '😀'); assert.equal(structure.cells[2], '42'); assert.ok(structure.cells[3].startsWith('PROSE_TABLE_EXACT_')); assert.equal(structure.resources, 0);
  return structure;
}
export async function verifyTableClipboard({ page, target, application, threadId, index, quick, verified }) {
  const original = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), threadId);
  const windowSelector = quick ? "new URL(w.webContents.getURL()).searchParams.get('view')==='quick-chat'" : "w.webContents.getURL().startsWith('qiyao://app/')&&!new URL(w.webContents.getURL()).searchParams.has('view')";
  const body = target.locator('.markdown-body').filter({ hasText: 'PROSE_LAYOUT_END' });
  const table = body.locator('.markdown-table'), button = table.getByRole('button', { name: '复制表格', exact: true });
  async function change(content) {
    await page.evaluate(thread => window.qiyao.updateThread(thread), { ...original, messages: original.messages.map((message, position) => position === index ? { ...message, content } : message) });
    if (!quick) await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w=>${windowSelector}).webContents.send('nook:workspace-navigation',{threadId:${JSON.stringify(threadId)}})`);
  }
  const physical = await application.evaluateMain("(async()=>{const {clipboard:c,ClipboardItem}=require('electron');const {createHash}=require('node:crypto');const fingerprint=async items=>{const result=[];for(const item of items){const row=[];for(const type of [...item.types].sort()){const value=await item.getType(type);const bytes=value instanceof Blob?Buffer.from(await value.arrayBuffer()):Buffer.from(JSON.stringify(value));row.push({type,sha256:createHash('sha256').update(bytes).digest('hex')});}result.push(row);}return result;};const items=await c.read();const backup=[];for(const item of items){const data={};for(const type of item.types)data[type]=await item.getType(type);backup.push(new ClipboardItem(data));}globalThis.nookTableClipboardBackup={items:backup,fingerprint,before:await fingerprint(backup)};return {supported:true,formats:items.flatMap(item=>item.types)};})()");
  {
    try {
      await target.evaluate(() => { navigator.clipboard.write = window.nookTableNativeWrite; });
      await button.press('Enter'); await table.getByRole('status').waitFor();
      const value = await application.evaluateMain("(async()=>{const c=require('electron').clipboard;const items=await c.read();return {text:await c.readText(),html:await (await items[0].getType('text/html')).text(),formats:items.flatMap(item=>item.types)};})()");
      assert.equal(value.text, tableSource); assert.ok(value.formats.includes('text/plain') && value.formats.includes('text/html'));
      const parsed = await target.evaluate(html => { const document = new DOMParser().parseFromString(html, 'text/html'); return { rows: document.querySelector('table')?.rows.length, bold: document.querySelector('strong')?.textContent, alignment: document.querySelector('th')?.style.textAlign, dangerous: document.querySelectorAll('script,img,iframe,[src],[onerror]').length }; }, value.html);
      assert.deepEqual(parsed, { rows: 3, bold: '汉字', alignment: 'left', dangerous: 0 });
      assert.deepEqual(await target.evaluate(async () => ({ write: (await navigator.permissions.query({ name: 'clipboard-write' })).state, read: (await navigator.permissions.query({ name: 'clipboard-read' })).state })), { write: 'granted', read: 'denied' });
      physical.writtenFormats = value.formats; physical.verified = true;
    } finally {
      const restored = await application.evaluateMain("(async()=>{const c=require('electron').clipboard;const backup=globalThis.nookTableClipboardBackup;if(backup.items.length)await c.write(backup.items);else c.clear();const same=JSON.stringify(await backup.fingerprint(await c.read()))===JSON.stringify(backup.before);delete globalThis.nookTableClipboardBackup;return {same};})()");
      assert.equal(restored.same, true, 'All original system clipboard formats must be restored byte-for-byte.'); physical.originalClipboardRestoredByteForByte = true;
      await installTableClipboardFixture(target);
    }
  }
  verified(`${quick ? 'restricted quick' : 'main'} table dual-format clipboard preserves exact CRLF source, native HTML rows and alignment while clipboard read permission remains denied`);
  for (const rejection of [false, true]) {
    await installTableClipboardFixture(target, 'pending'); await button.click();
    await target.waitForFunction(() => window.qiyaoTableCopyResolve && window.nookTableCopyCalls === 1);
    assert.equal(await button.isDisabled(), true); await button.press('Space'); assert.equal(await target.evaluate(() => window.nookTableCopyCalls), 1);
    await change(proseReply.replace('**汉字**', '**更新汉字**')); await table.getByText('更新汉字', { exact: true }).waitFor();
    assert.equal(await button.isDisabled(), false);
    await target.evaluate(rejection => { if (rejection) window.nookTableCopyReject(new Error('PRIVATE_LATE_TABLE_COPY_ERROR')); else window.qiyaoTableCopyResolve(); }, rejection);
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await table.getByRole('status').count(), 0); assert.equal(await table.getByRole('alert').count(), 0);
    await installTableClipboardFixture(target); await button.press('Enter'); await table.getByRole('status').waitFor();
    await assertTableClipboard(target, tableSource.replace('**汉字**', '**更新汉字**'));
    await change(proseReply); await table.getByText('汉字', { exact: true }).waitFor();
  }
  await installTableClipboardFixture(target, 'pending'); await button.click(); await target.waitForFunction(() => window.qiyaoTableCopyResolve && window.nookTableCopyCalls === 1);
  await change('TABLE_UNMOUNTED_EXACT'); await target.getByText('TABLE_UNMOUNTED_EXACT', { exact: true }).waitFor(); await target.evaluate(() => window.qiyaoTableCopyResolve());
  assert.ok(!(await target.locator('body').innerText()).includes('PRIVATE_LATE_TABLE_COPY_ERROR'));
  await change(proseReply); await table.waitFor(); await installTableClipboardFixture(target); await button.press('Enter'); await table.getByRole('status').waitFor();
  await assertTableClipboard(target, tableSource);
  assert.equal((await page.evaluate(() => window.qiyao.load())).threads.find(thread => thread.id === threadId).messages[index].content, proseReply);
  verified(`${quick ? 'restricted quick' : 'main'} pending rich table copy ignores late success and rejection after saved source updates or unmount, prevents duplicate writes and retains exact stored originals`);
  return { types: ['text/plain', 'text/html'], physical, staleSuccessAndFailureIgnored: true, pendingDuplicatePrevention: true, unmountSafe: true, sourceUpdateBoundary: 'Persisted updates and the real workspace navigation/quick subscription path; these held-promise cases are not HTTP streaming.' };
}
