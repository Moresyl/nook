import { app, BrowserWindow, crashReporter, dialog, globalShortcut, ipcMain, Menu, net, Notification, powerMonitor, protocol, safeStorage, session, shell, Tray } from 'electron';
import { basename, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn as spawnPty } from 'node-pty';
import { z } from 'zod';
import { projectSchema, providerSchema, threadMarkdown, threadSchema, type Workspace } from '../contracts/workspace';
import { WorkspaceVault } from './services/vault';
import { DocumentOriginalFiles } from './services/document-original-files';
import { chooseWorktreeRoot } from './services/worktree-root-picker';
import { ManagedWorktreeRoots } from './services/managed-worktree-roots';
import { userDataDirectory } from './services/user-data-directory';
import { StartupDiagnostics } from './services/startup-diagnostics';
import { allowRendererPermission } from './services/renderer-permissions';
import { ComposerDrafts } from './services/composer-drafts';
import { startTemporaryChat } from './services/temporary-conversations';
import { reorderConversationBranch } from './services/branch-order';
import { parsePersistentWorkspace } from '../contracts/temporary-conversations';
import { HttpModelGateway } from './services/model-gateway';
import { ProviderSettings } from './services/provider-settings';
import { ConversationEngine } from './services/conversation-engine';
import { projectDiff, projectDirectory, projectDocument, projectEntries, projectText } from './services/project-files';
import { optionalProjectDocument, saveProjectDocument, writableProjectPath } from './services/project-writes';
import { directoryRequestSchema, editorDraftSchema, saveDocumentSchema, terminalGeometrySchema } from '../contracts/projects';
import { ProjectGit } from './services/project-git';
import { createWorktreeSchema } from '../contracts/project-worktrees';
import { TerminalSessions } from './services/terminal-sessions';
import { appAssetPath } from './services/app-assets';
import { McpConnections } from './services/mcp-connections';
import { LocalSkills } from './services/local-skills';
import { ConversationExtensions } from './services/conversation-extensions';
import { ExtensionSettings } from './services/extension-settings';
import { mcpServerSchema, skillSchema } from '../contracts/extensions';
import { McpOAuthSessions, McpOAuthStore } from './services/mcp-oauth';
import { LocalPlugins } from './services/local-plugins';
import { PluginSettings } from './services/plugin-settings';
import { PluginHost } from './services/plugin-host';
import { ElectronPluginRuntime, pluginAssetUrl } from './electron-plugin-runtime';
import { pluginUpdateSchema } from '../contracts/plugins';
import { AttachmentImporter, parseInWorker } from './services/attachment-importer';
import { McpBinaryFiles } from './services/mcp-binary-files';
import { attachmentInputsSchema, attachmentSchema } from '../contracts/attachments';
import { KnowledgeService } from './services/knowledge-service';
import { knowledgeCollectionSchema, knowledgeQuerySchema } from '../contracts/knowledge';
import { backupFiles } from './services/backup-files';
import { Automations } from './services/automations';
import { conversationAutomationRunner } from './services/automation-runner';
import { DesktopIntegration } from './services/desktop-integration';
import { AssistantProfiles } from './services/assistant-profiles';
import { PromptTemplates } from './services/prompt-templates';
import { Memories } from './services/memories';
import { MessageEdits } from './services/message-edits';
import { ProjectPreviewWindow } from './project-preview-window';
import { ProjectPreviewDock } from './project-preview-dock';
import { BrowserPanel } from './browser-panel';
import { QuickChat } from './services/quick-chat';
import { QuickChatWindow } from './quick-chat-window';

const bundleDirectory = __dirname;
let window: BrowserWindow | null = null;
let vault: WorkspaceVault;
let worktreeRoots: ManagedWorktreeRoots;
let composerDrafts: ComposerDrafts;
let messageEdits: MessageEdits;
let engine: ConversationEngine;
let quickChat: QuickChat;
let quickChatWindow: QuickChatWindow;
let providerSettings: ProviderSettings;
let terminals: TerminalSessions;
let mcp: McpConnections;
let skills: LocalSkills;
let extensions: ExtensionSettings;
let oauthStore: McpOAuthStore;
let pluginPackages: LocalPlugins;
let pluginSettings: PluginSettings;
let plugins: PluginHost;
let knowledge: KnowledgeService;
let automations: Automations;
let desktopIntegration: DesktopIntegration;
let assistantProfiles: AssistantProfiles;
let promptTemplates: PromptTemplates;
const taskNotifications = new Set<Notification>();
const git = new ProjectGit(undefined, (path, worktrees) => worktreeRoots.prepare(vault.preferences().worktrees?.root ?? '', path, worktrees.map(tree => tree.path)));
const projectPreview = new ProjectPreviewWindow();
const projectPreviewDock = new ProjectPreviewDock();
const browserPanel = new BrowserPanel();
function closeProjectPreviews(id?: string) { projectPreview.close(id); projectPreviewDock.close(id); }
const gateway = new HttpModelGateway();
const attachmentImporter = new AttachmentImporter((input) => parseInWorker(join(bundleDirectory, 'attachment-worker.cjs'), input), bytes => vault.stageDocumentOriginals(bytes));
const documentOriginalFiles = new DocumentOriginalFiles(reference => vault.readDocumentOriginal(reference), async () => {
  const result = await dialog.showSaveDialog(window!, { defaultPath: 'document.pdf', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }] });
  return result.canceled ? undefined : result.filePath;
});
const mcpBinaryFiles = new McpBinaryFiles(async (input) => (await attachmentImporter.importInputs([input]))[0], async (name) => {
  const result = await dialog.showSaveDialog(window!, { defaultPath: name });
  return result.canceled ? undefined : result.filePath;
});
const idSchema = z.string().min(1).max(128);
let quitting = false;
let quitRequested = false;
let closeAllowed = false;
let closeToken: string | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const draftFlushRequests = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
protocol.registerSchemesAsPrivileged(['qiyao', 'qiyao-plugin', 'nook-preview'].map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } })));
const pathSchema = z.string().min(1).max(4096);
const gitFileSchema = z.object({ path: pathSchema, originalPath: pathSchema.optional(), index: z.string().length(1), working: z.string().length(1), conflict: z.boolean() });

