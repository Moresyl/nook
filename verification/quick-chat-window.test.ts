import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { QuickChatWindow } from '../desktop/quick-chat-window';
import type { QuickChat } from '../desktop/services/quick-chat';
import type { ConversationEngine } from '../desktop/services/conversation-engine';
import { emptyWorkspace } from '../contracts/workspace';
import { sampleThread } from './fixtures';

const fake = vi.hoisted(() => ({ windows: [] as any[], load: vi.fn(), dialog: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    destroyed = false; size = [640, 580]; pinned = true; minimized = false;
    show = vi.fn(); hide = vi.fn(); focus = vi.fn(); restore = vi.fn(() => { this.minimized = false; }); setMenu = vi.fn();
    webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn(), setWindowOpenHandler: vi.fn() });
    constructor(readonly options: any) { super(); fake.windows.push(this); }
    isDestroyed() { return this.destroyed; } isMinimized() { return this.minimized; } isAlwaysOnTop() { return this.pinned; }
    setAlwaysOnTop(value: boolean) { this.pinned = value; } getSize() { return this.size; }
    setSize(width: number, height: number) { this.size = [width, height]; } setMinimumSize = vi.fn();
    loadURL = fake.load; destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { BrowserWindow: Window, dialog: { showMessageBox: fake.dialog } };
});
const managers: QuickChatWindow[] = [];
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); fake.windows.length = 0; fake.load.mockResolvedValue(undefined); fake.dialog.mockResolvedValue({ response: 0 }); });
afterEach(async () => { for (const manager of managers.splice(0)) { const window = fake.windows.find(window => !window.destroyed); window?.destroy(); await manager.shutdown(); } vi.useRealTimers(); });
function setup() {
  const quick = { load: vi.fn(), save: vi.fn(), send: vi.fn(), stop: vi.fn(), activate: vi.fn(), owns: vi.fn((id: string) => id === 'quick'), assertOriginal: vi.fn(value => value) };
  const approvals = [{ id: 'quick-approval', threadId: 'quick' }, { id: 'main-approval', threadId: 'main' }];
  const engine = { pendingApprovals: vi.fn(() => approvals), resolveApproval: vi.fn() };
  const content = { attachFiles: vi.fn(), importAttachments: vi.fn(), readDocumentOriginal: vi.fn(), exportDocumentOriginal: vi.fn(), exportAttachmentImage: vi.fn(), openExternal: vi.fn() };
  const openWorkspace = vi.fn();
  const manager = new QuickChatWindow({ quick: quick as unknown as QuickChat, engine: engine as unknown as ConversationEngine,
    content: () => content, openWorkspace, preload: 'quick-chat-bridge.cjs', url: 'qiyao://app/index.html?view=quick-chat', icon: 'icon.ico' });
  managers.push(manager); manager.open(); const window = fake.windows.at(-1);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as IpcMainInvokeEvent;
  const invoke = (command: unknown, ...args: unknown[]) => manager.handle(event, command, args);
  const acknowledge = async (saved = true) => {
    const token = window.webContents.send.mock.calls.findLast(([name]: [string]) => name === 'nook:quick-flush')?.[1];
    expect(token).toBeTruthy(); await invoke('finishFlush', token, saved);
  };
  return { manager, window, event, invoke, acknowledge, quick, engine, content, openWorkspace };
}

