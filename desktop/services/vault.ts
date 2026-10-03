import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyWorkspace, workspaceSchema, type Workspace } from '../../contracts/workspace';
import { atomicJson } from './atomic-json';
import { bindProviderKeys, providerKey } from './provider-settings';
import { interruptRuns } from './interrupted-runs';

export type SecretCodec = { seal(value: string): string; open(value: string): string };

export class WorkspaceVault {
  private state = emptyWorkspace();
  private keys: Record<string, string> = {};
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string, private readonly codec: SecretCodec) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      const raw = await readFile(join(this.directory, 'workspace.json'), 'utf8');
      this.state = workspaceSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Workspace data could not be read. Restore a valid backup before continuing.');
      }
    }
    try {
      const stored: unknown = JSON.parse(await readFile(join(this.directory, 'credentials.json'), 'utf8'));
      if (!stored || typeof stored !== 'object' || Array.isArray(stored) || Object.values(stored).some((value) => typeof value !== 'string')) {
        throw new Error('Invalid credential store');
      }
      this.keys = stored as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Saved credentials could not be read. Recover the credential store before continuing.');
      }
    }
    await bindProviderKeys(this);
    for (const provider of this.state.providers) {
      try { provider.hasKey = Boolean(providerKey(this, provider)); }
      catch { provider.hasKey = false; }
    }
    for (const server of this.state.mcpServers) server.hasCredentials = Boolean(this.keys[`\0mcp:${server.id}`]);
    if (interruptRuns(this.state.threads)) await this.update(() => {});
  }

  snapshot(): Workspace { return structuredClone(this.state); }
  async flush(): Promise<void> { await this.tail; }

  update(change: (draft: Workspace) => void): Promise<Workspace> {
    const operation = this.tail.then(async () => {
      const draft = this.snapshot();
      change(draft);
      const next = workspaceSchema.parse(draft);
      await atomicJson(join(this.directory, 'workspace.backup.json'), this.state);
      await atomicJson(join(this.directory, 'workspace.json'), next);
      this.state = next;
      return this.snapshot();
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  key(providerId: string): string {
    const encrypted = Object.hasOwn(this.keys, providerId) ? this.keys[providerId] : undefined;
    if (!encrypted) return '';
    try { return this.codec.open(encrypted); }
    catch { throw new Error('The system could not decrypt this provider key. Enter it again in settings.'); }
  }

  setKey(providerId: string, key: string): Promise<void> {
    return this.updateKeys((next) => {
      if (key) next[providerId] = this.codec.seal(key);
      else delete next[providerId];
    });
  }

  /** Capture sealed records so replacement can recover an unreadable old key. */
  keyRollback(ids: string[]): () => Promise<void> {
    const previous = new Map(ids.map((id) => [id, Object.hasOwn(this.keys, id) ? this.keys[id] : undefined]));
    return () => this.updateKeys((next) => {
      for (const [id, value] of previous) { if (value === undefined) delete next[id]; else next[id] = value; }
    });
  }

  private updateKeys(change: (next: Record<string, string>) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      const next: Record<string, string> = Object.assign(Object.create(null), this.keys);
      change(next);
      await atomicJson(join(this.directory, 'credentials.json'), next);
      this.keys = next;
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  backup(): Workspace {
    const snapshot = this.snapshot();
    snapshot.providers.forEach((provider) => { provider.hasKey = false; });
    snapshot.mcpServers.forEach((server) => { server.hasCredentials = false; server.autoConnect = false; });
    return snapshot;
  }
}
