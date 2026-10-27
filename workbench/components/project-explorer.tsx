import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { FileEntry } from '../../contracts/projects';
import { Button, IconButton } from './controls';
import { Glyph } from './glyphs';
import { TextHint, useControlTooltip } from './control-tooltip';
import { ProjectTree, projectTreeKey, projectTreeMatch, projectTreeScrollDelta, type ProjectTreeState } from './project-tree';
import { projectTreeLayout, projectTreeSegments, type ProjectTreeLayoutNode } from './project-tree-layout';
import { ProjectFileFinder } from './project-file-finder';
import { ProjectFileMenu, type ProjectFileMenuRequest } from './project-file-menu';
import { ProjectFolderDialog } from './project-folder-dialog';

type Props = { projectId: string; active: string; revision: number; hidden: boolean; onOpen: (path: string) => void; onNew: (directory: string) => void };
const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function revealRow(node: HTMLElement | undefined) {
  const viewport = node?.closest<HTMLElement>('.project-tree'), row = node?.querySelector<HTMLElement>(':scope > .project-tree-row');
  if (!viewport || !row) return;
  const bounds = viewport.getBoundingClientRect(), top = node!.getBoundingClientRect().top - bounds.top;
  viewport.scrollTop += projectTreeScrollDelta(top, top + row.getBoundingClientRect().height, viewport.clientHeight, Number(node!.getAttribute('aria-level')));
}

function TreeItem({ entry, level, position, size, expanded, selected, focusedParent, tabIndex, register, onFocus, onExit, onKeyDown, onActivate, onMenu, children }: {
  entry: FileEntry; level: number; position: number; size: number; expanded: boolean; selected: boolean; focusedParent: string; tabIndex: number;
  register: Ref<HTMLDivElement>; onFocus: () => void; onExit: () => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onActivate: () => void; onMenu: (x: number, y: number) => void; children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const tooltip = useControlTooltip<HTMLDivElement>(entry.relativePath, row);
  return <div role="treeitem" aria-label={entry.relativePath} aria-level={level} aria-posinset={position} aria-setsize={size} aria-expanded={entry.directory ? expanded : undefined} aria-selected={selected} aria-describedby={tooltip.description} tabIndex={tabIndex} className="project-tree-item"
    ref={element => { tooltip.anchor.current = element; if (typeof register === 'function') register(element); else if (register) register.current = element; }}
    onFocus={event => { if (event.target === event.currentTarget) { onFocus(); tooltip.focus(event); } }}
    onBlur={event => { if (event.target === event.currentTarget) { tooltip.hide(); if (!event.currentTarget.closest('[role="tree"]')?.contains(event.relatedTarget)) onExit(); } }}
    onKeyDown={onKeyDown}>
    <div ref={row} data-sticky={entry.directory && expanded || undefined} className={`project-tree-row ${selected ? 'selected' : ''}`} style={{ '--tree-depth': level - 1, '--tree-file-inset': !entry.directory && level > 1 ? '3.75px' : '0px', ...(entry.directory && expanded ? { top: `calc(var(--tree-sticky-enabled, 0) * min(${(level - 1) * 28 - 4}px, var(--tree-sticky-limit, 0px)))`, zIndex: 10000 - level } : {}) } as CSSProperties}
      onPointerEnter={tooltip.enter} onPointerMove={tooltip.move} onPointerLeave={tooltip.leave} onPointerDown={tooltip.press} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); tooltip.hide(); onMenu(event.clientX, event.clientY); }}
      onClick={event => { tooltip.press(); event.stopPropagation(); onActivate(); }}>
      {Array.from({ length: level - 1 }, (_, index) => {
        const ancestor = entry.relativePath.split('/').slice(0, index + 1).join('/');
        return <span key={ancestor} aria-hidden="true" className="project-tree-guide" data-active={ancestor === focusedParent || undefined} style={{ left: 10.25 + index * 8.75 }} />;
      })}
      <Glyph name={entry.directory ? expanded ? 'down' : 'right' : 'file'} size={16} /><span className="project-tree-label">{entry.name}</span>
    </div>{tooltip.content}{children}
  </div>;
}