describe('restricted quick-chat window', () => {
  it('creates its own sandboxed preload, denies navigation, restores the same window and refreshes without exposing the full workspace', async () => {
    const { manager, window, invoke, quick } = setup();
    expect(window.options).toMatchObject({ frame: false, alwaysOnTop: true, minWidth: 420, minHeight: 360 });
    expect(window.options.webPreferences).toMatchObject({ preload: 'quick-chat-bridge.cjs', contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false });
    expect(window.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview', 'will-prevent-unload']) { const event = { preventDefault: vi.fn() }; window.webContents.emit(name, event); expect(event.preventDefault).toHaveBeenCalledOnce(); }
    window.emit('ready-to-show'); expect(window.show).toHaveBeenCalledOnce(); window.minimized = true; manager.open();
    expect(fake.windows).toHaveLength(1); expect(window.restore).toHaveBeenCalledOnce(); expect(window.webContents.send).toHaveBeenCalledWith('nook:quick-refresh');
    quick.load.mockResolvedValue({ scoped: true }); expect(await invoke('load')).toEqual({ scoped: true });
    for (const command of ['saveProvider', 'loadDocument', 'submit', 'importWorkspace', 'chooseWorktreeRoot', 'defaultWorktreeRoot', 'constructor', '__proto__', 1]) await expect(invoke(command)).rejects.toThrow('Unknown quick-chat');
  });
  it('rejects another window and embedded frame before any operation', async () => {
    const { manager, event, quick } = setup();
    await expect(manager.handle({ ...event, sender: {} } as IpcMainInvokeEvent, 'load', [])).rejects.toThrow('Untrusted');
    await expect(manager.handle({ ...event, senderFrame: {} } as IpcMainInvokeEvent, 'load', [])).rejects.toThrow('Untrusted'); expect(quick.load).not.toHaveBeenCalled();
  });
  it('coalesces draft flushes, ignores old acknowledgements and retains the window on save failure', async () => {
    const { manager, invoke, acknowledge, window } = setup();
    const first = manager.flush(), second = manager.flush(); expect(first).toBe(second);
    await invoke('finishFlush', '00000000-0000-4000-8000-000000000000', true); expect(window.webContents.send).toHaveBeenCalledTimes(1);
    await acknowledge(); await first;
    const hiding = invoke('windowAction', 'hide'); const failure = expect(hiding).rejects.toThrow('retained'); await acknowledge(false); await failure;
    expect(window.hide).not.toHaveBeenCalled();
    const retry = invoke('windowAction', 'hide'); await acknowledge(); await retry; expect(window.hide).toHaveBeenCalledOnce();
  });
  it('preserves a newly reopened window while a prior hide is still saving and bounds an absent renderer at five seconds', async () => {
    const { manager, invoke, acknowledge, window } = setup(); const hiding = invoke('windowAction', 'hide'); manager.open(); await acknowledge(); await hiding;
    expect(window.hide).not.toHaveBeenCalled(); vi.useFakeTimers(); const timed = expect(manager.flush()).rejects.toThrow('in time');
    await vi.advanceTimersByTimeAsync(5000); await timed; expect(vi.getTimerCount()).toBe(0);
    const retry = manager.flush(); await acknowledge(); await retry;
  });
  it('supports pinning and compact resize without discarding the expanded window size, then flushes on shutdown', async () => {
    const { manager, invoke, acknowledge, window } = setup(); window.size = [710, 650];
    expect(await invoke('windowAction', 'pin')).toEqual({ pinned: false, collapsed: false });
    expect(await invoke('windowAction', 'collapse')).toEqual({ pinned: false, collapsed: true }); expect(window.size).toEqual([710, 58]);
    expect(await invoke('windowAction', 'collapse')).toEqual({ pinned: false, collapsed: false }); expect(window.size).toEqual([710, 650]);
    const closing = manager.shutdown(); expect(window.destroyed).toBe(false); await acknowledge(); await closing;
    expect(window.destroyed).toBe(true); expect(() => manager.open()).toThrow('shutting down');
  });
  it('forwards only the owned conversation and approvals, stripping all other histories and workspace data', async () => {
    const { manager, window, invoke, engine } = setup(); const state = emptyWorkspace(); state.threads = [sampleThread({ id: 'quick' }), sampleThread({ id: 'main' })];
    manager.emit({ threadId: 'main', messageId: 'message', state }); expect(window.webContents.send).not.toHaveBeenCalled();
    manager.emit({ threadId: 'quick', messageId: 'message', delta: 'Live', state });
    const forwarded = window.webContents.send.mock.calls[0][1]; expect(forwarded).toEqual({ threadId: 'quick', messageId: 'message', delta: 'Live', thread: state.threads[0] }); expect(forwarded.state).toBeUndefined();
    expect(await invoke('pendingApprovals')).toEqual([{ id: 'quick-approval', threadId: 'quick' }]);
    for (const id of ['main-approval', 'missing']) await expect(invoke('resolveApproval', id, true)).rejects.toThrow('does not belong');
    await invoke('resolveApproval', 'quick-approval', false); expect(engine.resolveApproval).toHaveBeenCalledExactlyOnceWith('quick-approval', false);
    await expect(invoke('resolveApproval', 'quick-approval', 'yes')).rejects.toThrow('Invalid quick-chat data');
  });
  it('flushes before document ownership checks or workspace handoff and uses the same current-window operations for draft changes', async () => {
    const { invoke, acknowledge, quick, content, openWorkspace } = setup(); const reference = { owned: true };
    const reading = invoke('readDocumentOriginal', reference); expect(content.readDocumentOriginal).not.toHaveBeenCalled(); await acknowledge(); await reading;
    expect(quick.assertOriginal).toHaveBeenCalledWith(reference); expect(content.readDocumentOriginal).toHaveBeenCalledWith(reference);
    quick.assertOriginal.mockImplementationOnce(() => { throw new Error('Foreign document'); }); const foreign = expect(invoke('exportDocumentOriginal', reference)).rejects.toThrow('Foreign document'); await acknowledge(); await foreign; expect(content.exportDocumentOriginal).not.toHaveBeenCalled();
    const opening = invoke('openWorkspace', true); await acknowledge(); await opening; expect(openWorkspace).toHaveBeenCalledWith(true);
    await invoke('save', 'draft', 'revision'); await invoke('send', 'revision'); await invoke('activate', 'quick', 'revision'); await invoke('stop');
    expect(quick.save).toHaveBeenCalledWith('draft', 'revision'); expect(quick.send).toHaveBeenCalledWith('revision'); expect(quick.activate).toHaveBeenCalledWith('quick', 'revision'); expect(quick.stop).toHaveBeenCalledOnce();
    await invoke('attachFiles'); await invoke('importAttachments', []); await invoke('openExternal', 'https://example.com');
    expect(content.attachFiles).toHaveBeenCalledOnce(); expect(content.importAttachments).toHaveBeenCalledWith([]); expect(content.openExternal).toHaveBeenCalledWith('https://example.com');
  });
  it('passes image export data only through the trusted quick-chat content bridge', async () => {
    const { invoke, content } = setup(), file = { id: 'image', name: 'image.png', image: { data: 'fixture' } };
    content.exportAttachmentImage.mockResolvedValue(true);
    expect(await invoke('exportAttachmentImage', file)).toBe(true);
    expect(content.exportAttachmentImage).toHaveBeenCalledExactlyOnceWith(file);
  });
  it('preserves drafts and shows sanitized load errors, allowing a fresh window retry', async () => {
    fake.load.mockRejectedValueOnce(new Error('C:/private/path')); const { manager, window } = setup();
    await vi.waitFor(() => expect(window.destroyed).toBe(true)); expect(JSON.stringify(fake.dialog.mock.calls)).not.toContain('private/path');
    manager.open(); expect(fake.windows).toHaveLength(2); expect(fake.windows[1].destroyed).toBe(false);
  });
  it('intercepts native close until input is saved and rejects pending requests if the window disappears', async () => {
    const { manager, window, acknowledge } = setup(); const event = { preventDefault: vi.fn() }; window.emit('close', event); expect(event.preventDefault).toHaveBeenCalledOnce();
    await acknowledge(); await vi.waitFor(() => expect(window.hide).toHaveBeenCalledOnce());
    const failed = expect(manager.flush()).rejects.toThrow('closed before'); window.destroy(); await failed;
  });
  it('does not let a delayed old-window close cancel the replacement window draft flush', async () => {
    const { manager, window: old } = setup(); old.destroyed = true; manager.open(); const replacement = fake.windows.at(-1);
    const pending = manager.flush(); old.emit('closed');
    const token = replacement.webContents.send.mock.calls.findLast(([name]: [string]) => name === 'nook:quick-flush')[1];
    await manager.handle({ sender: replacement.webContents, senderFrame: replacement.webContents.mainFrame } as IpcMainInvokeEvent, 'finishFlush', [token, true]);
    await pending; manager.open(); expect(fake.windows).toHaveLength(2); expect(replacement.show).toHaveBeenCalled();
  });
});
