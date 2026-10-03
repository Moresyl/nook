import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Message } from '../../contracts/workspace';
import { chatSearchRanges, highlightChatMatches, scrollToChatMatch, type ChatMatch } from '../lib/chat-search';
import { IconButton, Input } from './controls';

type Props = { request: number; messages: Message[]; scroller: RefObject<HTMLDivElement | null>; onClose: () => void; onNavigate: () => void };
export function ChatFind({ request, messages, scroller, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState(''); const [matches, setMatches] = useState<ChatMatch[]>([]); const [position, setPosition] = useState(0); const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null); const opener = useRef<HTMLElement | null>(null); const wasOpen = useRef(false); const previousQuery = useRef('');
  const current = useRef({ matches, position }); current.current = { matches, position };
  const navigate = useRef(onNavigate); navigate.current = onNavigate;
  const [contentRevision, setContentRevision] = useState(0);
  useEffect(() => {
    if (!request) { wasOpen.current = false; setQuery(''); return; }
    if (!wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wasOpen.current = true; let frame = 0;
    const focus = () => { if (document.querySelector('dialog[open]')) { frame = requestAnimationFrame(focus); return; } input.current?.focus(); input.current?.select(); };
    frame = requestAnimationFrame(focus); return () => cancelAnimationFrame(frame);
  }, [request]);
  useEffect(() => {
    if (!request || !scroller.current) return;
    let frame = 0;
    const observer = new MutationObserver((records) => {
      if (!records.some(({ target }) => (target instanceof Element ? target : target.parentElement)?.closest('[data-message-content]'))) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setContentRevision((value) => value + 1));
    });
    observer.observe(scroller.current, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [Boolean(request), scroller]);
  useEffect(() => {
    const selected = current.current.matches[current.current.position]; let next: ChatMatch[] = [];
    try { if (request && scroller.current) next = chatSearchRanges(scroller.current, query); setError(''); } catch { setError('无法查找当前聊天，请缩短查找文字后重试。'); }
    const index = previousQuery.current === query && selected ? next.findIndex((match) => match.messageId === selected.messageId && match.start === selected.start) : 0;
    setMatches(next); setPosition(Math.max(0, index));
    if (previousQuery.current !== query && next[0] && scroller.current) { navigate.current(); scrollToChatMatch(scroller.current, next[0]); }
    previousQuery.current = query;
  }, [query, messages, contentRevision, Boolean(request), scroller]);
  useEffect(() => {
    highlightChatMatches(matches, position);
    const article = matches[position]?.range.startContainer.parentElement?.closest<HTMLElement>('[data-message-id]');
    if (article) article.dataset.findActive = 'true';
    return () => { highlightChatMatches([], 0); if (article) delete article.dataset.findActive; };
  }, [matches, position]);
  function close() {
    onClose(); requestAnimationFrame(() => { const target = opener.current; if (target?.isConnected && !target.closest('dialog[open]')) target.focus({ preventScroll: true }); else document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus({ preventScroll: true }); });
  }
  useEffect(() => {
    if (!request) return;
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing && !document.querySelector('dialog[open]')) { event.preventDefault(); close(); } };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [request, onClose]);
  function move(direction: number) {
    if (!matches.length || !scroller.current) return;
    const index = (position + direction + matches.length) % matches.length; setPosition(index); navigate.current(); scrollToChatMatch(scroller.current, matches[index]);
  }
  if (!request) return null;
  return <div className="chat-find" role="search" aria-label="查找当前聊天">
    <Input ref={input} aria-label="查找文字" placeholder="查找消息正文…" maxLength={512} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }} />
    <span className="chat-find-count" role="status" aria-label="查找结果">{error || (!query ? '输入文字' : matches.length ? `${position + 1} / ${matches.length}` : '无匹配结果')}</span>
    <IconButton icon="up" label="上一个匹配" disabled={!matches.length} onClick={() => move(-1)} /><IconButton icon="down" label="下一个匹配" disabled={!matches.length} onClick={() => move(1)} /><IconButton icon="close" label="关闭查找" onClick={close} />
  </div>;
}
