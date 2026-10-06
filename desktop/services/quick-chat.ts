import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { restoreComposer } from '../../contracts/composer';
import { composerDraftSchema, type ComposerDraft, type QuickChatState } from '../../contracts/workspace';
import type { ConversationEngine } from './conversation-engine';
import type { WorkspaceVault } from './vault';
import type { QuickChatSnapshot } from '../../contracts/quick-chat';
import { documentOriginalSchema, type DocumentOriginal } from '../../contracts/document-originals';
import { documentOriginalReferences } from './document-original-references';

export class QuickChat {
  constructor(private readonly vault: WorkspaceVault, private readonly engine: Pick<ConversationEngine, 'start' | 'stop'> & Partial<Pick<ConversationEngine, 'thread'>>) {}

  private current(): QuickChatState {
    const state = this.vault.quickChat();
    if (!state) throw new Error('Open quick chat before changing its draft.');
    return state;
  }
  private normalized(state: QuickChatState): ComposerDraft {
    const thread = state.activeThreadId ? this.vault.thread(state.activeThreadId) : undefined;
    const saved = state.composerDrafts.find(draft => draft.threadId === state.activeThreadId);
    return restoreComposer(this.vault.composerContext(), thread?.temporary ? undefined : thread, saved);
  }
  async load(): Promise<QuickChatSnapshot> {
    await this.vault.wait();
    if (!this.vault.quickChat()) {
      const draft = restoreComposer(this.vault.composerContext());
      await this.vault.commitQuickChat(state => { state.quickChat ??= { revision: randomUUID(), composerDrafts: [draft] }; });
    }
    const current = this.current(), draft = this.normalized(current);
    return { revision: current.revision, draft, context: this.vault.composerContext(), thread: draft.threadId ? this.engine.thread?.(draft.threadId) ?? this.vault.thread(draft.threadId) : undefined, conversations: this.vault.conversationChoices() };
  }
  async save(raw: unknown, rawRevision: unknown): Promise<string> {
    const draft = composerDraftSchema.parse(raw), revision = z.uuid().parse(rawRevision), nextRevision = randomUUID();
    await this.vault.commitQuickChat(state => {
      if (state.quickChat?.revision !== revision) throw new Error('Quick chat changed. Reload it before saving; your input is retained.');
      const owner = this.normalized(state.quickChat).threadId;
      if (draft.threadId !== owner) throw new Error('This draft does not belong to the current quick chat.');
      const previousOwner = state.quickChat.activeThreadId;
      state.quickChat = { ...state.quickChat, revision: nextRevision, activeThreadId: draft.threadId,
        composerDrafts: [...state.quickChat.composerDrafts.filter(item => item.threadId !== previousOwner && item.threadId !== draft.threadId), draft] };
    });
    return nextRevision;
  }
  async send(rawRevision: unknown): Promise<{ threadId: string }> {
    const revision = z.uuid().parse(rawRevision); await this.vault.wait();
    const current = this.current();
    if (current.revision !== revision) throw new Error('Quick chat changed. Reload it before sending; your input is retained.');
    const draft = this.normalized(current);
    if (!draft.providerId || !draft.model) throw new Error('Choose a configured model before sending.');
    const { updatedAt: _updatedAt, ...request } = draft;
    return this.engine.start({ ...request, providerId: draft.providerId, model: draft.model }, (state, threadId) => {
      if (state.quickChat?.revision !== revision) throw new Error('Quick chat changed before sending. Your draft is retained.');
      const previousOwner = state.quickChat.activeThreadId;
      state.quickChat = { ...state.quickChat, revision: randomUUID(), activeThreadId: threadId,
        composerDrafts: [...state.quickChat.composerDrafts.filter(item => item.threadId !== previousOwner && item.threadId !== threadId), { ...draft, threadId, text: '', attachments: [], updatedAt: Date.now() }] };
    });
  }
  async stop(): Promise<void> {
    await this.vault.wait(); const id = this.current().activeThreadId;
    if (id && this.owns(id)) await this.engine.stop(id);
  }
  async activate(rawId: unknown, rawRevision: unknown): Promise<string> {
    const id = composerDraftSchema.shape.threadId.parse(rawId), revision = z.uuid().parse(rawRevision), nextRevision = randomUUID();
    await this.vault.commitQuickChat(state => {
      if (state.quickChat?.revision !== revision) throw new Error('Quick chat changed. Reload it before starting another chat.');
      if (id && !this.vault.hasPersistentThread(id)) throw new Error('Choose an existing saved conversation for quick chat.');
      state.quickChat = { ...state.quickChat, revision: nextRevision, activeThreadId: id };
    });
    return nextRevision;
  }
  owns(threadId: string): boolean { return this.vault.quickChat()?.activeThreadId === threadId && this.vault.hasPersistentThread(threadId); }
  assertOriginal(raw: unknown): DocumentOriginal {
    const reference = documentOriginalSchema.parse(raw), current = this.current(), draft = this.normalized(current);
    const thread = draft.threadId ? this.vault.thread(draft.threadId) : undefined;
    if (!documentOriginalReferences({ threads: thread ? [thread] : [], composerDrafts: [draft], notes: [] }).some(item => item.sha256 === reference.sha256 && item.bytes === reference.bytes && item.mimeType === reference.mimeType)) {
      throw new Error('This document does not belong to the current quick chat.');
    }
    return reference;
  }
}
