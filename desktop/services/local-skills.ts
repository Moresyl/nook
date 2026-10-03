import { parseDocument } from 'yaml';
import { z } from 'zod';
import { skillSchema, type Skill, type SkillDocument, type SkillBundle } from '../../contracts/extensions';
import type { ToolCall, ToolDefinition, ToolResult } from '../../contracts/tools';
import { boundedToolOutput } from './project-tools';
import { ManagedAssets } from './managed-assets';

const readInput = z.object({ id: z.uuid(), path: z.string().min(1).max(4096) }).strict();
const loadInput = z.object({ id: z.uuid() }).strict();
export const skillToolDefinitions: ToolDefinition[] = [
  { name: 'load_skill', description: 'Load the complete instructions and supporting file list of a selected skill. Load it before applying it.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'read_skill_file', description: 'Read a supporting UTF-8 text file from a selected skill. This tool does not execute scripts.', parameters: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id', 'path'], additionalProperties: false } },
];

export function skillMetadata(text: string, fallback: string): { name: string; description: string; instructions: string } {
  if (Buffer.byteLength(text, 'utf8') > 64_000 || text.includes('\0')) throw new Error('SKILL.md must be UTF-8 text smaller than 64 KB.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  let metadata: { name?: string; description?: string } = {};
  if (match) {
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw new Error('The skill’s YAML metadata is invalid.');
    try { metadata = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(2000).optional() }).parse(document.toJS({ maxAliasCount: 20 })); }
    catch { throw new Error('The skill must have a text name and description.'); }
  }
  const instructions = normalized.slice(match?.[0].length ?? 0).trim();
  if (!instructions) throw new Error('The skill has no instructions.');
  return { name: metadata.name ?? fallback.slice(0, 100), description: metadata.description ?? '', instructions };
}

// Managed skill folders contain full assets and licenses, independently of the original directory.
export class LocalSkills {
  private readonly assets: ManagedAssets;
  constructor(directory: string) { this.assets = new ManagedAssets(directory, 'SKILL.md', 'skill'); }

  async importPath(source: string): Promise<Skill> {
    const { id, metadata } = await this.assets.importPath(source, skillMetadata);
    return skillSchema.parse({ id, name: metadata.name, description: metadata.description, enabled: true, importedAt: Date.now() });
  }

  async document(id: string): Promise<SkillDocument> {
    const directory = await this.assets.root(id);
    const metadata = skillMetadata(await this.assets.read(id, 'SKILL.md'), id);
    return { instructions: metadata.instructions, files: await this.assets.files(directory), directory };
  }

  async read(id: string, path: string): Promise<string> { return this.assets.read(id, path); }

  async remove(id: string): Promise<void> { await this.assets.remove(id); }

  async bundle(id: string): Promise<SkillBundle> {
    return this.assets.bundle(id);
  }

  async restore(raw: SkillBundle): Promise<Skill> {
    const { id, metadata } = await this.assets.restore(raw, skillMetadata);
    return skillSchema.parse({ id, name: metadata.name, description: metadata.description, enabled: true, importedAt: Date.now() });
  }

  async execute(call: ToolCall, selected: Skill[], signal: AbortSignal): Promise<ToolResult> {
    signal.throwIfAborted();
    try {
      const input = call.name === 'load_skill' ? loadInput.parse(JSON.parse(call.arguments)) : readInput.parse(JSON.parse(call.arguments));
      if (!selected.some((skill) => skill.id === input.id && skill.enabled)) throw new Error('This skill is not selected or is disabled.');
      if (call.name === 'load_skill') {
        const document = await this.document(input.id);
        const body = `Skill directory: ${document.directory}\n\nInstructions:\n${document.instructions}\n\nSupporting files:\n`;
        if (body.length > 63_500) throw new Error('The skill instructions are too long for one tool response. Shorten SKILL.md and move details into references.');
        return { callId: call.id, output: boundedToolOutput(body + document.files.join('\n')), error: false };
      }
      if (call.name !== 'read_skill_file') throw new Error('Unknown skill tool.');
      return { callId: call.id, output: boundedToolOutput(await this.read(input.id, (input as z.infer<typeof readInput>).path)), error: false };
    } catch (error) {
      signal.throwIfAborted();
      return { callId: call.id, output: error instanceof Error && !(error instanceof z.ZodError) ? error.message.slice(0, 512) : 'Invalid skill tool arguments.', error: true };
    }
  }
}
