import { describe, expect, it } from 'vitest';
import { verifyImageExportProof } from '../scripts/release-policy.mjs';
import { imageExportReleaseProof as proof } from './image-export-release-fixture';
describe('JPEG image export release evidence', () => {
  it('requires six genuine quick-window layouts with a visible image area', () => {
    for (const value of [undefined, [], proof().quickLayouts.slice(1), Array(6).fill(proof().quickLayouts[0])]) { const incomplete = proof(); Reflect.set(incomplete, 'quickLayouts', value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
    for (const key of ['contained', 'pageContained', 'failureRetried', 'exactJpegBytes', 'imageVisible', 'warningKeyboard']) for (const value of [false, undefined, 'true']) { const incomplete = proof(); Reflect.set(incomplete.quickLayouts[0], key, value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
    for (const value of [0, 31, Number.NaN, '32', undefined]) { const incomplete = proof(); Reflect.set(incomplete.quickLayouts[0], 'imageAreaHeight', value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
    const bounded = proof(); bounded.quickLayouts[0].imageAreaHeight = 32; expect(() => verifyImageExportProof(bounded)).not.toThrow();
  });
  it('rejects mismatched quick-window themes and captures', () => {
    for (const [key, value] of [['actualTheme', 'dark'], ['screenshot', '136-image-export-light-100.png'], ['zoom', 1.1]] as [string, unknown][]) { const incomplete = proof(); Reflect.set(incomplete.quickLayouts[0], key, value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
  });
  it('accepts complete evidence without changing it', () => { const value = proof(), original = structuredClone(value); expect(() => verifyImageExportProof(value)).not.toThrow(); expect(value).toEqual(original); });
  it('rejects missing evidence and every absent or non-boolean operation proof', () => {
    expect(() => verifyImageExportProof(undefined)).toThrow('JPEG image export');
    for (const key of ['cancelPreservedDestination', 'failureRetried', 'exactJpegBytes', 'delayedImageIsolation', 'draftUnchanged', 'quickChatVerified']) for (const value of [false, undefined, 'true']) {
      const incomplete = proof(); Reflect.set(incomplete, key, value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export');
    }
  });
  it('rejects invalid byte identities and missing or duplicate layouts', () => {
    for (const value of [undefined, 42, '', 'A'.repeat(64), 'a'.repeat(63), '../outside']) { const incomplete = proof(); Reflect.set(incomplete, 'sha256', value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
    for (const layouts of [undefined, {}, [], proof().layouts.slice(1), [...proof().layouts, proof().layouts[0]], Array(6).fill(proof().layouts[0]), [null, ...proof().layouts.slice(1)]]) {
      const incomplete = proof(); Reflect.set(incomplete, 'layouts', layouts); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export');
    }
  });
  it('rejects clipped or mislabeled layouts, missing retries, and unrelated captures', () => {
    for (const key of ['contained', 'pageContained', 'failureRetried', 'exactJpegBytes']) for (const value of [false, undefined, 'true']) { const incomplete = proof(); Reflect.set(incomplete.layouts[0], key, value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export'); }
    for (const [key, value] of [['actualTheme', 'dark'], ['theme', 'other'], ['zoom', 1.1], ['screenshot', '136-image-export-dark-150.png'], ['screenshot', undefined]] as [string, unknown][]) {
      const incomplete = proof(); Reflect.set(incomplete.layouts[0], key, value); expect(() => verifyImageExportProof(incomplete)).toThrow('JPEG image export');
    }
  });
});
