import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { GitFile, GitFileView, GitStatus } from '../../contracts/projects';
import { projectDocument, scopedPath } from './project-files';

const runFile = promisify(execFile);
export function parseGitStatus(output: string): GitStatus {
  const status: GitStatus = { branch: '', detached: false, unborn: false, ahead: 0, behind: 0, files: [] };
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('# branch.head ')) { status.branch = record.slice(14); status.detached = status.branch === '(detached)'; }
    else if (record === '# branch.oid (initial)') status.unborn = true;
    else if (record.startsWith('# branch.ab ')) { const counts = record.match(/\+(\d+) -(\d+)/); if (counts) { status.ahead = Number(counts[1]); status.behind = Number(counts[2]); } }
    else if (record.startsWith('? ')) status.files.push({ path: record.slice(2), index: '?', working: '?', conflict: false });
    else if (['1 ', '2 ', 'u '].some((prefix) => record.startsWith(prefix))) {
      const kind = record[0]; const fields = kind === '1' ? 8 : kind === '2' ? 9 : 10;
      let offset = 0;
      for (let field = 0; field < fields; field++) { const next = record.indexOf(' ', offset); if (next < 0) throw new Error('Git returned an invalid status record.'); offset = next + 1; }
      const xy = record.split(' ', 2)[1];
      status.files.push({ path: record.slice(offset), index: xy[0], working: xy[1], conflict: kind === 'u', ...(kind === '2' ? { originalPath: records[++i] } : {}) });
    }
  }
  return status;
}

export class ProjectGit {
  constructor(private readonly runner: typeof runFile = runFile) {}
  private async run(root: string, args: string[], strictUtf8 = true): Promise<string> {
    const cwd = await scopedPath(root, '.');
    try {
      const result = await this.runner('git', ['--no-pager', '--literal-pathspecs', '-C', cwd, ...args], { encoding: 'buffer', windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } });
      return new TextDecoder('utf-8', { fatal: strictUtf8, ignoreBOM: true }).decode(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout), 'utf8'));
    } catch { throw new Error('Git could not complete this action. Check the repository, Git identity, permissions and hooks.'); }
  }
  async status(root: string): Promise<GitStatus> { return parseGitStatus(await this.run(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])); }
  private path(root: string, path: string): string {
    if (!path || isAbsolute(path) || /[:\0]/.test(path)) throw new Error('Use a relative project file path.');
    const displacement = relative(resolve(root), resolve(root, path));
    if (!displacement || displacement === '..' || displacement.startsWith(`..${sep}`) || isAbsolute(displacement) || displacement.split(sep).some((part) => part.toLowerCase() === '.git')) throw new Error('This path is outside the selected project.');
    return displacement.split(sep).join('/');
  }
  async stage(root: string, paths: string[], staged: boolean): Promise<GitStatus> {
    if (!paths.length || paths.length > 1000) throw new Error('Choose between 1 and 1000 changed files.');
    const selected = paths.map((path) => this.path(root, path));
    const status = await this.status(root);
    if (selected.some((path) => !status.files.some((file) => this.path(root, file.path) === path || (file.originalPath && this.path(root, file.originalPath) === path)))) throw new Error('A selected file is no longer changed. Refresh the Git status.');
    if (staged) await this.run(root, ['add', '--', ...selected]);
    else await this.run(root, status.unborn ? ['rm', '--cached', '-f', '--', ...selected] : ['reset', '--quiet', 'HEAD', '--', ...selected]);
    return this.status(root);
  }
  async commit(root: string, message: string): Promise<GitStatus> {
    if (!message.trim() || message.length > 16_000 || message.includes('\0')) throw new Error('Enter a commit message shorter than 16 KB.');
    const status = await this.status(root);
    if (status.files.some((file) => file.conflict)) throw new Error('Resolve merge conflicts before committing.');
    if (!status.files.some((file) => !['.', '?'].includes(file.index))) throw new Error('Stage changed files before committing.');
    await this.run(root, ['commit', '-m', message.trim()]);
    return this.status(root);
  }
  async fileView(root: string, selected: GitFile, staged: boolean): Promise<GitFileView> {
    const path = this.path(root, selected.path);
    const status = await this.status(root);
    const file = status.files.find((item) => this.path(root, item.path) === path);
    if (!file) throw new Error('This file is no longer changed. Refresh the Git status.');
    let before = ''; let after = ''; let binary = false;
    try {
      if (staged) {
        if (!status.unborn && file.index !== 'A') before = await this.run(root, ['show', `HEAD:${file.originalPath ?? path}`]);
        if (file.index !== 'D') after = await this.run(root, ['show', `:${path}`]);
      } else {
        if (file.index !== '?') before = await this.run(root, ['show', `:${path}`]);
        if (file.working !== 'D') after = (await projectDocument(root, path)).text;
      }
      binary = before.includes('\0') || after.includes('\0') || Buffer.byteLength(before, 'utf8') > 256_000 || Buffer.byteLength(after, 'utf8') > 256_000;
    } catch { binary = true; }
    const patch = file.index === '?' ? '' : await this.run(root, ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--', path], false);
    return { path, before: binary ? '' : before, after: binary ? '' : after, binary, patch };
  }
}
