import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramPalette } from '../workbench/lib/rich-content';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), sanitize: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize, render: mocks.render } }));
vi.mock('dompurify', () => ({ default: { sanitize: mocks.sanitize } }));
const palette: DiagramPalette = { background: '#ffffff', surface: '#f9f9f9', text: '#282828', border: '#d1d1d1', accent: '#0285ff', dark: false };
const appended: { style: { cssText: string }; remove: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); appended.length = 0;
  mocks.render.mockResolvedValue({ svg: '<svg>original</svg>' }); mocks.sanitize.mockReturnValue('<svg>safe</svg>');
  vi.stubGlobal('document', { createElement: () => ({ style: { cssText: '' }, remove: vi.fn() }), body: { append: (container: typeof appended[number]) => appended.push(container) } });
  vi.stubGlobal('crypto', { randomUUID: () => 'verification-id' });
});
afterEach(() => vi.unstubAllGlobals());

describe('isolated diagram renderer lifecycle', () => {
  it('uses the locked policy, sanitizes output and removes its owned measurement container', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer'); expect(await renderDiagram('flowchart LR\nA-->B', palette, () => true)).toBe('<svg>safe</svg>');
    expect(mocks.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', htmlLabels: false, maxEdges: 500 })); expect(mocks.render).toHaveBeenCalledWith('qiyao-diagram-verification-id', 'flowchart LR\nA-->B', appended[0]);
    const options = mocks.sanitize.mock.calls[0][1]; expect(options.FORBID_TAGS).toEqual(expect.arrayContaining(['a', 'image', 'foreignObject', 'script', 'iframe', 'use', 'feImage'])); expect(options.FORBID_ATTR).toEqual(['href', 'xlink:href', 'src']); expect(options.ALLOWED_URI_REGEXP).toBeUndefined(); expect(appended[0].remove).toHaveBeenCalledOnce();
  });
  it('rejects empty/oversized input before rendering and ignores work already canceled', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer'); await expect(renderDiagram('', palette, () => true)).rejects.toThrow('text'); await expect(renderDiagram('a'.repeat(50_001), palette, () => true)).rejects.toThrow('limit');
    expect(await renderDiagram('', palette, () => false)).toBeUndefined(); expect(mocks.render).not.toHaveBeenCalled(); expect(appended).toHaveLength(0);
  });
  it('ignores cancellation after loading or rendering without retaining a measurement container', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer');
    expect(await renderDiagram('flowchart LR\nA-->B', palette, vi.fn().mockReturnValueOnce(true).mockReturnValue(false))).toBeUndefined(); expect(appended).toHaveLength(0);
    expect(await renderDiagram('flowchart LR\nA-->B', palette, vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false))).toBeUndefined(); expect(mocks.sanitize).not.toHaveBeenCalled(); expect(appended[0].remove).toHaveBeenCalledOnce();
  });
  it('serializes palette changes until the preceding render has finished', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer'); let finish!: (value: { svg: string }) => void; let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    mocks.render.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const first = renderDiagram('flowchart LR\nA-->B', palette, () => true); await ready; const second = renderDiagram('flowchart LR\nC-->D', { ...palette, dark: true }, () => true);
    expect(mocks.initialize).toHaveBeenCalledTimes(1); finish({ svg: '<svg>first</svg>' }); await first; await second; expect(mocks.initialize.mock.calls.map(([config]) => config.themeVariables.darkMode)).toEqual([false, true]); expect(appended.every((container) => container.remove.mock.calls.length === 1)).toBe(true);
  });
  it('drops queued work canceled while another diagram was rendering', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer'); let finish!: (value: { svg: string }) => void; let started!: () => void; const ready = new Promise<void>((resolve) => { started = resolve; });
    mocks.render.mockImplementationOnce(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const first = renderDiagram('flowchart LR\nA-->B', palette, () => true); await ready; let current = true; const second = renderDiagram('flowchart LR\nC-->D', palette, () => current); current = false; finish({ svg: '<svg>first</svg>' }); await first; expect(await second).toBeUndefined(); expect(mocks.render).toHaveBeenCalledOnce();
  });
  it('cleans up renderer/sanitizer failures and keeps the queue usable for later graphs', async () => {
    const { renderDiagram } = await import('../workbench/lib/mermaid-renderer'); mocks.render.mockRejectedValueOnce(new Error('Invalid graph')); await expect(renderDiagram('invalid', palette, () => true)).rejects.toThrow('Invalid graph');
    mocks.sanitize.mockReturnValueOnce('empty'); await expect(renderDiagram('flowchart LR\nA-->B', palette, () => true)).rejects.toThrow('safe SVG');
    mocks.sanitize.mockImplementationOnce(() => { throw new Error('Sanitizer unavailable'); }); await expect(renderDiagram('flowchart LR\nA-->B', palette, () => true)).rejects.toThrow('Sanitizer unavailable');
    expect(await renderDiagram('flowchart LR\nC-->D', palette, () => true)).toBe('<svg>safe</svg>'); expect(appended).toHaveLength(4); expect(appended.every((container) => container.remove.mock.calls.length === 1)).toBe(true);
  });
});
