import type { AutomationRunner } from './automations';
import type { ConversationEngine } from './conversation-engine';
import type { WorkspaceVault } from './vault';

export function conversationAutomationRunner(engine: ConversationEngine, vault: WorkspaceVault): AutomationRunner {
  return async (task, signal, onThread) => {
    signal.throwIfAborted(); const { threadId } = await engine.start({ ...task, text: task.prompt, attachments: [] });
    const stop = () => { void engine.stop(threadId).catch(() => {}); }; signal.addEventListener('abort', stop, { once: true });
    try {
      if (signal.aborted) stop();
      await onThread(threadId); await engine.settle(threadId);
      const status = vault.snapshot().threads.find((thread) => thread.id === threadId)?.messages.at(-1)?.status;
      return status === 'complete' ? 'complete' : status === 'stopped' ? 'stopped' : 'error';
    } finally { signal.removeEventListener('abort', stop); if (engine.active(threadId)) await engine.stop(threadId); }
  };
}
