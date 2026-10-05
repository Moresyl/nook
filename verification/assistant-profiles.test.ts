import { gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantProfileLimits, parseAssistantBundle } from '../contracts/assistant-profiles';
import { automationInputSchema } from '../contracts/automations';
import { AssistantProfiles } from '../desktop/services/assistant-profiles';
import { WorkspaceVault } from '../desktop/services/vault';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { codec, sampleThread, testVault } from './fixtures';

const profile = { name: '写作助手', description: '本地工作方式', instructions: '保留语气与事实。\n```text\n<unsafe>\n```\n😀' };
const bundle = (assistants = [profile]) => ({ format: 'qiyao-assistants' as const, version: 1 as const, assistants });
const owned: { directory: string; service: AssistantProfiles }[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const item of owned.splice(0)) { await item.service.shutdown(); await rm(item.directory, { recursive: true, force: true }); } });
async function setup() { const { vault, directory } = await testVault(); const service = new AssistantProfiles(vault); owned.push({ service, directory }); return { service, vault, directory }; }

describe('portable assistant profiles', () => {
  it('validates strict versioned profiles and rejects private fields, IDs, blank names and malformed sizes', () => {
    expect(parseAssistantBundle(bundle([{ ...profile, name: '  写作助手  ' }])).assistants[0]).toEqual(profile);
    for (const raw of [null, [], { ...bundle(), format: 'foreign' }, { ...bundle(), version: 2 }, bundle([]), bundle([{ ...profile, name: '  ' }]), bundle([{ ...profile, instructions: 'x'.repeat(32001) }]), bundle(Array.from({ length: 1001 }, () => profile)), { ...bundle(), credentials: {} }, { ...bundle(), assistants: [{ ...profile, id: 'general' }] }, { ...bundle(), assistants: [{ ...profile, providerId: 'local' }] }]) expect(() => parseAssistantBundle(raw)).toThrow('valid Nook');
  });
  it('enforces the exact UTF-8 bundle quota including multibyte instructions', () => {
    const raw = bundle(Array.from({ length: 128 }, () => ({ name: 'A', description: '', instructions: 'x'.repeat(30000) })));
    let remaining = assistantProfileLimits.bytes - Buffer.byteLength(JSON.stringify(raw));
    for (const item of raw.assistants) { const extra = Math.min(remaining, 32000 - item.instructions.length); item.instructions += 'x'.repeat(extra); remaining -= extra; }
    expect(remaining).toBe(0); expect(Buffer.byteLength(JSON.stringify(raw))).toBe(assistantProfileLimits.bytes);
    expect(parseAssistantBundle(raw).assistants).toHaveLength(128);
    raw.assistants.at(-1)!.instructions += 'é'; expect(() => parseAssistantBundle(raw)).toThrow('4 MB');
  });
  it('saves and replaces profiles, trims names and rejects invalid or overflowing local changes', async () => {
    const { service, vault } = await setup(); const original = vault.snapshot().assistants[0];
    await service.save({ ...original, name: ' Changed ', instructions: profile.instructions }); expect(vault.snapshot().assistants[0].name).toBe('Changed');
    await service.save({ ...profile, id: randomUUID() }); expect(vault.snapshot().assistants).toHaveLength(4);
    expect(() => service.save({ ...original, name: '  ' })).toThrow(); expect(() => service.save({ ...original, id: '\0' })).toThrow();
    await vault.update((draft) => { draft.assistants = Array.from({ length: 1000 }, (_, index) => ({ ...original, id: `assistant-${index}` })); });
    await expect(service.save({ ...profile, id: 'extra' })).rejects.toThrow(); expect(vault.snapshot().assistants).toHaveLength(1000);
  });
  it('exports selected or all profiles in deterministic order without workspace IDs, paths or credentials', async () => {
    const { service, vault } = await setup(); await vault.setKey('local', 'PRIVATE_TEST_KEY');
    const state = vault.snapshot(); const ids = [state.assistants[2].id, state.assistants[0].id];
    expect(service.bundle(ids).assistants.map((item) => item.name)).toEqual([state.assistants[2].name, state.assistants[0].name]); expect(service.bundle().assistants).toHaveLength(3);
    expect(JSON.stringify(service.bundle())).not.toContain('PRIVATE_TEST_KEY'); expect(Object.keys(service.bundle().assistants[0])).toEqual(['name', 'description', 'instructions']);
    expect(() => service.bundle(['missing'])).toThrow('no longer exists'); expect(() => service.bundle([])).toThrow(); expect(() => service.bundle([ids[0], ids[0]])).toThrow(); expect(() => service.bundle('all')).toThrow();
    await vault.update((draft) => { draft.assistants = []; }); expect(() => service.bundle()).toThrow('valid Nook');
  });
  it('imports atomically with fresh IDs, leaves existing profiles untouched and survives an actual vault restart', async () => {
    const { service, vault, directory } = await setup(); const before = vault.snapshot();
    await service.import(bundle([profile, profile])); const first = vault.snapshot().assistants;
    await service.import(bundle()); const all = vault.snapshot().assistants; expect(all.slice(0, 3)).toEqual(before.assistants); expect(new Set(all.map((item) => item.id)).size).toBe(6);
    expect(first[3].instructions).toBe(profile.instructions); expect(first[3].id).not.toBe(first[4].id);
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().assistants).toEqual(all);
    expect(() => service.import({ ...bundle(), version: 2 })).toThrow(); expect(vault.snapshot().threads).toEqual(before.threads);
  });
  it('serializes concurrent imports against the current capacity and leaves failed writes untouched', async () => {
    const { service, vault } = await setup(); await vault.update((draft) => { draft.assistants = Array.from({ length: 999 }, (_, index) => ({ ...profile, id: `assistant-${index}` })); });
    const results = await Promise.allSettled([service.import(bundle()), service.import(bundle())]); expect(results.map((item) => item.status)).toEqual(['fulfilled', 'rejected']); expect(vault.snapshot().assistants).toHaveLength(1000);
    await vault.update((draft) => { draft.assistants = draft.assistants.slice(0, 3); }); const before = vault.snapshot();
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('simulated EIO')); await expect(service.import(bundle([profile, profile]))).rejects.toThrow('EIO'); expect(vault.snapshot()).toEqual(before);
  });
  it('removes only the selected profile and clears retained conversation, composer and schedule references', async () => {
    const { service, vault } = await setup(); const id = vault.snapshot().assistants[0].id;
    await vault.update((draft) => {
      draft.threads = [sampleThread({ assistantId: id }), sampleThread({ id: 'other', assistantId: 'writer' })];
      draft.composerDrafts = [{ text: 'Keep draft', assistantId: id, attachments: [], model: '', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }];
      draft.automations = [{ ...automationInputSchema.parse({ id: randomUUID(), name: 'Keep schedule', prompt: 'Review', providerId: 'local', model: 'test-model', schedule: { kind: 'interval', minutes: 60 }, assistantId: id }), runs: [], createdAt: 1, updatedAt: 1 }];
    });
    const delayed = vault.snapshot().composerDrafts[0]; await service.remove(id); await new ComposerDrafts(vault).save(delayed); const state = vault.snapshot(); expect(state.threads[0].assistantId).toBeUndefined(); expect(state.threads[1].assistantId).toBe('writer'); expect(state.composerDrafts[0].text).toBe('Keep draft'); expect(state.composerDrafts[0].assistantId).toBeUndefined(); expect(state.automations[0].assistantId).toBeUndefined(); expect(state.assistants).toHaveLength(2);
    await expect(service.remove(id)).rejects.toThrow('no longer exists'); expect(() => service.remove(null)).toThrow();
  });
  it('reads and writes actual plain/gzip Unicode files, accepts a UTF-8 BOM and preserves existing destinations on failure', async () => {
    const { service, directory } = await setup(); const plain = join(directory, 'profiles.json'); const compressed = join(directory, 'profiles.json.gz');
    await service.write(plain, bundle()); await service.write(compressed, bundle()); expect(await service.read(plain)).toEqual(bundle()); expect(await service.read(compressed)).toEqual(bundle());
    await writeFile(plain, '\uFEFF' + JSON.stringify(bundle())); expect(await service.read(plain)).toEqual(bundle());
    const occupied = join(directory, 'occupied.json'); await mkdir(occupied); await writeFile(join(occupied, 'keep.txt'), 'keep'); await expect(service.write(occupied, bundle())).rejects.toThrow('could not be saved'); expect(await readFile(join(occupied, 'keep.txt'), 'utf8')).toBe('keep'); expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const before = await readFile(plain); await expect(service.write(plain, { ...bundle(), version: 2 } as never)).rejects.toThrow('valid Nook'); expect(await readFile(plain)).toEqual(before);
  });
  it('rejects missing, malformed, invalid UTF-8, truncated and oversized expanded or plain files without exposing paths', async () => {
    const { service, directory } = await setup(); const invalid = join(directory, 'private-path.json');
    await expect(service.read(invalid)).rejects.toThrow('could not be read');
    for (const content of [Buffer.from('{'), Buffer.from([0xc3, 0x28]), Buffer.from(JSON.stringify({ ...bundle(), privateKey: 'test' })), Buffer.alloc(4_000_001, 32), gzipSync(Buffer.alloc(4_000_001, 32)), gzipSync(JSON.stringify(bundle())).subarray(0, -3)]) { await writeFile(invalid, content); await expect(service.read(invalid)).rejects.toThrow('no larger than 4 MB'); }
    await expect(service.read(directory)).rejects.not.toThrow(directory);
    await service.shutdown(); await service.shutdown(); await expect(service.read(invalid)).rejects.toThrow('could not be read'); await expect(service.write(invalid, bundle())).rejects.toThrow('could not be saved');
  });
});
