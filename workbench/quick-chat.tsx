import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComposerDraft, Message, Thread } from '../contracts/workspace';
import type { QuickChatSnapshot } from '../contracts/quick-chat';
import type { ApprovalRequest } from '../contracts/tools';
import { applyQuickChatEvent, mergeQuickChatThread } from '../contracts/quick-chat-stream';
import { appendPrompt } from '../contracts/prompt-templates';
import { appendMessageQuote } from '../contracts/conversations';
import { Composer } from './components/composer';
import { ComposerDraftStore } from './components/composer-drafts';
import { ContentBridgeContext } from './components/content-bridge';
import { Button, IconButton, Select } from './components/controls';
import { Emblem } from './components/glyphs';
import { MarkdownView } from './components/markdown-view';
import { AttachmentList } from './components/attachments';
import { ToolActivities } from './components/tool-activity';
import { KnowledgeSources } from './components/knowledge-sources';
import { ModelUsage } from './components/model-usage';
import { ApprovalDialog } from './components/approval-dialog';
import { StartupScreen } from './components/startup-screen';
import './theme/quick-chat.css';

const bridge = window.nookQuick;
export default function QuickChatView() {
  const [snapshot, setSnapshot] = useState<QuickChatSnapshot>(), [draft, setDraft] = useState<ComposerDraft>(), [thread, setThread] = useState<Thread>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pinned, setPinned] = useState(true), [collapsed, setCollapsed] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const draftRef = useRef<ComposerDraft | undefined>(undefined), revision = useRef(''), dirty = useRef(false), working = useRef(false), epoch = useRef(0);
  const [saveStatus, setSaveStatus] = useState('输入自动保存');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), scroller = useRef<HTMLDivElement>(null), follows = useRef(true);
  const store = useRef(new ComposerDraftStore(async value => { revision.current = await bridge.save(value, revision.current); epoch.current++; }));
  const report = useCallback((problem: unknown) => { setError((problem instanceof Error ? problem.message : String(problem)).replace(/^Error invoking remote method '[^']+': Error: /, '')); }, []);
  const flush = useCallback(async () => { clearTimeout(timer.current); try { await store.current.flush(); dirty.current = false; setSaveStatus('输入已保存'); } catch (problem) { setSaveStatus('输入尚未保存'); throw problem; } }, []);
  function install(next: QuickChatSnapshot) {
    epoch.current++; setSaveStatus('输入已保存');
    revision.current = next.revision; draftRef.current = next.draft; setDraft(next.draft); store.current.initialize([next.draft]); dirty.current = false;
    setSnapshot(next); setThread(current => mergeQuickChatThread(current, next.thread)); follows.current = true;
  }
  const refresh = useCallback(async () => {
    if (working.current) return;
    const captured = epoch.current; const next = await bridge.load(); if (working.current || captured !== epoch.current) return;
    setSnapshot(next); setThread(current => mergeQuickChatThread(current, next.thread));
    if (dirty.current) {
      if (next.revision !== revision.current) report(new Error('已保存的聊天发生变化，当前输入已保留。请先复制输入，再重新打开快速聊天。'));
      return;
    }
    revision.current = next.revision; draftRef.current = next.draft; setDraft(next.draft); store.current.initialize([next.draft]);
  }, [report]);
  useEffect(() => {
    let active = true;
    void bridge.load().then(next => { if (active) install(next); }).catch(report);
    const resolved = new Set<string>();
    const removeRun = bridge.onRun(event => {
      setThread(current => applyQuickChatEvent(current, event));
      if (event.approval) setApprovals(current => [...current.filter(item => item.id !== event.approval!.id), event.approval!]);
      if (event.approvalResolved) { resolved.add(event.approvalResolved); setApprovals(current => current.filter(item => item.id !== event.approvalResolved)); }
      if (event.error) report(new Error(event.error));
    });
    const removeRefresh = bridge.onRefresh(() => { void refresh().catch(report); });
    const focused = () => { void refresh().catch(report); }; window.addEventListener('focus', focused);
    const removeClose = bridge.onBeforeClose(flush);
    void bridge.pendingApprovals().then(pending => { if (active) setApprovals(current => [...current, ...pending.filter(item => !resolved.has(item.id) && !current.some(known => known.id === item.id))]); }).catch(report);
    return () => { active = false; clearTimeout(timer.current); window.removeEventListener('focus', focused); removeRun(); removeRefresh(); removeClose(); };
  }, [flush, refresh, report]);
  useEffect(() => {
    if (!snapshot) return; const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = snapshot.context.preferences.theme === 'system' ? media.matches ? 'dark' : 'light' : snapshot.context.preferences.theme; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [snapshot?.context.preferences.theme]);
  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (follows.current) element.scrollTo({ top: element.scrollHeight }); });
    if (element.firstElementChild) observer.observe(element.firstElementChild); return () => observer.disconnect();
  }, [thread?.id]);
  useEffect(() => { if (follows.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [thread?.messages, collapsed]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || document.querySelector('dialog[open]')) return;
      event.preventDefault(); void bridge.windowAction('hide').catch(report);
    };
    window.addEventListener('keydown', dismiss); return () => window.removeEventListener('keydown', dismiss);
  }, [report]);
  function update(change: Partial<ComposerDraft>) {
    if (!draftRef.current || working.current) return;
    epoch.current++; setSaveStatus('正在保存输入');
    const next = { ...draftRef.current, ...change, updatedAt: Date.now() }; draftRef.current = next; setDraft(next); dirty.current = true; store.current.stage(next);
    clearTimeout(timer.current); timer.current = setTimeout(() => { void flush().catch(report); }, 250);
  }
  async function act(operation: () => Promise<void>) {
    if (working.current) return; epoch.current++; working.current = true; setBusy(true);
    try { await operation(); } catch (problem) { report(problem); } finally { working.current = false; setBusy(false); }
  }
  async function send(): Promise<boolean> {
    if (working.current) return false; epoch.current++; working.current = true; setBusy(true);
    try { await flush(); await bridge.send(revision.current); install(await bridge.load()); return true; }
    catch (problem) { report(problem); return false; } finally { working.current = false; setBusy(false); }
  }
  const running = thread?.messages.some(message => message.status === 'running') ?? false;
  function quote(message: Message) { try { if (draftRef.current) update({ text: appendMessageQuote(draftRef.current.text, message) }); } catch (problem) { report(problem); } }
  return <ContentBridgeContext value={bridge}><div className={`quick-chat-shell ${collapsed ? 'quick-chat-collapsed' : ''}`}>
    <header className="quick-chat-header"><div className="quick-chat-brand"><Emblem size={20} /><span>快速聊天</span>{running && <span className="stream-dot" aria-label="正在生成" />}</div><div className="quick-chat-actions">
      <IconButton icon="compose" label="新的快速聊天" disabled={busy || !draft} onClick={() => { void act(async () => { await flush(); revision.current = await bridge.activate(undefined, revision.current); install(await bridge.load()); setApprovals([]); }); }} />
      <IconButton icon="panel" label="在工作台中打开" disabled={busy || !draft} onClick={() => { void act(async () => { await flush(); await bridge.openWorkspace(); }); }} />
      <IconButton icon="pin" label={pinned ? '取消窗口置顶' : '窗口置顶'} aria-pressed={pinned} onClick={() => { void bridge.windowAction('pin').then(state => setPinned(state.pinned)).catch(report); }} />
      <IconButton icon={collapsed ? 'down' : 'up'} label={collapsed ? '展开快速聊天' : '收起快速聊天'} aria-expanded={!collapsed} onClick={() => { void bridge.windowAction('collapse').then(state => setCollapsed(state.collapsed)).catch(report); }} />
      <IconButton className="icon-button quick-chat-hide" icon="close" label="隐藏快速聊天" onClick={() => { void bridge.windowAction('hide').catch(report); }} />
    </div></header>
    <div className="quick-chat-body" hidden={collapsed}>
      {!snapshot || !draft ? <StartupScreen error={error} /> : <>
        <div className="quick-chat-conversation"><Select aria-label="快速聊天会话" disabled={busy} value={draft.threadId ?? ''} onChange={event => { const id = event.target.value || undefined; void act(async () => { await flush(); revision.current = await bridge.activate(id, revision.current); install(await bridge.load()); setApprovals(await bridge.pendingApprovals()); }); }}>
          <option value="">新聊天</option>{thread && !snapshot.conversations.some(item => item.id === thread.id) && <option value={thread.id}>{thread.title}</option>}{snapshot.conversations.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </Select><span className="field-hint" role="status">{running ? '正在回复' : saveStatus}</span></div>
        {thread ? <div className="quick-chat-transcript" ref={scroller} onScroll={event => { follows.current = event.currentTarget.scrollHeight - event.currentTarget.clientHeight - event.currentTarget.scrollTop < 100; }}><div className="transcript">
          {thread.messages.map(message => <article className={`message message-${message.role}`} key={message.id} aria-label={message.role === 'user' ? '你的消息' : '助手回复'}>
            {message.role === 'user' ? <div className="user-bubble"><div className="plain-text" data-message-content>{message.content}</div>{message.attachments.length > 0 && <AttachmentList files={message.attachments} />}</div> : <div className="assistant-prose">{Boolean(message.activities?.length) && <ToolActivities activities={message.activities!} />}<div data-message-content><MarkdownView content={message.content} generating={message.status === 'running'} report={report} /></div>{message.status === 'running' && <span className="stream-dot" aria-label="正在生成" />}{message.error && <p className="inline-error">{message.error}</p>}{message.status === 'stopped' && <p className="field-hint">已停止生成</p>}</div>}
            {!running && <div className="message-actions"><IconButton icon="copy" label="复制消息" onClick={() => { void navigator.clipboard.writeText(message.content).catch(report); }} /><IconButton icon="quote" label="引用消息" disabled={!message.content.trim()} onClick={() => quote(message)} /></div>}
            {Boolean(message.invocations?.length) && <ModelUsage invocations={message.invocations!} />}{message.knowledgeSources && <KnowledgeSources sources={message.knowledgeSources} content={message.content} />}
          </article>)}
        </div></div> : <div className="quick-chat-empty"><h1>随时问一句</h1><p>整理想法、读份文档，或继续之前的聊天。</p></div>}
        <div className="quick-chat-composer"><Composer providers={snapshot.context.providers} assistants={snapshot.context.assistants} projects={snapshot.context.projects} messages={thread?.messages ?? []}
          providerId={draft.providerId ?? ''} model={draft.model} assistantId={draft.assistantId ?? ''} projectId={draft.projectId ?? ''} text={draft.text} attachments={draft.attachments}
          onText={text => update({ text })} onProvider={providerId => update({ providerId: providerId || undefined })} onModel={model => update({ model })} onAssistant={assistantId => update({ assistantId: assistantId || undefined })} onProject={projectId => update({ projectId: projectId || undefined })}
          onAttachments={attachments => update({ attachments })} importContext={draft.threadId ?? ''} mode={draft.mode} onMode={mode => update({ mode })}
          servers={snapshot.context.mcpServers} skills={snapshot.context.skills} serverIds={draft.mcpServerIds} skillIds={draft.skillIds} onServers={mcpServerIds => update({ mcpServerIds })} onSkills={skillIds => update({ skillIds })}
          plugins={snapshot.context.plugins} pluginIds={draft.pluginIds} onPlugins={pluginIds => update({ pluginIds })} knowledgeCollections={snapshot.context.knowledgeCollections} hasNotes={snapshot.context.hasNotes} knowledgeCollectionIds={draft.knowledgeCollectionIds ?? []} onKnowledgeCollections={knowledgeCollectionIds => update({ knowledgeCollectionIds })}
          running={running} enterToSend={snapshot.context.preferences.enterToSend} onSend={send} onStop={() => { void bridge.stop().catch(report); }} report={report} onConfigure={() => { void bridge.openWorkspace(true).catch(report); }}
          promptTemplates={snapshot.context.promptTemplates} onPrompt={(text, assistantId) => { if (!draftRef.current) return false; try { update({ text: appendPrompt(draftRef.current.text, text), ...(assistantId ? { assistantId } : {}) }); return true; } catch (problem) { report(problem); return false; } }} />
        </div>
      </>}
      {error && <div className="quick-chat-error" role="alert"><span>{error}</span><Button onClick={() => setError('')}>关闭提示</Button></div>}
    </div>
    {approvals[0] && <ApprovalDialog key={approvals[0].id} request={approvals[0]} report={report} onDecision={allowed => bridge.resolveApproval(approvals[0].id, allowed)} onStop={() => bridge.stop()} />}
  </div></ContentBridgeContext>;
}
