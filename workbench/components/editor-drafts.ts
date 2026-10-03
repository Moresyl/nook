import type { EditorDraft } from '../../contracts/projects';

const active = new Map<string, () => Promise<void>>();
const pending = new Map<Promise<void>, string>();
export function persistEditorDraft(draft: EditorDraft): Promise<void> {
  const operation = window.qiyao.saveEditorDraft(draft);
  pending.set(operation, draft.projectId);
  void operation.finally(() => pending.delete(operation)).catch(() => {});
  return operation;
}
export function registerEditorDrafts(projectId: string, flush: () => Promise<void>): () => void {
  active.set(projectId, flush);
  return () => { if (active.get(projectId) === flush) active.delete(projectId); };
}
export async function flushEditorDrafts(projectId?: string): Promise<void> {
  await Promise.all([...active].filter(([id]) => projectId === undefined || id === projectId).map(([, flush]) => flush()));
  await Promise.all([...pending].filter(([, id]) => projectId === undefined || id === projectId).map(([operation]) => operation));
}
