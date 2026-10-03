import type { ComposerDraft } from '../../contracts/workspace';
import { composerContent } from '../../contracts/composer';

export class ComposerDraftStore {
  private drafts = new Map<string, ComposerDraft>();
  private dirty = new Map<string, ComposerDraft>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly save: (draft: ComposerDraft) => Promise<void>) {}

  initialize(drafts: ComposerDraft[]): void {
    this.drafts = new Map(drafts.map((draft) => [draft.threadId ?? '', structuredClone(draft)]));
    this.dirty.clear();
  }
  get(threadId?: string): ComposerDraft | undefined {
    const draft = this.drafts.get(threadId ?? '');
    return draft && structuredClone(draft);
  }
  stage(draft: ComposerDraft): void {
    const copy = structuredClone(draft); const key = copy.threadId ?? '';
    this.drafts.set(key, copy); this.dirty.set(key, copy);
  }
  forget(threadId?: string): void { const key = threadId ?? ''; this.drafts.delete(key); this.dirty.delete(key); }
  consume(submitted: ComposerDraft): boolean {
    const current = this.drafts.get(submitted.threadId ?? '');
    if (!current || composerContent(current) !== composerContent(submitted)) return false;
    this.forget(submitted.threadId); return true;
  }
  flush(): Promise<void> {
    const operation = this.tail.then(async () => {
      while (this.dirty.size) {
        const [key, draft] = this.dirty.entries().next().value!;
        await this.save(structuredClone(draft));
        if (this.dirty.get(key) === draft) this.dirty.delete(key);
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
