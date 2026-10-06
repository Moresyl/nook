import { WebContentsView, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { previewViewportSchema, type PreviewViewport } from '../contracts/project-preview';
import { ProjectPreviewSource } from './services/project-preview';
import { configureProjectPreview } from './project-preview-session';

type OwnedPreview = { projectId: string; token: string };
type Dock = OwnedPreview & { parent: BrowserWindow; view: WebContentsView; ready: boolean; dispose(): void };

/** An embedded preview keeps its own session and never receives the application preload. */
export class ProjectPreviewDock {
  private current?: Dock;
  private pending?: OwnedPreview;

  async open(parent: BrowserWindow, projectId: string, root: string, input: unknown): Promise<string | null> {
    const owner = { projectId, token: randomUUID() }; this.pending = owner;
    const source = await ProjectPreviewSource.create(root, input, owner.token);
    if (this.pending !== owner || parent.isDestroyed()) return null;
    const previous = this.current;
    if (previous) this.close(previous.projectId, previous.token);
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      webviewTag: false, partition: `nook-preview-${owner.token}`, spellcheck: false, devTools: false, navigateOnDragDrop: false } });
    const contents = view.webContents, session = contents.session;
    view.setVisible(false); view.setBackgroundColor('#ffffff');
    const hide = () => { if (this.current?.view === view) view.setVisible(false); };
    const close = () => this.close(projectId, owner.token);
    const dock: Dock = { ...owner, parent, view, ready: false, dispose: () => {
      parent.removeListener('resize', hide); parent.removeListener('minimize', hide); parent.removeListener('closed', close);
      if (!parent.isDestroyed()) parent.contentView.removeChildView(view);
      if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
      session.protocol.unhandle('nook-preview'); void session.clearStorageData().catch(() => {});
    } };
    this.current = dock; parent.contentView.addChildView(view);
    parent.on('resize', hide); parent.on('minimize', hide); parent.on('closed', close);
    contents.on('before-input-event', (event, key) => {
      if (key.type === 'keyDown' && (key.key === 'Escape' || key.key === 'F6')) { event.preventDefault(); if (!parent.isDestroyed()) parent.webContents.focus(); }
    });
    contents.on('render-process-gone', () => { hide(); if (this.current === dock && !parent.isDestroyed()) parent.webContents.send('qiyao:preview-failed', owner.token); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await configureProjectPreview(contents, source);
      if (this.current !== dock || contents.isDestroyed()) return null;
      await Promise.race([contents.loadURL(source.url), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Preview loading timed out.')), 15_000); })]);
      if (this.current !== dock || contents.isDestroyed()) return null;
      dock.ready = true; return owner.token;
    } catch {
      if (this.current !== dock) return null;
      this.close(projectId, owner.token);
      throw new Error('The preview could not be opened. Your editor draft is unchanged.');
    } finally { clearTimeout(timer); if (this.pending === owner) this.pending = undefined; }
  }

  layout(projectId: string, token: string, raw: PreviewViewport | null): void {
    const dock = this.current;
    if (!dock || dock.projectId !== projectId || dock.token !== token || dock.parent.isDestroyed()) return;
    const viewport = raw === null ? null : previewViewportSchema.parse(raw);
    const { view, parent } = dock;
    if (!viewport || !dock.ready || parent.isMinimized() || view.webContents.isDestroyed() || view.webContents.isCrashed()) { view.setVisible(false); return; }
    const zoom = parent.webContents.getZoomFactor(), [width, height] = parent.getContentSize();
    const x = Math.max(0, Math.ceil(viewport.x * zoom)), y = Math.max(0, Math.ceil(viewport.y * zoom));
    const right = Math.min(width, Math.floor((viewport.x + viewport.width) * zoom));
    const bottom = Math.min(height, Math.floor((viewport.y + viewport.height) * zoom));
    if (right <= x || bottom <= y) { view.setVisible(false); return; }
    view.setBounds({ x, y, width: right - x, height: bottom - y }); view.setVisible(true);
  }

  close(projectId?: string, token?: string): void {
    const matches = (owner: OwnedPreview) => (!projectId || owner.projectId === projectId) && (!token || owner.token === token);
    if (this.pending && matches(this.pending)) this.pending = undefined;
    if (this.current && matches(this.current)) { const dock = this.current; this.current = undefined; dock.dispose(); }
  }
}
