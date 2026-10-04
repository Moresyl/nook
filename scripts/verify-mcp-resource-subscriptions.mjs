import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyMcpResourceSubscriptions({ page, application, getApplication, root, screenshots, verified, waitForBridge, restart, modelRequests }) {
  await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/')).webContents.setZoomFactor(1)");
  await application.resize(1280, 840);
  await waitForBridge(page, () => innerWidth === 1280 && innerHeight === 840);
  const beforeRequests = modelRequests(); const id = randomUUID(); const unsupportedId = randomUUID();
  const name = `订阅验证 MCP ${id}`; const unsupportedName = `不支持订阅 MCP ${unsupportedId}`; const documentUri = 'fixture://document';
  const profileUri = `fixture://profiles/${encodeURIComponent('订阅中文用户')}`;
  const captures = []; const draft = 'MCP_SUBSCRIPTION_KEEP_DRAFT 中文 <literal>';
  const connection = await page.evaluate(async ({ id, unsupportedId, name, unsupportedName, fixture, command }) => {
    for (const [serverId, serverName, args] of [[id, name, [fixture]], [unsupportedId, unsupportedName, [fixture, '--no-subscriptions']]]) {
      await window.qiyao.saveMcpServer({ id: serverId, name: serverName, transport: 'stdio', command, args, enabled: true, timeout: 5000 }, { env: {} });
    }
    const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' });
    const startedAt = Date.now(); const connected = await window.qiyao.mcpConnect(id);
    return { startedAt, completedAt: Date.now(), status: connected.status, error: connected.error, resourceSubscriptionsSupported: connected.resourceSubscriptionsSupported };
  }, { id, unsupportedId, name, unsupportedName, fixture: join(root, 'verification/mcp-fixture.mjs'), command: process.execPath });
  console.log('MCP subscription connection observations', JSON.stringify(connection));
  await page.reload(); await page.keyboard.press('Control+n'); await page.getByLabel('消息', { exact: true }).fill(draft);
  const dialog = () => page.getByRole('dialog');
  const preview = () => page.getByLabel('MCP 内容预览', { exact: true });
  async function open(serverName = name) {
    if (!await dialog().isVisible()) { await page.keyboard.press('Control+,'); await dialog().waitFor(); }
    await page.getByRole('button', { name: 'MCP 工具', exact: true }).click();
    const back = page.getByRole('button', { name: '← 返回服务器列表', exact: true }); if (await back.isVisible()) await back.click();
    await page.locator('.extension-server').filter({ hasText: serverName }).getByRole('button', { name: '资源与提示词', exact: true }).click();
    await page.getByRole('heading', { name: serverName, exact: true }).waitFor();
  }
  const view = async (serverId = id) => (await page.evaluate(() => window.qiyao.mcpViews())).find((item) => item.id === serverId);
  const waitRevision = (minimum) => waitForBridge(page, (minimum) => Number(document.querySelector('.extension-preview')?.textContent.match(/MCP_SUBSCRIPTION_REVISION:(\d+)/)?.[1]) >= minimum, minimum);
  async function capture(filename) {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await application.evaluateMain("require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/')).capturePage().then(image => image.toPNG().toString('base64'))");
    await writeFile(join(screenshots, filename), Buffer.from(png, 'base64')); captures.push(filename);
  }
  const initialView = await view();
  console.log('MCP subscription preflight observations', JSON.stringify({ capturedAt: Date.now(), status: initialView?.status, error: initialView?.error, resourceSubscriptionsSupported: initialView?.resourceSubscriptionsSupported }));
  assert.equal(initialView.resourceSubscriptionsSupported, true);
  await open(); await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri);
  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click();
  await waitRevision(2);
  assert.deepEqual((await view()).subscribedResources, [documentUri]);
  assert.equal(await preview().locator('img').count(), 0); await capture('122-mcp-subscription-live-light.png');
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  assert.equal(await preview().getByRole('button', { name: '用于对话', exact: true }).isEnabled(), true);
  await preview().getByRole('button', { name: '用于对话', exact: true }).click();
  if (await dialog().isVisible()) await page.keyboard.press('Escape');
  const inserted = await page.getByLabel('消息', { exact: true }).inputValue();
  assert.ok(inserted.includes(draft) && inserted.includes(documentUri) && inserted.includes('MCP_SUBSCRIPTION_REVISION:'));
  assert.equal(modelRequests(), beforeRequests);
  await page.getByLabel('消息', { exact: true }).fill(draft);
  await open(); await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri); await waitRevision(2);
  verified('native explicit resource subscription shows progress during repeated real stdio updates, keeps the draft untouched until manual insertion and inserts the literal preview without any model request');

  await page.evaluate(() => { window.__qiyaoSubscriptionEvents = []; window.__qiyaoSubscriptionUnsubscribe = window.qiyao.onMcpResource((event) => window.__qiyaoSubscriptionEvents.push(event)); });
  await page.getByRole('button', { name: '停止订阅所选资源', exact: true }).click();
  await waitForBridge(page, async (id) => (await window.qiyao.mcpViews()).find((item) => item.id === id)?.subscribedResources.length === 0, id);
  const retained = await preview().innerText(); const eventsBeforeLate = await page.evaluate(() => window.__qiyaoSubscriptionEvents.length);
  await waitForBridge(page, async ({ id, documentUri }) => (await window.qiyao.mcpReadResource(id, documentUri)).text.includes('LATE_AFTER_UNSUBSCRIBE'), { id, documentUri });
  assert.equal(await preview().innerText(), retained);
  assert.equal(await page.evaluate(() => window.__qiyaoSubscriptionEvents.length), eventsBeforeLate);
  assert.deepEqual((await view()).subscribedResources, []); assert.equal(await page.getByRole('button', { name: '订阅所选资源', exact: true }).isEnabled(), true);
  verified('native unsubscribe stops the exact resource, retains its last preview and filters an actual delayed server notification after unsubscribe');

  await page.getByLabel('资源模板', { exact: true }).selectOption('fixture://profiles/{user}');
  await page.getByLabel('资源参数 user', { exact: true }).fill('订阅中文用户'); assert.equal(await page.getByLabel('资源 URI', { exact: true }).inputValue(), profileUri);
  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click();
  await waitRevision(1);
  await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri);
  await preview().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click();
  await waitRevision(1);
  assert.ok((await preview().innerText()).includes(documentUri)); assert.ok(!(await preview().innerText()).includes(profileUri));
  assert.deepEqual((await view()).subscribedResources, [profileUri, documentUri]);
  verified('Unicode resource-template subscriptions coexist while changing the selected URI prevents old-resource notifications from replacing the selected preview');

  await page.evaluate((id) => window.qiyao.mcpDisconnect(id), id);
  await waitForBridge(page, () => !document.querySelector('.extension-preview'));
  assert.deepEqual((await view()).subscribedResources, []);
  await page.evaluate(async ({ id, unsupportedId }) => { await window.qiyao.mcpConnect(id); await window.qiyao.mcpConnect(unsupportedId); }, { id, unsupportedId });
  assert.deepEqual((await view()).subscribedResources, []); assert.equal((await view(unsupportedId)).resourceSubscriptionsSupported, false);
  await open(unsupportedName); await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri);
  assert.equal(await page.getByRole('button', { name: '订阅所选资源', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText('此服务器不支持资源订阅。', { exact: false }).isVisible(), true);
  verified('actual disconnect removes all watches, reconnect starts without subscriptions and an unsupported real server disables the native subscription control');

  await open(); await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri);
  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click();
  await waitRevision(1);
  await page.keyboard.press('Escape'); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  await page.evaluate(() => { window.__qiyaoSubscriptionUnsubscribe?.(); delete window.__qiyaoSubscriptionUnsubscribe; delete window.__qiyaoSubscriptionEvents; });
  page = await restart(); application = getApplication();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  const restarted = await view(); assert.ok(!restarted || restarted.subscribedResources.length === 0);
  verified('normal application restart removes connection-scoped resource subscriptions while preserving the original independent composer draft');

  await page.evaluate(async (id) => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'dark' }); await window.qiyao.mcpConnect(id); }, id);
  await page.reload(); await open(); await page.getByLabel('服务器资源', { exact: true }).selectOption(documentUri);
  await page.getByRole('button', { name: '订阅所选资源', exact: true }).click();
  await waitRevision(1);
  await application.resize(760, 540);
  for (const zoom of [1, 1.25, 1.5]) {
    await application.evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && window.webContents.getURL().startsWith('qiyao://app/')).webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page, ({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1, { width: 760 / zoom, height: 540 / zoom });
    const stop = page.getByRole('button', { name: '停止订阅所选资源', exact: true });
    await page.getByLabel('资源 URI', { exact: true }).focus();
    for (let step = 0; step < 10 && !await stop.evaluate((button) => button === document.activeElement); step++) await page.keyboard.press('Tab');
    assert.equal(await stop.evaluate((button) => button === document.activeElement), true);
    const bounds = await stop.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 540 / zoom + 1);
    assert.equal(await dialog().isVisible(), true); await capture(`123-mcp-subscription-dark-zoom-${Math.round(zoom * 100)}.png`);
  }
  await page.getByRole('button', { name: '停止订阅所选资源', exact: true }).click();
  await page.keyboard.press('Escape'); assert.equal(await dialog().isVisible(), false); assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), draft);
  assert.equal(modelRequests(), beforeRequests);
  verified('live subscription controls remain keyboard-accessible in the real dark minimum window at 100/125/150 percent zoom, Escape retains the opener draft and the complete suite makes no model request');
  return { page, result: { checks: 6, screenshots: captures, modelRequests: 0, realNotificationsVerified: true, explicitDraftInsertionVerified: true, delayedUnsubscribeFiltered: true, templateSelectionVerified: true, disconnectRestartVerified: true, unsupportedServerVerified: true, zoomKeyboardVerified: true, originalDraftRetained: true } };
}
