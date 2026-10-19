import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProjectFileSearchResult } from '../../contracts/projects';
import { Button, IconButton, Input } from './controls';

export function ProjectFileFinder({ projectId, onOpen, children }: { projectId: string; onOpen: (path: string) => void; children: ReactNode }) {
  const [query, setQuery] = useState(''), [retry, setRetry] = useState(0), [selected, setSelected] = useState(0);
  const [result, setResult] = useState<ProjectFileSearchResult | null>(null), [error, setError] = useState(false);
  const generation = useRef(0), queue = useRef(Promise.resolve()), input = useRef<HTMLInputElement>(null);
  const id = useId(), needle = query.trim();
  useEffect(() => {
    const current = ++generation.current; setResult(null); setError(false); setSelected(0);
    const timer = setTimeout(() => {
      if (!needle) return;
      // Serialize reads and discard superseded queued requests before IPC.
      queue.current = queue.current.then(async () => {
        if (generation.current !== current) return;
        try {
          const next = await window.qiyao.searchProjectFiles(projectId, needle);
          if (generation.current === current) setResult(next);
        } catch { if (generation.current === current) setError(true); }
      });
    }, 250);
    return () => { clearTimeout(timer); generation.current++; };
  }, [projectId, needle, retry]);
  const entries = result?.entries ?? [], active = entries[selected];
  return <div className="project-file-finder">
    <div className="project-file-search-field"><Input ref={input} role="combobox" aria-label="查找项目文件" aria-autocomplete="list" aria-expanded={Boolean(needle)} aria-controls={needle ? `${id}-results` : undefined} aria-activedescendant={needle && active ? `${id}-${selected}` : undefined} placeholder="查找文件路径…" maxLength={256} value={query} onChange={event => { if (event.target.value.trim() !== needle) { generation.current++; setResult(null); setError(false); } setQuery(event.target.value); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.key === 'Process' || event.nativeEvent.keyCode === 229) return;
      if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); generation.current++; setQuery(''); }
      else if (needle && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && entries.length) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : Math.max(0, Math.min(entries.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
        setSelected(next); document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && needle && active) { event.preventDefault(); onOpen(active.relativePath); }
    }} />{query && <IconButton icon="close" label="清除文件查找" onClick={() => { generation.current++; setQuery(''); input.current?.focus(); }} />}</div>
    {needle && <div className="project-file-search-results">
      <div id={`${id}-results`} role="listbox" aria-label="项目文件查找结果" aria-busy={!result && !error}>{entries.map((entry, index) => <Button key={entry.relativePath} id={`${id}-${index}`} role="option" aria-selected={selected === index} tabIndex={-1} title={entry.relativePath} onMouseDown={event => event.preventDefault()} onClick={() => { setSelected(index); onOpen(entry.relativePath); }}>{entry.relativePath}</Button>)}</div>
      {error ? <div className="project-tree-status"><p role="alert">无法查找项目文件，请重试。</p><Button onClick={() => setRetry(value => value + 1)}>重试查找</Button></div> : <p className="project-tree-status" role="status">{!result ? '正在查找文件…' : result.truncated ? `显示 ${entries.length} 项，结果不完整，请缩小查找范围。` : result.skippedDirectories ? `找到 ${entries.length} 项，部分目录无法读取。` : entries.length ? `找到 ${entries.length} 项` : '没有匹配的文件。'}</p>}
    </div>}
    <div className="project-file-tree-content" hidden={Boolean(needle)}>{children}</div>
  </div>;
}
