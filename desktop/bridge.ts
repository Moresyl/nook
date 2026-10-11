import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, RunEvent } from '../contracts/bridge-contract';
import type { TerminalEvent } from '../contracts/projects';
import type { McpResourceUpdate, McpView } from '../contracts/extensions';
import type { PluginView } from '../contracts/plugins';

const invoke = (command: string, ...args: unknown[]) => ipcRenderer.invoke('qiyao:invoke', command, ...args);
const closeHandlers = new Set<() => Promise<void>>();
ipcRenderer.on('qiyao:flush-drafts', async (_event, token: string) => {
  let saved = true;
  try { await Promise.all([...closeHandlers].map((handler) => handler())); } catch { saved = false; }
  await invoke('finishDraftFlush', token, saved);
});
ipcRenderer.on('qiyao:before-close', async (_event, token: string) => {
  let saved = true;
  try { await Promise.all([...closeHandlers].map((handler) => handler())); } catch { saved = false; }
  await invoke('finishWindowClose', token, saved);
});
const bridge: Bridge = {
  load: () => invoke('load'),
  openQuickChat: () => invoke('openQuickChat'),
  onWorkspaceNavigation: callback => { const handler = (_event: unknown, target: { threadId?: string; settings?: boolean }) => callback(target); ipcRenderer.on('nook:workspace-navigation', handler); return () => { ipcRenderer.removeListener('nook:workspace-navigation', handler); }; },
  saveProvider: (provider, key) => invoke('saveProvider', provider, key),
  removeProvider: (id) => invoke('removeProvider', id),
  saveMcpServer: (server, credentials) => invoke('saveMcpServer', server, credentials),
  removeMcpServer: (id) => invoke('removeMcpServer', id),
  mcpViews: () => invoke('mcpViews'),
  mcpConnect: (id) => invoke('mcpConnect', id),
  mcpAuthenticate: (id) => invoke('mcpAuthenticate', id),
  mcpForgetLogin: (id) => invoke('mcpForgetLogin', id),
  mcpDisconnect: (id) => invoke('mcpDisconnect', id),
  mcpTestTool: (id, name, argumentsJson) => invoke('mcpTestTool', id, name, argumentsJson),
  mcpCatalog: (id) => invoke('mcpCatalog', id),
  mcpRefreshCatalog: (id) => invoke('mcpRefreshCatalog', id),
  mcpReadResource: (id, uri) => invoke('mcpReadResource', id, uri),
  mcpPreviewBinary: (item) => invoke('mcpPreviewBinary', item),
  mcpExportBinary: (item) => invoke('mcpExportBinary', item),
  mcpSetResourceSubscription: (id, uri, subscribed) => invoke('mcpSetResourceSubscription', id, uri, subscribed),
  mcpGetPrompt: (id, name, argumentsMap) => invoke('mcpGetPrompt', id, name, argumentsMap),
  onMcp: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: McpView) => callback(payload);
    ipcRenderer.on('qiyao:mcp', listener);
    return () => { ipcRenderer.removeListener('qiyao:mcp', listener); };
  },
  onMcpResource: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: McpResourceUpdate) => callback(payload);
    ipcRenderer.on('qiyao:mcp-resource', listener);
    return () => { ipcRenderer.removeListener('qiyao:mcp-resource', listener); };
  },
  importSkill: () => invoke('importSkill'),
  saveSkill: (skill) => invoke('saveSkill', skill),
  removeSkill: (id) => invoke('removeSkill', id),
  skillDocument: (id) => invoke('skillDocument', id),
  skillRead: (id, path) => invoke('skillRead', id, path),
  importPlugin: () => invoke('importPlugin'),
  savePlugin: (plugin) => invoke('savePlugin', plugin),
  removePlugin: (id) => invoke('removePlugin', id),
  pluginViews: () => invoke('pluginViews'),
  pluginReload: (id) => invoke('pluginReload', id),
  pluginCommand: (id, name, args, projectId) => invoke('pluginCommand', id, name, args, projectId),
  pluginPanelUrl: (id, panelId) => invoke('pluginPanelUrl', id, panelId),
  pluginPanelRequest: (id, method, params) => invoke('pluginPanelRequest', id, method, params),
  onPlugin: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PluginView) => callback(payload);
    ipcRenderer.on('qiyao:plugin', listener);
    return () => { ipcRenderer.removeListener('qiyao:plugin', listener); };
  },
  discoverModels: (provider, key) => invoke('discoverModels', provider, key),
  discoverModelCatalog: (provider, key) => invoke('discoverModelCatalog', provider, key),
  savePreferences: (preferences) => invoke('savePreferences', preferences),
  desktopState: () => invoke('desktopState'),
  saveAutomation: (task) => invoke('saveAutomation', task),
  setAutomationEnabled: (id, enabled) => invoke('setAutomationEnabled', id, enabled),
  removeAutomation: (id) => invoke('removeAutomation', id),
  runAutomation: (id) => invoke('runAutomation', id),
  stopAutomation: (id) => invoke('stopAutomation', id),
  onAutomation: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) => callback(payload);
    ipcRenderer.on('qiyao:automation', listener);
    return () => { ipcRenderer.removeListener('qiyao:automation', listener); };
  },
  saveComposerDraft: (draft) => invoke('saveComposerDraft', draft),
  saveMessageDraft: (draft) => invoke('saveMessageDraft', draft),
  removeMessageDraft: (target) => invoke('removeMessageDraft', target),
  editMessage: (input) => invoke('editMessage', input),
  activateThread: (id, drafts) => invoke('activateThread', id, drafts),
  startTemporaryChat: () => invoke('startTemporaryChat'),
  reorderBranch: (input) => invoke('reorderBranch', input),
  submit: (request) => invoke('submit', request),
  compareModels: (request) => invoke('compareModels', request),
  generateContextSummary: (input) => invoke('generateContextSummary', input),
  changeContextSummary: (input) => invoke('changeContextSummary', input),
  stopContextSummary: (requestId) => invoke('stopContextSummary', requestId),
  stop: (id) => invoke('stop', id),
  pendingApprovals: () => invoke('pendingApprovals'),
  resolveApproval: (id, allowed) => invoke('resolveApproval', id, allowed),
  updateThread: (thread) => invoke('updateThread', thread),
  deleteThread: (id) => invoke('deleteThread', id),
  forkThread: (id, messageId) => invoke('forkThread', id, messageId),
  chooseProject: () => invoke('chooseProject'),
  chooseWorktreeRoot: () => invoke('chooseWorktreeRoot'),
  defaultWorktreeRoot: () => invoke('defaultWorktreeRoot'),
  saveProject: (project) => invoke('saveProject', project),
  removeProject: (id) => invoke('removeProject', id),
  saveAssistant: (assistant) => invoke('saveAssistant', assistant),
  saveMemory: (memory) => invoke('saveMemory', memory),
  removeMemory: (id) => invoke('removeMemory', id),
  removeAssistant: (id) => invoke('removeAssistant', id),
  readAssistantImport: () => invoke('readAssistantImport'),
  importAssistants: (bundle) => invoke('importAssistants', bundle),
  exportAssistants: (ids) => invoke('exportAssistants', ids),
  savePromptTemplate: (template) => invoke('savePromptTemplate', template),
  removePromptTemplate: (id) => invoke('removePromptTemplate', id),
  readPromptImport: () => invoke('readPromptImport'),
  importPrompts: (bundle) => invoke('importPrompts', bundle),
  exportPrompts: (ids) => invoke('exportPrompts', ids),
  saveNote: (note) => invoke('saveNote', note),
  removeNote: (id) => invoke('removeNote', id),
  saveKnowledgeCollection: (collection) => invoke('saveKnowledgeCollection', collection),
  removeKnowledgeCollection: (id) => invoke('removeKnowledgeCollection', id),
  importKnowledgeDocuments: (id, files) => invoke('importKnowledgeDocuments', id, files),
  knowledgeViews: () => invoke('knowledgeViews'),
  buildKnowledgeIndex: (id, force) => invoke('buildKnowledgeIndex', id, force),
  stopKnowledgeIndex: (id) => invoke('stopKnowledgeIndex', id),
  searchKnowledge: (query, id) => invoke('searchKnowledge', query, id),
  stopKnowledgeSearch: (id) => invoke('stopKnowledgeSearch', id),
  attachFiles: () => invoke('attachFiles'),
  importAttachments: (files) => invoke('importAttachments', files),
  readDocumentOriginal: (reference) => invoke('readDocumentOriginal', reference),
  exportDocumentOriginal: (reference) => invoke('exportDocumentOriginal', reference),
  listFiles: (id, path) => invoke('listFiles', id, path),
  listDirectory: (id, request) => invoke('listDirectory', id, request),
  readFile: (id, path) => invoke('readFile', id, path),
  loadDocument: (id, path) => invoke('loadDocument', id, path),
  previewProject: (id, input) => invoke('previewProject', id, input),
  openBrowser: () => invoke('openBrowser'),
  newBrowserTab: () => invoke('newBrowserTab'),
  activateBrowserTab: (token) => invoke('activateBrowserTab', token),
  navigateBrowser: (token, url) => invoke('navigateBrowser', token, url),
  browserAction: (token, action) => invoke('browserAction', token, action),
  layoutBrowser: (token, viewport) => invoke('layoutBrowser', token, viewport),
  closeBrowser: (token) => invoke('closeBrowser', token),
  onBrowserState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: import('../contracts/browser').BrowserState) => callback(state);
    ipcRenderer.on('qiyao:browser-state', listener);
    return () => { ipcRenderer.removeListener('qiyao:browser-state', listener); };
  },
  onBrowserFocus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => callback(token);
    ipcRenderer.on('qiyao:browser-focus', listener);
    return () => { ipcRenderer.removeListener('qiyao:browser-focus', listener); };
  },
  onBrowserShortcut: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, shortcut: import('../contracts/browser').BrowserShortcut) => callback(shortcut);
    ipcRenderer.on('qiyao:browser-shortcut', listener);
    return () => { ipcRenderer.removeListener('qiyao:browser-shortcut', listener); };
  },
  previewProjectDocked: (id, input) => invoke('previewProjectDocked', id, input),
  layoutProjectPreview: (id, token, viewport) => invoke('layoutProjectPreview', id, token, viewport),
  closeProjectPreview: (id, token) => invoke('closeProjectPreview', id, token),
  onProjectPreviewFailure: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => callback(token);
    ipcRenderer.on('qiyao:preview-failed', listener);
    return () => { ipcRenderer.removeListener('qiyao:preview-failed', listener); };
  },
  prepareDocument: (id, path) => invoke('prepareDocument', id, path),
  saveDocument: (id, input) => invoke('saveDocument', id, input),
  saveEditorDraft: (draft) => invoke('saveEditorDraft', draft),
  removeEditorDraft: (id, path) => invoke('removeEditorDraft', id, path),
  gitStatus: (id) => invoke('gitStatus', id),
  gitBranches: (id) => invoke('gitBranches', id),
  gitSwitchBranch: (id, name) => invoke('gitSwitchBranch', id, name),
  gitCreateBranch: (id, name) => invoke('gitCreateBranch', id, name),
  gitWorktrees: id => invoke('gitWorktrees', id),
  gitCreateWorktree: (id, input) => invoke('gitCreateWorktree', id, input),
  registerWorktreeProject: input => invoke('registerWorktreeProject', input),
  managedWorktrees: source => invoke('managedWorktrees', source),
  setWorktreePinned: input => invoke('setWorktreePinned', input),
  captureWorktreeSnapshot: input => invoke('captureWorktreeSnapshot', input),
  worktreeSnapshots: source => invoke('worktreeSnapshots', source),
  restoreWorktreeSnapshot: input => invoke('restoreWorktreeSnapshot', input),
  gitFileView: (id, file, staged) => invoke('gitFileView', id, file, staged),
  gitStage: (id, paths, staged) => invoke('gitStage', id, paths, staged),
  gitCommit: (id, message) => invoke('gitCommit', id, message),
  terminalOpen: (id, geometry) => invoke('terminalOpen', id, geometry),
  terminalList: (id) => invoke('terminalList', id),
  terminalWrite: (id, data) => invoke('terminalWrite', id, data),
  terminalResize: (id, geometry) => invoke('terminalResize', id, geometry),
  terminalClose: (id) => invoke('terminalClose', id),
  onTerminal: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TerminalEvent) => callback(payload);
    ipcRenderer.on('qiyao:terminal', listener);
    return () => { ipcRenderer.removeListener('qiyao:terminal', listener); };
  },
  gitDiff: (id) => invoke('gitDiff', id),
  exportThread: (id) => invoke('exportThread', id),
  exportWorkspace: () => invoke('exportWorkspace'),
  importWorkspace: () => invoke('importWorkspace'),
  openExternal: (url) => invoke('openExternal', url),
  windowAction: (action) => invoke('windowAction', action),
  onBeforeClose: (callback) => { closeHandlers.add(callback); return () => { closeHandlers.delete(callback); }; },
  onRun: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RunEvent) => callback(payload);
    ipcRenderer.on('qiyao:run', listener);
    return () => { ipcRenderer.removeListener('qiyao:run', listener); };
  },
};
contextBridge.exposeInMainWorld('qiyao', bridge);
