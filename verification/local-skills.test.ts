import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalSkills, skillMetadata } from '../desktop/services/local-skills';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-skills-')); directories.push(root);
  const source = join(root, 'source'); await mkdir(join(source, 'references'), { recursive: true });
  await writeFile(join(source, 'SKILL.md'), '---\nname: 证据整理\ndescription: 按参考方法整理资料\n---\nRead references/method.md before answering.\n');
  await writeFile(join(source, 'references/method.md'), 'SKILL_REFERENCE_EVIDENCE');
  await writeFile(join(source, 'LICENSE'), 'Original license notice');
  await writeFile(join(source, 'image.bin'), Buffer.from([0, 255, 32]));
  return { root, source, skills: new LocalSkills(join(root, 'managed')) };
}
describe('local skills', () => {
  it('imports the whole directory, preserves licenses and binary assets, and removes only managed files', async () => {
    const { source, skills } = await fixture(); const skill = await skills.importPath(join(source, 'SKILL.md'));
    expect(skill).toMatchObject({ name: '证据整理', description: '按参考方法整理资料', enabled: true });
    const document = await skills.document(skill.id);
    expect(document.files).toEqual(['LICENSE', 'SKILL.md', 'image.bin', 'references/method.md']);
    expect(await readFile(join(document.directory, 'image.bin'))).toEqual(Buffer.from([0, 255, 32]));
    await writeFile(join(source, 'references/method.md'), 'Changed original');
    expect(await skills.read(skill.id, 'references/method.md')).toBe('SKILL_REFERENCE_EVIDENCE');
    await expect(skills.read(skill.id, 'image.bin')).rejects.toThrow('not UTF-8');
    await expect(skills.read(skill.id, '../source/SKILL.md')).rejects.toThrow('relative file');
    await expect(skills.read(skill.id, 'C:/outside')).rejects.toThrow('relative file');
    await skills.remove(skill.id); await expect(skills.document(skill.id)).rejects.toThrow();
    expect(await readFile(join(source, 'LICENSE'), 'utf8')).toBe('Original license notice');
  });
  it('loads selected skills progressively and reports bad arguments and unavailable files', async () => {
    const { source, skills } = await fixture(); const skill = await skills.importPath(source); const signal = new AbortController().signal;
    const load = { id: 'call', name: 'load_skill', arguments: JSON.stringify({ id: skill.id }) };
    expect(await skills.execute(load, [skill], signal)).toMatchObject({ error: false, output: expect.stringContaining('Read references/method.md') });
    const read = { ...load, name: 'read_skill_file', arguments: JSON.stringify({ id: skill.id, path: 'references/method.md' }) };
    expect(await skills.execute(read, [skill], signal)).toMatchObject({ error: false, output: 'SKILL_REFERENCE_EVIDENCE' });
    expect((await skills.execute(load, [], signal)).error).toBe(true);
    expect((await skills.execute(load, [{ ...skill, enabled: false }], signal)).error).toBe(true);
    expect((await skills.execute({ ...load, arguments: '{bad' }, [skill], signal)).error).toBe(true);
    expect((await skills.execute({ ...read, name: 'unknown' }, [skill], signal)).error).toBe(true);
    const controller = new AbortController(); controller.abort(); await expect(skills.execute(load, [skill], controller.signal)).rejects.toThrow();
  });
  it('rejects malformed metadata, empty instructions and oversized skill text', () => {
    expect(skillMetadata('# Instructions', 'Fallback')).toMatchObject({ name: 'Fallback', instructions: '# Instructions' });
    expect(skillMetadata('\uFEFF---\r\nname: Name\r\n---\r\nBody', 'Fallback').name).toBe('Name');
    expect(() => skillMetadata('---\nname: [bad\n---\nBody', 'F')).toThrow('YAML');
    expect(() => skillMetadata('---\nname: 3\n---\nBody', 'F')).toThrow('text name');
    expect(() => skillMetadata('---\nname: Name\n---\n', 'F')).toThrow('no instructions');
    expect(() => skillMetadata('x'.repeat(64_001), 'F')).toThrow('64 KB');
    expect(() => skillMetadata('x\0', 'F')).toThrow('UTF-8');
  });
  it('rejects private files, links, missing instructions, oversized assets and unsupported inputs', async () => {
    const { root, source, skills } = await fixture();
    await expect(skills.importPath(join(source, 'LICENSE'))).rejects.toThrow('SKILL.md');
    const empty = join(root, 'empty'); await mkdir(empty); await expect(skills.importPath(empty)).rejects.toThrow('does not contain');
    await writeFile(join(source, '.env'), 'secret'); await expect(skills.importPath(source)).rejects.toThrow('credentials'); await rm(join(source, '.env'));
    await writeFile(join(source, 'large'), Buffer.alloc(2_000_001)); await expect(skills.importPath(source)).rejects.toThrow('limit'); await rm(join(source, 'large'));
    await symlink(source, join(root, 'linked'), 'junction'); await expect(skills.importPath(join(root, 'linked'))).rejects.toThrow('symbolic link');
    await symlink(empty, join(source, 'escape'), 'junction'); await expect(skills.importPath(source)).rejects.toThrow('Unsupported link');
  });
  it('backs up every asset, restores into a fresh managed ID, and rejects corrupt or escaping bundles', async () => {
    const { root, source, skills } = await fixture(); const skill = await skills.importPath(source); const bundle = await skills.bundle(skill.id);
    const restored = await skills.restore(bundle); expect(restored.id).not.toBe(skill.id);
    expect(await skills.read(restored.id, 'LICENSE')).toBe('Original license notice');
    const document = await skills.document(restored.id); expect(await readFile(join(document.directory, 'image.bin'))).toEqual(Buffer.from([0, 255, 32]));
    for (const path of ['../outside', 'C:/outside', 'a/../b']) await expect(skills.restore({ ...bundle, files: [{ path, base64: 'YQ==' }] })).rejects.toThrow('invalid relative path');
    await expect(skills.restore({ ...bundle, files: [{ path: 'SKILL.md', base64: 'bad###' }] })).rejects.toThrow('invalid or oversized');
    await expect(skills.restore({ ...bundle, files: [...bundle.files, bundle.files[0]] })).rejects.toThrow('conflicting paths');
    expect((await readdir(join(root, 'managed'))).every((name) => !name.includes('.restore') && !name.includes('.tmp'))).toBe(true);
  });
});
