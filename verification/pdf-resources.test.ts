import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmbeddedPdfResources } from '../workbench/components/pdf-resources';

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
describe('embedded offline PDF resources', () => {
  it.each([
    ['cMapUrl', 'cmaps', 'UniGB-UCS2-H.bcmap'],
    ['standardFontDataUrl', 'standard_fonts', 'LiberationSans-Regular.ttf'],
    ['wasmUrl', 'wasm', 'openjpeg.wasm'],
  ])('returns exact packaged bytes for %s without fetching a URL', async (kind, folder, filename) => {
    expect(Buffer.from(await new EmbeddedPdfResources().fetch({ kind, filename }))).toEqual(await readFile(join(root, folder, filename)));
  });
  it('rejects paths, unknown resource groups and missing package assets', async () => {
    const resources = new EmbeddedPdfResources();
    for (const filename of ['../package.json', 'a/b', 'https://example.com/font', 'a\\b', '%2e%2e', 'absent.ttf']) await expect(resources.fetch({ kind: 'standardFontDataUrl', filename })).rejects.toThrow();
    for (const kind of ['__proto__', 'constructor', 'unknown']) await expect(resources.fetch({ kind, filename: 'openjpeg.wasm' })).rejects.toThrow();
  });
});
