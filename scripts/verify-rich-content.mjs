import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { richReply } from '../verification/rich-content-fixture.mjs';

export async function verifyRichContent({ page, application, endpoint, screenshots, verified, waitForBridge }) {
  const requests = []; const track = (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); }; page.on('request', track);
  await application.resize(1280, 840); await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 840);
  await page.addInitScript(() => { window.qiyaoAttack = false; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text) => { window.qiyaoVerificationCopy = text; } }); });
  await page.evaluate(async (url) => { await window.qiyao.saveProvider({ id: 'rendering', name: '内容显示验证', kind: 'ollama', endpoint: url, models: ['verification-model'], hasKey: false }); const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); await window.qiyao.saveComposerDraft({ text: '', attachments: [], providerId: 'rendering', model: 'verification-model', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: Date.now() }); await window.qiyao.activateThread(); }, endpoint);
  await page.reload(); await page.getByRole('heading', { name: '今天想做些什么？' }).waitFor();
  const composer = page.getByRole('textbox', { name: '消息', exact: true }); await composer.fill('RICH_CONTENT_NATIVE'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('RICH_CONTENT_END', { exact: false }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  assert.equal(await page.locator('.katex').count(), 3); assert.equal(await page.locator('.katex-display').count(), 2); assert.equal(await page.locator('.katex math').count(), 3);
  assert.ok(await page.locator('.code-fence[data-language="javascript"] .hljs-keyword').count()); assert.ok(await page.locator('.code-fence[data-language="powershell"] .hljs-built_in').count());
  assert.equal(await page.locator('.code-fence[data-language="javascript"] .hljs-keyword').first().evaluate((node) => getComputedStyle(node).color), 'rgb(171, 79, 122)');
  assert.equal(await page.locator('.hljs-comment').first().evaluate((node) => getComputedStyle(node).fontStyle), 'italic');
  const code = page.locator('.code-fence[data-language="javascript"]'); assert.ok((await code.locator('pre').innerText()).includes('<img src=x onerror=window.qiyaoAttack=true>')); assert.equal(await code.locator('img').count(), 0);
  await code.getByRole('button', { name: '复制代码', exact: true }).click(); assert.equal(await page.evaluate(() => window.qiyaoVerificationCopy), 'const note = "<img src=x onerror=window.qiyaoAttack=true>";\n// 保留 UTF-8 注释\nconsole.log(note);');
  assert.equal(await page.evaluate(() => window.qiyaoAttack), false); assert.ok((await page.locator('.code-fence[data-language="unknown-language"] pre').innerText()).includes('KEEP_UNKNOWN_SOURCE'));
  const graph = page.locator('.code-fence[data-language="mermaid"]'); await graph.locator('iframe').waitFor({ timeout: 30_000 }); const frame = page.frameLocator('iframe[title="Mermaid 图表"]'); await frame.locator('svg').waitFor();
  async function readyGraph() { return frame.locator('svg').evaluate(async (svg) => { await document.fonts.ready; return { viewBox: svg.getAttribute('viewBox'), style: svg.getAttribute('style'), width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height, label: svg.querySelector('text')?.getBoundingClientRect().width }; }); }
  assert.ok((await frame.locator('svg').textContent()).includes('编写代码')); assert.equal(await graph.locator('iframe').getAttribute('sandbox'), 'allow-same-origin');
  const graphGeometry = await readyGraph();
  assert.match(graphGeometry.viewBox, /^[-\d. ]+$/); assert.ok(await frame.locator('.edgePaths path[d]').count());
  assert.equal(new Set(await frame.locator('.nodes > .node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')))).size, 3);
  assert.ok(graphGeometry.width > 250 && graphGeometry.height > 30 && graphGeometry.label > 20, JSON.stringify(graphGeometry));
  assert.equal(await frame.locator('body').evaluate(() => typeof window.qiyao), 'undefined'); assert.equal(await frame.locator('body').evaluate(() => typeof window.require), 'undefined');
  assert.equal(await graph.getByRole('button', { name: '代码自动换行', exact: true }).count(), 0);
  await graph.getByRole('button', { name: '显示图表源码', exact: true }).click(); assert.equal(await graph.locator('pre').innerText(), 'flowchart LR\nA[编写代码] --> B[运行测试]\nB --> C[完成]');
  await graph.getByRole('button', { name: '代码自动换行', exact: true }).click(); assert.equal(await graph.locator('pre').evaluate(element => getComputedStyle(element).whiteSpace), 'pre-wrap');
  await graph.getByRole('button', { name: '复制代码', exact: true }).click(); assert.equal(await page.evaluate(() => window.qiyaoVerificationCopy), 'flowchart LR\nA[编写代码] --> B[运行测试]\nB --> C[完成]');
  await graph.getByRole('button', { name: '显示图表', exact: true }).click(); await frame.locator('svg').waitFor(); assert.equal(await graph.getByRole('button', { name: '代码自动换行', exact: true }).count(), 0);
  const restoredGeometry = await readyGraph(); assert.ok(restoredGeometry.width > 250 && restoredGeometry.height > 30, JSON.stringify(restoredGeometry));
  await graph.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '36-diagram-light.png') });
  await page.locator('.transcript-scroll').evaluate((node) => node.scrollTo({ top: 0 })); await page.waitForFunction(() => document.querySelector('.transcript-scroll').scrollTop === 0); await page.screenshot({ path: join(screenshots, '33-rich-content-light.png') });
  const formulaFaces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((font) => font.family.startsWith('KaTeX_') && font.status === 'loaded').map((font) => font.family); }); assert.ok(formulaFaces.includes('KaTeX_Main') && formulaFaces.includes('KaTeX_Math') && formulaFaces.includes('KaTeX_Size3'));
  assert.equal(await page.evaluate(() => [...document.fonts].filter((font) => font.family.startsWith('KaTeX_')).length), 20);
  verified('native streamed inline/display/fenced formulas, accessible MathML, reference syntax colors, PowerShell and unknown languages, exact code/diagram copy and isolated Mermaid preview/source controls');
  const state = await page.evaluate(() => window.qiyao.load()); const thread = state.threads.find((item) => item.title === 'RICH_CONTENT_NATIVE'); assert.equal(thread.messages.at(-1).content, richReply);
  async function update(content) { await page.evaluate(async ({ id, content }) => { const state = await window.qiyao.load(); const thread = state.threads.find((item) => item.id === id); await window.qiyao.updateThread({ ...thread, messages: thread.messages.map((message, index) => index === thread.messages.length - 1 ? { ...message, content } : message) }); }, { id: thread.id, content }); await page.reload(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor(); }
  const wrappingSource = `\tconst 文本 = "${'LONG中文<&>'.repeat(45)}";\n\n// 保留缩进与空行\nconsole.log(文本);`;
  const longLanguage = 'w'.repeat(40);
  const wrappingContent = `\`\`\`javascript\n${wrappingSource}\n\`\`\`\n\n\`\`\`${longLanguage}\nKEEP_LONG_LANGUAGE\n\`\`\``;
  async function verifyWrapping(theme, zoom) {
    await page.evaluate(async theme => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await update(wrappingContent); await application.resize(760, 540);
    await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/')).webContents.setZoomFactor(${zoom})`);
    await page.waitForFunction(zoom => Math.abs(innerWidth - 760 / zoom) < 2, zoom);
    const pre = code.locator('pre'); const toggle = code.getByRole('button', { name: '代码自动换行', exact: true });
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await pre.evaluate(element => element.scrollWidth > element.clientWidth), true);
    const original = await pre.textContent(); await toggle.focus(); await toggle.press('Space');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await pre.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    assert.equal(await pre.textContent(), original); assert.ok(await code.locator('.hljs-keyword').count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const longHeader = page.locator(`.code-fence[data-language="${longLanguage}"] .code-fence-header`);
    assert.equal(await longHeader.evaluate(element => { const bounds = element.getBoundingClientRect(); return [...element.querySelectorAll('button')].every(button => { const rect = button.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right; }); }), true);
    await code.getByRole('button', { name: '复制代码', exact: true }).click(); assert.equal(await page.evaluate(() => window.qiyaoVerificationCopy), wrappingSource);
    assert.equal(await page.evaluate(async id => (await window.qiyao.load()).threads.find(item => item.id === id).messages.at(-1).content, thread.id), wrappingContent);
    await toggle.focus(); await toggle.scrollIntoViewIfNeeded();
    const capture = await application.evaluateMain("(async () => { const window = require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/')); return { png: (await window.capturePage()).toPNG().toString('base64'), size: window.getContentSize() }; })()");
    const png = Buffer.from(capture.png, 'base64'); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], capture.size);
    await writeFile(join(screenshots, `code-wrap-${theme}-${zoom * 100}.png`), png);
    await toggle.press('Enter'); assert.equal(await toggle.getAttribute('aria-pressed'), 'false'); assert.equal(await pre.evaluate(element => element.scrollWidth > element.clientWidth), true);
    await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('qiyao://app/')).webContents.setZoomFactor(1)");
  }
  await verifyWrapping('light', 1); await verifyWrapping('dark', 1.5);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await update(richReply); await application.resize(1280, 840); await frame.locator('svg').waitFor();
  await page.locator('.transcript-scroll').evaluate(element => element.scrollTo({ top: 0 }));
  await page.getByRole('button', { name: /^设置/ }).click(); await page.getByRole('button', { name: '外观与交互', exact: true }).click(); await page.getByLabel('主题', { exact: true }).selectOption('dark'); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && document.documentElement.dataset.theme === 'dark'); await frame.locator('svg').waitFor();
  const narrowGeometry = await readyGraph(); assert.ok(narrowGeometry.width > 250 && narrowGeometry.height > 30, JSON.stringify(narrowGeometry));
  assert.equal(await page.locator('.code-fence[data-language="javascript"] .hljs-keyword').first().evaluate((node) => getComputedStyle(node).color), 'rgb(248, 166, 200)');
  assert.ok(await page.locator('.transcript-scroll').evaluate((node) => node.scrollTop <= 1), 'Diagram/theme layout must retain the reader’s manual scroll position.');
  await page.screenshot({ path: join(screenshots, '34-rich-content-dark-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await graph.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '37-diagram-dark-narrow.png') });
  const hostile = ['```mermaid', '%%{init: {"securityLevel":"loose","htmlLabels":true}}%%', 'flowchart LR', 'A["<img src=https://example.invalid/diagram-image onerror=window.qiyaoAttack=true>"] --> B[SAFE_GRAPH_EVIDENCE]', 'click A "javascript:window.qiyaoAttack=true"', '```', '', '$\\includegraphics{https://example.invalid/math-image}$', '', '<script>window.qiyaoAttack=true</script>'].join('\n');
  await update(hostile); await frame.locator('svg').getByText('SAFE_GRAPH_EVIDENCE', { exact: false }).waitFor(); assert.equal(await frame.locator('a, image, foreignObject, script, iframe, [onload], [onclick], [onerror]').count(), 0); assert.equal(await page.evaluate(() => window.qiyaoAttack), false); assert.equal(await page.locator('.assistant-prose img, .assistant-prose script').count(), 0); assert.deepEqual(requests, []);
  for (const { source, label } of [{ source: 'sequenceDiagram\nAlice->>Bob: SEQUENCE_EVIDENCE\nBob-->>Alice: Reply', label: 'SEQUENCE_EVIDENCE' }, { source: 'classDiagram\nclass CLASS_EVIDENCE\nclass Result\nCLASS_EVIDENCE --> Result', label: 'CLASS_EVIDENCE' }]) { await update(`\`\`\`mermaid\n${source}\n\`\`\``); await frame.locator('svg').waitFor(); assert.ok((await frame.locator('svg').textContent()).includes(label)); const geometry = await readyGraph(); assert.ok(geometry.viewBox && geometry.width > 100 && geometry.height > 30, JSON.stringify(geometry)); }
  await update('```mermaid\nINVALID_GRAPH (((\n```'); await graph.getByText('无法绘制图表，源码已保留。', { exact: true }).waitFor(); assert.equal(await graph.locator('pre').innerText(), 'INVALID_GRAPH (((');
  await update(`\`\`\`mermaid\n${'A'.repeat(50_001)}\n\`\`\``); await graph.getByText('无法绘制图表，源码已保留。', { exact: true }).waitFor(); assert.equal((await graph.locator('pre').innerText()).length, 50_001);
  await page.screenshot({ path: join(screenshots, '35-rich-content-error-narrow.png') }); await update(richReply); await frame.locator('svg').waitFor();
  await waitForBridge(page, async ({ id, content }) => (await window.qiyao.load()).threads.find((item) => item.id === id)?.messages.at(-1)?.content === content, { id: thread.id, content: richReply });
  verified('dark/minimum-window rich content, locked graph directives, inert HTML/remote math commands, no automatic external requests, complete malformed/oversized source preservation and recovery after diagram failure');
  page.off('request', track);
  return { formulaFaces, lightGraph: graphGeometry, narrowGraph: narrowGeometry, automaticExternalRequests: requests, codeWrapping: { themes: ['light', 'dark'], zoom: [1, 1.5], keyboard: true, exactCopyAndStoredSource: true, boundary: 'Clipboard write is intercepted by the existing native fixture; this does not prove the physical OS clipboard.' } };
}
