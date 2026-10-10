import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewritePortableTemplate } from './installer-templates.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
try {
  if (process.platform !== 'win32') throw new Error('Verified Windows packaging requires Windows');
  if (process.argv.slice(2).some((argument) => argument !== '--prepackaged')) throw new Error('Unsupported Windows packaging argument');
  const manifest = JSON.parse(await readFile(join(root, 'licenses', 'distribution.json'), 'utf8'));
  assert.equal(manifest.archiveFilter, 'BCJ', 'Windows archives must use the audited NSIS-compatible filter');
  // NSIS's LZMA SDK 19 decoder cannot extract newer automatic ARM64 filters.
  // Explicit BCJ is supported by the pinned decoder and retains every file.
  process.env.ELECTRON_BUILDER_7Z_FILTER = manifest.archiveFilter;
  const builder = createRequire(import.meta.resolve('electron-builder'));
  const { Arch, build, Platform } = builder('electron-builder');
  const library = createRequire(builder.resolve('app-builder-lib'));
  const templates = JSON.parse(await readFile(join(root, 'identity', 'windows', 'templates.json'), 'utf8'));
  assert.equal(builder('electron-builder/package.json').version, templates.builderVersion, 'Review the portable target adapter after updating electron-builder');
  assert.equal(templates.portable.source, 'portable.nsi');
  const { WinPackager } = library('./winPackager');
  // Use the supported per-build factory; preserve the upstream target/helper and
  // alter only the verified original portable script before normal compilation.
  class NookWinPackager extends WinPackager {
    createTargets(targets, mapper) {
      super.createTargets(targets, (name, factory) => mapper(name, (outDir) => {
        const target = factory(outDir);
        if (name === 'portable') {
          const computeFinalScript = target.computeFinalScript;
          target.computeFinalScript = function (source, ...arguments_) {
            assert.equal(createHash('sha256').update(source).digest('hex'), templates.portable.sha256, 'The original portable template changed');
            return computeFinalScript.call(this, rewritePortableTemplate(source), ...arguments_);
          };
        }
        return target;
      }));
    }
  }
  await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64), platformPackagerFactory: (info, platform) => { assert.equal(platform, Platform.WINDOWS); return new NookWinPackager(info); }, publish: 'never', ...(process.argv.includes('--prepackaged') ? { prepackaged: join(root, 'artifacts', 'win-unpacked') } : {}) });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  // Match the builder CLI: dependency exit listeners must not mask failure.
  process.once('exit', () => { process.exitCode = 1; });
}
