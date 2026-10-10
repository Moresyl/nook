import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { browserNavigationAllowed, browserTabLimit, browserUrl } from '../contracts/browser';

const fake = vi.hoisted(() => ({ views: [] as any[], sessions: new Map<string, any>(), load: vi.fn(), clear: vi.fn() }));
vi.mock('electron', () => ({ WebContentsView: class {
  options: any; webContents: any; setVisible = vi.fn(); setBounds = vi.fn(); setBackgroundColor = vi.fn();
  constructor(options: any) {
    this.options = options;
    const partition = options.webPreferences.partition;
    const session = fake.sessions.get(partition) ?? Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), clearStorageData: fake.clear, webRequest: { onBeforeRequest: vi.fn() } }); fake.sessions.set(partition, session);
    this.webContents = Object.assign(new EventEmitter(), { session, destroyed: false, crashed: false,
      isDestroyed() { return this.destroyed; }, isCrashed() { return this.crashed; },
      navigationHistory: { canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false), goBack: vi.fn(), goForward: vi.fn() },
      getURL: vi.fn(() => ''), getTitle: vi.fn(() => ''), setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn(), loadURL: fake.load, stop: vi.fn(), focus: vi.fn(),
      close: vi.fn(() => { this.webContents.destroyed = true; }),
    }); fake.views.push(this);
  }
} }));
import { BrowserPanel } from '../desktop/browser-panel';

function parentWindow(zoom = 1) {
  return Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false), getContentSize: () => [800, 600],
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => zoom, focus: vi.fn(), send: vi.fn() }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } });
}
let manager: BrowserPanel;
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fake.views.length = 0; fake.sessions.clear(); fake.load.mockResolvedValue(undefined); fake.clear.mockResolvedValue(undefined); manager = new BrowserPanel(); });
afterEach(() => { manager.close(); vi.useRealTimers(); });

describe('browser addresses', () => {
  it('normalizes literal HTTP(S) addresses, Unicode hosts and spaces', () => {
    expect(browserUrl(' https://例子.测试/a b?q=中文#段落 ')).toBe(new URL('https://例子.测试/a b?q=中文#段落').href);
    expect(browserUrl('http://127.0.0.1:4567/path')).toBe('http://127.0.0.1:4567/path');
    expect(browserNavigationAllowed('https://example.com')).toBe(true);
  });
  it.each(['file:///private', 'qiyao://app/index.html', 'javascript:alert(1)', 'data:text/html,secret', 'ftp://example.com', 'https://user:secret@example.com', 'https://user@example.com', '', 'example.com', 'https://' ])('rejects unsupported or credential-bearing input %s', text => {
    expect(() => browserUrl(text)).toThrow(); expect(browserNavigationAllowed(text)).toBe(false);
  });
  it('rejects nonstrings and excessive input', () => { for (const value of [null, {}, 5, 'https://example.com/' + 'a'.repeat(8192)]) expect(() => browserUrl(value)).toThrow(); });
});

