import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Element } from 'hast';
import { describe, expect, it } from 'vitest';
import { codeBlockFromNode, diagramPolicy, validateDiagramSource } from '../workbench/lib/rich-content';
import { MarkdownView } from '../workbench/components/markdown-view';
import { ContentBridgeContext } from '../workbench/components/content-bridge';

const unavailable = async () => { throw new Error('External document operations are unavailable in this rendering fixture.'); };
const render = (content: string, allowWideBlocks?: boolean) => renderToStaticMarkup(createElement(ContentBridgeContext, { value: { openExternal: async () => {}, attachFiles: unavailable, importAttachments: unavailable, readDocumentOriginal: unavailable, exportDocumentOriginal: unavailable, exportAttachmentImage: unavailable } }, createElement(MarkdownView, { content, allowWideBlocks, report: () => {} })));
describe('rich message rendering', () => {
  it('enables wide tables only for an explicit caller and keeps layout flags out of semantic table markup', () => {
    const source = '| Column | Value |\n| --- | --- |\n| Text | 42 |';
    for (const enabled of [undefined, false, true]) {
      const markup = render(source, enabled);
      expect(markup.includes('data-wide-block=""')).toBe(enabled === true);
      expect(markup).toContain('class="markdown-table-wrapper"><table dir="auto">');
      expect(markup).not.toMatch(/<table[^>]*(?:allowWideBlocks|data-wide-block)/i);
      expect(markup).toContain('<td dir="auto" data-numeric="true">42</td>');
    }
  });
  it('marks visible Han text in paragraphs, including nested formatting, links and extended Unicode', () => {
    for (const source of ['中文', 'English **汉字**', '[中文](https://example.invalid)', '`汉字`', '\u{20000}']) {
      const markup = render(source); expect(markup).toContain('data-markdown-han-text="true"');
    }
    for (const source of ['English 😀', 'かなだけ', '한글', '[English](https://example.invalid/中文)']) expect(render(source)).not.toContain('data-markdown-han-text');
  });
  it('retains independent paragraphs and nested list, heading and quotation semantics', () => {
    const markup = render('中文第一段\n\nEnglish **second** paragraph\n\n## Heading\n\n- Parent\n  - Child\n\n> Quote\n\n---');
    expect(markup).toContain('class="markdown-body"'); expect(markup).toContain('<p data-markdown-han-text="true">中文第一段</p>');
    expect(markup).toContain('<p>English <strong>second</strong> paragraph</p>'); expect(markup).toContain('<h2>Heading</h2>');
    expect(markup.match(/<ul>/g)).toHaveLength(2); expect(markup).toContain('<blockquote>'); expect(markup).toContain('<hr/>');
  });
  it('renders aligned GFM tables with accessible copy controls without creating an executable preview', () => {
    const markup = render('| 左侧 | 右侧 |\n| :--- | ---: |\n| **汉字** | 42 |');
    expect(markup).toContain('<table dir="auto">'); expect(markup).toContain('text-align:left'); expect(markup).toContain('text-align:right');
    expect(markup).toContain('aria-label="复制表格"'); expect(markup).not.toContain('aria-label="复制表格" disabled');
    expect(markup).toContain('data-markdown-copy="exclude"'); expect(markup).not.toContain('<dialog'); expect(markup).toContain('<strong>汉字</strong>');
  });
  it('preserves bidirectional cell text and marks only complete unsigned numeric values, including nested emphasis', () => {
    const source = '| עברית | 数字 |\n| :--- | ---: |\n| مرحبا | **1234567890** |\n| 中文 | 001 |\n| English | -42 |\n| نص | 1.5 |\n| 😀 | 42 kg |';
    const markup = render(source);
    expect(markup.match(/data-numeric="true"/g)).toHaveLength(2);
    expect(markup).toContain('data-numeric="true"><strong>1234567890</strong>');
    expect(markup).toContain('data-numeric="true">001');
    expect(markup).toContain('<th dir="auto" style="text-align:left">עברית</th>');
    expect(markup).toContain('<td dir="auto" style="text-align:left">مرحبا</td>');
    for (const text of ['中文', 'English', '-42', '1.5', '42 kg', '😀']) expect(markup).toContain(text);
    expect(markup).not.toContain('node="'); expect(source).toContain('**1234567890**');
  });
  it('renders inline/display/fenced formulas and accessible MathML without changing their saved source', () => {
    const source = 'Inline $x^2$\n\n$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$\n\n```math\n\\sqrt{2}\n```';
    const markup = render(source); expect(markup.match(/class="katex"/g)).toHaveLength(3); expect(markup.match(/class="katex-display"/g)).toHaveLength(2); expect(markup).toContain('<math'); expect(markup).toContain('application/x-tex'); expect(source).toContain('\\sqrt{2}');
  });
  it('shows malformed or expansion-limited math and refuses trusted HTML/remote-image commands', () => {
    for (const source of ['$\\notARealCommand{a}$', '$\\def\\a{\\a}\\a$', '$\\href{javascript:alert(1)}{click}$', '$\\includegraphics{https://example.invalid/private.png}$']) { const markup = render(source); expect(markup).not.toContain('<img'); expect(markup).not.toContain('href="javascript:'); expect(markup).not.toContain('<script'); expect(markup).toContain('katex'); }
  });
  it('highlights known languages, preserves HTML-looking source as text and leaves unknown languages readable', () => {
    const markup = render('```javascript\nconst message = "<img src=x onerror=alert(1)>";\n```\n\n```unknown-language\nKEEP_UNKNOWN_SOURCE\n```');
    expect(markup).toContain('hljs-keyword'); expect(markup).toContain('hljs-string'); expect(markup).toContain('&lt;img'); expect(markup).not.toContain('<img'); expect(markup).toContain('KEEP_UNKNOWN_SOURCE'); expect(markup).toContain('复制代码');
  });
  it('isolates ordinary code and diagram source direction without changing bidirectional text', () => {
    const source = 'const text = "中文 مرحبا עברית";';
    for (const language of ['javascript', 'mermaid', 'unknown-language']) {
      const markup = render(`\`\`\`${language}\n${source}\n\`\`\``);
      expect(markup).toContain('<pre dir="ltr"><code');
      for (const text of ['中文', 'مرحبا', 'עברית']) expect(markup).toContain(text);
      expect(markup).not.toContain('<pre dir="rtl"');
    }
  });
  it('keeps untrusted raw HTML and diagram source out of executable markup', () => {
    const markup = render('<script>window.attack=true</script>\n\n```mermaid\nflowchart LR\n A[KEEP_DIAGRAM_SOURCE] --> B[Done]\n```');
    expect(markup).not.toContain('<script>'); expect(markup).toContain('KEEP_DIAGRAM_SOURCE'); expect(markup).toContain('显示图表源码'); expect(markup).not.toContain('<iframe');
  });
  it('extracts exact code text across token spans, retains intentional final newlines and validates labels', () => {
    const node: Element = { type: 'element', tagName: 'pre', properties: {}, children: [{ type: 'element', tagName: 'code', properties: { className: ['hljs', 'language-TypeScript'] }, children: [{ type: 'element', tagName: 'span', properties: {}, children: [{ type: 'text', value: 'const' }] }, { type: 'text', value: ' x = 1;\n\n' }] }] };
    expect(codeBlockFromNode(node)).toEqual({ language: 'typescript', text: 'const x = 1;\n' }); const code = node.children[0] as Element; code.properties.className = ['language-../../invalid']; expect(codeBlockFromNode(node)?.language).toBe('text'); code.properties.className = undefined; expect(codeBlockFromNode(node)?.language).toBe('text'); expect(codeBlockFromNode()).toBeUndefined(); expect(codeBlockFromNode({ ...node, children: [] })).toBeUndefined();
  });
  it('bounds graph rendering without truncating caller source and rejects empty/binary graph input', () => {
    for (const source of ['', ' \n', 'flowchart LR\0 A-->B', 'a'.repeat(50_001)]) expect(() => validateDiagramSource(source)).toThrow();
    const source = 'flowchart LR\nA-->B'; expect(() => validateDiagramSource(source)).not.toThrow(); expect(() => validateDiagramSource('a'.repeat(50_000))).not.toThrow(); expect(source).toBe('flowchart LR\nA-->B');
  });
  it('maps both palettes into a policy whose security and rendering limits cannot be changed by graph directives', () => {
    for (const dark of [false, true]) { const colors = { background: dark ? '#212121' : '#ffffff', surface: '#f9f9f9', text: '#282828', border: '#d1d1d1', accent: '#0285ff', dark }; const policy = diagramPolicy(colors); expect(policy.securityLevel).toBe('strict'); expect(policy.htmlLabels).toBe(false); expect(policy.themeVariables?.background).toBe(colors.background); expect(policy.themeVariables?.darkMode).toBe(dark); expect(policy.secure).toEqual(expect.arrayContaining(['securityLevel', 'htmlLabels', 'maxTextSize', 'maxEdges', 'themeVariables'])); }
  });
});
