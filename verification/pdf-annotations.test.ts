import { describe, expect, it } from 'vitest';
import { pdfAnnotations } from '../workbench/components/pdf-annotations';

const viewport = { width: 200, height: 300, convertToViewportPoint: (x: number, y: number) => [x * 2, y * 2] };
const link = (extra = {}) => ({ subtype: 'Link', rect: [10, 20, 30, 40], ...extra });
describe('PDF annotation geometry and actions', () => {
  it('projects, normalizes and clips hit regions to the rendered page', () => {
    const [normal, reversed, clipped] = pdfAnnotations([link(), link({ rect: [30, 40, 10, 20] }), link({ rect: [-10, -20, 110, 200] })], viewport);
    expect(normal).toMatchObject({ left: 20, top: 40, width: 40, height: 40 }); expect(reversed).toMatchObject({ left: 20, top: 40, width: 40, height: 40 });
    expect(clipped).toMatchObject({ left: 0, top: 0, width: 200, height: 300 });
    expect(pdfAnnotations([link({ rect: [201, 0, 300, 40] }), link({ rect: [1, 1, 1, 1] }), link({ rect: [NaN, 0, 2, 2] }), link({ hidden: true }), link({ noView: true }), null], viewport)).toEqual([]);
  });
  it('allows only explicit web URLs and internal destinations while keeping active-content actions inert', () => {
    expect(pdfAnnotations([link({ url: 'https://example.com/path' })], viewport)[0]).toMatchObject({ kind: 'link', url: 'https://example.com/path' });
    expect(pdfAnnotations([link({ dest: 'chapter' }), link({ dest: [0, { name: 'Fit' }] })], viewport).map(item => item.kind === 'link' && item.destination)).toEqual(['chapter', [0, { name: 'Fit' }]]);
    for (const url of ['javascript:alert(1)', 'file:///private.pdf', 'data:text/html,test', 'https://user:password@example.com', 'invalid']) {
      expect(pdfAnnotations([link({ url, actions: { MouseUp: ['alert(1)'] } })], viewport)[0]).toMatchObject({ kind: 'link', url: undefined, destination: undefined });
    }
  });
  it('preserves plain comment text without evaluating markup and reports truncation', () => {
    const note = { subtype: 'Text', rect: [0, 0, 20, 20], titleObj: { str: 'Author' }, contentsObj: { str: '<img src=x onerror=alert(1)>\n中文注释' } };
    expect(pdfAnnotations([note], viewport)[0]).toMatchObject({ kind: 'note', title: 'Author', content: note.contentsObj.str, truncated: false });
    const [long] = pdfAnnotations([{ ...note, contentsObj: { str: 'x'.repeat(32001) } }], viewport);
    expect(long.kind === 'note' && long.content.length).toBe(32000); expect(long).toMatchObject({ truncated: true });
    expect(pdfAnnotations([{ ...note, contentsObj: { str: ' ' } }], viewport)).toEqual([]);
  });
  it('rejects invalid layer inputs and ignores invalid projected rectangles', () => {
    expect(() => pdfAnnotations({}, viewport)).toThrow(); expect(() => pdfAnnotations(Array.from({ length: 10001 }, () => link()), viewport)).toThrow();
    expect(pdfAnnotations([link()], { ...viewport, convertToViewportPoint: () => [0, NaN] })).toEqual([]);
  });
});