describe('isolated website panel', () => {
  it('keeps multiple live tabs, shared transient storage and independent URL/history/title state', () => {
    const parent = parentWindow(), first = manager.open(parent as unknown as BrowserWindow), second = manager.open(parent as unknown as BrowserWindow, true);
    expect(second.token).not.toBe(first.token); expect(fake.views).toHaveLength(2);
    expect(fake.views[0].options.webPreferences.partition).toBe(fake.views[1].options.webPreferences.partition);
    expect(fake.views[0].webContents.session).toBe(fake.views[1].webContents.session);
    manager.navigate(first.token, 'https://first.example'); manager.navigate(second.token, 'https://second.example');
    fake.views[0].webContents.emit('page-title-updated', {}, 'First'); fake.views[1].webContents.emit('page-title-updated', {}, 'Second');
    expect(manager.open(parent as unknown as BrowserWindow)).toMatchObject({ token: second.token, title: 'Second' });
    expect(manager.activate(first.token)).toMatchObject({ token: first.token, title: 'First', url: 'https://first.example/' });
    expect(fake.views.every(view => !view.webContents.destroyed)).toBe(true);
    expect(parent.listenerCount('resize')).toBe(1); expect(parent.webContents.listenerCount('did-start-navigation')).toBe(1);
  });
  it('shows only the selected owner and ignores old layout/focus requests after switching', () => {
    const parent = parentWindow(), first = manager.open(parent as unknown as BrowserWindow), second = manager.open(parent as unknown as BrowserWindow, true), bounds = { x: 0, y: 0, width: 300, height: 200 };
    manager.navigate(first.token, 'https://first.example'); manager.navigate(second.token, 'https://second.example');
    manager.layout(second.token, bounds); expect(fake.views[1].setVisible).toHaveBeenLastCalledWith(true);
    manager.activate(first.token); expect(fake.views[1].setVisible).toHaveBeenLastCalledWith(false); manager.layout(first.token, bounds);
    manager.layout(second.token, bounds); manager.action(second.token, 'focus');
    expect(fake.views[1].setVisible).toHaveBeenLastCalledWith(false); expect(fake.views[1].webContents.focus).not.toHaveBeenCalled(); expect(fake.views[0].setVisible).toHaveBeenLastCalledWith(true);
    expect(() => manager.activate('stale')).toThrow('no longer available');
  });
  it('retains shared storage on one-tab close, selects a neighbor and resets it after the last tab', () => {
    const parent = parentWindow(), first = manager.open(parent as unknown as BrowserWindow), middle = manager.open(parent as unknown as BrowserWindow, true), last = manager.open(parent as unknown as BrowserWindow, true);
    const partition = fake.views[0].options.webPreferences.partition; manager.activate(middle.token); manager.close(middle.token);
    expect(manager.open(parent as unknown as BrowserWindow).token).toBe(last.token); expect(fake.clear).not.toHaveBeenCalled(); expect(fake.views[0].webContents.isDestroyed()).toBe(false);
    manager.close(last.token); expect(manager.open(parent as unknown as BrowserWindow).token).toBe(first.token); expect(fake.clear).not.toHaveBeenCalled();
    manager.close(first.token); expect(fake.clear).toHaveBeenCalledOnce(); expect(parent.listenerCount('closed')).toBe(0);
    const fresh = manager.open(parent as unknown as BrowserWindow); expect(fake.views[3].options.webPreferences.partition).not.toBe(partition); manager.close(first.token); expect(manager.open(parent as unknown as BrowserWindow).token).toBe(fresh.token);
  });
  it.each(['closed', 'reload', 'crash'])('releases every tab, one session and owned listeners on %s', reason => {
    const parent = parentWindow(); const tokens = Array.from({ length: 3 }, () => manager.open(parent as unknown as BrowserWindow, true).token);
    if (reason === 'closed') parent.emit('closed'); else if (reason === 'reload') parent.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true }); else parent.webContents.emit('render-process-gone');
    expect(fake.views.every(view => view.webContents.isDestroyed())).toBe(true); expect(fake.clear).toHaveBeenCalledOnce(); expect(parent.listenerCount('resize')).toBe(0);
    for (const token of tokens) expect(() => manager.activate(token)).toThrow('no longer available');
  });
  it('attributes background updates/permission denial to their tab and discards old-session callbacks', () => {
    const parent = parentWindow(), first = manager.open(parent as unknown as BrowserWindow), second = manager.open(parent as unknown as BrowserWindow, true), session = fake.views[0].webContents.session;
    const permission = session.setPermissionRequestHandler.mock.calls[0][0], answer = vi.fn(); permission(fake.views[0].webContents, 'camera', answer);
    expect(answer).toHaveBeenCalledWith(false); expect(parent.webContents.send).toHaveBeenLastCalledWith('qiyao:browser-state', expect.objectContaining({ token: first.token, notice: '网站请求的权限未授予。' }));
    expect(manager.open(parent as unknown as BrowserWindow).token).toBe(second.token);
    manager.close(); manager.open(parent as unknown as BrowserWindow); parent.webContents.send.mockClear(); permission(fake.views[0].webContents, 'camera', answer);
    expect(parent.webContents.send).not.toHaveBeenCalled();
  });
  it('forwards create/close/cycle shortcuts only from the selected native tab and ignores repeats/key-up', () => {
    const parent = parentWindow(), first = manager.open(parent as unknown as BrowserWindow), second = manager.open(parent as unknown as BrowserWindow, true);
    parent.webContents.send.mockClear(); const oldPrevent = vi.fn(); fake.views[0].webContents.emit('before-input-event', { preventDefault: oldPrevent }, { type: 'keyDown', key: 't', control: true }); expect(oldPrevent).not.toHaveBeenCalled();
    for (const [key, shift, action] of [['t', false, 'new'], ['w', false, 'close'], ['Tab', false, 'next'], ['Tab', true, 'previous']] as const) {
      const preventDefault = vi.fn(); fake.views[1].webContents.emit('before-input-event', { preventDefault }, { type: 'keyDown', key, shift, control: true }); expect(preventDefault).toHaveBeenCalledOnce(); expect(parent.webContents.send).toHaveBeenLastCalledWith('qiyao:browser-shortcut', { token: second.token, action });
    }
    const count = parent.webContents.send.mock.calls.length; for (const extra of [{ type: 'keyUp' }, { type: 'keyDown', isAutoRepeat: true }, { type: 'keyDown', alt: true }]) fake.views[1].webContents.emit('before-input-event', { preventDefault: vi.fn() }, { key: 't', control: true, ...extra }); expect(parent.webContents.send.mock.calls).toHaveLength(count); expect(first.token).not.toBe(second.token);
  });
  it('bounds tab creation without replacing existing pages or multiplying parent listeners', () => {
    const parent = parentWindow(); for (let index = 0; index < browserTabLimit; index++) manager.open(parent as unknown as BrowserWindow, true);
    const token = manager.open(parent as unknown as BrowserWindow).token; expect(() => manager.open(parent as unknown as BrowserWindow, true)).toThrow('Close a browser tab');
    expect(fake.views).toHaveLength(browserTabLimit); expect(fake.views.every(view => !view.webContents.isDestroyed())).toBe(true); expect(parent.listenerCount('resize')).toBe(1);
    expect(manager.open(parent as unknown as BrowserWindow).token).toBe(token);
  });
  it('creates a hidden no-preload private sandbox, reuses its owner and returns state copies', () => {
    const parent = parentWindow(), state = manager.open(parent as unknown as BrowserWindow), view = fake.views[0];
    expect(state.token).toMatch(/^[a-f0-9-]{36}$/);
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, partition: `nook-browser-${state.token}` });
    expect(view.options.webPreferences.preload).toBeUndefined(); expect(fake.load).not.toHaveBeenCalled(); expect(view.setVisible).toHaveBeenCalledWith(false);
    state.url = 'changed'; expect(manager.open(parent as unknown as BrowserWindow).url).toBe(''); expect(fake.views).toHaveLength(1);
    expect(parent.contentView.addChildView).toHaveBeenCalledWith(view);
  });
  it('denies permissions, downloads, child windows and private resource schemes while allowing web resources', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), { webContents: contents } = fake.views[0], session = contents.session;
    const reply = vi.fn(); session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', reply); expect(reply).toHaveBeenCalledWith(false);
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    const preventDefault = vi.fn(); session.emit('will-download', { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce();
    expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const check = session.webRequest.onBeforeRequest.mock.calls[0][0];
    for (const [url, cancel] of [['https://example.com/a', false], ['http://127.0.0.1/a', false], ['wss://example.com', false], ['blob:https://example.com/owned', false], ['data:image/png;base64,AA', false], ['file:///private', true], ['qiyao://app/index.html', true], ['invalid', true]]) {
      const answer = vi.fn(); check({ url }, answer); expect(answer).toHaveBeenCalledWith({ cancel });
    }
    expect(parent.webContents.send).toHaveBeenCalledWith('qiyao:browser-state', expect.objectContaining({ token, notice: expect.any(String) }));
  });
  it('blocks unsafe navigation/redirect and webviews, bypasses unload traps and restores the address field shortcut', () => {
    const parent = parentWindow(); manager.open(parent as unknown as BrowserWindow); const contents = fake.views[0].webContents;
    for (const name of ['will-navigate', 'will-redirect']) {
      const preventDefault = vi.fn(); contents.emit(name, { preventDefault }, 'file:///private'); expect(preventDefault).toHaveBeenCalledOnce();
      contents.emit(name, { preventDefault }, 'https://example.com'); expect(preventDefault).toHaveBeenCalledOnce();
    }
    for (const name of ['will-attach-webview', 'will-prevent-unload']) { const preventDefault = vi.fn(); contents.emit(name, { preventDefault }); expect(preventDefault).toHaveBeenCalledOnce(); }
    for (const key of [{ key: 'F6' }, { key: 'l', control: true }, { key: 'L', meta: true }]) {
      const preventDefault = vi.fn(); contents.emit('before-input-event', { preventDefault }, { type: 'keyDown', ...key }); expect(preventDefault).toHaveBeenCalledOnce();
    }
    const preventDefault = vi.fn(); contents.emit('before-input-event', { preventDefault }, { type: 'keyUp', key: 'F6' }); expect(preventDefault).not.toHaveBeenCalled(); expect(parent.webContents.focus).toHaveBeenCalledTimes(3);
  });
  it('publishes actual navigation, history, title, loading and in-page changes without aliasing its state', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), contents = fake.views[0].webContents;
    expect(manager.navigate(token, 'https://example.com').loading).toBe(true); expect(fake.load).toHaveBeenCalledWith('https://example.com/');
    contents.emit('did-start-loading'); contents.navigationHistory.canGoBack.mockReturnValue(true);
    contents.emit('did-navigate', {}, 'https://example.com/final'); contents.emit('page-title-updated', {}, 'T'.repeat(600)); contents.emit('did-stop-loading');
    const state = parent.webContents.send.mock.calls.at(-1)![1]; expect(state).toMatchObject({ loading: false, canGoBack: true, url: 'https://example.com/final', title: 'T'.repeat(500) });
    contents.emit('did-navigate-in-page', {}, 'https://example.com/final#part', false); expect(manager.open(parent as unknown as BrowserWindow).url).toBe('https://example.com/final');
    contents.emit('did-navigate-in-page', {}, 'https://example.com/final#part', true); expect(manager.open(parent as unknown as BrowserWindow).url).toContain('#part');
    state.url = 'changed'; expect(manager.open(parent as unknown as BrowserWindow).url).not.toBe('changed');
  });
  it('handles failure even when the native loading event follows loadURL, and accepts retry', async () => {
    fake.load.mockRejectedValueOnce(new Error('PRIVATE_NETWORK_DETAIL'));
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow); manager.navigate(token, 'https://example.com');
    fake.views[0].webContents.emit('did-start-loading');
    await vi.waitFor(() => expect(manager.open(parent as unknown as BrowserWindow).error).toBe('网页无法加载，请检查地址或重试。'));
    expect(JSON.stringify(parent.webContents.send.mock.calls)).not.toContain('PRIVATE_NETWORK_DETAIL');
    expect(manager.action(token, 'reload').error).toBeNull(); expect(fake.load).toHaveBeenCalledTimes(2);
  });
  it('ignores stale load failures and aborted loads after stop, replacement or new navigation', async () => {
    let reject!: (error: Error) => void; fake.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow);
    manager.navigate(token, 'https://first.example'); manager.navigate(token, 'https://second.example'); reject(new Error('old')); await Promise.resolve();
    expect(manager.open(parent as unknown as BrowserWindow).error).toBeNull();
    fake.load.mockRejectedValueOnce(Object.assign(new Error('aborted'), { errno: -3 })); manager.navigate(token, 'https://second.example'); await Promise.resolve(); expect(manager.open(parent as unknown as BrowserWindow).error).toBeNull();
    fake.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); manager.navigate(token, 'https://second.example'); manager.action(token, 'stop'); reject(new Error('stopped')); await Promise.resolve(); expect(manager.open(parent as unknown as BrowserWindow).loading).toBe(false);
    fake.load.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); manager.navigate(token, 'https://second.example'); manager.close(token); reject(new Error('closed')); await Promise.resolve();
    expect(fake.views[0].webContents.isDestroyed()).toBe(true);
  });
  it('handles actual top-level failure/crash but ignores aborted or subframe failures', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), contents = fake.views[0].webContents;
    manager.navigate(token, 'https://example.com/');
    contents.emit('did-fail-load', {}, -3, 'aborted', 'https://example.com/', true); contents.emit('did-fail-load', {}, -105, 'subframe', 'https://example.com/', false); expect(manager.open(parent as unknown as BrowserWindow).error).toBeNull();
    contents.emit('did-fail-load', {}, -105, 'private', 'https://example.com/', true); expect(manager.open(parent as unknown as BrowserWindow).error).toBeTruthy();
    manager.navigate(token, 'https://example.com/'); contents.emit('render-process-gone'); expect(fake.views[0].setVisible).toHaveBeenLastCalledWith(false);
  });
  it('supports enabled history actions, stop, reload and explicit content focus', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), contents = fake.views[0].webContents;
    manager.action(token, 'back'); manager.action(token, 'forward'); manager.action(token, 'focus'); manager.action(token, 'reload'); expect(fake.load).not.toHaveBeenCalled(); expect(contents.focus).not.toHaveBeenCalled();
    manager.navigate(token, 'https://example.com'); contents.getURL.mockReturnValue('https://example.com'); contents.navigationHistory.canGoBack.mockReturnValue(true); contents.navigationHistory.canGoForward.mockReturnValue(true);
    manager.action(token, 'back'); manager.action(token, 'forward'); manager.action(token, 'focus'); manager.action(token, 'stop');
    expect(contents.navigationHistory.goBack).toHaveBeenCalledOnce(); expect(contents.navigationHistory.goForward).toHaveBeenCalledOnce(); expect(contents.focus).toHaveBeenCalledOnce(); expect(contents.stop).toHaveBeenCalledOnce();
    expect(manager.action(token, 'reload').loading).toBe(true); expect(() => manager.action(token, 'unknown' as any)).toThrow();
  });
  it('releases the website on full workbench navigation while retaining in-page and subframe changes', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), contents = fake.views[0].webContents;
    parent.webContents.emit('did-start-navigation', { isSameDocument: true, isMainFrame: true });
    parent.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: false });
    expect(contents.isDestroyed()).toBe(false);
    parent.webContents.emit('did-start-navigation', { isSameDocument: false, isMainFrame: true });
    expect(contents.isDestroyed()).toBe(true); expect(parent.contentView.removeChildView).toHaveBeenCalledOnce();
    expect(parent.webContents.listenerCount('did-start-navigation')).toBe(0); expect(parent.webContents.listenerCount('render-process-gone')).toBe(0);
    expect(() => manager.action(token, 'reload')).toThrow('no longer available');
    const replacement = manager.open(parent as unknown as BrowserWindow); manager.close(token);
    expect(manager.open(parent as unknown as BrowserWindow).token).toBe(replacement.token);
  });
  it('releases the website when its workbench renderer crashes', () => {
    const parent = parentWindow(); manager.open(parent as unknown as BrowserWindow);
    parent.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(fake.views[0].webContents.isDestroyed()).toBe(true); expect(parent.webContents.listenerCount('render-process-gone')).toBe(0);
    expect(parent.listenerCount('closed')).toBe(0);
  });
  it('restores the committed address and title when a pending navigation is stopped', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow), contents = fake.views[0].webContents;
    contents.getURL.mockReturnValue('https://example.com/committed'); contents.getTitle.mockReturnValue('已加载网页');
    manager.navigate(token, 'https://example.com/pending');
    expect(manager.action(token, 'stop')).toMatchObject({ url: 'https://example.com/committed', title: '已加载网页', loading: false, error: null });
    contents.getURL.mockReturnValue('about:blank'); manager.navigate(token, 'https://example.com/first');
    expect(manager.action(token, 'stop')).toMatchObject({ url: '', title: '', loading: false });
    expect(manager.action(token, 'reload').loading).toBe(false);
  });
  it('uses actual zoom for bounded layout, hides on overlays/minimize/resize and ignores stale owners', () => {
    const parent = parentWindow(1.25), { token } = manager.open(parent as unknown as BrowserWindow), view = fake.views[0];
    const viewport = { x: 10.1, y: 20.2, width: 100.3, height: 200.4 };
    manager.layout(token, viewport); expect(view.setVisible).toHaveBeenLastCalledWith(false); manager.navigate(token, 'https://example.com');
    manager.layout(token, viewport); expect(view.setBounds).toHaveBeenCalledWith({ x: 13, y: 26, width: 125, height: 249 });
    parent.emit('resize'); expect(view.setVisible).toHaveBeenLastCalledWith(false); manager.layout(token, viewport); parent.emit('minimize'); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.layout(token, null); expect(view.setVisible).toHaveBeenLastCalledWith(false); manager.layout('stale', viewport); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    manager.layout(token, { x: 1000, y: 1000, width: 10, height: 10 }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    for (const x of [-1, NaN, Infinity, 32769]) expect(() => manager.layout(token, { ...viewport, x })).toThrow();
    parent.isMinimized.mockReturnValue(true); manager.layout(token, viewport); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    view.webContents.crashed = true; parent.isMinimized.mockReturnValue(false); manager.layout(token, viewport); expect(view.setVisible).toHaveBeenLastCalledWith(false);
  });
  it('bounds a never-loading site and releases owned listeners and storage on close', async () => {
    vi.useFakeTimers(); fake.load.mockReturnValueOnce(new Promise(() => {})); const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow);
    manager.navigate(token, 'https://example.com'); await vi.advanceTimersByTimeAsync(15000);
    expect(manager.open(parent as unknown as BrowserWindow).error).toBeTruthy(); expect(fake.views[0].webContents.stop).toHaveBeenCalledOnce();
    manager.close('stale'); expect(fake.views[0].webContents.isDestroyed()).toBe(false); parent.emit('closed');
    expect(fake.views[0].webContents.isDestroyed()).toBe(true); expect(parent.listenerCount('resize')).toBe(0); expect(parent.listenerCount('minimize')).toBe(0); expect(parent.listenerCount('closed')).toBe(0); expect(fake.clear).toHaveBeenCalledOnce(); manager.close();
    expect(() => manager.navigate(token, 'https://example.com')).toThrow('no longer available');
  });
  it('replaces other owners and rejects a destroyed parent or invalid address without loading', () => {
    const parent = parentWindow(), { token } = manager.open(parent as unknown as BrowserWindow);
    expect(() => manager.navigate(token, 'file:///private')).toThrow(); expect(fake.load).not.toHaveBeenCalled();
    const other = parentWindow(); manager.open(other as unknown as BrowserWindow); expect(fake.views[0].webContents.isDestroyed()).toBe(true); expect(() => manager.action(token, 'stop')).toThrow();
    other.isDestroyed.mockReturnValue(true); expect(() => manager.open(other as unknown as BrowserWindow)).toThrow('unavailable');
  });
  it('disposes a setup failure and rejects late events from a closed surface without exposing private details', () => {
    const parent = parentWindow(); manager.open(parent as unknown as BrowserWindow); const old = fake.views[0]; manager.close();
    parent.webContents.send.mockClear();
    for (const [name, args] of [['did-start-loading', []], ['did-stop-loading', []], ['did-navigate', [{}, 'https://example.com']], ['page-title-updated', [{}, 'old']], ['render-process-gone', []]] as const) old.webContents.emit(name, ...args);
    expect(parent.webContents.send).not.toHaveBeenCalled();
    const original = parent.contentView.addChildView;
    parent.contentView.addChildView = vi.fn(view => { view.webContents.setWebRTCIPHandlingPolicy.mockImplementation(() => { throw new Error('PRIVATE_SETUP_DETAIL'); }); });
    expect(() => manager.open(parent as unknown as BrowserWindow)).toThrow('could not be opened');
    expect(fake.views[1].webContents.isDestroyed()).toBe(true); expect(parent.listenerCount('closed')).toBe(0);
    parent.contentView.addChildView = original; expect(manager.open(parent as unknown as BrowserWindow).token).toBeTruthy();
  });
});
