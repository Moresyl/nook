import { randomUUID } from 'node:crypto';
import type { Thread, Workspace } from '../../contracts/workspace';

export function archiveConversation(state: Workspace, original: Thread, messageId: string, kind: 'reply' | 'message', now: number): Thread {
  if (state.threads.length >= 10_000) throw new Error('Conversation history has reached 10,000 conversations. Delete an unused archive before editing or retrying.');
  const archive: Thread = { ...structuredClone(original), id: randomUUID(), title: `${original.title.slice(0, 140)} · ${kind === 'reply' ? '原回复' : '编辑前'}`, pinned: false, archived: true, updatedAt: now,
    forkedFrom: { threadId: original.id, messageId, kind } };
  delete archive.branchOrder;
  delete archive.comparison;
  const savedDraft = state.composerDrafts.find((item) => item.threadId === original.id);
  if (savedDraft) {
    if (state.composerDrafts.length >= 100) throw new Error('Conversation drafts are limited to 100 owners. Clear an unused draft before editing or retrying.');
    state.composerDrafts.push({ ...structuredClone(savedDraft), threadId: archive.id });
    if (Buffer.byteLength(JSON.stringify(state.composerDrafts), 'utf8') > 32_000_000) throw new Error('Conversation drafts exceed 32 MB. Clear an unused draft before editing or retrying.');
  }
  state.threads.push(archive); return archive;
}
