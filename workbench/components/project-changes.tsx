import { useEffect, useState } from 'react';
import type { GitFile, GitFileView, GitStatus } from '../../contracts/projects';
import { Button, Empty, Field, IconButton, Textarea } from './controls';
import { CodeDiff } from './code-editor';

export function ProjectChanges({ projectId, revision, report }: { projectId: string; revision: number; report: (error: unknown) => void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<GitFileView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() { try { setStatus(await window.qiyao.gitStatus(projectId)); setError(''); } catch { setError('无法读取 Git 仓库。请确认当前文件夹已初始化，且 Git 可用。'); } }
  useEffect(() => { void refresh(); }, [projectId, revision]);
  async function stage(file: GitFile, staged: boolean) { setBusy(true); try { setStatus(await window.qiyao.gitStage(projectId, [file.path, ...(file.originalPath ? [file.originalPath] : [])], staged)); setView(null); } catch (error) { report(error); } finally { setBusy(false); } }
  async function commit() { setBusy(true); try { setStatus(await window.qiyao.gitCommit(projectId, message)); setMessage(''); setView(null); } catch (error) { report(error); } finally { setBusy(false); } }
  const group = (staged: boolean) => status?.files.filter((file) => staged ? !['.', '?'].includes(file.index) : file.working !== '.' || file.index === '?');
  return <div className="project-changes"><aside className="changes-list"><div className="editor-files-toolbar"><span title={status?.branch}>分支 · {status?.branch || '…'}{status?.unborn && ' · 尚无提交'}</span><IconButton icon="retry" label="刷新 Git 状态" onClick={() => { void refresh(); }} /></div>{error ? <p className="muted">{error}</p> : <><Field label="提交信息"><Textarea value={message} rows={3} onChange={(event) => setMessage(event.target.value)} placeholder="描述本次改动" /></Field><Button tone="solid" disabled={busy || !message.trim() || !group(true)?.length || status?.files.some((file) => file.conflict)} onClick={() => { void commit(); }}>提交已暂存改动</Button>{[true, false].map((staged) => <section key={String(staged)}><h4>{staged ? '已暂存' : '工作区'} <span className="muted">{group(staged)?.length ?? 0}</span></h4>{group(staged)?.map((file) => <div className="change-row" key={file.path}><Button title={file.path} onClick={() => { void window.qiyao.gitFileView(projectId, file, staged).then(setView).catch(report); }}><span className={file.conflict ? 'conflict-marker' : ''}>{staged ? file.index : file.working}</span><span>{file.path}</span></Button><Button disabled={busy || file.conflict} onClick={() => { void stage(file, !staged); }}>{staged ? '撤回' : '暂存'}</Button></div>)}</section>)}</>}</aside><div className="changes-preview">{view ? <><div className="editor-actionbar"><span className="path-text">{view.path}</span><span className="spacer" /><span className="muted">原始版本 → 当前版本</span></div><div className="editor-canvas">{view.binary ? <pre>{view.patch || '二进制、过大或无法读取的文件；请使用外部工具检查。'}</pre> : <CodeDiff key={view.path} path={view.path} before={view.before} after={view.after} />}</div></> : <Empty icon="branch" title="审阅项目改动" detail="选择文件比较，暂存确认后的内容，再提交。" />}</div></div>;
}
