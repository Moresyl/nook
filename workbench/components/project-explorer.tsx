import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { FileEntry } from '../../contracts/projects';
import { Button, IconButton } from './controls';
import { Glyph } from './glyphs';
import { TextHint, useControlTooltip } from './control-tooltip';
import { ProjectTree, projectTreeKey, projectTreeMatch, projectTreeRows, projectTreeScrollDelta, type ProjectTreeState } from './project-tree';
import { ProjectFileFinder } from './project-file-finder';

type Props = { projectId: string; active: string; revision: number; hidden: boolean; onOpen: (path: string) => void; onNew: (directory: string) => void };
const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function revealRow(node: HTMLElement | undefined) {
  const viewport = node?.closest<HTMLElement>('.project-tree'), row = node?.querySelector<HTMLElement>(':scope > .project-tree-row');
  if (!viewport || !row) return;
  const bounds = viewport.getBoundingClientRect(), top = node!.getBoundingClientRect().top - bounds.top;
  viewport.scrollTop += projectTreeScrollDelta(top, top + row.getBoundingClientRect().height, viewport.clientHeight, Number(node!.getAttribute('aria-level')));
}

function TreeItem({ entry, level, expanded, selected, tabIndex, register, onFocus, onExit, onKeyDown, onActivate, children }: {
  entry: FileEntry; level: number; expanded: boolean; selected: boolean; tabIndex: number;
  register: Ref<HTMLDivElement>; onFocus: () => void; onExit: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onActivate: () => void; children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const tooltip = useControlTooltip<HTMLDivElement>(entry.relativePath, row);
  return <div role="treeitem" aria-label={entry.relativePath} aria-level={level} aria-expanded={entry.directory ? expanded : undefined} aria-selected={selected} aria-describedby={tooltip.description} tabIndex={tabIndex} className="project-tree-item"
    ref={element => { tooltip.anchor.current = element; if (typeof register === 'function') register(element); else if (register) register.current = element; }}
    onFocus={event => { if (event.target === event.currentTarget) { onFocus(); tooltip.focus(event); } }}
    onBlur={event => { if (event.target === event.currentTarget) { tooltip.hide(); if (!event.currentTarget.closest('[role="tree"]')?.contains(event.relatedTarget)) onExit(); } }}
    onKeyDown={onKeyDown}>
    <div ref={row} data-sticky={entry.directory && expanded || undefined} className={`project-tree-row ${selected ? 'selected' : ''}`} style={{ '--tree-depth': level - 1, '--tree-file-inset': !entry.directory && level > 1 ? '3.75px' : '0px', ...(entry.directory && expanded ? { top: `min(${(level - 1) * 28 - 4}px, var(--tree-sticky-limit, 0px))`, zIndex: 10000 - level } : {}) } as CSSProperties}
      onPointerEnter={tooltip.enter} onPointerMove={tooltip.move} onPointerLeave={tooltip.leave} onPointerDown={tooltip.press} onContextMenu={tooltip.hide}
      onClick={event => { tooltip.press(); event.stopPropagation(); onActivate(); }}>
      <Glyph name={entry.directory ? expanded ? 'down' : 'right' : 'file'} size={16} /><span className="project-tree-label">{entry.name}</span>
    </div>{tooltip.content}{children}
  </div>;
}

export function ProjectExplorer({ projectId, active, revision, hidden, onOpen, onNew }: Props) {
  const [state, setState] = useState<ProjectTreeState>({ folders: new Map(), expanded: new Set() });
  const [focused, setFocused] = useState('');
  const [directory, setDirectory] = useState('');
  const [query, setQuery] = useState(''), [searchRefresh, setSearchRefresh] = useState(0), [revealRequest, setRevealRequest] = useState(0);
  const queryRef = useRef(query); queryRef.current = query;
  const tree = useRef<ProjectTree | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const viewport = useRef<HTMLDivElement>(null);
  const typing = useRef({ query: '', time: 0 });
  const activeRef = useRef(active); activeRef.current = active;
  const lastRevision = useRef(revision);
  const rows = projectTreeRows(state);
  const current = rows.some((row) => row.entry.relativePath === focused) ? focused : rows[0]?.entry.relativePath ?? '';
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const resize = () => { element.style.setProperty('--tree-sticky-limit', `${Math.max(0, element.clientHeight - 64)}px`); element.style.setProperty('--tree-sticky-position', element.clientHeight < 64 ? 'static' : 'sticky'); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [query, hidden]);
  useEffect(() => {
    const model = new ProjectTree((request) => window.qiyao.listDirectory(projectId, request), setState);
    tree.current = model; lastRevision.current = revision;
    void model.load();
    return () => { model.dispose(); tree.current = null; };
  }, [projectId]);
  useEffect(() => {
    const model = tree.current;
    if (active && model) void model.reveal(active).then((found) => {
      if (found && tree.current === model && activeRef.current === active) { setFocused(active); revealRow(nodes.current.get(active)); }
    });
  }, [projectId, active]);
  useEffect(() => { if (lastRevision.current !== revision) { lastRevision.current = revision; void tree.current?.refresh(); } }, [revision]);
  useEffect(() => {
    if (!revealRequest) return;
    const model = tree.current, path = activeRef.current;
    let cancelled = false;
    if (path && model) void model.reveal(path).then(found => {
      if (found && !cancelled && !queryRef.current && tree.current === model && activeRef.current === path) {
        nodes.current.get(path)?.focus({ preventScroll: true }); revealRow(nodes.current.get(path));
      }
    });
    return () => { cancelled = true; };
  }, [revealRequest, projectId]);

  function focus(entry: FileEntry) { setFocused(entry.relativePath); setDirectory(entry.directory ? entry.relativePath : parent(entry.relativePath)); revealRow(nodes.current.get(entry.relativePath)); }
  function activate(entry: FileEntry) {
    typing.current.query = '';
    nodes.current.get(entry.relativePath)?.focus({ preventScroll: true }); focus(entry);
    if (entry.directory) { if (state.expanded.has(entry.relativePath)) tree.current?.collapse(entry.relativePath); else void tree.current?.expand(entry.relativePath); }
    else onOpen(entry.relativePath);
  }
  function key(entry: FileEntry, event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.altKey || event.ctrlKey || event.metaKey) { typing.current.query = ''; return; }
    if (event.key !== ' ' && Array.from(event.key).length === 1) {
      const now = performance.now();
      const query = (now - typing.current.time < 700 ? typing.current.query : '') + event.key;
      typing.current = { query: query.slice(-160), time: now };
      const path = projectTreeMatch(rows, entry.relativePath, typing.current.query);
      event.preventDefault(); event.stopPropagation();
      if (path) { nodes.current.get(path)?.focus({ preventScroll: true }); revealRow(nodes.current.get(path)); }
      return;
    }
    typing.current.query = '';
    const action = projectTreeKey(rows, state.expanded, entry.relativePath, event.key);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (action.kind === 'focus') { nodes.current.get(action.path)?.focus({ preventScroll: true }); revealRow(nodes.current.get(action.path)); }
    else if (action.kind === 'expand') void tree.current?.expand(action.path);
    else if (action.kind === 'collapse') { revealRow(nodes.current.get(action.path)); tree.current?.collapse(action.path); }
    else onOpen(action.path);
  }
  function folder(path: string, level: number) {
    const value = state.folders.get(path);
    return <>
      {value?.page?.entries.map((entry) => {
        const expanded = entry.directory && state.expanded.has(entry.relativePath);
        return <TreeItem key={entry.relativePath} entry={entry} level={level} expanded={expanded} selected={entry.relativePath === active} tabIndex={entry.relativePath === current ? 0 : -1} register={(element) => { if (element) nodes.current.set(entry.relativePath, element); else nodes.current.delete(entry.relativePath); }} onFocus={() => focus(entry)} onExit={() => { typing.current.query = ''; }} onKeyDown={(event) => key(entry, event)} onActivate={() => activate(entry)}>
          {expanded && <div role="group">{folder(entry.relativePath, level + 1)}</div>}
        </TreeItem>;
      })}
      {value?.loading && <p role="status" className="project-tree-status">正在读取目录…</p>}
      {value?.error && <div className="project-tree-status"><span role="alert">目录读取失败或内容已变化，请刷新后重试。</span><Button aria-label={`重试目录 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'refresh'); }}>重试</Button></div>}
      {value?.page?.entries.length === 0 && !value.loading && !value.error && <p className="project-tree-status">{path ? '空文件夹' : '项目中暂无文件'}</p>}
      {value?.page && value.page.nextOffset !== null && <Button className="project-tree-more" disabled={value.loading || value.error} aria-label={`加载更多 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'more'); }}>加载更多 · {value.page.entries.length} / {value.page.total}</Button>}
    </>;
  }
  return <div className="editor-files" hidden={hidden}><div className="editor-files-toolbar"><TextHint text={directory}>文件</TextHint><IconButton icon="folder" label="收起所有目录" disabled={state.expanded.size === 0} onClick={() => { tree.current?.collapseAll(); setDirectory(''); }} /><IconButton icon="search" label="定位当前文件" disabled={!active} onClick={() => { setQuery(''); setRevealRequest(value => value + 1); }} /><IconButton icon="retry" label="刷新文件" onClick={() => { void tree.current?.refresh(); setSearchRefresh(value => value + 1); }} /><IconButton icon="plus" label="新建文件" onClick={() => onNew(directory)} /></div><ProjectFileFinder projectId={projectId} query={query} setQuery={setQuery} revision={revision} refresh={searchRefresh} onOpen={onOpen}><div ref={viewport} className="file-list project-tree" role="tree" aria-label="项目文件" tabIndex={rows.length ? undefined : 0}>{folder('', 1)}</div></ProjectFileFinder></div>;
}
