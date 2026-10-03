import { diagramPolicy, validateDiagramSource, type DiagramPalette } from './rich-content';

let queue: Promise<unknown> = Promise.resolve();
export function renderDiagram(source: string, palette: DiagramPalette, current: () => boolean): Promise<string | undefined> {
  const render = async () => {
    if (!current()) return undefined;
    validateDiagramSource(source);
    const [{ default: mermaid }, { default: purifier }] = await Promise.all([import('mermaid'), import('dompurify')]);
    if (!current()) return undefined;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden;pointer-events:none';
    document.body.append(container);
    try {
      mermaid.initialize(diagramPolicy(palette));
      const { svg } = await mermaid.render(`qiyao-diagram-${crypto.randomUUID()}`, source, container);
      if (!current()) return undefined;
      const sanitized = purifier.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['a', 'image', 'foreignObject', 'script', 'iframe', 'use', 'feImage'], FORBID_ATTR: ['href', 'xlink:href', 'src'] });
      if (!sanitized.includes('<svg')) throw new Error('The diagram did not produce a safe SVG');
      return sanitized;
    } finally { container.remove(); }
  };
  const result = queue.then(render); queue = result.catch(() => undefined); return result;
}
