import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { ProjectPreviewSource } from './services/project-preview';

export class ProjectPreviewWindow {
  private current?: { window: BrowserWindow; projectId: string };
  private revision = 0;
  private pendingProjectId?: string;

  async open(parent: BrowserWindow, projectId: string, root: string, input: unknown): Promise<void> {
    const id = randomUUID();
    const revision = ++this.revision; this.pendingProjectId = projectId;
    const source = await ProjectPreviewSource.create(root, input, id);
    if (revision !== this.revision || parent.isDestroyed()) return;
    this.close();
    const preview = new BrowserWindow({ parent, show: false, width: 1000, height: 720, minWidth: 400, minHeight: 300,
      title: `预览 · ${source.path} — Nook`, backgroundColor: '#ffffff', autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
        partition: `nook-preview-${id}`, spellcheck: false, devTools: false, navigateOnDragDrop: false } });
    this.current = { window: preview, projectId };
    const contents = preview.webContents; const session = contents.session;
    preview.on('closed', () => {
      if (this.current?.window === preview) this.current = undefined;
      session.protocol.unhandle('nook-preview');
      void session.clearStorageData().catch(() => {});
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      preview.setMenu(null);
      session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
      session.setPermissionCheckHandler(() => false);
      session.on('will-download', event => event.preventDefault());
      session.webRequest.onBeforeRequest((details, answer) => answer({ cancel: !details.url.startsWith(`${source.origin}/`) }));
      session.protocol.handle('nook-preview', request => source.response(request));
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      await session.setProxy({ mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: '<-loopback>' });
      if (preview.isDestroyed() || this.current?.window !== preview) return;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('will-frame-navigate', event => event.preventDefault());
      contents.on('will-redirect', event => event.preventDefault());
      contents.on('will-attach-webview', event => event.preventDefault());
      contents.on('will-prevent-unload', event => event.preventDefault());
      contents.on('page-title-updated', event => event.preventDefault());
      await Promise.race([contents.loadURL(source.url), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Preview loading timed out.')), 15_000);
      })]);
      if (!preview.isDestroyed() && this.current?.window === preview) { preview.show(); preview.focus(); }
    } catch {
      if (this.current?.window !== preview) return;
      if (!preview.isDestroyed()) preview.destroy();
      throw new Error('The preview could not be opened. Your editor draft is unchanged.');
    } finally { clearTimeout(timer); }
  }

  close(projectId?: string): void {
    if (!projectId || this.pendingProjectId === projectId) { this.revision++; this.pendingProjectId = undefined; }
    if (this.current && (!projectId || this.current.projectId === projectId)) {
      const { window } = this.current; this.current = undefined;
      if (!window.isDestroyed()) window.destroy();
    }
  }
}
