import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertTextHint } from './text-hint-verification.mjs';

export async function verifyTextHints({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge }) {
  const projectId = randomUUID(); const providerId = randomUUID();
  const name = `项目 · ${'完整中文名称😀 <img src=x> '.repeat(4)}`.trim();
  const path = '提示 中文.html'; const html = '<!doctype html><meta charset="utf-8"><h1>TEXT_HINT_PREVIEW_EVIDENCE</h1>';
  const draft = 'TEXT_HINT_RETAINS_DRAFT 中文 <literal>';
  const description = '最近请求输入是服务返回的实际用量，不是下一次发送的上下文估算。容量来自服务或手动设置。';
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  const view = `${mainWindow}.contentView.children.find(child => child.webContents && !child.webContents.isDestroyed() && child.webContents.getURL().startsWith('nook-preview:'))`;
  await writeFile(join(projectDirectory, path), html);
  await page.evaluate(async ({ projectId, providerId, name, projectDirectory, endpoint }) => {
    await window.qiyao.saveProject({ id: projectId, name, path: projectDirectory, instructions: '', createdAt: 1 });
    await window.qiyao.saveProvider({ id: providerId, name: '提示验证模型', kind: 'ollama', endpoint, models: ['hint-model'], hasKey: false,
      modelCatalog: [{ id: 'hint-model', source: 'manual', inputTokenLimit: 32768, outputTokenLimit: 8192 }] });
  }, { projectId, providerId, name, projectDirectory, endpoint });
  const captures = []; const editorPathStates = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload();
    for (const zoom of [1, 1.25, 1.5]) {
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
      await application.resize(theme === 'light' ? 1280 : 760, theme === 'light' ? 840 : 540);
      await page.keyboard.press('Control+n');
      await page.getByLabel('模型提供商', { exact: true }).selectOption(providerId);
      const composer = page.getByLabel('消息', { exact: true }); await composer.fill(draft);
      const context = page.getByLabel('模型容量与最近请求', { exact: true });
      assert.match(await context.textContent(), /输入上限 32,768/);
      await assertTextHint(page, context, description);
      assert.equal(await composer.inputValue(), draft);
      await page.getByRole('button', { name: '项目', exact: true }).click();
      await page.locator('.project-list').getByRole('button', { name, exact: true }).click();
      const heading = page.locator('.project-inspector > .section-heading');
      await assertTextHint(page, heading.getByRole('heading', { name, exact: true }), name);
      await assertTextHint(page, heading.locator('.path-text'), projectDirectory);
      await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: path, exact: true }).click();
      const file = page.locator('.editor-actionbar .path-text');
      await file.getByText(path, { exact: true }).waitFor({ state: 'attached' });
      const compactEditor = await page.evaluate(() => matchMedia('(max-height: 500px)').matches);
      assert.equal(await file.isVisible(), !compactEditor, 'The short-window action bar uses the existing file tab to expose its full path');
      await assertTextHint(page, compactEditor ? page.getByRole('tab', { name: path, exact: true }) : file, path);
      editorPathStates.push({ theme, zoom, toolbarPathVisible: !compactEditor, compactFileTabVerified: compactEditor });
      await page.getByRole('button', { name: '并排预览', exact: true }).click();
      const preview = page.locator('.project-preview-toolbar > span:not([role="tooltip"])');
      await preview.waitFor();
      await page.locator('.project-preview-status').waitFor({ state: 'hidden' });
      const id = await application.evaluateMain(`${view}?.webContents.id`); assert.ok(Number.isInteger(id));
      await assertTextHint(page, preview, path);
      assert.equal(await application.evaluateMain(`${view}?.webContents.id`), id, 'Reading/dismissing a path hint must retain the native preview session');
      const filename = `text-hints-${theme}-${Math.round(zoom * 100)}.png`;
      await page.mouse.move(1, 1); await preview.hover(); await page.locator('.control-tooltip:popover-open').waitFor();
      const png = await application.evaluateMain(`${mainWindow}.capturePage().then(image => image.toPNG().toString('base64'))`);
      await writeFile(join(screenshots, filename), Buffer.from(png, 'base64')); captures.push(filename);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '关闭预览', exact: true }).click();
      await page.keyboard.press('Control+n');
      assert.equal(await composer.inputValue(), draft);
      assert.equal(await readFile(join(projectDirectory, path), 'utf8'), html);
      await waitForBridge(page, async draft => (await window.qiyao.load()).composerDrafts.some(item => item.text === draft), draft);
    }
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  verified('real model capacity descriptions use literal styled hints on hover and keyboard focus across light/dark 100/125/150 percent zoom without changing the composer draft');
  verified('long real project names and paths retain heading/paragraph semantics, complete escaped text, one active hint, reference dimensions, viewport fit and Escape focus');
  verified('actual Unicode file paths remain keyboard-readable in the editor action bar without changing project bytes or persisted draft ownership');
  verified('real native docked HTML preview path hints retain their session through keyboard focus and Escape at every tested theme/zoom');
  return { checks: 4, screenshots: captures, themes: ['light', 'dark'], zoomFactors: [1, 1.25, 1.5], triggers: 5, editorPathStates,
    scope: 'Actual source Electron model-capacity description, project heading/path, editor path and native docked HTML path. At short-window heights the existing file-tab hint exposes the path while the redundant action-bar text is hidden; both responsive states are asserted. Hover, keyboard, literal text, one active hint, 300px bound, reference font/radius/padding, Escape and focus retained; draft and project bytes preserved. Parent capture is not a composited native child-view capture. Other title-bearing elements, physical accessibility and final distribution remain separate.' };
}
