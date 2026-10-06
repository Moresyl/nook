import { contextBridge, ipcRenderer } from 'electron';
import type { QuickChatBridge, QuickChatEvent } from '../contracts/quick-chat';

const invoke = (command: string, ...args: unknown[]) => ipcRenderer.invoke('nook:quick-chat', command, ...args);
const closeHandlers = new Set<() => Promise<void>>();
ipcRenderer.on('nook:quick-flush', async (_event, token: string) => {
  let saved = closeHandlers.size > 0;
  try { await Promise.all([...closeHandlers].map(handler => handler())); } catch { saved = false; }
  await invoke('finishFlush', token, saved);
});
const bridge: QuickChatBridge = {
  load: () => invoke('load'), save: (draft, revision) => invoke('save', draft, revision), send: revision => invoke('send', revision),
  stop: () => invoke('stop'), activate: (id, revision) => invoke('activate', id, revision),
  openWorkspace: settings => invoke('openWorkspace', settings), windowAction: action => invoke('windowAction', action),
  attachFiles: () => invoke('attachFiles'), importAttachments: files => invoke('importAttachments', files),
  readDocumentOriginal: reference => invoke('readDocumentOriginal', reference), exportDocumentOriginal: reference => invoke('exportDocumentOriginal', reference),
  openExternal: url => invoke('openExternal', url), pendingApprovals: () => invoke('pendingApprovals'), resolveApproval: (id, allowed) => invoke('resolveApproval', id, allowed),
  onBeforeClose: callback => { closeHandlers.add(callback); return () => { closeHandlers.delete(callback); }; },
  onRun: callback => { const handler = (_event: unknown, event: QuickChatEvent) => callback(event); ipcRenderer.on('nook:quick-run', handler); return () => { ipcRenderer.removeListener('nook:quick-run', handler); }; },
  onRefresh: callback => { const handler = () => callback(); ipcRenderer.on('nook:quick-refresh', handler); return () => { ipcRenderer.removeListener('nook:quick-refresh', handler); }; },
};
contextBridge.exposeInMainWorld('nookQuick', bridge);
