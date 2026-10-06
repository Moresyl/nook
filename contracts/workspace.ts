import { z } from 'zod';
import { toolActivitySchema } from './tools';
import { editorDraftSchema } from './projects';
import { mcpServerSchema, skillSchema } from './extensions';
import { pluginSchema } from './plugins';
import { invocationSchema, modelDestination, modelInfoSchema, providerKindSchema } from './models';
import { attachmentSchema } from './attachments';
import { knowledgeCollectionSchema, knowledgeDocumentSourceSchema, knowledgeIndexSchema, knowledgeSelectionSchema, knowledgeSourcesSchema } from './knowledge';
import { automationsSchema } from './automations';
import { desktopPreferencesSchema } from './desktop-integration';
import { promptTemplatesSchema } from './prompt-templates';
import { messageDraftsSchema } from './message-edits';
import { memoriesSchema } from './memories';
export { attachmentSchema } from './attachments';

const identifier = z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Identifiers cannot contain NUL characters');
const shortText = z.string().max(512);
export const providerSchema = z.object({
  id: identifier,
  name: z.string().min(1).max(80),
  kind: providerKindSchema,
  endpoint: z.url().max(4096).refine((value) => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash; }
    catch { return false; }
  }, 'Use an HTTP or HTTPS endpoint without embedded credentials or a fragment'),
  azureApi: z.enum(['responses', 'chat', 'deployment-chat']).optional(),
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(?:-preview)?$/).optional(),
  models: z.array(z.string().min(1).max(128)).max(200),
  modelCatalog: z.array(modelInfoSchema).max(200).optional(),
  streamUsage: z.boolean().optional(),
  hasKey: z.boolean().default(false),
}).superRefine((provider, context) => {
  if (provider.modelCatalog && (new Set(provider.modelCatalog.map((model) => model.id)).size !== provider.modelCatalog.length || provider.modelCatalog.some((model) => !provider.models.includes(model.id)))) {
    context.addIssue({ code: 'custom', path: ['modelCatalog'], message: 'Model metadata must have unique IDs in the configured model list' });
  }
  if (URL.canParse(provider.endpoint) && provider.modelCatalog?.some((model) => model.source === 'service' && model.destination !== modelDestination(provider.kind, provider.endpoint))) {
    context.addIssue({ code: 'custom', path: ['modelCatalog'], message: 'Discovered model metadata belongs to a different connection' });
  }
  if (provider.kind === 'azure' && provider.azureApi === 'deployment-chat' && !provider.apiVersion) {
    context.addIssue({ code: 'custom', path: ['apiVersion'], message: 'A dated API version is required for Azure deployment Chat Completions' });
  }
  if (provider.kind !== 'azure' && (provider.azureApi || provider.apiVersion)) {
    context.addIssue({ code: 'custom', path: ['azureApi'], message: 'Azure options require an Azure connection' });
  }
});
export const messageSchema = z.object({
  id: identifier,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4_000_000),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(['complete', 'running', 'stopped', 'error']).default('complete'),
  attachments: z.array(attachmentSchema).max(12).default([]),
  error: shortText.optional(),
  activities: z.array(toolActivitySchema).max(64).optional(),
  invocations: z.array(invocationSchema).max(16).optional().refine((items) => !items || new Set(items.map((item) => item.round)).size === items.length, 'Model invocation rounds must be unique'),
  knowledgeSources: knowledgeSourcesSchema.optional(),
  replyVersion: z.object({ groupId: z.uuid(), number: z.number().int().min(1).max(10_000) }).strict().optional(),
  editedAt: z.number().int().nonnegative().optional(),
}).refine((message) => !message.replyVersion || message.role === 'assistant', 'Only assistant replies can have versions');
export const threadSchema = z.object({
  id: identifier, title: z.string().min(1).max(160),
  temporary: z.literal(true).optional(),
  branchOrder: z.number().int().min(0).max(9999).optional(),
  comparison: z.object({ groupId: z.uuid(), index: z.number().int().min(0).max(3), contextLength: z.number().int().min(0).max(4998) }).strict().optional(),
  projectId: identifier.optional(), assistantId: identifier.optional(),
  providerId: identifier.optional(), model: shortText.default(''),
  mode: z.enum(['chat', 'plan', 'agent']).optional(),
  mcpServerIds: z.array(identifier).max(8).optional(), skillIds: z.array(z.uuid()).max(20).optional(),
  pluginIds: z.array(z.uuid()).max(8).optional(),
  knowledgeCollectionIds: knowledgeSelectionSchema.optional(),
  forkedFrom: z.object({ threadId: identifier, messageId: identifier, kind: z.enum(['branch', 'edit', 'reply', 'message']) }).strict().optional(),
  pinned: z.boolean().default(false), archived: z.boolean().default(false),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  messages: z.array(messageSchema).max(5000).default([]),
});
export const projectSchema = z.object({
  id: identifier, name: z.string().min(1).max(100), path: z.string().min(1).max(4096),
  instructions: z.string().max(32_000).default(''), createdAt: z.number().int().nonnegative(),
});
export const assistantSchema = z.object({
  id: identifier, name: z.string().min(1).max(80), description: shortText,
  instructions: z.string().max(32_000),
});
export const noteSchema = z.object({
  id: identifier, title: z.string().min(1).max(160), content: z.string().max(1_000_000),
  createdAt: z.number().int().nonnegative(),
  collectionId: z.uuid().optional(), source: knowledgeDocumentSourceSchema.optional(), index: knowledgeIndexSchema.optional(),
}).superRefine((note, context) => {
  if (note.index?.chunks.some((chunk) => chunk.end > note.content.length)) context.addIssue({ code: 'custom', path: ['index'], message: 'Knowledge text ranges exceed the document' });
});
export const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  defaultProviderId: identifier.optional(), defaultModel: shortText.default(''),
  enterToSend: z.boolean().default(true),
  desktop: desktopPreferencesSchema.optional(),
});
export const settingsStateSchema = z.object({
  providers: z.array(providerSchema).max(100), preferences: preferencesSchema,
}).strict();
export const composerDraftSchema = z.object({
  threadId: identifier.optional(), text: z.string().max(256_000),
  attachments: z.array(attachmentSchema).max(12).default([]),
  providerId: identifier.optional(), model: z.string().max(128).default(''),
  assistantId: identifier.optional(), projectId: identifier.optional(),
  mode: z.enum(['chat', 'plan', 'agent']).default('chat'),
  mcpServerIds: z.array(identifier).max(8).default([]), skillIds: z.array(z.uuid()).max(20).default([]),
  pluginIds: z.array(z.uuid()).max(8).default([]), updatedAt: z.number().int().nonnegative(),
  knowledgeCollectionIds: knowledgeSelectionSchema.optional(),
}).strict();
export const composerStateSchema = z.object({
  composerDrafts: z.array(composerDraftSchema).max(100).default([]).refine((drafts) => new Set(drafts.map((draft) => draft.threadId ?? '')).size === drafts.length, 'Conversation drafts must have unique owners'),
  activeThreadId: identifier.optional(),
}).strict();
export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  providers: settingsStateSchema.shape.providers, threads: z.array(threadSchema).max(10_000),
  projects: z.array(projectSchema).max(1000), assistants: z.array(assistantSchema).max(1000),
  notes: z.array(noteSchema).max(10_000), preferences: settingsStateSchema.shape.preferences,
  editorDrafts: z.array(editorDraftSchema).max(100).default([]),
  composerDrafts: composerStateSchema.shape.composerDrafts,
  activeThreadId: composerStateSchema.shape.activeThreadId,
  mcpServers: z.array(mcpServerSchema).max(100).default([]), skills: z.array(skillSchema).max(1000).default([]),
  plugins: z.array(pluginSchema).max(100).default([]),
  automations: automationsSchema,
  promptTemplates: promptTemplatesSchema,
  messageDrafts: messageDraftsSchema,
  memories: memoriesSchema,
  knowledgeCollections: z.array(knowledgeCollectionSchema).max(64).default([]).refine((collections) => new Set(collections.map((item) => item.id)).size === collections.length, 'Knowledge collection IDs must be unique'),
}).superRefine((state, context) => {
  state.memories.forEach((memory, index) => {
    if (memory.projectId && !state.projects.some((project) => project.id === memory.projectId)) context.addIssue({ code: 'custom', path: ['memories', index, 'projectId'], message: 'A memory must belong to an existing project' });
  });
  state.messageDrafts.forEach((draft, index) => {
    if (!state.threads.find((thread) => thread.id === draft.threadId)?.messages.some((message) => message.id === draft.messageId)) context.addIssue({ code: 'custom', path: ['messageDrafts', index], message: 'Message editing drafts must refer to stored messages' });
  });
});
export const submitSchema = z.object({
  threadId: identifier.optional(), projectId: identifier.optional(), assistantId: identifier.optional(),
  providerId: identifier, model: z.string().min(1).max(128),
  text: z.string().trim().min(1).max(256_000),
  mode: z.enum(['chat', 'plan', 'agent']).optional(),
  mcpServerIds: z.array(identifier).max(8).optional(), skillIds: z.array(z.uuid()).max(20).optional(),
  pluginIds: z.array(z.uuid()).max(8).optional(),
  knowledgeCollectionIds: knowledgeSelectionSchema.optional(),
  attachments: z.array(attachmentSchema).max(12).default([]),
  composerRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  replay: z.object({ messageId: identifier, revision: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['edit', 'retry']) }).strict().optional(),
}).superRefine((request, context) => {
  if (request.replay && !request.threadId) context.addIssue({ code: 'custom', path: ['threadId'], message: 'A replay requires an existing conversation' });
  if (request.replay && request.composerRevision) context.addIssue({ code: 'custom', path: ['composerRevision'], message: 'A replay cannot consume a composer draft' });
});
export type Provider = z.infer<typeof providerSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Assistant = z.infer<typeof assistantSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type SubmitRequest = z.infer<typeof submitSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type ComposerDraft = z.infer<typeof composerDraftSchema>;

