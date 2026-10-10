import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ToolActivity } from '../../contracts/tools';
import { Button, IconButton } from './controls';
import { Glyph } from './glyphs';
import { toolActivityExpanded, toolActivitySummary, toggleToolActivity, type ToolDisclosure } from './tool-activity-state';

function ToolText({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false), [copying, setCopying] = useState(false), [error, setError] = useState(false), alive = useRef(true), revision = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { revision.current++; setCopied(false); setCopying(false); setError(false); return () => { revision.current++; }; }, [text]);
  async function copy() {
    const request = revision.current;
    setCopying(true); setError(false);
    try { await navigator.clipboard.writeText(text); if (alive.current && request === revision.current) setCopied(true); }
    catch { if (alive.current && request === revision.current) setError(true); }
    finally { if (alive.current && request === revision.current) setCopying(false); }
  }
  return <section className="tool-text"><header><span>{label}</span><IconButton icon={copied ? 'check' : 'copy'} label={copied ? `已复制${label}原文` : `复制${label}原文`} disabled={copying} onClick={() => { void copy(); }} /></header><pre tabIndex={0} aria-label={`${label}原文`}>{text}</pre>{error && <p className="inline-error" role="alert">无法复制，请重试或选取原文。</p>}</section>;
}
function ToolActivityRow({ activity }: { activity: ToolActivity }) {
  const view = useMemo(() => toolActivitySummary(activity), [activity]), id = useId(), header = useRef<HTMLButtonElement>(null), body = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<ToolDisclosure>({ running: true, settled: false }), [expanded, setExpanded] = useState(() => toolActivityExpanded(activity.status, choice));
  useLayoutEffect(() => {
    const next = toolActivityExpanded(activity.status, choice);
    if (!next && body.current?.contains(document.activeElement)) header.current?.focus({ preventScroll: true });
    setExpanded(next);
  }, [activity.status, choice]);
  return <div className={`tool-activity tool-${activity.status}`} data-activity-id={activity.id}>
    <div className="tool-activity-header"><Button ref={header} className="tool-activity-toggle" aria-expanded={expanded} aria-controls={id} title={[view.label, view.detail, view.status].filter(Boolean).join(' · ')} onClick={() => setChoice(current => toggleToolActivity(activity.status, current))}><Glyph name={view.icon} size={16} /><span className="tool-summary"><span>{view.label}</span>{view.detail && <span className="tool-target"> {view.detail}</span>}</span><span className="tool-chevron"><Glyph name="down" size={12} /></span></Button><span className="tool-status" role="status">{view.status}</span>{view.duration && <span className="tool-duration" aria-label={`耗时 ${view.duration}`}>{view.duration}</span>}</div>
    <div ref={body} id={id} className="tool-detail" data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}><div className="tool-detail-inner"><ToolText label="输入" text={activity.input} />{activity.output && <ToolText label="结果" text={activity.output} />}{!activity.output && <p className="field-hint">{activity.status === 'running' ? '等待工具输出…' : activity.status === 'waiting' ? '审批完成后继续执行。' : '没有输出内容。'}</p>}</div></div>
  </div>;
}
export function ToolActivities({ activities }: { activities: ToolActivity[] }) {
  return <div className="tool-activities" aria-label="工具执行记录">{activities.map(activity => <ToolActivityRow activity={activity} key={activity.id} />)}</div>;
}
