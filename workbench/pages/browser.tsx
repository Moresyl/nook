import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { browserTabLimit, browserUrl, type BrowserAction, type BrowserShortcut, type BrowserState } from '../../contracts/browser';
import { useNativeViewport } from '../lib/native-viewport';
import { Button, IconButton, Input } from '../components/controls';
import { Glyph } from '../components/glyphs';
import { BrowserTabs } from '../components/browser-tabs';
import { BrowserLoadError } from '../components/browser-load-error';
import { reduceBrowserTabs, type BrowserTabsAction, type BrowserWorkspace } from '../components/browser-tabs-state';
import type { PreviewViewport } from '../../contracts/project-preview';

export function BrowserPage({ active }: { active: boolean }) {
  const [workspace, setWorkspace] = useState<BrowserWorkspace>({ tabs: [], active: null, error: null });
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const opening = useRef(false), disposed = useRef(false), viewport = useRef<HTMLDivElement>(null), addressInput = useRef<HTMLInputElement>(null), activePage = useRef(active), selection = useRef(0), closing = useRef(new Set<string>());
  activePage.current = active;
  const tabId = useId(), panelId = `${tabId}-panel`, token = workspace.active, tab = workspace.tabs.find(item => item.state.token === token), state = tab?.state;
  const send = useCallback((action: BrowserTabsAction) => { if (!disposed.current) { const next = reduceBrowserTabs(workspaceRef.current, action); workspaceRef.current = next; setWorkspace(next); } }, []);
  const accept = useCallback((next: BrowserState) => send({ type: 'received', state: next }), [send]);
  const fail = useCallback(() => { if (token) send({ type: 'failed', token, message: '浏览器暂时无法显示，请重试。' }); }, [token, send]);
  const select = useCallback((target: string) => {
    selection.current++; send({ type: 'selected', token: target });
    void window.qiyao.activateBrowserTab(target).then(accept).catch(() => send({ type: 'failed', token: target, message: '标签页暂时无法显示，请重试。' }));
  }, [accept, send]);
  const open = useCallback(async (fresh = false) => {
    if (opening.current || (!fresh && workspaceRef.current.tabs.length)) return;
    if (workspaceRef.current.tabs.length >= browserTabLimit) { send({ type: 'open-failed', message: '最多打开 16 个标签页，请先关闭一个再继续。' }); return; }
    opening.current = true; const revision = ++selection.current;
    try {
      const next = await (fresh ? window.qiyao.newBrowserTab() : window.qiyao.openBrowser());
      if (disposed.current) { void window.qiyao.closeBrowser(next.token).catch(() => {}); return; }
      send({ type: 'created', state: next, activate: revision === selection.current });
      if (activePage.current && workspaceRef.current.active === next.token) addressInput.current?.focus();
    } catch { send({ type: 'open-failed', message: '浏览器无法打开，请重试。' }); }
    finally { opening.current = false; }
  }, [send]);
  const close = useCallback(async (target: string) => {
    if (closing.current.has(target)) return; selection.current++; closing.current.add(target);
    try { await window.qiyao.closeBrowser(target); send({ type: 'removed', token: target }); if (!disposed.current && !workspaceRef.current.tabs.length) await open(true); }
    catch { send({ type: 'failed', token: target, message: '标签页未能关闭，请重试。' }); }
    finally { closing.current.delete(target); }
  }, [open, send]);
  const shortcut = useRef<(value: BrowserShortcut['action']) => void>(() => {});
  shortcut.current = value => {
    const current = workspaceRef.current; if (value === 'new') { void open(true); return; }
    if (!current.active) return;
    if (value === 'close') { void close(current.active); return; }
    const index = current.tabs.findIndex(item => item.state.token === current.active), next = (index + (value === 'next' ? 1 : current.tabs.length - 1)) % current.tabs.length;
    select(current.tabs[next].state.token);
  };
  useEffect(() => {
    disposed.current = false; const unsubscribe = window.qiyao.onBrowserState(accept);
    const focus = window.qiyao.onBrowserFocus(target => { if (activePage.current && workspaceRef.current.active === target) { addressInput.current?.focus(); addressInput.current?.select(); } });
    const keys = window.qiyao.onBrowserShortcut(value => { if (activePage.current && workspaceRef.current.active === value.token) shortcut.current(value.action); });
    return () => { disposed.current = true; unsubscribe(); focus(); keys(); for (const item of workspaceRef.current.tabs) void window.qiyao.closeBrowser(item.state.token).catch(() => {}); };
  }, [accept]);
  useEffect(() => { if (active) void open(); }, [active, open]);
  const layout = useCallback((bounds: PreviewViewport | null) => token ? window.qiyao.layoutBrowser(token, bounds) : Promise.resolve(), [token, state?.loading]);
  useNativeViewport(viewport, active && Boolean(state?.url) && !state?.error && !tab?.error, layout, fail);
  const action = (value: BrowserAction) => {
    if (!token) return; if (value !== 'focus') send({ type: 'submitted', token, preserveAddress: tab?.address !== state?.url });
    void window.qiyao.browserAction(token, value).then(accept).catch(fail);
  };
  const navigate = () => {
    if (!token || !tab) { void open(); return; }
    let url: string;
    try { url = browserUrl(tab.address); } catch { send({ type: 'failed', token, message: '请输入不含用户名和密码的完整 HTTP 或 HTTPS 网址。' }); addressInput.current?.focus(); return; }
    send({ type: 'submitted', token }); void window.qiyao.navigateBrowser(token, url).then(accept).catch(fail);
  };
  const retry = () => { if (!token) void open(); else if (tab?.error) navigate(); else if (state?.url) action('reload'); else void close(token); };
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      if (event.key === 'F6' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l')) { event.preventDefault(); addressInput.current?.focus(); addressInput.current?.select(); }
      if ((event.ctrlKey || event.metaKey) && (['t', 'w'].includes(event.key.toLowerCase()) && !event.shiftKey || event.key === 'Tab')) {
        event.preventDefault(); if (!event.repeat) shortcut.current(event.key === 'Tab' ? event.shiftKey ? 'previous' : 'next' : event.key.toLowerCase() === 't' ? 'new' : 'close');
      }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [active]);
  return <section className="browser-page" hidden={!active} aria-label="浏览器">
    <BrowserTabs tabs={workspace.tabs} active={token} idPrefix={tabId} panelId={panelId} onSelect={select} onClose={target => { void close(target); }} onNew={() => { void open(true); }} />
    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); navigate(); }}>
      <IconButton icon="left" label="返回上一页" disabled={!state?.canGoBack} onClick={() => action('back')} />
      <IconButton icon="right" label="前进到下一页" disabled={!state?.canGoForward} onClick={() => action('forward')} />
      <IconButton icon={state?.loading ? 'stop' : 'retry'} label={state?.loading ? '停止加载网页' : '重新加载网页'} disabled={!state?.url} onClick={() => action(state?.loading ? 'stop' : 'reload')} />
      <Input ref={addressInput} aria-label="网址" placeholder="https://example.com" disabled={!state} value={tab?.address ?? ''} onChange={event => { if (token) send({ type: 'edited', token, address: event.target.value }); }} autoComplete="off" spellCheck={false} />
      <Button type="submit" disabled={!state}>打开</Button>
      <IconButton icon="external" label="在系统浏览器中打开" disabled={!state?.url} onClick={() => { if (state?.url) void window.qiyao.openExternal(state.url).catch(fail); }} />
    </form>
    {state?.loading && <div className="browser-status" role="status">正在加载网页…</div>}
    {state?.notice && <div className="browser-status" role="status">{state.notice}</div>}
    {(workspace.error || tab?.error) && <div className="browser-error" role="alert"><p>{workspace.error || tab?.error}</p><Button onClick={workspace.error ? () => { void open(true); } : retry}>重试</Button></div>}
    <div ref={viewport} id={panelId} role={token ? 'tabpanel' : undefined} aria-labelledby={token ? `${tabId}-${workspace.tabs.findIndex(item => item.state.token === token)}` : undefined} className="browser-viewport" aria-label="网页内容">
      {!state?.url && !state?.error && !tab?.error && <div className="browser-empty"><Glyph name="globe" size={40} /><h2>打开一个网页</h2><p>输入完整网址，浏览网页并保留当前工作台。</p></div>}
      {state?.error && !workspace.error && !tab?.error && <BrowserLoadError key={state.token} url={state.url} reason={state.failureReason} code={state.failureCode} onRetry={retry} />}
    </div>
    {state?.url && <div className="browser-footer"><span title={state.title}>{state.title || state.url}</span><Button disabled={Boolean(tab?.error || state.error)} onClick={() => action('focus')}>进入网页</Button><span>Ctrl L · 网址</span></div>}
  </section>;
}
