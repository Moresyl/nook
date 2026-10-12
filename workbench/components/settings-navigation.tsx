import { useEffect, useId, useState, type RefObject } from 'react';
import { moveSettingsSelection, settingsMatches, settingsTabs, type SettingsDestination, type SettingsTab } from '../../contracts/settings-search';
import type { Provider } from '../../contracts/workspace';
import { Button, IconButton, Input } from './controls';
import { Glyph } from './glyphs';

type Props = { tab: SettingsTab; busy: boolean; provider: Provider | null; inputRef: RefObject<HTMLInputElement | null>; onNavigate: (tab: SettingsTab, destination?: SettingsDestination) => void };
export function SettingsNavigation({ tab, busy, provider, inputRef, onNavigate }: Props) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(''); const id = useId();
  const results = settingsMatches(query, provider ?? undefined); const current = results.find(item => item.id === active); const index = current ? results.indexOf(current) : -1;
  useEffect(() => { if (index >= 0) document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: 'nearest' }); }, [id, index]);
  function clear() { setQuery(''); setActive(''); inputRef.current?.focus(); }
  return <aside className="settings-sidebar"><div className="settings-search-control"><Glyph name="search" size={14} /><Input ref={inputRef} autoFocus role="searchbox" aria-label="搜索设置" aria-controls={`${id}-results`} aria-activedescendant={index < 0 ? undefined : `${id}-${index}`} placeholder="搜索设置" maxLength={512} disabled={busy} value={query} onChange={event => { setQuery(event.target.value); setActive(''); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing || busy) return;
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); clear(); }
    else if (query.trim() && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setActive(moveSettingsSelection(results, active, event.key)); }
    else if (event.key === 'Enter' && current) { event.preventDefault(); onNavigate(current.tab, current); }
  }} />{query && <IconButton icon="close" label="清空设置搜索" disabled={busy} onClick={clear} />}</div>
    {query.trim() ? <><div id={`${id}-results`} role="listbox" aria-label="设置搜索结果" className="settings-search-results">{results.map((item, position) => <Button key={item.id} id={`${id}-${position}`} role="option" aria-label={item.label === settingsTabs.find(panel => panel.id === item.tab)?.label ? item.label : `${item.label}，${settingsTabs.find(panel => panel.id === item.tab)?.label}`} aria-selected={active === item.id} tabIndex={-1} disabled={busy} onMouseDown={event => event.preventDefault()} onMouseEnter={() => { if (!busy) setActive(item.id); }} onClick={() => onNavigate(item.tab, item)}><span>{item.label}</span>{item.label !== settingsTabs.find(panel => panel.id === item.tab)?.label && <small>{settingsTabs.find(panel => panel.id === item.tab)?.label}</small>}</Button>)}</div><p role="status" className="settings-search-status">{results.length ? `${results.length} 个结果` : '没有匹配的设置'}</p></> : <nav className="settings-nav" aria-label="设置分类">{settingsTabs.map(item => <Button key={item.id} disabled={busy} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'selected' : ''} onClick={() => onNavigate(item.id)}><Glyph name={item.icon} size={16} />{item.label}</Button>)}</nav>}
  </aside>;
}
