import { useCallback, useEffect, useRef, useState } from 'react';
import { browserUrl, type BrowserAction, type BrowserState } from '../../contracts/browser';
import { useNativeViewport } from '../lib/native-viewport';
import { Button, IconButton, Input } from '../components/controls';
import { Glyph } from '../components/glyphs';
import type { PreviewViewport } from '../../contracts/project-preview';

export function BrowserPage({ active }: { active: boolean }) {
  const [state, setState] = useState<BrowserState | null>(null), [address, setAddress] = useState(''), [error, setError] = useState<string | null>(null);
  const owner = useRef<string | null>(null), opening = useRef(false), disposed = useRef(false), viewport = useRef<HTMLDivElement>(null), addressInput = useRef<HTMLInputElement>(null);
  const addressUrl = useRef<string | null>(null), pendingAddress = useRef(false);
  const accept = useCallback((next: BrowserState) => { if (!disposed.current && owner.current === next.token) setState(current => current?.token === next.token && current.sequence > next.sequence ? current : next); }, []);
  useEffect(() => {
    disposed.current = false;
    const unsubscribe = window.qiyao.onBrowserState(accept);
    const focus = window.qiyao.onBrowserFocus(token => { if (owner.current === token) { addressInput.current?.focus(); addressInput.current?.select(); } });
    return () => { disposed.current = true; unsubscribe(); focus(); if (owner.current) void window.qiyao.closeBrowser(owner.current).catch(() => {}); owner.current = null; };
  }, [accept]);
  const open = useCallback(async () => {
    if (owner.current || opening.current) return;
    opening.current = true; setError(null);
    try {
      const next = await window.qiyao.openBrowser();
      if (disposed.current) { void window.qiyao.closeBrowser(next.token).catch(() => {}); return; }
      owner.current = next.token; setState(next); addressInput.current?.focus();
    } catch { if (!disposed.current) setError('浏览器无法打开，请重试。'); }
    finally { opening.current = false; }
  }, []);
  useEffect(() => { if (active) void open(); }, [active, open]);
  useEffect(() => {
    if (!state) return;
    if (addressUrl.current !== state.url || (pendingAddress.current && !state.loading)) setAddress(state.url);
    addressUrl.current = state.url;
    if (!state.loading) pendingAddress.current = false;
  }, [state?.sequence]);
  const fail = useCallback(() => setError('浏览器暂时无法显示，请重试。'), []);
  const layout = useCallback((bounds: PreviewViewport | null) => owner.current ? window.qiyao.layoutBrowser(owner.current, bounds) : Promise.resolve(), [state?.loading, state?.token]);
  useNativeViewport(viewport, active && Boolean(state?.url) && !state?.error && !error, layout, fail);
  const action = (value: BrowserAction) => { if (owner.current) { if (value !== 'focus') pendingAddress.current = true; void window.qiyao.browserAction(owner.current, value).then(accept).catch(() => { pendingAddress.current = false; fail(); }); } };
  const navigate = () => {
    let url: string;
    try { url = browserUrl(address); } catch { setError('请输入不含用户名和密码的完整 HTTP 或 HTTPS 网址。'); addressInput.current?.focus(); return; }
    if (!owner.current) { void open(); return; }
    setError(null); pendingAddress.current = true; void window.qiyao.navigateBrowser(owner.current, url).then(accept).catch(() => { pendingAddress.current = false; fail(); });
  };
  const retry = () => { if (!owner.current) void open(); else if (error) navigate(); else if (state?.url) action('reload'); };
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'F6' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l')) { event.preventDefault(); addressInput.current?.focus(); addressInput.current?.select(); } };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [active]);
  return <section className="browser-page" hidden={!active} aria-label="浏览器">
    <form className="browser-toolbar" onSubmit={event => { event.preventDefault(); navigate(); }}>
      <IconButton icon="left" label="返回上一页" disabled={!state?.canGoBack} onClick={() => action('back')} />
      <IconButton icon="right" label="前进到下一页" disabled={!state?.canGoForward} onClick={() => action('forward')} />
      <IconButton icon={state?.loading ? 'stop' : 'retry'} label={state?.loading ? '停止加载网页' : '重新加载网页'} disabled={!state?.url} onClick={() => action(state?.loading ? 'stop' : 'reload')} />
      <Input ref={addressInput} aria-label="网址" placeholder="https://example.com" value={address} onChange={event => setAddress(event.target.value)} autoComplete="off" spellCheck={false} />
      <Button type="submit" disabled={!state}>打开</Button>
      <IconButton icon="external" label="在系统浏览器中打开" disabled={!state?.url} onClick={() => { if (state?.url) void window.qiyao.openExternal(state.url).catch(fail); }} />
    </form>
    {state?.loading && <div className="browser-status" role="status">正在加载网页…</div>}
    {state?.notice && <div className="browser-status" role="status">{state.notice}</div>}
    {(error || state?.error) && <div className="browser-error" role="alert"><p>{error || state?.error}</p><Button onClick={retry}>重试</Button></div>}
    <div ref={viewport} className="browser-viewport" aria-label="网页内容">
      {!state?.url && !error && <div className="browser-empty"><Glyph name="globe" size={40} /><h2>打开一个网页</h2><p>输入完整网址，浏览网页并保留当前工作台。</p></div>}
    </div>
    {state?.url && <div className="browser-footer"><span title={state.title}>{state.title || state.url}</span><Button disabled={Boolean(error || state.error)} onClick={() => action('focus')}>进入网页</Button><span>Ctrl L · 网址</span></div>}
  </section>;
}
