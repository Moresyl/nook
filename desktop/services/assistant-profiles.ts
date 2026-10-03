import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assistantProfileLimits, parseAssistantBundle, type AssistantBundle } from '../../contracts/assistant-profiles';
import { assistantSchema } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';
import { WorkspaceBackupFiles } from './backup-files';

export class AssistantProfiles {
  private readonly files = new WorkspaceBackupFiles({ textBytes: assistantProfileLimits.bytes, compressedBytes: assistantProfileLimits.bytes });
  constructor(private readonly vault: WorkspaceVault) {}

  save(raw: unknown) {
    const assistant = assistantSchema.parse(raw); assistant.name = z.string().trim().min(1).max(80).parse(assistant.name);
    return this.vault.update((draft) => {
      const index = draft.assistants.findIndex((item) => item.id === assistant.id);
      if (index < 0) draft.assistants.push(assistant); else draft.assistants[index] = assistant;
    });
  }
  remove(raw: unknown) {
    const id = assistantSchema.shape.id.parse(raw);
    return this.vault.update((draft) => {
      if (!draft.assistants.some((item) => item.id === id)) throw new Error('This assistant no longer exists. Refresh the assistant list.');
      draft.assistants = draft.assistants.filter((item) => item.id !== id);
      for (const item of [...draft.threads, ...draft.composerDrafts, ...draft.automations]) if (item.assistantId === id) delete item.assistantId;
      for (const template of draft.promptTemplates) if (template.assistantId === id) delete template.assistantId;
    });
  }
  bundle(rawIds?: unknown): AssistantBundle {
    const ids = z.array(assistantSchema.shape.id).min(1).max(assistantProfileLimits.count).refine((items) => new Set(items).size === items.length, 'Select each assistant only once').optional().parse(rawIds);
    const available = this.vault.snapshot().assistants;
    const selected = ids ? ids.map((id) => { const item = available.find((assistant) => assistant.id === id); if (!item) throw new Error('A selected assistant no longer exists. Refresh the assistant list.'); return item; }) : available;
    return parseAssistantBundle({ format: 'qiyao-assistants', version: 1, assistants: selected.map(({ name, description, instructions }) => ({ name, description, instructions })) });
  }
  import(raw: unknown) {
    const bundle = parseAssistantBundle(raw);
    return this.vault.update((draft) => {
      if (draft.assistants.length + bundle.assistants.length > assistantProfileLimits.count) throw new Error('The workspace already has too many assistants. Remove unused profiles before importing.');
      draft.assistants.push(...bundle.assistants.map((profile) => ({ ...profile, id: randomUUID() })));
    });
  }
  async read(path: string): Promise<AssistantBundle> {
    try { return parseAssistantBundle(await this.files.read(path)); }
    catch { throw new Error('The assistant file could not be read. Choose a complete Qiyao JSON or gzip JSON file no larger than 4 MB.'); }
  }
  async write(path: string, bundle: AssistantBundle): Promise<void> {
    const parsed = parseAssistantBundle(bundle);
    try { await this.files.write(path, parsed); }
    catch { throw new Error('Assistant profiles could not be saved. Check disk space and directory permissions, or choose fewer assistants.'); }
  }
  shutdown(): Promise<void> { return this.files.shutdown(); }
}