function assertWorkspaceIdle(): void {
  if (engine.active() || terminals.active()) throw new Error('Stop running responses and close active terminals before restoring a backup.');
}

function workspaceProject(id: unknown) {
  const project = vault.project(idSchema.parse(id));
  if (!project) throw new Error('The selected project no longer exists.');
  return project;
}

function assertIdle(id: string): void {
  if (engine.active(id)) throw new Error('Stop the running response before changing this conversation.');
}

async function flushMainDrafts(): Promise<void> {
  if (window && !window.isDestroyed()) await new Promise<void>((resolve, reject) => {
    const token = randomUUID();
    const timer = setTimeout(() => { draftFlushRequests.delete(token); reject(new Error('The current drafts could not be saved in time. Retry the backup after checking the workspace.')); }, 5000);
    draftFlushRequests.set(token, { resolve, reject, timer }); window!.webContents.send('qiyao:flush-drafts', token);
  });
}
async function flushWorkspaceDrafts(): Promise<void> {
  await Promise.all([flushMainDrafts(), quickChatWindow?.flush()]); await vault.flush();
}
async function attachFiles(parent: BrowserWindow) {
  const result = await dialog.showOpenDialog(parent, { title: '添加附件', properties: ['openFile', 'multiSelections'], filters: [{ name: '文档与图片', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'json', 'csv', 'tsv'] }, { name: '所有文件', extensions: ['*'] }] });
  return result.canceled ? [] : attachmentImporter.importPaths(result.filePaths);
}

async function pluginCommand(id: string, name: string, args: unknown, projectId?: string): Promise<unknown> {
  return plugins.command(id, name, args, projectId, { onProgress: () => {}, approve: async (details) => {
    if (details.kind !== 'file') return false;
    const answer = await dialog.showMessageBox(window!, { type: 'question', buttons: ['取消', '允许写入'], defaultId: 0, cancelId: 0,
      message: `插件请求写入 ${details.path}`, detail: `${details.root}\n\n当前内容：\n${details.before}\n\n写入后的内容：\n${details.after}` });
    return answer.response === 1;
  } });
}

function panelPlugin(id: string) {
  const plugin = vault.snapshot().plugins.find((item) => item.id === id);
  if (!plugin?.enabled || !plugin.grants.includes('panels') || plugins.view(id).status !== 'running') throw new Error('Enable this plugin and grant panel access before opening it.');
  return plugin;
}

