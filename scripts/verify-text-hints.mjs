import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { assertTextHint } from './text-hint-verification.mjs';
import { verifyAnnotationHints } from './verify-annotation-hints.mjs';
import { documentBytes } from '../verification/attachment-fixtures.mjs';
import { captureDesktopScreenshot } from './desktop-screenshot.mjs';

export async function verifyTextHints({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge }) {
  const captureVisibleHint = async filename => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.control-tooltip:popover-open').count(), 1, 'The hint must remain open before the rendered native capture');
    await captureDesktopScreenshot(application, join(screenshots, filename));
    assert.equal(await page.locator('.control-tooltip:popover-open').count(), 1, 'The native capture must not dismiss the hint');
  };
  const projectId = randomUUID(); const providerId = randomUUID();
  const name = `项目 · ${'完整中文名称😀 <img src=x> '.repeat(4)}`.trim();
  const path = `提示 中文-${'完整路径_'.repeat(5)}.html`; const html = '<!doctype html><meta charset="utf-8"><h1>TEXT_HINT_PREVIEW_EVIDENCE</h1>';
  const draft = 'TEXT_HINT_RETAINS_DRAFT 中文 <literal>';
  const description = '最近请求输入是服务返回的实际用量，不是下一次发送的上下文估算。容量来自服务或手动设置。';
  const mainWindow = "require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/'))";
  const view = `${mainWindow}.contentView.children.find(child => child.webContents && !child.webContents.isDestroyed() && child.webContents.getURL().startsWith('nook-preview:'))`;
  await writeFile(join(projectDirectory, path), html);
  const folder = '资料 中文😀'; const nestedPath = `${folder}/${'完整文件路径_'.repeat(5)}.txt`;
  const nestedContents = 'HINT_TREE_BYTES_MUST_REMAIN_UNCHANGED';
  await mkdir(join(projectDirectory, folder)); await writeFile(join(projectDirectory, nestedPath), nestedContents);
  const branch = `hint/${'完整分支名称-'.repeat(8)}`;
  await promisify(execFile)('git', ['-C', projectDirectory, 'branch', '-m', branch], { windowsHide: true });
  const [pdfAttachment] = await page.evaluate(data => window.qiyao.importAttachments([{ name: '提示 链接.pdf', data }]), documentBytes('pdf', { annotations: true }).toString('base64'));
  await page.evaluate(async ({ projectId, providerId, name, projectDirectory, endpoint }) => {
    await window.qiyao.saveProject({ id: projectId, name, path: projectDirectory, instructions: '', createdAt: 1 });
    await window.qiyao.saveProvider({ id: providerId, name: '提示验证模型', kind: 'ollama', endpoint, models: ['hint-model'], hasKey: false,
      modelCatalog: [{ id: 'hint-model', source: 'manual', inputTokenLimit: 32768, outputTokenLimit: 8192 }] });
  }, { projectId, providerId, name, projectDirectory, endpoint });
  const captures = []; const editorPathStates = []; const hintStyles = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload();
    for (const zoom of [1, 1.25, 1.5]) {
      console.log('Text hint responsive scenario', JSON.stringify({ theme, zoom }));
      const captureAnnotations = theme === 'light' && zoom === 1 || theme === 'dark' && zoom === 1.5;
      const captureHint = async (trigger, kind) => {
        if (!captureAnnotations) return;
        await page.mouse.move(1, 1); await trigger.hover(); await page.locator('.control-tooltip:popover-open').waitFor();
        const filename = `${kind}-hints-${theme}-${Math.round(zoom * 100)}.png`;
        await captureVisibleHint(filename); captures.push(filename);
        await page.keyboard.press('Escape');
      };
      await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(${zoom})`);
      await application.resize(theme === 'light' ? 1280 : 760, theme === 'light' ? 840 : 540);
      await page.keyboard.press('Control+n');
      await page.getByLabel('模型提供商', { exact: true }).selectOption(providerId);
      const composer = page.getByLabel('消息', { exact: true }); await composer.fill(draft);
      const context = page.getByLabel('模型容量与最近请求', { exact: true });
      assert.match(await context.textContent(), /输入上限 32,768/);
      hintStyles.push({ theme, zoom, ...await assertTextHint(page, context, description) });
      await captureHint(context, 'capacity');
      assert.equal(await composer.inputValue(), draft);
      await page.getByRole('button', { name: '项目', exact: true }).click();
      await page.locator('.project-list').getByRole('button', { name, exact: true }).click();
      const heading = page.locator('.project-inspector > .section-heading');
      await assertTextHint(page, heading.getByRole('heading', { name, exact: true }), name);
      await assertTextHint(page, heading.locator('.path-text'), projectDirectory);
      const tree = page.getByRole('tree', { name: '项目文件', exact: true });
      const folderItem = tree.getByRole('treeitem', { name: folder, exact: true });
      await folderItem.locator(':scope > .project-tree-row').click();
      const nestedItem = tree.getByRole('treeitem', { name: nestedPath, exact: true });
      await assertTextHint(page, nestedItem, nestedPath, { hoverTarget: nestedItem.locator(':scope > .project-tree-row') });
      await captureHint(nestedItem.locator(':scope > .project-tree-row'), 'tree');
      assert.equal(await folderItem.getAttribute('aria-expanded'), 'true');
      assert.equal(await tree.locator('[role="treeitem"][tabindex="0"]').count(), 1);
      assert.equal(await tree.locator('.project-tree-row[tabindex]').count(), 0);
      assert.equal(await folderItem.getAttribute('aria-describedby'), null);
      const directoryHint = page.locator('.editor-files-toolbar > span:not([role="tooltip"])').filter({ hasText: /^文件$/ });
      await assertTextHint(page, directoryHint, folder);
      await page.getByRole('button', { name: '查看改动', exact: true }).click();
      const branchHint = page.locator('.changes-list').getByRole('button', { name: '管理项目分支', exact: true });
      await branchHint.filter({ hasText: branch }).waitFor(); await assertTextHint(page, branchHint, branch);
      await captureHint(branchHint, 'branch');
      await page.getByRole('button', { name: '文件', exact: true }).click();
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
      await captureVisibleHint(filename); captures.push(filename);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '关闭预览', exact: true }).click();
      await page.keyboard.press('Control+n');
      assert.equal(await composer.inputValue(), draft);
      assert.equal(await readFile(join(projectDirectory, path), 'utf8'), html);
      await waitForBridge(page, async draft => (await window.qiyao.load()).composerDrafts.some(item => item.text === draft), draft);
      const annotationCapture = captureAnnotations ? `annotation-hints-${theme}-${Math.round(zoom * 100)}.png` : undefined;
      await verifyAnnotationHints({ page, application, attachment: pdfAttachment, draft, screenshotPath: annotationCapture ? join(screenshots, annotationCapture) : undefined });
      if (annotationCapture) captures.push(annotationCapture);
      assert.equal(await readFile(join(projectDirectory, nestedPath), 'utf8'), nestedContents);
    }
  }
  await application.evaluateMain(`${mainWindow}.webContents.setZoomFactor(1)`); await application.resize(1280, 840);
  verified('real model capacity descriptions use literal styled hints on hover and keyboard focus across light/dark 100/125/150 percent zoom without changing the composer draft');
  verified('long real project names and paths retain heading/paragraph semantics, complete escaped text, one active hint, reference dimensions, viewport fit and Escape focus');
  verified('actual Unicode file paths remain keyboard-readable in the editor action bar without changing project bytes or persisted draft ownership');
  verified('real native docked HTML preview path hints retain their session through keyboard focus and Escape at every tested theme/zoom');
  verified('nested Unicode file-tree hints preserve roving keyboard focus, one tab stop, expanded parents, current-directory descriptions and exact file bytes');
  verified('actual long Git branch hints remain complete and keyboard-readable in both themes and all tested zoom factors');
  verified('actual PDF annotation hints preserve direct link rectangles, the 20px note button, inactive script links, external activation, internal navigation, escaped notes and draft text');
  return { checks: 7, screenshots: captures, themes: ['light', 'dark'], zoomFactors: [1, 1.25, 1.5], triggers: 12, editorPathStates, hintStyles,
    scope: 'Actual source Electron capacity, project heading/path, editor and native docked HTML path, nested file tree/current directory, Git branch and four PDF annotation descriptions. At short-window heights the existing file-tab hint exposes the hidden redundant action-bar path. Hover, keyboard, literal text, single active hint, 320px/viewport bound, 16px radius, 5px/12px padding, 18px line height, 430 UI weight and semantic theme palette/border alpha, Escape and focus retained; draft and project bytes preserved. Border pixels are uncomposited CSS samples, not whole-image measurements. PDF activations retain native semantics and exact overlay geometry. Parent capture is not a composited native child-view capture. Physical accessibility, source runtime/custom themes, delay lifecycle, complete regression and final distribution remain separate.' };
}
