import { useEffect, useState } from 'react';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { McpCatalog, McpContent, McpServer } from '../../contracts/extensions';
import { Button, Field, Input, Select } from '../components/controls';

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
  useEffect(() => {
    let live = true;
    const refresh = () => { void window.qiyao.mcpCatalog(server.id).then((next) => { if (live) { setCatalog(next); setContent(null); } }).catch(report); };
    refresh();
    const unsubscribe = window.qiyao.onMcp((view) => { if (view.id === server.id) { if (view.status === 'connected') refresh(); else { setCatalog({ resources: [], templates: [], prompts: [] }); setContent(null); } } });
    return () => { live = false; unsubscribe(); };
  }, [server.id, report]);
  async function act<T>(operation: () => Promise<T>, success: (result: T) => void) {
    if (busy) return;
    setBusy(true); try { success(await operation()); } catch (error) { report(error); } finally { setBusy(false); }
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
      <Button disabled={busy || !uri} onClick={() => { void act(() => window.qiyao.mcpReadResource(server.id, uri), setContent); }}>{busy ? '读取中…' : '读取资源'}</Button>
      {!catalog.resources.length && !catalog.templates.length && <p className="field-hint">服务器未提供资源。请确认连接状态。</p>}
    </> : <>
      <Field label="服务器提示词"><Select disabled={busy} value={promptName} onChange={(event) => { setPromptName(event.target.value); setArguments({}); setContent(null); }}><option value="">选择提示词…</option>{catalog.prompts.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></Field>
      {prompt && <p className="field-hint">{prompt.description}</p>}
      {prompt?.arguments.map((argument) => <Field key={argument.name} label={`提示词参数 ${argument.name}${argument.required ? '（必填）' : ''}`} hint={argument.description}><Input disabled={busy} value={argumentsMap[argument.name] ?? ''} onChange={(event) => { const next = { ...argumentsMap }; if (event.target.value || argument.required) next[argument.name] = event.target.value; else delete next[argument.name]; setArguments(next); setContent(null); }} /></Field>)}
      <Button disabled={busy || !prompt || prompt.arguments.some((argument) => argument.required && !argumentsMap[argument.name])} onClick={() => { void act(() => window.qiyao.mcpGetPrompt(server.id, promptName, argumentsMap), setContent); }}>{busy ? '加载中…' : '加载提示词'}</Button>
      {!catalog.prompts.length && <p className="field-hint">服务器未提供提示词模板。</p>}
    </>}
    {content && <section className="extension-content" aria-label="MCP 内容预览"><h4>{content.title}</h4>{content.text && <pre className="extension-preview">{content.text}</pre>}{content.binaryItems.map((item, index) => <p className="field-hint" key={index}>{item.uri} · {item.mimeType ?? '二进制文件'} · {item.bytes} 字节</p>)}<p className="field-hint">加入对话前可在消息框中修改。二进制内容当前显示文件信息。</p><Button disabled={!content.text} onClick={() => onUse(`[${server.name} · ${content.title}]\n\n${content.text}`)}>用于对话</Button></section>}
  </>;
}
