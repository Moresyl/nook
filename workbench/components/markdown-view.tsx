import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { all } from 'lowlight';
import { toString } from 'hast-util-to-string';
import { codeBlockFromNode, type CodeBlock } from '../lib/rich-content';
import { DiagramView } from './diagram-view';
import { IconButton } from './controls';
import { useContentBridge } from './content-bridge';
import { useTextCopy } from './use-text-copy';
import { MarkdownTable } from './markdown-table';
import { markdownTableHtml } from '../lib/table-clipboard';

type Rendering = { content: string; generating: boolean; report: (error: unknown) => void };
const RenderingContext = createContext<Rendering | null>(null);
function useRendering(): Rendering {
  const rendering = useContext(RenderingContext);
  if (!rendering) throw new Error('Markdown rendering context is unavailable.');
  return rendering;
}
function MarkdownLink({ href, children }: ComponentProps<'a'>) {
  const bridge = useContentBridge();
  const { report } = useRendering();
  return <a href={href} onClick={(event) => { event.preventDefault(); if (href) void bridge.openExternal(href).catch(report); }}>{children}</a>;
}
function MarkdownPre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const { generating, report } = useRendering(); const block = codeBlockFromNode(node);
  return block ? <CodeFence block={block} generating={generating} report={report}>{children}</CodeFence> : <pre>{children}</pre>;
}
function MarkdownParagraph({ node, children, ...props }: ComponentProps<'p'> & ExtraProps) {
  return <p {...props} data-markdown-han-text={node && /\p{Script=Han}/u.test(toString(node)) ? true : undefined}>{children}</p>;
}
function MarkdownTableBlock({ node, ...props }: ComponentProps<'table'> & ExtraProps) {
  const { content } = useRendering();
  const start = node?.position?.start.offset, end = node?.position?.end.offset;
  return <MarkdownTable {...props} source={start !== undefined && end !== undefined ? content.slice(start, end) : ''} html={markdownTableHtml(node)} />;
}
function MarkdownTableHeader({ node, ...props }: ComponentProps<'th'> & ExtraProps) {
  return <th dir="auto" {...props} />;
}
function MarkdownTableCell({ node, ...props }: ComponentProps<'td'> & ExtraProps) {
  return <td dir="auto" {...props} data-numeric={node && /^\d+$/.test(toString(node)) ? true : undefined} />;
}
const components: Components = { a: MarkdownLink, pre: MarkdownPre, p: MarkdownParagraph, table: MarkdownTableBlock, th: MarkdownTableHeader, td: MarkdownTableCell };

function CodeFence({ block, children, generating, report }: { block: CodeBlock; children: ReactNode; generating: boolean; report: (error: unknown) => void }) {
  const [showSource, setShowSource] = useState(false);
  const [wrap, setWrap] = useState(false);
  const { copied, copying, error, copy } = useTextCopy(block.text);
  return <section className="code-fence" data-language={block.language} data-wrap={wrap}><header className="code-fence-header"><span>{block.language}</span><div>{block.language === 'mermaid' && <IconButton icon="code" label={showSource ? '显示图表' : '显示图表源码'} onClick={() => setShowSource(!showSource)} />}{(block.language !== 'mermaid' || showSource) && <IconButton icon="wrap" label="代码自动换行" aria-pressed={wrap} onClick={() => setWrap(!wrap)} />}<IconButton icon={copied ? 'check' : 'copy'} label="复制代码" title={copied ? '已复制代码' : '复制代码'} disabled={copying} onClick={() => { void copy(); }} /></div></header>{block.language === 'mermaid' ? <DiagramView source={block.text} generating={generating} showSource={showSource} /> : <pre>{children}</pre>}{copied && <p className="code-copy-feedback" role="status">已复制代码。</p>}{error && <p className="code-copy-feedback inline-error" role="alert">无法复制，请重试或选取代码原文。</p>}</section>;
}
export function MarkdownView({ content, generating = false, report }: { content: string; generating?: boolean; report: (error: unknown) => void }) {
  return <RenderingContext value={{ content, generating, report }}><div className="markdown-body"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000, strict: 'ignore' }], [rehypeHighlight, { detect: false, languages: all, plainText: ['mermaid'] }]]} components={components}>{content}</Markdown></div></RenderingContext>;
}