function TreeStatus({ path, onMeasure, children }: { path: string; onMeasure: (path: string, height: number) => void; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = element.current!;
    const measure = () => { const height = node.getBoundingClientRect().height; if (height > 0) onMeasure(path, height); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [path, onMeasure, children]);
  return <div ref={element} className="project-tree-status-block">{children}</div>;
}

export function ProjectExplorer({ projectId, active, revision, hidden, onOpen, onNew }: Props) {
  const [state, setState] = useState<ProjectTreeState>({ folders: new Map(), expanded: new Set() });
  const [focused, setFocused] = useState('');
  const [menu, setMenu] = useState<ProjectFileMenuRequest | null>(null), menuSequence = useRef(0);
  const [directory, setDirectory] = useState('');
  const [folderDirectory, setFolderDirectory] = useState<string | null>(null);
  const [query, setQuery] = useState(''), [searchRefresh, setSearchRefresh] = useState(0), [revealRequest, setRevealRequest] = useState(0);
  const queryRef = useRef(query); queryRef.current = query;
  const tree = useRef<ProjectTree | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const viewport = useRef<HTMLDivElement>(null);
  const typing = useRef({ query: '', time: 0 });
  const activeRef = useRef(active); activeRef.current = active;
  const lastRevision = useRef(revision);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [focusRequest, setFocusRequest] = useState<{ path: string; focus: boolean; origin: Element | null; projectId: string } | null>(null);
  const anchor = useRef<{ path: string; offset: number } | null>(null);
  const layout = useMemo(() => projectTreeLayout(state, heights), [state, heights]), rows = layout.rows;
  const current = rows.some((row) => row.entry.relativePath === focused) ? focused : rows[0]?.entry.relativePath ?? '';
  useEffect(() => { setMenu(null); }, [projectId, query, hidden]);
  useEffect(() => { setFolderDirectory(null); }, [projectId]);
  useEffect(() => { if (menu && !layout.nodes.has(menu.entry.relativePath)) setMenu(null); }, [layout, menu]);
  const updateViewport = useCallback(() => {
    const element = viewport.current; if (!element) return;
    setView(before => before.top === element.scrollTop && before.height === element.clientHeight ? before : { top: element.scrollTop, height: element.clientHeight });
  }, []);
  const measureStatus = useCallback((path: string, height: number) => {
    if (Math.abs((heights.get(path) ?? 0) - height) < 0.5) return;
    const element = viewport.current;
    if (element && !anchor.current) {
      const first = [...layout.nodes.values()].find(node => node.top + 28 > element.scrollTop);
      if (first) anchor.current = { path: first.path, offset: element.scrollTop - first.top };
    }
    setHeights(before => new Map(before).set(path, height));
  }, [heights, layout]);
  useLayoutEffect(() => {
    if (!anchor.current || !viewport.current) return;
    const node = layout.nodes.get(anchor.current.path);
    if (node) viewport.current.scrollTop = node.top + anchor.current.offset;
    anchor.current = null; updateViewport();
  }, [layout, updateViewport]);
  useLayoutEffect(() => {
    const request = focusRequest, element = viewport.current;
    if (!request || !element || request.projectId !== projectId || query || hidden) return;
    const target = layout.nodes.get(request.path), node = nodes.current.get(request.path);
    if (!target || !node) return;
    const allowed = document.activeElement === request.origin || !request.origin?.isConnected && document.activeElement === document.body;
    if (!request.focus || allowed) {
      const top = target.top + 4 - element.scrollTop;
      element.scrollTop += projectTreeScrollDelta(top, top + 28, element.clientHeight, target.row!.level);
      if (request.focus) node.focus({ preventScroll: true });
      updateViewport();
    }
    setFocusRequest(null);
  }, [focusRequest, layout, projectId, query, hidden, updateViewport]);
  function requestRow(path: string, focus = true, origin: Element | null = document.activeElement) {
    anchor.current = null; setFocused(path); setFocusRequest({ path, focus, origin, projectId });
  }
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const resize = () => { element.style.setProperty('--tree-sticky-limit', `${Math.max(0, element.clientHeight - 64)}px`); element.style.setProperty('--tree-sticky-position', element.clientHeight < 64 ? 'relative' : 'sticky'); element.style.setProperty('--tree-sticky-enabled', element.clientHeight < 64 ? '0' : '1'); updateViewport(); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [query, hidden]);
  useEffect(() => {
    setHeights(new Map()); setFocused(''); setFocusRequest(null); anchor.current = null;
    if (viewport.current) viewport.current.scrollTop = 0; updateViewport();
    const model = new ProjectTree((request) => window.qiyao.listDirectory(projectId, request), setState);
    tree.current = model; lastRevision.current = revision;
    void model.load();
    return () => { model.dispose(); tree.current = null; };
  }, [projectId]);
  useEffect(() => {
    const model = tree.current;
    if (active && model) void model.reveal(active).then((found) => {
      if (found && tree.current === model && activeRef.current === active) requestRow(active, false);
    });
  }, [projectId, active]);
  useEffect(() => { if (lastRevision.current !== revision) { lastRevision.current = revision; void tree.current?.refresh(); } }, [revision]);
  useEffect(() => {
    if (!revealRequest) return;
    const model = tree.current, path = activeRef.current, origin = document.activeElement;
    let cancelled = false;
    if (path && model) void model.reveal(path).then(found => {
      if (found && !cancelled && !queryRef.current && tree.current === model && activeRef.current === path) {
        requestRow(path, true, origin);
      }
    });
    return () => { cancelled = true; };
  }, [revealRequest, projectId]);

  function focus(entry: FileEntry) { setFocused(entry.relativePath); setDirectory(entry.directory ? entry.relativePath : parent(entry.relativePath)); revealRow(nodes.current.get(entry.relativePath)); }
  function folderCreated(path: string) {
    setFolderDirectory(null); setSearchRefresh(value => value + 1);
    const model = tree.current;
    if (model) void model.refresh().then(() => model.reveal(path, true)).then(found => {
      if (found && tree.current === model && !queryRef.current) requestRow(path, false);
    });
  }
  function openMenu(entry: FileEntry, x: number, y: number) {
    const anchor = nodes.current.get(entry.relativePath); if (!anchor) return;
    typing.current.query = ''; anchor.focus({ preventScroll: true });
    setMenu({ id: ++menuSequence.current, entry, anchor, x, y });
  }
  function activate(entry: FileEntry) {
    typing.current.query = '';
    nodes.current.get(entry.relativePath)?.focus({ preventScroll: true }); focus(entry);
    if (entry.directory) { if (state.expanded.has(entry.relativePath)) tree.current?.collapse(entry.relativePath); else void tree.current?.expand(entry.relativePath); }
    else onOpen(entry.relativePath);
  }
  function key(entry: FileEntry, event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') {
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.querySelector('.project-tree-row')!.getBoundingClientRect(); openMenu(entry, rect.left, rect.bottom); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) { typing.current.query = ''; return; }
    if (event.key !== ' ' && Array.from(event.key).length === 1) {
      const now = performance.now();
      const query = (now - typing.current.time < 700 ? typing.current.query : '') + event.key;
      typing.current = { query: query.slice(-160), time: now };
      const path = projectTreeMatch(rows, entry.relativePath, typing.current.query);
      event.preventDefault(); event.stopPropagation();
      if (path) requestRow(path);
      return;
    }
    typing.current.query = '';
    const action = projectTreeKey(rows, state.expanded, entry.relativePath, event.key);
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (action.kind === 'focus') requestRow(action.path);
    else if (action.kind === 'expand') void tree.current?.expand(action.path);
    else if (action.kind === 'collapse') { revealRow(nodes.current.get(action.path)); tree.current?.collapse(action.path); }
    else onOpen(action.path);
  }
  function folder(group: ProjectTreeLayoutNode) {
    const path = group.path;
    const value = state.folders.get(path);
    return <>
      {projectTreeSegments(group.children, view.top, view.height, current).map(segment => {
        if (segment.kind === 'space') return <div key={`space-${segment.top}`} aria-hidden="true" className="project-tree-space" style={{ height: segment.height }} />;
        const node = segment.node, { entry, level } = node.row!;
        const expanded = entry.directory && state.expanded.has(entry.relativePath);
        return <TreeItem key={entry.relativePath} entry={entry} level={level} position={node.position} size={node.size} expanded={expanded} selected={entry.relativePath === active} focusedParent={parent(current)} tabIndex={entry.relativePath === current ? 0 : -1} register={(element) => { if (element) nodes.current.set(entry.relativePath, element); else nodes.current.delete(entry.relativePath); }} onFocus={() => focus(entry)} onExit={() => { typing.current.query = ''; }} onKeyDown={(event) => key(entry, event)} onActivate={() => activate(entry)} onMenu={(x, y) => openMenu(entry, x, y)}>
          {expanded && <div role="group">{folder(node)}</div>}
        </TreeItem>;
      })}
      {group.statusHeight > 0 && <TreeStatus path={path} onMeasure={measureStatus}>
      {value?.loading && <p role="status" className="project-tree-status">正在读取目录…</p>}
      {value?.error && <div className="project-tree-status"><span role="alert">目录读取失败或内容已变化，请刷新后重试。</span><Button aria-label={`重试目录 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'refresh'); }}>重试</Button></div>}
      {value?.page?.entries.length === 0 && !value.loading && !value.error && <p className="project-tree-status">{path ? '空文件夹' : '项目中暂无文件'}</p>}
      {value?.page && value.page.nextOffset !== null && <Button className="project-tree-more" disabled={value.loading || value.error} aria-label={`加载更多 ${path || '项目根目录'}`} onClick={() => { void tree.current?.load(path, 'more'); }}>加载更多 · {value.page.entries.length} / {value.page.total}</Button>}
      </TreeStatus>}
    </>;
  }
  return <div className="editor-files" hidden={hidden}><div className="editor-files-toolbar"><TextHint text={directory}>文件</TextHint><IconButton icon="folder" label="收起所有目录" disabled={state.expanded.size === 0} onClick={() => { tree.current?.collapseAll(); setDirectory(''); }} /><IconButton icon="search" label="定位当前文件" disabled={!active} onClick={() => { setQuery(''); setRevealRequest(value => value + 1); }} /><IconButton icon="retry" label="刷新文件" onClick={() => { void tree.current?.refresh(); setSearchRefresh(value => value + 1); }} /><IconButton icon="plus" label="新建文件" onClick={() => onNew(directory)} /><IconButton icon="folderPlus" label="新建文件夹" onClick={() => setFolderDirectory(directory)} /></div><ProjectFileFinder projectId={projectId} query={query} setQuery={setQuery} revision={revision} refresh={searchRefresh} onOpen={onOpen}><div ref={viewport} onScroll={updateViewport} className="file-list project-tree" role="tree" aria-label="项目文件" tabIndex={rows.length ? undefined : 0}>{folder(layout.root)}</div></ProjectFileFinder>{menu && !hidden && !query && <ProjectFileMenu key={menu.id} request={menu} expanded={state.expanded.has(menu.entry.relativePath)} onClose={() => setMenu(null)} onActivate={() => activate(menu.entry)} onNew={() => onNew(menu.entry.directory ? menu.entry.relativePath : parent(menu.entry.relativePath))} onNewFolder={() => setFolderDirectory(menu.entry.directory ? menu.entry.relativePath : parent(menu.entry.relativePath))} />}{folderDirectory !== null && <ProjectFolderDialog key={projectId} projectId={projectId} directory={folderDirectory} onCreated={folderCreated} onClose={() => setFolderDirectory(null)} />}</div>;
}
