import { promptTemplateSchema } from '../../contracts/prompt-templates';
import type { WorkspaceVault } from './vault';

export class PromptTemplates {
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
}
