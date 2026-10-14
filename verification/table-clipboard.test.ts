import type { Element } from 'hast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownTableHtml, writeTableClipboard } from '../workbench/lib/table-clipboard';

const text = (value: string) => ({ type: 'text' as const, value });
const element = (tagName: string, children: Element['children'] = [], properties: Element['properties'] = {}): Element => ({ type: 'element', tagName, properties, children });
afterEach(() => vi.unstubAllGlobals());
describe('table clipboard', () => {
  it('keeps semantic rows, aligned Unicode cells, emphasis and code without rendering attributes', () => {
    const node = element('table', [element('thead', [element('tr', [element('th', [text('中文😀')], { align: 'center', className: ['private'] })])]), element('tbody', [element('tr', [element('td', [element('strong', [text('bold')]), element('span', [element('code', [text('<x>&"')])], { style: 'color:red' })], { align: 'right', onClick: 'attack()' })])])]);
    expect(markdownTableHtml(node)).toBe('<table dir="auto"><thead><tr><th dir="auto" style="text-align:center">中文😀</th></tr></thead><tbody><tr><td dir="auto" style="text-align:right"><strong>bold</strong><code>&lt;x&gt;&amp;&quot;</code></td></tr></tbody></table>');
  });
  it('keeps automatic direction in copied tables and cells without accepting arbitrary direction attributes', () => {
    const node = element('table', [element('tr', [element('th', [text('עברית')], { dir: 'rtl" onclick="attack' }), element('td', [text('مرحبا 中文 42')], { dir: 'ltr' })])]);
    expect(markdownTableHtml(node)).toBe('<table dir="auto"><tr><th dir="auto">עברית</th><td dir="auto">مرحبا 中文 42</td></tr></table>');
  });
  it('preserves safe links and line breaks, strips unsafe links, and retains image alt text without remote resources', () => {
    const node = element('table', [element('tr', [element('td', [element('a', [text('safe')], { href: 'https://example.invalid/?q="<&', onClick: 'attack' }), element('br'), element('img', [], { alt: '<中文>', src: 'https://example.invalid/private' }), ...['javascript:alert(1)', 'data:text/html,attack', 'file:///private', '/relative', 'java\nscript:alert(1)'].map(href => element('a', [text('plain')], { href }))])])]);
    expect(markdownTableHtml(node)).toBe('<table dir="auto"><tr><td dir="auto"><a href="https://example.invalid/?q=&quot;&lt;&amp;">safe</a><br>&lt;中文&gt;plainplainplainplainplain</td></tr></table>');
  });
  it('copies a formula once as its original TeX instead of hidden MathML and repeated visual glyphs', () => {
    for (const display of [false, true]) {
      const math = element('span', [element('span', [text('visual duplicate')]), element('annotation', [text('x^2<&')], { encoding: 'application/x-tex' })], { className: ['katex'] });
      const node = element('table', [element('tr', [element('td', [display ? element('span', [math], { className: ['katex-display'] }) : math])])]);
      expect(markdownTableHtml(node)).toBe(`<table dir="auto"><tr><td dir="auto">${display ? '$$' : '$'}x^2&lt;&amp;${display ? '$$' : '$'}</td></tr></table>`);
    }
  });
  it('refuses non-table roots and discards comments and executable elements', () => {
    expect(markdownTableHtml()).toBeUndefined(); expect(markdownTableHtml(element('div'))).toBeUndefined();
    const node = element('table', [element('tr', [element('td', [{ type: 'comment', value: 'private' }, ...['script', 'style', 'iframe', 'object', 'embed'].map(tag => element(tag, [text('attack')])), text('retained')])])]);
    expect(markdownTableHtml(node)).toBe('<table dir="auto"><tr><td dir="auto">retained</td></tr></table>');
  });
  it('writes exact plain and HTML blobs in a single clipboard item', async () => {
    const write = vi.fn(async (_items: Item[]) => {}), writeText = vi.fn();
    class Item { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal('ClipboardItem', Item); vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    await writeTableClipboard('| 中文 |\r\n| --- |', '<table><tr><td>中文</td></tr></table>');
    expect(write).toHaveBeenCalledTimes(1); expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0]![0]![0] as Item;
    expect(Object.keys(item.data)).toEqual(['text/plain', 'text/html']);
    expect(await item.data['text/plain']!.text()).toBe('| 中文 |\r\n| --- |');
    expect(await item.data['text/html']!.text()).toBe('<table><tr><td>中文</td></tr></table>');
  });
  it('uses exact text when rich clipboard APIs are unavailable or no HTML is provided', async () => {
    const writeText = vi.fn(async (_text: string) => {}); vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('ClipboardItem', undefined); await writeTableClipboard('中文\r\n', '<table></table>');
    vi.stubGlobal('ClipboardItem', class {}); await writeTableClipboard('no write API', '<table></table>');
    await writeTableClipboard('plain only'); expect(writeText.mock.calls.map(call => call[0])).toEqual(['中文\r\n', 'no write API', 'plain only']);
  });
  it('propagates a rejected rich write without silently downgrading or duplicating it', async () => {
    const error = new Error('denied'), write = vi.fn(async () => { throw error; }), writeText = vi.fn();
    vi.stubGlobal('ClipboardItem', class {}); vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    await expect(writeTableClipboard('source', '<table></table>')).rejects.toBe(error); expect(write).toHaveBeenCalledTimes(1); expect(writeText).not.toHaveBeenCalled();
  });
});
