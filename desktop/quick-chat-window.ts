import { BrowserWindow, dialog, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContentBridge } from '../contracts/quick-chat';
import type { RunEvent } from '../contracts/bridge-contract';
import type { QuickChat } from './services/quick-chat';
import type { ConversationEngine } from './services/conversation-engine';

type Options = { preload: string; url: string; icon: string; quick: QuickChat; engine: ConversationEngine;
  content: (window: BrowserWindow) => ContentBridge; openWorkspace: (settings: boolean) => Promise<void> };
type Flush = { token: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class QuickChatWindow {
  private window?: BrowserWindow;
  private pending?: Flush;
  private closed = false;
  private visibleRevision = 0;
  private collapsed = false;
  private expandedHeight = 580;
  constructor(private readonly options: Options) {}

  open(): void {
    if (this.closed) throw new Error('Quick chat is shutting down.');
    this.visibleRevision++;
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore(); this.window.show(); this.window.focus(); this.refresh(); return;
    }
    const window = new BrowserWindow({ width: 640, height: 580, minWidth: 420, minHeight: 360, title: '快速聊天 · Nook', frame: false,
      show: false, alwaysOnTop: true, backgroundColor: '#ffffff', icon: this.options.icon, autoHideMenuBar: true,
      webPreferences: { preload: this.options.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false } });
    this.window = window; this.collapsed = false; this.expandedHeight = 580; window.setMenu(null);
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const prevent = (event: { preventDefault: () => void }) => event.preventDefault();
    contents.on('will-navigate', prevent); contents.on('will-frame-navigate', prevent); contents.on('will-redirect', prevent);
    contents.on('will-attach-webview', prevent); contents.on('will-prevent-unload', prevent);
    window.once('ready-to-show', () => { if (!this.closed && !window.isDestroyed()) { window.show(); window.focus(); } });
    window.on('close', event => { if (this.closed) return; event.preventDefault(); void this.hide().catch(() => {
      if (!window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: '快速聊天草稿未能保存，窗口已保留。', detail: '请检查磁盘空间与工作台目录权限，然后重试。' });
    }); });
    window.once('closed', () => {
      if (this.window !== window) return; this.window = undefined;
      this.failFlush(new Error('Quick chat closed before its input could be saved.'));
    });
    void window.loadURL(this.options.url).catch(() => {
      if (!window.isDestroyed()) { void dialog.showMessageBox(window, { type: 'error', message: '快速聊天暂时无法显示。', detail: '输入仍保存在本地，重新打开窗口后再试。' }); window.destroy(); }
    });
  }

  private failFlush(error: Error): void {
    if (!this.pending) return; const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.reject(error);
  }
  flush(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return Promise.resolve();
    if (this.pending) return this.pending.promise;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const token = randomUUID();
    const timer = setTimeout(() => this.failFlush(new Error('Quick chat input could not be saved in time. Retry after checking the window.')), 5000);
    this.pending = { token, promise, resolve, reject, timer }; this.window.webContents.send('nook:quick-flush', token); return promise;
  }
  private async hide(): Promise<void> {
    const revision = this.visibleRevision; await this.flush(); if (revision === this.visibleRevision) this.window?.hide();
  }
  refresh(): void { if (this.window && !this.window.isDestroyed()) this.window.webContents.send('nook:quick-refresh'); }
  emit(event: RunEvent): void {
    if (!this.window || this.window.isDestroyed() || !this.options.quick.owns(event.threadId)) return;
    const { state, ...scoped } = event;
    this.window.webContents.send('nook:quick-run', { ...scoped, thread: state?.threads.find(thread => thread.id === event.threadId) });
  }
  async shutdown(): Promise<void> { await this.flush(); this.closed = true; this.window?.destroy(); }

  ownsContents(contents: WebContents | null): boolean { return Boolean(contents && this.window && !this.window.isDestroyed() && contents === this.window.webContents); }

  async handle(event: IpcMainInvokeEvent, command: unknown, args: unknown[]): Promise<unknown> {
    const window = this.window;
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted quick-chat request.');
    const content = this.options.content(window), quick = this.options.quick, engine = this.options.engine;
    const commands: Record<string, (...input: any[]) => unknown> = {
      load: () => quick.load(), save: (draft, revision) => quick.save(draft, revision), send: revision => quick.send(revision),
      stop: () => quick.stop(), activate: (id, revision) => quick.activate(id, revision),
      openWorkspace: async settings => { await this.flush(); await this.options.openWorkspace(z.boolean().optional().parse(settings) ?? false); },
      attachFiles: content.attachFiles, importAttachments: content.importAttachments, openExternal: content.openExternal,
      readDocumentOriginal: async raw => { await this.flush(); return content.readDocumentOriginal(quick.assertOriginal(raw)); },
      exportDocumentOriginal: async raw => { await this.flush(); return content.exportDocumentOriginal(quick.assertOriginal(raw)); },
      pendingApprovals: () => engine.pendingApprovals().filter(request => quick.owns(request.threadId)),
      resolveApproval: (rawId, rawAllowed) => {
        const id = z.string().min(1).max(128).parse(rawId), allowed = z.boolean().parse(rawAllowed);
        const request = engine.pendingApprovals().find(request => request.id === id);
        if (!request || !quick.owns(request.threadId)) throw new Error('This approval does not belong to the current quick chat.');
        return engine.resolveApproval(id, allowed);
      },
      finishFlush: (rawToken, rawSaved) => {
        const token = z.uuid().parse(rawToken), saved = z.boolean().parse(rawSaved), pending = this.pending;
        if (!pending || token !== pending.token) return;
        if (!saved) { this.failFlush(new Error('Quick chat input could not be saved. The window has been retained.')); return; }
        clearTimeout(pending.timer); this.pending = undefined; pending.resolve();
      },
      windowAction: async raw => {
        const action = z.enum(['hide', 'pin', 'collapse']).parse(raw);
        if (action === 'hide') await this.hide();
        if (action === 'pin') window.setAlwaysOnTop(!window.isAlwaysOnTop());
        if (action === 'collapse') {
          if (!this.collapsed) this.expandedHeight = window.getSize()[1];
          this.collapsed = !this.collapsed; window.setMinimumSize(420, this.collapsed ? 58 : 360);
          window.setSize(window.getSize()[0], this.collapsed ? 58 : this.expandedHeight);
        }
        return { pinned: window.isAlwaysOnTop(), collapsed: this.collapsed };
      },
    };
    if (typeof command !== 'string' || !Object.hasOwn(commands, command)) throw new Error('Unknown quick-chat action.');
    try { return await commands[command](...args); }
    catch (error) { if (error instanceof z.ZodError) throw new Error('Invalid quick-chat data. Check the input and retry.'); throw error; }
  }
}
