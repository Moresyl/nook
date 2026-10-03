import { useEffect, useRef, useState } from 'react';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { McpCatalog, McpContent, McpServer, McpView } from '../../contracts/extensions';
import type { Attachment } from '../../contracts/attachments';
import { mcpBinaryImageSupported } from '../../contracts/mcp-binary';
import { Button, Field, Input, Select } from '../components/controls';
import { AttachmentPreview } from '../components/attachments';
import { observeMcpResource } from '../lib/mcp-resource-updates';

export function McpContentBrowser({ server, onUse, report }: { server: McpServer; onUse: (text: string) => void; report: (error: unknown) => void }) {
  const [catalog, setCatalog] = useState<McpCatalog>({ resources: [], templates: [], prompts: [] });
  const [tab, setTab] = useState('resources');
  const [busy, setBusy] = useState(false);
  const [uri, setUri] = useState('');
  const [template, setTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [promptName, setPromptName] = useState('');
  const [argumentsMap, setArguments] = useState<Record<string, string>>({});
  const [content, setContent] = useState<McpContent | null>(null);
  const [view, setView] = useState<McpView | undefined>();
  const [updating, setUpdating] = useState(false);
  const [binaryPreview, setBinaryPreview] = useState<Attachment | null>(null);
  const [fileNotice, setFileNotice] = useState('');
  const fileSelection = useRef(0);
  const watching = view?.subscribedResources?.includes(uri) === true;
  const catalogRevision = JSON.stringify(catalog);
  const promptArguments = JSON.stringify(argumentsMap);
  useEffect(() => {
    fileSelection.current++; setBinaryPreview(null); setFileNotice('');
    return () => { fileSelection.current++; };
  }, [server.id, uri, tab, promptName, promptArguments, catalogRevision, view?.status]);
  useEffect(() => {
    let live = true; let requests = 0; let events = 0; let revision = '';
    const refresh = () => {
      const request = ++requests;
      void window.qiyao.mcpCatalog(server.id).then((next) => {
        if (!live || request !== requests) return;
        const nextRevision = JSON.stringify(next);
        setCatalog(next); if (nextRevision !== revision) setContent(null); revision = nextRevision;
      }).catch((error) => { if (live && request === requests) report(error); });
    };
    setView(undefined); setContent(null);
    void window.qiyao.mcpViews().then((views) => { if (live && events === 0) setView(views.find((item) => item.id === server.id)); }).catch((error) => { if (live) report(error); });
    refresh();
    const unsubscribe = window.qiyao.onMcp((next) => {
      if (next.id !== server.id || !live) return;
      events++; setView(next);
      if (next.status === 'connected') refresh();
      else { requests++; revision = ''; setCatalog({ resources: [], templates: [], prompts: [] }); setContent(null); }
    });
    return () => { live = false; unsubscribe(); };
  }, [server.id, report]);
  useEffect(() => {
    if (!watching || !uri || tab !== 'resources') return;
    return observeMcpResource(window.qiyao, server.id, uri, { content: setContent, busy: setUpdating, error: report });
  }, [server.id, uri, watching, tab, catalogRevision, report]);
  async function act<T>(operation: () => Promise<T>, success: (result: T) => void, current: () => boolean = () => true) {
    if (busy) return;
    setBusy(true); try { const result = await operation(); if (current()) success(result); } catch (error) { if (current()) report(error); } finally { setBusy(false); }
  }
  async function selectedAction<T>(operation: () => Promise<T>, success: (result: T) => void) {
    const selection = fileSelection.current;
    await act(operation, success, () => selection === fileSelection.current);
  }
  function chooseTemplate(value: string) {
    setTemplate(value); setContent(null); const names = value ? new UriTemplate(value).variableNames : [];
    const next = Object.fromEntries(names.map((name) => [name, ''])); setVariables(next); setUri(value ? new UriTemplate(value).expand(next) : '');
  }
  const prompt = catalog.prompts.find((item) => item.name === promptName);
  return <>
    <div className="section-heading"><div><h3>{server.name}</h3><p>资源与提示词</p></div><Button disabled={busy} onClick={() => { void act(() => window.qiyao.mcpRefreshCatalog(server.id), (next) => { setCatalog(next); setContent(null); }); }}>刷新目录</Button></div>
    <div className="extension-actions" aria-label="MCP 内容分类"><Button className={tab === 'resources' ? 'selected' : ''} onClick={() => { setTab('resources'); setContent(null); }}>资源</Button><Button className={tab === 'prompts' ? 'selected' : ''} onClick={() => { setTab('prompts'); setContent(null); }}>提示词</Button></div>
    {tab === 'resources' ? <>
      <Field label="服务器资源"><Select disabled={busy} value={catalog.resources.some((item) => item.uri === uri) ? uri : ''} onChange={(event) => { setUri(event.target.value); setTemplate(''); setContent(null); }}><option value="">选择资源…</option>{catalog.resources.map((item) => <option key={item.uri} value={item.uri}>{item.name}</option>)}</Select></Field>
      {catalog.templates.length > 0 && <Field label="资源模板"><Select disabled={busy} value={template} onChange={(event) => chooseTemplate(event.target.value)}><option value="">选择模板…</option>{catalog.templates.map((item) => <option key={item.uriTemplate} value={item.uriTemplate}>{item.name}</option>)}</Select></Field>}
      {Object.keys(variables).map((name) => template && <Field key={name} label={`资源参数 ${name}`}><Input disabled={busy} value={variables[name]} onChange={(event) => { const next = { ...variables, [name]: event.target.value }; setVariables(next); setUri(new UriTemplate(template).expand(next)); setContent(null); }} /></Field>)}
      <Field label="资源 URI"><Input disabled={busy} value={uri} onChange={(event) => { setUri(event.target.value); setContent(null); }} /></Field>
      <Button disabled={busy || updating || !uri} onClick={() => { void selectedAction(() => window.qiyao.mcpReadResource(server.id, uri), setContent); }}>{busy || updating ? '读取中…' : '读取资源'}</Button>
      <Button disabled={busy || !uri || (!watching && !view?.resourceSubscriptionsSupported)} onClick={() => { void act(() => window.qiyao.mcpSetResourceSubscription(server.id, uri, !watching), setView); }}>{watching ? '停止订阅所选资源' : '订阅所选资源'}</Button>
      <p className="field-hint">订阅后，所选资源有更新时自动刷新预览。用于对话仍须手动点击；断开连接后停止订阅。{view?.resourceSubscriptionsSupported === false && '此服务器不支持资源订阅。'}</p>
      {!!view?.subscribedResources?.length && <section aria-label="已订阅 MCP 资源">{view.subscribedResources.map((item) => <div className="extension-actions" key={item}><span>{item}</span><Button aria-label={`停止订阅 ${item}`} disabled={busy} onClick={() => { void act(() => window.qiyao.mcpSetResourceSubscription(server.id, item, false), setView); }}>停止订阅</Button></div>)}</section>}
      {!catalog.resources.length && !catalog.templates.length && <p className="field-hint">服务器未提供资源。请确认连接状态。</p>}
    </> : <>
      <Field label="服务器提示词"><Select disabled={busy} value={promptName} onChange={(event) => { setPromptName(event.target.value); setArguments({}); setContent(null); }}><option value="">选择提示词…</option>{catalog.prompts.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></Field>
      {prompt && <p className="field-hint">{prompt.description}</p>}
      {prompt?.arguments.map((argument) => <Field key={argument.name} label={`提示词参数 ${argument.name}${argument.required ? '（必填）' : ''}`} hint={argument.description}><Input disabled={busy} value={argumentsMap[argument.name] ?? ''} onChange={(event) => { const next = { ...argumentsMap }; if (event.target.value || argument.required) next[argument.name] = event.target.value; else delete next[argument.name]; setArguments(next); setContent(null); }} /></Field>)}
      <Button disabled={busy || !prompt || prompt.arguments.some((argument) => argument.required && !argumentsMap[argument.name])} onClick={() => { void selectedAction(() => window.qiyao.mcpGetPrompt(server.id, promptName, argumentsMap), setContent); }}>{busy ? '加载中…' : '加载提示词'}</Button>
      {!catalog.prompts.length && <p className="field-hint">服务器未提供提示词模板。</p>}
    </>}
    {content && <section className="extension-content" aria-label="MCP 内容预览"><h4>{content.title}</h4>{content.text && <pre className="extension-preview">{content.text}</pre>}{content.binaryItems.map((item, index) => <div className="list-row" key={index}><div className="row-content"><p className="field-hint">{item.uri} · {item.mimeType ?? '二进制文件'} · {item.bytes} 字节</p><div className="extension-actions">{mcpBinaryImageSupported(item) && <Button disabled={busy || typeof item.data !== 'string'} aria-label={`预览图片 ${item.uri}`} onClick={() => { void selectedAction(() => window.qiyao.mcpPreviewBinary({ ...item, data: item.data! }), setBinaryPreview); }}>预览图片</Button>}<Button disabled={busy || typeof item.data !== 'string'} aria-label={`导出文件 ${item.uri}`} onClick={() => { void selectedAction(() => window.qiyao.mcpExportBinary({ ...item, data: item.data! }), (saved) => setFileNotice(saved ? '已导出所选文件。' : '已取消导出。')); }}>导出文件</Button></div></div></div>)}{fileNotice && <p className="field-hint" role="status">{fileNotice}</p>}<p className="field-hint">用于对话添加当前文本，可在消息框中修改。图片预览使用规范化副本，导出保留原始文件内容。</p><Button disabled={!content.text} onClick={() => onUse(`[${server.name} · ${content.title}]\n\n${content.text}`)}>用于对话</Button></section>}
    {binaryPreview && <AttachmentPreview file={binaryPreview} onClose={() => setBinaryPreview(null)} />}
  </>;
}
