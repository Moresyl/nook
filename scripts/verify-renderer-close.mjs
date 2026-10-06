import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyRendererClose({ page, application, directory, verified, waitForBridge, modelRequests }) {
  const text = 'NOOK_RENDERER_CRASH_PERSISTED_DRAFT 中文😀';
  await page.getByLabel('消息', { exact: true }).fill(text);
  await waitForBridge(page, async (text) => (await window.qiyao.load()).composerDrafts.some(draft => draft.text === text), text);
  const primaryPath = join(directory, 'workspace.json');
  const primaryBytes = await readFile(primaryPath);
  const before = JSON.parse(primaryBytes.toString('utf8'));
  const journalBytes = await readFile(join(directory, 'workspace.checkpoints.json')).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (journalBytes) {
    const journal = JSON.parse(journalBytes.toString('utf8')); const signature = await stat(primaryPath, { bigint: true });
    assert.equal(journal.baseSha256, createHash('sha256').update(primaryBytes).digest('hex'));
    assert.deepEqual(journal.signature, { ino: signature.ino.toString(), mtimeNs: signature.mtimeNs.toString() });
    for (const { index, thread } of journal.threads) { assert.equal(before.threads[index]?.id, thread.id); before.threads[index] = thread; }
    if (journal.composer) before.composerDrafts = journal.composer.composerDrafts;
  }
  assert.ok(before.composerDrafts.some(draft => draft.text === text)); assert.equal(modelRequests(), 0);
  verified('the actual composer persists an exact Unicode draft before the controlled main-renderer crash without a model request');
  const crashed = page.waitForEvent('crash', { timeout: 5000 });
  if (process.env.NOOK_TEST_LOCAL_CRASH_DUMPS === '1') {
    const session = await page.context().newCDPSession(page);
    // A crashed renderer cannot reply; normal application close disconnects this session.
    void session.send('Page.crash').catch(() => {});
    await crashed;
  } else {
    await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/')).webContents.forcefullyCrashRenderer()");
    await crashed;
  }
  const state = await application.evaluateMain("({crashed:require('electron').BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('qiyao://app/')).webContents.isCrashed(), exits:globalThis.nookRendererExits})");
  assert.equal(state.crashed, true); assert.equal(state.exits.length, 1); assert.equal(state.exits[0].reason, 'crashed');
  const startedAt = Date.now(); await application.close({ quit: true });
  const after = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
  assert.deepEqual(after.composerDrafts, before.composerDrafts); assert.deepEqual(after.threads, before.threads); assert.equal(modelRequests(), 0);
  verified('explicit application quit after an actual main-renderer crash exits normally within the original deadline and retains every persisted draft and conversation');
  return { checks: 2, crash: state.exits[0], quitMs: Date.now() - startedAt, persistedDraftRetained: true, conversationsRetained: true, modelRequests: modelRequests(), boundary: 'A deliberately crashed owned main renderer and explicit application quit. The last successfully saved state is retained; unflushed input and the cause of spontaneous crashes are not established. Not complete desktop or distribution acceptance.' };
}
