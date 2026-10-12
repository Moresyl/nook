import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyComposerActions({ page, application, projectDirectory, screenshots, calls, verified, waitForBridge }) {
  const initialCalls = calls.length; const original = await page.evaluate(() => window.qiyao.load()); const input = () => page.getByRole('textbox', { name: '消息', exact: true });
  const oldText = await input().inputValue(); const oldAssistant = await page.getByLabel('选择助手', { exact: true }).inputValue();
  const oldProject = original.projects.length ? await page.getByLabel('选择项目', { exact: true }).inputValue() : '';
  const template = { id: randomUUID(), title: '快捷变量模板', description: '保留前后原文', content: 'FOR {{topic}}' };
  const fixed = { id: randomUUID(), title: '快捷固定模板', description: '只插入，不发送', content: 'QUICK_ACTION_LITERAL <img src="https://example.invalid/a.png">' };
  const project = { id: randomUUID(), name: '快捷项目测试', path: projectDirectory, instructions: '', createdAt: Date.now() };
  const layouts = [], images = [], captures = [];
  await page.evaluate(async ({ template, fixed, project }) => { await window.qiyao.savePromptTemplate(template); await window.qiyao.savePromptTemplate(fixed); await window.qiyao.saveProject(project); }, { template, fixed, project }); await page.reload();
  const list = () => page.getByRole('listbox', { name: '输入区快捷选择', exact: true });
  const fill = async text => { await input().fill(text); await input().press('Control+End'); assert.equal(await input().inputValue(), text, 'Native query input must replace the previous exact draft once.'); };
  const choose = async (query, title, index = 0, matches = 1) => { await fill(query); const options = page.getByRole('option', { name: title, exact: true }); await options.first().waitFor(); assert.equal(await options.count(), matches); await options.nth(index).click(); };
  const capture = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(async () => { const animations = document.querySelector('.composer-actions').getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity); await Promise.allSettled(animations.map(animation => animation.finished)); });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await page.evaluate(() => ({ query: document.querySelector('.composer textarea').value, selectedLabel: document.querySelector('.composer-actions [aria-selected="true"]')?.getAttribute('aria-label') ?? null, optionCount: document.querySelectorAll('.composer-actions [role="option"]').length }));
    const image = await application.evaluateMain(`(async()=>{const window=require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())});return {png:(await window.capturePage()).toPNG().toString('base64'),size:window.getContentSize()};})()`);
    const bytes = Buffer.from(image.png, 'base64'); assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]); const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); assert.deepEqual([width, height], image.size);
    await writeFile(join(screenshots, `${name}.png`), bytes); images.push(`${name}.png`); captures.push({ filename: `${name}.png`, width, height, nativeSize: image.size, ...state });
  };
  await fill('https://example.invalid/path'); assert.equal(await list().count(), 0);
  await fill('/快捷'); await list().waitFor(); await input().evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  assert.equal(await list().count(), 0); await input().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true }); assert.equal(await input().inputValue(), '/快捷');
  await input().evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))); await list().waitFor();
  await page.keyboard.press('Escape'); assert.equal(await list().count(), 0); assert.equal(await input().inputValue(), '/快捷'); assert.equal(calls.length, initialCalls);
  verified('composer slash selection ignores URLs and IME confirmation; Escape retains the exact original query without sending');

  const source = '  KEEP /快捷变量\nTAIL  '; await fill(source); await input().press('Control+Home'); await input().press('End');
  await page.getByRole('option', { name: '快捷变量模板，模板', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '使用提示模板', exact: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await input().inputValue(), source);
  await fill(source + ' '); await fill(source); await input().press('Control+Home'); await input().press('End');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.getByRole('option', { name: '快捷变量模板，模板', exact: true }).click(); dialog = page.getByRole('dialog', { name: '使用提示模板', exact: true });
  assert.equal(await dialog.getByRole('button', { name: '插入到草稿', exact: true }).isDisabled(), true); await dialog.getByLabel('变量 topic', { exact: true }).fill('精确内容');
  await dialog.getByRole('button', { name: '插入到草稿', exact: true }).click(); assert.equal(await input().inputValue(), '  KEEP FOR 精确内容\nTAIL  '); assert.equal(calls.length, initialCalls);
  verified('composer template cancellation retains the exact draft and variable application inserts at the caret without trimming surrounding text or sending');

  const assistant = original.assistants.find(item => item.id !== oldAssistant) ?? original.assistants[0]; assert.ok(assistant);
  const sameName = original.assistants.filter(item => item.name === assistant.name); const defaultOffset = assistant.name === '默认助手' ? 1 : 0;
  for (let repeat = 0; repeat < 3; repeat++) {
    if (repeat === 0) await page.evaluate(() => {
      window.__composerSelectionFrames = [];
      window.__composerSelectionOriginalFrame = window.requestAnimationFrame;
      window.__composerSelectionClickCaptured = false;
      document.addEventListener('click', event => {
        if (!event.target.closest?.('.composer-actions [role="option"]')) return;
        window.__composerSelectionClickCaptured = true;
        window.requestAnimationFrame = callback => { window.__composerSelectionFrames.push(callback); return -1; };
      }, { capture: true, once: true });
    });
    try { await choose('KEEP /' + assistant.name, `${assistant.name}，助手`, sameName.findIndex(item => item.id === assistant.id) + defaultOffset, sameName.length + defaultOffset); }
    finally { if (repeat === 0) await page.evaluate(() => { window.requestAnimationFrame = window.__composerSelectionOriginalFrame; }); }
    assert.equal(await input().inputValue(), 'KEEP '); assert.equal(await page.getByLabel('选择助手', { exact: true }).inputValue(), assistant.id);
    if (repeat === 0) {
      await input().press('Control+A');
      const selection = await page.evaluate(() => {
        const node = document.querySelector('.composer textarea'), before = [node.selectionStart, node.selectionEnd], frames = window.__composerSelectionFrames;
        for (const callback of frames) callback(performance.now());
        return { before, after: [node.selectionStart, node.selectionEnd], deferredFrames: frames.length, selectionClickCaptured: window.__composerSelectionClickCaptured };
      });
      console.log('Composer scope caret restore observations', JSON.stringify(selection));
      assert.equal(selection.selectionClickCaptured, true); assert.deepEqual(selection.before, [0, 5]); assert.deepEqual(selection.after, selection.before, 'Choosing a scope must not overwrite the subsequent user selection.');
      await page.keyboard.type('AFTER_SCOPE_SELECTION'); assert.equal(await input().inputValue(), 'AFTER_SCOPE_SELECTION');
    }
    await choose('KEEP /' + project.name, `${project.name}，项目`); assert.equal(await input().inputValue(), 'KEEP '); assert.equal(await page.getByLabel('选择项目', { exact: true }).inputValue(), project.id);
  }
  assert.equal(calls.length, initialCalls); verified('composer assistant and project choices consume only the slash query and preserve the surrounding draft without model requests');

  await fill('/快捷'); await list().waitFor(); await input().press('Control+Home'); assert.equal(await input().evaluate(node => node.selectionStart), 0); await input().press('Control+End'); assert.equal(await input().evaluate(node => node.selectionStart), 3); await list().waitFor();
  const firstId = await list().getByRole('option').first().getAttribute('id'), lastId = await list().getByRole('option').last().getAttribute('id'); assert.notEqual(firstId, lastId);
  await page.evaluate(() => {
    window.__composerKeyboardEvents = [];
    for (const type of ['keydown', 'keyup', 'pointerover', 'pointermove', 'pointerout', 'mouseover', 'mouseout']) document.addEventListener(type, event => {
      if (!event.target.closest?.('.composer textarea, .composer-actions')) return;
      const events = window.__composerKeyboardEvents; events.push({ type, key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, x: event.clientX, y: event.clientY, target: event.target.closest('[role="option"]')?.id ?? event.target.tagName, active: document.querySelector('.composer textarea')?.getAttribute('aria-activedescendant') }); if (events.length > 100) events.shift();
    }, true);
    new MutationObserver(records => { for (const record of records) if (record.attributeName === 'aria-activedescendant') window.__composerKeyboardEvents.push({ type: 'selection', active: record.target.getAttribute('aria-activedescendant') }); }).observe(document.querySelector('.composer textarea'), { attributes: true, attributeFilter: ['aria-activedescendant'] });
  });
  const selected = async id => {
    try { await page.waitForFunction(expected => document.querySelector('.composer textarea')?.getAttribute('aria-activedescendant') === expected, id); }
    catch (problem) { console.error('Composer keyboard selection state', JSON.stringify(await page.evaluate(() => { const node = document.querySelector('.composer textarea'); return { focused: document.activeElement === node, selectionStart: node?.selectionStart, active: node?.getAttribute('aria-activedescendant'), events: window.__composerKeyboardEvents, options: [...document.querySelectorAll('.composer-actions [role="option"]')].map(row => ({ id: row.id, selected: row.getAttribute('aria-selected') })) }; }))); throw problem; }
  };
  await page.keyboard.press('End'); await selected(lastId); const last = await input().getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown'); await selected(firstId); const first = await input().getAttribute('aria-activedescendant'); assert.notEqual(first, last); assert.equal(first, firstId);
  await page.keyboard.press('ArrowUp'); await selected(lastId); assert.equal(await input().getAttribute('aria-activedescendant'), last);
  console.log('Composer keyboard event observations', JSON.stringify(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, events: window.__composerKeyboardEvents }))));
  await fill('/NO_MATCH_QUICK_ACTION'); await list().waitFor(); assert.equal(await list().getByRole('option').count(), 0); await page.keyboard.press('Enter'); assert.equal(await input().inputValue(), '/NO_MATCH_QUICK_ACTION'); assert.equal(calls.length, initialCalls); await page.keyboard.press('Escape');
  verified('composer keyboard selection cycles current results and empty-result Enter preserves text without sending');

  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25, 1.5]) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme); await page.reload(); await application.resize(760, 540);
    await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())}).webContents.setZoomFactor(${zoom})`);
    await fill('/快捷'); await list().waitFor(); await page.keyboard.press('End'); await selected(await list().getByRole('option').last().getAttribute('id'));
    const layout = await page.evaluate(() => { const panel = document.querySelector('.composer-actions'), list = panel.querySelector('[role="listbox"]'), active = list.querySelector('[aria-selected="true"]'); const rect = panel.getBoundingClientRect(), row = active.getBoundingClientRect(), clip = list.getBoundingClientRect(); const style = getComputedStyle(active); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, chromeBottom: document.querySelector('.window-chrome').getBoundingClientRect().bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, width: list.clientWidth, scrollWidth: list.scrollWidth, activeTop: row.top, activeBottom: row.bottom, clipTop: clip.top, clipBottom: clip.bottom, opacity: style.opacity, fontSize: style.fontSize, minHeight: style.minHeight, background: getComputedStyle(panel).backgroundColor, focused: document.activeElement?.getAttribute('aria-label') === '消息' }; });
    assert.ok(Object.values(layout).every(value => typeof value !== 'number' || Number.isFinite(value))); assert.ok(layout.left >= 0 && layout.right <= layout.viewportWidth && layout.top >= layout.chromeBottom + 8 && layout.bottom <= layout.viewportHeight); assert.ok(layout.width > 0 && layout.scrollWidth <= layout.width); assert.ok(layout.activeTop >= layout.clipTop && layout.activeBottom <= layout.clipBottom); assert.equal(layout.opacity, '1'); assert.equal(layout.fontSize, '14px'); assert.equal(layout.minHeight, '24px'); assert.equal(layout.focused, true); assert.equal(layout.background, theme === 'light' ? 'rgb(249, 249, 249)' : 'rgb(65, 65, 65)'); layouts.push({ theme, zoom, ...layout });
    await capture(`composer-actions-${theme}-${zoom * 100}`); await fill('/NO_MATCH_QUICK_ACTION'); await list().waitFor(); await capture(`composer-actions-empty-${theme}-${zoom * 100}`); await page.keyboard.press('Escape');
  }
  verified('composer portal menus and empty states remain within six light/dark zoom viewports; selected rows and textarea keyboard focus are visible without horizontal overflow');
  await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===${JSON.stringify(page.url())}).webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  await page.evaluate(() => window.qiyao.openQuickChat()); await page.waitForTimeout(100); let quick;
  const deadline = Date.now() + 10000; while (Date.now() < deadline) { quick = page.context().pages().find(candidate => !candidate.isClosed() && new URL(candidate.url()).searchParams.get('view') === 'quick-chat'); if (quick) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(quick); const quickInput = quick.getByRole('textbox', { name: '消息', exact: true }); await quickInput.waitFor(); const oldQuickText = await quickInput.inputValue();
  await quickInput.fill('/快捷固定'); await quickInput.press('Control+End'); await quick.getByRole('listbox', { name: '输入区快捷选择', exact: true }).waitFor(); await quick.keyboard.press('Enter'); await quick.getByRole('dialog', { name: '使用提示模板', exact: true }).getByRole('button', { name: '插入到草稿', exact: true }).click(); assert.equal(await quickInput.inputValue(), fixed.content); assert.equal(calls.length, initialCalls);
  await quickInput.fill(oldQuickText); await waitForBridge(quick, async text => (await window.nookQuick.load()).draft.text === text, oldQuickText); await quick.evaluate(() => window.nookQuick.windowAction('hide')); verified('independent native Quick Chat uses the same slash template selection and exact literal insertion without sending or changing its previous draft');

  await fill(oldText); await page.getByLabel('选择助手', { exact: true }).selectOption(oldAssistant); await page.getByLabel('选择项目', { exact: true }).selectOption(oldProject);
  await waitForBridge(page, async expected => { const state = await window.qiyao.load(); const draft = state.composerDrafts.find(item => item.threadId === state.activeThreadId); if (!expected.text && !expected.attachments) return !draft; return Boolean(draft && draft.text === expected.text && (draft.assistantId ?? '') === expected.assistant && (draft.projectId ?? '') === expected.project); }, { text: oldText, assistant: oldAssistant, project: oldProject, attachments: original.composerDrafts.find(item => item.threadId === original.activeThreadId)?.attachments.length ?? 0 });
  await page.evaluate(async ids => { for (const id of ids) await window.qiyao.removePromptTemplate(id); }, [template.id, fixed.id]);
  const cleanupDeadline = Date.now() + 10000;
  for (;;) {
    try { await page.evaluate(id => window.qiyao.removeProject(id), project.id); break; }
    catch (error) { if (!error.message.includes('The workspace is busy. Retry worktree cleanup after current actions finish.') || Date.now() >= cleanupDeadline) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  await page.evaluate(preferences => window.qiyao.savePreferences(preferences), original.preferences); await page.reload();
  assert.equal(calls.length, initialCalls); await waitForBridge(page, async ids => !(await window.qiyao.load()).promptTemplates.some(item => ids.includes(item.id)), [template.id, fixed.id]);
  verified('composer selection cleanup preserves previous preferences and choices, removes only owned fixture templates and makes no additional model requests');
  return { checks: 7, modelRequests: 0, queryKeyboardVerified: true, templateCancellationVerified: true, caretInsertionVerified: true, scopeSelectionVerified: true, sixThemeZoomLayoutsVerified: true, quickChatVerified: true, fixtureCleanupVerified: true, layouts, screenshots: images, captures, scope: 'Actual native composer and Quick Chat, owned template fixtures, literal insertion and cancellation, IME event boundary, keyboard results, six Electron zoom layouts and exact cleanup. Whole BrowserWindow captures retain exact native content dimensions. Physical IME and system DPI remain separate checks; draft-conflict rejection is covered by unit tests.' };
}
