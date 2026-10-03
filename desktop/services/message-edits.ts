import { createHash, randomUUID } from 'node:crypto';
import { messageDraftSchema, messageEditSchema, messageTargetSchema } from '../../contracts/message-edits';
import { conversationHistory } from '../../contracts/conversations';
import { nextReplyVersion } from '../../contracts/reply-versions';
import { archiveConversation } from './conversation-archive';
import type { WorkspaceVault } from './vault';

export class MessageEdits {
  constructor(private readonly vault: WorkspaceVault, private readonly active: (id: string) => boolean) {}
  async saveDraft(raw: unknown): Promise<void> {
    const input = messageDraftSchema.parse(raw);
    await this.vault.update((state) => {
      const message = state.threads.find((thread) => thread.id === input.threadId)?.messages.find((item) => item.id === input.messageId);
      if (!message) throw new Error('This message no longer exists. Its editing draft cannot be saved.');
      if (message.role === 'user' && input.content.length > 256_000) throw new Error('User message drafts exceed the 256 KB character limit.');
      const index = state.messageDrafts.findIndex((draft) => draft.threadId === input.threadId && draft.messageId === input.messageId);
      if (index < 0) { if (state.messageDrafts.length >= 100) throw new Error('Message editing drafts are limited to 100 messages. Discard an unused editing draft first.'); state.messageDrafts.push(input); } else state.messageDrafts[index] = input;
      if (Buffer.byteLength(JSON.stringify(state.messageDrafts), 'utf8') > 32_000_000) throw new Error('Message editing drafts exceed 32 MB. Discard an unused editing draft first.');
    });
  }
  async removeDraft(raw: unknown): Promise<void> {
    const input = messageTargetSchema.parse(raw);
    await this.vault.update((state) => { state.messageDrafts = state.messageDrafts.filter((draft) => draft.threadId !== input.threadId || draft.messageId !== input.messageId); });
  }
  edit(raw: unknown) {
    const input = messageEditSchema.parse(raw);
    return this.vault.update((state) => {
      const thread = state.threads.find((item) => item.id === input.threadId);
      if (!thread) throw new Error('This conversation no longer exists.');
      if (this.active(thread.id) || thread.messages.some((message) => message.status === 'running')) throw new Error('Stop the running response before editing this conversation.');
      if (createHash('sha256').update(conversationHistory(thread)).digest('hex') !== input.revision) throw new Error('This conversation changed. Your editing draft is retained. Reopen the current message or discard the editing draft.');
      const index = thread.messages.findIndex((message) => message.id === input.messageId);
      if (index < 0) throw new Error('This message no longer exists.');
      const message = thread.messages[index];
      if (message.role === 'user' && input.content.length > 256_000) throw new Error('User messages exceed the 256 KB character limit.');
      if (input.content !== message.content) {
        const now = Date.now(); const groupId = message.role === 'assistant' ? message.replyVersion?.groupId ?? randomUUID() : undefined;
        const version = groupId ? { groupId, number: nextReplyVersion(state.threads, groupId) } : undefined;
        const archive = archiveConversation(state, thread, message.id, 'message', now);
        if (version) archive.messages[index].replyVersion = message.replyVersion ?? { groupId: version.groupId, number: 1 };
        thread.messages[index] = { ...message, id: randomUUID(), content: input.content, editedAt: now, ...(version ? { replyVersion: version } : {}) }; thread.updatedAt = now;
      }
      state.messageDrafts = state.messageDrafts.filter((draft) => draft.threadId !== input.threadId || draft.messageId !== input.messageId);
    });
  }
}
