import { useEffect, useId, useRef, useState } from 'react';
import type { EditorDraft, FileDocument } from '../../contracts/projects';
import type { Project } from '../../contracts/workspace';
import { Button, Empty, Field, IconButton, Input, Modal } from './controls';
import { CodeDiff, CodeEditor } from './code-editor';
import { persistEditorDraft, registerEditorDrafts } from './editor-drafts';
import { ProjectExplorer } from './project-explorer';
import { TextHint } from './control-tooltip';
import { previewTextPattern, type ProjectPreviewInput } from '../../contracts/project-preview';
import { ProjectPreviewLayout } from './project-preview-pane';
import { EditorTabs } from './editor-tabs';
import { Glyph } from './glyphs';
import { mergeRefreshedEditorTabs } from './editor-branch-refresh';

type Props = { project: Project; drafts: EditorDraft[]; files: boolean; report: (error: unknown) => void; onSave: () => void; branchRevision?: number };
export function ProjectEditor({ project, drafts, files, report, onSave, branchRevision = 0 }: Props) {
  const tabId = useId(), panelId = `${tabId}-panel`;
  const [tabs, setTabs] = useState<EditorDraft[]>(() => drafts.filter((draft) => draft.projectId === project.id));
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const [active, setActive] = useState(tabs[0]?.path ?? '');
  const [refresh, setRefresh] = useState(0);
  const [closing, setClosing] = useState<string | null>(null);
  const [newPath, setNewPath] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ path: string; current: FileDocument | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [dockedPreview, setDockedPreview] = useState<ProjectPreviewInput | null>(null);
  const savingRef = useRef(false);
  const [saveNotice, setSaveNotice] = useState('');
  const previousBranch = useRef(branchRevision);
  useEffect(() => {
    if (previousBranch.current === branchRevision) return;
    previousBranch.current = branchRevision; let stale = false;
    setDockedPreview(null); setRefresh(value => value + 1);
    const clean = tabsRef.current.filter(item => item.text === item.baseText);
    void Promise.all(clean.map(async before => ({ before, document: await window.qiyao.loadDocument(project.id, before.path).catch(() => null) }))).then(documents => {
      if (stale) return;
      const next = mergeRefreshedEditorTabs(tabsRef.current, documents); tabsRef.current = next.tabs; setTabs(next.tabs);
      setSaveNotice(next.unreadable ? '新分支中有文件无法读取，保留上次内容；请核对文件后继续。' : '已刷新分支文件，未保存草稿仍保留');
    });
    return () => { stale = true; };
  }, [branchRevision]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const tab = tabs.find((item) => item.path === active);
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => () => {
    for (const [path, timer] of timers.current) { clearTimeout(timer); const draft = tabsRef.current.find((item) => item.path === path); if (draft) void persistEditorDraft(draft).catch(report); }
    timers.current.clear();
  }, []);
  useEffect(() => {
    const flush = async () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      await Promise.all(tabsRef.current.filter((item) => item.text !== item.baseText).map(persistEditorDraft));
    };
    const unregister = registerEditorDrafts(project.id, flush); const unsubscribe = window.qiyao.onBeforeClose(flush);
    return () => { unregister(); unsubscribe(); };
  }, []);
  function change(path: string, text: string) {
    if (text.length > 256_000) { report(new Error('文件大小超过 256 KB；请拆分后编辑。')); return; }
    setSaveNotice('');
    const next = tabsRef.current.map((item) => item.path === path ? { ...item, text, updatedAt: Date.now() } : item);
    tabsRef.current = next; setTabs(next);
    clearTimeout(timers.current.get(path));
    timers.current.set(path, setTimeout(() => { timers.current.delete(path); const draft = tabsRef.current.find((item) => item.path === path); if (draft) void persistEditorDraft(draft).catch(report); }, 250));
  }
  function previewInput(path = tab?.path): ProjectPreviewInput | null {
    const entry = tabsRef.current.find(item => item.path === path);
    return entry ? { path: entry.path, text: entry.text, drafts: tabsRef.current.filter(item => item.path !== entry.path && previewTextPattern.test(item.path) && (item.text !== item.baseText || item.baseSha256 === null)).map(({ path, text }) => ({ path, text })) } : null;
  }
  function refreshPreview() { const next = previewInput(dockedPreview?.path); if (next) setDockedPreview(next); }
  async function preview(floatingInput?: ProjectPreviewInput) {
    if (!tab || previewing) return;
    setPreviewing(true);
    try { await window.qiyao.previewProject(project.id, floatingInput ?? previewInput()!); if (floatingInput) setDockedPreview(null); }
    catch (error) { report(error); }
    finally { setPreviewing(false); }
  }
  async function open(path: string) {
    path = path.replace(/\\/g, '/');
    if (tabsRef.current.some((item) => item.path === path)) { setActive(path); return; }
    try {
      const document = await window.qiyao.loadDocument(project.id, path);
      const draft: EditorDraft = { projectId: project.id, path, text: document.text, baseText: document.text, baseSha256: document.sha256, updatedAt: Date.now() };
      setTabs((items) => items.some((item) => item.path === path) ? items : [...items, draft]); setActive(path);
    } catch (error) { report(error); }
  }
  async function save(path: string): Promise<boolean> {
    const draft = tabsRef.current.find((item) => item.path === path); if (!draft || savingRef.current) return false;
    clearTimeout(timers.current.get(path)); timers.current.delete(path); savingRef.current = true; setSaving(true);
    try {
      await persistEditorDraft(draft);
      const document = await window.qiyao.saveDocument(project.id, { path, text: draft.text, expectedSha256: draft.baseSha256 });
      const next = tabsRef.current.map((item) => item.path === path ? { ...item, baseText: document.text, baseSha256: document.sha256 } : item);
      tabsRef.current = next; setTabs(next);
      const remaining = next.find((item) => item.path === path)!;
      if (remaining.text !== document.text) await persistEditorDraft(remaining);
      setSaveNotice('已保存'); setRefresh((value) => value + 1); onSave(); return true;
    } catch (error) {
      try { const current = await window.qiyao.loadDocument(project.id, path).catch(() => null); if ((current?.sha256 ?? null) !== draft.baseSha256) setConflict({ path, current }); else report(error); }
      catch { report(error); }
      return false;
    } finally { savingRef.current = false; setSaving(false); }
  }
  saveRef.current = () => { if (active) void save(active); };
  async function close(path: string, discard: boolean) {
    if (dockedPreview?.path === path) setDockedPreview(null);
    clearTimeout(timers.current.get(path)); timers.current.delete(path);
    if (discard) await window.qiyao.removeEditorDraft(project.id, path);
    const next = tabsRef.current.filter((item) => item.path !== path); tabsRef.current = next; setTabs(next); if (active === path) setActive(next.at(-1)?.path ?? ''); setClosing(null);
  }
  async function create() {
    if (newPath === null) return;
    const path = newPath.trim().replace(/\\/g, '/');
    try {
      if (!tabsRef.current.some((item) => item.path === path)) {
        const draft = await window.qiyao.prepareDocument(project.id, path);
        setTabs((items) => items.some((item) => item.path === path) ? items : [...items, draft]);
      }
      setActive(path); setNewPath(null);
    } catch (error) { report(error); }
  }
  return <div className="project-editor"><ProjectExplorer projectId={project.id} active={active} revision={refresh} hidden={!files} onOpen={(path) => { void open(path); }} onNew={(directory) => setNewPath(directory ? `${directory}/` : '')} /><div className="editor-body"><EditorTabs tabs={tabs.map(item => ({ path: item.path, dirty: item.text !== item.baseText }))} active={active} idPrefix={tabId} panelId={panelId} closing={closing} onSelect={setActive} onClose={path => { const item = tabsRef.current.find(item => item.path === path); if (item?.text !== item?.baseText) setClosing(path); else void close(path, false).catch(report); }} />{tab ? <><div className="editor-actionbar"><TextHint className="path-text" text={tab.path}>{tab.path}</TextHint><span className="spacer" /><span className="muted" role="status">{saving ? '正在保存…' : tab.text !== tab.baseText ? '草稿自动保存在工作台' : saveNotice}</span>{/\.html?$/i.test(tab.path) && <><Button aria-label="并排预览" title="并排预览" onClick={() => setDockedPreview(previewInput())}><span className="editor-action-icon"><Glyph name="compare" size={16} /></span><span className="editor-action-label">并排预览</span></Button><Button aria-label={previewing ? "正在打开…" : "预览 HTML"} disabled={previewing} title="在独立窗口运行当前草稿；可读取项目内网页资源，不连接外网" onClick={() => { void preview(); }}><span className="editor-action-icon"><Glyph name="external" size={16} /></span><span className="editor-action-label">{previewing ? "正在打开…" : "预览 HTML"}</span></Button></>}<Button aria-label="保存 Ctrl S" title="保存 · Ctrl S" disabled={saving || (tab.text === tab.baseText && tab.baseSha256 !== null)} onClick={() => { void save(tab.path); }}><span className="editor-action-icon"><Glyph name="save" size={16} /></span><span className="editor-action-label">保存 <kbd>Ctrl S</kbd></span></Button></div><ProjectPreviewLayout id={panelId} labelledBy={`${tabId}-${tabs.findIndex(item => item.path === active)}`} projectId={project.id} input={dockedPreview} onClose={() => setDockedPreview(null)} onRefresh={refreshPreview} onFloating={() => { if (dockedPreview) void preview(previewInput(dockedPreview.path) ?? dockedPreview); }}><div className="editor-canvas"><CodeEditor key={tab.path} path={`qiyao-project://${project.id}/${tab.path}`} value={tab.text} onChange={(text) => change(tab.path, text)} onSave={() => saveRef.current()} /></div></ProjectPreviewLayout></> : <Empty icon="file" title="打开文件开始编辑" detail="支持代码高亮、查找替换和 Ctrl S 保存。" />}</div>
    {closing && <Modal title="保留文件改动？" onClose={() => setClosing(null)} footer={<><Button onClick={() => { void close(closing, true).catch(report); }}>丢弃草稿</Button><span className="spacer" /><Button onClick={() => setClosing(null)}>取消</Button><Button tone="solid" onClick={() => { void save(closing).then((saved) => { if (saved) return close(closing, false); }).catch(report); }}>保存并关闭</Button></>}><p>{closing} 尚未保存到项目文件。</p></Modal>}
    {newPath !== null && <Modal title="新建文件" onClose={() => setNewPath(null)} footer={<><Button onClick={() => setNewPath(null)}>取消</Button><Button tone="solid" disabled={!newPath.trim()} onClick={() => { void create(); }}>创建</Button></>}><Field label="相对路径" hint="父文件夹需要已经存在。文件会在第一次保存时创建。"><Input autoFocus value={newPath} onChange={(event) => setNewPath(event.target.value)} /></Field></Modal>}
    {conflict && <Modal title="文件已被其他操作修改" onClose={() => setConflict(null)} footer={<><Button onClick={() => { const path = conflict.path; void close(path, true).then(() => { setConflict(null); return open(path); }).catch(report); }}>使用磁盘版本</Button><span className="spacer" /><Button onClick={() => setConflict(null)}>继续编辑</Button><Button tone="solid" onClick={() => { const current = conflict.current; const next = tabsRef.current.map((item) => item.path === conflict.path ? { ...item, baseText: current?.text ?? '', baseSha256: current?.sha256 ?? null, updatedAt: Date.now() } : item); tabsRef.current = next; setTabs(next); const draft = next.find((item) => item.path === conflict.path)!; void window.qiyao.saveEditorDraft(draft).catch(report); setConflict(null); }}>保留草稿，更新比较基准</Button></>}><p>左侧是磁盘内容，右侧是你的草稿。确认内容后再次保存。</p><div className="conflict-editor"><CodeDiff path={conflict.path} before={conflict.current?.text ?? ''} after={tabs.find((item) => item.path === conflict.path)?.text ?? ''} /></div></Modal>}
  </div>;
}
