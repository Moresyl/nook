import type { Bridge, RunEvent } from './bridge-contract';
import type { ComposerDraft, Thread, Workspace } from './workspace';

export type QuickChatContext = Pick<Workspace, 'providers' | 'preferences' | 'projects' | 'assistants' | 'mcpServers' | 'skills' | 'plugins' | 'knowledgeCollections' | 'promptTemplates'> & { hasNotes: boolean };
export type QuickChatSnapshot = { revision: string; draft: ComposerDraft; context: QuickChatContext; thread?: Thread; conversations: { id: string; title: string }[] };
export type QuickChatEvent = Omit<RunEvent, 'state'> & { thread?: Thread };
export type ContentBridge = Pick<Bridge, 'attachFiles' | 'importAttachments' | 'readDocumentOriginal' | 'exportDocumentOriginal' | 'exportAttachmentImage' | 'openExternal'>;
export type QuickChatBridge = ContentBridge & {
  load(): Promise<QuickChatSnapshot>;
  save(draft: ComposerDraft, revision: string): Promise<string>;
  send(revision: string): Promise<{ threadId: string }>;
  stop(): Promise<void>;
  activate(id: string | undefined, revision: string): Promise<string>;
  openWorkspace(settings?: boolean): Promise<void>;
  windowAction(action: 'hide' | 'pin' | 'collapse'): Promise<{ pinned: boolean; collapsed: boolean }>;
  pendingApprovals(): ReturnType<Bridge['pendingApprovals']>;
  resolveApproval(id: string, allowed: boolean): Promise<void>;
  onBeforeClose(callback: () => Promise<void>): () => void;
  onRun(callback: (event: QuickChatEvent) => void): () => void;
  onRefresh(callback: () => void): () => void;
};
declare global { interface Window { nookQuick: QuickChatBridge } }
