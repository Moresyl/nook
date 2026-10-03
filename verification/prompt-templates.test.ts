import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendPrompt, promptParameterSchema, promptParameters, promptTemplateLimits, promptTemplateSchema, promptTemplatesSchema, promptVariables, renderPrompt } from '../contracts/prompt-templates';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { PromptTemplates } from '../desktop/services/prompt-templates';
import { AssistantProfiles } from '../desktop/services/assistant-profiles';
import { WorkspaceVault } from '../desktop/services/vault';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const template = () => ({ id: randomUUID(), title: '写作任务', description: '复用工作方式', content: '按 {{风格}} 改写 {{文本}}，保持 {{风格}}。' });
async function setup() { const { vault, directory } = await testVault(); directories.push(directory); return { vault, directory, templates: new PromptTemplates(vault) }; }

describe('prompt templates and bounded literal expansion', () => {
  it('validates bounded parameter labels, choices and defaults against exact existing variable keys', () => {
    expect(promptParameters('{{后}} {{前}} {{后}}', [{ key: '前', label: '标题', description: '提示', required: false, defaultValue: '原文' }]))
      .toEqual([{ key: '后', required: true }, { key: '前', label: '标题', description: '提示', required: false, defaultValue: '原文' }]);
    expect(promptParameters('{{后}}', [{ key: '后', required: undefined }])).toEqual([{ key: '后', required: true }]);
    expect(() => promptParameters('{{后}}', Array.from({ length: 21 }, () => ({ key: '后' })))).toThrow();
    for (const parameters of [[{ key: 'missing' }], [{ key: '后' }, { key: '后' }]]) expect(() => promptParameters('{{后}}', parameters)).toThrow('only once');
    for (const change of [{ key: '' }, { key: 'x'.repeat(41) }, { label: 'x'.repeat(81) }, { description: 'x'.repeat(513) }, { defaultValue: 'x'.repeat(32001) }, { choices: [] }, { choices: ['a', 'a'] }, { choices: [' '] }, { choices: ['x'.repeat(513)] }, { choices: Array.from({ length: 51 }, (_, i) => String(i)) }, { choices: ['a'], defaultValue: 'b' }, { extra: true }]) {
      expect(promptParameterSchema.safeParse({ key: '后', ...change }).success).toBe(false);
    }
    expect(promptTemplateSchema.safeParse({ ...template(), assistantId: 'writer', parameters: [{ key: '文本', required: false }] }).success).toBe(true);
    for (const assistantId of ['', 'x'.repeat(129), 'bad\0id']) expect(promptTemplateSchema.safeParse({ ...template(), assistantId }).success).toBe(false);
    expect(promptTemplateSchema.safeParse({ ...template(), parameters: [{ key: 'missing' }] }).success).toBe(false);
  });
  it('applies explicit defaults and optional values while keeping choice values and supplied literal text exact', () => {
    const definitions = [{ key: '风格', choices: ['简洁', '展开'], defaultValue: '简洁' }, { key: '文本', required: false }];
    expect(renderPrompt('{{风格}} / {{文本}}', {}, definitions)).toBe('简洁 / ');
    expect(renderPrompt('{{风格}} / {{文本}}', { 风格: '展开', 文本: '<script>{{风格}} $&😀\n</script>' }, definitions)).toBe('展开 / <script>{{风格}} $&😀\n</script>');
    expect(() => renderPrompt('{{风格}}', { 风格: '' }, definitions.slice(0, 1))).toThrow('required');
    expect(() => renderPrompt('{{风格}}', { 风格: 'unknown' }, definitions.slice(0, 1))).toThrow('declared option');
    expect(renderPrompt('{{风格}}', { 风格: '' }, [{ key: '风格', required: false, choices: ['a'] }])).toBe('');
    expect(() => renderPrompt('{{风格}}', { extra: 'bad' }, definitions.slice(0, 1))).toThrow('unknown');
    expect(() => renderPrompt('{{文本}}', {}, [{ key: '文本', defaultValue: ' ' }])).toThrow('required');
  });
  it('saves an assistant-bound recipe and exact parameter metadata while rejecting a deleted assistant atomically', async () => {
    const { templates, vault, directory } = await setup();
    const item = { ...template(), assistantId: 'writer', parameters: [{ key: '风格', label: '写作风格', choices: ['简洁', '详细'], defaultValue: '简洁' }, { key: '文本', description: '原文😀', required: false }] };
    await templates.save(item); const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    await expect(templates.save({ ...item, assistantId: 'removed' })).rejects.toThrow('no longer exists');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().promptTemplates).toEqual([item]);
    expect(renderPrompt(item.content, {}, item.parameters)).toBe('按 简洁 改写 ，保持 简洁。');
  });
  it('clears only recipes belonging to a removed assistant and keeps exact parameter metadata after an atomic retry', async () => {
    const { templates, vault, directory } = await setup(); const profiles = new AssistantProfiles(vault);
    const bound = { ...template(), assistantId: 'writer', parameters: [{ key: '文本', defaultValue: 'EXACT_RECIPE😀' }] };
    const other = { ...template(), assistantId: 'general' }; await templates.save(bound); await templates.save(other);
    const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('RECIPE_EIO'));
    await expect(profiles.remove('writer')).rejects.toThrow('RECIPE_EIO');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    await profiles.remove('writer'); const { assistantId: _removed, ...unbound } = bound;
    expect(vault.snapshot().promptTemplates).toEqual([unbound, other]);
    expect(vault.snapshot().assistants.some((item) => item.id === 'writer')).toBe(false);
    await expect(templates.save(bound)).rejects.toThrow('no longer exists'); await templates.save(unbound);
  });
  it('restores assistant associations and parameter defaults through the complete workspace backup without altering rendered drafts', async () => {
    const { templates, vault, directory } = await setup();
    const item = { ...template(), assistantId: 'writer', parameters: [{ key: '风格', defaultValue: '简洁' }, { key: '文本', defaultValue: 'RESTORED_LITERAL😀' }] };
    await templates.save(item); const text = renderPrompt(item.content, {}, item.parameters);
    await vault.update((draft) => { draft.composerDrafts = [{ text, assistantId: 'writer', attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }]; });
    const extensions = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills'))); const backup = await extensions.backup();
    await new AssistantProfiles(vault).remove('writer'); await templates.remove(item.id);
    const restored = await extensions.restore(backup);
    expect(restored.promptTemplates).toEqual([item]); expect(restored.assistants.some((profile) => profile.id === 'writer')).toBe(true);
    expect(restored.composerDrafts[0]).toMatchObject({ text, assistantId: 'writer' });
  });
  it('accepts legacy workspaces and validates exact IDs, fields, names, content and distinct variables', () => {
    const legacy = { ...emptyWorkspace() } as Record<string, unknown>; delete legacy.promptTemplates;
    expect(workspaceSchema.parse(legacy).promptTemplates).toEqual([]); expect(promptTemplatesSchema.parse(undefined)).toEqual([]);
    expect(promptTemplateSchema.parse({ ...template(), title: '  A  ' }).title).toBe('A');
    for (const change of [{ id: 'old' }, { title: '  ' }, { title: 'x'.repeat(81) }, { description: 'x'.repeat(513) }, { content: ' ' }, { content: 'x'.repeat(32001) }, { content: Array.from({ length: 21 }, (_, i) => `{{v${i}}}`).join(' ') }, { command: 'execute' }]) expect(promptTemplateSchema.safeParse({ ...template(), ...change }).success).toBe(false);
    const one = template(); expect(promptTemplatesSchema.safeParse([one, one]).success).toBe(false); expect(promptTemplatesSchema.safeParse(Array.from({ length: 201 }, template)).success).toBe(false);
  });
  it('deduplicates Unicode and case-sensitive variables in order and preserves unsupported markers as literal text', () => {
    expect(promptVariables('😀 {{中文_1}} {{Name}} {{中文_1}} {{name}} {{with-dash}} \\{{escaped}}')).toEqual(['中文_1', 'Name', 'name', 'with-dash']);
    expect(promptVariables('{{}} {{a + b}} {{ has spaces }} {{1first}} {{' + 'a'.repeat(41) + '}}')).toEqual([]);
    expect(promptVariables('Plain text')).toEqual([]); expect(() => promptVariables(' ')).toThrow(); expect(() => promptVariables('x'.repeat(32001))).toThrow(); expect(() => promptVariables(Array.from({ length: 21 }, (_, i) => `{{v${i}}}`).join(''))).toThrow('20');
    expect(promptVariables(Array.from({ length: 20 }, (_, i) => `{{v${i}}}`).join(''))).toHaveLength(20);
  });
  it('renders exact multiline, dollar, HTML and marker text without recursive substitution or execution', () => {
    const value = '中文😀\n$& $1 ${process.env.SECRET} <img src="https://example.invalid"> {{other}}';
    expect(renderPrompt('Before {{value}} / {{value}} / \\{{value}} / {{a + b}}', { value })).toBe(`Before ${value} / ${value} / {{value}} / {{a + b}}`);
    expect(renderPrompt('Nothing to fill \\{{literal}}', {})).toBe('Nothing to fill {{literal}}');
    expect(renderPrompt('{{constructor}} {{__proto__}}', JSON.parse('{"constructor":"own","__proto__":"plain"}'))).toBe('own plain');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects missing, unknown, empty, oversized and non-string values even if the prototype supplies a variable', () => {
    for (const values of [null, [], 'value', {}, { task: ' ' }, { task: 'ok', extra: 'unexpected' }, { task: 1 }, { task: 'x'.repeat(32001) }, Object.create({ task: 'inherited' })]) expect(() => renderPrompt('{{task}}', values as Record<string, string>)).toThrow();
    expect(() => renderPrompt('Constant', { extra: 'x' })).toThrow('unknown'); expect(renderPrompt('{{task}}', { task: ' keep whitespace ' })).toBe(' keep whitespace ');
  });
  it('bounds expanded output before joining repeated variables and enforces the exact draft character boundary', () => {
    const value = 'x'.repeat(32000); expect(renderPrompt('{{v}}'.repeat(8), { v: value })).toHaveLength(256000);
    expect(() => renderPrompt('{{v}}'.repeat(9), { v: value })).toThrow('256 KB'); expect(() => renderPrompt('{{v}}'.repeat(8) + 'z', { v: value })).toThrow('256 KB');
    expect(appendPrompt('', 'x'.repeat(256000))).toHaveLength(256000); expect(appendPrompt('x'.repeat(255997), 'y')).toHaveLength(256000);
    expect(() => appendPrompt('x'.repeat(255998), 'y')).toThrow('256 KB'); expect(() => appendPrompt('x'.repeat(256001), 'y')).toThrow(); expect(() => appendPrompt('keep', ' ')).toThrow();
    expect(appendPrompt('  Keep this draft\n', 'Prompt 😀')).toBe('  Keep this draft\n\n\nPrompt 😀');
  });
  it('enforces the exact aggregate UTF-8 byte quota including multibyte content', () => {
    const items = Array.from({ length: 128 }, () => ({ ...template(), title: 'A', description: '', content: 'x'.repeat(30000) }));
    let remaining = promptTemplateLimits.bytes - Buffer.byteLength(JSON.stringify(items));
    for (const item of items) { const extra = Math.min(remaining, 32000 - item.content.length); item.content += 'x'.repeat(extra); remaining -= extra; }
    expect(remaining).toBe(0); expect(promptTemplatesSchema.parse(items)).toHaveLength(128);
    items.at(-1)!.content += 'é'; expect(promptTemplatesSchema.safeParse(items).success).toBe(false);
  });
  it('creates, updates and copies actual saved templates while preserving provider keys and conversation state across restart', async () => {
    const { templates, vault, directory } = await setup(); const item = template(); await vault.setKey('local', 'PRIVATE_TEMPLATE_TEST_KEY'); await vault.update((draft) => { draft.threads = [sampleThread()]; });
    await templates.save({ ...item, title: '  Saved  ' }); await templates.save({ ...item, title: 'Updated', content: 'Exact\n{{task}}' }); await templates.save({ ...item, id: randomUUID() });
    expect(vault.snapshot().promptTemplates).toHaveLength(2); expect(vault.snapshot().promptTemplates[0].content).toBe('Exact\n{{task}}'); expect(vault.snapshot().threads).toHaveLength(1); expect(vault.key('local')).toBe('PRIVATE_TEMPLATE_TEST_KEY');
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().promptTemplates).toEqual(vault.snapshot().promptTemplates);
    expect(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')).promptTemplates).toHaveLength(2); expect(() => templates.save({ ...item, title: '' })).toThrow();
  });
  it('serializes capacity checks and rejects aggregate overflow without partially modifying the workspace', async () => {
    const { templates, vault } = await setup(); await vault.update((draft) => { draft.promptTemplates = Array.from({ length: 199 }, template); });
    const results = await Promise.allSettled([templates.save(template()), templates.save(template())]); expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']); expect(vault.snapshot().promptTemplates).toHaveLength(200);
    await vault.update((draft) => { draft.promptTemplates = Array.from({ length: 42 }, () => ({ ...template(), content: '中'.repeat(31000) })); }); const before = vault.snapshot();
    await expect(templates.save({ ...template(), content: '中'.repeat(31000) })).rejects.toThrow('4 MB'); expect(vault.snapshot()).toEqual(before);
  });
  it('retains failed edits and deletions in memory and on disk and permits a later retry', async () => {
    const { templates, vault, directory } = await setup(); const item = template(); await templates.save(item); const before = vault.snapshot(); const bytes = await readFile(join(directory, 'workspace.json'));
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Synthetic EIO')); await expect(templates.save({ ...item, title: 'Failure' })).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    vi.mocked(vault.update).mockRejectedValueOnce(new Error('Synthetic EIO')); await expect(templates.remove(item.id)).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(before); await templates.save({ ...item, title: 'Retry' }); expect(vault.snapshot().promptTemplates[0].title).toBe('Retry');
  });
  it('removes only the selected template while retaining prior rendered messages and draft content', async () => {
    const { templates, vault } = await setup(); const first = template(); const second = template(); await templates.save(first); await templates.save(second); const text = renderPrompt(first.content, { 风格: '简洁', 文本: '保留这句话' });
    await vault.update((draft) => { draft.threads = [sampleThread({ messages: [{ id: 'message', role: 'user', content: text, createdAt: 1, status: 'complete', attachments: [] }] })]; draft.composerDrafts = [{ text, attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }]; });
    await templates.remove(first.id); expect(vault.snapshot().promptTemplates).toEqual([second]); expect(vault.snapshot().threads[0].messages[0].content).toBe(text); expect(vault.snapshot().composerDrafts[0].text).toBe(text); await expect(templates.remove(first.id)).rejects.toThrow('no longer exists'); expect(() => templates.remove(null)).toThrow();
  });
  it('roundtrips complete workspace backups with exact templates and restores legacy backups without template data', async () => {
    const { templates, vault, directory } = await setup(); const item = template(); await templates.save(item); const extensions = new ExtensionSettings(vault, new LocalSkills(join(directory, 'skills')));
    const backup = await extensions.backup(); await templates.remove(item.id); const restored = await extensions.restore(backup); expect(restored.promptTemplates).toEqual([item]); expect(backup.promptTemplates).toEqual([item]);
    const legacy = { ...backup } as Record<string, unknown>; delete legacy.promptTemplates; expect((await extensions.restore(legacy)).promptTemplates).toEqual([]);
    await writeFile(join(directory, 'workspace.json'), JSON.stringify(legacy)); const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().promptTemplates).toEqual([]);
  });
});
