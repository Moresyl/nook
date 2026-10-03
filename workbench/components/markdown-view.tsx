import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { all } from 'lowlight';
import { codeBlockFromNode, type CodeBlock } from '../lib/rich-content';
import { DiagramView } from './diagram-view';
import { IconButton } from './controls';

type Rendering = { generating: boolean; report: (error: unknown) => void };
const RenderingContext = createContext<Rendering | null>(null);
function useRendering(): Rendering {
  const rendering = useContext(RenderingContext);
  if (!rendering) throw new Error('Markdown rendering context is unavailable.');
  return rendering;
}
function MarkdownLink({ href, children }: ComponentProps<'a'>) {
  const { report } = useRendering();
  return <a href={href} onClick={(event) => { event.preventDefault(); if (href) void window.qiyao.openExternal(href).catch(report); }}>{children}</a>;
}
function MarkdownPre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const { generating, report } = useRendering(); const block = codeBlockFromNode(node);
  return block ? <CodeFence block={block} generating={generating} report={report}>{children}</CodeFence> : <pre>{children}</pre>;
}
const components: Components = { a: MarkdownLink, pre: MarkdownPre };

function CodeFence({ block, children, generating, report }: { block: CodeBlock; children: ReactNode; generating: boolean; report: (error: unknown) => void }) {
  const [showSource, setShowSource] = useState(false);
  return <section className="code-fence" data-language={block.language}><header className="code-fence-header"><span>{block.language}</span><div>{block.language === 'mermaid' && <IconButton icon="code" label={showSource ? '显示图表' : '显示图表源码'} onClick={() => setShowSource(!showSource)} />}<IconButton icon="copy" label="复制代码" onClick={() => { void navigator.clipboard.writeText(block.text).catch(report); }} /></div></header>{block.language === 'mermaid' ? <DiagramView source={block.text} generating={generating} showSource={showSource} /> : <pre>{children}</pre>}</section>;
}
export function MarkdownView({ content, generating = false, report }: { content: string; generating?: boolean; report: (error: unknown) => void }) {
  return <RenderingContext value={{ generating, report }}><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000, strict: 'ignore' }], [rehypeHighlight, { detect: false, languages: all, plainText: ['mermaid'] }]]} components={components}>{content}</Markdown></RenderingContext>;
}
