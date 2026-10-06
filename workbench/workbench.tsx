import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import { emptyWorkspace, searchThreads, type ComposerDraft, type Message, type SubmitRequest, type Thread, type Workspace } from '../contracts/workspace';
import { appendMessageQuote, conversationRevision } from '../contracts/conversations';
import { mergeStreamingState } from '../contracts/streaming-state';
import { composerContent, composerRevision, restoreComposer } from '../contracts/composer';
import type { ApprovalRequest, ConversationMode } from '../contracts/tools';
import { Button, Empty, IconButton, Input, Modal } from './components/controls';
import { Emblem, Glyph, type GlyphName } from './components/glyphs';
import { Composer } from './components/composer';
import { StartupScreen } from './components/startup-screen';
import { Transcript } from './components/transcript';
import { PreferencesDialog } from './pages/preferences';
import { Collections } from './pages/collections';
import { Projects } from './pages/project-loader';
import { ApprovalDialog } from './components/approval-dialog';
import { PluginPanel } from './components/plugin-panel';
import { MessageEditor } from './components/message-editor';
import { BranchNavigation } from './components/branch-navigation';
import { ModelComparison } from './components/model-comparison';
import type { ComparisonRequest, ComparisonResult } from '../contracts/model-comparisons';
import type { BranchReorder } from '../contracts/conversation-branches';
import { ComposerDraftStore } from './components/composer-drafts';
import { KnowledgeLibrary } from './pages/knowledge-library';
import { AutomationsPage } from './pages/automations';
import { Toast } from './components/toast';
import { appendPrompt } from '../contracts/prompt-templates';
import { workspaceCommands, type ProjectView, type WorkspaceCommand, type WorkspacePage } from '../contracts/commands';
import { CommandPalette } from './components/command-palette';

