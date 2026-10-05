import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Assistant, Attachment, Message, Project, Provider } from '../../contracts/workspace';
import type { ConversationMode } from '../../contracts/tools';
import { Button, IconButton, Modal, Select, Toggle } from './controls';
import { Glyph } from './glyphs';
import type { McpServer, Skill } from '../../contracts/extensions';
import type { Plugin } from '../../contracts/plugins';
import { modelContext } from './model-context';
import { AttachmentList, attachmentInputs } from './attachments';
import type { KnowledgeCollection } from '../../contracts/knowledge';
import type { PromptTemplate } from '../../contracts/prompt-templates';
import { PromptUseDialog } from './prompt-use-dialog';

type Props = {
  temporary?: boolean;
  providers: Provider[]; assistants: Assistant[]; projects: Project[]; messages: Message[];
  providerId: string; model: string; assistantId: string; projectId: string;
  text: string; onText: (text: string) => void; onProvider: (id: string) => void; onModel: (model: string) => void;
  attachments: Attachment[]; onAttachments: (attachments: Attachment[]) => void; importContext: string;
  onAssistant: (id: string) => void; onProject: (id: string) => void;
  mode: ConversationMode; onMode: (mode: ConversationMode) => void;
  servers: McpServer[]; skills: Skill[]; serverIds: string[]; skillIds: string[];
  onServers: (ids: string[]) => void; onSkills: (ids: string[]) => void;
  plugins: Plugin[]; pluginIds: string[]; onPlugins: (ids: string[]) => void;
  knowledgeCollections: KnowledgeCollection[]; hasNotes: boolean; knowledgeCollectionIds: string[]; onKnowledgeCollections: (ids: string[]) => void;
  onSend: () => Promise<boolean>; onStop: () => void; running: boolean; enterToSend: boolean;
  onCompare: () => void; onViewComparison?: () => void;
  onConfigure: () => void; report: (error: unknown) => void;
  promptTemplates: PromptTemplate[]; onPrompt: (text: string, assistantId?: string) => boolean;
};

