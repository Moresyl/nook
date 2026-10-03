import { chatTextMatches } from '../../contracts/chat-navigation';

export type ChatMatch = { messageId: string; start: number; range: Range };
const blocks = 'p,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote';
const excluded = '[hidden],[aria-hidden="true"],.katex-mathml,.code-fence-header,.diagram-toolbar';

export function chatSearchRanges(root: HTMLElement, query: string): ChatMatch[] {
  if (!query) return [];
  const result: ChatMatch[] = [];
  for (const scope of root.querySelectorAll<HTMLElement>('[data-message-content]')) {
    const messageId = scope.closest<HTMLElement>('[data-message-id]')?.dataset.messageId;
    if (!messageId) continue;
    const parts: { node: Text; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let text = ''; let previousBlock: Element | null = null;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text; const parent = node.parentElement;
      if (!parent || parent.closest(excluded) || !parent.getClientRects().length) continue;
      const block = parent.closest(blocks) ?? scope;
      if (previousBlock && previousBlock !== block) text += '\n';
      previousBlock = block;
      const start = text.length; text += node.data; parts.push({ node, start, end: text.length });
    }
    let startIndex = 0; let endIndex = 0;
    for (const match of chatTextMatches(text, query)) {
      while (startIndex < parts.length && parts[startIndex].end <= match.start) startIndex++;
      while (endIndex < parts.length && parts[endIndex].end < match.end) endIndex++;
      const first = parts[startIndex]; const last = parts[endIndex];
      if (!first || !last || match.start < first.start || match.end < last.start) continue;
      const range = document.createRange(); range.setStart(first.node, match.start - first.start); range.setEnd(last.node, match.end - last.start); result.push({ messageId, start: match.start, range });
    }
  }
  return result;
}

export function scrollToChatMatch(scroller: HTMLElement, match: ChatMatch): void {
  for (let parent = match.range.startContainer.parentElement; parent && parent !== scroller; parent = parent.parentElement) {
    const box = parent.getBoundingClientRect(); const rect = match.range.getClientRects()[0];
    if (!rect) return;
    const style = getComputedStyle(parent);
    if (['auto', 'scroll'].includes(style.overflowX) && (rect.left < box.left || rect.right > box.right)) parent.scrollLeft += rect.left - box.left - 12;
    if (['auto', 'scroll'].includes(style.overflowY) && (rect.top < box.top || rect.bottom > box.bottom)) parent.scrollTop += rect.top - box.top - 12;
  }
  const rect = match.range.getClientRects()[0];
  if (rect) scroller.scrollTo({ top: scroller.scrollTop + rect.top - scroller.getBoundingClientRect().top - Math.min(60, scroller.clientHeight / 3), behavior: 'auto' });
}

export function highlightChatMatches(matches: ChatMatch[], active: number): void {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  CSS.highlights.delete('qiyao-chat-search'); CSS.highlights.delete('qiyao-chat-search-current');
  if (!matches.length) return;
  const all = new Highlight(); for (const match of matches) all.add(match.range);
  CSS.highlights.set('qiyao-chat-search', all);
  if (matches[active]) CSS.highlights.set('qiyao-chat-search-current', new Highlight(matches[active].range));
}
