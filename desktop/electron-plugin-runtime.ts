import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import type { Plugin, PluginInvocation } from '../contracts/plugins';
import type { LocalPlugins } from './services/local-plugins';
import type { PluginProcess, PluginProcessFactory } from './services/plugin-host';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; dispose(): void };
type Runtime = { window: BrowserWindow; ready(value: unknown): void; result(id: unknown, success: unknown, value: unknown): void; request(method: string, params: unknown, token?: string): Promise<unknown> };
const runtimes = new Map<number, Runtime>();
let registered = false;
const origin = (id: string) => `qiyao-plugin://${id}`;
export const pluginAssetUrl = (id: string, path: string) => `${origin(id)}/files/${path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')}`;
const mime: Record<string, string> = { js: 'text/javascript', mjs: 'text/javascript', html: 'text/html; charset=utf-8', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', woff2: 'font/woff2' };

const panelSdk = `const pending = new Map(); let counter = 0; let initialized = false; let finish;
const ready = new Promise(resolve => { finish = resolve; });
const announce = () => parent.postMessage({type:'qiyao:plugin-ready'}, '*');
const timer = setInterval(announce, 50); announce();
addEventListener('message', event => { if(event.source !== parent) return; const data = event.data;
if(data?.type === 'qiyao:plugin-init') { document.documentElement.dataset.theme = data.theme; if(!initialized) { initialized=true; clearInterval(timer); finish(); } }
if(data?.type === 'qiyao:plugin-reply') { const item = pending.get(data.id); if(!item) return; pending.delete(data.id); clearTimeout(item.timer); data.ok ? item.resolve(data.value) : item.reject(new Error(data.error || 'Plugin request failed')); }
});
const api = { async call(method, params={}) { await ready; const id=String(++counter); return new Promise((resolve,reject) => { const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Plugin request timed out'));},65000); pending.set(id,{resolve,reject,timer}); parent.postMessage({type:'qiyao:plugin-request',id,method,params},'*'); }); } };
window.qiyaoPlugin=api; export default api;`;
const themeCss = `@font-face{font-family:'Inter';src:url('/_qiyao/font.woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
:root{color-scheme:light;--ds-bg:#fff;--ds-bg-secondary:#f7f7f7;--ds-text:#202020;--ds-text-secondary:#6f6f6f;--ds-border:#dedede;--ds-accent:#0169cc;font-family:'Inter','Microsoft YaHei UI',sans-serif;font-size:12px;color:var(--ds-text);background:var(--ds-bg)}
:root[data-theme=dark]{color-scheme:dark;--ds-bg:#212121;--ds-bg-secondary:#181818;--ds-text:#eee;--ds-text-secondary:#aaa;--ds-border:#444;--ds-accent:#339cff}
body{margin:0;padding:20px}button,input,select,textarea{font:inherit;color:inherit}button{border:0;border-radius:6px;padding:3px 8px;min-height:20px;background:transparent;cursor:pointer}button:hover{background:var(--ds-bg-secondary)}input,select,textarea{border:1px solid var(--ds-border);border-radius:6px;background:transparent;min-height:22px;padding:0 10px}button:focus-visible,input:focus-visible{outline:2px solid var(--ds-accent);outline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--ds-bg-secondary);padding:12px;border-radius:8px}`;

export class ElectronPluginRuntime {
  constructor(private readonly packages: LocalPlugins, private readonly configuration: (id: string) => Plugin | undefined, private readonly bundleDirectory: string) {}

  private headers(type: string, panel: boolean): Record<string, string> {
    return { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${panel ? 'qiyao: http://localhost:*' : "'none'"}` };
  }

  async response(request: Request, runtimeId?: string): Promise<Response> {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'qiyao-plugin:' || url.username || url.password || url.toString().length > 16_000) throw new Error();
      const id = z.uuid().parse(url.hostname); const plugin = this.configuration(id);
      if (!plugin?.enabled || (runtimeId ? runtimeId !== id : !plugin.grants.includes('panels'))) throw new Error();
      let body: string | Uint8Array<ArrayBuffer>; let type = 'text/javascript';
      if (url.pathname === '/_qiyao/runtime.html' && runtimeId) {
        body = '<!doctype html><html><meta charset="utf-8"><title>Qiyao plugin runtime</title><script type="module" src="/_qiyao/bootstrap.js"></script></html>'; type = 'text/html';
      } else if (url.pathname === '/_qiyao/bootstrap.js' && runtimeId) {
        body = `try { const api = window.qiyaoPlugin; ${plugin.manifest.main ? `const entry = await import(${JSON.stringify(pluginAssetUrl(id, plugin.manifest.main))}); const activate = entry.default ?? entry.activate; if(typeof activate !== 'function') throw new Error(); if(typeof entry.deactivate === 'function') api.onDeactivate(entry.deactivate); await activate(api);` : ''} api.ready(); } catch { window.qiyaoPlugin?.ready(true); }`;
      } else if (url.pathname === '/_qiyao/panel-sdk.js' && !runtimeId) body = panelSdk;
      else if (url.pathname === '/_qiyao/theme.css') { body = themeCss; type = 'text/css'; }
      else if (url.pathname === '/_qiyao/font.woff2') {
        const fonts = await readdir(join(this.bundleDirectory, '../renderer/assets')); const font = fonts.find((name) => /^InterVariable-.*\.woff2$/.test(name)); if (!font) throw new Error();
        body = new Uint8Array(await readFile(join(this.bundleDirectory, '../renderer/assets', font))); type = 'font/woff2';
      } else if (url.pathname.startsWith('/files/')) {
        const path = decodeURIComponent(url.pathname.slice(7)); body = new Uint8Array(await this.packages.asset(plugin, path)); type = mime[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
      } else throw new Error();
      return new Response(request.method === 'HEAD' ? null : body, { headers: this.headers(type, !runtimeId) });
    } catch { return new Response('Not found', { status: 404 }); }
  }

  private registerIpc(): void {
    if (registered) return; registered = true;
    const owner = (event: IpcMainEvent | IpcMainInvokeEvent) => {
      const runtime = runtimes.get(event.sender.id);
      if (!runtime || runtime.window.isDestroyed() || event.senderFrame !== runtime.window.webContents.mainFrame) throw new Error('Untrusted plugin request.'); return runtime;
    };
    ipcMain.handle('qiyao:plugin-rpc', (event, method, params, token) => owner(event).request(z.string().min(1).max(100).parse(method), params, token === undefined ? undefined : z.uuid().parse(token)));
    ipcMain.on('qiyao:plugin-ready', (event, value) => { try { owner(event).ready(value); } catch {} });
    ipcMain.on('qiyao:plugin-result', (event, id, success, value) => { try { owner(event).result(id, success, value); } catch {} });
  }

  private configureSession(session: Session, id: string): void {
    session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false)); session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, answer) => { answer({ cancel: !details.url.startsWith(`${origin(id)}/`) }); });
  }

  readonly factory: PluginProcessFactory = async (plugin, callbacks): Promise<PluginProcess> => {
    this.registerIpc();
    const window = new BrowserWindow({ show: false, width: 320, height: 200, skipTaskbar: true, title: `Qiyao · ${plugin.manifest.name}`,
      webPreferences: { preload: join(this.bundleDirectory, '../preload/plugin-bridge.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, partition: `qiyao-plugin-runtime-${plugin.id}`, backgroundThrottling: false, spellcheck: false } });
    const contents = window.webContents; const contentsId = contents.id; const session = contents.session;
    try {
      this.configureSession(session, plugin.id);
      if (await session.protocol.isProtocolHandled('qiyao-plugin')) session.protocol.unhandle('qiyao-plugin');
      session.protocol.handle('qiyao-plugin', (request) => this.response(request, plugin.id));
    } catch (error) {
      window.destroy();
      try { session.protocol.unhandle('qiyao-plugin'); } catch {}
      await session.clearStorageData().catch(() => {});
      throw error;
    }
    const pending = new Map<string, Pending>(); let stopped = false; let closing = false; let closePromise: Promise<void> | undefined;
    let ready!: (value: unknown) => void; let rejectReady!: (error: Error) => void;
    const prepared = new Promise<void>((resolve, reject) => {
      rejectReady = reject;
      ready = (value) => {
        try {
          const info = z.object({ failed: z.boolean(), tools: z.array(z.string()).max(50), commands: z.array(z.string()).max(50) }).strict().parse(value);
          if (info.failed || JSON.stringify([...info.tools].sort()) !== JSON.stringify(plugin.manifest.tools.map((item) => item.name).sort()) || JSON.stringify([...info.commands].sort()) !== JSON.stringify(plugin.manifest.commands.map((item) => item.id).sort())) throw new Error();
          resolve();
        } catch { reject(new Error('Plugin activation or handler registration failed.')); }
      };
    });
    void prepared.catch(() => {});
    const rejectCalls = () => { rejectReady(new Error('Plugin runtime stopped.')); for (const item of pending.values()) { item.dispose(); item.reject(new Error('Plugin runtime stopped.')); } pending.clear(); };
    const invoke = (call: PluginInvocation, signal: AbortSignal, timeout: number): Promise<unknown> => new Promise((resolve, reject) => {
      if (stopped || window.isDestroyed() || signal.aborted) { reject(new Error('Plugin runtime stopped.')); return; }
      const abort = () => { contents.send('qiyao:plugin-cancel', call.context.token); const item = pending.get(call.id); if (item) { pending.delete(call.id); item.dispose(); reject(signal.reason ?? new Error('Plugin operation stopped.')); } };
      const timer = setTimeout(() => { const item = pending.get(call.id); if (item) { pending.delete(call.id); item.dispose(); reject(new Error('Plugin operation timed out.')); contents.forcefullyCrashRenderer(); } }, timeout);
      const dispose = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      signal.addEventListener('abort', abort, { once: true }); pending.set(call.id, { resolve, reject, dispose }); contents.send('qiyao:plugin-call', call);
    });
    runtimes.set(contents.id, { window, ready, request: callbacks.request, result: (id, success, value) => {
      if (typeof id !== 'string' || typeof success !== 'boolean') return; const item = pending.get(id); if (!item) return; pending.delete(id); item.dispose();
      if (success) item.resolve(value); else item.reject(new Error('The plugin handler failed.'));
    } });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault()); contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame) event.preventDefault(); });
    contents.on('render-process-gone', () => { rejectCalls(); if (!stopped && !closing) callbacks.failed(); });
    window.on('closed', () => { runtimes.delete(contentsId); rejectCalls(); if (!stopped && !closing) callbacks.failed(); });
    contents.on('did-fail-load', (_event, code) => { if (code !== -3) rejectReady(new Error('Plugin page failed to load.')); });
    const close = (): Promise<void> => {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        if (!window.isDestroyed()) {
          try { await invoke({ id: randomUUID(), kind: 'deactivate', name: '', arguments: {}, context: { token: randomUUID(), mode: 'deactivate' } }, new AbortController().signal, 1500); } catch {}
        }
        stopped = true; runtimes.delete(contentsId); rejectCalls();
        if (!window.isDestroyed()) window.destroy(); session.protocol.unhandle('qiyao-plugin'); await session.clearStorageData();
      })();
      return closePromise;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startupDeadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Plugin startup timed out.')), 10_000); });
    try { await Promise.race([Promise.all([window.loadURL(`${origin(plugin.id)}/_qiyao/runtime.html`), prepared]), startupDeadline]); }
    catch (error) { await close(); throw error; }
    finally { clearTimeout(timer); }
    return { invoke, close };
  };
}
