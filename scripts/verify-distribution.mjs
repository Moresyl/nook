import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { collectDistributionInventory } from './distribution-inventory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.platform, 'win32', 'Windows distribution verification requires Windows');
assert.ok(process.env.QIYAO_ARCHIVE_TOOL, 'Set QIYAO_ARCHIVE_TOOL to a full 7-Zip executable with NSIS support');
const tool = resolve(process.env.QIYAO_ARCHIVE_TOOL);
const runFile = promisify(execFile);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'licenses', 'distribution.json'), 'utf8'));
await collectDistributionInventory(manifest, join(root, 'licenses'));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const scratchRoot = resolve(tmpdir());
const directory = await mkdtemp(join(scratchRoot, 'qiyao-bootstrap-'));
const variants = [];
let succeeded = false;
async function audit(executable, variant) {
  const { stdout } = await runFile(tool, ['l', '-slt', '-sccUTF-8', executable], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.match(stdout, /^Type = Nsis\r?$/m, 'The tool must recognize the actual NSIS executable');
  const listed = [...stdout.matchAll(/^Path = (.+)\r?$/gm)].map((match) => match[1].trim()).filter((path) => /^\$PLUGINSDIR[\\/][^\\/]+\.dll$/i.test(path));
  assert.ok(listed.length, 'NSIS plugin listing must not be empty');
  assert.ok(!listed.some((path) => /[\\/]WinShell\.dll$/i.test(path)), 'The removed WinShell plugin must not be embedded');
  const target = join(directory, variant); await mkdir(target);
  await runFile(tool, ['x', '-y', '-sccUTF-8', `-o${target}`, executable, ...listed, ...(variant === 'installer' ? ['$R0\\Uninstall Qiyao.exe'] : [])], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const plugins = [];
  for (const path of listed) {
    const filename = basename(path.replaceAll('\\', '/'));
    const declaration = manifest.components.flatMap((component) => component.binaries.map((binary) => ({ component, binary }))).find(({ binary }) => binary.location !== 'elevate' && basename(binary.path.replaceAll('\\', '/')).toLowerCase() === filename.toLowerCase());
    assert.ok(declaration, `An embedded installer plugin has no legal/input declaration: ${filename}`);
    const content = await readFile(join(target, '$PLUGINSDIR', filename));
    assert.equal(sha256(content), declaration.binary.sha256, `An embedded installer plugin changed: ${filename}`);
    plugins.push({ file: filename, component: declaration.component.name, redistributionStatus: declaration.component.status, sha256: sha256(content) });
  }
  assert.deepEqual((await readdir(join(target, '$PLUGINSDIR'))).sort(), plugins.map((plugin) => plugin.file).sort(), 'The extracted plugin inventory must match the actual executable listing');
  variants.push({ variant, executableSha256: sha256(await readFile(executable)), plugins });
  console.log(`Verified ${plugins.length} actual ${variant} bootstrap plugins and their declared original input hashes.`);
  const unresolved = plugins.filter((plugin) => plugin.redistributionStatus !== 'verified').map((plugin) => plugin.file);
  if (unresolved.length) console.log(`Unresolved ${variant} plugin redistribution declarations: ${unresolved.join(', ')}`);
  if (variant === 'installer') await audit(join(target, '$R0', 'Uninstall Qiyao.exe'), 'uninstaller');
}
try {
  await audit(join(root, 'artifacts', `Qiyao-Setup-${metadata.version}-x64.exe`), 'installer');
  await audit(join(root, 'artifacts', `Qiyao-Portable-${metadata.version}-x64.exe`), 'portable');
  await writeFile(join(root, 'verification', 'distribution-bootstrap-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), archiveToolSha256: sha256(await readFile(tool)), variants, scope: 'Actual NSIS installer, embedded uninstaller and portable bootstrap plugin inventories and exact original plugin hashes. Unresolved declarations remain explicit and fail the separate release gate. Application directory/source retention, runtime behavior, signatures, fonts and release approval remain separate checks.' }, null, 2));
  succeeded = true;
} finally {
  if (succeeded) {
    assert.equal(dirname(directory), scratchRoot); assert.match(basename(directory), /^qiyao-bootstrap-[A-Za-z0-9]{6}$/);
    await rm(directory, { recursive: true, force: true });
  }
  else console.error(`Retained failed bootstrap verification directory: ${directory}`);
}
