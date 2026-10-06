import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { composerStateSchema, emptyWorkspace, quickChatStateSchema, settingsStateSchema, workspaceSchema, type Message, type Preferences, type Project, type Provider, type QuickChatState, type Thread, type Workspace } from '../../contracts/workspace';
import type { McpServer } from '../../contracts/extensions';
import type { QuickChatContext } from '../../contracts/quick-chat';
import { parsePersistentWorkspace, persistentWorkspace } from '../../contracts/temporary-conversations';
import { atomicJson } from './atomic-json';
import { atomicFile } from './atomic-file';
import { writeWorkspaceRecovery } from './workspace-recovery-file';
import { bindProviderKeys, providerKey } from './provider-settings';
import { interruptRuns } from './interrupted-runs';
import { sameThreadEncoding, WorkspaceSerialization } from './workspace-serialization';
import { WorkspaceCheckpointJournal } from './workspace-checkpoint-journal';
import type { DocumentOriginal } from '../../contracts/document-originals';
import { DocumentOriginalStore } from './document-original-store';
import { DocumentOriginalSession } from './document-original-session';
import { documentOriginalReferences } from './document-original-references';
import { validateDocumentOriginalBundles, type DocumentOriginalBundle } from './document-original-backups';

export type SecretCodec = { seal(value: string): string; open(value: string): string };
export type SettingsTransaction = Pick<Workspace, 'providers' | 'preferences'>;
export type ComposerTransaction = Pick<Workspace, 'composerDrafts' | 'activeThreadId'> & {
  readonly threads: ReadonlyArray<Readonly<{ id: string }>>;
  readonly assistants: ReadonlyArray<Readonly<{ id: string }>>;
};

export class WorkspaceVault {
  private state = emptyWorkspace();
  private keys: Record<string, string> = {};
  private tail: Promise<unknown> = Promise.resolve();
  private persistentActiveThreadId?: string;
  private persistentBytes?: Buffer;
  private readonly serialization = new WorkspaceSerialization();
  private readonly checkpoints: WorkspaceCheckpointJournal;
  private readonly originals: DocumentOriginalSession;
  private readonly originalStore: DocumentOriginalStore;

  constructor(private readonly directory: string, private readonly codec: SecretCodec) {
    this.checkpoints = new WorkspaceCheckpointJournal(directory);
    this.originalStore = new DocumentOriginalStore(join(directory, 'document-originals'));
    this.originals = new DocumentOriginalSession(this.originalStore);
  }

