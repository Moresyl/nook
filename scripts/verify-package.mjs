import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { collectDistributionInventory } from './distribution-inventory.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.ok(!process.env.QIYAO_AUDIT_KIND || ['portable', 'unpacked'].includes(process.env.QIYAO_AUDIT_KIND), 'Unsupported application-directory audit kind');
assert.ok(!process.env.QIYAO_AUDIT_KIND || process.env.QIYAO_AUDIT_DIRECTORY, 'An explicit application-directory audit kind requires the actual directory');
const directory = process.env.QIYAO_AUDIT_DIRECTORY ? resolve(process.env.QIYAO_AUDIT_DIRECTORY) : join(root, 'artifacts', 'win-unpacked'); const resources = join(directory, 'resources');
const executable = join(directory, 'Nook.exe'); const archive = join(resources, 'app.asar');
const builder = createRequire(import.meta.resolve('electron-builder'));
const library = createRequire(builder.resolve('app-builder-lib'));
const asar = library('@electron/asar');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const oldIdentity = /pi-desktop|pi-pc|vastsa/i;
const removedUiFont = /OpenAI\s*Sans|OpenAISans/i;
const paths = asar.listPackage(archive).map((path) => path.replaceAll('\\', '/').replace(/^\//, ''));
let productFiles = 0;
let unpackedFiles = 0;
const productHashes = new Set();
for (const path of paths) {
  const stored = path.split('/').join(sep);
  const entry = asar.statFile(archive, stored);
  if (entry.files) continue;
  if (entry.unpacked) {
    assert.equal(entry.integrity?.algorithm, 'SHA256', 'Every unpacked file must retain its archive integrity declaration');
    assert.match(entry.integrity.hash, /^[a-f0-9]{64}$/);
    const content = await readFile(join(resources, 'app.asar.unpacked', stored));
    assert.equal(content.length, entry.size, `An unpacked file is incomplete: ${path}`);
    assert.equal(sha256(content), entry.integrity.hash, `An unpacked file changed: ${path}`);
    unpackedFiles++;
  }
  if (!(path.startsWith('out/') || path.startsWith('identity/') || path === 'package.json')) continue;
  assert.equal(oldIdentity.test(path), false, `Old identity in a packaged product path: ${path}`);
  assert.equal(removedUiFont.test(path), false, `Removed UI font in a packaged product path: ${path}`);
  const content = asar.extractFile(archive, stored); productHashes.add(sha256(content));
  if (/\.(?:cjs|js|css|html|json|svg)$/.test(path)) {
    const text = content.toString('utf8');
    assert.equal(oldIdentity.test(text), false, `Old identity in packaged product content: ${path}`);
    assert.equal(removedUiFont.test(text), false, `Removed UI font reference in packaged product content: ${path}`);
  }
  if (path !== 'package.json') assert.equal(sha256(content), sha256(await readFile(join(root, path))), `Packaged product asset changed: ${path}`);
  productFiles++;
}
const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(metadata.name, 'nook-workspace'); assert.equal(metadata.author.name, 'Nook'); assert.equal(metadata.license, 'LGPL-3.0-or-later');
const dependencies = JSON.parse(await readFile(join(root, 'licenses', 'dependencies.json'), 'utf8'));
let retainedDocuments = 0;
for (const component of dependencies.components) {
  for (const document of component.documents) { const content = await readFile(join(resources, 'licenses', document.path)); assert.equal(sha256(content), document.sha256, `A packaged license changed: ${component.name}`); retainedDocuments++; }
}
for (const path of ['THIRD_PARTY_NOTICES.txt', 'licenses/project/NOTICE.txt', 'licenses/assets.json']) {
  const content = await readFile(join(resources, path));
  assert.equal(oldIdentity.test(content.toString('utf8')), false, `Old project identity in packaged licensing metadata: ${path}`);
  assert.ok(content.equals(await readFile(join(root, path))), `Packaged licensing metadata changed: ${path}`);
}
const assets = JSON.parse(await readFile(join(root, 'licenses', 'assets.json'), 'utf8'));
for (const asset of assets) {
  assert.equal(sha256(await readFile(join(resources, 'licenses', asset.document))), asset.documentSha256, `A packaged asset notice changed: ${asset.name}`);
  for (const file of asset.files) {
    if (file.path.startsWith('workbench/theme/fonts/')) assert.ok(productHashes.has(file.sha256), `A font asset is absent or changed: ${asset.name}`);
    else if (file.path.startsWith('workbench/theme/katex-fonts/') && !productHashes.has(file.sha256)) { const canonical = basename(file.path).replace(/-[a-f0-9]{12}(?=\.[^.]+$)/, ''); assert.equal(sha256(asar.extractFile(archive, ['node_modules', 'katex', 'dist', 'fonts', canonical].join(sep))), file.sha256, `An alternate packaged math font changed: ${asset.name}`); }
    else if (file.path === 'workbench/theme/reference-math.css') assert.equal(sha256(await readFile(join(root, file.path))), file.sha256, 'The retained math stylesheet must match its verified font inventory');
    else if (file.path.startsWith('licenses/')) assert.equal(sha256(await readFile(join(resources, file.path))), file.sha256, 'An original bundled font license changed');
    else if (file.path.startsWith('node_modules/')) assert.equal(sha256(asar.extractFile(archive, file.path.split('/').join(sep))), file.sha256, `A native asset changed: ${asset.name}`);
  }
}
for (const name of ['LICENSE', 'COPYING', 'THIRD_PARTY_NOTICES.txt']) assert.ok((await readFile(join(root, name))).equals(await readFile(join(resources, name))), `A packaged root license changed: ${name}`);
const distributionContent = await readFile(join(root, 'licenses', 'distribution.json'));
assert.ok(distributionContent.equals(await readFile(join(resources, 'licenses', 'distribution.json'))), 'The packaged distribution inventory changed');
const distributionManifest = JSON.parse(distributionContent.toString('utf8'));
const distribution = await collectDistributionInventory(distributionManifest, join(resources, 'licenses'));
const distributionFiles = new Set(distributionManifest.components.flatMap((component) => [...component.documents, ...component.sources].map((file) => file.path)));
const distributionEntries = await readdir(join(resources, 'licenses', 'distribution'), { recursive: true, withFileTypes: true });
assert.ok(distributionEntries.every((entry) => !entry.isSymbolicLink()), 'Packaged distribution files must not escape through links');
const actualDistributionFiles = distributionEntries.filter((entry) => entry.isFile()).map((entry) => relative(join(resources, 'licenses'), join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
assert.deepEqual(actualDistributionFiles, [...distributionFiles].filter((path) => path.startsWith('distribution/')).sort(), 'Packaged distribution files must match the declared inventory without unused vendor archives');
const helper = distributionManifest.components.flatMap((component) => component.binaries).find((binary) => binary.location === 'elevate');
assert.ok(helper, 'The shipped elevation helper must have a distribution record');
const elevationHelper = await readFile(join(resources, 'elevate.exe')).catch((error) => { if (error.code === 'ENOENT' && !process.argv.includes('--installer')) return null; throw error; });
if (elevationHelper) assert.equal(sha256(elevationHelper), helper.sha256, 'The packaged elevation helper changed');
for (const [original, packed] of [['LICENSE', 'LICENSE.electron.txt'], ['LICENSES.chromium.html', 'LICENSES.chromium.html']]) assert.ok((await readFile(join(root, 'node_modules', 'electron', 'dist', original))).equals(await readFile(join(directory, packed))), `Electron vendor notice changed: ${packed}`);
const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $item=Get-Item -LiteralPath $env:QIYAO_AUDIT_EXECUTABLE; $info=$item.VersionInfo; @{ProductName=$info.ProductName;CompanyName=$info.CompanyName;FileDescription=$info.FileDescription;Copyright=$info.LegalCopyright;Signature=(Get-AuthenticodeSignature -LiteralPath $item.FullName).Status.ToString()} | ConvertTo-Json -Compress"], { windowsHide: true, env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'), QIYAO_AUDIT_EXECUTABLE: executable } });
const executableMetadata = JSON.parse(stdout); assert.equal(executableMetadata.ProductName, 'Nook'); assert.equal(executableMetadata.CompanyName, 'Nook'); assert.equal(executableMetadata.FileDescription, 'Nook'); assert.equal(executableMetadata.Copyright, 'Copyright © 2026 Nook');
const unresolvedAssets = assets.filter((asset) => asset.status !== 'verified').map((asset) => asset.name);
const result = { verifiedAt: new Date().toISOString(), version: metadata.version, executableSha256: sha256(await readFile(executable)), archiveSha256: sha256(await readFile(archive)), executableBytes: (await stat(executable)).size, executableMetadata, productFiles, unpackedFiles, dependencyVersions: dependencies.components.length, retainedDocuments, distributionComponents: distribution.components, distributionFiles: distributionFiles.size, elevationHelperSha256: elevationHelper ? sha256(elevationHelper) : null, unresolvedDistribution: distribution.unresolved, originalVendorNotices: ['LICENSE.electron.txt', 'LICENSES.chromium.html'], oldProductIdentityMatches: [], removedUiFontReferencesVerified: true, compiledAssetsMatchVerifiedBuild: true, unresolvedAssets, scope: 'Windows application-directory identity and removed-font references, every archive-declared unpacked file integrity hash and byte-for-byte legal/source retention. Vendor legal attribution is preserved. Installer behavior and full feature/UI completion remain separate gates.' };
await writeFile(join(root, 'verification', process.env.QIYAO_AUDIT_KIND ? `${process.env.QIYAO_AUDIT_KIND}-package-audit-result.json` : process.env.QIYAO_AUDIT_DIRECTORY ? 'installed-package-audit-result.json' : 'package-audit-result.json'), JSON.stringify(result, null, 2));
console.log(`Verified ${productFiles} packaged product files, ${retainedDocuments} complete dependency legal documents, ${distributionFiles.size} distribution legal/source files, asset notices, Electron/Chromium notices and Nook executable metadata.`);
if (unresolvedAssets.length) console.log(`Unresolved redistribution rights: ${unresolvedAssets.join(', ')}`);
if (distribution.unresolved.length) console.log(`Unresolved installer redistribution declarations: ${distribution.unresolved.join(', ')}`);
