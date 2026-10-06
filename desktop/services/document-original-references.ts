import type { DocumentOriginal } from '../../contracts/document-originals';
import type { Workspace } from '../../contracts/workspace';

/** Includes archived paths and retained citations; pass persistentWorkspace(state) for disk ownership. */
export function documentOriginalReferences(state: Pick<Workspace, 'threads' | 'composerDrafts' | 'notes' | 'quickChat'>): DocumentOriginal[] {
  const references = new Map<string, DocumentOriginal>();
  const add = (value?: DocumentOriginal) => {
    if (!value) return;
    const previous = references.get(value.sha256);
    if (previous && (previous.bytes !== value.bytes || previous.mimeType !== value.mimeType)) throw new Error('Original document references contain conflicting metadata.');
    references.set(value.sha256, { ...value });
  };
  for (const draft of state.composerDrafts) for (const file of draft.attachments) add(file.original);
  for (const draft of state.quickChat?.composerDrafts ?? []) for (const file of draft.attachments) add(file.original);
  for (const thread of state.threads) for (const message of thread.messages) {
    for (const file of message.attachments) add(file.original);
    for (const citation of message.knowledgeSources ?? []) add(citation.source?.original);
  }
  for (const note of state.notes) add(note.source?.original);
  return [...references.values()];
}