  async initialize(onPhase: (phase: string) => void = () => {}): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    onPhase('workspace.read');
    let primaryText: string | undefined;
    try {
      const file = await open(join(this.directory, 'workspace.json'), 'r');
      let bytes: Buffer;
      try {
        onPhase('workspace.opened');
        bytes = await file.readFile();
        onPhase('workspace.bytes-read');
      } finally {
        try { onPhase('workspace.closing'); }
        finally { await file.close(); }
      }
      onPhase('workspace.loaded');
      const raw = bytes.toString('utf8');
      onPhase('workspace.text-decoded');
      const decoded: unknown = JSON.parse(raw);
      onPhase('workspace.decoded');
      this.state = parsePersistentWorkspace(decoded);
      onPhase('workspace.validated');
      primaryText = raw;
      this.persistentActiveThreadId = this.state.activeThreadId;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error('Workspace data could not be read. Restore a valid backup before continuing.');
      }
    }
    onPhase('checkpoints.restore');
    this.state = await this.checkpoints.restore(this.state, primaryText);
    onPhase('workspace.parsed');
    onPhase('credentials.read');
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
    onPhase('credentials.bound');
    for (const provider of this.state.providers) {
      try { provider.hasKey = Boolean(providerKey(this, provider)); }
      catch { provider.hasKey = false; }
    }
    for (const server of this.state.mcpServers) server.hasCredentials = Boolean(this.keys[`\0mcp:${server.id}`]);
    onPhase('persistent-cache.serialize');
    this.persistentBytes = this.serialization.serialize(persistentWorkspace(this.state, this.persistentActiveThreadId));
    onPhase('persistent-cache.ready');
    if (interruptRuns(this.state.threads)) await this.update(() => {});
    onPhase('runs.recovered');
  }

  snapshot(): Workspace { return structuredClone(this.state); }
  stageDocumentOriginals(bytes: Uint8Array[]): DocumentOriginal[] { return this.originals.stage(bytes); }

  /** Resolve ownership in transaction order without cloning complete conversation histories. */
  readDocumentOriginal(reference: DocumentOriginal, signal?: AbortSignal): Promise<Buffer> {
    const captured = { ...reference };
    const operation = this.tail.then(() => this.originals.read(captured, documentOriginalReferences(this.state), signal));
    this.tail = operation.catch(() => {});
    return operation;
  }
  provider(id: string): Provider | undefined {
    const provider = this.state.providers.find(item => item.id === id);
    return provider ? structuredClone(provider) : undefined;
  }
  providers(): Provider[] { return structuredClone(this.state.providers); }
  preferences(): Preferences { return structuredClone(this.state.preferences); }
  thread(id: string): Thread | undefined {
    const thread = this.state.threads.find(item => item.id === id);
    return thread ? structuredClone(thread) : undefined;
  }
  hasPersistentThread(id: string): boolean { return this.state.threads.some(thread => thread.id === id && !thread.temporary); }
  conversationChoices(): { id: string; title: string }[] {
    return this.state.threads.filter(thread => !thread.temporary && !thread.archived).sort((one, two) => two.updatedAt - one.updatedAt).slice(0, 100).map(({ id, title }) => ({ id, title }));
  }
  project(id: string): Project | undefined {
    const project = this.state.projects.find((item) => item.id === id);
    return project ? structuredClone(project) : undefined;
  }
  mcpServer(id: string): McpServer | undefined {
    const server = this.state.mcpServers.find((item) => item.id === id);
    return server ? structuredClone(server) : undefined;
  }
  mcpServers(): McpServer[] { return structuredClone(this.state.mcpServers); }
  automations(): Workspace['automations'] { return structuredClone(this.state.automations); }
  quickChat(): QuickChatState | undefined { return this.state.quickChat && structuredClone(this.state.quickChat); }
  composerContext(): QuickChatContext {
    const { providers, preferences, projects, assistants, mcpServers, skills, plugins, knowledgeCollections, promptTemplates, notes } = this.state;
    return structuredClone({ providers, preferences, projects, assistants, mcpServers, skills, plugins, knowledgeCollections, promptTemplates, hasNotes: notes.length > 0 });
  }
  async wait(): Promise<void> { await this.tail; }
  async flush(): Promise<void> {
    const operation = this.tail.then(async () => {
      if (!this.checkpoints.pending) return;
      const bytes = this.persistentBytes!;
      await atomicFile(join(this.directory, 'workspace.json'), file => file.writeFile(bytes));
      await this.checkpoints.reset(bytes);
    });
    this.tail = operation.catch(() => {}); await operation;
  }

  update(change: (draft: Workspace) => void, options?: { conversation: boolean }): Promise<Workspace> {
    return this.save(change, undefined, options?.conversation).then(state => structuredClone(state));
  }

  /** Persist a transaction whose caller only needs durable acknowledgement. */
  async commit(change: (draft: Workspace) => void, options?: { conversation: boolean }): Promise<void> {
    await this.save(change, undefined, options?.conversation);
  }

  /** Configuration changes preserve validated histories and return the complete detached state. */
  updateSettings(change: (draft: SettingsTransaction) => void): Promise<Workspace> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone({ providers: this.state.providers, preferences: this.state.preferences });
      change(draft);
      const settings = settingsStateSchema.parse({ providers: draft.providers, preferences: draft.preferences });
      return this.persist({ ...this.state, ...settings });
    });
    this.tail = operation.catch(() => {});
    return operation.then(state => structuredClone(state));
  }

  /** Draft-only mutations share validated histories but never expose them to the callback. */
  async commitComposer(change: (draft: ComposerTransaction) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      const draft: ComposerTransaction = {
        ...structuredClone({ composerDrafts: this.state.composerDrafts, activeThreadId: this.state.activeThreadId }),
        threads: this.state.threads.map(({ id }) => ({ id })), assistants: this.state.assistants.map(({ id }) => ({ id })),
      };
      change(draft);
      const composer = composerStateSchema.parse({ composerDrafts: draft.composerDrafts, activeThreadId: draft.activeThreadId });
      const merged = { ...this.state, ...composer };
      // Keep the same canonical property order as full workspace validation.
      const next = Object.fromEntries(Object.keys(workspaceSchema.shape).filter(key => Object.hasOwn(merged, key)).map(key => [key, merged[key as keyof Workspace]])) as Workspace;
      await this.persist(next, undefined, true);
    });
    this.tail = operation.catch(() => {});
    await operation;
  }

  /** A quick-chat draft has its own owner and never exposes regular drafts or histories. */
  async commitQuickChat(change: (draft: { quickChat?: QuickChatState }) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      const draft = { quickChat: this.quickChat() }; change(draft);
      const quickChat = draft.quickChat === undefined ? undefined : quickChatStateSchema.parse(draft.quickChat);
      const merged = { ...this.state, quickChat };
      const next = Object.fromEntries(Object.keys(workspaceSchema.shape).filter(key => Object.hasOwn(merged, key)).map(key => [key, merged[key as keyof Workspace]])) as Workspace;
      await this.persist(next);
    });
    this.tail = operation.catch(() => {}); await operation;
  }

  checkpointMessages(entries: { threadId: string; message: Message }[]): Promise<Workspace> {
    const captured = entries.map(({ threadId, message }) => ({ threadId, message }));
    return this.save(draft => {
      const now = Date.now();
      for (const entry of captured) {
        const target = draft.threads.find(thread => thread.id === entry.threadId);
        const index = target?.messages.findIndex(message => message.id === entry.message.id) ?? -1;
        if (target && index >= 0) { target.messages[index] = structuredClone(entry.message); target.updatedAt = now; }
      }
    }, captured.map(entry => entry.threadId)).then(state => structuredClone(state));
  }

  private save(change: (draft: Workspace) => void, checkpointIds?: string[], conversation = false): Promise<Workspace> {
    const operation = this.tail.then(async () => {
      const draft = this.snapshot();
      change(draft);
      const next = workspaceSchema.parse(draft);
      return this.persist(next, checkpointIds, conversation);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async persist(next: Workspace, checkpointIds?: string[], conversation = false): Promise<Workspace> {
    const persistent = persistentWorkspace(next, this.persistentActiveThreadId);
    const previous = persistentWorkspace(this.state, this.persistentActiveThreadId);
    const previousBytes = this.persistentBytes ?? this.serialization.serialize(previous);
    const nextBytes = this.serialization.serialize(persistent);
    const liveOriginals = documentOriginalReferences(next);
    const savedOriginals = documentOriginalReferences(persistent);
    await this.originals.prepare(savedOriginals, documentOriginalReferences(previous));
    if (!previousBytes.equals(nextBytes)) {
      let ids = checkpointIds;
      let includeComposer = false;
      if (conversation) {
        const { threads: oldThreads, composerDrafts: oldDrafts, activeThreadId: oldActive, ...oldHeader } = previous;
        const { threads, composerDrafts, activeThreadId, ...header } = persistent;
        if (isDeepStrictEqual(oldHeader, header) && oldThreads.length === threads.length && threads.every((thread, index) => thread.id === oldThreads[index].id)) {
          ids = threads.filter((thread, index) => !sameThreadEncoding(thread, oldThreads[index])).map(thread => thread.id);
          includeComposer = !isDeepStrictEqual(oldDrafts, composerDrafts) || oldActive !== activeThreadId;
        }
      }
      const candidate = ids ? await this.checkpoints.prepare(persistent, ids, includeComposer) : undefined;
      await writeWorkspaceRecovery(this.directory, previousBytes);
      if (candidate) await this.checkpoints.commit(candidate);
      else {
        await atomicFile(join(this.directory, 'workspace.json'), (file) => file.writeFile(nextBytes));
        await this.checkpoints.reset(nextBytes);
      }
    } else if (!checkpointIds && !conversation && this.checkpoints.pending && isDeepStrictEqual(next, this.state)) {
      await atomicFile(join(this.directory, 'workspace.json'), file => file.writeFile(nextBytes));
      await this.checkpoints.reset(nextBytes);
    }
    this.originals.committed(liveOriginals, savedOriginals);
    this.state = next;
    this.persistentActiveThreadId = persistent.activeThreadId;
    this.persistentBytes = nextBytes;
    return next;
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
    const snapshot = structuredClone(persistentWorkspace(this.state, this.persistentActiveThreadId));
    snapshot.providers.forEach((provider) => { provider.hasKey = false; });
    snapshot.mcpServers.forEach((server) => { server.hasCredentials = false; server.autoConnect = false; });
    return snapshot;
  }

  /** Capture one persistent snapshot and its verified originals under the same transaction lock. */
  backupWithOriginals(): Promise<Workspace & { documentOriginals: DocumentOriginalBundle[] }> {
    const operation = this.tail.then(async () => {
      const workspace = this.backup(), owners = documentOriginalReferences(workspace);
      const documentOriginals: DocumentOriginalBundle[] = [];
      for (const reference of owners) documentOriginals.push({ reference, data: (await this.originals.read(reference, owners)).toString('base64') });
      return { ...workspace, documentOriginals };
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  /** Validated immutable blobs may precede metadata commit; failed restores never replace live ownership. */
  async prepareOriginalRestore(raw: unknown, workspace: Workspace): Promise<void> {
    const bundles = validateDocumentOriginalBundles(raw, documentOriginalReferences(workspace));
    for (const bundle of bundles) await this.originalStore.write(Buffer.from(bundle.data, 'base64'));
  }
}
