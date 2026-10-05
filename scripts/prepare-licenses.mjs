import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { collectLicenseInventory } from './license-inventory.mjs';
import { collectDistributionInventory } from './distribution-inventory.mjs';

const root = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const check = process.argv.includes('--check');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
async function assetPath(directory, name) {
  const path = await realpath(resolve(directory, name)); const scope = relative(directory, path);
  if (!scope || scope === '..' || scope.startsWith(`..${sep}`) || isAbsolute(scope)) throw new Error('A bundled license asset is outside its declared directory');
  return path;
}
try {
  if (!process.env.npm_execpath) throw new Error('Run the license inventory through pnpm notices or pnpm notices:check');
  const { stdout } = await promisify(execFile)(process.execPath, [process.env.npm_execpath, 'licenses', 'list', '--prod', '--json'], { cwd: root, windowsHide: true, maxBuffer: 32_000_000 });
  const supplements = await readFile(join(root, 'licenses', 'supplements.json'), 'utf8').then(JSON.parse).catch((error) => { if (error.code === 'ENOENT') return []; throw error; });
  const lock = parse(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'));
  for (const supplement of supplements) { if (lock.packages[`${supplement.name}@${supplement.version}`]?.resolution.integrity !== supplement.packageIntegrity) throw new Error(`A supplemental license does not match the pinned package: ${supplement.name}`); }
  const result = await collectLicenseInventory(JSON.parse(stdout), root, supplements);
  const distribution = await collectDistributionInventory(JSON.parse(await readFile(join(root, 'licenses', 'distribution.json'), 'utf8')), join(root, 'licenses'));
  const assets = JSON.parse(await readFile(join(root, 'licenses', 'assets.json'), 'utf8'));
  const assetNotices = [];
  for (const asset of assets) {
    for (const file of asset.files) {
      const path = await assetPath(root, file.path);
      if (sha256(await readFile(path)) !== file.sha256) throw new Error(`Bundled asset does not match its license inventory: ${asset.name}`);
    }
    const license = await readFile(await assetPath(join(root, 'licenses'), asset.document));
    if (sha256(license) !== asset.documentSha256) throw new Error(`Bundled asset license document changed: ${asset.name}`);
    assetNotices.push(`${asset.name}\nDeclared license: ${asset.license}\nRedistribution status: ${asset.status}\nSource: ${asset.source}\n\n${license.toString('utf8')}`);
  }
  const files = [
    ...result.files.map((file) => ({ path: `licenses/${file.path}`, content: file.content })),
    { path: 'licenses/dependencies.json', content: Buffer.from(`${JSON.stringify({ schemaVersion: 1, scope: 'Installed production dependency graph, including renderer dependencies and transitive peer packages', components: result.components }, null, 2)}\n`) },
    { path: 'THIRD_PARTY_NOTICES.txt', content: Buffer.from(`Nook third-party notices\n\nThis inventory retains the installed production dependency graph. Some graph entries are build-time peers or bundled renderer components rather than separate shipped modules. The original license files are retained byte for byte under licenses/runtime. Bundled assets and Windows distribution components are listed separately below. Unresolved rights are not permission to redistribute. Installer records cover audited build inputs; their inclusion does not imply that every input is embedded in every distribution. Electron and Chromium retain their separate vendor notices beside the executable.\n\n${result.notices}\n\n---\n\n${assetNotices.join('\n\n---\n\n')}\n\n---\n\nWindows distribution components\n\n${distribution.notices}\n`) }
  ];
  if (!check) {
    const generated = resolve(root, 'licenses', 'runtime');
    const existing = await realpath(generated).catch((error) => { if (error.code === 'ENOENT') return generated; throw error; });
    if (relative(root, existing) !== join('licenses', 'runtime')) throw new Error('The generated license directory must remain inside the project');
    await rm(generated, { recursive: true, force: true });
    for (const file of files) { const path = join(root, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.content); }
  } else {
    for (const file of files) { if (!(await readFile(join(root, file.path))).equals(file.content)) throw new Error('Third-party notices are stale or incomplete. Run pnpm notices before packaging.'); }
  }
  console.log(`${check ? 'Verified' : 'Retained'} ${result.components.length} dependency versions and ${result.files.length} complete legal documents; ${assets.length} bundled asset groups and ${distribution.components} Windows distribution components.`);
  const unresolved = [...assets.filter((asset) => asset.status !== 'verified').map((asset) => asset.name), ...distribution.unresolved];
  if (process.argv.includes('--release') && unresolved.length) throw new Error(`Release rights remain unresolved: ${unresolved.join(', ')}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
