import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import type { ModelGateway, ModelInput, ModelReply } from '../desktop/services/model-gateway';
import { ProjectTools, type ProjectToolExecutor } from '../desktop/services/project-tools';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, request, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function setup(gateway: ModelGateway, tools?: ProjectToolExecutor, interval?: number) {
  const { vault, directory } = await testVault(); directories.push(directory);
  const emit = vi.fn(); const engine = new ConversationEngine(vault, gateway, emit, tools, interval);
  return { vault, engine, emit, directory };
}
const call = { id: 'call', name: 'read_file', arguments: '{"path":"README.md","start_line":1,"max_lines":20}' };
function reply(): ModelReply { return { kind: 'ollama', items: [{ role: 'assistant', tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }] }], toolCalls: [call] }; }
describe('conversation engine', () => {
  it('stops only the selected project or provider and counts reserved new runs as active', async () => {
    const { engine, vault, directory } = await setup({ stream: async (input) => { await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } });
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: directory, instructions: '', createdAt: 1 }); draft.providers.push({ ...draft.providers[0], id: 'other-provider' }); });
    const one = await engine.start({ ...request, projectId: 'project' }); const two = await engine.start({ ...request, providerId: 'other-provider' });
    expect(engine.active()).toBe(true); await engine.stopProject('project'); expect(engine.active(one.threadId)).toBe(false); expect(engine.active(two.threadId)).toBe(true);
    await engine.stopProvider('missing'); expect(engine.active(two.threadId)).toBe(true); await engine.stopProvider('other-provider'); expect(engine.active()).toBe(false);
    const original = vault.update.bind(vault); let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'update').mockImplementationOnce(async (change) => { await hold; return original(change); });
    const starting = engine.start(request); expect(engine.active()).toBe(true); const stopping = engine.stopProvider(request.providerId); release(); await starting; await stopping; expect(engine.active()).toBe(false);
  });
  it('persists a conversation, streams text, and retains assistant and project instructions', async () => {
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('Hello'); onText(' again'); }) } satisfies ModelGateway;
    const { vault, engine, emit } = await setup(gateway);
    await vault.update((draft) => { draft.projects.push({ id: 'p', name: 'Project', path: '.', instructions: 'Project rules', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'p', assistantId: 'general' });
    await engine.settle(threadId);
    const thread = vault.snapshot().threads[0];
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({ content: 'Hello again', status: 'complete' });
    expect(gateway.stream.mock.calls[0][0].instructions).toContain('Project rules');
    expect(emit.mock.calls.some(([event]) => event.delta === 'Hello')).toBe(true);
    expect(engine.active(threadId)).toBe(false);
    await engine.start({ ...request, threadId }); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages).toHaveLength(4);
  });
  it('rejects missing providers, credentials, projects, assistants and threads', async () => {
    const { vault, engine } = await setup({ stream: vi.fn() });
    await expect(engine.start({ ...request, providerId: 'missing' })).rejects.toThrow('Configure a provider');
    await expect(engine.start({ ...request, threadId: 'missing' })).rejects.toThrow('no longer exists');
    await expect(engine.start({ ...request, projectId: 'missing' })).rejects.toThrow('project no longer');
    await expect(engine.start({ ...request, assistantId: 'missing' })).rejects.toThrow('assistant no longer');
    await vault.update((draft) => { draft.providers[0].kind = 'openai'; });
    await expect(engine.start(request)).rejects.toThrow('API key');
  });
  it('prevents concurrent responses and retains partial output on stop', async () => {
    const gateway: ModelGateway = { stream: async (input, onText) => { onText('Partial'); await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); } };
    const { engine, vault } = await setup(gateway);
    const { threadId } = await engine.start(request);
    expect(engine.active(threadId)).toBe(true);
    await expect(engine.start({ ...request, threadId })).rejects.toThrow('already running');
    await engine.stop(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ content: 'Partial', status: 'stopped' });
    await engine.stop('unknown'); await engine.settle('unknown');
  });
  it('records a failed response and allows a later retry', async () => {
    const { engine, vault } = await setup({ stream: vi.fn().mockRejectedValueOnce(new Error('Provider failed')).mockResolvedValueOnce(undefined) });
    const { threadId } = await engine.start(request); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'error', error: 'Provider failed' });
    await engine.start({ ...request, threadId }); await engine.settle(threadId);
    expect(engine.active(threadId)).toBe(false);
  });
  it('stops every active conversation during shutdown', async () => {
    const { engine, vault } = await setup({ stream: async (input) => { await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })); } });
    await engine.start(request); await engine.start({ ...request, text: 'Second' });
    await engine.shutdown();
    expect(vault.snapshot().threads.every((thread) => thread.messages[1].status === 'stopped')).toBe(true);
  });
  it('cleans up its run reservation if the initial disk save fails', async () => {
    const { engine, vault } = await setup({ stream: vi.fn() });
    vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full'));
    await expect(engine.start(request)).rejects.toThrow('Disk full');
    expect(vault.snapshot().threads).toHaveLength(0);
    await engine.shutdown();
  });
  it('reports final save failure and always releases the active run', async () => {
    const { engine, vault, emit } = await setup({ stream: async () => { vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full')); } });
    const { threadId } = await engine.start(request); await engine.settle(threadId);
    expect(emit.mock.calls.at(-1)?.[0].error).toContain('Could not save');
    expect(emit.mock.calls.at(-1)?.[0].message.status).toBe('error');
    expect(engine.active(threadId)).toBe(false);
  });

  it('reads real project evidence, streams across rounds and persists observable tool results', async () => {
    const gateway: ModelGateway = { stream: vi.fn().mockImplementationOnce(async (input: ModelInput, onText) => {
      expect(input.tools?.some((tool) => tool.name === 'read_file')).toBe(true);
      onText('Inspecting the project.'); return reply();
    }).mockImplementationOnce(async (input, onText) => {
      expect(input.exchanges?.[0].results[0]).toMatchObject({ callId: 'call', error: false });
      expect(input.exchanges?.[0].results[0].output).toContain('Actual fixture content');
      onText('Evidence-based plan.');
    }) };
    const { engine, vault, directory, emit } = await setup(gateway);
    const path = join(directory, 'project'); await mkdir(path); await writeFile(join(path, 'README.md'), 'Actual fixture content');
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path, instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'plan' });
    await engine.settle(threadId);
    const message = vault.snapshot().threads[0].messages[1];
    expect(message.content).toBe('Inspecting the project.\n\nEvidence-based plan.');
    expect(message.activities?.[0]).toMatchObject({ name: 'read_file', status: 'complete', output: expect.stringContaining('Actual fixture content') });
    expect(emit.mock.calls.filter(([event]) => event.activity).map(([event]) => event.activity.status)).toEqual(['running', 'complete']);
    expect(vault.snapshot().threads[0].mode).toBe('plan');
  });

  it('requires a selected project and rejects unsolicited tool calls in ordinary chat', async () => {
    const tools = { execute: vi.fn() };
    const { engine, vault } = await setup({ stream: vi.fn().mockResolvedValue(reply()) }, tools);
    await expect(engine.start({ ...request, mode: 'plan' })).rejects.toThrow('Choose a project');
    const { threadId } = await engine.start(request); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1].error).toContain('does not allow');
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it('returns a denied tool result to the model so it can recover', async () => {
    const gateway: ModelGateway = { stream: vi.fn().mockResolvedValueOnce({ ...reply(), toolCalls: [{ ...call, name: 'write_file' }] }).mockImplementationOnce(async (input, onText) => {
      expect(input.exchanges?.[0].results[0].error).toBe(true); onText('I can only analyze this project.');
    }) };
    const { engine, vault } = await setup(gateway);
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: '.', instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'plan' }); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'complete', activities: [{ status: 'error' }] });
  });

  it('cancels an active tool and records its terminal state without a further model request', async () => {
    const tools: ProjectToolExecutor = { execute: async (_call, _project, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })) };
    const gateway = { stream: vi.fn().mockResolvedValue(reply()) };
    const { engine, vault, emit } = await setup(gateway, tools);
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: '.', instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'plan' });
    await vi.waitFor(() => expect(emit.mock.calls.some(([event]) => event.activity?.status === 'running')).toBe(true));
    await engine.stop(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'stopped', activities: [{ status: 'stopped' }] });
    expect(gateway.stream).toHaveBeenCalledTimes(1);
  });

  it('rechecks project existence, reports tool failures and limits repeated requests', async () => {
    const { engine, vault } = await setup({ stream: async () => { await vault.update((draft) => { draft.projects = []; }); return reply(); } });
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: '.', instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'plan' }); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1].error).toContain('project no longer exists');

    const failing = await setup({ stream: async () => reply() }, { execute: async () => { throw new Error('Tool failed'); } });
    await failing.vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: '.', instructions: '', createdAt: 1 }); });
    const failed = await failing.engine.start({ ...request, projectId: 'project', mode: 'plan' }); await failing.engine.settle(failed.threadId);
    expect(failing.vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'error', activities: [{ status: 'error' }] });

    const looping = await setup({ stream: async () => reply() }, { execute: async () => ({ callId: 'call', output: 'Result', error: false }) });
    await looping.vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: '.', instructions: '', createdAt: 1 }); });
    const repeated = await looping.engine.start({ ...request, projectId: 'project', mode: 'plan' }); await looping.engine.settle(repeated.threadId);
    expect(looping.vault.snapshot().threads[0].messages[1].error).toContain('tool-round limit');
  });

  it('waits for the initial save during shutdown and never begins a cancelled provider request', async () => {
    const gateway = { stream: vi.fn() };
    const { engine, vault } = await setup(gateway);
    await vault.update((draft) => { draft.threads.push(sampleThread()); });
    const original = vault.update.bind(vault);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(vault, 'update').mockImplementationOnce(async (change) => { await hold; return original(change); });
    const starting = engine.start({ ...request, threadId: 'thread' });
    let shutDown = false;
    const shutdown = engine.shutdown().then(() => { shutDown = true; });
    await Promise.resolve(); expect(shutDown).toBe(false);
    release(); await starting; await shutdown;
    expect(gateway.stream).not.toHaveBeenCalled();
    expect(vault.snapshot().threads[0].messages[1].status).toBe('stopped');
    await expect(engine.start(request)).rejects.toThrow('shutting down');
  });

  it('checkpoints partial text to disk and restores interrupted tool states', async () => {
    const { engine, vault, directory } = await setup({ stream: async (input, onText) => {
      onText('Saved while running');
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    } }, new ProjectTools(), 10);
    const { threadId } = await engine.start(request);
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
      expect(stored.threads[0].messages[1]).toMatchObject({ status: 'running', content: 'Saved while running' });
    });
    await engine.stop(threadId);
    await vault.update((draft) => {
      draft.threads[0].messages[1].status = 'running';
      draft.threads[0].messages[1].activities = [{ id: 'activity', name: 'read_file', input: '{}', output: '', status: 'running', startedAt: 1 }];
    });
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[1]).toMatchObject({ content: 'Saved while running', status: 'stopped', activities: [{ status: 'stopped' }] });
  });

  it('stops on checkpoint failures and rejects oversized answers while retaining valid text', async () => {
    const { engine, vault } = await setup({ stream: async (input, onText) => {
      onText('Partial'); vi.spyOn(vault, 'update').mockRejectedValueOnce(new Error('Disk full'));
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    } }, undefined, 10);
    const { threadId } = await engine.start(request); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'error', content: 'Partial', error: expect.stringContaining('while it was running') });
    const large = await setup({ stream: async (_input, onText) => { onText('Valid'); onText('x'.repeat(4_000_000)); } });
    const started = await large.engine.start(request); await large.engine.settle(started.threadId);
    expect(large.vault.snapshot().threads[0].messages[1]).toMatchObject({ content: 'Valid', status: 'error', error: expect.stringContaining('size limit') });
  });

  it('continues saving if the renderer closes during an event', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const engine = new ConversationEngine(vault, { stream: async (_input, onText) => { onText('Retained'); } }, () => { throw new Error('Renderer gone'); });
    const { threadId } = await engine.start(request); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1].status).toBe('complete');
  });

  it('waits for separate file and command decisions before executing an agent task', async () => {
    const write = { ...call, name: 'write_file', arguments: '{"path":"created.txt","content":"Agent file evidence","expected_sha256":null}' };
    const command = { ...call, id: 'command', name: 'run_command', arguments: JSON.stringify({ program: process.execPath, args: ['-e', 'process.stdout.write("Agent command evidence")'], timeout_ms: 5000 }) };
    const gateway: ModelGateway = { stream: vi.fn().mockResolvedValueOnce({ ...reply(), toolCalls: [write] }).mockImplementationOnce(async (input) => {
      expect(input.exchanges?.[0].results[0].error).toBe(false); return { ...reply(), toolCalls: [command] };
    }).mockImplementationOnce(async (input, onText) => {
      expect(input.exchanges?.[1].results[0].output).toContain('Agent command evidence'); onText('Implemented and verified.');
    }) };
    const { engine, vault, directory, emit } = await setup(gateway);
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: directory, instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'agent' });
    await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    const fileApproval = engine.pendingApprovals()[0];
    expect(fileApproval.details).toMatchObject({ kind: 'file', after: 'Agent file evidence' });
    await expect(readFile(join(directory, 'created.txt'))).rejects.toThrow();
    engine.resolveApproval(fileApproval.id, true);
    await vi.waitFor(() => expect(engine.pendingApprovals()[0]?.toolName).toBe('run_command'));
    expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe('Agent file evidence');
    engine.resolveApproval(engine.pendingApprovals()[0].id, true);
    await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1]).toMatchObject({ status: 'complete', content: 'Implemented and verified.', activities: [{ status: 'complete' }, { status: 'complete' }] });
    expect(emit.mock.calls.some(([event]) => event.activity?.output.includes('Agent command evidence'))).toBe(true);
  });

  it('respects denial and cancels waiting approvals on stop', async () => {
    const write = { ...call, name: 'write_file', arguments: '{"path":"denied.txt","content":"Contents","expected_sha256":null}' };
    const gateway: ModelGateway = { stream: vi.fn().mockResolvedValueOnce({ ...reply(), toolCalls: [write] }).mockImplementationOnce(async (input, onText) => {
      expect(input.exchanges?.[0].results[0].error).toBe(true); onText('The change was denied.');
    }).mockResolvedValueOnce({ ...reply(), toolCalls: [write] }) };
    const { engine, vault, directory } = await setup(gateway);
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: directory, instructions: '', createdAt: 1 }); });
    const denied = await engine.start({ ...request, projectId: 'project', mode: 'agent' });
    await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    engine.resolveApproval(engine.pendingApprovals()[0].id, false); await engine.settle(denied.threadId);
    const stopped = await engine.start({ ...request, projectId: 'project', mode: 'agent' });
    await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    await engine.stop(stopped.threadId);
    expect(engine.pendingApprovals()).toEqual([]);
    expect(vault.snapshot().threads[1].messages[1]).toMatchObject({ status: 'stopped', activities: [{ status: 'stopped' }] });
    await expect(readFile(join(directory, 'denied.txt'))).rejects.toThrow();
  });

  it('invalidates approved actions if their project changes before execution', async () => {
    const { engine, vault, directory } = await setup({ stream: async () => ({ ...reply(), toolCalls: [{ ...call, name: 'write_file', arguments: '{"path":"changed.txt","content":"Contents","expected_sha256":null}' }] }) });
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Fixture', path: directory, instructions: '', createdAt: 1 }); });
    const { threadId } = await engine.start({ ...request, projectId: 'project', mode: 'agent' });
    await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    await vault.update((draft) => { draft.projects = []; });
    engine.resolveApproval(engine.pendingApprovals()[0].id, true); await engine.settle(threadId);
    expect(vault.snapshot().threads[0].messages[1].activities?.[0].output).toContain('project changed while approval');
    await expect(readFile(join(directory, 'changed.txt'))).rejects.toThrow();
  });
});
