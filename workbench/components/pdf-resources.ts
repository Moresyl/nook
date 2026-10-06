// Embedded package resources keep CMaps, fonts and image decoders available without network or file URLs.
const assets = import.meta.glob<string>([
  '../../node_modules/pdfjs-dist/cmaps/*.bcmap',
  '../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}',
  '../../node_modules/pdfjs-dist/wasm/*.wasm',
], { query: '?url&inline', import: 'default', eager: true });
const folders: Record<string, string> = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' };

export class EmbeddedPdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    if (!Object.hasOwn(folders, kind) || !/^[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error('PDF resource is unavailable.');
    const value = assets[`../../node_modules/pdfjs-dist/${folders[kind]}/${filename}`];
    if (!value?.startsWith('data:') || !value.includes(';base64,')) throw new Error('PDF resource is missing from this installation.');
    const decoded = atob(value.slice(value.indexOf(',') + 1));
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  }
}
