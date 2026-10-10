import type { EditorDraft, FileDocument } from '../../contracts/projects';

export type RefreshedEditorDocument = { before: EditorDraft; document: FileDocument | null };
export function mergeRefreshedEditorTabs(tabs: EditorDraft[], documents: RefreshedEditorDocument[]): { tabs: EditorDraft[]; unreadable: boolean } {
  const refreshed = new Map(documents.map(entry => [entry.before.path, entry])); let unreadable = false;
  return { tabs: tabs.map(tab => {
    const entry = refreshed.get(tab.path);
    if (!entry || tab.projectId !== entry.before.projectId || tab.text !== tab.baseText || tab.text !== entry.before.text || tab.baseSha256 !== entry.before.baseSha256) return tab;
    if (!entry.document) { unreadable = true; return tab; }
    return { ...tab, text: entry.document.text, baseText: entry.document.text, baseSha256: entry.document.sha256 };
  }), unreadable };
}
