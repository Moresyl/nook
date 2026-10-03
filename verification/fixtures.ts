import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider, SubmitRequest, Thread } from '../contracts/workspace';
import { WorkspaceVault, type SecretCodec } from '../desktop/services/vault';

export const provider: Provider = { id: 'local', name: 'Local', kind: 'ollama', endpoint: 'http://localhost:11434/v1', models: ['test-model'], hasKey: false };
export const request: SubmitRequest = { providerId: provider.id, model: 'test-model', text: 'Hello', attachments: [] };
export const codec: SecretCodec = { seal: (value) => `encrypted:${Buffer.from(value).toString('base64')}`, open: (value) => Buffer.from(value.slice(10), 'base64').toString() };
export function sampleThread(overrides: Partial<Thread> = {}): Thread {
  return { id: 'thread', title: 'A conversation', model: 'test-model', pinned: false, archived: false, createdAt: 1, updatedAt: 2, messages: [], ...overrides };
}
export async function testVault() {
  const directory = await mkdtemp(join(tmpdir(), 'qiyao-verification-'));
  const vault = new WorkspaceVault(directory, codec);
  await vault.initialize();
  await vault.update((draft) => { draft.providers.push({ ...provider }); });
  return { directory, vault };
}
