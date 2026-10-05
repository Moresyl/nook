import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProjectView } from '../../contracts/commands';
import type { EditorDraft } from '../../contracts/projects';
import type { Project, Workspace } from '../../contracts/workspace';
import { Button, Empty, Field, IconButton, Input, Modal, Textarea } from '../components/controls';
import { Glyph } from '../components/glyphs';
import { ProjectEditor } from '../components/project-editor';
import { ProjectTerminal } from '../components/project-terminal';
import { ProjectChanges } from '../components/project-changes';
import { ProjectSwitcher } from '../components/project-switcher';
import { flushEditorDrafts } from '../components/editor-drafts';

type Props = { state: Workspace; view: ProjectView; onView: Dispatch<SetStateAction<ProjectView>>; onState: (next: Workspace) => void; onUse: (id: string) => void; report: (error: unknown) => void };
export function Projects({ state, view, onView, onState, onUse, report }: Props) {
  const { projectId: selectedId, panel, terminal, files } = view;
  const [editing, setEditing] = useState<Project | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<EditorDraft[] | null>(null);
  const [revision, setRevision] = useState(0);
  const selected = state.projects.find((item) => item.id === selectedId);
  useEffect(() => { let stale = false; void flushEditorDrafts().then(() => window.qiyao.load()).then((next) => { if (!stale) setDrafts(next.editorDrafts); }).catch(report); return () => { stale = true; }; }, []);
  async function select(id: string) { try { await flushEditorDrafts(selectedId); const next = await window.qiyao.load(); setDrafts(next.editorDrafts); onView((current) => ({ ...current, projectId: id, panel: 'editor' })); localStorage.setItem('qiyao.project', id); } catch (error) { report(error); } }
  async function remove(id: string) { try { await flushEditorDrafts(id); const next = await window.qiyao.removeProject(id); onState(next); setRemoveId(null); onView((current) => current.projectId === id ? { ...current, projectId: '' } : current); if (localStorage.getItem('qiyao.project') === id) localStorage.removeItem('qiyao.project'); } catch (error) { report(error); } }
  async function add() { try { const project = await window.qiyao.chooseProject(); if (project) setEditing(project); } catch (error) { report(error); } }
  return <div className={`collection-page projects-page ${selected ? 'has-selection' : ''}`}><div className="page-heading"><div><h1>项目</h1><p>编辑文件、审阅改动，在真实项目中工作。</p></div><Button tone="solid" onClick={() => { void add(); }}><Glyph name="plus" size={16} />添加项目</Button></div>
    {state.projects.length ? <div className="project-layout"><ProjectSwitcher projects={state.projects} selectedId={selectedId} onSelect={id => { void select(id); }} onEdit={setEditing} onAdd={() => { void add(); }} /><section className="project-inspector">{selected ? <><div className="section-heading"><div><h3 title={selected.name}>{selected.name}</h3><p className="path-text" title={selected.path}>{selected.path}</p></div><Button onClick={() => onUse(selected.id)}>新建项目聊天<Glyph name="right" size={14} /></Button></div><div className="inspector-toolbar"><Button aria-pressed={panel === 'editor'} onClick={() => onView((current) => ({ ...current, panel: 'editor' }))}><Glyph name="file" size={14} />文件</Button><Button aria-pressed={panel === 'changes'} onClick={() => onView((current) => ({ ...current, panel: 'changes' }))}><Glyph name="branch" size={14} />查看改动</Button><IconButton icon="folder" label={files ? '隐藏文件树' : '显示文件树'} aria-pressed={files} disabled={panel !== 'editor'} onClick={() => onView((current) => ({ ...current, files: !current.files }))} /><span className="spacer" /><Button aria-pressed={terminal} onClick={() => onView((current) => ({ ...current, terminal: !current.terminal }))}><Glyph name="code" size={14} />终端</Button></div><div className="project-workarea"><div className="project-main-panel" hidden={panel !== 'editor'}>{drafts && <ProjectEditor key={selected.id} project={selected} drafts={drafts} files={files} report={report} onSave={() => setRevision((value) => value + 1)} />}</div>{panel === 'changes' && <div className="project-main-panel"><ProjectChanges key={selected.id} projectId={selected.id} revision={revision} report={report} /></div>}{terminal && <ProjectTerminal key={selected.id} projectId={selected.id} report={report} />}</div></> : <Empty icon="folder" title="选择项目" detail="在左侧打开一个项目文件夹。" />}</section></div> : <Empty icon="folder" title="把项目带到工作台" detail="选择本地文件夹，为项目设置持续生效的工作指令。" action={<Button onClick={() => { void add(); }}>选择文件夹…</Button>} />}
    {editing && <Modal title="项目设置" onClose={() => setEditing(null)} footer={<><Button tone="danger" onClick={() => { setRemoveId(editing.id); setEditing(null); }}>移除项目</Button><span className="spacer" /><Button onClick={() => setEditing(null)}>取消</Button><Button tone="solid" disabled={!editing.name.trim()} onClick={() => { void window.qiyao.saveProject(editing).then(async (next) => { onState(next); await select(editing.id); setEditing(null); }).catch(report); }}>保存</Button></>}><Field label="项目名称"><Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field><Field label="文件夹"><Input value={editing.path} readOnly /></Field><Field label="项目指令" hint="这些指令会自动用于此项目下的对话。"><Textarea rows={8} value={editing.instructions} onChange={(event) => setEditing({ ...editing, instructions: event.target.value })} /></Field></Modal>}
    {removeId && <Modal title="移除项目？" onClose={() => setRemoveId(null)} footer={<><Button onClick={() => setRemoveId(null)}>取消</Button><Button tone="danger" onClick={() => { void remove(removeId); }}>移除</Button></>}><p>请先保存或丢弃未保存的文件草稿。移除会停止项目任务与终端；本地文件和已有聊天将保留。</p></Modal>}
  </div>;
}
