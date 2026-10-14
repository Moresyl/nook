import type { Element, RootContent } from 'hast';
import { toString } from 'hast-util-to-string';

const tags = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'p', 'strong', 'em', 'del', 'code', 'br', 'a', 'sub', 'sup']);
const excluded = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function annotation(node: Element): string | undefined {
  if (node.tagName === 'annotation' && node.properties.encoding === 'application/x-tex') return toString(node);
  for (const child of node.children) if (child.type === 'element') {
    const value = annotation(child); if (value !== undefined) return value;
  }
}
function serialize(node: RootContent): string {
  if (node.type === 'text') return escape(node.value);
  if (node.type !== 'element' || excluded.has(node.tagName)) return '';
  const classes = node.properties.className;
  if (Array.isArray(classes) && (classes.includes('katex') || classes.includes('katex-display'))) {
    const source = annotation(node);
    if (source !== undefined) { const delimiter = classes.includes('katex-display') ? '$$' : '$'; return escape(`${delimiter}${source}${delimiter}`); }
  }
  if (node.tagName === 'img') return escape(String(node.properties.alt ?? ''));
  const content = node.children.map(serialize).join('');
  if (!tags.has(node.tagName)) return content;
  let attributes = ['table', 'th', 'td'].includes(node.tagName) ? ' dir="auto"' : '';
  if (node.tagName === 'a') {
    const href = String(node.properties.href ?? '');
    try { if (!['http:', 'https:', 'mailto:'].includes(new URL(href).protocol)) return content; }
    catch { return content; }
    attributes = ` href="${escape(href)}"`;
  } else if (node.tagName === 'th' || node.tagName === 'td') {
    const align = node.properties.align;
    if (align === 'left' || align === 'center' || align === 'right') attributes += ` style="text-align:${align}"`;
  }
  return node.tagName === 'br' ? '<br>' : `<${node.tagName}${attributes}>${content}</${node.tagName}>`;
}

export function markdownTableHtml(node?: Element): string | undefined {
  return node?.tagName === 'table' ? serialize(node) : undefined;
}

export async function writeTableClipboard(text: string, html?: string): Promise<void> {
  if (html && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
  } else await navigator.clipboard.writeText(text);
}
