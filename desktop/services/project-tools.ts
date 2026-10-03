import { relative, sep } from 'node:path';
import { z } from 'zod';
import { toolCallSchema, type ToolCall, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../../contracts/tools';
import type { Project } from '../../contracts/workspace';
import { projectDiff, projectDocument, projectEntries, projectText, scopedPath } from './project-files';

const pathSchema = z.string().max(4096);
const schemas = {
  list_files: z.object({ path: pathSchema }).strict(),
  read_file: z.object({ path: pathSchema.min(1), start_line: z.number().int().min(1).max(1_000_000), max_lines: z.number().int().min(1).max(400) }).strict(),
  search_files: z.object({ path: pathSchema, query: z.string().min(1).max(200), case_sensitive: z.boolean(), max_results: z.number().int().min(1).max(100) }).strict(),
  git_diff: z.object({}).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  list_files: 'List a directory in the selected project. Use an empty path for the project root. Internal and credential files are excluded.',
  read_file: 'Read numbered lines of a UTF-8 text file in the selected project. Lines start at 1. At most 400 lines per call; larger output is truncated.',
  search_files: 'Search literal text in project files recursively. Reports file paths, line numbers and excerpts. Search is bounded and may be truncated.',
  git_diff: 'Read the tracked Git changes against HEAD in the selected project. This does not run external diff programs or modify files.',
};
export const projectToolDefinitions: ToolDefinition[] = Object.entries(schemas).map(([name, schema]) => {
  const parameters = z.toJSONSchema(schema) as Record<string, unknown>;
  delete parameters.$schema;
  parameters.required ??= [];
  return { name, description: descriptions[name as keyof typeof schemas], parameters };
});

const ignoredDirectories = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'dist', 'build', 'artifacts']);
export function excludedProjectPath(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/);
  return parts.some((part) => ignoredDirectories.has(part) || part === '.ssh' || part === '.aws' ||
    (part.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(part)) ||
    /^(id_rsa|id_ed25519|credentials\.json)$/.test(part) || /\.(pem|p12|pfx|key)$/.test(part));
}
export function boundedToolOutput(value: string): string { return value.length <= 64_000 ? value : `${value.slice(0, 63_900)}\n[Output truncated; narrow the request.]`; }

export async function allowedProjectPath(project: Project, path: string): Promise<void> {
  const root = await scopedPath(project.path, '.');
  const actual = await scopedPath(root, path);
  if (excludedProjectPath(relative(root, actual))) throw new Error('This file is excluded from automatic project tools.');
}

async function searchProject(project: Project, args: z.infer<typeof schemas.search_files>, signal: AbortSignal): Promise<string> {
  const queue = [args.path];
  const matches: { path: string; line: number; text: string }[] = [];
  const needle = args.case_sensitive ? args.query : args.query.toLocaleLowerCase();
  let scannedFiles = 0;
  let skippedFiles = 0;
  let visited = 0;
  let bytes = 0;
  let truncated = false;
  while (queue.length && !truncated) {
    signal.throwIfAborted();
    const path = queue.shift()!;
    const entries = await projectEntries(project.path, path);
    for (const entry of entries) {
      signal.throwIfAborted();
      if (++visited > 3000 || scannedFiles >= 1000 || bytes >= 16_000_000) { truncated = true; break; }
      if (excludedProjectPath(entry.relativePath)) continue;
      if (entry.directory) { queue.push(entry.relativePath); continue; }
      let text: string;
      try { await allowedProjectPath(project, entry.relativePath); text = await projectText(project.path, entry.relativePath); }
      catch { skippedFiles++; continue; }
      scannedFiles++;
      bytes += Buffer.byteLength(text, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const candidate = args.case_sensitive ? lines[index] : lines[index].toLocaleLowerCase();
        if (!candidate.includes(needle)) continue;
        matches.push({ path: entry.relativePath.split(sep).join('/'), line: index + 1, text: lines[index].slice(0, 500) });
        if (matches.length >= args.max_results) { truncated = true; break; }
      }
      if (truncated) break;
    }
  }
  return boundedToolOutput(JSON.stringify({ matches, scannedFiles, skippedFiles, truncated }));
}

export type ProjectToolExecutor = { execute(call: ToolCall, project: Project, signal: AbortSignal, context?: ToolExecutionContext): Promise<ToolResult> };
export class ProjectTools implements ProjectToolExecutor {
  async execute(raw: ToolCall, project: Project, signal: AbortSignal): Promise<ToolResult> {
    signal.throwIfAborted();
    const call = toolCallSchema.parse(raw);
    try {
      const args: unknown = JSON.parse(call.arguments);
      let output: string;
      switch (call.name) {
        case 'list_files': {
          const input = schemas.list_files.parse(args);
          await allowedProjectPath(project, input.path);
          output = JSON.stringify((await projectEntries(project.path, input.path)).filter((entry) => !excludedProjectPath(entry.relativePath)));
          break;
        }
        case 'read_file': {
          const input = schemas.read_file.parse(args);
          await allowedProjectPath(project, input.path);
          const document = await projectDocument(project.path, input.path);
          const lines = document.text.split(/\r?\n/);
          const end = Math.min(lines.length, input.start_line - 1 + input.max_lines);
          output = `File: ${input.path}\nSHA-256: ${document.sha256}\nTotal lines: ${lines.length}\n` + lines.slice(input.start_line - 1, end).map((line, offset) => `${input.start_line + offset}: ${line}`).join('\n');
          break;
        }
        case 'search_files': {
          const input = schemas.search_files.parse(args);
          await allowedProjectPath(project, input.path);
          output = await searchProject(project, input, signal);
          break;
        }
        case 'git_diff':
          schemas.git_diff.parse(args);
          output = await projectDiff(project.path);
          break;
        default: throw new Error('This tool is unavailable in project analysis.');
      }
      signal.throwIfAborted();
      return { callId: call.id, output: boundedToolOutput(output), error: false };
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof z.ZodError || error instanceof SyntaxError ? 'Invalid tool arguments. Check the declared tool schema.'
        : error instanceof Error && !('code' in error) ? error.message : 'The project operation failed. Check the path and file permissions.';
      return { callId: call.id, output: message.slice(0, 512), error: true };
    }
  }
}