type Page = WorkspacePage | 'plugin';
export function Workbench() {
  const [state, storeState] = useState<Workspace | null>(null);
  const setState = useCallback((next: SetStateAction<Workspace | null>) => {
    storeState((current) => mergeStreamingState(current, typeof next === 'function' ? next(current) : next));
  }, []);
  const [page, setPage] = useState<Page>('chat');
  const [projectView, setProjectView] = useState<ProjectView>(() => ({ projectId: localStorage.getItem('qiyao.project') ?? '', panel: 'editor', files: true, terminal: false }));
  const projectContext = useRef<ProjectView | undefined>(undefined);
  projectContext.current = page === 'projects' ? projectView : undefined;
  const [pluginPanel, setPluginPanel] = useState({ pluginId: '', panelId: '' });
  const [composerDraft, setComposerDraft] = useState<ComposerDraft>(() => restoreComposer(emptyWorkspace()));
  const draftRef = useRef(composerDraft);
  const pendingComposerFocus = useRef<ComposerDraft | undefined>(undefined);
  const draftStore = useRef(new ComposerDraftStore((draft) => window.qiyao.saveComposerDraft(draft)));
  const draftEpoch = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activation = useRef<Promise<void>>(Promise.resolve());
  const { text, model, mode, attachments, mcpServerIds: serverIds, skillIds, pluginIds, knowledgeCollectionIds = [] } = composerDraft;
  const threadId = composerDraft.threadId ?? ''; const providerId = composerDraft.providerId ?? '';
  const assistantId = composerDraft.assistantId ?? ''; const projectId = composerDraft.projectId ?? '';
  useLayoutEffect(() => {
    const requested = pendingComposerFocus.current;
    pendingComposerFocus.current = undefined;
    if (requested !== composerDraft || page !== 'chat') return;
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]');
    input?.focus(); input?.setSelectionRange(input.value.length, input.value.length);
  }, [composerDraft, page]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [sidebar, setSidebar] = useState(true);
  const [startingTemporary, setStartingTemporary] = useState(false);
  const [comparison, setComparison] = useState<{ draft: ComposerDraft; source?: Thread; groupId?: string } | null>(null);
  const [settings, setSettings] = useState(false);
  const [requestedTaskThread, setRequestedTaskThread] = useState<string | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [findRequest, setFindRequest] = useState(0); const findContext = useRef<string | undefined>(undefined);
  const [error, setError] = useState('');
  const [startupError, setStartupError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ thread: Thread; message: Message; context: Omit<SubmitRequest, 'text' | 'attachments' | 'replay'>; epoch: number } | null>(null);
  const report = useCallback((problem: unknown) => {
    const message = problem instanceof Error ? problem.message : String(problem);
    setError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
  }, []);
  function updateDraft(change: Partial<ComposerDraft>) {
    if (change.text && change.text.length > 256_000) { report(new Error('消息草稿超过 256 KB；请选择较短的内容。')); return; }
    const next = { ...draftRef.current, ...change, updatedAt: Date.now() };
    draftRef.current = next; setComposerDraft(next); draftStore.current.stage(next);
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void draftStore.current.flush().catch(report); }, 250);
  }
  function setText(value: string | ((current: string) => string)) { updateDraft({ text: typeof value === 'function' ? value(draftRef.current.text) : value }); }
  function setProviderId(id: string) { updateDraft({ providerId: id || undefined }); }
  function setModel(value: string) { updateDraft({ model: value }); }
  function setAssistantId(id: string) { updateDraft({ assistantId: id || undefined }); }
  function setProjectId(id: string) { updateDraft({ projectId: id || undefined }); }
  function setMode(value: ConversationMode) { updateDraft({ mode: value }); }
  function setServerIds(ids: string[]) { updateDraft({ mcpServerIds: ids }); }
  function setSkillIds(ids: string[]) { updateDraft({ skillIds: ids }); }
  function setPluginIds(value: string[] | ((current: string[]) => string[])) { updateDraft({ pluginIds: typeof value === 'function' ? value(draftRef.current.pluginIds) : value }); }
  function setKnowledgeCollectionIds(ids: string[]) { updateDraft({ knowledgeCollectionIds: ids }); }
  async function flushDrafts() { clearTimeout(draftTimer.current); await draftStore.current.flush(); await activation.current; }
  function selectDraft(next: ComposerDraft) {
    draftRef.current = next; setComposerDraft(next); setPage('chat');
    clearTimeout(draftTimer.current);
    activation.current = draftStore.current.activate(next.threadId, (id, drafts) => window.qiyao.activateThread(id, drafts), state?.threads.find(item => item.id === next.threadId)?.temporary === true); void activation.current.catch(report);
  }
  const thread = state?.threads.find((item) => item.id === threadId);
  findContext.current = page === 'chat' ? thread?.id : undefined;
  useEffect(() => { setFindRequest(0); }, [page, threadId]);
  const originalThread = thread?.forkedFrom && state?.threads.find((item) => item.id === thread.forkedFrom!.threadId);
  const running = thread?.messages.some((message) => message.status === 'running') ?? false;
  const recent = state ? searchThreads(state.threads.filter((item) => !item.archived), '') : [];
  useEffect(() => {
    if (!window.qiyao) { setStartupError('请通过 Nook 桌面应用打开工作台。'); return; }
    const resolved = new Set<string>();
    void window.qiyao.load().then((next) => { setState(next); draftStore.current.initialize(next.composerDrafts); const active = next.threads.find((item) => item.id === next.activeThreadId); const restored = restoreComposer(next, active, draftStore.current.get(active?.id)); draftRef.current = restored; setComposerDraft(restored); }).catch(() => setStartupError('读取本地工作台失败。请重新加载；如果仍然失败，请检查磁盘空间与目录访问权限。'));
    void window.qiyao.pendingApprovals().then((pending) => setApprovals((current) => [...current, ...pending.filter((item) => !resolved.has(item.id) && !current.some((known) => known.id === item.id))])).catch(report);
    return window.qiyao.onRun((event) => {
      if (event.approval) setApprovals((current) => [...current.filter((item) => item.id !== event.approval!.id), event.approval!]);
      if (event.approvalResolved) { resolved.add(event.approvalResolved); setApprovals((current) => current.filter((item) => item.id !== event.approvalResolved)); }
      if (event.error) report(new Error(event.error));
      if (event.state) setState(event.state);
      else if (event.delta || event.activity || event.message || event.invocation) setState((current) => {
        if (!current) return current;
        return { ...current, threads: current.threads.map((item) => item.id !== event.threadId ? item : { ...item, messages: item.messages.map((message) => {
          if (message.id !== event.messageId) return message;
          if (event.message) return event.message;
          const activities = event.activity ? [...(message.activities ?? []).filter((activity) => activity.id !== event.activity!.id), event.activity] : message.activities;
          const invocations = event.invocation ? [...(message.invocations ?? []).filter((item) => item.round !== event.invocation!.round), event.invocation].sort((a, b) => a.round - b.round) : message.invocations;
          return { ...message, activities, invocations, content: message.content + (event.delta ?? '') };
        }) }) };
      });
    });
  }, [report]);
  useEffect(() => window.qiyao?.onBeforeClose(flushDrafts), []);
  useEffect(() => () => { clearTimeout(draftTimer.current); void draftStore.current.flush().catch(report); }, []);
  useEffect(() => {
    if (!state) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    function applyTheme() { document.documentElement.dataset.theme = state!.preferences.theme === 'system' ? media.matches ? 'dark' : 'light' : state!.preferences.theme; }
    applyTheme(); media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [state?.preferences.theme]);
  useEffect(() => {
    if (state && !state.providers.some((item) => item.id === providerId)) { setProviderId(state.preferences.defaultProviderId ?? ''); setModel(state.preferences.defaultModel); }
  }, [state?.providers, providerId]);
  useEffect(() => window.qiyao?.onPlugin((view) => { if (view.status === 'error') void window.qiyao.load().then(setState).catch(report); }), [report]);
  useEffect(() => window.qiyao?.onAutomation((event) => { if (event.state) setState(event.state); if (event.error) report(new Error(event.error)); if (event.openThreadId) setRequestedTaskThread(event.openThreadId); }), [report]);
  useEffect(() => { if (requestedTaskThread && state) { const target = state.threads.find((thread) => thread.id === requestedTaskThread); if (target) openThread(target); else report(new Error('任务生成的对话已被删除。')); setRequestedTaskThread(null); } }, [requestedTaskThread, state]);
  useEffect(() => { if (state) { const ids = pluginIds.filter((id) => state.plugins.some((plugin) => plugin.id === id && plugin.enabled && plugin.grants.includes('tools'))); if (ids.length !== pluginIds.length) setPluginIds(ids); } }, [state?.plugins]);
  useEffect(() => { if (state) { const ids = knowledgeCollectionIds.filter((id) => id === 'notes' || state.knowledgeCollections.some((item) => item.id === id)); if (ids.length !== knowledgeCollectionIds.length) setKnowledgeCollectionIds(ids); } }, [state?.knowledgeCollections]);
  useEffect(() => { if (state && assistantId && !state.assistants.some((item) => item.id === assistantId)) setAssistantId(''); }, [state?.assistants, assistantId]);
  function newChat() { if (state) selectDraft(restoreComposer(state, undefined, draftStore.current.get())); }
  async function newTemporaryChat(): Promise<void> {
    if (startingTemporary) return;
    setStartingTemporary(true);
    try {
      await flushDrafts();
      const next = await window.qiyao.startTemporaryChat();
      const target = next.threads.find((item) => item.id === next.activeThreadId)!;
      setState(next); selectDraft(restoreComposer(next, target)); setSearch(null);
    } catch (problem) { report(problem); }
    finally { setStartingTemporary(false); }
  }
  function openThread(target: Thread) {
    if (state) selectDraft(restoreComposer(state, target, draftStore.current.get(target.id))); setSearch(null);
  }
  async function openReplyVersion(id: string): Promise<void> {
    const next = await window.qiyao.load(); const target = next.threads.find((item) => item.id === id);
    if (!target) { setState(next); throw new Error('This conversation no longer exists. Select another version or branch.'); }
    const saved = draftStore.current.get(id) ?? next.composerDrafts.find((item) => item.threadId === id);
    const restored = restoreComposer(next, target, saved); draftStore.current.stage(restored); setState(next); selectDraft(restored);
  }
  async function openMessageEditor(message: Message, targetId = thread?.id, context = submissionContext()): Promise<void> {
    const next = await window.qiyao.load(); const target = next.threads.find((item) => item.id === targetId); const selected = target?.messages.find((item) => item.id === message.id);
    if (!target || !selected) throw new Error('This message no longer exists. Reopen the current conversation.');
    setState(next); setEditing({ thread: target, message: selected, context: { ...context, threadId: target.id }, epoch: (editing?.epoch ?? 0) + 1 });
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.isComposing || editing || document.querySelector('dialog[open]')) return;
      if (event.altKey && /^[1-9]$/.test(event.key)) { const target = recent[Number(event.key) - 1]; if (target) { event.preventDefault(); openThread(target); } }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); newChat(); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSearch(''); }
      if (event.key.toLowerCase() === 'f' && findContext.current) { event.preventDefault(); setFindRequest((value) => value + 1); }
      if (event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setSearch('>'); }
      if (event.key === ',') { event.preventDefault(); setSettings(true); }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebar((value) => !value); }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [recent, state, editing]);
  useEffect(() => { if (error) { const timer = setTimeout(() => setError(''), 12_000); return () => clearTimeout(timer); } }, [error]);
  function submissionContext(draft = draftRef.current): Omit<SubmitRequest, 'text' | 'attachments' | 'replay'> {
    return { threadId: draft.threadId, providerId: draft.providerId ?? '', model: draft.model, mode: draft.mode, assistantId: draft.assistantId, projectId: draft.projectId, mcpServerIds: draft.mode === 'plan' ? [] : draft.mcpServerIds, skillIds: draft.skillIds, pluginIds: draft.mode === 'plan' ? [] : draft.pluginIds, knowledgeCollectionIds: draft.knowledgeCollectionIds ?? [] };
  }
  async function send(): Promise<boolean> {
    const submitted = structuredClone(draftRef.current);
    try {
      await flushDrafts();
      const result = await window.qiyao.submit({ ...submissionContext(submitted), text: submitted.text, attachments: submitted.attachments, composerRevision: await composerRevision(submitted) });
      draftStore.current.consume(submitted);
      if (composerContent(draftRef.current) === composerContent(submitted)) {
        selectDraft({ ...submitted, threadId: result.threadId, text: '', attachments: [], updatedAt: Date.now() });
      }
      return true;
    } catch (problem) { report(problem); return false; }
  }
  async function mutate(target: Thread) { try { setState(await window.qiyao.updateThread(target)); } catch (problem) { report(problem); } }
  async function compareModels(models: ComparisonRequest['models']): Promise<ComparisonResult> {
    if (!comparison) throw new Error('请重新打开模型比较。');
    await flushDrafts();
    const { draft, source } = comparison;
    if (draft.threadId && !source) throw new Error('当前聊天已被删除，请重新选择比较上下文。');
    const result = await window.qiyao.compareModels({ text: draft.text, attachments: draft.attachments, models, assistantId: draft.assistantId, projectId: draft.projectId,
      ...(source ? { threadId: source.id, revision: await conversationRevision(source) } : {}) });
    return result;
  }
  async function reorderBranch(input: BranchReorder): Promise<Workspace> { const next = await window.qiyao.reorderBranch(input); setState(next); return next; }
  async function branch(message: Message) {
    if (!thread) return;
    try { const next = await window.qiyao.forkThread(thread.id, message.id); setState(next); openThread(next.threads[next.threads.length - 1]); } catch (problem) { report(problem); }
  }
  function quote(message: Message, selection?: string) {
    try { setText(appendMessageQuote(draftRef.current.text, message, selection)); pendingComposerFocus.current = draftRef.current; }
    catch (problem) { report(problem); }
  }
  function insertPrompt(prompt: string, recipeAssistantId?: string): boolean {
    try {
      if (recipeAssistantId && !state?.assistants.some((item) => item.id === recipeAssistantId)) throw new Error('关联的助手已移除。请重新选择模板助手。');
      updateDraft({ text: appendPrompt(draftRef.current.text, prompt), ...(recipeAssistantId ? { assistantId: recipeAssistantId } : {}) }); setPage('chat');
      pendingComposerFocus.current = draftRef.current; return true;
    } catch (problem) { report(problem); return false; }
  }
  async function retry() {
    if (!thread || running) return;
    const index = thread.messages.findLastIndex((message) => message.role === 'user');
    if (index < 0) return;
    const user = thread.messages[index];
    const context = submissionContext();
    try {
      await flushDrafts();
      await window.qiyao.submit({ ...context, threadId: thread.id, text: user.content, attachments: user.attachments, replay: { messageId: user.id, revision: await conversationRevision(thread), action: 'retry' } });
    } catch (problem) { report(problem); }
  }
  async function executeCommand(command: WorkspaceCommand): Promise<boolean> {
    await flushDrafts(); const current = await window.qiyao.load(); let target = command.target;
    if (target.kind === 'thread') { const id = target.threadId; const chosen = current.threads.find((thread) => thread.id === id); if (!chosen) throw new Error('This conversation no longer exists. Refresh the command menu.'); setState(current); selectDraft(restoreComposer(current, chosen, draftStore.current.get(id))); return true; }
    const views = await window.qiyao.pluginViews(); const available = workspaceCommands(current, { sidebar, threadId: draftRef.current.threadId, findThreadId: findContext.current, project: projectContext.current, views }).find((item) => item.key === command.key);
    if (!available || available.disabled) throw new Error('This command is no longer available. Refresh the command menu.'); target = available.target;
    if (target.kind === 'action') { if (target.action === 'new') { setState(current); selectDraft(restoreComposer(current, undefined, draftStore.current.get())); } else if (target.action === 'settings') setSettings(true); else if (target.action === 'sidebar') setSidebar((value) => !value); }
    else if (target.kind === 'page') { setState(current); setPage(target.page); }
    else if (target.kind === 'project-panel') { const action = target; setProjectView((view) => view.projectId !== action.projectId ? view : { ...view, ...(action.panel === 'review' ? { panel: action.visible ? 'changes' : 'editor' } : { [action.panel]: action.visible }) }); }
    else if (target.kind === 'find') { if (draftRef.current.threadId !== target.threadId) throw new Error('This conversation no longer exists. Refresh the command menu.'); setState(current); setFindRequest((value) => value + 1); }
    else if (target.kind === 'theme') setState(await window.qiyao.savePreferences({ ...current.preferences, theme: target.theme }));
    else if (target.kind === 'plugin-panel') { setState(current); setPluginPanel({ pluginId: target.pluginId, panelId: target.panelId }); setPage('plugin'); }
    else if (target.kind === 'thread-action') { const id = target.threadId; const chosen = current.threads.find((thread) => thread.id === id)!; if (target.action === 'rename') { setState(current); setRenaming(chosen.title); } else if (target.action === 'export') return window.qiyao.exportThread(id); else setState(await window.qiyao.updateThread({ ...chosen, ...(target.action === 'pin' ? { pinned: !chosen.pinned } : { archived: !chosen.archived }) })); }
    return true;
  }
  const navigation: { page: Page; icon: GlyphName; label: string }[] = [{ page: 'projects', icon: 'folder', label: '项目' }, { page: 'assistants', icon: 'assistant', label: '助手' }, { page: 'library', icon: 'library', label: '资料库' }, { page: 'automations', icon: 'clock', label: '自动任务' }];
  const panelPlugin = state?.plugins.find((plugin) => plugin.id === pluginPanel.pluginId && plugin.enabled && plugin.grants.includes('panels'));
  const pluginContent = <div className="plugin-workspace">{panelPlugin ? <PluginPanel key={`${pluginPanel.pluginId}:${pluginPanel.panelId}`} plugin={panelPlugin} panelId={pluginPanel.panelId} onClose={() => setPage('chat')} report={report} /> : <Empty icon="code" title="插件面板不可用" detail="请检查插件的启用状态和面板权限。" action={<Button onClick={() => setSettings(true)}>打开设置</Button>} />}</div>;
  const composer = state && <Composer temporary={thread?.temporary} promptTemplates={state.promptTemplates} onPrompt={insertPrompt} key={threadId || 'new'} importContext={`${draftEpoch.current}/${threadId}`} messages={thread?.messages ?? []} attachments={attachments} onAttachments={(files) => updateDraft({ attachments: files })} knowledgeCollections={state.knowledgeCollections} hasNotes={state.notes.length > 0} knowledgeCollectionIds={knowledgeCollectionIds} onKnowledgeCollections={setKnowledgeCollectionIds} plugins={state.plugins} pluginIds={pluginIds} onPlugins={setPluginIds} servers={state.mcpServers} skills={state.skills} serverIds={serverIds} skillIds={skillIds} onServers={setServerIds} onSkills={setSkillIds} providers={state.providers} assistants={state.assistants} projects={state.projects} providerId={providerId} model={model} assistantId={assistantId} projectId={projectId} mode={mode} onMode={setMode} text={text} onText={setText} onProvider={(id) => { setProviderId(id); setModel(state.providers.find((item) => item.id === id)?.models[0] ?? ''); }} onModel={setModel} onAssistant={setAssistantId} onProject={(id) => { setProjectId(id); if (!id) setMode('chat'); }} onSend={send} onStop={() => { void window.qiyao.stop(threadId).catch(report); }} running={running} enterToSend={state.preferences.enterToSend} onCompare={() => setComparison({ draft: structuredClone(draftRef.current), source: thread && structuredClone(thread) })} onViewComparison={thread?.comparison ? () => setComparison({ draft: structuredClone(draftRef.current), source: structuredClone(thread), groupId: thread.comparison!.groupId }) : undefined} onConfigure={() => setSettings(true)} report={report} />;
  const library = state && <KnowledgeLibrary state={state} onState={setState} report={report} onUse={(type, id) => { if (type === 'collection') { newChat(); setKnowledgeCollectionIds([id]); } else { const note = state.notes.find((item) => item.id === id); if (!note) return; const next = `请参考以下资料回答我的问题：\n\n${note.title}\n${note.content}\n\n我的问题：`; if (next.length > 256_000) { report(new Error('这份资料较长，请使用资料集检索并输入问题。')); return; } newChat(); setText(next); } }} />;
  return <div className={`app-shell ${sidebar ? '' : 'sidebar-hidden'}`}>
    <header className="window-chrome"><div className="window-title"><Emblem size={20} /><span>Nook</span></div><div className="window-actions"><IconButton icon="minimize" label="最小化" onClick={() => { void window.qiyao.windowAction('minimize'); }} /><IconButton icon="maximize" label="最大化或还原" onClick={() => { void window.qiyao.windowAction('maximize'); }} /><IconButton icon="close" label="关闭窗口" onClick={() => { void window.qiyao.windowAction('close'); }} /></div></header>
    {sidebar && <aside className="sidebar"><div className="sidebar-brand"><Emblem size={32} /><div><strong>Nook</strong></div><IconButton icon="panel" label="收起侧边栏" onClick={() => setSidebar(false)} /></div><div className="sidebar-main"><nav className="primary-nav"><Button className={page === 'chat' && !threadId ? 'nav-row selected' : 'nav-row'} title="新聊天" onClick={newChat}><Glyph name="compose" />新聊天<kbd>Ctrl N</kbd></Button><Button className="nav-row" title="临时聊天" disabled={!state || startingTemporary} onClick={() => { void newTemporaryChat(); }}><Glyph name="compose" />临时聊天</Button><Button className="nav-row" title="搜索聊天" onClick={() => setSearch('')}><Glyph name="search" />搜索聊天<kbd>Ctrl K</kbd></Button>{navigation.map((item) => <Button key={item.page} title={item.label} className={`nav-row ${page === item.page ? 'selected' : ''}`} onClick={() => setPage(item.page)}><Glyph name={item.icon} />{item.label}</Button>)}</nav><div className="sidebar-section-label">最近聊天<span>{recent.length || ''}</span></div><div className="thread-list">{recent.slice(0, 100).map((item) => <Button key={item.id} title={item.temporary ? `临时 · ${item.title}` : item.title} className={`thread-row ${threadId === item.id && page === 'chat' ? 'selected' : ''}`} onClick={() => openThread(item)}>{item.pinned && <Glyph name="pin" size={12} />}<span>{item.temporary ? `临时 · ${item.title}` : item.title}</span>{item.messages.some((message) => message.status === 'running') && <span className="stream-dot" />}</Button>)}{recent.length === 0 && <p className="sidebar-empty">暂无聊天</p>}</div></div><footer className="sidebar-footer"><Button className="nav-row" title="已归档" onClick={() => setPage('archive')}><Glyph name="archive" />已归档</Button><Button className="nav-row" title="设置" onClick={() => setSettings(true)}><Glyph name="settings" />设置<kbd>Ctrl ,</kbd></Button><div className="local-indicator"><span className="status-dot" />本地工作台<span>NOOK</span></div></footer></aside>}
    <main className="workspace"><header className="workspace-header"><div>{!sidebar && <IconButton icon="panel" label="展开侧边栏" onClick={() => setSidebar(true)} />}{page === 'chat' ? thread ? <Button className="thread-title" title={thread.title} onClick={() => setRenaming(thread.title)}><span>{thread.title}</span><Glyph name="down" size={14} /></Button> : <span className="muted">新聊天</span> : <span>{page === 'plugin' ? panelPlugin?.manifest.panels.find((panel) => panel.id === pluginPanel.panelId)?.title ?? '插件面板' : navigation.find((item) => item.page === page)?.label ?? '已归档'}</span>}</div><div className="header-actions"><IconButton icon="search" label="打开命令面板" disabled={!state} onClick={() => setSearch('>')} />{page === 'chat' && thread && state && <><IconButton icon="find" label="查找当前聊天" onClick={() => setFindRequest((value) => value + 1)} />{originalThread && <IconButton icon="branch" label="打开原对话" onClick={() => openThread(originalThread)} />}<BranchNavigation onReorder={reorderBranch} key={thread.id} thread={thread} threads={state.threads} onSelect={async (id) => { await flushDrafts(); await openReplyVersion(id); }} /><IconButton icon="pin" label={thread.pinned ? '取消置顶' : '置顶聊天'} disabled={running} onClick={() => { void mutate({ ...thread, pinned: !thread.pinned }); }} /><IconButton icon="download" label="导出聊天" onClick={() => { void window.qiyao.exportThread(thread.id).catch(report); }} /><IconButton icon="archive" label={thread.archived ? '取消归档' : '归档聊天'} disabled={running} onClick={() => { void mutate({ ...thread, archived: !thread.archived }); }} /><IconButton icon="trash" label="删除聊天" disabled={running} onClick={() => setDeleteId(thread.id)} /></>}</div></header>
    {!state ? <StartupScreen error={startupError} /> : page === 'chat' ? thread ? <div className="chat-page"><Transcript findRequest={findRequest} onFindClose={() => setFindRequest(0)} thread={thread} threads={state.threads} onVersion={openReplyVersion} onEdit={(message) => { void openMessageEditor(message).catch(report); }} onQuote={quote} onBranch={(message) => { void branch(message); }} onRetry={() => { void retry(); }} report={report} /><div className="composer-dock">{composer}</div></div> : <div className="home"><div className="home-content"><h1>今天想做些什么？</h1><p className="home-description">提问、整理资料，或开始一个项目。</p>{composer}<div className="suggestions">{[{ icon: 'assistant', label: '理清一个想法', prompt: '我有一个想法，想请你帮我梳理。请先问我几个关键问题。' }, { icon: 'compose', label: '一起写点什么', prompt: '请帮我完善一段文字。我会提供初稿和希望的风格。' }, { icon: 'code', label: '开始一个项目', prompt: '我想开始一个新项目。请帮我明确需求，规划实现步骤。' }].map((item) => <Button key={item.label} onClick={() => setText(item.prompt)}><Glyph name={item.icon as GlyphName} size={16} />{item.label}</Button>)}</div></div><div className="home-footnote"><span>回答可能有误，请核实重要信息。</span></div></div> : page === 'plugin' ? pluginContent : page === 'projects' ? <Projects view={projectView} onView={setProjectView} state={state} onState={setState} onUse={(id) => { newChat(); setProjectId(id); }} report={report} /> : page === 'library' ? library : page === 'automations' ? <AutomationsPage state={state} onState={setState} report={report} onOpen={setRequestedTaskThread} /> : page === 'assistants' ? <Collections onPrompt={insertPrompt} state={state} onState={setState} report={report} onUse={(id) => { newChat(); setAssistantId(id); }} /> : <div className="collection-page"><div className="page-heading"><div><h1>已归档</h1><p>为重要的对话留一个安静的地方。</p></div></div>{state.threads.filter((item) => item.archived).length ? state.threads.filter((item) => item.archived).map((item) => <div className="list-row" key={item.id}><Button className="row-content" onClick={() => openThread(item)}><strong>{item.title}</strong><span>{item.messages.length} 条消息</span></Button><Button onClick={() => { void mutate({ ...item, archived: false }); }}>恢复聊天</Button></div>) : <Empty icon="archive" title="暂无归档聊天" detail="归档后，对话会从最近聊天移到这里。" />}</div>}
    </main>
    {error && state && <Toast message={error} onClose={() => setError('')} />}
    {comparison && state && <ModelComparison state={state} draft={comparison.draft} groupId={comparison.groupId} onClose={() => setComparison(null)} onCompare={compareModels} onOpen={async (id) => { await flushDrafts(); await openReplyVersion(id); }} />}
    {settings && state && <PreferencesDialog state={state} onState={setState} onRestore={(next) => { clearTimeout(draftTimer.current); draftEpoch.current++; draftStore.current.initialize(next.composerDrafts); setState(next); const target = next.threads.find((item) => item.id === next.activeThreadId); const restored = restoreComposer(next, target, draftStore.current.get(target?.id)); draftRef.current = restored; setComposerDraft(restored); }} onClose={() => setSettings(false)} report={report} onOpenPanel={(pluginId, panelId) => { setPluginPanel({ pluginId, panelId }); setPage('plugin'); setSettings(false); }} onUseContent={(content) => { setText((current) => current ? `${current}\n\n${content}` : content); setPage('chat'); setSettings(false); }} />}
    {approvals[0] && <ApprovalDialog key={approvals[0].id} request={approvals[0]} onDecision={(allowed) => window.qiyao.resolveApproval(approvals[0].id, allowed)} onStop={() => window.qiyao.stop(approvals[0].threadId)} report={report} />}
    {editing && <MessageEditor key={JSON.stringify([editing.thread.id, editing.message.id, editing.epoch])} thread={editing.thread} message={editing.message} onClose={() => setEditing(null)} onDiscard={() => openMessageEditor(editing.message, editing.thread.id, editing.context)} onSave={async (content, revision) => { await flushDrafts(); const next = await window.qiyao.editMessage({ threadId: editing.thread.id, messageId: editing.message.id, content, revision }); setState(next); setEditing(null); }} onSubmit={async (content, revision) => { await flushDrafts(); const result = await window.qiyao.submit({ ...editing.context, text: content, attachments: [], replay: { messageId: editing.message.id, revision, action: 'edit' } }); selectDraft({ ...draftRef.current, threadId: result.threadId }); updateDraft({}); setEditing(null); }} />}
    {search !== null && state && <CommandPalette state={state} context={{ sidebar, threadId: thread?.id, findThreadId: findContext.current, project: projectContext.current }} query={search} onQuery={setSearch} onState={setState} onClose={() => setSearch(null)} onExecute={executeCommand} onPluginCommand={async (command, args, selectedProject) => { if (command.target.kind !== 'plugin-command') throw new Error('This plugin command is no longer available.'); await flushDrafts(); return window.qiyao.pluginCommand(command.target.pluginId, command.target.commandId, args, selectedProject); }} />}
    {renaming !== null && thread && <Modal title="重命名聊天" onClose={() => setRenaming(null)} footer={<><Button onClick={() => setRenaming(null)}>取消</Button><Button tone="solid" disabled={!renaming.trim()} onClick={() => { void mutate({ ...thread, title: renaming.trim() }); setRenaming(null); }}>保存</Button></>}><Input autoFocus aria-label="聊天名称" maxLength={160} value={renaming} onChange={(event) => setRenaming(event.target.value)} /></Modal>}
    {deleteId && <Modal title="删除聊天？" onClose={() => setDeleteId(null)} footer={<><Button onClick={() => setDeleteId(null)}>取消</Button><Button tone="danger" onClick={() => { void flushDrafts().then(() => window.qiyao.deleteThread(deleteId)).then((next) => { draftStore.current.forget(deleteId); setState(next); setDeleteId(null); if (threadId === deleteId) selectDraft(restoreComposer(next, undefined, draftStore.current.get())); }).catch(report); }}>删除</Button></>}><p>这段聊天及其未发送草稿将从本机永久删除。需要保留时，可以先导出聊天。</p></Modal>}
  </div>;
}
