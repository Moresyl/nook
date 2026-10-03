import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDistributionInventory, verifyDistributionBinaries } from './distribution-inventory.mjs';
import { rewriteInstallerTemplate, rewritePortableTemplate } from './installer-templates.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
try {
  if (process.platform !== 'win32') throw new Error('Windows installer verification requires Windows');
  const manifest = JSON.parse(await readFile(join(root, 'licenses', 'distribution.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const builder = createRequire(import.meta.resolve('electron-builder'));
  const library = createRequire(builder.resolve('app-builder-lib'));
  assert.equal(builder('electron-builder/package.json').version, manifest.builderVersion, 'Update the distribution inventory after changing electron-builder');
  assert.equal(metadata.build.toolsets.nsis, manifest.toolset, 'The installer toolset must match its distribution inventory');
  assert.equal(metadata.build.nsis.customNsisBinary, undefined, 'Custom NSIS binaries require a separate distribution audit');
  assert.equal(metadata.build.nsis.customNsisResources, undefined, 'Custom NSIS plugins require a separate distribution audit');
  assert.equal(metadata.build.nsis.include, 'identity/windows/include.nsh', 'The installer must use the audited System/COM integration');
  assert.equal(metadata.build.portable.useZip, true, 'Portable packaging must use native NSIS file extraction with extended paths');
  const templates = JSON.parse(await readFile(join(root, 'identity', 'windows', 'templates.json'), 'utf8'));
  assert.equal(templates.builderVersion, manifest.builderVersion);
  const templateRoot = join(dirname(library.resolve('app-builder-lib/package.json')), 'templates', 'nsis');
  assert.equal(templates.portable.source, 'portable.nsi', 'The portable launcher must use the original audited template');
  const portable = await readFile(join(templateRoot, templates.portable.source));
  assert.equal(createHash('sha256').update(portable).digest('hex'), templates.portable.sha256, 'The original portable template changed');
  rewritePortableTemplate(portable.toString('utf8'));
  assert.deepEqual(templates.files.map((file) => file.source).sort(), [...(await readdir(templateRoot)).filter((name) => name.endsWith('.nsh')), 'include/installer.nsh'].sort(), 'The original flat installer template inventory changed');
  assert.equal(new Set(templates.files.map((file) => file.target)).size, templates.files.length, 'Installer template output names must be unique');
  const preparedRoot = join(root, 'artifacts', 'installer-templates'); await mkdir(preparedRoot, { recursive: true });
  assert.equal((await realpath(preparedRoot)).toLowerCase(), preparedRoot.toLowerCase(), 'The prepared template directory must not escape through a junction');
  assert.ok((await readdir(preparedRoot)).every((name) => templates.files.some((file) => file.target === name)), 'The prepared template directory contains an undeclared file');
  for (const file of templates.files) {
    assert.match(file.source, /^(?:include\/)?[a-zA-Z]+\.nsh$/);
    assert.match(file.target, /^[a-zA-Z]+\.nsh$/);
    const content = await readFile(join(templateRoot, file.source));
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256, `An original installer template changed: ${file.source}`);
    const variant = file.target === 'installer.nsh' ? 'installer' : file.target === 'uninstaller.nsh' ? 'uninstaller' : undefined;
    await writeFile(join(preparedRoot, file.target), variant ? rewriteInstallerTemplate(content.toString('utf8'), variant) : content);
  }
  const legal = await collectDistributionInventory(manifest, join(root, 'licenses'));
  const { getMakeNsisPath, getNsisPluginsPath, getNsisElevatePath } = library('./toolsets/windows');
  const compiler = await getMakeNsisPath(manifest.toolset);
  const plugins = await getNsisPluginsPath(manifest.toolset);
  const elevate = await getNsisElevatePath(manifest.toolset);
  const binaries = await verifyDistributionBinaries(manifest, { compiler: compiler.env.NSISDIR, plugins, elevate: dirname(elevate) });
  await writeFile(join(root, 'verification', 'installer-toolset-result.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), builderVersion: manifest.builderVersion, toolset: manifest.toolset, archiveFilter: manifest.archiveFilter, templates: templates.files, portableTemplate: templates.portable, retainedComponents: legal.components, binaries, unresolved: legal.unresolved, scope: 'Build-input/template hashes and retained installer legal/source documents. This does not establish that every plugin is embedded or verify installation behavior.' }, null, 2)}\n`);
  console.log(`Verified ${binaries.length} installer build inputs and ${legal.components} retained distribution component records.`);
  if (legal.unresolved.length) console.log(`Unresolved installer redistribution declarations: ${legal.unresolved.join(', ')}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
