import assert from 'node:assert/strict';
import { dismissModalWithEscape } from './text-hint-verification.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyMemories({ page, application, directory, screenshots, projectDirectory, waitForBridge, verified }) {
  const projectId = 'memory-verification-project';
  await page.evaluate(async ({ projectId, projectDirectory }) => {
    await window.qiyao.saveProject({ id: projectId, name: '记忆验证项目', path: projectDirectory, instructions: '', createdAt: 1 });
  }, { projectId, projectDirectory });
  await page.reload();
  await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '记忆', exact: true }).click();
  await dialog.getByRole('button', { name: '添加记忆', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: '保存记忆', exact: true }).isDisabled(), true);
  const content = '记忆验证：保留中文与 emoji 😀 <img src=x onerror=alert(1)>';
  await dialog.getByLabel('记忆内容', { exact: true }).fill(content);
  await dialog.getByLabel('适用范围', { exact: true }).selectOption(projectId);
  await dialog.getByRole('button', { name: '保存记忆', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.load()).memories.some((item) => item.projectId === 'memory-verification-project'));
  const item = (await page.evaluate(() => window.qiyao.load())).memories.find((entry) => entry.projectId === projectId);
  assert.ok(item); assert.equal(item.content, content); assert.equal(await dialog.locator('img').count(), 0);
  const persisted = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')); assert.deepEqual(persisted.memories.find((entry) => entry.id === item.id), item);
  await dialog.getByRole('button', { name: new RegExp('^记忆验证：') }).click();
  await dialog.getByLabel('适用范围', { exact: true }).selectOption('');
  await dialog.locator('.toggle-label').filter({ hasText: '在后续聊天中使用' }).click();
  assert.equal(await dialog.getByRole('switch', { name: '在后续聊天中使用', exact: true }).isChecked(), false);
  await dialog.getByRole('button', { name: '保存记忆', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.load()).memories.some((entry) => entry.content.startsWith('记忆验证：') && !entry.enabled && !entry.projectId));
  verified('memory settings persist explicit Unicode entries, escape markup, edit scope and disable future use');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (theme) => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme }); }, theme);
    await page.reload(); await application.resize(theme === 'light' ? 1280 : 760, theme === 'light' ? 840 : 540);
    await page.locator('.sidebar-footer').getByRole('button', { name: /^设置/ }).click(); await dialog.getByRole('button', { name: '记忆', exact: true }).click();
    await dialog.getByLabel('搜索记忆', { exact: true }).fill('不存在的记忆'); await dialog.getByText('没有匹配的记忆', { exact: true }).waitFor();
    await dialog.getByLabel('搜索记忆', { exact: true }).fill('记忆验证');
    await dialog.getByRole('button', { name: new RegExp('^记忆验证：') }).waitFor();
    assert.equal(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: join(screenshots, `memory-settings-${theme}.png`) });
  }
  verified('memory search and disabled scope survive reload in light and narrow dark settings');
  await dialog.getByRole('button', { name: `删除记忆 ${content}`, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除记忆？', exact: true }); await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  assert.ok((await page.evaluate(() => window.qiyao.load())).memories.some((entry) => entry.id === item.id));
  await dialog.getByRole('button', { name: `删除记忆 ${content}`, exact: true }).click(); await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
  await waitForBridge(page, async () => !(await window.qiyao.load()).memories.some((entry) => entry.content.startsWith('记忆验证：')));
  await confirmation.waitFor({ state: 'hidden' });
  await page.evaluate(async (projectId) => {
    await window.qiyao.saveMemory({ id: crypto.randomUUID(), content: 'PROJECT_REMOVAL_MEMORY', projectId, enabled: true });
    await window.qiyao.removeProject(projectId);
  }, projectId);
  assert.equal((await page.evaluate(() => window.qiyao.load())).memories.some((entry) => entry.projectId === projectId), false);
  await dismissModalWithEscape(page, dialog);
  await page.evaluate(async () => { const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); });
  await page.reload(); await application.resize(1280, 840);
  verified('memory deletion supports cancel and confirm, and removing a project removes its scoped memories');
  return { checks: 3, screenshots: ['memory-settings-light.png', 'memory-settings-dark.png'], scope: 'Explicit CRUD, scope promotion, disabled state, persistence, search, escaped text, theme/narrow layout and project removal. Engine scope and temporary-chat isolation have separate component tests.' };
}
