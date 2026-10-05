import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ProjectPreviewWindow } from '../desktop/project-preview-window';

const fake = vi.hoisted(() => ({ windows: [] as any[], load: vi.fn(), create: vi.fn(), proxy: vi.fn() }));
vi.mock('../desktop/services/project-preview', () => ({ ProjectPreviewSource: { create: fake.create } }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    destroyed = false;
    webContents: any;
    show = vi.fn(); focus = vi.fn(); setMenu = vi.fn();
    constructor(readonly options: unknown) {
      super();
      const session = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
        webRequest: { onBeforeRequest: vi.fn() }, protocol: { handle: vi.fn(), unhandle: vi.fn() },
        clearStorageData: vi.fn().mockResolvedValue(undefined), setProxy: fake.proxy });
      this.webContents = Object.assign(new EventEmitter(), { session, setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(), loadURL: fake.load });
      fake.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { BrowserWindow: Window };
});
const source = { origin: 'nook-preview://owned', url: 'nook-preview://owned/index.html', path: 'index.html', response: vi.fn() };
const parent = { isDestroyed: () => false } as BrowserWindow;
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fake.windows.length = 0; fake.create.mockResolvedValue(source); fake.load.mockResolvedValue(undefined); fake.proxy.mockResolvedValue(undefined); });

describe('project preview lifecycle', () => {
  it('creates a separate sandbox with no preload, denies permissions, outside resources and navigation, and cleans up', async () => {
    const manager = new ProjectPreviewWindow(); await manager.open(parent, 'project', '/project', {});
    const window = fake.windows[0]; const contents = window.webContents; const session = contents.session;
    expect(window.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, webviewTag: false });
    expect(window.options.webPreferences.preload).toBeUndefined(); expect(window.options.webPreferences.partition).not.toContain('persist:');
    expect(window.show).toHaveBeenCalledOnce(); expect(window.focus).toHaveBeenCalledOnce();
    const permission = vi.fn(); session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', permission); expect(permission).toHaveBeenCalledWith(false);
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    for (const [url, cancel] of [['https://example.com', true], ['file:///secret', true], ['qiyao://app', true], ['nook-preview://owned.evil/index.html', true], [source.url, false]]) {
      const answer = vi.fn(); session.webRequest.onBeforeRequest.mock.calls[0][0]({ url }, answer); expect(answer).toHaveBeenCalledWith({ cancel });
    }
    expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview', 'will-prevent-unload', 'page-title-updated']) { const event = { preventDefault: vi.fn() }; contents.emit(name, event); expect(event.preventDefault).toHaveBeenCalledOnce(); }
    const download = { preventDefault: vi.fn() }; session.emit('will-download', download); expect(download.preventDefault).toHaveBeenCalledOnce();
    manager.close('other'); expect(window.destroyed).toBe(false);
    manager.close('project'); expect(window.destroyed).toBe(true); expect(session.protocol.unhandle).toHaveBeenCalledWith('nook-preview'); expect(session.clearStorageData).toHaveBeenCalledOnce(); manager.close();
  });

  it('preserves the old preview on invalid input and replaces it after valid preparation', async () => {
    const manager = new ProjectPreviewWindow(); await manager.open(parent, 'one', '/one', {}); const old = fake.windows[0];
    fake.create.mockRejectedValueOnce(new Error('Invalid file')); await expect(manager.open(parent, 'two', '/two', {})).rejects.toThrow('Invalid file'); expect(old.destroyed).toBe(false);
    await manager.open(parent, 'two', '/two', {}); expect(old.destroyed).toBe(true); expect(fake.windows).toHaveLength(2); manager.close();
  });

  it('discards a stale pending request and does not reopen a removed project or destroyed parent', async () => {
    const manager = new ProjectPreviewWindow(); let finish!: (value: unknown) => void;
    fake.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = manager.open(parent, 'old', '/old', {}); await manager.open(parent, 'new', '/new', {}); finish(source); await old;
    expect(fake.windows).toHaveLength(1); manager.close();
    fake.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const pending = manager.open(parent, 'removed', '/removed', {});
    manager.close('removed'); finish(source); await pending; expect(fake.windows).toHaveLength(1);
    await manager.open({ isDestroyed: () => true } as BrowserWindow, 'gone', '/gone', {}); expect(fake.windows).toHaveLength(1);
  });

  it('destroys a failed load and setup failure, and allows retry', async () => {
    const manager = new ProjectPreviewWindow(); fake.load.mockRejectedValueOnce(new Error('Private detail'));
    await expect(manager.open(parent, 'one', '/one', {})).rejects.toThrow('Your editor draft is unchanged'); expect(fake.windows[0].destroyed).toBe(true);
    fake.proxy.mockRejectedValueOnce(new Error('Setup failed')); await expect(manager.open(parent, 'one', '/one', {})).rejects.toThrow('could not be opened'); expect(fake.windows[1].destroyed).toBe(true);
    await manager.open(parent, 'one', '/one', {}); expect(fake.windows[2].show).toHaveBeenCalledOnce(); manager.close();
  });

  it('bounds a non-loading document without allowing unload handlers to keep it alive', async () => {
    vi.useFakeTimers(); const manager = new ProjectPreviewWindow(); fake.load.mockReturnValueOnce(new Promise(() => {}));
    const pending = expect(manager.open(parent, 'one', '/one', {})).rejects.toThrow('could not be opened');
    await vi.advanceTimersByTimeAsync(15_000); await pending; expect(fake.windows[0].destroyed).toBe(true); vi.useRealTimers();
  });
});
