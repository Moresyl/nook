import { useEffect, useState } from 'react';
import { mcpServerSchema, type McpServer, type McpView, type Skill, type SkillDocument } from '../../contracts/extensions';
import type { Workspace } from '../../contracts/workspace';
import type { Attachment } from '../../contracts/attachments';
import { Button, Empty, Field, IconButton, Input, Select, Textarea, Toggle } from '../components/controls';
import { McpContentBrowser } from './mcp-content-browser';
import { useSettingsDraft } from '../components/settings-drafts';

type Props = { state: Workspace; onState: (next: Workspace) => void; report: (error: unknown) => void; onUse: (text: string) => void };
const statusLabel = { connected: '已连接', connecting: '连接中', disconnected: '未连接', error: '连接失败', 'auth-required': '需要登录', authorizing: '等待授权' };

export function McpSettings({ state, onState, report, onUse, onUseAttachment }: Props & { onUseAttachment: (file: Attachment) => Promise<void> }) {
  const [views, setViews] = useState<McpView[]>([]);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [catalogId, setCatalogId] = useState('');
  const [contentId, setContentId] = useState('');
  const [args, setArgs] = useState('[]');
  const [token, setToken] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [environment, setEnvironment] = useState('');
  const [clearCredentials, setClearCredentials] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toolName, setToolName] = useState('');
  const [toolArguments, setToolArguments] = useState('{}');
  const [result, setResult] = useState('');
  const [baseline, setBaseline] = useState('');
  const dirty = Boolean(editing && (JSON.stringify({ server: editing, args }) !== baseline || token || clientSecret || environment || clearCredentials));
  const leaveForm = useSettingsDraft('mcp', dirty, busy);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.qiyao.onMcp((view) => { if (live) setViews((current) => [...current.filter((item) => item.id !== view.id), view]); });
    void window.qiyao.mcpViews().then((next) => { if (live) setViews((current) => [...next.filter((item) => !current.some((known) => known.id === item.id)), ...current]); }).catch(report);
    return () => { live = false; unsubscribe(); };
  }, [report]);
  async function act<T>(operation: () => Promise<T>, success?: (value: T) => void) {
    if (busy) return;
    setBusy(true); try { const value = await operation(); success?.(value); } catch (error) { report(error); } finally { setBusy(false); }
  }
  function edit(server: McpServer) { const args = JSON.stringify(server.args, null, 2); setEditing({ ...server }); setArgs(args); setBaseline(JSON.stringify({ server, args })); setToken(''); setClientSecret(''); setEnvironment(''); setClearCredentials(false); }
  function field(key: keyof McpServer, value: string | boolean) { setEditing((current) => current ? { ...current, [key]: value } : null); }
  async function save() {
    if (!editing) return;
    const server = { ...editing, args: JSON.parse(args) };
    const credentials = clearCredentials ? {} : token || environment || clientSecret ? { token: token || undefined, clientSecret: clientSecret || undefined, env: environment ? JSON.parse(environment) : undefined } : undefined;
    onState(await window.qiyao.saveMcpServer(server, credentials)); setEditing(null); setToken(''); setClientSecret(''); setEnvironment('');
  }
  const catalog = state.mcpServers.find((server) => server.id === catalogId);
  const view = views.find((item) => item.id === catalogId);
  const tool = view?.tools.find((item) => item.name === toolName);
  const contentServer = state.mcpServers.find((server) => server.id === contentId);
  if (contentServer) return <><Button onClick={() => setContentId('')}>← 返回服务器列表</Button><McpContentBrowser key={contentId} server={contentServer} onUse={onUse} onUseAttachment={onUseAttachment} report={report} /></>;
  if (editing) return <>
    <Button disabled={busy} onClick={() => { void leaveForm(() => { setEditing(null); setToken(''); setClientSecret(''); setEnvironment(''); }, '返回服务器列表将放弃这份未保存的连接。'); }}>← 返回服务器列表</Button>
    <Field label="服务器名称"><Input disabled={busy} value={editing.name} onChange={(event) => field('name', event.target.value)} /></Field>
    <Field label="连接方式"><Select disabled={busy} value={editing.transport} onChange={(event) => setEditing({ ...editing, transport: event.target.value as McpServer['transport'], auth: event.target.value === 'stdio' ? 'bearer' : editing.auth })}><option value="stdio">本地程序</option><option value="http">HTTP</option><option value="sse">SSE</option></Select></Field>
    {editing.transport === 'stdio' ? <>
      <Field label="启动程序" hint="例如 node、uvx 或程序的完整路径。"><Input disabled={busy} value={editing.command} onChange={(event) => field('command', event.target.value)} /></Field>
      <Field label="启动参数" hint='填写 JSON 数组，例如 ["server.js"]。'><Textarea disabled={busy} rows={3} value={args} onChange={(event) => setArgs(event.target.value)} /></Field>
      <Field label="工作目录" hint="留空使用应用的当前目录。"><Input disabled={busy} value={editing.cwd} onChange={(event) => field('cwd', event.target.value)} /></Field>
      <Field label="环境变量" hint="填写 JSON 对象，使用系统加密存储。留空沿用已保存凭据；填写后替换全部凭据。"><Textarea disabled={busy} rows={3} value={environment} spellCheck={false} onChange={(event) => setEnvironment(event.target.value)} /></Field>
    </> : <>
      <Field label="服务器地址"><Input disabled={busy} value={editing.endpoint} placeholder="https://example.com/mcp" onChange={(event) => field('endpoint', event.target.value)} /></Field>
      <Field label="身份验证"><Select disabled={busy} value={editing.auth} onChange={(event) => field('auth', event.target.value)}><option value="bearer">访问令牌</option><option value="oauth">OAuth 登录</option><option value="none">无需验证</option></Select></Field>
      {editing.auth === 'bearer' && <Field label="访问令牌" hint={editing.hasCredentials ? '留空沿用已保存令牌。更改地址后需要重新填写。' : '可选，使用系统加密存储。'}><Input disabled={busy} type="password" autoComplete="new-password" value={token} onChange={(event) => setToken(event.target.value)} /></Field>}
      {editing.auth === 'oauth' && <>
        <p className="field-hint">保存服务器后点击“登录”，在浏览器中完成授权。</p>
        <Field label="OAuth 客户端 ID" hint="可选；留空使用服务器提供的动态注册。"><Input disabled={busy} value={editing.oauthClientId} onChange={(event) => field('oauthClientId', event.target.value)} /></Field>
        {editing.oauthClientId && <><Field label="授权服务器地址" hint="填写该客户端所属的授权服务器 URL。"><Input disabled={busy} value={editing.oauthIssuer} onChange={(event) => field('oauthIssuer', event.target.value)} /></Field><Field label="OAuth 客户端密钥" hint="可选；留空沿用已保存密钥。"><Input disabled={busy} type="password" autoComplete="new-password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /></Field></>}
        <Field label="授权范围" hint="可选，多个范围用空格分隔。"><Input disabled={busy} value={editing.oauthScope} onChange={(event) => field('oauthScope', event.target.value)} /></Field>
        <Field label="回调端口" hint="0 为自动分配。服务器要求固定地址时，注册 http://127.0.0.1:端口/oauth/callback。"><Input disabled={busy} type="number" min={0} max={65535} value={editing.oauthRedirectPort} onChange={(event) => setEditing({ ...editing, oauthRedirectPort: Number(event.target.value) })} /></Field>
      </>}
    </>}
    {editing.hasCredentials && <Toggle disabled={busy} label="清除已保存凭据" checked={clearCredentials} onChange={setClearCredentials} />}
    <Field label="超时（秒）"><Input disabled={busy} type="number" min={1} max={180} value={editing.timeout / 1000} onChange={(event) => setEditing({ ...editing, timeout: Number(event.target.value) * 1000 })} /></Field>
    <Toggle disabled={busy} label="启用服务器" checked={editing.enabled} onChange={(value) => field('enabled', value)} />
    <Toggle disabled={busy} label="启动工作台时自动连接" checked={editing.autoConnect} onChange={(value) => field('autoConnect', value)} />
    <div className="form-actions"><Button tone="solid" disabled={busy || !editing.name.trim()} onClick={() => { void act(save); }}>保存服务器</Button></div>
  </>;
  if (catalog) return <>
    <Button disabled={busy} onClick={() => { setCatalogId(''); setResult(''); }}>← 返回服务器列表</Button>
    <div className="section-heading"><div><h3>{catalog.name}</h3><p>{statusLabel[view?.status ?? 'disconnected']}</p></div><Button disabled={busy || !catalog.enabled} onClick={() => { void act(() => window.qiyao.mcpConnect(catalog.id)); }}>重新连接</Button></div>
    {view?.error && <p role="alert" className="field-hint">{view.error}</p>}
    <p className="field-hint">选择允许模型使用的工具。更改后需要重新连接服务器。</p>
    <div className="extension-tools">{view?.tools.map((item) => <div className="extension-tool" key={item.name}><Toggle label={item.name} checked={!catalog.disabledTools.includes(item.name)} onChange={(value) => { void act(() => window.qiyao.saveMcpServer({ ...catalog, disabledTools: value ? catalog.disabledTools.filter((name) => name !== item.name) : [...catalog.disabledTools, item.name] }), onState); }} /><p>{item.description}</p></div>)}</div>
    <h4>测试工具</h4><p className="field-hint">点击“执行测试”会立即向服务器发送参数。</p>
    <Field label="测试工具"><Select value={toolName} onChange={(event) => { setToolName(event.target.value); setResult(''); }}><option value="">选择工具…</option>{view?.tools.filter((item) => !catalog.disabledTools.includes(item.name)).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></Field>
    {tool && <details><summary>输入格式</summary><pre className="extension-preview">{JSON.stringify(tool.parameters, null, 2)}</pre></details>}
    <Field label="测试参数"><Textarea rows={4} spellCheck={false} value={toolArguments} onChange={(event) => setToolArguments(event.target.value)} /></Field>
    <Button disabled={busy || !tool} onClick={() => { void act(() => window.qiyao.mcpTestTool(catalog.id, toolName, toolArguments), (output) => setResult(`${output.error ? '调用失败\n' : ''}${output.output}`)); }}>{busy ? '执行中…' : '执行测试'}</Button>
    {result && <pre className="extension-preview" aria-label="工具测试结果">{result}</pre>}
  </>;
  return <>
    <div className="section-heading"><div><h3>MCP 服务器</h3><p>让模型使用外部工具，每次调用先请求审批。</p></div><Button onClick={() => edit(mcpServerSchema.parse({ id: crypto.randomUUID(), name: '新服务器', transport: 'stdio', command: 'node' }))}>添加服务器</Button></div>
    {state.mcpServers.length ? <div className="item-list">{state.mcpServers.map((server) => {
      const status = views.find((item) => item.id === server.id);
      return <div className="extension-server" key={server.id}><div className="list-row"><Button className="row-content" disabled={busy} onClick={() => edit(server)}><strong>{server.name}</strong><span>{server.enabled ? statusLabel[status?.status ?? 'disconnected'] : '已停用'} · {server.transport}</span></Button><IconButton icon="trash" label={`移除服务器 ${server.name}`} disabled={busy} onClick={() => { void act(() => window.qiyao.removeMcpServer(server.id), onState); }} /></div><div className="extension-actions">
        {status?.status === 'authorizing' ? <Button onClick={() => { void window.qiyao.mcpDisconnect(server.id).catch(report); }}>取消登录</Button> : <Button disabled={busy || !server.enabled || status?.status === 'connecting'} onClick={() => { void act(() => status?.status === 'connected' ? window.qiyao.mcpDisconnect(server.id) : window.qiyao.mcpConnect(server.id).then(() => {})); }}>{status?.status === 'connected' ? '断开' : '连接'}</Button>}
        {server.auth === 'oauth' && <><Button disabled={busy || !server.enabled || status?.status === 'connected' || status?.status === 'authorizing'} onClick={() => { void act(() => window.qiyao.mcpAuthenticate(server.id)); }}>登录</Button><Button disabled={busy} onClick={() => { void act(() => window.qiyao.mcpForgetLogin(server.id)); }}>退出登录</Button></>}
        <Button disabled={busy} onClick={() => { setCatalogId(server.id); setToolName(''); setResult(''); }}>工具 {status?.tools.length || ''}</Button><Button disabled={busy || status?.status !== 'connected'} onClick={() => setContentId(server.id)}>资源与提示词</Button>
      </div>{status?.error && <p role="alert" className="field-hint">{status.error}</p>}</div>;
    })}</div> : <Empty icon="code" title="添加你的第一个 MCP 服务器" detail="支持本地程序、HTTP 与 SSE 连接。" />}
  </>;
}

export function SkillSettings({ state, onState, report }: Props) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [document, setDocument] = useState<SkillDocument | null>(null);
  const [preview, setPreview] = useState('');
  const [path, setPath] = useState('');
  async function act<T>(operation: () => Promise<T>, success?: (value: T) => void) {
    if (busy) return;
    setBusy(true); try { const value = await operation(); success?.(value); } catch (error) { report(error); } finally { setBusy(false); }
  }
  if (selected) return <>
    <Button disabled={busy} onClick={() => { setSelected(null); setDocument(null); }}>← 返回技能列表</Button>
    <h3>{selected.name}</h3><p className="muted">{selected.description}</p>
    <Toggle disabled={busy} label="启用技能" checked={state.skills.find((skill) => skill.id === selected.id)?.enabled ?? false} onChange={(value) => { void act(() => window.qiyao.saveSkill({ ...selected, enabled: value }), onState); }} />
    <Field label="技能文件"><Select disabled={busy} value={path} onChange={(event) => { const next = event.target.value; setPath(next); void act(() => window.qiyao.skillRead(selected.id, next), setPreview); }}>{document?.files.map((file) => <option key={file} value={file}>{file}</option>)}</Select></Field>
    <pre className="extension-preview">{preview}</pre><p className="field-hint">在对话中选中后参与工作，脚本不会自动执行。</p>
    <Button tone="danger" disabled={busy} onClick={() => { void act(() => window.qiyao.removeSkill(selected.id), (next) => { onState(next); setSelected(null); }); }}>移除此技能</Button>
  </>;
  return <>
    <div className="section-heading"><div><h3>本地技能</h3><p>导入 SKILL.md 及完整配套文件。</p></div><Button disabled={busy} onClick={() => { void act(() => window.qiyao.importSkill(), (next) => { if (next) onState(next); }); }}>导入技能…</Button></div>
    {state.skills.length ? <div className="item-list">{state.skills.map((skill) => <div className="list-row" key={skill.id}><Button className="row-content" disabled={busy} onClick={() => { void act(() => window.qiyao.skillDocument(skill.id), (next) => { setSelected(skill); setDocument(next); setPreview(next.instructions); setPath('SKILL.md'); }); }}><strong>{skill.name}</strong><span>{skill.enabled ? '已启用' : '已停用'} · {skill.description || '自定义工作方式'}</span></Button><IconButton disabled={busy} icon="trash" label={`移除技能 ${skill.name}`} onClick={() => { void act(() => window.qiyao.removeSkill(skill.id), onState); }} /></div>)}</div> : <Empty icon="library" title="把常用方法变成技能" detail="技能按需加载说明，帮助模型遵循你的工作方法。" />}
  </>;
}