const commands: Record<string, (...args: any[]) => unknown> = {
  load: async () => { await vault.wait(); return vault.snapshot(); },
  openQuickChat: showQuickChat,
  finishDraftFlush: (raw, saved) => {
    const token = idSchema.parse(raw); const request = draftFlushRequests.get(token);
    if (!request) return;
    const success = z.boolean().parse(saved); clearTimeout(request.timer); draftFlushRequests.delete(token);
    if (success) request.resolve(); else request.reject(new Error('Drafts could not be saved. The workspace was not backed up or replaced.'));
  },
  saveMcpServer: async (raw, credentials) => {
    const server = mcpServerSchema.parse(raw);
    await engine.stopServer(server.id); await mcp.disconnect(server.id);
    return extensions.saveServer(server, credentials);
  },
  removeMcpServer: async (raw) => {
    const id = idSchema.parse(raw); await engine.stopServer(id); await mcp.disconnect(id);
    return extensions.removeServer(id);
  },
  mcpViews: () => vault.mcpServers().map((server) => mcp.view(server.id)),
  mcpConnect: (raw) => mcp.connect(idSchema.parse(raw)),
  mcpAuthenticate: async (raw) => { const id = idSchema.parse(raw); await engine.stopServer(id); return mcp.connect(id, true); },
  mcpForgetLogin: async (raw) => { const id = idSchema.parse(raw); await engine.stopServer(id); await mcp.disconnect(id); await oauthStore.clear(id); },
  mcpDisconnect: async (raw) => { const id = idSchema.parse(raw); await engine.stopServer(id); await mcp.disconnect(id); },
  mcpTestTool: (raw, name, args) => mcp.testTool(idSchema.parse(raw), z.string().min(1).max(256).parse(name), z.string().max(64_000).parse(args)),
  mcpCatalog: (raw) => mcp.catalog(idSchema.parse(raw)),
  mcpRefreshCatalog: (raw) => mcp.refreshCatalog(idSchema.parse(raw)),
  mcpReadResource: (raw, uri) => mcp.readResource(idSchema.parse(raw), z.string().min(1).max(4096).parse(uri)),
  mcpPreviewBinary: (raw) => mcpBinaryFiles.preview(raw),
  mcpExportBinary: (raw) => mcpBinaryFiles.export(raw),
  mcpSetResourceSubscription: (raw, uri, subscribed) => mcp.setResourceSubscription(idSchema.parse(raw), z.string().min(1).max(4096).parse(uri), z.boolean().parse(subscribed)),
  mcpGetPrompt: (raw, name, args) => mcp.getPrompt(idSchema.parse(raw), z.string().min(1).max(256).parse(name), z.record(z.string().max(256), z.string().max(16_000)).parse(args)),
  importSkill: async () => {
    const choice = await dialog.showOpenDialog(window!, { title: '导入技能文件夹', properties: ['openDirectory'] });
    return choice.canceled ? null : extensions.importSkill(choice.filePaths[0]);
  },
  saveSkill: async (raw) => { const skill = skillSchema.parse(raw); await engine.stopSkill(skill.id); return extensions.saveSkill(skill); },
  removeSkill: async (raw) => { const id = z.uuid().parse(raw); await engine.stopSkill(id); return extensions.removeSkill(id); },
  skillDocument: (raw) => skills.document(z.uuid().parse(raw)),
  skillRead: (raw, path) => skills.read(z.uuid().parse(raw), z.string().min(1).max(4096).parse(path)),
  importPlugin: async () => {
    const choice = await dialog.showOpenDialog(window!, { title: '导入插件文件夹', properties: ['openDirectory'] });
    return choice.canceled ? null : pluginSettings.importPath(choice.filePaths[0]);
  },
  savePlugin: async (raw) => {
    const update = pluginUpdateSchema.parse(raw); await engine.stopPlugin(update.id); await plugins.unload(update.id);
    await pluginSettings.save(update); if (update.enabled) await plugins.load(update.id); return vault.snapshot();
  },
  removePlugin: async (raw) => {
    const id = z.uuid().parse(raw); await engine.stopPlugin(id); await plugins.unload(id);
    const state = await pluginSettings.remove(id); await session.defaultSession.clearStorageData({ origin: `qiyao-plugin://${id}` }); return state;
  },
  pluginViews: () => vault.snapshot().plugins.map((plugin) => plugins.view(plugin.id)),
  pluginReload: async (raw) => { const id = z.uuid().parse(raw); await engine.stopPlugin(id); await plugins.unload(id); return plugins.load(id); },
  pluginCommand: (raw, name, args, projectId) => pluginCommand(z.uuid().parse(raw), z.string().min(1).max(64).parse(name), args, projectId === undefined ? undefined : idSchema.parse(projectId)),
  pluginPanelUrl: async (raw, panelId) => {
    const plugin = panelPlugin(z.uuid().parse(raw)); const panel = plugin.manifest.panels.find((item) => item.id === z.string().max(64).parse(panelId));
    if (!panel) throw new Error('This plugin panel does not exist.'); await pluginPackages.verify(plugin); return pluginAssetUrl(plugin.id, panel.entry);
  },
  pluginPanelRequest: (raw, method, params) => {
    const id = z.uuid().parse(raw); panelPlugin(id); const action = z.string().min(1).max(100).parse(method);
    if (action === 'command.run') { const input = z.object({ name: z.string().min(1).max(64), arguments: z.unknown().default({}) }).strict().parse(params); return pluginCommand(id, input.name, input.arguments); }
    return plugins.request(id, action, params);
  },
  finishWindowClose: async (raw, saved) => {
    const token = idSchema.parse(raw);
    if (token !== closeToken) return;
    clearTimeout(closeTimer); closeToken = null;
    if (!z.boolean().parse(saved)) { quitRequested = false; await dialog.showMessageBox(window!, { type: 'error', message: '草稿未能保存，窗口已保留。', detail: '请检查磁盘空间和工作台目录权限，然后重试。' }); return; }
    try { await finishClose(); }
    catch { quitRequested = false; if (window && !window.isDestroyed()) await dialog.showMessageBox(window, { type: 'error', message: '窗口草稿未能完整保存，应用已保留。', detail: '请检查快速聊天窗口、磁盘空间与工作台目录权限，然后重试。' }); }
  },
  saveProvider: (raw, key) => providerSettings.save(providerSchema.parse(raw), key),
  removeProvider: async (raw) => {
    const id = idSchema.parse(raw);
    return providerSettings.remove(id);
  },
  discoverModels: (raw, key) => {
    const provider = providerSchema.parse(raw);
    return gateway.discover(provider, providerSettings.key(provider, key));
  },
  discoverModelCatalog: (raw, key) => {
    const provider = providerSchema.parse(raw);
    return gateway.discoverCatalog(provider, providerSettings.key(provider, key));
  },
  savePreferences: (raw) => desktopIntegration.savePreferences(raw),
  desktopState: () => desktopIntegration.state(),
  saveComposerDraft: (raw) => composerDrafts.save(raw),
  saveMessageDraft: (raw) => messageEdits.saveDraft(raw),
  removeMessageDraft: (raw) => messageEdits.removeDraft(raw),
  editMessage: (raw) => messageEdits.edit(raw),
  activateThread: (raw, drafts) => composerDrafts.activate(raw, drafts),
  startTemporaryChat: () => startTemporaryChat(vault),
  reorderBranch: (raw) => reorderConversationBranch(vault, raw),
  submit: (request) => engine.start(request),
  compareModels: (request) => engine.compare(request),
  generateContextSummary: (raw) => engine.contextSummaries.generate(raw),
  changeContextSummary: (raw) => engine.contextSummaries.change(raw),
  stopContextSummary: (raw) => engine.contextSummaries.stop(raw),
  stop: (id) => engine.stop(idSchema.parse(id)),
  pendingApprovals: () => engine.pendingApprovals(),
  resolveApproval: (id, allowed) => engine.resolveApproval(idSchema.parse(id), z.boolean().parse(allowed)),
  updateThread: (raw) => {
    const thread = threadSchema.parse(raw);
    assertIdle(thread.id);
    return vault.update((draft) => {
      const index = draft.threads.findIndex((item) => item.id === thread.id);
      if (index < 0) throw new Error('This conversation no longer exists.');
      if (thread.temporary !== draft.threads[index].temporary) throw new Error('The storage mode of an existing conversation cannot be changed.');
      if (thread.branchOrder !== draft.threads[index].branchOrder) throw new Error('The branch order changed. Refresh the conversation before changing its details.');
      if (JSON.stringify(thread.comparison) !== JSON.stringify(draft.threads[index].comparison)) throw new Error('Comparison membership cannot be changed. Refresh the conversation before changing its details.');
      if (JSON.stringify([thread.contextSummaries, thread.activeContextSummaryId]) !== JSON.stringify([draft.threads[index].contextSummaries, draft.threads[index].activeContextSummaryId])) throw new Error('The context summary changed. Refresh the conversation before changing its details.');
      draft.threads[index] = { ...thread, updatedAt: Date.now() };
    });
  },
  deleteThread: (raw) => {
    const id = idSchema.parse(raw);
    assertIdle(id);
    return vault.update((draft) => { draft.threads = draft.threads.filter((thread) => thread.id !== id); draft.composerDrafts = draft.composerDrafts.filter((item) => item.threadId !== id); draft.messageDrafts = draft.messageDrafts.filter((item) => item.threadId !== id); if (draft.activeThreadId === id) delete draft.activeThreadId; });
  },
  forkThread: (rawId, rawMessageId) => {
    const id = idSchema.parse(rawId);
    const messageId = idSchema.parse(rawMessageId);
    assertIdle(id);
    return vault.update((draft) => {
      const original = draft.threads.find((thread) => thread.id === id);
      const index = original?.messages.findIndex((message) => message.id === messageId) ?? -1;
      if (!original || index < 0) throw new Error('The selected message no longer exists.');
      const branch = { ...structuredClone(original), id: randomUUID(), title: `${original.title.slice(0, 140)} · 分支`, pinned: false, archived: false, createdAt: Date.now(), updatedAt: Date.now(), messages: original.messages.slice(0, index + 1), forkedFrom: { threadId: id, messageId, kind: 'branch' as const } };
      delete branch.branchOrder; delete branch.comparison; draft.threads.push(branch);
    });
  },
  chooseProject: async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择项目文件夹', properties: ['openDirectory'] });
    if (result.canceled) return null;
    return { id: randomUUID(), name: basename(result.filePaths[0]), path: result.filePaths[0], instructions: '', createdAt: Date.now() };
  },
  chooseWorktreeRoot: () => chooseWorktreeRoot(() => dialog.showOpenDialog(window!, { title: '选择工作树根目录', properties: ['openDirectory'] })),
  defaultWorktreeRoot: () => worktreeRoots.defaultRoot,
  saveProject: (raw) => {
    const project = projectSchema.parse(raw);
    let pathChanged = false;
    return vault.update((draft) => {
      const index = draft.projects.findIndex((item) => item.id === project.id);
      pathChanged = index >= 0 && draft.projects[index].path !== project.path;
      if (index < 0) draft.projects.push(project); else draft.projects[index] = project;
    }).then(state => { if (pathChanged) closeProjectPreviews(project.id); return state; });
  },
  removeProject: async (raw) => {
    const id = idSchema.parse(raw);
    if (vault.snapshot().editorDrafts.some((draft) => draft.projectId === id)) throw new Error('Save or discard this project’s unsaved editor drafts before removing it.');
    await Promise.all([engine.stopProject(id), terminals.closeProject(id)]);
    closeProjectPreviews(id);
    const scopedPlugins = vault.snapshot().plugins.filter((plugin) => plugin.projectIds.includes(id));
    await Promise.all(scopedPlugins.map(async (plugin) => { await engine.stopPlugin(plugin.id); await plugins.unload(plugin.id); }));
    return vault.update((draft) => {
      draft.projects = draft.projects.filter((project) => project.id !== id);
      draft.memories = draft.memories.filter((memory) => memory.projectId !== id);
      draft.threads.forEach((thread) => { if (thread.projectId === id) delete thread.projectId; });
      draft.plugins.forEach((plugin) => { if (plugin.projectIds.includes(id)) { plugin.projectIds = plugin.projectIds.filter((value) => value !== id); plugin.enabled = false; } });
    });
  },
  saveAssistant: (raw) => assistantProfiles.save(raw),
  saveMemory: (raw) => new Memories(vault).save(raw),
  removeMemory: (raw) => new Memories(vault).remove(raw),
  removeAssistant: (raw) => assistantProfiles.remove(raw),
  readAssistantImport: async () => {
    const result = await dialog.showOpenDialog(window!, { title: '导入助手配置', properties: ['openFile'], filters: [{ name: 'Nook 助手配置', extensions: ['json', 'gz'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return assistantProfiles.read(result.filePaths[0]);
  },
  importAssistants: (raw) => assistantProfiles.import(raw),
  savePromptTemplate: (raw) => promptTemplates.save(raw),
  removePromptTemplate: (raw) => promptTemplates.remove(raw),
  readPromptImport: async () => {
    const result = await dialog.showOpenDialog(window!, { title: '导入提示模板', properties: ['openFile'], filters: [{ name: 'Nook 提示模板', extensions: ['json', 'gz'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    return promptTemplates.read(result.filePaths[0]);
  },
  importPrompts: (raw) => promptTemplates.import(raw),
  exportPrompts: async (ids) => {
    const bundle = promptTemplates.bundle(ids);
    const result = await dialog.showSaveDialog(window!, { defaultPath: 'Nook-prompts.json', filters: [{ name: 'Nook 提示模板', extensions: ['json'] }, { name: '压缩提示模板', extensions: ['gz'] }] });
    if (result.canceled || !result.filePath) return false;
    await promptTemplates.write(result.filePath, bundle); return true;
  },
  exportAssistants: async (ids) => {
    const bundle = assistantProfiles.bundle(ids);
    const result = await dialog.showSaveDialog(window!, { defaultPath: 'Nook-assistants.json', filters: [{ name: 'Nook 助手配置', extensions: ['json'] }, { name: '压缩助手配置', extensions: ['gz'] }] });
    if (result.canceled || !result.filePath) return false;
    await assistantProfiles.write(result.filePath, bundle); return true;
  },
  saveAutomation: (raw) => automations.save(raw),
  setAutomationEnabled: (raw, enabled) => automations.setEnabled(z.uuid().parse(raw), z.boolean().parse(enabled)),
  removeAutomation: (raw) => automations.remove(z.uuid().parse(raw)),
  runAutomation: (raw) => automations.runNow(z.uuid().parse(raw)),
  stopAutomation: (raw) => automations.stop(z.uuid().parse(raw)),
  saveNote: (raw) => knowledge.saveNote(raw),
  removeNote: (raw) => vault.update((draft) => { draft.notes = draft.notes.filter((item) => item.id !== idSchema.parse(raw)); }),
  saveKnowledgeCollection: (raw) => knowledge.saveCollection(knowledgeCollectionSchema.parse(raw)),
  removeKnowledgeCollection: (raw) => knowledge.removeCollection(z.uuid().parse(raw)),
  importKnowledgeDocuments: (id, files) => knowledge.importDocuments(idSchema.parse(id), z.array(attachmentSchema).min(1).max(12).parse(files)),
  knowledgeViews: () => knowledge.views(),
  buildKnowledgeIndex: (id, force) => knowledge.index(z.uuid().parse(id), z.boolean().optional().parse(force)),
  stopKnowledgeIndex: (id) => knowledge.stop(z.uuid().parse(id)),
  searchKnowledge: (raw, id) => knowledge.search(knowledgeQuerySchema.parse(raw), AbortSignal.timeout(30_000), z.uuid().optional().parse(id)),
  stopKnowledgeSearch: (id) => knowledge.stopSearch(z.uuid().parse(id)),
  attachFiles: () => attachFiles(window!),
  importAttachments: (raw) => attachmentImporter.importInputs(attachmentInputsSchema.parse(raw)),
  readDocumentOriginal: async (reference) => { await flushWorkspaceDrafts(); return documentOriginalFiles.read(reference); },
  exportDocumentOriginal: async (reference) => { await flushWorkspaceDrafts(); return documentOriginalFiles.export(reference); },
  listFiles: (id, path) => projectEntries(workspaceProject(id).path, z.string().max(4096).parse(path)),
  listDirectory: (id, input) => projectDirectory(workspaceProject(id).path, directoryRequestSchema.parse(input)),
  readFile: (id, path) => projectText(workspaceProject(id).path, z.string().max(4096).parse(path)),
  loadDocument: async (id, raw) => { const path = pathSchema.parse(raw); return { path, ...await projectDocument(workspaceProject(id).path, path) }; },
  previewProject: async (id, input) => { const project = workspaceProject(id); await projectPreview.open(window!, project.id, project.path, input); },
  openBrowser: () => browserPanel.open(window!),
  newBrowserTab: () => browserPanel.open(window!, true),
  activateBrowserTab: (token) => browserPanel.activate(z.uuid().parse(token)),
  navigateBrowser: (token, url) => browserPanel.navigate(z.uuid().parse(token), url),
  browserAction: (token, action) => browserPanel.action(z.uuid().parse(token), action),
  layoutBrowser: (token, viewport) => browserPanel.layout(z.uuid().parse(token), viewport),
  closeBrowser: (token) => browserPanel.close(z.uuid().parse(token)),
  previewProjectDocked: async (id, input) => { const project = workspaceProject(id); return projectPreviewDock.open(window!, project.id, project.path, input); },
  layoutProjectPreview: (id, token, viewport) => projectPreviewDock.layout(z.string().max(100).parse(id), z.uuid().parse(token), viewport),
  closeProjectPreview: (id, token) => projectPreviewDock.close(z.string().max(100).parse(id), z.uuid().parse(token)),
  prepareDocument: async (id, raw) => {
    const project = workspaceProject(id); const path = pathSchema.parse(raw);
    await writableProjectPath(project.path, path); const current = await optionalProjectDocument(project.path, path);
    return { projectId: project.id, path, text: current?.text ?? '', baseText: current?.text ?? '', baseSha256: current?.sha256 ?? null, updatedAt: Date.now() };
  },
  saveDocument: async (id, raw) => {
    const project = workspaceProject(id); const input = saveDocumentSchema.parse(raw);
    const saved = await saveProjectDocument(project.path, input.path, input.text, input.expectedSha256);
    await vault.update((draft) => { draft.editorDrafts = draft.editorDrafts.filter((item) => item.projectId !== project.id || item.path !== input.path || item.text !== input.text); });
    return saved;
  },
  saveEditorDraft: async (raw) => {
    const draft = editorDraftSchema.parse(raw); const project = workspaceProject(draft.projectId);
    await writableProjectPath(project.path, draft.path);
    await vault.update((state) => {
      if (!state.projects.some((item) => item.id === project.id && item.path === project.path)) throw new Error('The selected project changed.');
      const index = state.editorDrafts.findIndex((item) => item.projectId === draft.projectId && item.path === draft.path);
      if (draft.text === draft.baseText) { if (index >= 0) state.editorDrafts.splice(index, 1); }
      else if (index < 0) state.editorDrafts.push(draft);
      else if (state.editorDrafts[index].updatedAt <= draft.updatedAt) state.editorDrafts[index] = draft;
    });
  },
  removeEditorDraft: async (id, raw) => { const project = workspaceProject(id); const path = pathSchema.parse(raw); await vault.update((state) => { state.editorDrafts = state.editorDrafts.filter((item) => item.projectId !== project.id || item.path !== path); }); },
  gitStatus: (id) => git.status(workspaceProject(id).path),
  gitBranches: (id) => git.branches(workspaceProject(id).path),
  gitSwitchBranch: async (id, name) => { const project = workspaceProject(id); const state = await git.switchBranch(project.path, z.string().parse(name)); closeProjectPreviews(project.id); return state; },
  gitCreateBranch: async (id, name) => { const project = workspaceProject(id); const state = await git.createBranch(project.path, z.string().parse(name)); closeProjectPreviews(project.id); return state; },
  gitWorktrees: id => git.worktrees(workspaceProject(id).path),
  gitCreateWorktree: (id, input) => git.createWorktree(workspaceProject(id).path, createWorktreeSchema.parse(input), vault.preferences().worktrees?.upstreamRefresh ?? 'never'),
  gitFileView: (id, file, staged) => git.fileView(workspaceProject(id).path, gitFileSchema.parse(file), z.boolean().parse(staged)),
  gitStage: (id, paths, staged) => git.stage(workspaceProject(id).path, z.array(pathSchema).min(1).max(1000).parse(paths), z.boolean().parse(staged)),
  gitCommit: (id, message) => git.commit(workspaceProject(id).path, z.string().min(1).max(16_000).parse(message)),
  terminalOpen: (id, geometry) => { const project = workspaceProject(id); return terminals.open(project.id, project.path, terminalGeometrySchema.parse(geometry)); },
  terminalList: (id) => terminals.list(workspaceProject(id).id),
  terminalWrite: (id, data) => terminals.write(idSchema.parse(id), z.string().min(1).max(64_000).parse(data)),
  terminalResize: (id, geometry) => terminals.resize(idSchema.parse(id), terminalGeometrySchema.parse(geometry)),
  terminalClose: (id) => terminals.close(idSchema.parse(id)),
  gitDiff: (id) => projectDiff(workspaceProject(id).path),
  exportThread: async (raw) => {
    const thread = vault.snapshot().threads.find((item) => item.id === idSchema.parse(raw));
    if (!thread) throw new Error('This conversation no longer exists.');
    const result = await dialog.showSaveDialog(window!, { defaultPath: `${thread.title.replace(/[<>:"/\\|?*]/g, '_')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, threadMarkdown(thread), 'utf8');
    return true;
  },
  exportWorkspace: async () => {
    await flushWorkspaceDrafts();
    const result = await dialog.showSaveDialog(window!, { defaultPath: `Nook-backup-${new Date().toISOString().slice(0, 10)}.json.gz`, filters: [{ name: 'Nook 压缩备份', extensions: ['gz'] }, { name: 'JSON 备份', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await backupFiles.write(result.filePath, await extensions.backup());
    return true;
  },
  importWorkspace: async () => {
    assertWorkspaceIdle();
    await flushWorkspaceDrafts();
    const result = await dialog.showOpenDialog(window!, { title: '恢复 Nook 备份', properties: ['openFile'], filters: [{ name: 'Nook 备份', extensions: ['json', 'gz'] }] });
    if (result.canceled) return null;
    const rawBackup: unknown = await backupFiles.read(result.filePaths[0]);
    parsePersistentWorkspace(rawBackup);
    const answer = await dialog.showMessageBox(window!, { type: 'question', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0, message: '恢复备份将替换当前本地工作台。', detail: '当前数据会保存在 workspace.backup.json.gz。备份不含密钥；同一提供商已有密钥将继续使用。' });
    if (answer.response !== 1) return null;
    await automations.suspend();
    try {
      assertWorkspaceIdle();
      await knowledge.stopAll();
      await Promise.all(vault.mcpServers().map((server) => mcp.disconnect(server.id)));
      await Promise.all(vault.snapshot().plugins.map((plugin) => plugins.unload(plugin.id)));
      closeProjectPreviews();
      const restored = await extensions.restore(rawBackup); await desktopIntegration.refresh(); return restored;
    } finally { await automations.resume(); }
  },
  openExternal: async (raw) => {
    const url = z.url().parse(raw);
    if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Only web links can be opened.');
    await shell.openExternal(url);
  },
  windowAction: (raw) => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(raw);
    if (action === 'minimize') window?.minimize();
    if (action === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); }
    if (action === 'close') window?.close();
  },
};

async function finishClose(): Promise<void> {
  closeProjectPreviews();
  if (!quitRequested && desktopIntegration.canHide()) { await quickChatWindow?.flush(); window?.hide(); return; }
  const quit = quitRequested || process.platform !== 'darwin';
  if (quit) browserPanel.close();
  if (quit) { await quickChatWindow?.shutdown(); quitting = true; await desktopIntegration.shutdown(); await automations.shutdown(); await engine.shutdown(); await Promise.all([mcp.shutdown(), plugins.shutdown(), terminals.shutdown(), knowledge.stopAll(), backupFiles.shutdown(), assistantProfiles.shutdown(), promptTemplates.shutdown()]); taskNotifications.forEach((notification) => notification.close()); await vault.flush(); }
  else await quickChatWindow?.flush();
  closeAllowed = true; window?.close();
  if (quit) app.quit();
}

function showWindow(): void {
  if (quitting || quitRequested) return;
  clearTimeout(closeTimer); closeToken = null;
  if (!window) { createWindow(); return; }
  if (window.isMinimized()) window.restore(); window.show(); window.focus();
}
function showQuickChat(): void { if (!quitting && !quitRequested) quickChatWindow.open(); }

function createWindow(): void {
  closeAllowed = false;
  window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 760, minHeight: 540, title: 'Nook', frame: false,
    icon: join(app.getAppPath(), 'identity/qiyao.ico'),
    backgroundColor: '#ffffff', show: false,
    webPreferences: { preload: join(bundleDirectory, '../preload/bridge.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    try {
      const url = new URL(event.url); const plugin = panelPlugin(z.uuid().parse(url.hostname));
      if (!plugin.manifest.panels.some((panel) => pluginAssetUrl(plugin.id, panel.entry) === url.href.split('#')[0])) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  window.once('ready-to-show', () => { window?.show(); });
  window.on('close', (event) => {
    if (closeAllowed) return;
    event.preventDefault();
    if (quitRequested && window?.webContents.isCrashed()) {
      clearTimeout(closeTimer); closeToken = null;
      void finishClose().catch(() => {
        quitting = false; quitRequested = false;
        if (window && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: '窗口数据未能完整保存，应用已保留。', detail: '请检查快速聊天窗口、磁盘空间与工作台目录权限，然后重试。' }).catch(() => {});
      });
      return;
    }
    if (closeToken) return;
    closeToken = randomUUID(); window?.webContents.send('qiyao:before-close', closeToken);
    closeTimer = setTimeout(() => {
      closeToken = null;
      void dialog.showMessageBox(window!, { type: 'warning', buttons: ['取消', '仍然关闭'], defaultId: 0, cancelId: 0, message: '界面没有完成草稿保存。', detail: '仍然关闭可能丢失刚刚输入的内容。' }).then((answer) => { if (answer.response === 1) return finishClose(); quitRequested = false; });
    }, 5000);
  });
  window.on('closed', () => { window = null; for (const request of draftFlushRequests.values()) { clearTimeout(request.timer); request.reject(new Error('The window closed before its drafts were saved.')); } draftFlushRequests.clear(); });
  if (developmentUrl) void window.loadURL(developmentUrl); else void window.loadURL('qiyao://app/index.html');
}

app.setName('Nook');
const startupDiagnostics = new StartupDiagnostics(Boolean(process.env.QIYAO_TEST_STARTUP_DIAGNOSTICS));
if (process.env.QIYAO_TEST_STARTUP_DIAGNOSTICS) Object.defineProperty(globalThis, 'qiyaoStartupDiagnostics', { value: () => startupDiagnostics.snapshot() });
app.setAppUserModelId('app.qiyao.workspace');
app.setPath('userData', userDataDirectory(app.getPath('appData'), process.env.NOOK_DATA_DIRECTORY || process.env.QIYAO_DATA_DIRECTORY));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  if (process.env.NOOK_TEST_LOCAL_CRASH_DUMPS === '1') {
    if (!process.env.NOOK_DATA_DIRECTORY && !process.env.QIYAO_DATA_DIRECTORY) throw new Error('Local crash diagnostics require an explicit isolated workspace directory.');
    const directory = join(app.getPath('userData'), 'local-crash-dumps'); mkdirSync(directory, { recursive: true });
    app.setPath('crashDumps', directory); crashReporter.start({ uploadToServer: false });
    console.error('Local crash diagnostics', JSON.stringify({ directory, uploadToServer: crashReporter.getUploadToServer() }));
  }
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    startupDiagnostics.phase('when-ready');
    protocol.handle('qiyao', async (request) => {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      try { return await net.fetch(pathToFileURL(await appAssetPath(join(bundleDirectory, '../renderer'), request.url)).toString()); }
      catch { return new Response('Not found', { status: 404 }); }
    });
    startupDiagnostics.phase('protocol.ready');
    vault = new WorkspaceVault(app.getPath('userData'), {
      seal: (key) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('System key encryption is unavailable. Check your operating system key store.');
        return safeStorage.encryptString(key).toString('base64');
      },
      open: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    });
    await vault.initialize((phase) => startupDiagnostics.phase(`vault.${phase}`));
    worktreeRoots = new ManagedWorktreeRoots(join(app.getPath('userData'), 'worktrees'));
    startupDiagnostics.phase('services.create');
    composerDrafts = new ComposerDrafts(vault);
    assistantProfiles = new AssistantProfiles(vault);
    promptTemplates = new PromptTemplates(vault);
    skills = new LocalSkills(join(app.getPath('userData'), 'skills'));
    pluginPackages = new LocalPlugins(join(app.getPath('userData'), 'plugins'));
    pluginSettings = new PluginSettings(vault, pluginPackages);
    extensions = new ExtensionSettings(vault, skills, pluginPackages);
    const runtime = new ElectronPluginRuntime(pluginPackages, (id) => vault.snapshot().plugins.find((plugin) => plugin.id === id), bundleDirectory);
    plugins = new PluginHost(vault, pluginPackages, runtime.factory, (view) => {
      if (window && !window.isDestroyed()) window.webContents.send('qiyao:plugin', view);
      if (view.status === 'error') void engine?.stopPlugin(view.id);
    });
    protocol.handle('qiyao-plugin', (request) => runtime.response(request));
    const rendererPermission = (contents: Electron.WebContents | null, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }) => allowRendererPermission({
      permission, owned: Boolean(contents && (contents === window?.webContents || quickChatWindow?.ownsContents(contents))),
      isMainFrame: details.isMainFrame, requestingUrl: details.requestingUrl, mainFrameUrl: contents?.isDestroyed() === false ? contents.mainFrame.url : undefined,
    });
    session.defaultSession.setPermissionRequestHandler((contents, permission, answer, details) => answer(rendererPermission(contents, permission, details)));
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => rendererPermission(contents, permission, details));
    oauthStore = new McpOAuthStore(vault);
    const oauthSessions = new McpOAuthSessions(oauthStore, (url) => shell.openExternal(url), (id) => vault.mcpServer(id));
    mcp = new McpConnections((id) => vault.mcpServer(id), (id) => extensions.credentials(id),
      (view) => { if (window && !window.isDestroyed()) window.webContents.send('qiyao:mcp', view); }, undefined, (config, credentials, signal, interactive, onRedirect) => oauthSessions.create(config, credentials, signal, interactive, onRedirect),
      (event) => { if (window && !window.isDestroyed()) window.webContents.send('qiyao:mcp-resource', event); });
    knowledge = new KnowledgeService(vault, gateway);
    engine = new ConversationEngine(vault, gateway, (event) => { if (window && !window.isDestroyed()) window.webContents.send('qiyao:run', event); quickChatWindow?.emit(event); }, undefined, undefined,
      new ConversationExtensions(mcp, skills, () => vault.snapshot(), plugins), knowledge);
    quickChat = new QuickChat(vault, engine);
    const quickUrl = new URL(process.env.ELECTRON_RENDERER_URL || 'qiyao://app/index.html'); quickUrl.searchParams.set('view', 'quick-chat');
    quickChatWindow = new QuickChatWindow({ quick: quickChat, engine, preload: join(bundleDirectory, '../preload/quick-chat-bridge.cjs'), url: quickUrl.href, icon: join(app.getAppPath(), 'identity/qiyao.ico'),
      content: parent => {
        const originals = new DocumentOriginalFiles(reference => vault.readDocumentOriginal(quickChat.assertOriginal(reference)), async () => {
          const result = await dialog.showSaveDialog(parent, { defaultPath: 'document.pdf', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }] }); return result.canceled ? undefined : result.filePath;
        });
        return { attachFiles: () => attachFiles(parent), importAttachments: raw => attachmentImporter.importInputs(attachmentInputsSchema.parse(raw)),
          readDocumentOriginal: raw => originals.read(raw), exportDocumentOriginal: raw => originals.export(raw), openExternal: async url => { await commands.openExternal(url); } };
      },
      openWorkspace: async settings => {
        await flushMainDrafts(); const loaded = await quickChat.load();
        if (loaded.thread) await composerDrafts.activate(loaded.thread.id);
        showWindow(); window?.webContents.send('nook:workspace-navigation', { threadId: loaded.thread?.id, settings });
      },
    });
    ipcMain.handle('nook:quick-chat', (event, command, ...args) => quickChatWindow.handle(event, command, args));
    messageEdits = new MessageEdits(vault, (id) => engine.active(id));
    automations = new Automations(vault, conversationAutomationRunner(engine, vault), (event) => { if (window && !window.isDestroyed()) window.webContents.send('qiyao:automation', event); }, (task, run) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: task.name, body: run.status === 'complete' ? '自动任务已完成，点击查看对话。' : run.status === 'stopped' ? '自动任务已停止。' : '自动任务未完成，请检查执行记录。' });
      taskNotifications.add(notification); notification.once('close', () => taskNotifications.delete(notification));
      notification.once('click', () => {
        if (quitting || !run.threadId) return;
        const navigate = () => window?.webContents.send('qiyao:automation', { openThreadId: run.threadId });
        if (!window) { createWindow(); window!.webContents.once('did-finish-load', navigate); } else { window.show(); window.focus(); navigate(); }
      }); notification.show();
    });
    startupDiagnostics.phase('automations.resume');
    await automations.resume(); startupDiagnostics.phase('automations.ready'); powerMonitor.on('resume', () => automations.wake());
    providerSettings = new ProviderSettings(vault, async (id) => { await engine.stopProvider(id); await knowledge.stopProvider(id); });
    terminals = new TerminalSessions(spawnPty, (event) => { if (window && !window.isDestroyed()) window.webContents.send('qiyao:terminal', event); });
    desktopIntegration = new DesktopIntegration(vault, {
      createTray: (actions) => {
        const tray = new Tray(join(app.getAppPath(), process.platform === 'win32' ? 'identity/qiyao.ico' : 'identity/qiyao.png'));
        try {
          tray.setToolTip('Nook'); tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 Nook', click: actions.open }, { label: '快速聊天', click: showQuickChat }, { type: 'separator' }, { label: '退出 Nook', click: actions.quit }])); tray.on('click', actions.open);
          return { destroy: () => tray.destroy() };
        } catch (error) { tray.destroy(); throw error; }
      },
      registerShortcut: (accelerator, callback) => globalShortcut.register(accelerator, callback), unregisterShortcut: (accelerator) => globalShortcut.unregister(accelerator),
      open: () => { if (vault.preferences().desktop?.shortcutTarget === 'quick-chat') showQuickChat(); else showWindow(); }, quit: () => app.quit(),
    });
    ipcMain.handle('qiyao:invoke', async (event, command, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted application request.');
      if (typeof command !== 'string' || !Object.hasOwn(commands, command)) throw new Error('Unknown application action.');
      try { const result = await commands[command](...args); if (!['load', 'finishDraftFlush', 'finishWindowClose'].includes(command)) quickChatWindow.refresh(); return result; }
      catch (error) {
        if (error instanceof z.ZodError) throw new Error('Invalid data. Check the form fields or backup file.');
        throw error;
      }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '文件', submenu: [{ label: '备份工作台…', click: () => { void Promise.resolve(commands.exportWorkspace()).catch((error) => { if (window && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', message: '备份未完成', detail: error instanceof Error ? error.message : 'Could not save the workspace backup.' }).catch(() => {}); }); } }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
      { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
      { label: '视图', submenu: [{ label: '快速聊天', accelerator: 'CommandOrControl+Shift+Space', click: showQuickChat }, { type: 'separator' }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
      { label: '帮助', submenu: [{ label: '关于 Nook', click: () => { void dialog.showMessageBox(window!, { message: `Nook ${app.getVersion()}`, detail: '本地 AI 工作台。' }); } }] },
    ]));
    startupDiagnostics.phase('window.create');
    createWindow();
    startupDiagnostics.phase('window.created');
    window!.webContents.once('did-finish-load', () => startupDiagnostics.phase('renderer.loaded'));
    await desktopIntegration.refresh().catch(() => {});
    for (const plugin of vault.snapshot().plugins) if (plugin.enabled) void plugins.load(plugin.id).catch(() => {});
    for (const server of vault.mcpServers()) if (server.enabled && server.autoConnect) void mcp.connect(server.id).catch(() => {});
    startupDiagnostics.phase('startup.complete');
  }).catch((error) => {
    startupDiagnostics.phase('failed');
    if (process.env.QIYAO_TEST_STARTUP_DIAGNOSTICS) console.error('Nook startup diagnostics', JSON.stringify(startupDiagnostics.snapshot()));
    else dialog.showErrorBox('Nook 启动失败', error instanceof Error ? error.message : 'Could not initialize the application.');
    app.exit(1);
  });
  app.on('activate', () => { if (!window && engine) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (event) => {
    if (quitting || !engine) return;
    event.preventDefault();
    quitRequested = true;
    if (window) window.close(); else void finishClose();
  });
}
