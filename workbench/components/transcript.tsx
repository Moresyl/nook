import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Message, Thread } from '../../contracts/workspace';
import { IconButton } from './controls';
import { ToolActivities } from './tool-activity';
import { MarkdownView } from './markdown-view';
import { ModelUsage } from './model-usage';
import { AttachmentList } from './attachments';
import { KnowledgeSources } from './knowledge-sources';
import { replyVersions } from '../../contracts/reply-versions';
import { ReplyVersions } from './reply-versions';
import { messageMarkers } from '../../contracts/chat-navigation';
import { MessageNavigation } from './message-navigation';
import { ChatFind } from './chat-find';

type Props = { thread: Thread; threads: Thread[]; findRequest: number; onFindClose: () => void; onVersion: (threadId: string) => Promise<void>; onBranch: (message: Message) => void; onEdit: (message: Message) => void; onQuote: (message: Message, selectedText?: string) => void; onRetry: () => void; report: (error: unknown) => void };
export function Transcript({ thread, threads, findRequest, onFindClose, onVersion, onBranch, onEdit, onQuote, onRetry, report }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const follows = useRef(true);
  const [current, setCurrent] = useState(''); const id = useId(); const nodes = useRef(new Map<string, HTMLElement>());
  const markers = useMemo(() => messageMarkers(thread.messages), [thread.messages]); const latest = useRef(markers); latest.current = markers;
  const indexes = useMemo(() => new Map(thread.messages.map((message, index) => [message.id, index])), [thread.messages]);
  const searching = useRef(false); searching.current = findRequest > 0;
  const updateScroll = useCallback(() => {
    const element = scroller.current; if (!element) return;
    element.style.setProperty('--top-fade', element.scrollTop > 1 ? '1rem' : '0px'); element.style.setProperty('--bottom-fade', element.scrollHeight - element.clientHeight - element.scrollTop > 1 ? '1rem' : '0px');
    const edge = element.getBoundingClientRect().top + 60; let selected = latest.current[0]?.id ?? '';
    for (const marker of latest.current) { const article = nodes.current.get(marker.id); if (!article || article.getBoundingClientRect().top > edge) break; selected = marker.id; }
    setCurrent(selected);
  }, []);
  useEffect(() => { follows.current = true; }, [thread.id]);
  useEffect(() => { if (follows.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); updateScroll(); }, [thread.messages, updateScroll]);
  useEffect(() => { const content = scroller.current?.querySelector('.transcript'); if (!content) return; const observer = new ResizeObserver(() => { if (follows.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); updateScroll(); }); observer.observe(content); return () => observer.disconnect(); }, [updateScroll]);
  const running = thread.messages.some((message) => message.status === 'running');
  const versions = replyVersions(threads, thread.id);
  return <><ChatFind key={thread.id} request={findRequest} messages={thread.messages} scroller={scroller} onClose={onFindClose} onNavigate={() => { follows.current = false; }} /><div className="transcript-region"><MessageNavigation markers={markers} current={current} controls={(messageId) => `${id}-${indexes.get(messageId)}`} onJump={(messageId, scrubbing) => { follows.current = false; nodes.current.get(messageId)?.scrollIntoView({ block: 'start', behavior: scrubbing || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); setCurrent(messageId); }} /><div className="transcript-scroll" ref={scroller} onScroll={(event) => { const node = event.currentTarget; follows.current = !searching.current && node.scrollHeight - node.scrollTop - node.clientHeight < 100; updateScroll(); }}><div className="transcript">
    {thread.messages.map((message, index) => <article className={`message message-${message.role}`} key={message.id} id={`${id}-${index}`} data-message-id={message.id} ref={(element) => { if (element) nodes.current.set(message.id, element); else nodes.current.delete(message.id); }} aria-label={message.role === 'user' ? '你的消息' : '助手回复'}>
      {message.role === 'user' ? <div className="user-bubble"><div className="plain-text" data-message-content>{message.content}</div>{message.attachments.length > 0 && <AttachmentList files={message.attachments} />}</div> : <div className="assistant-prose">{Boolean(message.activities?.length) && <ToolActivities activities={message.activities!} responseStatus={message.status} />}<div data-message-content><MarkdownView content={message.content} generating={message.status === 'running'} report={report} /></div>{message.status === 'running' && <span className="stream-dot" aria-label="正在生成" />}{message.error && <p className="inline-error">{message.error}</p>}{message.status === 'stopped' && <p className="muted text-small">已停止生成</p>}</div>}
      {!running && <div className="message-actions"><IconButton icon="copy" label="复制消息" onClick={() => { void navigator.clipboard.writeText(message.content).catch(report); }} /><IconButton icon="quote" label="引用消息" disabled={!message.content.trim()} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { const selection = window.getSelection(); const article = event.currentTarget.closest('article'); const selected = selection && article?.contains(selection.anchorNode) && article.contains(selection.focusNode) ? selection.toString() : undefined; onQuote(message, selected); }} /><IconButton icon="compose" label={message.role === 'user' ? '编辑消息' : '编辑回复'} onClick={() => onEdit(message)} /><IconButton icon="branch" label="从这里创建分支" onClick={() => onBranch(message)} />{message.role === 'assistant' && index === thread.messages.length - 1 && <IconButton icon="retry" label="重新生成" onClick={onRetry} />}</div>}
      {Boolean(message.invocations?.length) && <ModelUsage invocations={message.invocations!} />}
      {message.editedAt !== undefined && <p className="muted text-small" aria-label="手动编辑">已手动编辑{Boolean(message.invocations?.length) && ' · 保留原生成记录'}</p>}
      {!running && message.replyVersion && <ReplyVersions versions={versions.get(message.replyVersion.groupId) ?? []} messageId={message.id} onSelect={onVersion} />}
      {message.role === 'assistant' && message.knowledgeSources && <KnowledgeSources sources={message.knowledgeSources} content={message.content} />}
    </article>)}
  </div></div></div></>;
}
