import { copyFile, mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from '../contracts/plugins';
import { ElectronPluginRuntime, pluginAssetUrl } from '../desktop/electron-plugin-runtime';
import { LocalPlugins } from '../desktop/services/local-plugins';
import { createPluginFixture } from './plugin-fixture.mjs';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn(), on: vi.fn() } }));
const directories: string[] = [];
const fontSource = new URL('../workbench/theme/fonts/InterVariable-693b77d4f32e.woff2', import.meta.url);
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'qiyao-panel-font-')); directories.push(directory);
  const source = join(directory, 'source'); await createPluginFixture(source);
  const packages = new LocalPlugins(join(directory, 'plugins'));
  const plugin: Plugin = { ...await packages.importPath(source), enabled: true, grants: ['panels'] };
  const main = join(directory, 'out/main'); const assets = join(directory, 'out/renderer/assets');
  await mkdir(main, { recursive: true }); await mkdir(assets, { recursive: true });
  const font = join(assets, 'InterVariable-693b77d4f32e-buildHash.woff2'); await copyFile(fontSource, font);
  const runtime = new ElectronPluginRuntime(packages, (id) => id === plugin.id ? plugin : undefined, main);
  const response = (path: string, options?: RequestInit, runtimeId?: string) => runtime.response(new Request(`qiyao-plugin://${plugin.id}${path}`, options), runtimeId);
  return { directory, source, packages, plugin, font, assets, runtime, response };
}

describe('isolated plugin panel assets', () => {
  it('serves the complete original bundled Inter bytes with bounded same-origin headers and an empty HEAD body', async () => {
    const { response } = await fixture(); const get = await response('/_qiyao/font.woff2');
    expect(get.status).toBe(200); expect(Buffer.from(await get.arrayBuffer())).toEqual(await readFile(fontSource));
    expect(get.headers.get('Content-Type')).toBe('font/woff2'); expect(get.headers.get('Cache-Control')).toBe('no-store');
    expect(get.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin'); expect(get.headers.get('Content-Security-Policy')).toContain("font-src 'self'");
    const head = await response('/_qiyao/font.woff2', { method: 'HEAD' }); expect(head.status).toBe(200); expect(await head.text()).toBe('');
  });
  it('exposes the same variable Inter family and weight range in the isolated light/dark theme', async () => {
    const { response } = await fixture(); const theme = await response('/_qiyao/theme.css'); expect(theme.status).toBe(200);
    const css = await theme.text(); expect(css).toContain("font-family:'Inter'"); expect(css).toContain('font-weight:100 900');
    expect(css).toContain("src:url('/_qiyao/font.woff2')"); expect(css).toContain(':root[data-theme=dark]');
    expect(theme.headers.get('Content-Type')).toBe('text/css');
  });
  it('returns a redacted missing response when the bundle or selected font disappears', async () => {
    const { response, font, assets } = await fixture(); await rm(font);
    const absent = await response('/_qiyao/font.woff2'); expect(absent.status).toBe(404); expect(await absent.text()).toBe('Not found');
    await rmdir(assets); const missingDirectory = await response('/_qiyao/font.woff2'); expect(missingDirectory.status).toBe(404); expect(await missingDirectory.text()).toBe('Not found');
  });
  it('keeps fonts inaccessible to disabled/ungranted panels and other runtime owners', async () => {
    const { plugin, response, runtime } = await fixture(); plugin.enabled = false; expect((await response('/_qiyao/font.woff2')).status).toBe(404);
    plugin.enabled = true; plugin.grants = []; expect((await response('/_qiyao/font.woff2')).status).toBe(404);
    expect((await response('/_qiyao/font.woff2', undefined, randomUUID())).status).toBe(404);
    expect((await response('/_qiyao/font.woff2', undefined, plugin.id)).status).toBe(200);
    expect((await runtime.response(new Request(`qiyao-plugin://${randomUUID()}/_qiyao/font.woff2`))).status).toBe(404);
  });
  it('rejects foreign schemes, credential URLs and mutating requests without exposing local paths', async () => {
    const { plugin, response, runtime } = await fixture();
    for (const url of [`https://${plugin.id}/_qiyao/font.woff2`, 'qiyao-plugin://invalid/_qiyao/font.woff2']) {
      const result = await runtime.response(new Request(url)); expect(result.status).toBe(404); expect(await result.text()).toBe('Not found');
    }
    const credentialRequest = { method: 'GET', url: `qiyao-plugin://user:password@${plugin.id}/_qiyao/font.woff2` } as Request;
    const credentialResult = await runtime.response(credentialRequest); expect(credentialResult.status).toBe(404); expect(await credentialResult.text()).toBe('Not found');
    const result = await response('/_qiyao/font.woff2', { method: 'POST' }); expect(result.status).toBe(405); expect(await result.text()).toBe('Method not allowed');
  });
  it('retains hash-verified panel assets and safely encodes Unicode paths', async () => {
    const { response, plugin, directory } = await fixture();
    const panel = await response('/files/ui/index.html'); expect(panel.status).toBe(200); expect(await panel.text()).toContain('插件仪表板');
    expect(pluginAssetUrl(plugin.id, 'ui\\中文 面板.html')).toBe(`qiyao-plugin://${plugin.id}/files/ui/%E4%B8%AD%E6%96%87%20%E9%9D%A2%E6%9D%BF.html`);
    await writeFile(join(directory, 'plugins', plugin.id, 'ui/index.html'), 'MODIFIED'); expect((await response('/files/ui/index.html')).status).toBe(404);
    expect((await response('/files/unlisted.txt')).status).toBe(404);
  });
});
