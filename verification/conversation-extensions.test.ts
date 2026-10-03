import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ConversationExtensions } from '../desktop/services/conversation-extensions';
import { LocalSkills } from '../desktop/services/local-skills';
import type { McpConnections } from '../desktop/services/mcp-connections';
import type { ModelGateway } from '../desktop/services/model-gateway';
import type { ToolCall, ToolExecutionContext } from '../contracts/tools';
import { request, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function setup() {
  const { directory, vault } = await testVault(); directories.push(directory);
  const source = join(directory, 'source'); await mkdir(source); await writeFile(join(source, 'SKILL.md'), '---\nname: Evidence\ndescription: Summarize evidence\n---\nFULL_SKILL_BODY'); await writeFile(join(source, 'method.md'), 'METHOD_EVIDENCE');
  const skills = new LocalSkills(join(directory, 'skills')); const skill = await skills.importPath(source); await vault.update((state) => { state.skills.push(skill); });
  const remote = { name: 'mcp_fixture_tool', description: 'External tool', parameters: { type: 'object' }, strict: false };
  const invoked = vi.fn();
  const mcp = { select: vi.fn((ids: string[]) => ({ definitions: ids.length ? [remote] : [], execute: async (call: ToolCall, signal: AbortSignal, context: ToolExecutionContext) => {
    const allowed = await context.approve({ kind: 'mcp', serverId: 'server', serverName: 'Fixture', toolName: 'echo', arguments: call.arguments }); signal.throwIfAborted();
    if (allowed) invoked(); return { callId: call.id, output: allowed ? 'MCP_EVIDENCE' : 'Declined', error: !allowed };
  } })) } as unknown as McpConnections;
  const extensions = new ConversationExtensions(mcp, skills, () => vault.snapshot());
  return { vault, directory, skill, mcp, extensions, invoked, remote };
}
function reply(call: ToolCall) { return { kind: 'ollama' as const, items: [], toolCalls: [call] }; }
describe('conversation extension routing', () => {
  it('loads a selected skill and supporting file across real engine rounds without a project', async () => {
    const { vault, extensions, skill } = await setup(); let round = 0;
    const gateway: ModelGateway = { stream: async (input, onText) => {
      expect(input.instructions).toContain('Summarize evidence'); expect(input.instructions).not.toContain('FULL_SKILL_BODY');
      if (round++ === 0) return reply({ id: 'load', name: 'load_skill', arguments: JSON.stringify({ id: skill.id }) });
      if (round === 2) { expect(input.exchanges?.[0].results[0].output).toContain('FULL_SKILL_BODY'); return reply({ id: 'read', name: 'read_skill_file', arguments: JSON.stringify({ id: skill.id, path: 'method.md' }) }); }
      expect(input.exchanges?.[1].results[0].output).toBe('METHOD_EVIDENCE'); onText('Verified skill result');
    } };
    const engine = new ConversationEngine(vault, gateway, () => {}, undefined, undefined, extensions);
    const { threadId } = await engine.start({ ...request, skillIds: [skill.id] }); await engine.settle(threadId);
    expect(vault.snapshot().threads[0]).toMatchObject({ skillIds: [skill.id], messages: [{ role: 'user' }, { content: 'Verified skill result', status: 'complete' }] });
    await vault.update((state) => { state.skills[0].enabled = false; });
    await expect(engine.start({ ...request, skillIds: [skill.id] })).rejects.toThrow('disabled');
    const selection = extensions.select({ ...vault.snapshot(), skills: [skill] }, [], [skill.id]);
    expect((await selection.execute({ id: 'call', name: 'load_skill', arguments: JSON.stringify({ id: skill.id }) }, new AbortController().signal, { approve: vi.fn(), onProgress: vi.fn() })).error).toBe(true);
  });
  it('approves remote tools in ordinary chat, retains server selection and stops pending approvals by server', async () => {
    const { vault, extensions, remote, invoked } = await setup();
    const gateway: ModelGateway = { stream: async (input, onText) => {
      if (!input.exchanges?.length) return reply({ id: 'remote', name: remote.name, arguments: '{}' });
      expect(input.exchanges[0].results[0].output).toBe('MCP_EVIDENCE'); onText('Verified external tool');
    } };
    const engine = new ConversationEngine(vault, gateway, () => {}, undefined, undefined, extensions);
    const one = await engine.start({ ...request, mcpServerIds: ['server'] }); await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    expect(invoked).not.toHaveBeenCalled(); engine.resolveApproval(engine.pendingApprovals()[0].id, true); await engine.settle(one.threadId); expect(invoked).toHaveBeenCalledOnce();
    expect(vault.snapshot().threads[0].mcpServerIds).toEqual(['server']);
    await engine.start({ ...request, threadId: one.threadId }); await vi.waitFor(() => expect(engine.pendingApprovals()).toHaveLength(1));
    await engine.stopServer('server'); expect(engine.pendingApprovals()).toEqual([]); expect(vault.snapshot().threads[0].messages.at(-1)?.status).toBe('stopped'); expect(invoked).toHaveBeenCalledOnce();
  });
  it('excludes MCP in read-only planning, cancels skill runs and rejects unavailable extension runtimes', async () => {
    const { vault, extensions, skill, mcp, directory } = await setup();
    await vault.update((draft) => { draft.projects.push({ id: 'project', name: 'Project', path: directory, instructions: '', createdAt: 1 }); });
    const gateway: ModelGateway = { stream: async (input) => {
      expect(input.tools?.some((tool) => tool.name === 'mcp_fixture_tool')).toBe(false);
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }));
    } };
    const engine = new ConversationEngine(vault, gateway, () => {}, undefined, undefined, extensions);
    const one = await engine.start({ ...request, mode: 'plan', projectId: 'project', mcpServerIds: ['server'], skillIds: [skill.id] });
    expect(mcp.select).toHaveBeenCalledWith([]); await engine.stopSkill(skill.id); expect(vault.snapshot().threads[0].messages.at(-1)?.status).toBe('stopped');
    await expect(new ConversationEngine(vault, gateway, () => {}).start({ ...request, skillIds: [skill.id] })).rejects.toThrow('unavailable');
    expect(engine.active(one.threadId)).toBe(false);
  });
});
