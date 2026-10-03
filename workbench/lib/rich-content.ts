import type { Element } from 'hast';
import { toString } from 'hast-util-to-string';
import type { MermaidConfig } from 'mermaid';

export type CodeBlock = { language: string; text: string };
export type DiagramPalette = { background: string; surface: string; text: string; border: string; accent: string; dark: boolean };
export function codeBlockFromNode(node?: Element): CodeBlock | undefined {
  const code = node?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
  if (!code) return undefined;
  const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : [];
  const name = classes.find((value) => value.startsWith('language-'))?.slice(9) ?? 'text';
  return { language: /^[a-z0-9_+-]{1,40}$/i.test(name) ? name.toLowerCase() : 'text', text: toString(code).replace(/\n$/, '') };
}
export function validateDiagramSource(source: string): void {
  if (!source.trim() || source.includes('\0')) throw new Error('The diagram source must contain text');
  if (source.length > 50_000) throw new Error('The diagram exceeds the 50000-character rendering limit');
}
export function diagramPolicy(palette: DiagramPalette): MermaidConfig {
  return {
    startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, htmlLabels: false, maxTextSize: 50_000, maxEdges: 500,
    secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering', 'htmlLabels', 'maxTextSize', 'maxEdges', 'theme', 'look', 'themeVariables', 'fontFamily', 'fontSize'],
    theme: 'base', look: 'classic', fontFamily: '"Inter", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif', fontSize: 12,
    themeVariables: { fontSize: '12px', darkMode: palette.dark, background: palette.background, primaryColor: palette.surface, primaryTextColor: palette.text, primaryBorderColor: palette.border, secondaryColor: palette.background, secondaryTextColor: palette.text, tertiaryColor: palette.surface, lineColor: palette.text, textColor: palette.text, edgeLabelBackground: palette.background, noteBkgColor: palette.surface, noteTextColor: palette.text, noteBorderColor: palette.border, actorBkg: palette.surface, actorTextColor: palette.text, actorBorder: palette.border, signalColor: palette.text, signalTextColor: palette.text, labelBoxBkgColor: palette.surface, labelTextColor: palette.text, activationBkgColor: palette.accent }
  };
}
