import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { FileEntry } from '../../contracts/projects';
import { Button, IconButton } from './controls';
import { Glyph } from './glyphs';
import { TextHint, useControlTooltip } from './control-tooltip';
import { ProjectTree, projectTreeKey, projectTreeRows, type ProjectTreeState } from './project-tree';

type Props = { projectId: string; active: string; revision: number; hidden: boolean; onOpen: (path: string) => void; onNew: (directory: string) => void };
const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function TreeItem({ entry, level, expanded, selected, tabIndex, register, onFocus, onKeyDown, onActivate, children }: {
  entry: FileEntry; level: number; expanded: boolean; selected: boolean; tabIndex: number;
  register: Ref<HTMLDivElement>; onFocus: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onActivate: () => void; children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const tooltip = useControlTooltip<HTMLDivElement>(entry.relativePath, row);
  return <div role="treeitem" aria-label={entry.relativePath} aria-level={level} aria-expanded={entry.directory ? expanded : undefined} aria-selected={selected} aria-describedby={tooltip.description} tabIndex={tabIndex} className="project-tree-item"
    ref={element => { tooltip.anchor.current = element; if (typeof register === 'function') register(element); else if (register) register.current = element; }}
    onFocus={event => { if (event.target === event.currentTarget) { onFocus(); tooltip.focus(event); } }}
    onBlur={event => { if (event.target === event.currentTarget) tooltip.hide(); }}
    onKeyDown={onKeyDown}>
    <div ref={row} className={`project-tree-row ${selected ? 'selected' : ''}`} style={{ paddingLeft: 3 + Math.min(level - 1, 8) * 12 }}
      onPointerEnter={tooltip.enter} onPointerMove={tooltip.move} onPointerLeave={tooltip.leave} onPointerDown={tooltip.press} onContextMenu={tooltip.hide}
      onClick={event => { tooltip.press(); event.stopPropagation(); onActivate(); }}>
      <span className="project-tree-chevron">{entry.directory && <Glyph name={expanded ? 'down' : 'right'} size={12} />}</span><Glyph name={entry.directory ? 'folder' : 'file'} size={16} /><span className="project-tree-label">{entry.name}</span>
    </div>{tooltip.content}{children}
  </div>;
}

export function ProjectExplorer({ projectId, active, revision, hidden, onOpen, onNew }: Props) {
  const [state, setState] = useState<ProjectTreeState>({ folders: new Map(), expanded: new Set() });
  const [focused, setFocused] = useState('');
  const [directory, setDirectory] = useState('');
  const tree = useRef<ProjectTree | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const activeRef = useRef(active); activeRef.current = active;
  const lastRevision = useRef(revision);
  const rows = projectTreeRows(state);
  const current = rows.some((row) => row.entry.relativePath === focused) ? focused : rows[0]?.entry.relativePath ?? '';
  useEffect(() => {
    const model = new ProjectTree((request) => window.qiyao.listDirectory(projectId, request), setState);
    tree.current = model; lastRevision.current = revision;
    void model.load();
    return () => { model.dispose(); tree.current = null; };
  }, [projectId]);
  useEffect(() => {
    const model = tree.current;
    if (active && model) void model.reveal(active).then((found) => {
      if (found && tree.current === model && activeRef.current === active) { setFocused(active); nodes.current.get(active)?.querySelector('.project-tree-row')?.scrollIntoView({ block: 'nearest' }); }
    });
  }, [projectId, active]);
  useEffect(() => { if (lastRevision.current !== revision) { lastRevision.current = revision; void tree.current?.refresh(); } }, [revision]);

  function focus(entry: FileEntry) { setFocused(entry.relativePath); setDirectory(entry.directory ? entry.relativePath : parent(entry.relativePath)); }
  function activate(entry: FileEntry) {
    nodes.current.get(entry.relativePath)?.focus(); focus(entry);
    if (entry.directory) { if (state.expanded.has(entry.relativePath)) tree.current?.collapse(entry.relativePath); else void tree.current?.expand(entry.relativePath); }
    else onOpen(entry.relativePath);
  }
  function key(entry: FileEntry, event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const action = projectTreeKey(rows, state.expanded, entry.relativePath, event.key);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (action.kind === 'focus') nodes.current.get(action.path)?.focus();
    else if (action.kind === 'expand') void tree.current?.expand(action.path);
    else if (action.kind === 'collapse') tree.current?.collapse(action.path);
    else onOpen(action.path);
  }
  function folder(path: string, level: number) {
    const value = state.folders.get(path);
    return <>
      {value?.page?.entries.map((entry) => {
        const expanded = entry.directory && state.expanded.has(entry.relativePath);
        return <TreeItem key={entry.relativePath} entry={entry} level={level} expanded={expanded} selected={entry.relativePath === active} tabIndex={entry.relativePath === current ? 0 : -1} register={(element) => { if (element) nodes.current.set(entry.relativePath, element); else nodes.current.delete(entry.relativePath); }} onFocus={() => focus(entry)} onKeyDown={(event) => key(entry, event)} onActivate={() => activate(entry)}>
          {expanded && <div role="group">{folder(entry.relativePath, level + 1)}</div>}
        </TreeItem>;
      })}
      {value?.loading && <p role="status" className="project-tree-status">正在读取目录…</p>}
      {value?.error && <div className="project-tree-status"><span role="alert">目录读取失败或内容已变化，请刷新后重试。</span><Button aria-label={`重试目录 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'refresh'); }}>重试</Button></div>}
      {value?.page?.entries.length === 0 && !value.loading && !value.error && <p className="project-tree-status">{path ? '空文件夹' : '项目中暂无文件'}</p>}
      {value?.page && value.page.nextOffset !== null && <Button className="project-tree-more" disabled={value.loading || value.error} aria-label={`加载更多 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'more'); }}>加载更多 · {value.page.entries.length} / {value.page.total}</Button>}
    </>;
  }
  return <div className="editor-files" hidden={hidden}><div className="editor-files-toolbar"><TextHint text={directory}>文件</TextHint><IconButton icon="folder" label="收起所有目录" disabled={state.expanded.size === 0} onClick={() => { tree.current?.collapseAll(); setDirectory(''); }} /><IconButton icon="search" label="定位当前文件" disabled={!active} onClick={() => { const model = tree.current; if (active && model) void model.reveal(active).then((found) => { if (found && tree.current === model && activeRef.current === active) { nodes.current.get(active)?.focus(); nodes.current.get(active)?.querySelector('.project-tree-row')?.scrollIntoView({ block: 'nearest' }); } }); }} /><IconButton icon="retry" label="刷新文件" onClick={() => { void tree.current?.refresh(); }} /><IconButton icon="plus" label="新建文件" onClick={() => onNew(directory)} /></div><div className="file-list project-tree" role="tree" aria-label="项目文件" tabIndex={rows.length ? undefined : 0}>{folder('', 1)}</div></div>;
}
