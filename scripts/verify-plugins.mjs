import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPluginFixture } from '../verification/plugin-fixture.mjs';

export async function verifyPlugins({ page, application, directory, projectDirectory, domain, screenshots, verified, waitForBridge }) {
  const source = join(directory, 'plugin-fixture'); await createPluginFixture(source, domain);
  await application.evaluateMain(`globalThis.qiyaoPluginOpenDialog = require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(source)}] });`);
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '本地插件', exact: true }).click(); await page.getByRole('button', { name: '导入插件…', exact: true }).click();
  await page.getByRole('button', { name: /验证插件 已停用/ }).click();
  await application.evaluateMain("require('electron').dialog.showOpenDialog = globalThis.qiyaoPluginOpenDialog; delete globalThis.qiyaoPluginOpenDialog;");
  const plugin = (await page.evaluate(() => window.qiyao.load())).plugins[0]; assert.equal(plugin.enabled, false); assert.deepEqual(plugin.grants, []);
  assert.ok((await readFile(join(directory, 'plugins', plugin.id, 'LICENSE'), 'utf8')).includes('Preserve'));
  assert.deepEqual(await readFile(join(directory, 'plugins', plugin.id, 'image.bin')), Buffer.from([0, 255, 128]));
  for (const name of ['启用插件', '向模型提供工具（每次调用审批）', '执行你点击的插件命令', '显示插件面板', '保存插件自己的数据', '读取当前调用所选项目', '请求写入项目文件（单独审批）', '访问声明的网络地址']) await page.locator('.toggle-label').filter({ hasText: name }).click();
  await page.getByRole('button', { name: '保存插件设置', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.pluginViews())[0]?.status === 'running');
  await page.getByRole('button', { name: '执行命令', exact: true }).waitFor();
  await page.getByLabel('选择命令', { exact: true }).selectOption('greet'); await page.getByRole('button', { name: '执行命令', exact: true }).click();
  await page.getByLabel('插件命令结果').getByText(/PLUGIN_COMMAND_EVIDENCE/).waitFor();
  const command = JSON.parse(await page.getByLabel('插件命令结果').innerText()); assert.equal(command.count, 1); assert.equal(command.node, 'undefined'); assert.equal(command.require, 'undefined');
  const runtime = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('qiyao-plugin:')).map(w=>({sandbox:w.webContents.getLastWebPreferences().sandbox,node:w.webContents.getLastWebPreferences().nodeIntegration,isolation:w.webContents.getLastWebPreferences().contextIsolation,visible:w.isVisible()}))");
  assert.deepEqual(runtime, [{ sandbox: true, node: false, isolation: true, visible: false }]);
  await page.getByRole('button', { name: '插件仪表板', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  const frame = page.frameLocator('iframe[title="插件仪表板"]'); await frame.getByText(/parentBlocked/).waitFor();
  const isolation = JSON.parse(await frame.getByLabel('面板命令结果').innerText()); assert.equal(isolation.parentBlocked, true); assert.equal(isolation.node, 'undefined'); assert.equal(isolation.require, 'undefined'); assert.equal(isolation.app, 'undefined');
  const actualFrame = page.frames().find((item) => item.url().startsWith(`qiyao-plugin://${plugin.id}/`)); assert.ok(actualFrame);
  const lightFont = await actualPanelFont(actualFrame);
  assert.equal(await actualFrame.evaluate(async () => (await fetch('/files/.env')).status), 404);
  await assert.rejects(actualFrame.evaluate(() => fetch('http://outside.example/')), /Failed to fetch/);
  await assert.rejects(actualFrame.evaluate(() => window.qiyaoPlugin.call('project.read', { path: 'README.md' })), /请求失败/);
  await frame.getByRole('button', { name: '运行插件问候', exact: true }).focus(); await page.keyboard.press('Enter'); await frame.getByText(/PLUGIN_COMMAND_EVIDENCE/).waitFor(); assert.equal(JSON.parse(await frame.getByLabel('面板命令结果').innerText()).count, 2);
  // Capture the visible panel before sending CDP pointer input to its separate frame.
  await page.screenshot();
  await frame.getByRole('button', { name: '运行插件问候', exact: true }).click();
  await actualFrame.waitForFunction(() => document.querySelector('#result').textContent.includes('"count":3'));
  assert.equal(await actualFrame.evaluate(() => panelEvents.some((event) => event.type === 'pointerdown' && event.target === 'greet')), true);
  await page.locator('.plugin-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '27-plugin-panel-light.png') });
  verified('complete plugin import, explicit grants, real isolated runtime, persistent keyboard/pointer commands and a workspace panel unable to read parent or project APIs');
  await page.getByRole('button', { name: '关闭插件面板', exact: true }).click();
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '外观与交互', exact: true }).click(); await page.getByLabel('主题', { exact: true }).selectOption('dark'); await page.getByRole('button', { name: '本地插件', exact: true }).click(); await page.getByRole('button', { name: /验证插件 运行中/ }).click(); await page.getByRole('button', { name: '插件仪表板', exact: true }).click();
  await frame.getByText(/parentBlocked/).waitFor(); await actualPanelTheme(page, 'dark');
  const darkFont = await actualPanelFont(page.frames().find((item) => item.url().startsWith(`qiyao-plugin://${plugin.id}/`)));
  await application.resize(760, 540); await page.waitForFunction(() => window.innerWidth === 760 && window.innerHeight === 540); await page.locator('.plugin-panel').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false); await page.screenshot({ path: join(screenshots, '28-plugin-panel-dark-narrow.png') });
  await page.getByRole('button', { name: '关闭插件面板', exact: true }).click(); await application.resize(1280, 840); await page.waitForFunction(() => window.innerWidth === 1280);
  verified('plugin panel follows the reference theme and remains usable in the minimum supported window');
  async function selectPlugin(project = false) {
    await page.keyboard.press('Control+n'); if (project) await page.getByLabel('选择项目').selectOption('verification-project');
    await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); await page.locator('.toggle-label').filter({ hasText: '验证插件' }).click(); await page.getByRole('button', { name: '完成', exact: true }).click();
  }
  for (const [prompt, expected] of [['调用插件', '插件工具已验证。'], ['拒绝插件', '插件调用已拒绝。'], ['联网插件', '插件联网已验证。'], ['读取插件', '插件读取已验证。']]) {
    await selectPlugin(prompt === '读取插件'); await page.getByLabel('消息', { exact: true }).fill(prompt); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('dialog', { name: '审批插件工具调用' }).waitFor(); await page.getByText('验证插件 · evidence', { exact: true }).waitFor();
    if (prompt === '调用插件') await page.screenshot({ path: join(screenshots, '29-plugin-approval.png') });
    await page.getByRole('dialog').getByRole('button', { name: prompt === '拒绝插件' ? '拒绝' : '允许这次调用', exact: true }).click();
    await page.getByText(expected, { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  }
  verified('plugin model approvals/denial, optional schemas, declared-domain networking and revision reads excluding private files');
  await selectPlugin(true); await page.getByLabel('消息', { exact: true }).fill('写入插件'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('dialog', { name: '审批插件工具调用' }).waitFor(); await page.getByRole('button', { name: '允许这次调用', exact: true }).click();
  await page.getByRole('dialog', { name: '审批新建文件' }).waitFor(); await assert.rejects(readFile(join(projectDirectory, 'plugin-created.txt')));
  await page.getByRole('button', { name: '允许这次修改', exact: true }).click(); await page.getByText('插件写入已验证。', { exact: true }).waitFor(); assert.equal(await readFile(join(projectDirectory, 'plugin-created.txt'), 'utf8'), 'PLUGIN_WRITE_EVIDENCE');
  verified('a granted plugin still requires a separate exact file approval before writing the chosen project');
  await selectPlugin(); await page.getByLabel('消息', { exact: true }).fill('停止插件'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('dialog', { name: '审批插件工具调用' }).waitFor(); await page.getByRole('button', { name: '允许这次调用', exact: true }).click();
  await page.locator('.tool-running').waitFor(); await page.getByRole('button', { name: '停止生成', exact: true }).click(); await page.getByText('已停止生成', { exact: true }).waitFor();
  await waitForBridge(page, async () => (await window.qiyao.pluginViews())[0]?.status === 'stopped'); assert.equal((await page.evaluate(() => window.qiyao.pendingApprovals())).length, 0);
  await page.evaluate((id) => window.qiyao.pluginReload(id), plugin.id);
  const reduced = { id: plugin.id, enabled: true, grants: ['tools', 'commands', 'panels'], projectIds: [] }; await page.evaluate((input) => window.qiyao.savePlugin(input), reduced);
  await assert.rejects(page.evaluate((id) => window.qiyao.pluginCommand(id, 'greet', {}), plugin.id), /command failed/);
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions });
  verified('stopping an in-flight plugin terminates its runtime, clears approval state and enforces revoked storage grants after reload');
  await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('qiyao-plugin:')).webContents.forcefullyCrashRenderer()");
  await waitForBridge(page, async () => !(await window.qiyao.load()).plugins[0].enabled && (await window.qiyao.pluginViews())[0]?.status === 'error');
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions });
  await page.evaluate(async (path) => { await window.qiyao.saveProject({ id: 'plugin-scope-test', name: '临时插件范围', path, instructions: '', createdAt: 1 }); }, source);
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions, projectIds: ['plugin-scope-test'] });
  await page.evaluate(() => window.qiyao.removeProject('plugin-scope-test')); assert.equal((await page.evaluate(() => window.qiyao.load())).plugins[0].enabled, false);
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions });
  verified('a real plugin renderer crash disables the plugin; removing its scoped project stops it without broadening access');
  await application.evaluateMain(`globalThis.qiyaoPluginProtocol = require('electron').session.fromPartition('qiyao-plugin-runtime-${plugin.id}').protocol; globalThis.qiyaoPluginProtocolHandle = globalThis.qiyaoPluginProtocol.handle; globalThis.qiyaoPluginProtocol.handle = () => { throw new Error('Verification protocol setup failure'); };`);
  let failedSetup;
  try { failedSetup = await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions }); }
  finally { await application.evaluateMain('globalThis.qiyaoPluginProtocol.handle = globalThis.qiyaoPluginProtocolHandle; delete globalThis.qiyaoPluginProtocol; delete globalThis.qiyaoPluginProtocolHandle;'); }
  assert.equal(failedSetup.plugins[0].enabled, false);
  assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('qiyao-plugin:') || w.getTitle().startsWith('Qiyao · ')).length"), 0);
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, grants: plugin.manifest.permissions });
  verified('native protocol setup failure disables the plugin and destroys its partially initialized window before retry');
  const hangingSource = join(directory, 'plugin-hanging'); const hangingManifest = await createPluginFixture(hangingSource, domain);
  await writeFile(join(hangingSource, 'qiyao-plugin.json'), JSON.stringify({ ...hangingManifest, id: 'example.hanging', name: '超时验证插件', permissions: [], domains: [], tools: [], commands: [], panels: [] }));
  await writeFile(join(hangingSource, 'main.js'), 'export default () => new Promise(() => {});');
  await application.evaluateMain(`globalThis.qiyaoPluginOpenDialog = require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(hangingSource)}] });`);
  const imported = await page.evaluate(() => window.qiyao.importPlugin()); const hangingId = imported.plugins.find((item) => item.manifest.id === 'example.hanging').id;
  await application.evaluateMain("require('electron').dialog.showOpenDialog = globalThis.qiyaoPluginOpenDialog; delete globalThis.qiyaoPluginOpenDialog;");
  const activationStarted = Date.now(); const failedActivation = await page.evaluate((id) => window.qiyao.savePlugin({ id, enabled: true, grants: [], projectIds: [] }), hangingId);
  assert.equal(failedActivation.plugins.find((item) => item.id === hangingId).enabled, false); assert.ok(Date.now() - activationStarted < 15_000);
  assert.equal((await page.evaluate(() => window.qiyao.pluginViews())).find((item) => item.id === hangingId).status, 'error');
  assert.equal(await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('qiyao-plugin:')).length"), 1);
  await page.evaluate((id) => window.qiyao.removePlugin(id), hangingId);
  verified('a non-finishing plugin activation reaches its native startup deadline, disables itself and leaves no orphan runtime');
  const backupPath = join(directory, 'plugin-backup.json');
  await application.evaluateMain(`globalThis.qiyaoPluginSaveDialog = require('electron').dialog.showSaveDialog; require('electron').dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(backupPath)} });`);
  assert.equal(await page.evaluate(() => window.qiyao.exportWorkspace()), true);
  await application.evaluateMain("require('electron').dialog.showSaveDialog = globalThis.qiyaoPluginSaveDialog; delete globalThis.qiyaoPluginSaveDialog;");
  await application.evaluateMain(`globalThis.qiyaoPluginOpenDialog = require('electron').dialog.showOpenDialog; globalThis.qiyaoPluginMessageDialog = require('electron').dialog.showMessageBox; require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(backupPath)}] }); require('electron').dialog.showMessageBox = async () => ({response:1});`);
  const restored = await page.evaluate(() => window.qiyao.importWorkspace());
  await application.evaluateMain("require('electron').dialog.showOpenDialog = globalThis.qiyaoPluginOpenDialog; require('electron').dialog.showMessageBox = globalThis.qiyaoPluginMessageDialog; delete globalThis.qiyaoPluginOpenDialog; delete globalThis.qiyaoPluginMessageDialog;");
  const replacement = restored.plugins[0]; assert.notEqual(replacement.id, plugin.id); assert.equal(replacement.enabled, false); assert.deepEqual(replacement.grants, []); assert.equal(replacement.data.count, 3); assert.deepEqual(replacement.hashes, plugin.hashes);
  assert.equal(restored.threads.find((item) => item.title === '调用插件').pluginIds[0], replacement.id);
  assert.ok((await readFile(join(directory, 'plugins', replacement.id, 'LICENSE'), 'utf8')).includes('Preserve')); assert.ok((await readFile(join(directory, 'plugins', plugin.id, 'LICENSE'), 'utf8')).includes('Preserve'));
  await page.evaluate((input) => window.qiyao.savePlugin(input), { ...reduced, id: replacement.id, grants: plugin.manifest.permissions });
  await page.reload(); await page.getByLabel('消息', { exact: true }).waitFor();
  verified('native backup and restore preserve complete plugin assets and data, remap thread selections and require fresh grants');
  return { id: replacement.id, fonts: [lightFont, darkFont] };
}
async function actualPanelFont(frame) {
  assert.ok(frame);
  const font = await frame.evaluate(async () => {
    const response = await fetch('/_qiyao/font.woff2'); const bytes = await response.arrayBuffer();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const weights = await Promise.all([400, 510, 590, 700].map(async (weight) => ({ weight, faces: (await document.fonts.load(`${weight} 12px "Inter"`)).map((face) => ({ family: face.family, status: face.status })) })));
    return { theme: document.documentElement.dataset.theme, family: getComputedStyle(document.documentElement).fontFamily, status: response.status, contentType: response.headers.get('Content-Type'), bytes: bytes.byteLength, sha256, weights };
  });
  assert.equal(font.status, 200); assert.equal(font.contentType, 'font/woff2'); assert.equal(font.bytes, 352240); assert.equal(font.sha256, '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3');
  assert.ok(font.family.startsWith('Inter')); assert.ok(font.weights.every(({ faces }) => faces.length > 0 && faces.every((face) => face.family === 'Inter' && face.status === 'loaded')));
  return font;
}
async function actualPanelTheme(page, theme) {
  const frame = page.frames().find((item) => item.url().startsWith('qiyao-plugin:')); assert.ok(frame); await frame.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
}
