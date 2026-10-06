import { z } from 'zod';
import { providerSchema, type Provider, type Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';
import { modelDestination } from '../../contracts/models';

const credentialSchema = z.object({ destination: z.string(), key: z.string().max(4096) }).strict();
const credentialId = (id: string): string => `\0provider:${id}`;

export function providerDestination(provider: Provider): string {
  return modelDestination(provider.kind, provider.endpoint);
}

export function providerKey(vault: WorkspaceVault, provider: Provider): string {
  const stored = vault.key(credentialId(provider.id));
  if (stored) {
    try { const secret = credentialSchema.parse(JSON.parse(stored)); return secret.destination === providerDestination(provider) ? secret.key : ''; }
    catch { throw new Error('The saved provider credentials are invalid. Enter the API key again in settings.'); }
  }
  const previous = vault.provider(provider.id);
  return previous && providerDestination(previous) === providerDestination(provider) ? vault.key(provider.id) : '';
}

/** Bind legacy keys before restoring different configuration under an existing ID. */
export async function bindProviderKeys(vault: WorkspaceVault): Promise<void> {
  for (const provider of vault.providers()) {
    let key: string;
    try { if (vault.key(credentialId(provider.id))) continue; key = vault.key(provider.id); }
    catch { continue; }
    if (key) await vault.setKey(credentialId(provider.id), JSON.stringify({ destination: providerDestination(provider), key }));
  }
}

export class ProviderSettings {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly vault: WorkspaceVault, private readonly stop: (id: string) => Promise<void>) {}

  key(provider: Provider, rawKey?: string): string {
    return rawKey === undefined ? providerKey(this.vault, provider) : z.string().max(4096).parse(rawKey).trim();
  }

  private enqueue(operation: () => Promise<Workspace>): Promise<Workspace> {
    const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result;
  }

  save(raw: Provider, rawKey?: string): Promise<Workspace> {
    const provider = providerSchema.parse(raw); const key = rawKey === undefined ? undefined : z.string().max(4096).parse(rawKey).trim();
    return this.enqueue(async () => {
      const previous = this.vault.provider(provider.id);
      const changed = previous && (providerDestination(previous) !== providerDestination(provider) || previous.azureApi !== provider.azureApi || previous.apiVersion !== provider.apiVersion || previous.streamUsage !== provider.streamUsage || JSON.stringify(previous.modelCatalog) !== JSON.stringify(provider.modelCatalog) || JSON.stringify(previous.models) !== JSON.stringify(provider.models));
      if (changed || key !== undefined) await this.stop(provider.id);
      const rollback = this.vault.keyRollback([credentialId(provider.id), provider.id]);
      try {
        const secret = key ?? providerKey(this.vault, provider);
        await this.vault.setKey(credentialId(provider.id), secret ? JSON.stringify({ destination: providerDestination(provider), key: secret }) : '');
        await this.vault.setKey(provider.id, '');
        provider.hasKey = Boolean(secret);
        return await this.vault.updateSettings((draft) => {
          const index = draft.providers.findIndex((item) => item.id === provider.id);
          if (index < 0) draft.providers.push(provider); else draft.providers[index] = provider;
          if (!draft.preferences.defaultProviderId) { draft.preferences.defaultProviderId = provider.id; draft.preferences.defaultModel = provider.models[0] ?? ''; }
        });
      } catch (error) { await rollback(); throw error; }
    });
  }

  remove(id: string): Promise<Workspace> {
    z.string().min(1).max(128).refine((value) => !value.includes('\0'), 'Invalid provider ID').parse(id);
    return this.enqueue(async () => {
      await this.stop(id);
      const rollback = this.vault.keyRollback([credentialId(id), id]);
      try {
        await this.vault.setKey(credentialId(id), ''); await this.vault.setKey(id, '');
        return await this.vault.updateSettings((draft) => {
          draft.providers = draft.providers.filter((item) => item.id !== id);
          if (draft.preferences.defaultProviderId === id) { draft.preferences.defaultProviderId = draft.providers[0]?.id; draft.preferences.defaultModel = draft.providers[0]?.models[0] ?? ''; }
        });
      } catch (error) { await rollback(); throw error; }
    });
  }
}
