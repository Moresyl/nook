import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEvent, TerminalSession } from '../../contracts/projects';
import { Button, Empty, IconButton, Modal } from './controls';

function TerminalView({ session, report }: { session: TerminalSession; report: (error: unknown) => void }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, "SFMono-Regular", monospace', fontSize: 12, scrollback: 5000, screenReaderMode: true, convertEol: false, allowProposedApi: false });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container.current!);
    let sequence = 0; let ready = false; let disposed = false; let exited = session.status === 'exited'; const queued: TerminalEvent[] = [];
    const apply = (event: TerminalEvent) => { if (event.sequence <= sequence) return; sequence = event.sequence; if (event.data) terminal.write(event.data); if (event.exitCode !== undefined) { exited = true; terminal.options.disableStdin = true; terminal.writeln(`\r\n[进程已退出：${event.exitCode}]`); } };
    const unsubscribe = window.qiyao.onTerminal((event) => { if (event.id !== session.id) return; if (ready) apply(event); else queued.push(event); });
    void window.qiyao.terminalList(session.projectId).then((items) => {
      const snapshot = items.find((item) => item.id === session.id); if (!snapshot || disposed) return;
      terminal.write(snapshot.output); sequence = snapshot.sequence; exited = snapshot.status === 'exited'; terminal.options.disableStdin = exited;
      if (exited) terminal.writeln(`\r\n[进程已退出：${snapshot.exitCode}]`);
      ready = true; queued.forEach(apply);
    }).catch(report);
    const input = terminal.onData((data) => { if (!exited) void window.qiyao.terminalWrite(session.id, data).catch(report); });
    const binary = terminal.onBinary((data) => { if (!exited) void window.qiyao.terminalWrite(session.id, data).catch(report); });
    const resize = () => { if (container.current && container.current.clientWidth > 0 && container.current.clientHeight > 0) { fit.fit(); if (!exited && terminal.cols >= 2 && terminal.rows >= 2) void window.qiyao.terminalResize(session.id, { cols: Math.min(500, terminal.cols), rows: Math.min(300, terminal.rows) }).catch(report); } };
    const observer = new ResizeObserver(resize); observer.observe(container.current!);
    const theme = () => { const css = getComputedStyle(document.documentElement); terminal.options.theme = { background: css.getPropertyValue('--ds-bg').trim(), foreground: css.getPropertyValue('--ds-text').trim(), cursor: css.getPropertyValue('--ds-text').trim(), selectionBackground: css.getPropertyValue('--color-background-text-selection').trim() }; };
    theme(); const themeObserver = new MutationObserver(theme); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); resize();
    return () => { disposed = true; unsubscribe(); observer.disconnect(); themeObserver.disconnect(); input.dispose(); binary.dispose(); terminal.dispose(); };
  }, [session.id]);
  return <div ref={container} className="terminal-canvas" aria-label="项目交互式终端" />;
}
export function ProjectTerminal({ projectId, report }: { projectId: string; report: (error: unknown) => void }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [active, setActive] = useState('');
  const [closing, setClosing] = useState<TerminalSession | null>(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => { let stale = false; void window.qiyao.terminalList(projectId).then((items) => { if (!stale) { setSessions(items); setActive(items.at(-1)?.id ?? ''); } }).catch(report); const unsubscribe = window.qiyao.onTerminal((event) => { if (event.exitCode !== undefined) setSessions((items) => items.map((item) => item.id === event.id ? { ...item, status: 'exited', exitCode: event.exitCode } : item)); }); return () => { stale = true; unsubscribe(); }; }, [projectId]);
  async function open() { setOpening(true); try { const session = await window.qiyao.terminalOpen(projectId, { cols: 80, rows: 12 }); setSessions((items) => [...items, session]); setActive(session.id); } catch (error) { report(error); } finally { setOpening(false); } }
  async function close(session: TerminalSession) { try { await window.qiyao.terminalClose(session.id); const next = sessions.filter((item) => item.id !== session.id); setSessions(next); if (active === session.id) setActive(next.at(-1)?.id ?? ''); setClosing(null); } catch (error) { report(error); } }
  const selected = sessions.find((item) => item.id === active);
  return <div className="project-terminal"><div className="terminal-tabs" role="tablist" aria-label="终端会话"><span className="panel-label">终端</span>{sessions.map((session, index) => <div key={session.id} className={`editor-tab ${session.id === active ? 'active' : ''}`}><Button role="tab" aria-selected={session.id === active} onClick={() => setActive(session.id)}>PowerShell {index + 1}{session.status === 'exited' ? ' · 已退出' : ''}</Button><IconButton icon="close" label={`关闭终端 ${index + 1}`} onClick={() => { if (session.status === 'running') setClosing(session); else void close(session); }} /></div>)}<span className="spacer" /><IconButton icon="plus" label="新建终端" disabled={opening} onClick={() => { void open(); }} /></div>{selected ? <TerminalView key={selected.id} session={selected} report={report} /> : <Empty icon="code" title="打开项目终端" detail="在项目文件夹中运行交互式命令。" action={<Button onClick={() => { void open(); }} disabled={opening}>新建终端</Button>} />}{closing && <Modal title="结束终端会话？" onClose={() => setClosing(null)} footer={<><Button onClick={() => setClosing(null)}>取消</Button><Button tone="danger" onClick={() => { void close(closing); }}>结束会话</Button></>}><p>此终端及其子进程将结束。正在运行的命令会被中断。</p></Modal>}</div>;
}
