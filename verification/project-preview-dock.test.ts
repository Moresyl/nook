import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ProjectPreviewDock } from '../desktop/project-preview-dock';

const fake = vi.hoisted(() => ({ views: [] as any[], create: vi.fn(), load: vi.fn(), proxy: vi.fn() }));
vi.mock('../desktop/services/project-preview', () => ({ ProjectPreviewSource: { create: fake.create } }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class View {
    setVisible = vi.fn(); setBounds = vi.fn(); setBackgroundColor = vi.fn();
    webContents: any;
    constructor(readonly options: any) {
      const session = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() }, protocol: { handle: vi.fn(), unhandle: vi.fn() }, setProxy: fake.proxy, clearStorageData: vi.fn().mockResolvedValue(undefined) });
      this.webContents = Object.assign(new EventEmitter(), { session, destroyed: false, crashed: false, setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(), loadURL: fake.load,
        isDestroyed() { return this.destroyed; }, isCrashed() { return this.crashed; }, close: vi.fn(() => { this.webContents.destroyed = true; }) });
      fake.views.push(this);
    }
  }
  return { WebContentsView: View };
});
const source = { origin: 'nook-preview://owned', url: 'nook-preview://owned/index.html', response: vi.fn() };
function parentWindow(zoom = 1) {
  return Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false), getContentSize: () => [800, 600],
    webContents: { getZoomFactor: () => zoom, focus: vi.fn(), send: vi.fn() }, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } });
}
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fake.views.length = 0; fake.create.mockResolvedValue(source); fake.load.mockResolvedValue(undefined); fake.proxy.mockResolvedValue(undefined); });

