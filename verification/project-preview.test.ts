import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectPreviewSource } from '../desktop/services/project-preview';

const directories: string[] = [];
const id = '11111111-1111-4111-8111-111111111111';
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function directory() { const path = await mkdtemp(join(tmpdir(), 'nook-preview-')); directories.push(path); return path; }
async function setup(text = '<h1>Unsaved draft</h1>') { const root = await directory(); const source = await ProjectPreviewSource.create(root, { path: 'index.html', text }, id); return { root, source }; }
const request = (source: ProjectPreviewSource, path = 'index.html', method = 'GET') => source.response(new Request(`${source.origin}/${path}`, { method }));

describe('offline project preview resources', () => {
  it('renders an exact unsaved draft including empty text without overwriting the source', async () => {
    const { root, source } = await setup(); await writeFile(join(root, 'index.html'), '<h1>Disk version</h1>');
    expect(await (await request(source)).text()).toBe('<h1>Unsaved draft</h1>');
    const empty = await ProjectPreviewSource.create(root, { path: 'index.html', text: '' }, id);
    expect(await (await request(empty)).text()).toBe('');
    expect(await readFile(join(root, 'index.html'), 'utf8')).toBe('<h1>Disk version</h1>');
    const response = await request(source); expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-src 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await (await request(source, 'index.html', 'HEAD')).text()).toBe('');
  });

  it('supports nested Unicode paths, CSS, JavaScript modules, JSON and exact binary assets', async () => {
    const root = await directory(); await mkdir(join(root, '页面'));
    const source = await ProjectPreviewSource.create(root, { path: '页面/预览 😀.html', text: '<script src="app.mjs"></script>' }, id);
    expect(source.url).toContain(encodeURIComponent('预览 😀.html'));
    expect(await (await source.response(new Request(source.url))).text()).toContain('app.mjs');
    for (const [name, type] of [['app.mjs', 'text/javascript'], ['style.css', 'text/css'], ['data.json', 'application/json'], ['image.png', 'image/png']]) {
      const bytes = Buffer.from([0, 1, 2, 255]); await writeFile(join(root, '页面', name), bytes);
      const response = await request(source, `页面/${name}?revision=2`); expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain(type); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  it.each(['../outside.html', '/index.html', 'C:/index.html', '.private/index.html', 'a\\b.html', 'index.txt', 'folder//index.html'])('rejects an invalid entry %s', async path => {
    const root = await directory(); await expect(ProjectPreviewSource.create(root, { path, text: '' }, id)).rejects.toThrow();
  });

  it('rejects invalid schema, session identity and missing parents', async () => {
    const root = await directory();
    for (const raw of [null, { path: 'index.html', text: '', extra: true }, { path: 'index.html', text: 'x'.repeat(256_001) }]) await expect(ProjectPreviewSource.create(root, raw, id)).rejects.toThrow();
    await expect(ProjectPreviewSource.create(root, { path: 'index.html', text: '' }, 'invalid')).rejects.toThrow();
    await expect(ProjectPreviewSource.create(root, { path: 'missing/index.html', text: '' }, id)).rejects.toThrow();
  });

  it('denies other origins, methods, hidden files, encoded separators, unsupported files and oversized assets', async () => {
    const { root, source } = await setup(); await mkdir(join(root, '.git')); await writeFile(join(root, '.git', 'config.js'), 'PRIVATE');
    await writeFile(join(root, 'large.js'), Buffer.alloc(8 * 1024 * 1024 + 1)); await mkdir(join(root, 'folder.js'));
    await writeFile(join(root, 'secret.txt'), 'PRIVATE');
    for (const path of ['.git/config.js', '%2egit/config.js', 'secret.txt', 'large.js', 'folder.js', 'missing.js', '%FF.js', 'a%5Cb.js', 'a%3Ab.js']) {
      const response = await request(source, path); expect(response.status).toBe(404); expect(await response.text()).toBe('Preview resource unavailable');
    }
    for (const url of ['https://example.com/index.html', source.url.replace(id, '22222222-2222-4222-8222-222222222222')]) expect((await source.response(new Request(url))).status).toBe(404);
    expect((await source.response({ method: 'GET', url: `${source.origin.replace('://', '://user@')}/index.html` } as Request)).status).toBe(404);
    expect((await request(source, 'index.html', 'POST')).status).toBe(405);
  });

  it('blocks junction escapes and aliases to hidden project files', async () => {
    const { root, source } = await setup(); const outside = await directory();
    await writeFile(join(outside, 'secret.js'), 'PRIVATE'); await symlink(outside, join(root, 'escape'), 'junction');
    expect((await request(source, 'escape/secret.js')).status).toBe(404);
    await expect(ProjectPreviewSource.create(root, { path: 'escape/index.html', text: '' }, id)).rejects.toThrow();
    await mkdir(join(root, '.private')); await writeFile(join(root, '.private', 'secret.js'), 'PRIVATE'); await symlink(join(root, '.private'), join(root, 'alias'), 'junction');
    expect((await request(source, 'alias/secret.js')).status).toBe(404);
  });
});
