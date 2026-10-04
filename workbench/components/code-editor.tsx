import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker';
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';
import { useEffect, useRef, useState } from 'react';

self.MonacoEnvironment = { getWorker(_module: string, label: string) {
  if (label === 'json') return new JsonWorker();
  if (['css', 'scss', 'less'].includes(label)) return new CssWorker();
  if (['html', 'handlebars', 'razor'].includes(label)) return new HtmlWorker();
  if (['typescript', 'javascript'].includes(label)) return new TsWorker();
  return new EditorWorker();
} };
loader.config({ monaco });

const options: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true, fontFamily: 'Consolas, "SFMono-Regular", monospace', fontSize: 12,
  minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, padding: { top: 12 },
  smoothScrolling: true, accessibilitySupport: 'on', renderWhitespace: 'selection', editContext: false,
};
function useEditorTheme() {
  const [theme, setTheme] = useState('qiyao-light');
  useEffect(() => {
    const update = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      const css = getComputedStyle(document.documentElement);
      const hex = (name: string) => { const value = css.getPropertyValue(name).trim(); if (/^#[0-9a-f]{3,4}$/i.test(value)) return `#${value.slice(1).split('').map((part) => part + part).join('')}`; if (value.startsWith('#')) return value; const parts = value.match(/\d+/g); return parts ? `#${parts.slice(0, 3).map((part) => Number(part).toString(16).padStart(2, '0')).join('')}` : dark ? '#212121' : '#ffffff'; };
      const name = dark ? 'qiyao-dark' : 'qiyao-light';
      monaco.editor.defineTheme(name, { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors: { 'editor.background': hex('--ds-bg'), 'editor.foreground': hex('--ds-text'), 'editor.selectionBackground': hex('--color-background-text-selection'), 'editorLineNumber.foreground': hex('--ds-text-tertiary') } });
      monaco.editor.setTheme(name); setTheme(name);
    };
    update(); const observer = new MutationObserver(update); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect();
  }, []);
  return theme;
}
export function CodeEditor({ path, value, onChange, onSave }: { path: string; value: string; onChange: (value: string) => void; onSave: () => void }) {
  const theme = useEditorTheme();
  return <Editor path={path} value={value} theme={theme} options={options} loading={<span className="muted">正在打开编辑器…</span>} onChange={(text) => onChange(value.startsWith('\ufeff') && !text?.startsWith('\ufeff') ? `\ufeff${text ?? ''}` : text ?? '')} onMount={(editor) => { editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave); }} />;
}
export function CodeDiff({ path, before, after }: { path: string; before: string; after: string }) {
  useEditorTheme();
  const container = useRef<HTMLDivElement>(null);
  const models = useRef<{ before: monaco.editor.ITextModel; after: monaco.editor.ITextModel } | null>(null);
  useEffect(() => {
    const id = crypto.randomUUID();
    const original = monaco.editor.createModel(before, undefined, monaco.Uri.parse(`qiyao-diff://before/${id}/${path}`));
    const modified = monaco.editor.createModel(after, undefined, monaco.Uri.parse(`qiyao-diff://after/${id}/${path}`));
    const editor = monaco.editor.createDiffEditor(container.current!, { ...options, readOnly: true, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: true });
    const viewModel = editor.createViewModel({ original, modified });
    models.current = { before: original, after: modified }; editor.setModel(viewModel);
    return () => { models.current = null; editor.setModel(null); viewModel.dispose(); editor.dispose(); original.dispose(); modified.dispose(); };
  }, [path]);
  useEffect(() => { models.current?.before.setValue(before); models.current?.after.setValue(after); }, [before, after]);
  return <div ref={container} className="code-diff-canvas" />;
}
