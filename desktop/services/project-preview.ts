import { open, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { projectPreviewSchema } from '../../contracts/project-preview';
import { scopedPath } from './project-files';
import { writableProjectPath } from './project-writes';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const maximumAssetBytes = 8 * 1024 * 1024;
const policy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";
function allowedPath(path: string): boolean {
  return Boolean(path) && !isAbsolute(path) && !/[\\:\0]/.test(path)
    && path.split('/').every(part => Boolean(part) && !part.startsWith('.')) && Boolean(types[extname(path).toLowerCase()]);
}

/** A read-only, offline project origin with an immutable snapshot of unsaved text files. */
export class ProjectPreviewSource {
  private constructor(readonly origin: string, readonly path: string, private readonly root: string, private readonly drafts: ReadonlyMap<string, string>) {}

  static async create(root: string, raw: unknown, id: string): Promise<ProjectPreviewSource> {
    const input = projectPreviewSchema.parse(raw);
    if (!/^[a-f0-9-]{36}$/.test(id) || !allowedPath(input.path)) throw new Error('Choose a relative HTML file inside the project.');
    const actualRoot = await realpath(root);
    const entry = await writableProjectPath(actualRoot, input.path);
    if (!allowedPath(relative(actualRoot, entry).split(sep).join('/'))) throw new Error('Preview drafts must remain inside the visible project files.');
    const drafts = new Map([[input.path, input.text]]);
    for (const draft of input.drafts ?? []) {
      if (!allowedPath(draft.path) || drafts.has(draft.path)) throw new Error('Preview draft paths must be unique project files.');
      const target = await writableProjectPath(actualRoot, draft.path);
      if (!allowedPath(relative(actualRoot, target).split(sep).join('/'))) throw new Error('Preview drafts must remain inside the visible project files.');
      drafts.set(draft.path, draft.text);
    }
    return new ProjectPreviewSource(`nook-preview://${id}`, input.path, actualRoot, drafts);
  }

  get url(): string { return `${this.origin}/${this.path.split('/').map(encodeURIComponent).join('/')}`; }

  async response(request: Request): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    try {
      const url = new URL(request.url);
      if (`${url.protocol}//${url.host}` !== this.origin || url.username || url.password || url.href.length > 16_000) throw new Error();
      const path = decodeURIComponent(url.pathname.slice(1));
      if (!allowedPath(path)) throw new Error();
      let bytes: Uint8Array<ArrayBuffer>;
      if (this.drafts.has(path)) bytes = new TextEncoder().encode(this.drafts.get(path)!);
      else {
        const target = await scopedPath(this.root, path);
        if (!allowedPath(relative(this.root, target).split(sep).join('/'))) throw new Error();
        const file = await open(target, 'r');
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > maximumAssetBytes) throw new Error();
          // Bound the read even if the file grows after stat.
          const buffer = Buffer.alloc(Number(info.size) + 1);
          let used = 0;
          while (used < buffer.length) {
            const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
            if (!bytesRead) break;
            used += bytesRead;
          }
          if (used > info.size) throw new Error();
          bytes = new Uint8Array(buffer.subarray(0, used));
        } finally { await file.close(); }
      }
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
        'Content-Type': types[extname(path).toLowerCase()], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': policy, 'Cross-Origin-Resource-Policy': 'same-origin',
      } });
    } catch { return new Response('Preview resource unavailable', { status: 404 }); }
  }
}
