import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { attachmentSchema } from '../contracts/attachments';
import { knowledgeDocumentSourceSchema } from '../contracts/knowledge';
import { composerDraftSchema, emptyWorkspace, threadSchema } from '../contracts/workspace';
import { persistentWorkspace } from '../contracts/temporary-conversations';
import { documentOriginalReferences } from '../desktop/services/document-original-references';

const original = (letter = 'a', bytes = 20) => ({ sha256: letter.repeat(64), bytes, mimeType: 'application/pdf' as const });
const file = (letter = 'a', bytes = 20) => attachmentSchema.parse({ id: letter, name: `${letter}.pdf`, content: 'Extracted text', source: { format: 'pdf', bytes }, original: original(letter, bytes) });
const source = (letter = 'a') => knowledgeDocumentSourceSchema.parse({ name: `${letter}.pdf`, format: 'pdf', bytes: 20, extractedHash: 'e'.repeat(64), original: original(letter) });
const thread = (id: string, letter: string, temporary = false) => threadSchema.parse({ id, title: id, temporary: temporary ? true : undefined, archived: !temporary, createdAt: 1, updatedAt: 1, messages: [{ id: `${id}-message`, role: 'user', content: '', createdAt: 1, attachments: [file(letter)] }] });

describe('original document reference ownership', () => {
  it('preserves old extracted-text attachments and rejects inconsistent new source metadata', () => {
    expect(attachmentSchema.parse({ id: 'old', name: 'old.pdf', content: 'old text' }).original).toBeUndefined();
    expect(file().original).toEqual(original());
    for (const value of [{ ...file(), source: undefined }, { ...file(), source: { format: 'text', bytes: 20 } }, { ...file(), original: original('a', 21) }]) expect(attachmentSchema.safeParse(value).success).toBe(false);
    expect(knowledgeDocumentSourceSchema.safeParse({ ...source(), format: 'docx' }).success).toBe(false);
    expect(knowledgeDocumentSourceSchema.safeParse({ ...source(), bytes: 21 }).success).toBe(false);
  });

  it('deduplicates originals across current and archived paths, drafts, notes and retained citations', () => {
    const state = emptyWorkspace(); state.threads.push(thread('archived', 'a'));
    state.composerDrafts.push(composerDraftSchema.parse({ text: '', attachments: [file('b')], updatedAt: 1 }));
    state.notes.push({ id: 'note', title: 'note', content: 'Extracted text', createdAt: 1, source: source('c') });
    state.threads[0].messages[0].knowledgeSources = [{ citation: 'K1', noteId: 'removed-note', collectionId: 'notes', collectionName: 'Notes', title: 'Removed', start: 0, end: 4, text: 'text', source: source('d') }];
    state.threads.push(thread('duplicate-path', 'a'));
    expect(documentOriginalReferences(state)).toEqual([original('b'), original('a'), original('d'), original('c')]);
    state.threads.shift(); expect(documentOriginalReferences(state)).toContainEqual(original('a'));
    const refs = documentOriginalReferences(state); refs[0].bytes = 100;
    expect(state.composerDrafts[0].attachments[0].original?.bytes).toBe(20);
  });

  it('keeps temporary originals in live ownership while excluding them from persistent workspace ownership', () => {
    const state = emptyWorkspace(); state.threads.push(thread('regular', 'a'), thread('temporary', 'b', true));
    state.composerDrafts.push(composerDraftSchema.parse({ threadId: 'temporary', text: '', attachments: [file('c')], updatedAt: 1 }));
    expect(documentOriginalReferences(state)).toEqual([original('c'), original('a'), original('b')]);
    expect(documentOriginalReferences(persistentWorkspace(state))).toEqual([original('a')]);
    state.threads[0].messages[0].attachments.push(file('b'));
    expect(documentOriginalReferences(persistentWorkspace(state))).toEqual([original('a'), original('b')]);
  });

  it('rejects conflicting sizes for one content identity instead of selecting an arbitrary owner', () => {
    const state = emptyWorkspace(); state.threads.push(thread('one', 'a'), thread('two', 'a'));
    state.threads[1].messages[0].attachments = [file('a', 21)];
    expect(() => documentOriginalReferences(state)).toThrow('conflicting metadata');
    expect(documentOriginalReferences(emptyWorkspace())).toEqual([]);
  });

  it('includes every quick-chat draft while excluding temporary-owned quick input from disk and backup', () => {
    const state = emptyWorkspace(); state.threads.push(thread('temporary', 'a', true), thread('regular', 'b'));
    state.quickChat = { revision: randomUUID(), activeThreadId: 'temporary', composerDrafts: [
      composerDraftSchema.parse({ threadId: 'temporary', text: 'Private input', attachments: [file('c')], updatedAt: 1 }),
      composerDraftSchema.parse({ threadId: 'regular', text: 'Saved input', attachments: [file('d')], updatedAt: 1 }),
      composerDraftSchema.parse({ text: 'New input', attachments: [file('e')], updatedAt: 1 }),
    ] };
    expect(documentOriginalReferences(state)).toEqual([original('c'), original('d'), original('e'), original('a'), original('b')]);
    const persistent = persistentWorkspace(state);
    expect(persistent.quickChat?.activeThreadId).toBeUndefined(); expect(persistent.quickChat?.composerDrafts.map(draft => draft.text)).toEqual(['Saved input', 'New input']);
    expect(documentOriginalReferences(persistent)).toEqual([original('d'), original('e'), original('b')]);
    expect(state.quickChat.composerDrafts).toHaveLength(3); expect(state.quickChat.activeThreadId).toBe('temporary');
  });
});
