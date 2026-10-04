import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePromptBundle, type PromptBundle } from '../contracts/prompt-bundles';
import { renderPrompt } from '../contracts/prompt-templates';
import { AssistantProfiles } from '../desktop/services/assistant-profiles';
import { PromptTemplates } from '../desktop/services/prompt-templates';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = []; const services: PromptTemplates[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.shutdown())); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const portable = () => ({ title: '任务 中文 <img>', description: 'Literal metadata', content: '{{__proto__}} / {{风格}} / {{可选}}', parameters: [
  { key: '__proto__', defaultValue: '{{风格}} $&', label: '原文', description: '<script>literal</script>' },
  { key: '风格', required: true, defaultValue: '保持<>', choices: ['保持<>', '简短'] }, { key: '可选', required: false },
] });
const bundle = (): PromptBundle => ({ format: 'qiyao-prompt-templates', version: 1, templates: [{ ...portable(), assistantIndex: 0 }, { ...portable(), title: '同一个助手', assistantIndex: 0 }, { title: '独立模板', description: '', content: 'Unbound literal' }], assistants: [{ name: '现有同名助手', description: '完整简介', instructions: 'Literal <img> {{风格}} instructions' }] });
async function setup() { const { vault, directory } = await testVault(); directories.push(directory); const service = new PromptTemplates(vault); services.push(service); return { vault, directory, service }; }

