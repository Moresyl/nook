import type { Provider } from '../../contracts/workspace';
import { modelRequest, providerProtocol, ReplyCollector, type ModelInput, type ModelReply } from './model-protocol';
import { modelDestination, modelInfoSchema, type ModelInfo, type TokenUsage } from '../../contracts/models';
import { attachmentLimits } from '../../contracts/attachments';
import { embeddingRequest, embeddingResponse, type EmbeddingInput } from './embedding-protocol';

export type { ModelInput, ModelReply } from './model-protocol';
export type ModelGateway = { stream(input: ModelInput, onText: (text: string) => void, onUsage?: (usage: TokenUsage) => void): Promise<ModelReply | void> };

export async function* serverEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData: string[] = [];
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw new Error('The provider stream disconnected before completion. Retry the request.'); }
      const { value, done } = chunk;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length + eventData.join('\n').length > 2_000_000) throw new Error('The provider sent an oversized stream event.');
      if (done && buffer && !buffer.endsWith('\n')) buffer += '\n';
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
        if (!line) {
          if (eventData.length) { yield eventData.join('\n'); eventData = []; }
        } else if (line.startsWith('data:')) {
          eventData.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (done) { if (eventData.length) yield eventData.join('\n'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function endpoint(provider: Provider, route: string): string {
  const url = new URL(provider.endpoint);
  let path = url.pathname.replace(/\/+$/, '');
  if (provider.kind === 'azure') {
    if (provider.azureApi === 'deployment-chat') path = path.replace(/\/openai\/v1$/, '/openai');
    if (!path) path = provider.azureApi === 'deployment-chat' ? '/openai' : '/openai/v1';
  }
  const [resource, query] = route.split('?');
  url.pathname = `${path}/${resource}`;
  for (const [name, value] of new URLSearchParams(query)) url.searchParams.set(name, value);
  return url.href;
}

function headers(provider: Provider, key: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.kind === 'anthropic') Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
  else if (provider.kind === 'gemini') headers['x-goog-api-key'] = key;
  else if (provider.kind === 'azure') headers['api-key'] = key;
  else if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function responseError(status: number): Error {
  if (status === 401 || status === 403) return new Error('Provider authentication failed. Check your API key and access permissions.');
  if (status === 429) return new Error('Provider request limit reached. Wait briefly or check your account quota.');
  return new Error(`Provider returned HTTP ${status}. Check the endpoint and model, then retry.`);
}

export class HttpModelGateway implements ModelGateway {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(url: string, options: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try { response = await this.fetcher(url, { ...options, redirect: 'manual' }); }
    catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new Error('Could not connect to the provider. Check the network and endpoint, then retry.');
    }
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {});
      throw responseError(response.status);
    }
    return response;
  }

  private async json(response: Response, signal?: AbortSignal, maximumBytes = 16_000_000): Promise<Record<string, unknown>> {
    let size = 0; let text = ''; const decoder = new TextDecoder();
    if (!response.body) throw new Error('The provider returned an empty response.');
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch { throw new Error('The provider response disconnected before completion. Retry the request.'); }
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { value, done } = chunk;
        if (done) break;
        size += value.byteLength;
        if (size > maximumBytes) throw new Error('The provider sent an oversized response.');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      try {
        const result: unknown = JSON.parse(text);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        return result as Record<string, unknown>;
      } catch { throw new Error('The provider sent an invalid JSON response. Retry or check API compatibility.'); }
    } finally { signal?.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async discover(provider: Provider, key: string): Promise<string[]> {
    return (await this.discoverCatalog(provider, key)).map((model) => model.id);
  }

  async embed(input: EmbeddingInput): Promise<number[][]> {
    input.signal.throwIfAborted();
    const { route, body } = embeddingRequest(input);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]);
    const response = await this.request(endpoint(input.provider, route), { method: 'POST', headers: headers(input.provider, input.key), body: JSON.stringify(body), signal }, signal);
    return embeddingResponse(input, await this.json(response, signal, 2_000_000));
  }

  async discoverCatalog(provider: Provider, key: string): Promise<ModelInfo[]> {
    if (provider.kind === 'azure' && provider.azureApi === 'deployment-chat') throw new Error('Enter Azure deployment names manually. Deployment discovery requires Azure management credentials.');
    const signal = AbortSignal.timeout(20_000); const models = new Map<string, ModelInfo>(); const tokens = new Set<string>(); let token = '';
    for (let page = 0; page < 10; page++) {
      const url = new URL(endpoint(provider, 'models'));
      if (provider.kind === 'gemini') { url.searchParams.set('pageSize', '200'); if (token) url.searchParams.set('pageToken', token); }
      const result = await this.json(await this.request(url.href, { headers: headers(provider, key), signal }));
      const entries = provider.kind === 'gemini' ? result.models : result.data;
      if (!Array.isArray(entries)) throw new Error('The provider did not return a model list. Enter model names manually.');
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const model = entry as Record<string, unknown>;
        if (provider.kind === 'gemini' && (!Array.isArray(model.supportedGenerationMethods) || !model.supportedGenerationMethods.includes('generateContent'))) continue;
        const id = provider.kind === 'gemini' && typeof model.name === 'string' ? model.name.replace(/^models\//, '') : model.id;
        if (typeof id === 'string' && id.length > 0 && id.length <= 128 && !id.includes('\0')) {
          const info: ModelInfo = { id, source: 'service', destination: modelDestination(provider.kind, provider.endpoint) };
          if (provider.kind === 'gemini') {
            if (typeof model.thinking === 'boolean') info.supportsReasoning = model.thinking;
            for (const field of ['inputTokenLimit', 'outputTokenLimit'] as const) {
              const value = model[field]; if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000) info[field] = value;
            }
          }
          models.set(id, modelInfoSchema.parse({ ...models.get(id), ...info }));
        }
        if (models.size > 200) throw new Error('The model list exceeds 200 entries. Enter the models you want to use manually.');
      }
      if (provider.kind !== 'gemini' || !result.nextPageToken) return [...models.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (typeof result.nextPageToken !== 'string' || result.nextPageToken.length > 2048 || tokens.has(result.nextPageToken)) break;
      token = result.nextPageToken; tokens.add(token);
    }
    throw new Error('The provider returned an invalid or excessive paginated model list. Enter model names manually.');
  }

  async stream(input: ModelInput, onText: (text: string) => void, onUsage?: (usage: TokenUsage) => void): Promise<ModelReply> {
    const { provider, key, signal } = input;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const { route, body } = modelRequest(input);
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload, 'utf8') > attachmentLimits.requestBytes) throw new Error('The complete model request exceeds 16 MB. Reduce conversation history or attachments.');
    const collector = new ReplyCollector(provider.kind, onText, providerProtocol(provider), onUsage);
    const response = await this.request(endpoint(provider, route), {
      method: 'POST', headers: headers(provider, key), body: payload,
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    }, signal);
    if (!response.body) throw new Error('The provider returned an empty response.');
    if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      return collector.complete(await this.json(response, signal));
    }
    for await (const data of serverEvents(response.body)) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (data === '[DONE]') { collector.done(); break; }
      let event: unknown;
      try { event = JSON.parse(data); } catch { throw new Error('The provider sent an invalid stream. Retry or check API compatibility.'); }
      collector.accept(event);
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return collector.finish();
  }
}
