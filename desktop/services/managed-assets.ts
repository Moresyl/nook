import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { skillBundleSchema, type SkillBundle } from '../../contracts/extensions';
import { packagePathSchema } from '../../contracts/plugins';

const ignored = new Set(['.git', 'node_modules', '__pycache__']);
const privateFile = /^(?:\.env(?:\..*)?|credentials(?:\..*)?|.*\.(?:pem|pfx|key))$/i;
const maxTotal = 20_000_000;
const maxFile = 2_000_000;

// The same bounded asset store preserves licenses and binary files for skills and plugins.
export class ManagedAssets {
  constructor(private readonly directory: string, private readonly entry: string, private readonly label: string) {}

  async root(id: string): Promise<string> {
    z.uuid().parse(id); const managed = await realpath(this.directory); const root = join(managed, id);
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error(`The managed ${this.label} directory changed. Import it again.`);
    return root;
  }

  private async scoped(root: string, name: string): Promise<string> {
    try { packagePathSchema.parse(name); } catch { throw new Error(`Choose a relative file inside the ${this.label}.`); }
    const path = resolve(root, name); const actual = await realpath(path);
    if (actual !== path || !actual.startsWith(`${root}${sep}`) || !(await lstat(path)).isFile()) throw new Error(`The ${this.label} file is outside its managed folder.`);
    return path;
  }

  async files(root: string): Promise<string[]> {
    const files: string[] = []; let total = 0;
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.isDirectory() && ignored.has(entry.name.toLowerCase())) continue;
        const path = join(folder, entry.name); const info = await lstat(path); const name = relative(root, path).split(sep).join('/');
        if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`Unsupported link or special file in ${this.label}: ${name}`);
        if (info.isDirectory()) { await walk(path); continue; }
        if (privateFile.test(entry.name) && !/^\.env\.(?:example|sample|template)$/i.test(entry.name)) throw new Error(`Remove private credentials before importing the ${this.label}: ${name}`);
        total += info.size; files.push(name);
        if (files.length > 1000 || total > maxTotal || info.size > maxFile) throw new Error(`The ${this.label} exceeds its 1000-file, 20 MB total or 2 MB per-file limit.`);
      }
    };
    await walk(root); return files.sort();
  }

  async textAt(root: string, name: string, limit = 64_000): Promise<string> {
    const path = await this.scoped(root, name);
    if ((await lstat(path)).size > limit) throw new Error(`The ${this.label} text exceeds its ${limit / 1000} KB limit.`);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)); } catch { throw new Error(`This ${this.label} asset is not UTF-8 text.`); }
    if (text.includes('\0')) throw new Error(`This ${this.label} asset is binary.`);
    return text;
  }

  async importPath<T>(source: string, validate: (text: string, fallback: string) => T, entryLimit = 64_000): Promise<{ id: string; metadata: T }> {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error(`Choose a ${this.label} folder or ${this.entry}, not a symbolic link.`);
    if (!info.isDirectory() && basename(source) !== this.entry) throw new Error(`Choose ${this.entry} or the folder containing it.`);
    const root = await realpath(info.isDirectory() ? source : dirname(source)); const files = await this.files(root);
    if (!files.includes(this.entry)) throw new Error(`The selected folder does not contain ${this.entry}.`);
    validate(await this.textAt(root, this.entry, entryLimit), basename(root));
    await mkdir(this.directory, { recursive: true }); const id = randomUUID(); const staging = join(this.directory, `${id}.tmp`);
    try {
      await mkdir(staging);
      for (const name of files) { const target = join(staging, name); await mkdir(dirname(target), { recursive: true }); await copyFile(await this.scoped(root, name), target); }
      await this.files(staging); const metadata = validate(await this.textAt(staging, this.entry, entryLimit), basename(root));
      await rename(staging, join(this.directory, id)); return { id, metadata };
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  }

  async read(id: string, name: string, limit = 64_000): Promise<string> { return this.textAt(await this.root(id), name, limit); }
  async bytes(id: string, name: string): Promise<Buffer> {
    const path = await this.scoped(await this.root(id), name); if ((await lstat(path)).size > maxFile) throw new Error('This package asset is too large.');
    const bytes = await readFile(path); if (bytes.length > maxFile) throw new Error('This package asset is too large.'); return bytes;
  }
  async hashes(id: string): Promise<Record<string, string>> {
    const root = await this.root(id); const files = await this.files(root);
    return Object.fromEntries(await Promise.all(files.map(async (name) => [name, createHash('sha256').update(await this.bytes(id, name)).digest('hex')])));
  }
  async remove(id: string): Promise<void> { await rm(await this.root(id), { recursive: true }); }
  async bundle(id: string): Promise<SkillBundle> { return { id, files: await Promise.all((await this.files(await this.root(id))).map(async (path) => ({ path, base64: (await this.bytes(id, path)).toString('base64') }))) }; }

  async restore<T>(raw: SkillBundle, validate: (text: string, fallback: string) => T, entryLimit = 64_000): Promise<{ id: string; metadata: T }> {
    const bundle = skillBundleSchema.parse(raw); await mkdir(this.directory, { recursive: true }); const staging = join(this.directory, `${randomUUID()}.restore`); await mkdir(staging);
    try {
      let total = 0; const paths = new Set<string>();
      for (const file of bundle.files) {
        try { packagePathSchema.parse(file.path); } catch { throw new Error(`The ${this.label} backup contains an invalid relative path.`); }
        const target = resolve(staging, file.path); const key = process.platform === 'win32' ? target.toLowerCase() : target;
        if (!target.startsWith(`${staging}${sep}`) || paths.has(key)) throw new Error(`The ${this.label} backup contains conflicting paths.`);
        paths.add(key); const bytes = Buffer.from(file.base64, 'base64'); total += bytes.length;
        if (bytes.toString('base64') !== file.base64 || total > maxTotal || bytes.length > maxFile) throw new Error(`The ${this.label} backup has invalid or oversized file data.`);
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
      }
      return await this.importPath(staging, validate, entryLimit);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}