describe('portable prompt template contracts', () => {
  it('retains complete parameter definitions and explicit zero-based assistant references without execution or local identities', () => {
    const raw = bundle(); const parsed = parsePromptBundle(raw); expect(parsed).toEqual(raw); expect(parsed).not.toBe(raw);
    expect(renderPrompt(parsed.templates[0].content, {}, parsed.templates[0].parameters)).toBe('{{风格}} $& / 保持<> / ');
    expect(parsePromptBundle({ ...raw, templates: [raw.templates[2]], assistants: [] }).assistants).toEqual([]);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it('rejects malformed definitions, versions, private fields, unknown parameters and incomplete assistant mappings', () => {
    const raw = bundle();
    for (const value of [null, [], { ...raw, version: 2 }, { ...raw, privateKey: 'PRIVATE' }, { ...raw, templates: [] }, { ...raw, templates: [{ ...raw.templates[0], id: randomUUID() }] }, { ...raw, templates: [{ ...raw.templates[0], assistantIndex: -1 }] }, { ...raw, templates: [{ ...raw.templates[0], assistantIndex: 0.5 }] }, { ...raw, templates: [{ ...raw.templates[0], assistantIndex: 1 }] }, { ...raw, assistants: [] }, { ...raw, assistants: [...raw.assistants, raw.assistants[0]] }, { ...raw, assistants: [{ ...raw.assistants[0], apiKey: 'PRIVATE' }] }, { ...raw, templates: [{ ...raw.templates[0], parameters: [{ key: 'unknown' }] }] }, { ...raw, templates: [{ ...raw.templates[0], parameters: [{ key: '风格', choices: ['A', 'A'] }] }] }, { ...raw, templates: [{ ...raw.templates[0], parameters: [{ key: '风格', choices: ['A'], defaultValue: 'B' }] }] }]) expect(() => parsePromptBundle(value)).toThrow();
    expect(() => parsePromptBundle(JSON.parse('{"format":"qiyao-prompt-templates","version":1,"templates":[],"assistants":[],"__proto__":{"polluted":true}}'))).toThrow();
  });
  it('enforces template count, aggregate UTF-8 bytes and linked-profile field bounds', () => {
    const template = { title: '模板', description: '', content: 'A' };
    expect(parsePromptBundle({ format: 'qiyao-prompt-templates', version: 1, templates: Array.from({ length: 200 }, () => template), assistants: [] }).templates).toHaveLength(200);
    expect(() => parsePromptBundle({ format: 'qiyao-prompt-templates', version: 1, templates: Array.from({ length: 201 }, () => template), assistants: [] })).toThrow();
    expect(() => parsePromptBundle({ format: 'qiyao-prompt-templates', version: 1, templates: Array.from({ length: 200 }, () => ({ ...template, content: '文'.repeat(8000) })), assistants: [] })).toThrow('4 MB');
    expect(() => parsePromptBundle({ ...bundle(), assistants: [{ ...bundle().assistants[0], instructions: 'A'.repeat(32001) }] })).toThrow();
  });
});
describe('prompt template transfer files and atomic library import', () => {
  it('exports selected or complete templates with shared assistant profiles once and omits every original ID and unrelated workspace field', async () => {
    const { service, vault } = await setup(); const assistantId = vault.snapshot().assistants[0].id;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) await service.save({ ...portable(), id, title: `模板 ${index}`, ...(index < 2 ? { assistantId } : {}) });
    const all = service.bundle(); expect(all.templates).toHaveLength(3); expect(all.assistants).toHaveLength(1); expect(all.templates.map((item) => item.assistantIndex)).toEqual([0, 0, undefined]);
    expect(service.bundle([ids[2], ids[0]]).templates.map((item) => item.title)).toEqual(['模板 2', '模板 0']); expect(service.bundle([ids[2]]).assistants).toEqual([]);
    for (const template of all.templates) { expect(template).not.toHaveProperty('id'); expect(template).not.toHaveProperty('assistantId'); }
    for (const profile of all.assistants) expect(profile).not.toHaveProperty('id');
    for (const selected of [[], [ids[0], ids[0]], ['not-an-id'], [randomUUID()]]) expect(() => service.bundle(selected)).toThrow();
    await vault.update((state) => { state.assistants = []; }); expect(() => service.bundle([ids[0]])).toThrow('linked assistant');
    await vault.update((state) => { state.promptTemplates = []; }); expect(() => service.bundle()).toThrow();
  });
  it('imports fresh template and assistant identities atomically, preserves same names and all original conversation/draft context, and survives actual restart', async () => {
    const { service, vault, directory } = await setup(); await new AssistantProfiles(vault).save({ id: 'existing', ...bundle().assistants[0] });
    const original = { id: randomUUID(), title: bundle().templates[0].title, description: '', content: 'Keep original' }; await service.save(original);
    await vault.update((state) => { state.threads.push(sampleThread()); state.activeThreadId = 'thread'; state.composerDrafts.push({ text: 'KEEP_DRAFT', assistantId: 'existing', attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }); });
    const before = vault.snapshot(); const incoming = bundle(); const untouched = structuredClone(incoming); const imported = await service.import(incoming);
    expect(imported.promptTemplates[0]).toEqual(original); expect(imported.promptTemplates.slice(1)).toHaveLength(3); expect(new Set(imported.promptTemplates.map((item) => item.id)).size).toBe(4);
    const linked = imported.assistants.at(-1)!; expect(linked.id).not.toBe('existing'); expect(linked).toMatchObject(incoming.assistants[0]); expect(imported.assistants.filter((item) => item.name === linked.name)).toHaveLength(2);
    expect(imported.promptTemplates.slice(1).map((item) => item.assistantId)).toEqual([linked.id, linked.id, undefined]); expect(imported.threads).toEqual(before.threads); expect(imported.composerDrafts).toEqual(before.composerDrafts); expect(imported.activeThreadId).toBe('thread'); expect(incoming).toEqual(untouched);
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().promptTemplates).toEqual(imported.promptTemplates); expect(reopened.snapshot().assistants).toEqual(imported.assistants);
    expect(renderPrompt(imported.promptTemplates[1].content, {}, imported.promptTemplates[1].parameters)).toBe('{{风格}} $& / 保持<> / ');
  });
  it('rejects both library capacity limits and invalid imports without any partial state or file replacement', async () => {
    const { service, vault, directory } = await setup();
    await vault.update((state) => { state.promptTemplates = Array.from({ length: 199 }, () => ({ id: randomUUID(), title: 'Keep', description: '', content: 'Keep' })); });
    let before = vault.snapshot(); let bytes = await readFile(join(directory, 'workspace.json')); await expect(service.import(bundle())).rejects.toThrow('too many prompt templates'); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
    await vault.update((state) => { state.promptTemplates = []; state.assistants = Array.from({ length: 1000 }, () => ({ id: randomUUID(), name: 'Keep', description: '', instructions: '' })); });
    before = vault.snapshot(); bytes = await readFile(join(directory, 'workspace.json')); await expect(service.import(bundle())).rejects.toThrow('too many assistants'); expect(() => service.import({ ...bundle(), privateKey: 'PRIVATE' })).toThrow(); expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(bytes);
  });
  it('preserves exact prior bytes after an actual destination failure and retries with every association intact', async () => {
    const { service, vault, directory } = await setup(); const path = join(directory, 'workspace.json'); const saved = join(directory, 'workspace-retained.json'); const before = vault.snapshot(); const bytes = await readFile(path);
    await rename(path, saved); await mkdir(path);
    try { await expect(service.import(bundle())).rejects.toThrow(); expect(vault.snapshot()).toEqual(before); expect(await readFile(saved)).toEqual(bytes); }
    finally { await rm(path, { recursive: true, force: true }); await rename(saved, path); }
    const imported = await service.import(bundle()); expect(imported.promptTemplates).toHaveLength(3); expect(imported.promptTemplates[0].assistantId).toBe(imported.assistants.at(-1)?.id);
  });
  it('roundtrips complete Unicode JSON and gzip files, detects compressed content by bytes and redacts corrupt, oversized and closed-file errors', async () => {
    const { service, directory } = await setup(); const raw = bundle(); const json = join(directory, '中文 模板.json'); const gzip = join(directory, '压缩模板.json.gz');
    await service.write(json, raw); await service.write(gzip, raw); expect(JSON.parse(await readFile(json, 'utf8'))).toEqual(raw); expect(JSON.parse(gunzipSync(await readFile(gzip)).toString('utf8'))).toEqual(raw); expect(await service.read(json)).toEqual(raw); expect(await service.read(gzip)).toEqual(raw);
    const invalid = join(directory, 'invalid.json'); await writeFile(invalid, await readFile(gzip)); expect(await service.read(invalid)).toEqual(raw);
    for (const data of [Buffer.from('{'), Buffer.from([0xc3, 0x28]), Buffer.alloc(4_000_001, 32), gzipSync(Buffer.alloc(4_000_001, 32)), gzipSync(JSON.stringify(raw)).subarray(0, -3), Buffer.from(JSON.stringify({ ...raw, token: 'PRIVATE' }))]) { await writeFile(invalid, data); await expect(service.read(invalid)).rejects.toThrow('no larger than 4 MB'); }
    await expect(service.read(directory)).rejects.not.toThrow(directory); await expect(service.write(directory, raw)).rejects.toThrow('could not be saved'); expect(await service.read(json)).toEqual(raw);
    await service.shutdown(); await service.shutdown(); await expect(service.read(json)).rejects.toThrow('could not be read'); await expect(service.write(json, raw)).rejects.toThrow('could not be saved');
  });
});
