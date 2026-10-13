import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dismissModalWithEscape } from './text-hint-verification.mjs';

export async function verifyProjectBranchActions({ page, projectId, root, branches, dialog, status, runGit, capture, dirtyDraft, verified }) {
  const current = (await status()).branch, renamed = 'renamed/界面🧭';
  const head = (await runGit(root, ['rev-parse', 'HEAD'])).trim(), index = await readFile(join(root, '.git/index'));
  await runGit(root, ['config', `branch.${current}.remote`, '.']); await runGit(root, ['config', `branch.${current}.merge`, 'refs/heads/main']);
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(current);
  assert.equal(await dialog().getByRole('button', { name: `删除分支 ${current}`, exact: true }).isDisabled(), true);
  await dialog().getByRole('button', { name: `重命名分支 ${current}`, exact: true }).click();
  const field = () => dialog().getByLabel('分支新名称', { exact: true });
  assert.equal(await field().evaluate(element => element === document.activeElement), true);
  await field().fill('bad..name'); await dialog().getByRole('button', { name: '保存名称', exact: true }).click();
  await dialog().getByRole('alert').getByText('分支名称无效，请修改后重试。', { exact: true }).waitFor(); assert.equal(await field().inputValue(), 'bad..name'); await capture('rename-invalid');
  await field().fill('main'); assert.equal(await dialog().getByRole('button', { name: '保存名称', exact: true }).isDisabled(), true);
  await field().fill(renamed); await field().press('Enter'); await dialog().waitFor({ state: 'hidden' });
  assert.equal((await status()).branch, renamed); assert.equal((await runGit(root, ['rev-parse', 'HEAD'])).trim(), head); assert.deepEqual(await readFile(join(root, '.git/index')), index);
  assert.equal((await runGit(root, ['config', `branch.${renamed}.merge`])).trim(), 'refs/heads/main');
  assert.deepEqual((await page.evaluate(() => window.qiyao.load())).editorDrafts.find(item => item.projectId === projectId && item.path === 'dirty.ts'), dirtyDraft);
  assert.equal(await readFile(join(root, 'keep-untracked.txt'), 'utf8'), 'KEEP_UNTRACKED_中文🧭');
  verified('current Unicode branch rename rejects invalid/duplicate refs, accepts Enter and preserves real HEAD, index, upstream configuration, editor draft/baseline and unrelated file');

  const unused = 'list/0001', unusedRenamed = 'renamed/可删除🧭';
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(unused); await dialog().getByRole('button', { name: `重命名分支 ${unused}`, exact: true }).click(); await field().fill(unusedRenamed); await field().press('Enter'); await dialog().waitFor({ state: 'hidden' }); assert.equal((await status()).branch, renamed);
  const unusedHead = (await runGit(root, ['rev-parse', `refs/heads/${unusedRenamed}`])).trim(); await runGit(root, ['update-ref', `refs/remotes/origin/${unusedRenamed}`, unusedHead]);
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(unusedRenamed); await dialog().getByRole('button', { name: `删除分支 ${unusedRenamed}`, exact: true }).click(); await capture('delete-confirm'); await dialog().getByRole('button', { name: '取消', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); assert.equal((await runGit(root, ['rev-parse', `refs/heads/${unusedRenamed}`])).trim(), unusedHead);
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(unusedRenamed); await dialog().getByRole('button', { name: `删除分支 ${unusedRenamed}`, exact: true }).click(); await dialog().getByRole('button', { name: '删除分支', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  assert.equal((await status()).branch, renamed); assert.equal((await runGit(root, ['rev-parse', 'HEAD'])).trim(), head); assert.deepEqual(await readFile(join(root, '.git/index')), index); await assert.rejects(runGit(root, ['show-ref', '--verify', `refs/heads/${unusedRenamed}`])); assert.equal((await runGit(root, ['rev-parse', `refs/remotes/origin/${unusedRenamed}`])).trim(), unusedHead);
  verified('unused branch rename leaves the active branch intact; cancel retains its ref and confirmed merged-only deletion preserves HEAD, index and the corresponding remote-tracking ref');

  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill('main'); await dialog().getByRole('button', { name: 'main', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
  await runGit(root, ['update-ref', `refs/remotes/origin/${renamed}`, head]); await runGit(root, ['config', `branch.${renamed}.remote`, 'origin']); await runGit(root, ['config', `branch.${renamed}.merge`, `refs/heads/${renamed}`]);
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(renamed); await dialog().getByRole('button', { name: `删除分支 ${renamed}`, exact: true }).click(); await dialog().getByRole('button', { name: '删除分支', exact: true }).click();
  await dialog().getByRole('alert').getByText('分支尚未完全合入当前版本，或无法核实提交，已保留。请先检查并合并需要的内容。', { exact: true }).waitFor(); await capture('delete-unmerged'); assert.equal((await status()).branch, 'main'); assert.equal((await runGit(root, ['rev-parse', `refs/heads/${renamed}`])).trim(), head);
  await dialog().getByRole('button', { name: '选择分支', exact: true }).click(); await dialog().getByLabel('查找分支', { exact: true }).fill('occupied');
  for (const action of ['重命名', '删除']) assert.equal(await dialog().getByRole('button', { name: `${action}分支 occupied`, exact: true }).isDisabled(), true);
  await assert.rejects(page.evaluate(id => window.qiyao.gitRenameBranch(id, 'occupied', 'no-overwrite'), projectId), /another worktree/); await assert.rejects(page.evaluate(id => window.qiyao.gitDeleteBranch(id, 'occupied'), projectId), /another worktree/); await assert.rejects(page.evaluate(id => window.qiyao.gitDeleteBranch(id, 'main'), projectId), /current branch/);
  await assert.rejects(page.evaluate(() => window.qiyao.gitRenameBranch('missing-project', 'main', 'new'))); await assert.rejects(page.evaluate(() => window.qiyao.gitDeleteBranch('missing-project', 'main'))); await dismissModalWithEscape(page, dialog());
  assert.deepEqual((await page.evaluate(() => window.qiyao.load())).editorDrafts.find(item => item.projectId === projectId && item.path === 'dirty.ts'), dirtyDraft);
  verified('unmerged deletion is rejected even with a containing upstream, current/occupied branches are protected in renderer and native bridge, and missing project requests cannot mutate refs or drafts');
  return { checks: 3, renameStateVerified: true, deleteCancelMergedOnlyVerified: true, unmergedWorktreeProjectGuardsVerified: true };
}

export async function verifyProjectBranchActionLayouts({ page, branches, dialog, longBranch, capture, theme, zoom, layouts }) {
  await branches(); await dialog().getByLabel('查找分支', { exact: true }).fill(longBranch);
  for (const mode of ['list', 'rename', 'delete']) {
    if (mode === 'rename') { await dialog().getByRole('button', { name: `重命名分支 ${longBranch}`, exact: true }).click(); await dialog().getByLabel('分支新名称', { exact: true }).fill(`renamed/${'输入新分支名称'.repeat(6)}`); }
    if (mode === 'delete') { await dialog().getByRole('button', { name: '选择分支', exact: true }).click(); await dialog().getByLabel('查找分支', { exact: true }).fill('list/0214'); await dialog().getByRole('button', { name: '删除分支 list/0214', exact: true }).click(); }
    const geometry = await dialog().evaluate(element => {
      const rect = element.getBoundingClientRect(), controls = [...element.querySelectorAll('input,button')].map(control => { const bounds = control.getBoundingClientRect(); return { name: control.getAttribute('aria-label') || control.textContent, width: bounds.width, height: control.offsetHeight, renderedHeight: bounds.height, contentFits: control.tagName === 'INPUT' || control.scrollWidth <= control.clientWidth, visible: bounds.left >= rect.left && bounds.top >= rect.top && bounds.right <= Math.min(rect.right, innerWidth) && bounds.bottom <= Math.min(rect.bottom, innerHeight) }; });
      return { dialog: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight }, controls, overflow: document.documentElement.scrollWidth > innerWidth, namesVisible: [...element.querySelectorAll('.branch-name')].every(name => name.getBoundingClientRect().width > 0) };
    });
    assert.equal(geometry.overflow, false); assert.equal(geometry.namesVisible, true); assert.ok(geometry.controls.every(control => control.visible && control.contentFits && control.width > 0 && control.height >= 20), JSON.stringify({ theme, zoom, mode, geometry }));
    if (mode === 'rename') assert.equal(await dialog().getByLabel('分支新名称', { exact: true }).evaluate(element => element === document.activeElement), true);
    layouts.push({ theme, zoom, mode, ...geometry }); await capture(`${mode}-${theme}-${zoom * 100}`);
  }
  await dismissModalWithEscape(page, dialog()); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '管理项目分支');
}
