import { composerDraftSchema, type ComposerDraft, type Thread, type Workspace } from './workspace';

export function composerContent(draft: ComposerDraft): string {
  const { updatedAt: _updatedAt, ...content } = composerDraftSchema.parse(draft);
  return JSON.stringify({ ...content, knowledgeCollectionIds: content.knowledgeCollectionIds ?? [] });
}

export async function composerRevision(draft: ComposerDraft): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(composerContent(draft)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function restoreComposer(workspace: Workspace, thread?: Thread, saved?: ComposerDraft): ComposerDraft {
  const providerId = saved?.providerId ?? thread?.providerId ?? workspace.preferences.defaultProviderId;
  const provider = workspace.providers.find((item) => item.id === providerId) ?? workspace.providers.find((item) => item.id === workspace.preferences.defaultProviderId);
  const projectId = saved ? saved.projectId : thread?.projectId;
  const project = workspace.projects.find((item) => item.id === projectId);
  const assistantId = saved ? saved.assistantId : thread?.assistantId ?? 'general';
  return {
    threadId: thread?.id, text: saved?.text ?? '', attachments: saved?.attachments ?? [],
    providerId: provider?.id, model: provider?.id === providerId ? saved?.model ?? thread?.model ?? workspace.preferences.defaultModel : provider?.models[0] ?? '',
    assistantId: workspace.assistants.some((item) => item.id === assistantId) ? assistantId : undefined, projectId: project?.id,
    mode: project ? saved?.mode ?? thread?.mode ?? 'chat' : 'chat',
    mcpServerIds: (saved?.mcpServerIds ?? thread?.mcpServerIds ?? []).filter((id) => workspace.mcpServers.some((item) => item.id === id && item.enabled)),
    skillIds: (saved?.skillIds ?? thread?.skillIds ?? []).filter((id) => workspace.skills.some((item) => item.id === id && item.enabled)),
    pluginIds: (saved?.pluginIds ?? thread?.pluginIds ?? []).filter((id) => workspace.plugins.some((item) => item.id === id && item.enabled && item.grants.includes('tools') && (!item.projectIds.length || item.projectIds.includes(project?.id ?? '')))),
    knowledgeCollectionIds: (saved?.knowledgeCollectionIds ?? thread?.knowledgeCollectionIds ?? []).filter((id) => id === 'notes' || workspace.knowledgeCollections.some((item) => item.id === id)),
    updatedAt: saved?.updatedAt ?? Date.now(),
  };
}
