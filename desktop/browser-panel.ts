import { WebContentsView, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { browserActionSchema, browserNavigationAllowed, browserUrl, type BrowserAction, type BrowserState } from '../contracts/browser';
import { previewViewportSchema, type PreviewViewport } from '../contracts/project-preview';

type Panel = { parent: BrowserWindow; view: WebContentsView; state: BrowserState; timer?: ReturnType<typeof setTimeout>; revision: number; request: number; dispose(): void };

/** Website contents have a private transient session and no application preload. */
export class BrowserPanel {
  private current?: Panel;

  open(parent: BrowserWindow): BrowserState {
    if (parent.isDestroyed()) throw new Error('The browser window is unavailable.');
    if (this.current?.parent === parent && !this.current.view.webContents.isDestroyed()) return { ...this.current.state };
    this.close();
    const token = randomUUID();
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, partition: `nook-browser-${token}`, spellcheck: false, devTools: false, navigateOnDragDrop: false } });
    const contents = view.webContents, session = contents.session;
    view.setVisible(false); view.setBackgroundColor('#ffffff');
    const hide = () => { if (this.current === panel) view.setVisible(false); };
    const close = () => this.close(token);
    const navigation = (details: { isSameDocument: boolean; isMainFrame: boolean }) => { if (details.isMainFrame && !details.isSameDocument) close(); };
    const panel: Panel = { parent, view, revision: 0, request: 0, state: { token, sequence: 0, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null, notice: null },
      dispose: () => {
        clearTimeout(panel.timer); panel.revision++;
        parent.removeListener('resize', hide); parent.removeListener('minimize', hide); parent.removeListener('closed', close);
        parent.webContents.removeListener('did-start-navigation', navigation); parent.webContents.removeListener('render-process-gone', close);
        if (!parent.isDestroyed()) parent.contentView.removeChildView(view);
        if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
        void session.clearStorageData().catch(() => {});
      } };
    this.current = panel; parent.contentView.addChildView(view);
    parent.on('resize', hide); parent.on('minimize', hide); parent.on('closed', close);
    parent.webContents.on('did-start-navigation', navigation); parent.webContents.on('render-process-gone', close);
    try {
    const notice = (text: string) => { if (this.current === panel) { panel.state.notice = text; this.publish(panel); } };
    session.setPermissionRequestHandler((_contents, _permission, answer) => { answer(false); notice('网站请求的权限未授予。'); });
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', event => { event.preventDefault(); notice('请在系统浏览器中下载文件。'); });
    session.webRequest.onBeforeRequest((details, answer) => {
      let allowed = false;
      try { allowed = ['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:'].includes(new URL(details.url).protocol); } catch { /* Invalid resource addresses remain blocked. */ }
      answer({ cancel: !allowed });
    });
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.setWindowOpenHandler(() => { notice('请在地址栏打开链接，或使用系统浏览器打开。'); return { action: 'deny' }; });
    const preventNavigation = (event: { preventDefault(): void }, url: string) => { if (!browserNavigationAllowed(url)) { event.preventDefault(); notice('仅支持 HTTP 和 HTTPS 网页。'); } };
    contents.on('will-navigate', preventNavigation); contents.on('will-redirect', preventNavigation);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-prevent-unload', event => event.preventDefault());
    contents.on('before-input-event', (event, key) => {
      if (key.type === 'keyDown' && (key.key === 'F6' || ((key.control || key.meta) && key.key.toLowerCase() === 'l'))) {
        event.preventDefault(); if (!parent.isDestroyed()) { parent.webContents.focus(); parent.webContents.send('qiyao:browser-focus', token); }
      }
    });
    contents.on('did-start-loading', () => { if (this.current === panel) this.startLoading(panel); });
    contents.on('did-stop-loading', () => {
      if (this.current !== panel || contents.isDestroyed()) return;
      clearTimeout(panel.timer); panel.state.loading = false; this.publish(panel);
    });
    contents.on('did-navigate', (_event, url) => { if (this.current === panel && browserNavigationAllowed(url)) { panel.state.url = url; panel.state.error = null; this.publish(panel); } });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame && this.current === panel && browserNavigationAllowed(url)) { panel.state.url = url; this.publish(panel); } });
    contents.on('page-title-updated', (_event, title) => { if (this.current === panel) { panel.state.title = title.slice(0, 500); this.publish(panel); } });
    contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.current === panel && (url === panel.state.url || url === contents.getURL())) this.fail(panel);
    });
    contents.on('render-process-gone', () => { if (this.current === panel) this.fail(panel); });
    return { ...panel.state };
    } catch { this.close(token); throw new Error('The browser could not be opened.'); }
  }

  private publish(panel: Panel): BrowserState {
    panel.state.sequence++;
    const contents = panel.view.webContents;
    if (!contents.isDestroyed()) {
      panel.state.canGoBack = contents.navigationHistory.canGoBack(); panel.state.canGoForward = contents.navigationHistory.canGoForward();
    }
    if (this.current === panel && !panel.parent.isDestroyed()) panel.parent.webContents.send('qiyao:browser-state', { ...panel.state });
    return { ...panel.state };
  }

  private owned(token: string): Panel {
    const panel = this.current;
    if (!panel || panel.state.token !== token || panel.parent.isDestroyed() || panel.view.webContents.isDestroyed()) throw new Error('The browser session is no longer available.');
    return panel;
  }

  private startLoading(panel: Panel): void {
    clearTimeout(panel.timer); panel.state.loading = true; panel.state.error = null; panel.state.notice = null;
    const revision = ++panel.revision;
    panel.timer = setTimeout(() => { if (this.current === panel && panel.revision === revision) { panel.view.webContents.stop(); this.fail(panel); } }, 15_000);
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
      if (this.current === panel && panel.request === request) this.fail(panel);
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
    if (action === 'focus') { if (panel.state.url && !panel.state.error && !contents.isCrashed()) contents.focus(); }
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
    if (this.current && (!token || this.current.state.token === token)) { const panel = this.current; this.current = undefined; panel.dispose(); }
  }
}
