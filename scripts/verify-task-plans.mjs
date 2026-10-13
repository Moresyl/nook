import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

const mainWindow = 'electron.BrowserWindow.getAllWindows().find(window => !window.isDestroyed() && !window.webContents.getURL().includes("view=quick-chat"))';
export async function verifyTaskPlans({ page, application, getApplication, directory, screenshots, endpoint, fixture, verified, waitForBridge, errors, restart }) {
  const original = await page.evaluate(() => window.qiyao.load()), geometry = await application.evaluateMain(`({size:${mainWindow}.getContentSize(),zoom:${mainWindow}.webContents.getZoomFactor()})`);
  const providerId = 'task-plan-provider', projectId = 'task-plan-project', threadIds = [], captures = [], layouts = [];
  const readme = join(directory, 'project-fixture/README.md'), originalReadme = await readFile(readme);
  await page.evaluate(async ({ endpoint, directory, providerId, projectId }) => {
    await window.qiyao.saveProvider({ id: providerId, name: '任务步骤验证', kind: 'openai', endpoint: new URL('/task-plan/v1', endpoint).href, models: ['task-plan-model'], hasKey: false }, 'local-verification-key');
    await window.qiyao.saveProject({ id: projectId, name: '任务步骤验证项目', path: `${directory}/project-fixture`, instructions: '', createdAt: 1 });
  }, { endpoint, directory, providerId, projectId });
  await page.reload();
  async function openProject() { await page.locator('.primary-nav').getByRole('button', { name: '项目', exact: true }).click(); await page.locator('.project-list').getByRole('button', { name: '任务步骤验证项目', exact: true }).click(); }
  async function start(marker) {
    await openProject(); await page.getByRole('button', { name: '新建项目聊天', exact: true }).click();
    await page.getByLabel('模型提供商', { exact: true }).selectOption(providerId); await page.getByLabel('选择模型', { exact: true }).selectOption('task-plan-model'); await page.getByLabel('工作模式', { exact: true }).selectOption('plan');
    await page.getByLabel('消息', { exact: true }).fill(marker); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await waitForBridge(page, () => Boolean(document.querySelector('.task-plan')));
    const thread = await page.evaluate(async providerId => (await window.qiyao.load()).threads.findLast(thread => thread.providerId === providerId), providerId); threadIds.push(thread.id);
    return thread.id;
  }
  const plan = () => page.getByLabel('任务步骤记录', { exact: true }).last();
  const capture = async filename => { await page.screenshot({ path: join(screenshots, filename) }); captures.push(filename); };
  const finishedId = await start('任务步骤完成验证');
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'complete', finishedId);
  assert.match(await plan().locator('header').textContent(), /2\s*\/\s*3 标记完成/);
  assert.deepEqual(await plan().locator('li small').allTextContents(), ['完成', '完成', '待办']);
  const finished = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), finishedId);
  assert.deepEqual(finished.messages.at(-1).activities.map(activity => [activity.name, activity.status]), [['update_plan', 'complete'], ['read_file', 'complete'], ['update_plan', 'complete']]);
  assert.ok(fixture.requests.every(request => request.tools.includes('update_plan')));
  verified('native task plan updates surround an actual read-only file tool and retain an unfinished step after the reply completes');
  assert.ok((await readFile(readme)).equals(originalReadme)); await assert.rejects(readFile(join(directory, 'project-fixture/PLAN.md')), { code: 'ENOENT' });
  verified('native task step recording preserves every project file byte and does not create a plan document');
  assert.equal(await plan().locator('img').count(), 0); assert.ok((await plan().locator('li').first().textContent()).includes('<img src=x onerror=alert(1)>'));
  verified('task step HTML-like text and Unicode remain plain text in the actual desktop record');
  const firstRecord = page.locator('.tool-activity').first(); await firstRecord.locator('.tool-activity-toggle').press('Enter');
  assert.equal(await firstRecord.locator('.tool-activity-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await firstRecord.getByLabel('输入原文', { exact: true }).textContent(), finished.messages.at(-1).activities[0].input);
  assert.equal(await firstRecord.getByLabel('结果原文', { exact: true }).textContent(), finished.messages.at(-1).activities[0].output);
  await firstRecord.locator('.tool-activity-toggle').press('Space');
  verified('structured task display retains exact raw input and output through genuine keyboard disclosure');
  for (const theme of ['light', 'dark']) for (const size of [[1280, 840], [760, 540]]) for (const zoom of [1, 1.25, 1.5]) {
    await page.keyboard.press('Control+,'); const settings = page.getByRole('dialog', { name: '设置', exact: true }); await settings.waitFor();
    await settings.getByRole('button', { name: '外观与交互', exact: true }).click(); await settings.getByLabel('主题', { exact: true }).selectOption(theme);
    await waitForBridge(page, theme => document.documentElement.dataset.theme === theme, theme); await dismissModalWithEscape(page, settings);
    await application.evaluateMain(`${mainWindow}.setContentSize(${size.join(',')});${mainWindow}.webContents.setZoomFactor(${zoom})`);
    await waitForBridge(page, ({ zoom, width }) => Math.abs(innerWidth - width / zoom) <= 1, { zoom, width: size[0] }); await plan().locator('header').scrollIntoViewIfNeeded();
    const layout = await plan().evaluate(element => { const rect = element.getBoundingClientRect(), header = element.querySelector('header').getBoundingClientRect(), scroll = element.closest('.transcript-scroll').getBoundingClientRect(), style = getComputedStyle(element); return { contained: rect.left >= 0 && rect.right <= innerWidth + 1, headerVisible: header.top >= Math.max(0, scroll.top) && header.bottom <= Math.min(innerHeight, scroll.bottom), horizontalOverflow: document.documentElement.scrollWidth > innerWidth, padding: style.padding, border: style.borderTopWidth, count: element.querySelectorAll('li').length }; });
    assert.equal(layout.contained, true); assert.equal(layout.headerVisible, true); assert.equal(layout.horizontalOverflow, false); assert.equal(layout.padding, '12px'); assert.equal(layout.border, '1px'); assert.equal(layout.count, 3);
    layouts.push({ theme, size, zoom, ...layout }); await capture(`task-plans-${theme}-${size[0]}-${zoom * 100}.png`);
  }
  verified('task plan records remain horizontally contained with visible headers in twelve native theme size and zoom layouts');
  await application.evaluateMain(`${mainWindow}.setContentSize(1280,840);${mainWindow}.webContents.setZoomFactor(1)`);
  await page.getByLabel('消息', { exact: true }).fill('TASK_PLAN_UNSENT 中文😀');
  const stoppedId = await start('任务步骤停止验证');
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.content.includes('等待后续步骤'), stoppedId);
  assert.equal(await plan().getAttribute('data-response-status'), 'running');
  const runningColors = await plan().locator('li > svg').evaluateAll(elements => elements.map(element => getComputedStyle(element).color)); assert.notEqual(runningColors[0], runningColors[1]);
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await waitForBridge(page, async id => (await window.qiyao.load()).threads.find(thread => thread.id === id)?.messages.at(-1)?.status === 'stopped', stoppedId);
  assert.deepEqual(await plan().locator('li small').allTextContents(), ['待继续', '待办', '待办']);
  assert.equal(await plan().getAttribute('data-response-status'), 'stopped');
  const stoppedColors = await plan().locator('li > svg').evaluateAll(elements => elements.map(element => getComputedStyle(element).color)); assert.equal(stoppedColors[0], stoppedColors[1]);
  const stopped = await page.evaluate(async id => (await window.qiyao.load()).threads.find(thread => thread.id === id), stoppedId);
  assert.deepEqual(stopped.messages.at(-1).activities.map(activity => activity.status), ['complete', 'error']); assert.deepEqual(JSON.parse(stopped.messages.at(-1).activities[0].output), fixture.initial);
  await capture('task-plans-stopped.png');
  verified('an invalid multiple-active update preserves the last accepted native plan and stopping changes its active label to awaiting continuation');
  await openProject(); await page.locator('.thread-list > button').filter({ hasText: '任务步骤完成验证' }).click();
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'TASK_PLAN_UNSENT 中文😀');
  const before = await page.evaluate(() => window.qiyao.load()), requestCount = fixture.requests.length;
  page = await restart(); application = getApplication(); await openProject(); await page.locator('.thread-list > button').filter({ hasText: '任务步骤完成验证' }).click(); await plan().waitFor();
  const after = await page.evaluate(() => window.qiyao.load());
  for (const id of threadIds) assert.deepEqual(after.threads.find(thread => thread.id === id), JSON.parse(JSON.stringify(before.threads.find(thread => thread.id === id))));
  assert.equal(await page.getByLabel('消息', { exact: true }).inputValue(), 'TASK_PLAN_UNSENT 中文😀'); assert.equal(fixture.requests.length, requestCount); await capture('task-plans-restart.png');
  verified('actual normal restart retains exact task tool records and unsent text without replaying model tools');
  await page.locator('.thread-list > button').filter({ hasText: '任务步骤停止验证' }).click(); assert.deepEqual(await plan().locator('li small').allTextContents(), ['待继续', '待办', '待办']);
  assert.deepEqual(errors, []); assert.ok((await readFile(readme)).equals(originalReadme));
  await page.evaluate(preferences => window.qiyao.savePreferences(preferences), original.preferences); await application.evaluateMain(`${mainWindow}.setContentSize(${geometry.size.join(',')});${mainWindow}.webContents.setZoomFactor(${geometry.zoom})`);
  verified('reopened stopped responses retain pending task semantics and project bytes while restoring original preferences and window geometry');
  return { page, result: { checks: 8, actualReadOnlyTool: true, rawToolRecordsPreserved: true, projectFilesUnchanged: true, noPlanDocument: true, invalidUpdateRetainsPlan: true, stoppedStateAccurate: true, plainTextRendering: true, actualRestart: true, noModelReplay: true, requests: fixture.requests, layouts, screenshots: captures } };
}
