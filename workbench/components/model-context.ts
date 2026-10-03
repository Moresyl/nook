import { modelDestination } from '../../contracts/models';
import type { Message, Provider } from '../../contracts/workspace';

export function modelContext(provider: Provider, model: string, messages: Message[]) {
  const info = provider.modelCatalog?.find((item) => item.id === model);
  const destination = modelDestination(provider.kind, provider.endpoint);
  const latest = messages.flatMap((item) => item.invocations ?? []).findLast((item) => item.providerId === provider.id && item.model === model && item.destination === destination);
  return { info, latest };
}
