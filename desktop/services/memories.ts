import { memorySchema } from '../../contracts/memories';
import type { WorkspaceVault } from './vault';

export class Memories {
  constructor(private readonly vault: WorkspaceVault) {}

  save(raw: unknown) {
    const memory = memorySchema.parse(raw);
    return this.vault.update((draft) => {
      if (memory.projectId && !draft.projects.some((item) => item.id === memory.projectId)) throw new Error('The selected project no longer exists. Choose an available memory scope.');
      const index = draft.memories.findIndex((item) => item.id === memory.id);
      if (index < 0) draft.memories.push(memory); else draft.memories[index] = memory;
    });
  }

  remove(raw: unknown) {
    const id = memorySchema.shape.id.parse(raw);
    return this.vault.update((draft) => {
      if (!draft.memories.some((item) => item.id === id)) throw new Error('This memory no longer exists. Refresh the memory list.');
      draft.memories = draft.memories.filter((item) => item.id !== id);
    });
  }
}
