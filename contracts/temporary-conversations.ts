import { workspaceSchema, type Workspace } from './workspace';

/** Keep temporary conversation data in memory, including its editing and composer drafts. */
export function persistentWorkspace(state: Workspace, previousActiveThreadId?: string): Workspace {
  const temporaryIds = new Set(state.threads.filter((thread) => thread.temporary).map((thread) => thread.id));
  if (!temporaryIds.size) return state;
  const threads = state.threads.filter((thread) => !temporaryIds.has(thread.id));
  const activeThreadId = temporaryIds.has(state.activeThreadId ?? '')
    ? threads.some((thread) => thread.id === previousActiveThreadId) ? previousActiveThreadId : undefined
    : state.activeThreadId;
  return {
    ...state, threads, activeThreadId,
    composerDrafts: state.composerDrafts.filter((draft) => !temporaryIds.has(draft.threadId ?? '')),
    messageDrafts: state.messageDrafts.filter((draft) => !temporaryIds.has(draft.threadId)),
  };
}

export function parsePersistentWorkspace(raw: unknown): Workspace {
  const state = workspaceSchema.parse(raw);
  if (state.threads.some((thread) => thread.temporary)) throw new Error('Temporary conversations cannot be restored from a workspace file. Choose a complete Nook backup.');
  return state;
}
