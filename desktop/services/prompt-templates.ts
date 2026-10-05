import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assistantProfileLimits } from '../../contracts/assistant-profiles';
import { parsePromptBundle, type PromptBundle } from '../../contracts/prompt-bundles';
import { promptTemplateLimits, promptTemplateSchema } from '../../contracts/prompt-templates';
import type { WorkspaceVault } from './vault';
import { WorkspaceBackupFiles } from './backup-files';

export class PromptTemplates {
  private readonly files = new WorkspaceBackupFiles({ textBytes: promptTemplateLimits.bytes, compressedBytes: promptTemplateLimits.bytes });
  constructor(private readonly vault: WorkspaceVault) {}
  save(raw: unknown) {
    const template = promptTemplateSchema.parse(raw);
    return this.vault.update((draft) => {
      if (template.assistantId && !draft.assistants.some((item) => item.id === template.assistantId)) {
        throw new Error('The linked assistant no longer exists. Choose an available assistant before saving this template.');
      }
      const index = draft.promptTemplates.findIndex((item) => item.id === template.id);
      if (index < 0) draft.promptTemplates.push(template); else draft.promptTemplates[index] = template;
    });
  }
  remove(raw: unknown) {
    const id = promptTemplateSchema.shape.id.parse(raw);
    return this.vault.update((draft) => {
      if (!draft.promptTemplates.some((item) => item.id === id)) throw new Error('This prompt template no longer exists. Refresh the template list.');
      draft.promptTemplates = draft.promptTemplates.filter((item) => item.id !== id);
    });
  }
  bundle(rawIds?: unknown): PromptBundle {
    const ids = z.array(promptTemplateSchema.shape.id).min(1).max(promptTemplateLimits.count).refine((items) => new Set(items).size === items.length, 'Select each template only once').optional().parse(rawIds);
    const state = this.vault.snapshot();
    const selected = ids ? ids.map((id) => { const template = state.promptTemplates.find((item) => item.id === id); if (!template) throw new Error('A selected prompt template no longer exists. Refresh the template list.'); return template; }) : state.promptTemplates;
    const assistants: PromptBundle['assistants'] = []; const indexes = new Map<string, number>();
    const templates = selected.map(({ id: _id, assistantId, ...template }) => {
      if (!assistantId) return template;
      if (!indexes.has(assistantId)) {
        const profile = state.assistants.find((item) => item.id === assistantId);
        if (!profile) throw new Error('A linked assistant no longer exists. Refresh the template list before exporting.');
        indexes.set(assistantId, assistants.length); assistants.push({ name: profile.name, description: profile.description, instructions: profile.instructions });
      }
      return { ...template, assistantIndex: indexes.get(assistantId)! };
    });
    return parsePromptBundle({ format: 'qiyao-prompt-templates', version: 1, templates, assistants });
  }
  import(raw: unknown) {
    const bundle = parsePromptBundle(raw);
    return this.vault.update((draft) => {
      if (draft.promptTemplates.length + bundle.templates.length > promptTemplateLimits.count) throw new Error('The workspace already has too many prompt templates. Remove unused templates before importing.');
      if (draft.assistants.length + bundle.assistants.length > assistantProfileLimits.count) throw new Error('The workspace already has too many assistants. Remove unused profiles before importing.');
      const assistants = bundle.assistants.map((profile) => ({ ...profile, id: randomUUID() }));
      const templates = bundle.templates.map(({ assistantIndex, ...template }) => ({ ...template, id: randomUUID(), ...(assistantIndex === undefined ? {} : { assistantId: assistants[assistantIndex].id }) }));
      draft.assistants.push(...assistants); draft.promptTemplates.push(...templates);
    });
  }
  async read(path: string): Promise<PromptBundle> {
    try { return parsePromptBundle(await this.files.read(path)); }
    catch { throw new Error('The prompt template file could not be read. Choose a complete Nook JSON or gzip JSON file no larger than 4 MB.'); }
  }
  async write(path: string, bundle: PromptBundle): Promise<void> {
    const parsed = parsePromptBundle(bundle);
    try { await this.files.write(path, parsed); }
    catch { throw new Error('Prompt templates could not be saved. Check disk space and directory permissions, or export fewer templates.'); }
  }
  shutdown(): Promise<void> { return this.files.shutdown(); }
}