export function emptyWorkspace(): Workspace {
  return {
    schemaVersion: 1, providers: [], threads: [], projects: [], notes: [], editorDrafts: [], composerDrafts: [], messageDrafts: [], memories: [], mcpServers: [], skills: [], plugins: [], knowledgeCollections: [], automations: [], promptTemplates: [],
    assistants: [
      { id: 'general', name: '通用助手', description: '梳理想法，完成日常工作', instructions: 'Be clear, accurate and helpful. Respond in the language the user uses.' },
      { id: 'developer', name: '代码伙伴', description: '理解项目，设计和检查代码', instructions: 'You are a careful software engineer. Inspect evidence, explain tradeoffs, write maintainable code and verify changes.' },
      { id: 'writer', name: '写作搭档', description: '从初稿到清晰的表达', instructions: 'Help the user write clear, natural prose. Preserve their voice and intent. Avoid unsupported claims.' },
    ],
    preferences: { theme: 'system', defaultModel: '', enterToSend: true },
  };
}

export function searchThreads(threads: Thread[], query: string): Thread[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return threads.filter((thread) => {
    if (!terms.length) return true;
    const corpus = `${thread.title}\n${thread.messages.map((message) => message.content).join('\n')}`.toLocaleLowerCase();
    return terms.every((term) => corpus.includes(term));
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export function threadMarkdown(thread: Thread): string {
  const sections = thread.messages.map((message) => `## ${message.role === 'user' ? 'You' : 'Nook'}\n\n${message.content}${message.attachments.length ? `\n\nAttachments: ${message.attachments.map((file) => file.name).join(', ')}` : ''}`);
  return `# ${thread.title}\n\n${sections.join('\n\n---\n\n')}\n`;
}
