import type { CSSProperties } from 'react';

export function Emblem({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <rect width="40" height="40" rx="12" fill="#3143FF" />
    <path d="M12 28V12L28 28V12" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

const paths = {
  compare: 'M3 4h7v16H3V4Z M14 4h7v16h-7V4Z',
  compose: 'M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6 M15 4l5 5 M9 15l1-5 9-9 4 4-9 9-5 1Z',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  find: 'M3 4h15 M3 9h7 M3 14h5 M3 19h7 M21 21l-4-4 M19 14a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  folder: 'M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
  assistant: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  library: 'M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1Z M8 7h8 M8 11h5',
  archive: 'M4 8v12h16V8 M3 3h18v5H3V3Z M10 12h4',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M12 7v5l4 2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3l-2-2 2-4 3 1 3-1 1-3Z',
  panel: 'M3 4h18v16H3V4Z M9 4v16 M5 8h2 M5 11h2',
  attach: 'm9 17 8-8a3 3 0 0 0-4-4L4 14a5 5 0 0 0 7 7L21 11 M7 15l8-8',
  send: 'M12 20V4 M5 11l7-7 7 7',
  stop: 'M6 6h12v12H6V6Z',
  plus: 'M12 5v14 M5 12h14',
  down: 'm7 10 5 5 5-5',
  up: 'm7 14 5-5 5 5',
  right: 'm9 6 6 6-6 6',
  close: 'm6 6 12 12 M18 6 6 18',
  copy: 'M8 8h12v12H8V8Z M16 8V4H4v12h4',
  wrap: 'M3 5h18 M3 10h13a4 4 0 0 1 0 8h-4 m3-3-3 3 3 3 M3 15h4 M3 20h4',
  quote: 'M4 6h6v7H6v5H3v-6a6 6 0 0 1 1-6Z M15 6h6v7h-4v5h-3v-6a6 6 0 0 1 1-6Z',
  branch: 'M6 3v14a4 4 0 0 0 4 4h8 M6 10h8a4 4 0 0 0 4-4V3',
  retry: 'M20 8a9 9 0 1 0 1 7 M20 3v5h-5',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  pin: 'M8 3h8 M9 3v6l-3 4h12l-3-4V3 M12 13v8',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  check: 'm5 12 4 4L20 5',
  file: 'M5 3h9l5 5v13H5V3Z M14 3v6h5 M8 13h8 M8 17h6',
  minimize: 'M5 12h14',
  maximize: 'M5 5h14v14H5V5Z',
} satisfies Record<string, string>;

export type GlyphName = keyof typeof paths;
export function Glyph({ name, size = 18, style }: { name: GlyphName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true"><path d={paths[name]} /></svg>;
}
