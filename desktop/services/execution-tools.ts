import { relative } from 'node:path';
import { z } from 'zod';
import { toolCallSchema, type ToolCall, type ToolDefinition, type ToolExecutionContext, type ToolResult } from '../../contracts/tools';
import type { Project } from '../../contracts/workspace';
import { scopedPath } from './project-files';
import { optionalProjectDocument, saveProjectDocument, writableProjectPath } from './project-writes';
import { projectCommand } from './project-command';
import { boundedToolOutput, excludedProjectPath, ProjectTools, projectToolDefinitions } from './project-tools';

const revision = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const schemas = {
  write_file: z.object({ path: z.string().min(1).max(4096), content: z.string().max(60_000).refine((value) => !value.includes('\0')), expected_sha256: revision }).strict(),
  edit_file: z.object({ path: z.string().min(1).max(4096), old_text: z.string().min(1).max(30_000), new_text: z.string().max(30_000).refine((value) => !value.includes('\0')), replace_all: z.boolean(), expected_sha256: revision }).strict(),
  run_command: z.object({ program: z.string().min(1).max(4096).refine((value) => !value.includes('\0')), args: z.array(z.string().max(16_000).refine((value) => !value.includes('\0'))).max(100), timeout_ms: z.number().int().min(100).max(180_000) }).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  write_file: 'Create or replace a UTF-8 project file after the user reviews and approves the actual content. Parent directories must exist. For existing files use the SHA-256 from read_file; use null only for new files.',
  edit_file: 'Replace exact text in a project file after user approval. Read the file first and provide its SHA-256. If replace_all is false the old text must occur exactly once.',
  run_command: 'Run a program with arguments in the selected project after the user approves the exact invocation. Execution uses the current user account. On Windows use powershell.exe -NoProfile -NonInteractive -Command for .cmd shims. Limit execution with timeout_ms.',
};
export const executionToolDefinitions: ToolDefinition[] = [...projectToolDefinitions, ...Object.entries(schemas).map(([name, schema]) => {
  const parameters = z.toJSONSchema(schema) as Record<string, unknown>; delete parameters.$schema; parameters.required ??= [];
  return { name, description: descriptions[name as keyof typeof schemas], parameters };
})];

async function destination(root: string, path: string): Promise<string> {
  const target = await writableProjectPath(root, path);
  const actualRoot = await scopedPath(root, '.');
  if (excludedProjectPath(relative(actualRoot, target))) throw new Error('This file is excluded from automatic project tools.');
  return target;
}

export class ExecutionTools extends ProjectTools {
  override async execute(raw: ToolCall, project: Project, signal: AbortSignal, context?: ToolExecutionContext): Promise<ToolResult> {
    signal.throwIfAborted();
    const call = toolCallSchema.parse(raw);
    if (!Object.hasOwn(schemas, call.name)) return super.execute(call, project, signal);
    try {
      if (!context) throw new Error('Approval is required before executing this tool.');
      const args: unknown = JSON.parse(call.arguments);
      if (call.name === 'run_command') {
        const input = schemas.run_command.parse(args);
        const cwd = await scopedPath(project.path, '.');
        if (!await context.approve({ kind: 'command', program: input.program, args: input.args, cwd, timeout: input.timeout_ms })) return { callId: call.id, output: 'The user denied command execution.', error: true };
        signal.throwIfAborted();
        const result = await projectCommand(input.program, input.args, cwd, input.timeout_ms, signal, context.onProgress);
        return { callId: call.id, output: boundedToolOutput(`${result.output}\nExit code: ${result.exitCode ?? 'unknown'}${result.timedOut ? '\nCommand timed out.' : ''}`), error: result.timedOut || result.exitCode !== 0 };
      }
      const input = call.name === 'write_file' ? schemas.write_file.parse(args) : schemas.edit_file.parse(args);
      const target = await destination(project.path, input.path);
      const before = await optionalProjectDocument(project.path, input.path);
      if ((before?.sha256 ?? null) !== input.expected_sha256) throw new Error('The file revision does not match. Read the file again before proposing a change.');
      let after: string;
      if ('content' in input) after = input.content;
      else {
        if (!before) throw new Error('Read an existing file before editing it.');
        const occurrences = before.text.split(input.old_text).length - 1;
        if (!occurrences || (!input.replace_all && occurrences !== 1)) throw new Error('The text to replace is missing or ambiguous. Read the file and choose an exact match.');
        after = input.replace_all ? before.text.split(input.old_text).join(input.new_text) : before.text.replace(input.old_text, () => input.new_text);
      }
      if (Buffer.byteLength(after, 'utf8') > 256_000) throw new Error('The proposed file exceeds the 256 KB text limit.');
      if (!await context.approve({ kind: 'file', root: await scopedPath(project.path, '.'), path: input.path, exists: Boolean(before), before: before?.text ?? '', after })) return { callId: call.id, output: 'The user denied the file change.', error: true };
      signal.throwIfAborted();
      const saved = await saveProjectDocument(project.path, input.path, after, before?.sha256 ?? null, target);
      return { callId: call.id, output: `Saved ${input.path}.\nSHA-256: ${saved.sha256}`, error: false };
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof z.ZodError || error instanceof SyntaxError ? 'Invalid tool arguments. Check the declared tool schema.'
        : error instanceof Error && !('code' in error) ? error.message : 'The execution operation failed. Check the project path and file permissions.';
      return { callId: call.id, output: message.slice(0, 512), error: true };
    }
  }
}