describe('isolated docked project preview', () => {
  it('loads in a hidden private sandbox and denies outside resources, permissions and child navigation', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(); const token = await manager.open(parent as unknown as BrowserWindow, 'project', '/project', {});
    expect(token).toMatch(/^[a-f0-9-]{36}$/); const view = fake.views[0], contents = view.webContents, session = contents.session;
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
    expect(view.options.webPreferences.preload).toBeUndefined(); expect(view.options.webPreferences.partition).toBe(`nook-preview-${token}`);
    expect(view.setVisible).toHaveBeenLastCalledWith(false); expect(parent.contentView.addChildView).toHaveBeenCalledWith(view);
    const check = session.webRequest.onBeforeRequest.mock.calls[0][0];
    for (const [url, cancel] of [[source.url, false], ['https://example.com', true], ['qiyao://app', true], ['file:///private', true], ['nook-preview://owned.evil/index.html', true]]) { const answer = vi.fn(); check({ url }, answer); expect(answer).toHaveBeenCalledWith({ cancel }); }
    const permission = vi.fn(); session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', permission); expect(permission).toHaveBeenCalledWith(false);
    expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview', 'will-prevent-unload']) { const preventDefault = vi.fn(); contents.emit(event, { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce(); }
    manager.close(); expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false }); expect(session.protocol.unhandle).toHaveBeenCalledWith('nook-preview'); expect(session.clearStorageData).toHaveBeenCalledOnce(); expect(parent.listenerCount('resize')).toBe(0);
  });

  it.each([1, 1.25, 1.5])('converts CSS geometry at zoom %s, clips native bounds, hides and rejects malformed rectangles', async zoom => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(zoom); const token = (await manager.open(parent as unknown as BrowserWindow, 'project', '/project', {}))!; const view = fake.views[0];
    manager.layout('project', token, { x: 10.2, y: 20.1, width: 900, height: 700 });
    const x = Math.ceil(10.2 * zoom), y = Math.ceil(20.1 * zoom);
    expect(view.setBounds).toHaveBeenCalledWith({ x, y, width: 800 - x, height: 600 - y }); expect(view.setVisible).toHaveBeenLastCalledWith(true);
    manager.layout('project', token, null); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    for (const x of [-1, NaN, Infinity, 32769]) expect(() => manager.layout('project', token, { x, y: 0, width: 10, height: 10 })).toThrow();
    manager.layout('project', token, { x: 1000, y: 0, width: 100, height: 100 }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.layout('other', token, { x: 0, y: 0, width: 100, height: 100 }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.close();
  });

  it('does not let stale layout/close calls affect a replacement surface', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(); const first = (await manager.open(parent as unknown as BrowserWindow, 'one', '/one', {}))!;
    const second = (await manager.open(parent as unknown as BrowserWindow, 'one', '/one', {}))!; expect(second).not.toBe(first); expect(fake.views[0].webContents.isDestroyed()).toBe(true);
    manager.layout('one', first, { x: 0, y: 0, width: 300, height: 200 }); manager.close('one', first);
    expect(fake.views[1].webContents.isDestroyed()).toBe(false); expect(fake.views[1].setBounds).not.toHaveBeenCalled(); manager.close('one', second); manager.close();
  });

  it('cancels pending work on project removal and discards a superseded preparation', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(); let finish!: (value: unknown) => void;
    fake.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = manager.open(parent as unknown as BrowserWindow, 'old', '/old', {}); await manager.open(parent as unknown as BrowserWindow, 'new', '/new', {}); finish(source);
    expect(await old).toBeNull(); expect(fake.views).toHaveLength(1);
    fake.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const removed = manager.open(parent as unknown as BrowserWindow, 'removed', '/removed', {});
    manager.close('removed'); finish(source); expect(await removed).toBeNull(); expect(fake.views).toHaveLength(1); manager.close();
    parent.isDestroyed.mockReturnValue(true); expect(await manager.open(parent as unknown as BrowserWindow, 'gone', '/gone', {})).toBeNull(); expect(fake.views).toHaveLength(1);
  });

  it('never shows a pending load and cannot resurrect it after the owner closes', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(); let finish!: () => void;
    fake.load.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const opening = manager.open(parent as unknown as BrowserWindow, 'project', '/project', {});
    await vi.waitFor(() => expect(fake.load).toHaveBeenCalledOnce());
    const view = fake.views[0], token = view.options.webPreferences.partition.slice('nook-preview-'.length);
    manager.layout('project', token, { x: 0, y: 0, width: 100, height: 100 }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.close('project'); finish(); expect(await opening).toBeNull(); expect(view.webContents.close).toHaveBeenCalledOnce(); expect(parent.listenerCount('closed')).toBe(0);
  });

  it('hides on resize/minimize, restores explicitly, returns keyboard focus and reports a crash', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow(); const token = (await manager.open(parent as unknown as BrowserWindow, 'project', '/project', {}))!; const view = fake.views[0]; const rect = { x: 0, y: 0, width: 100, height: 100 };
    manager.layout('project', token, rect); parent.emit('resize'); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.layout('project', token, rect); expect(view.setVisible).toHaveBeenLastCalledWith(true);
    parent.isMinimized.mockReturnValue(true); manager.layout('project', token, rect); expect(view.setVisible).toHaveBeenLastCalledWith(false); parent.isMinimized.mockReturnValue(false);
    const preventDefault = vi.fn(); view.webContents.emit('before-input-event', { preventDefault }, { type: 'keyDown', key: 'Escape' }); expect(preventDefault).toHaveBeenCalledOnce(); expect(parent.webContents.focus).toHaveBeenCalledOnce();
    view.webContents.crashed = true; view.webContents.emit('render-process-gone'); expect(parent.webContents.send).toHaveBeenCalledWith('qiyao:preview-failed', token);
    manager.layout('project', token, rect); expect(view.setVisible).toHaveBeenLastCalledWith(false); parent.emit('closed'); expect(view.webContents.isDestroyed()).toBe(true); expect(parent.contentView.removeChildView).toHaveBeenCalledOnce();
  });

  it('cleans up failed loading/setup and accepts retry without exposing private errors', async () => {
    const manager = new ProjectPreviewDock(), parent = parentWindow();
    fake.proxy.mockRejectedValueOnce(new Error('PRIVATE_PROXY_DETAIL')); await expect(manager.open(parent as unknown as BrowserWindow, 'project', '/project', {})).rejects.toThrow('Your editor draft is unchanged'); expect(fake.views[0].webContents.isDestroyed()).toBe(true);
    fake.load.mockRejectedValueOnce(new Error('PRIVATE_FILE_DETAIL')); await expect(manager.open(parent as unknown as BrowserWindow, 'project', '/project', {})).rejects.toThrow('Your editor draft is unchanged'); expect(fake.views[1].webContents.isDestroyed()).toBe(true);
    expect(await manager.open(parent as unknown as BrowserWindow, 'project', '/project', {})).toBeTruthy(); manager.close();
  });

  it('bounds a never-loading preview and releases all parent listeners', async () => {
    vi.useFakeTimers(); const manager = new ProjectPreviewDock(), parent = parentWindow(); fake.load.mockReturnValueOnce(new Promise(() => {}));
    const pending = expect(manager.open(parent as unknown as BrowserWindow, 'project', '/project', {})).rejects.toThrow('could not be opened');
    await vi.advanceTimersByTimeAsync(15_000); await pending; expect(fake.views[0].webContents.isDestroyed()).toBe(true); expect(parent.listenerCount('closed')).toBe(0); vi.useRealTimers();
  });
});
