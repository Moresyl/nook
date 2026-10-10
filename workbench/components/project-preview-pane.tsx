import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNativeViewport } from '../lib/native-viewport';
import type { ProjectPreviewInput, PreviewViewport } from '../../contracts/project-preview';
import { Button } from './controls';
import { TextHint } from './control-tooltip';

type Props = { projectId: string; input: ProjectPreviewInput | null; children: ReactNode; onClose(): void; onRefresh(): void; onFloating(): void };

function PreviewPane({ projectId, input, onClose, onRefresh, onFloating, onEdit }: Omit<Props, 'children'> & { input: ProjectPreviewInput; onEdit?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const [token, setToken] = useState<string | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false; let owned: string | null = null;
    setToken(null); setError(false);
    void window.qiyao.previewProjectDocked(projectId, input).then(value => {
      owned = value;
      if (disposed) { if (value) void window.qiyao.closeProjectPreview(projectId, value).catch(() => {}); return; }
      if (!value) { setError(true); return; }
      setToken(value); closeButton.current?.focus();
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; if (owned) void window.qiyao.closeProjectPreview(projectId, owned).catch(() => {}); };
  }, [projectId, input]);

  useEffect(() => window.qiyao.onProjectPreviewFailure(failed => { if (failed === token) setError(true); }), [token]);

  const layout = useCallback((bounds: PreviewViewport | null) => token ? window.qiyao.layoutProjectPreview(projectId, token, bounds) : Promise.resolve(), [projectId, token]);
  const fail = useCallback(() => { setError(true); if (token) void window.qiyao.closeProjectPreview(projectId, token).catch(() => {}); }, [projectId, token]);
  useNativeViewport(viewport, Boolean(token), layout, fail);

  return <section className="project-preview-pane" aria-label="项目预览">
    <header className="project-preview-toolbar"><TextHint text={input.path}>{input.path.split('/').at(-1)}</TextHint>{onEdit && <Button onClick={onEdit}>编辑代码</Button>}<Button onClick={onRefresh}>刷新</Button><Button onClick={onFloating}>独立窗口</Button><Button ref={closeButton} onClick={onClose}>关闭预览</Button></header>
    <div ref={viewport} className="project-preview-viewport">{(!token || error) && <div className="project-preview-status" role="status">{error ? <><p>预览未能打开，草稿已保留。</p><Button onClick={onRefresh}>重试</Button></> : '正在打开预览…'}</div>}</div>
    <footer>修改后点击刷新 · Esc 返回工作台</footer>
  </section>;
}

export function ProjectPreviewLayout({ children, ...props }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [vertical, setVertical] = useState(false), [share, setShare] = useState(50), [compact, setCompact] = useState(false), [pane, setPane] = useState('preview');
  useEffect(() => {
    const element = container.current!; const resize = new ResizeObserver(() => { setVertical(element.clientWidth < 640); setCompact(element.clientWidth < 640 && element.clientHeight < 360); }); resize.observe(element); return () => resize.disconnect();
  }, []);
  useEffect(() => { if (props.input) setPane('preview'); }, [props.input]);
  const clamp = (value: number) => Math.max(20, Math.min(80, value));
  return <div ref={container} className={`editor-workspace ${props.input ? 'with-preview' : ''} ${compact ? 'compact-preview' : ''}`} data-vertical={vertical} data-pane={pane} style={{ '--editor-share': `${share}%` } as CSSProperties}>
    {props.input && compact && pane === 'editor' && <div className="project-preview-modebar"><Button onClick={() => setPane('preview')}>查看预览</Button><Button onClick={props.onClose}>关闭预览</Button></div>}
    {children}
    {props.input && <><div className="project-preview-divider" role="separator" tabIndex={0} aria-label="调整编辑器与预览大小" aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={share}
      onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = container.current!.getBoundingClientRect(); setShare(clamp(Math.round((vertical ? (event.clientY - rect.top) / rect.height : (event.clientX - rect.left) / rect.width) * 100))); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onKeyDown={event => { const negative = vertical ? 'ArrowUp' : 'ArrowLeft', positive = vertical ? 'ArrowDown' : 'ArrowRight'; if (![negative, positive, 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setShare(value => event.key === 'Home' ? 20 : event.key === 'End' ? 80 : clamp(value + (event.key === negative ? -5 : 5))); }} />
      <PreviewPane {...props} input={props.input} onEdit={compact ? () => setPane('editor') : undefined} onClose={() => { props.onClose(); requestAnimationFrame(() => container.current?.parentElement?.querySelector<HTMLButtonElement>('.editor-actionbar .button')?.focus()); }} /></>}
  </div>;
}
