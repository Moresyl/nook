import { WebContentsView, type BrowserWindow, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserActionSchema, browserNavigationAllowed, browserTabLimit, browserUrl, type BrowserAction, type BrowserState, type BrowserShortcut } from '../contracts/browser';
import { previewViewportSchema, type PreviewViewport } from '../contracts/project-preview';

type Panel = { parent: BrowserWindow; view: WebContentsView; state: BrowserState; timer?: ReturnType<typeof setTimeout>; revision: number; request: number; dispose(): void };

/** Website contents have a private transient session and no application preload. */
export class BrowserPanel {
  private panels = new Map<string, Panel>();
  private active?: string;
  private parent?: BrowserWindow;
  private partition?: string;
  private session?: Session;
  private disposeParent?: () => void;
  private get current(): Panel | undefined { return this.active ? this.panels.get(this.active) : undefined; }
  private alive(panel: Panel): boolean { return this.panels.get(panel.state.token) === panel; }

  open(parent: BrowserWindow, fresh = false): BrowserState {
    if (parent.isDestroyed()) throw new Error('The browser window is unavailable.');
    if (!fresh && this.current?.parent === parent && !this.current.view.webContents.isDestroyed()) return { ...this.current.state };
    if (this.parent && this.parent !== parent) this.close();
    if (this.panels.size >= browserTabLimit) throw new Error('Close a browser tab before opening another.');
    const token = randomUUID();
    const partition = this.partition ?? `nook-browser-${token}`, first = !this.session;
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, partition, spellcheck: false, devTools: false, navigateOnDragDrop: false } });
    const contents = view.webContents, session = contents.session;
    view.setVisible(false); view.setBackgroundColor('#ffffff');
    const panel: Panel = { parent, view, revision: 0, request: 0, state: { token, sequence: 0, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, notice: null },
      dispose: () => {
        clearTimeout(panel.timer); panel.revision++;
        if (!parent.isDestroyed()) parent.contentView.removeChildView(view);
        if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
      } };
    this.panels.set(token, panel);
    try {
    this.bindParent(parent, session, partition); parent.contentView.addChildView(view); this.activate(token);
    const notice = (text: string) => { if (this.alive(panel)) { panel.state.notice = text; this.publish(panel); } };
    if (first) {
    const sessionNotice = (sender: Electron.WebContents | null | undefined, text: string) => {
      if (this.session !== session) return;
      const target = [...this.panels.values()].find(item => item.view.webContents === sender) ?? this.current;
      if (target) { target.state.notice = text; this.publish(target); }
    };
    session.setPermissionRequestHandler((sender, _permission, answer) => { answer(false); sessionNotice(sender, '网站请求的权限未授予。'); });
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', (event, _item, sender) => { event.preventDefault(); sessionNotice(sender, '请在系统浏览器中下载文件。'); });
    session.webRequest.onBeforeRequest((details, answer) => {
      let allowed = false;
      try { allowed = ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(new URL(details.url).protocol); } catch { /* Invalid resource addresses remain blocked. */ }
      answer({ cancel: !allowed });
    });
    }
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => { notice('请在地址栏打开链接，或使用系统浏览器打开。'); return { action: 'deny' }; });
    const preventNavigation = (event: { preventDefault(): void }, url: string) => { if (!browserNavigationAllowed(url)) { event.preventDefault(); notice('仅支持 HTTP 和 HTTPS 网页。'); } };
    contents.on('will-navigate', preventNavigation); contents.on('will-redirect', preventNavigation);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-prevent-unload', event => event.preventDefault());
    contents.on('before-input-event', (event, key) => {
      if (this.current === panel && key.type === 'keyDown' && (key.key === 'F6' || ((key.control || key.meta) && key.key.toLowerCase() === 'l'))) {
        event.preventDefault(); if (!parent.isDestroyed()) { parent.webContents.focus(); parent.webContents.send('qiyao:browser-focus', token); }
      }
      if (key.type === 'keyDown' && (key.control || key.meta) && !key.alt && this.current === panel) {
        const action: BrowserShortcut['action'] | null = key.key.toLowerCase() === 't' && !key.shift ? 'new' : key.key.toLowerCase() === 'w' && !key.shift ? 'close' : key.key === 'Tab' ? key.shift ? 'previous' : 'next' : null;
        if (action) { event.preventDefault(); if (!key.isAutoRepeat && !parent.isDestroyed()) { parent.webContents.focus(); parent.webContents.send('qiyao:browser-shortcut', { token, action }); } }
      }
    });
    contents.on('did-start-loading', () => { if (this.alive(panel)) this.startLoading(panel); });
    contents.on('did-stop-loading', () => {
      if (!this.alive(panel) || contents.isDestroyed()) return;
      clearTimeout(panel.timer); panel.state.loading = false; this.publish(panel);
    });
    contents.on('did-navigate', (_event, url) => { if (this.alive(panel) && browserNavigationAllowed(url)) { panel.state.url = url; panel.state.error = null; this.publish(panel); } });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame && this.alive(panel) && browserNavigationAllowed(url)) { panel.state.url = url; this.publish(panel); } });
    contents.on('page-title-updated', (_event, title) => { if (this.alive(panel)) { panel.state.title = title.slice(0, 500); this.publish(panel); } });
    contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.alive(panel) && (url === panel.state.url || url === contents.getURL())) this.fail(panel);
    });
    contents.on('render-process-gone', () => { if (this.alive(panel)) this.fail(panel); });
    return { ...panel.state };
    } catch { this.close(token); throw new Error('The browser could not be opened.'); }
  }

  private bindParent(parent: BrowserWindow, session: Session, partition: string): void {
    if (this.parent) return;
    this.parent = parent; this.session = session; this.partition = partition;
    const hide = () => { for (const panel of this.panels.values()) panel.view.setVisible(false); };
    const close = () => this.close();
    const navigation = (details: { isSameDocument: boolean; isMainFrame: boolean }) => { if (details.isMainFrame && !details.isSameDocument) close(); };
    parent.on('resize', hide); parent.on('minimize', hide); parent.on('closed', close);
    parent.webContents.on('did-start-navigation', navigation); parent.webContents.on('render-process-gone', close);
    this.disposeParent = () => {
      parent.removeListener('resize', hide); parent.removeListener('minimize', hide); parent.removeListener('closed', close);
      parent.webContents.removeListener('did-start-navigation', navigation); parent.webContents.removeListener('render-process-gone', close);
      session.removeAllListeners('will-download'); session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null); session.webRequest.onBeforeRequest(null);
      void session.clearStorageData().catch(() => {});
    };
  }

  activate(token: string): BrowserState {
    const panel = this.owned(token);
    for (const item of this.panels.values()) item.view.setVisible(false);
    this.active = token;
    return this.publish(panel);
  }

  private publish(panel: Panel): BrowserState {
    panel.state.sequence++;
    const contents = panel.view.webContents;
    if (!contents.isDestroyed()) {
      panel.state.canGoBack = contents.navigationHistory.canGoBack(); panel.state.canGoForward = contents.navigationHistory.canGoForward();
    }
    if (this.alive(panel) && !panel.parent.isDestroyed()) panel.parent.webContents.send('qiyao:browser-state', { ...panel.state });
    return { ...panel.state };
  }

  private owned(token: string): Panel {
    const panel = this.panels.get(token);
    if (!panel || panel.state.token !== token || panel.parent.isDestroyed() || panel.view.webContents.isDestroyed()) throw new Error('The browser session is no longer available.');
    return panel;
  }

  private startLoading(panel: Panel): void {
    clearTimeout(panel.timer); panel.state.loading = true; panel.state.error = null; panel.state.notice = null;
    const revision = ++panel.revision;
    panel.timer = setTimeout(() => { if (this.alive(panel) && panel.revision === revision) { panel.view.webContents.stop(); this.fail(panel); } }, 15_000);
    this.publish(panel);
  }

  private fail(panel: Panel): void {
    clearTimeout(panel.timer); panel.state.loading = false; panel.state.error = '网页无法加载，请检查地址或重试。'; panel.view.setVisible(false); this.publish(panel);
  }

  navigate(token: string, input: unknown): BrowserState {
    const url = browserUrl(input), panel = this.owned(token);
    panel.state.url = url; panel.state.title = ''; this.startLoading(panel);
    const request = ++panel.request;
    void panel.view.webContents.loadURL(url).catch(error => {
      if (error?.code === 'ERR_ABORTED' || error?.errno === -3) return;
      if (this.alive(panel) && panel.request === request) this.fail(panel);
    });
    return { ...panel.state };
  }

  action(token: string, raw: BrowserAction): BrowserState {
    const action = browserActionSchema.parse(raw), panel = this.owned(token), contents = panel.view.webContents;
    if (action === 'stop') {
      clearTimeout(panel.timer); panel.revision++; panel.request++; contents.stop(); panel.state.loading = false;
      const url = contents.getURL();
      panel.state.url = browserNavigationAllowed(url) ? url : '';
      panel.state.title = panel.state.url ? contents.getTitle().slice(0, 500) : '';
    }
    if (action === 'focus') { if (this.current === panel && panel.state.url && !panel.state.error && !contents.isCrashed()) contents.focus(); }
    if (action === 'back' && contents.navigationHistory.canGoBack()) { panel.request++; this.startLoading(panel); contents.navigationHistory.goBack(); }
    if (action === 'forward' && contents.navigationHistory.canGoForward()) { panel.request++; this.startLoading(panel); contents.navigationHistory.goForward(); }
    if (action === 'reload' && panel.state.url) return this.navigate(token, panel.state.url);
    return this.publish(panel);
  }

  layout(token: string, raw: PreviewViewport | null): void {
    const panel = this.current;
    if (!panel || panel.state.token !== token || panel.parent.isDestroyed()) return;
    const viewport = raw === null ? null : previewViewportSchema.parse(raw), { parent, view, state } = panel;
    if (!viewport || !state.url || state.error || parent.isMinimized() || view.webContents.isDestroyed() || view.webContents.isCrashed()) { view.setVisible(false); return; }
    const zoom = parent.webContents.getZoomFactor(), [width, height] = parent.getContentSize();
    const x = Math.max(0, Math.ceil(viewport.x * zoom)), y = Math.max(0, Math.ceil(viewport.y * zoom));
    const right = Math.min(width, Math.floor((viewport.x + viewport.width) * zoom)), bottom = Math.min(height, Math.floor((viewport.y + viewport.height) * zoom));
    if (right <= x || bottom <= y) { view.setVisible(false); return; }
    view.setBounds({ x, y, width: right - x, height: bottom - y }); view.setVisible(true);
  }

  close(token?: string): void {
    if (!token) { for (const key of [...this.panels.keys()]) this.close(key); return; }
    const panel = this.panels.get(token); if (!panel) return;
    const index = [...this.panels.keys()].indexOf(token); this.panels.delete(token); panel.dispose();
    if (this.active === token) this.active = [...this.panels.keys()][Math.min(index, this.panels.size - 1)];
    if (!this.panels.size) { this.disposeParent?.(); this.disposeParent = undefined; this.parent = undefined; this.partition = undefined; this.session = undefined; this.active = undefined; }
  }
}
