import type { ModelInfo } from '../../contracts/models';
import type { Provider } from '../../contracts/workspace';

export function configuredModels(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

export function configuredProvider(provider: Provider, value: string): Provider {
  const models = configuredModels(value);
  return { ...provider, models, modelCatalog: provider.modelCatalog?.filter((item) => models.includes(item.id)) };
}

export function discoveredModels(provider: Provider, catalog: ModelInfo[]): Provider {
  return { ...provider, models: catalog.map((item) => item.id), modelCatalog: catalog.map((item) => {
    const existing = provider.modelCatalog?.find((model) => model.id === item.id);
    return existing?.source === 'manual' ? existing : { ...item, maxOutputTokens: existing?.maxOutputTokens, outputParameter: existing?.outputParameter };
  }) };
}

export function setModelInfo(provider: Provider, id: string, field: keyof Omit<ModelInfo, 'id' | 'source' | 'destination'>, value: number | boolean | ModelInfo['outputParameter'] | undefined): Provider {
  const original = provider.modelCatalog?.find((item) => item.id === id) ?? { id, source: 'manual' as const };
  const model: ModelInfo = { ...original, [field]: value, ...(field === 'maxOutputTokens' || field === 'outputParameter' ? {} : { source: 'manual', destination: undefined }) };
  return { ...provider, modelCatalog: [...(provider.modelCatalog ?? []).filter((item) => item.id !== id), model] };
}
