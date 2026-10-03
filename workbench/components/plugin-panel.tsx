import { useEffect, useRef, useState } from 'react';
import type { Plugin } from '../../contracts/plugins';
import { Button, IconButton } from './controls';

type Props = { plugin: Plugin; panelId: string; onClose: () => void; report: (error: unknown) => void };
export function PluginPanel({ plugin, panelId, onClose, report }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const panel = plugin.manifest.panels.find((item) => item.id === panelId);
  useEffect(() => {
    let live = true; setUrl(''); setFailed(false);
    void window.qiyao.pluginPanelUrl(plugin.id, panelId).then((next) => { if (live) setUrl(next); }).catch((error) => { if (live) { setFailed(true); report(error); } });
    return () => { live = false; };
  }, [plugin.id, panelId, report]);
  useEffect(() => {
    if (!url) return;
    let live = true; let inFlight = 0; const origin = `qiyao-plugin://${plugin.id}`;
    const sendTheme = () => frame.current?.contentWindow?.postMessage({ type: 'qiyao:plugin-init', theme: document.documentElement.dataset.theme }, origin);
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return;
      const data = event.data;
      if (data?.type === 'qiyao:plugin-ready') { sendTheme(); return; }
      if (data?.type !== 'qiyao:plugin-request' || typeof data.id !== 'string' || data.id.length > 128 || typeof data.method !== 'string' || data.method.length > 100 || inFlight >= 16) return;
      try { if (JSON.stringify(data.params)?.length > 64_000) return; } catch { return; }
      inFlight++;
      try {
        const value = await window.qiyao.pluginPanelRequest(plugin.id, data.method, data.params);
        if (live) frame.current?.contentWindow?.postMessage({ type: 'qiyao:plugin-reply', id: data.id, ok: true, value }, origin);
      } catch {
        if (live) frame.current?.contentWindow?.postMessage({ type: 'qiyao:plugin-reply', id: data.id, ok: false, error: '请求失败，请检查插件权限和运行状态。' }, origin);
      } finally { inFlight--; }
    };
    window.addEventListener('message', receive);
    const observer = new MutationObserver(sendTheme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { live = false; observer.disconnect(); window.removeEventListener('message', receive); };
  }, [url, plugin.id]);
  return <section className="plugin-panel" aria-label={panel?.title ?? '插件面板'}>
    <div className="plugin-panel-heading"><strong>{panel?.title}</strong><IconButton icon="close" label="关闭插件面板" onClick={onClose} /></div>
    {url ? <iframe ref={frame} title={panel?.title ?? '插件面板'} src={url} sandbox="allow-scripts allow-same-origin" /> : <p className="field-hint">{failed ? '面板加载失败。' : '正在打开面板…'}{failed && <Button onClick={onClose}>返回</Button>}</p>}
  </section>;
}