export function Composer(props: Props) {
  const { attachments } = props;
  const [submitting, setSubmitting] = useState(false);
  const [extensions, setExtensions] = useState(false);
  const [knowledge, setKnowledge] = useState(false);
  const [prompts, setPrompts] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const mounted = useRef(true);
  const importContext = useRef(props.importContext);
  importContext.current = props.importContext;
  const dragDepth = useRef(0);
  const busy = submitting || importing;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const count = (props.mode === 'plan' ? 0 : props.serverIds.length + props.pluginIds.length) + props.skillIds.length;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const provider = props.providers.find((item) => item.id === props.providerId);
  const context = provider ? modelContext(provider, props.model, props.messages) : undefined;
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    const resize = () => { node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px`; };
    resize();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [props.text]);
  async function send() {
    if (!props.text.trim() || busy || props.running) return;
    if (!provider || !props.model) { props.onConfigure(); return; }
    setSubmitting(true);
    try { if (await props.onSend()) textarea.current?.focus(); }
    finally { setSubmitting(false); }
  }
  async function attach(dropped?: File[]) {
    if (busy) return;
    const context = importContext.current;
    setImporting(true);
    try {
      const files = dropped ? await window.qiyao.importAttachments(await attachmentInputs(dropped)) : await window.qiyao.attachFiles();
      if (!files.length) return;
      if (!mounted.current || context !== importContext.current) throw new Error('附件导入期间已切换页面或恢复备份，文件未添加。请在目标会话重新导入。');
      if (attachments.length + files.length > 12) throw new Error('每条消息最多添加 12 个附件。');
      props.onAttachments([...attachments, ...files]);
    } catch (error) { props.report(error); }
    finally { if (mounted.current) setImporting(false); }
  }
  return <div className="composer-wrap">
    <div className="composer" data-composer-utility-bar-variant={props.running ? 'thread' : 'home'} data-composer-rows="stacked" data-composer-drag-active={dragging || undefined} aria-busy={importing} onDragEnter={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; } }} onDragLeave={(event) => { if (!event.dataTransfer.types.includes('Files')) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); void attach([...event.dataTransfer.files]); }}>
      {attachments.length > 0 && <AttachmentList files={attachments} disabled={busy} onRemove={(id) => props.onAttachments(attachments.filter((item) => item.id !== id))} />}
      <textarea ref={textarea} aria-label="消息" placeholder={dragging ? '松开以添加附件' : '有什么想一起完成的？'} maxLength={256_000} disabled={submitting} value={props.text} onChange={(event) => props.onText(event.target.value)} onPaste={(event) => { const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void attach(files); } }} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && (props.enterToSend || event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); }
      }} />
      <div className="composer-toolbar">
        <div className="composer-tools" onFocusCapture={(event) => { if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth && event.target instanceof HTMLElement) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); }}><IconButton icon="attach" label="添加附件" disabled={busy} onClick={() => { void attach(); }} />
          <Select aria-label="选择助手" disabled={submitting} value={props.assistantId} onChange={(event) => props.onAssistant(event.target.value)}><option value="">默认助手</option>{props.assistants.map((assistant) => <option key={assistant.id} value={assistant.id}>{assistant.name}</option>)}</Select>
          {props.promptTemplates.length > 0 && <Button className="composer-action" disabled={busy} aria-label="使用提示模板" title="使用提示模板" onClick={() => setPrompts(true)}><Glyph name="compose" size={14} /><span className="composer-tool-label">模板</span></Button>}
          <Button className="composer-action" disabled={busy || props.running || !props.text.trim()} aria-label="发送给多个模型比较" title="发送给多个模型比较" onClick={props.onCompare}><Glyph name="compare" size={14} /><span className="composer-tool-label">比较</span></Button>
          {props.onViewComparison && <Button className="composer-action" disabled={busy} aria-label="查看模型比较" title="查看模型比较" onClick={props.onViewComparison}><Glyph name="branch" size={14} /><span className="composer-tool-label">查看比较</span></Button>}
          {props.projects.length > 0 && <Select aria-label="选择项目" disabled={submitting} value={props.projectId} onChange={(event) => props.onProject(event.target.value)}><option value="">独立聊天</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</Select>}
          {props.projectId && <Select aria-label="工作模式" value={props.mode} disabled={props.running || submitting} onChange={(event) => props.onMode(event.target.value as ConversationMode)}><option value="chat">聊天</option><option value="plan">项目分析</option><option value="agent">执行任务</option></Select>}
          {(props.servers.length > 0 || props.skills.length > 0 || props.plugins.length > 0) && <Button className="composer-extension-button composer-action" aria-label="选择工具与技能" title={`工具与技能${count ? ` · 已选 ${count}` : ''}`} disabled={props.running || submitting} onClick={() => setExtensions(true)}><Glyph name="code" size={14} /><span className="composer-tool-label">工具与技能</span>{count > 0 && <span className="composer-count">{count}</span>}</Button>}
          {(props.hasNotes || props.knowledgeCollections.length > 0) && <Button className="composer-extension-button composer-action" aria-label="选择资料集" title={`资料集${props.knowledgeCollectionIds.length ? ` · 已选 ${props.knowledgeCollectionIds.length}` : ''}`} disabled={props.running || submitting} onClick={() => setKnowledge(true)}><Glyph name="library" size={14} /><span className="composer-tool-label">资料集</span>{props.knowledgeCollectionIds.length > 0 && <span className="composer-count">{props.knowledgeCollectionIds.length}</span>}</Button>}
        </div>
        {props.running ? <Button className="send-button" aria-label="停止生成" onClick={props.onStop}><Glyph name="stop" size={16} /></Button> : <Button className="send-button" tone="solid" aria-label="发送消息" disabled={!props.text.trim() || busy} onClick={() => { void send(); }}><Glyph name="send" size={18} /></Button>}
      </div>
    </div>
    {importing && <p className="composer-mode-hint" role="status">正在导入附件…</p>}
    {props.temporary && <p className="composer-mode-hint" aria-label="临时聊天说明"><strong>临时聊天</strong>：内容和草稿不写入本机聊天历史或备份，关闭应用后清除。模型服务仍会收到消息；主动导出、工具和插件操作会保留各自结果。</p>}
    {attachments.some((file) => file.image) && <p className="composer-mode-hint">图片将随对话发送给所选模型，请使用支持图片输入的模型。</p>}
    {props.mode === 'plan' && <p className="composer-mode-hint">读取项目、搜索代码并查看改动，整理有依据的方案。</p>}
    {props.mode === 'agent' && <p className="composer-mode-hint">检查项目、提出修改并验证。文件改动与命令执行会先展示给你审批。</p>}
    <div className="composer-meta">{provider ? <div className="model-selectors"><Select aria-label="模型提供商" disabled={submitting} value={props.providerId} onChange={(event) => props.onProvider(event.target.value)}>{props.providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select><Select aria-label="选择模型" disabled={submitting} value={props.model} onChange={(event) => props.onModel(event.target.value)}>{provider.models.length === 0 && <option value="">添加模型…</option>}{provider.models.map((model) => <option key={model} value={model}>{model}</option>)}</Select></div> : <Button onClick={props.onConfigure}><span className="status-dot" />连接一个模型，开始工作<Glyph name="right" size={14} /></Button>}<span>{props.enterToSend ? 'Enter 发送 · Shift + Enter 换行' : 'Ctrl + Enter 发送'}</span></div>
    {context && (context.latest?.tokens?.inputTokens !== undefined || context.info?.inputTokenLimit || context.info?.contextWindow || context.info?.outputTokenLimit || context.info?.maxOutputTokens) && <div className="composer-context" aria-label="模型容量与最近请求" title="最近请求输入是服务返回的实际用量，不是下一次发送的上下文估算。容量来自服务或手动设置。">
      {context.latest?.tokens?.inputTokens !== undefined && <span>最近请求输入 {context.latest.tokens.inputTokens.toLocaleString('zh-CN')}{context.latest.status !== 'complete' || context.latest.tokens.invalid ? '（部分数据）' : ''}</span>}
      {context.info?.inputTokenLimit && <span>输入上限 {context.info.inputTokenLimit.toLocaleString('zh-CN')}</span>}{context.info?.contextWindow && <span>上下文窗口 {context.info.contextWindow.toLocaleString('zh-CN')}</span>}{context.info?.outputTokenLimit && <span>输出上限 {context.info.outputTokenLimit.toLocaleString('zh-CN')}</span>}{context.info?.maxOutputTokens && <span>输出预算 {context.info.maxOutputTokens.toLocaleString('zh-CN')}</span>}
    </div>}
    {prompts && <PromptUseDialog templates={props.promptTemplates} assistants={props.assistants} onUse={props.onPrompt} onClose={() => setPrompts(false)} />}
    {extensions && <Modal title="工具与技能" onClose={() => setExtensions(false)} footer={<Button tone="solid" onClick={() => setExtensions(false)}>完成</Button>}>
      <h3>MCP 工具</h3>{props.mode === 'plan' ? <p className="field-hint">项目分析只使用项目读取工具；MCP 工具可在聊天或执行任务中使用。</p> : <><p className="field-hint">请先在设置中连接服务器。每次模型调用都会先请求审批。</p>{props.servers.filter((server) => server.enabled).map((server) => <Toggle key={server.id} label={server.name} checked={props.serverIds.includes(server.id)} onChange={(checked) => props.onServers(checked ? [...props.serverIds, server.id] : props.serverIds.filter((id) => id !== server.id))} />)}</>}
      <h3>本地技能</h3>{props.skills.filter((skill) => skill.enabled).map((skill) => <div className="extension-tool" key={skill.id}><Toggle label={skill.name} checked={props.skillIds.includes(skill.id)} onChange={(checked) => props.onSkills(checked ? [...props.skillIds, skill.id] : props.skillIds.filter((id) => id !== skill.id))} /><p>{skill.description}</p></div>)}
      {props.plugins.length > 0 && <><h3>插件工具</h3>{props.mode === 'plan' ? <p className="field-hint">插件工具可在聊天或执行任务中使用。</p> : <><p className="field-hint">启用并授权后可选，每次模型调用先请求审批。</p>{props.plugins.filter((plugin) => plugin.enabled && plugin.grants.includes('tools') && plugin.manifest.tools.length > 0).map((plugin) => <Toggle key={plugin.id} label={plugin.manifest.name} disabled={Boolean(plugin.projectIds.length && !plugin.projectIds.includes(props.projectId))} checked={props.pluginIds.includes(plugin.id)} onChange={(checked) => props.onPlugins(checked ? [...props.pluginIds, plugin.id] : props.pluginIds.filter((id) => id !== plugin.id))} />)}</>}</>}
    </Modal>}
    {knowledge && <Modal title="选择资料集" onClose={() => setKnowledge(false)} footer={<Button tone="solid" onClick={() => setKnowledge(false)}>完成</Button>}>
      <p className="field-hint">发送时会检索选中的资料集，并把相关片段提供给模型。语义检索需要先在资料库建立索引；回复下方可打开本次来源。最多选择 8 个资料集。</p>
      {[{ id: 'notes', name: '未分类资料' }, ...props.knowledgeCollections].map((collection) => <Toggle key={collection.id} label={collection.name} checked={props.knowledgeCollectionIds.includes(collection.id)} disabled={props.knowledgeCollectionIds.length >= 8 && !props.knowledgeCollectionIds.includes(collection.id)} onChange={(checked) => props.onKnowledgeCollections(checked ? [...props.knowledgeCollectionIds, collection.id] : props.knowledgeCollectionIds.filter((id) => id !== collection.id))} />)}
    </Modal>}
  </div>;
}
