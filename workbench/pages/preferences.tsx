import { useLayoutEffect, useRef, useState } from 'react';
import type { Bridge } from '../../contracts/bridge-contract';
import type { Provider, Workspace } from '../../contracts/workspace';
import type { Attachment } from '../../contracts/attachments';
import { modelInfoSchema } from '../../contracts/models';
import { Button, Empty, Field, IconButton, Input, Modal, Select, Textarea, Toggle } from '../components/controls';
import { Emblem, Glyph } from '../components/glyphs';
import { McpSettings, SkillSettings } from './extensions';
import { PluginSettingsPage } from './plugins';
import { ModelCapacity } from './model-capacity';
import { configuredModels, configuredProvider, discoveredModels } from './model-settings';
import { DesktopSettings } from './desktop-settings';
import { MemorySettings } from './memory-settings';
import { WorktreeSettings } from './worktree-settings';
import type { WorktreeConversationTarget, WorktreeProjectTarget } from '../../contracts/worktree-navigation';
import { settingsTabs, type SettingsDestination, type SettingsTab } from '../../contracts/settings-search';
import { SettingsNavigation } from '../components/settings-navigation';
import { focusSettingsDestination } from '../lib/settings-focus';

type Props = { state: Workspace; onState: (state: Workspace) => void; onRestore: (state: Workspace) => void; onClose: () => void; report: (error: unknown) => void; onUseContent: (text: string) => void; onUseAttachment: (file: Attachment) => Promise<void>; onOpenPanel: (pluginId: string, panelId: string) => void; onOpenWorktreeConversation(target: WorktreeConversationTarget): Promise<void>; onCreateWorktreeConversation(target: WorktreeProjectTarget): Promise<void> };
const blankProvider = (): Provider => ({ id: crypto.randomUUID(), name: '', kind: 'responses', endpoint: 'https://api.openai.com/v1', models: [], hasKey: false });
export function PreferencesDialog({ state, onState, onRestore, onClose, report, onUseContent, onUseAttachment, onOpenPanel, onOpenWorktreeConversation, onCreateWorktreeConversation }: Props) {
  const [tab, setTab] = useState<SettingsTab>('models');
  const [visited, setVisited] = useState<SettingsTab[]>(['models']);
  const [destination, setDestination] = useState<SettingsDestination | null>(null);
  const search = useRef<HTMLInputElement>(null); const detail = useRef<HTMLElement>(null);
  const restoreActionFocus = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState('');
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => { search.current?.focus(); }, []);
  function navigate(next: SettingsTab, target?: SettingsDestination) {
    if (busy) return;
    setVisited(current => current.includes(next) ? current : [...current, next]); setTab(next); setDestination(target ? { ...target } : null);
  }
  useLayoutEffect(() => { if (!detail.current) return; if (destination) focusSettingsDestination(detail.current, destination); else detail.current.scrollTop = 0; }, [tab, destination]);
  useLayoutEffect(() => {
    if (busy) return;
    const target = restoreActionFocus.current; restoreActionFocus.current = null;
    const active = document.activeElement;
    if (target?.isConnected && detail.current?.contains(target) && !target.matches(':disabled') && (active === document.body || active === detail.current.closest('dialog'))) target.focus({ preventScroll: true });
  }, [busy]);
  async function act<T>(operation: () => Promise<T>, success?: (value: T) => void) {
    const active = document.activeElement;
    restoreActionFocus.current = active instanceof HTMLElement && detail.current?.contains(active) ? active : null;
    setBusy(true);
    try { const value = await operation(); success?.(value); }
    catch (error) { report(error); }
    finally { setBusy(false); }
  }
  function edit(provider: Provider) { setEditing({ ...provider }); setModels(provider.models.join('\n')); setKey(''); }
  function updateProvider(field: keyof Provider, value: string) {
    setEditing((current) => current ? { ...current, [field]: value, ...(field === 'endpoint' && value !== current.endpoint ? { modelCatalog: undefined } : {}) } : null);
  }
  return <Modal className="settings-dialog" title="设置" dismissible={!busy} onClose={onClose}><div className="settings-layout" onKeyDown={event => { if (!busy && !event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && (event.target as HTMLElement).closest('dialog')?.classList.contains('settings-dialog')) { event.preventDefault(); event.stopPropagation(); search.current?.focus(); search.current?.select(); } }}><SettingsNavigation tab={tab} busy={busy} provider={editing} inputRef={search} onNavigate={navigate} />{visited.map(panel => <section key={panel} ref={panel === tab ? detail : undefined} hidden={panel !== tab} inert={panel !== tab} tabIndex={-1} className="settings-detail" aria-label={settingsTabs.find(item => item.id === panel)?.label}>
    {panel === 'worktrees' && <WorktreeSettings state={state} busy={busy} onBusyChange={setBusy} onState={onState} onOpenConversation={onOpenWorktreeConversation} onCreateConversation={onCreateWorktreeConversation} />}
    {panel === 'memories' && <MemorySettings state={state} onState={onState} report={report} />}
    {panel === 'models' && (editing ? <>
      <div className="section-heading"><Button disabled={busy} onClick={() => setEditing(null)}>← 返回连接列表</Button><span className="muted">{editing.hasKey ? '密钥已保存在系统中' : '新连接'}</span></div>
      <Field label="连接名称"><Input disabled={busy} value={editing.name} placeholder="例如：我的模型" onChange={(event) => updateProvider('name', event.target.value)} /></Field>
      <Field label="API 类型"><Select disabled={busy} value={editing.kind} onChange={(event) => { const kind = event.target.value as Provider['kind']; setEditing({ ...editing, kind, modelCatalog: undefined, streamUsage: undefined, azureApi: undefined, apiVersion: undefined, endpoint: kind === 'anthropic' ? 'https://api.anthropic.com/v1' : kind === 'ollama' ? 'http://localhost:11434/v1' : kind === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : kind === 'azure' ? 'https://RESOURCE.openai.azure.com/openai/v1' : 'https://api.openai.com/v1' }); }}><option value="responses">OpenAI Responses</option><option value="openai">OpenAI 兼容 API</option><option value="anthropic">Anthropic Messages</option><option value="ollama">Ollama 本地模型</option><option value="gemini">Google Gemini</option><option value="azure">Azure OpenAI / Foundry</option></Select></Field>
      {editing.kind === 'azure' && <Field label="Azure 接口"><Select disabled={busy} value={editing.azureApi ?? 'responses'} onChange={(event) => { const azureApi = event.target.value as Provider['azureApi']; setEditing({ ...editing, azureApi, modelCatalog: undefined, apiVersion: azureApi === 'deployment-chat' ? '2024-10-21' : undefined }); }}><option value="responses">v1 Responses</option><option value="chat">v1 Chat Completions</option><option value="deployment-chat">部署 Chat Completions（指定版本）</option></Select></Field>}
      {editing.kind === 'azure' && editing.azureApi === 'deployment-chat' && <Field label="API 版本" hint="填写资源支持的版本，例如 2024-10-21。"><Input disabled={busy} value={editing.apiVersion ?? ''} onChange={(event) => updateProvider('apiVersion', event.target.value)} /></Field>}
      <Field label="API 地址" hint={editing.kind === 'gemini' ? '填写 Gemini API 根地址，例如 https://generativelanguage.googleapis.com/v1beta。' : editing.kind === 'azure' ? '将 RESOURCE 换成资源名称，也可填写资源根地址。' : '填写 API 根地址，例如 https://api.example.com/v1'}><Input disabled={busy} value={editing.endpoint} onChange={(event) => updateProvider('endpoint', event.target.value)} /></Field>
      <Field label="API 密钥" hint={editing.hasKey ? '地址与 API 类型相同时，留空可沿用密钥；更改后需重新填写。' : editing.kind === 'ollama' ? '本地模型通常不需要密钥。' : '密钥使用系统加密存储。'}><Input disabled={busy} type="password" autoComplete="new-password" value={key} placeholder={editing.hasKey ? '•••••••• 已保存' : '输入密钥'} onChange={(event) => setKey(event.target.value)} /></Field>
      <Field label="模型" hint={editing.kind === 'azure' ? '每行一个已部署的部署名称。模型列表返回的基础模型名称未必等于部署名称。' : '每行一个模型名称，也可以从连接中获取。'}><Textarea disabled={busy} rows={4} value={models} placeholder={editing.kind === 'azure' ? '输入部署名称' : '输入模型名称'} onChange={(event) => setModels(event.target.value)} /></Field>
      {(editing.kind === 'openai' || editing.kind === 'ollama' || (editing.kind === 'azure' && editing.azureApi && editing.azureApi !== 'responses')) && <><Toggle label="请求流式 token 用量" disabled={busy} checked={editing.streamUsage !== false} onChange={(streamUsage) => setEditing({ ...editing, streamUsage })} /><p className="field-hint">默认开启。兼容服务若不支持该选项，可关闭后重新发送；不会自动重试请求。</p></>}
      <ModelCapacity provider={editing} models={configuredModels(models)} disabled={busy} onChange={setEditing} />
      <div className="form-actions"><Button disabled={busy} onClick={() => { void act(() => window.qiyao.discoverModelCatalog(configuredProvider(editing, models), key || undefined), (items) => { setEditing(discoveredModels(editing, items)); setModels(items.map((item) => item.id).join('\n')); }); }}>{busy ? '正在连接…' : '获取模型'}</Button><Button tone="solid" disabled={busy || !editing.name.trim() || !models.trim() || configuredProvider(editing, models).modelCatalog?.some((item) => !modelInfoSchema.safeParse(item).success)} onClick={() => { void act(() => window.qiyao.saveProvider({ ...configuredProvider(editing, models), name: editing.name.trim() }, key || undefined), (next) => { onState(next); setEditing(null); setKey(''); }); }}>保存连接</Button></div>
    </> : <>
      <div className="section-heading"><div><h3>模型连接</h3><p>连接云端或本地模型，自由切换。</p></div><Button onClick={() => edit(blankProvider())}><Glyph name="plus" size={16} />添加连接</Button></div>
      {state.providers.length ? <div className="item-list">{state.providers.map((provider) => <div className="list-row" key={provider.id}><span className="row-symbol"><Glyph name="assistant" /></span><Button className="row-content" onClick={() => edit(provider)}><strong>{provider.name}</strong><span>{provider.models.length} 个模型 · {provider.kind === 'ollama' ? '本地' : provider.hasKey ? '已保存密钥' : '需要密钥'}</span></Button><IconButton icon="trash" label={`移除 ${provider.name}`} disabled={busy} onClick={() => { void act(() => window.qiyao.removeProvider(provider.id), onState); }} /></div>)}</div> : <Empty icon="assistant" title="从连接一个模型开始" detail="支持 OpenAI、Anthropic、Gemini、Azure 和 Ollama。" action={<Button tone="solid" onClick={() => edit(blankProvider())}>添加模型连接</Button>} />}
    </>)}
    {panel === 'appearance' && <><h3>外观与交互</h3><p className="muted">让工作台适合你的工作方式。</p><Field label="主题"><Select disabled={busy} value={state.preferences.theme} onChange={(event) => { void act(() => window.qiyao.savePreferences({ ...state.preferences, theme: event.target.value as Workspace['preferences']['theme'] }), onState); }}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></Select></Field><Toggle disabled={busy} label="按 Enter 发送消息" checked={state.preferences.enterToSend} onChange={(value) => { void act(() => window.qiyao.savePreferences({ ...state.preferences, enterToSend: value }), onState); }} /><div className="shortcut-list"><h4>键盘快捷键</h4><div>新聊天 <kbd>Ctrl N</kbd></div><div>搜索与命令 <kbd>Ctrl K</kbd></div><div>设置 <kbd>Ctrl ,</kbd></div><div>切换侧边栏 <kbd>Ctrl B</kbd></div><div>切换最近聊天 <kbd>Alt 1–9</kbd></div></div><DesktopSettings state={state} onState={onState} report={report} /></>}
    {panel === 'data' && <><h3>数据与备份</h3><p className="muted">对话、项目、助手与资料保存在本机。</p><div className="settings-row"><div><strong>导出工作台</strong><p>默认保存压缩备份，也可选择 JSON；完整内容不包含 API 密钥。</p></div><Button disabled={busy} onClick={() => { void act(() => window.qiyao.exportWorkspace()); }}>导出备份…</Button></div><div className="settings-row"><div><strong>恢复工作台</strong><p>支持 JSON 与压缩备份，操作前会确认替换范围。</p></div><Button disabled={busy} onClick={() => { void act(() => window.qiyao.importWorkspace(), (next) => { if (next) onRestore(next); }); }}>恢复备份…</Button></div><p className="field-hint">完整内容上限 256 MB，压缩文件上限 64 MB。单个聊天可在聊天顶部导出为 Markdown。</p>{busy && <p className="field-hint" role="status">正在处理备份…</p>}</>}
    {panel === 'about' && <div className="about"><Emblem size={64} /><h3>Nook</h3><p>本地 AI 工作台</p><span className="muted">0.1.0-alpha.1 · 开发中</span><p className="field-hint">一个本地 AI 工作台。你的模型，你的项目，你的工作方式。</p></div>}
    {panel === 'mcp' && <McpSettings state={state} onState={onState} report={report} onUse={onUseContent} onUseAttachment={onUseAttachment} />}
    {panel === 'skills' && <SkillSettings state={state} onState={onState} report={report} onUse={onUseContent} />}
    {panel === 'plugins' && <PluginSettingsPage state={state} onState={onState} report={report} onOpenPanel={onOpenPanel} />}
  </section>)}</div></Modal>;
}
