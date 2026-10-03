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
  activateThread: (id) => invoke('activateThread', id),
  startTemporaryChat: () => invoke('startTemporaryChat'),
  reorderBranch: (input) => invoke('reorderBranch', input),
  submit: (request) => invoke('submit', request),
  compareModels: (request) => invoke('compareModels', request),
  stop: (id) => invoke('stop', id),
  pendingApprovals: () => invoke('pendingApprovals'),
  resolveApproval: (id, allowed) => invoke('resolveApproval', id, allowed),
  updateThread: (thread) => invoke('updateThread', thread),
  deleteThread: (id) => invoke('deleteThread', id),
  forkThread: (id, messageId) => invoke('forkThread', id, messageId),
  chooseProject: () => invoke('chooseProject'),
  saveProject: (project) => invoke('saveProject', project),
  removeProject: (id) => invoke('removeProject', id),
  saveAssistant: (assistant) => invoke('saveAssistant', assistant),
  removeAssistant: (id) => invoke('removeAssistant', id),
  readAssistantImport: () => invoke('readAssistantImport'),
  importAssistants: (bundle) => invoke('importAssistants', bundle),
  exportAssistants: (ids) => invoke('exportAssistants', ids),
  savePromptTemplate: (template) => invoke('savePromptTemplate', template),
  removePromptTemplate: (id) => invoke('removePromptTemplate', id),
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
  listFiles: (id, path) => invoke('listFiles', id, path),
  listDirectory: (id, request) => invoke('listDirectory', id, request),
  readFile: (id, path) => invoke('readFile', id, path),
  loadDocument: (id, path) => invoke('loadDocument', id, path),
  prepareDocument: (id, path) => invoke('prepareDocument', id, path),
  saveDocument: (id, input) => invoke('saveDocument', id, input),
  saveEditorDraft: (draft) => invoke('saveEditorDraft', draft),
  removeEditorDraft: (id, path) => invoke('removeEditorDraft', id, path),
  gitStatus: (id) => invoke('gitStatus', id),
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
