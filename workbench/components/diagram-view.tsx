import { useEffect, useRef, useState } from 'react';
import regularFont from '../theme/fonts/InterVariable-693b77d4f32e.woff2?url';
import { renderDiagram } from '../lib/mermaid-renderer';
import type { DiagramPalette } from '../lib/rich-content';

const light: DiagramPalette = { background: '#ffffff', surface: '#f9f9f9', text: '#282828', border: '#d1d1d1', accent: '#0285ff', dark: false };
function usePalette() {
  const [palette, setPalette] = useState(light);
  useEffect(() => {
    const update = () => { const css = getComputedStyle(document.documentElement); const color = (name: string) => css.getPropertyValue(name).trim(); setPalette({ background: color('--ds-bg'), surface: color('--ds-bg-secondary'), text: color('--ds-text'), border: color('--ds-border'), accent: color('--ds-accent'), dark: document.documentElement.dataset.theme === 'dark' }); };
    update(); const observer = new MutationObserver(update); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect();
  }, []);
  return palette;
}
function diagramDocument(svg: string, palette: DiagramPalette): string {
  const font = new URL(regularFont, location.href).href;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'self'; base-uri 'none'; form-action 'none'"><style>@font-face{font-family:"Inter";src:url("${font}") format("woff2");font-weight:100 900;font-display:swap}html,body{margin:0;background:${palette.background};color:${palette.text};font:12px "Inter","Microsoft YaHei UI","Microsoft YaHei",sans-serif}body{padding:12px;overflow:auto}svg{display:block;max-width:100%;height:auto;margin:auto}</style></head><body>${svg}</body></html>`;
}
export function DiagramView({ source, generating, showSource }: { source: string; generating: boolean; showSource: boolean }) {
  const palette = usePalette(); const [result, setResult] = useState<{ source: string; palette: DiagramPalette; svg?: string; error?: boolean }>();
  const [height, setHeight] = useState(180); const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { void renderDiagram(source, palette, () => active).then((svg) => { if (active && svg) setResult({ source, palette, svg }); }).catch(() => { if (active) setResult({ source, palette, error: true }); }); }, generating ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [source, palette, generating]);
  const rendered = result?.source === source && result.palette === palette ? result : undefined;
  useEffect(() => {
    const frame = frameRef.current; if (!frame) return;
    let active = true;
    const measure = () => { if (!active || !frame.isConnected) return; const svg = frame.contentDocument?.querySelector('svg'); if (svg) setHeight(Math.max(80, Math.min(480, Math.ceil(svg.getBoundingClientRect().height + 24)))); };
    const loaded = () => { measure(); void frame.contentDocument?.fonts.ready.then(measure); };
    const observer = new ResizeObserver(measure); observer.observe(frame); frame.addEventListener('load', loaded); loaded();
    return () => { active = false; observer.disconnect(); frame.removeEventListener('load', loaded); };
  }, [rendered?.svg, showSource, palette]);
  if (showSource || !rendered?.svg) return <><pre dir="ltr"><code>{source}</code></pre>{!showSource && <p className="diagram-status muted text-small" role="status">{rendered?.error && !generating ? '无法绘制图表，源码已保留。' : generating ? '图表生成中…' : '正在绘制图表…'}</p>}</>;
  return <iframe ref={frameRef} className="diagram-frame" title="Mermaid 图表" sandbox="allow-same-origin" srcDoc={diagramDocument(rendered.svg, palette)} style={{ height }} />;
}
