import { embeddingSettingsSchema, type EmbeddingSettings } from '../../contracts/knowledge';
import { providerSchema, type Provider } from '../../contracts/workspace';
import { normalizedVector } from './knowledge-text';

export type EmbeddingInput = { provider: Provider; key: string; settings: EmbeddingSettings; texts: string[]; purpose: 'document' | 'query'; title?: string; signal: AbortSignal };
export interface EmbeddingGateway { embed(input: EmbeddingInput): Promise<number[][]> }
export function embeddingRequest(input: EmbeddingInput): { route: string; body: Record<string, unknown> } {
  const provider = providerSchema.parse(input.provider); const settings = embeddingSettingsSchema.parse(input.settings);
  if (settings.providerId !== provider.id || provider.kind === 'anthropic') throw new Error('Choose an embedding-capable connection. Anthropic has no native embeddings endpoint.');
  if (!input.texts.length || input.texts.length > 16 || input.texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 2000) || input.title && input.title.length > 160) throw new Error('Embed between 1 and 16 nonempty text chunks of at most 2,000 characters.');
  if (provider.kind === 'gemini') {
    const model = settings.model.replace(/^models\//, '');
    return { route: `models/${encodeURIComponent(model)}:batchEmbedContents`, body: { requests: input.texts.map((text) => {
      const content = settings.geminiTask === 'instruction' ? input.purpose === 'query' ? `task: search result | query: ${text}` : `title: ${input.title || 'none'} | text: ${text}` : text;
      const embedContentConfig: Record<string, unknown> = {};
      if (settings.dimensions) embedContentConfig.outputDimensionality = settings.dimensions;
      if (settings.geminiTask === 'task-type') { embedContentConfig.taskType = input.purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'; if (input.purpose === 'document' && input.title) embedContentConfig.title = input.title; }
      return { model: `models/${model}`, content: { parts: [{ text: content }] }, ...(Object.keys(embedContentConfig).length ? { embedContentConfig } : {}) };
    }) } };
  }
  const route = provider.kind === 'azure' && provider.azureApi === 'deployment-chat' ? `deployments/${encodeURIComponent(settings.model)}/embeddings?api-version=${encodeURIComponent(provider.apiVersion!)}` : 'embeddings';
  return { route, body: { model: settings.model, input: input.texts, encoding_format: 'float', ...(settings.dimensions ? { dimensions: settings.dimensions } : {}) } };
}
export function embeddingResponse(input: EmbeddingInput, response: Record<string, unknown>): number[][] {
  embeddingRequest(input);
  const invalid = () => new Error('The embedding service returned an invalid batch. Check API compatibility and rebuild the index.');
  let values: unknown[];
  if (input.provider.kind === 'gemini') {
    if (!Array.isArray(response.embeddings) || response.embeddings.length !== input.texts.length) throw invalid();
    values = response.embeddings.map((item) => item && typeof item === 'object' ? (item as Record<string, unknown>).values : undefined);
  } else {
    if (!Array.isArray(response.data) || response.data.length !== input.texts.length) throw invalid();
    const entries = response.data as Record<string, unknown>[];
    if (entries.some((item) => !item || !Number.isInteger(item.index) || Number(item.index) < 0 || Number(item.index) >= input.texts.length) || new Set(entries.map((item) => item.index)).size !== entries.length) throw invalid();
    values = [...entries].sort((a, b) => Number(a.index) - Number(b.index)).map((item) => item.embedding);
  }
  const vectors = values.map((value) => normalizedVector(value, input.settings.dimensions));
  if (vectors.some((vector) => vector.length !== vectors[0].length)) throw invalid();
  return vectors;
}
