import type { MessageDraft } from '../../contracts/message-edits';

export class MessageDraftBuffer {
  private draft: MessageDraft;
  private dirty?: MessageDraft;
  private tail: Promise<void> = Promise.resolve();
  constructor(draft: MessageDraft, private readonly save: (draft: MessageDraft) => Promise<void>, private readonly remove: () => Promise<void>) { this.draft = structuredClone(draft); }
  get(): MessageDraft { return structuredClone(this.draft); }
  stage(content: string): void { this.draft = { ...this.draft, content, updatedAt: Date.now() }; this.dirty = this.draft; }
  flush(): Promise<void> {
    const operation = this.tail.then(async () => {
      while (this.dirty) { const draft = this.dirty; await this.save(structuredClone(draft)); if (this.dirty === draft) this.dirty = undefined; }
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  consume(): void { this.dirty = undefined; }
  discard(): Promise<void> {
    const operation = this.tail.then(async () => { await this.remove(); this.dirty = undefined; });
    this.tail = operation.catch(() => {}); return operation;
  }
}
