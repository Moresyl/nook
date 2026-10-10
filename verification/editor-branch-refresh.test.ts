import { describe, expect, it } from 'vitest';
import type { EditorDraft } from '../contracts/projects';
import { mergeRefreshedEditorTabs } from '../workbench/components/editor-branch-refresh';

const draft = (extra: Partial<EditorDraft> = {}): EditorDraft => ({ projectId: 'project', path: 'file.ts', text: 'base', baseText: 'base', baseSha256: 'a'.repeat(64), updatedAt: 1, ...extra });
const document = { path: 'file.ts', text: 'new branch', sha256: 'b'.repeat(64) };
describe('branch editor refresh', () => {
  it('refreshes clean text and its comparison baseline without dropping other tabs', () => {
    const before = draft(), other = draft({ path: 'other.ts', text: 'dirty', baseText: 'old' });
    expect(mergeRefreshedEditorTabs([before, other], [{ before, document }])).toEqual({ tabs: [{ ...before, text: document.text, baseText: document.text, baseSha256: document.sha256 }, other], unreadable: false });
  });
  it('preserves dirty text, edits made while reads are pending and a newer baseline', () => {
    const before = draft();
    for (const current of [draft({ text: 'unsaved' }), draft({ text: 'another', baseText: 'another' }), draft({ baseSha256: 'c'.repeat(64) }), draft({ projectId: 'another-project' })]) {
      expect(mergeRefreshedEditorTabs([current], [{ before, document }])).toEqual({ tabs: [current], unreadable: false });
    }
  });
  it('retains unavailable clean files and reports them without reviving closed tabs', () => {
    const before = draft(); expect(mergeRefreshedEditorTabs([before], [{ before, document: null }])).toEqual({ tabs: [before], unreadable: true });
    expect(mergeRefreshedEditorTabs([], [{ before, document }])).toEqual({ tabs: [], unreadable: false });
  });
  it('does not report an obsolete read failure after the user starts editing', () => {
    const before = draft(), current = draft({ text: 'keep my edit' });
    expect(mergeRefreshedEditorTabs([current], [{ before, document: null }])).toEqual({ tabs: [current], unreadable: false });
  });
});
