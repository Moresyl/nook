import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gitBranchNameSchema, type GitBranch, type GitBranches, type GitFile, type GitFileView, type GitStatus } from '../../contracts/projects';
import { createWorktreeSchema, type CreateWorktree, type GitWorktree, type WorktreeCreated } from '../../contracts/project-worktrees';
import { projectDocument, scopedPath } from './project-files';

const runFile = promisify(execFile);
export function parseGitWorktrees(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let record: GitWorktree | undefined;
  let seen = new Set<string>();
  for (const field of output.split('\0')) {
    if (!field) {
      if (!record) continue;
      if (!record.path || record.bare && Boolean(record.head || record.branch || record.detached) || !record.bare && (!record.head || Boolean(record.branch) === record.detached)) throw new Error('Git returned an invalid worktree record.');
      worktrees.push(record); record = undefined; seen = new Set(); continue;
    }
    const space = field.indexOf(' '), key = space < 0 ? field : field.slice(0, space), value = space < 0 ? '' : field.slice(space + 1);
    if (seen.has(key)) throw new Error('Git returned an invalid worktree record.');
    seen.add(key);
    if (key === 'worktree' && !record && value) record = { path: value, bare: false, detached: false };
    else if (!record) throw new Error('Git returned an invalid worktree record.');
    else if (key === 'HEAD' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) record.head = value;
    else if (key === 'branch' && value.startsWith('refs/heads/') && gitBranchNameSchema.safeParse(value.slice(11)).success) record.branch = value.slice(11);
    else if (key === 'bare' && !value) record.bare = true;
    else if (key === 'detached' && !value) record.detached = true;
    else if (key === 'locked') record.locked = value;
    else if (key === 'prunable') record.prunable = value;
    else throw new Error('Git returned an invalid worktree record.');
  }
  if (record) throw new Error('Git returned an unterminated worktree record.');
  if (!worktrees.length) throw new Error('Git returned an empty worktree list.');
  if (new Set(worktrees.map(item => item.path)).size !== worktrees.length) throw new Error('Git returned duplicate worktree paths.');
  return worktrees;
}
export function parseGitBranches(output: string): GitBranch[] {
  const fields = output.split('\0'), branches: GitBranch[] = [];
  for (let index = 0; index < fields.length; index += 3) {
    const name = fields[index].replace(/^\r?\n/, '');
    if (!name && index === fields.length - 1) break;
    if (!name || index + 2 >= fields.length || !['*', ' '].includes(fields[index + 1])) throw new Error('Git returned an invalid branch record.');
    branches.push({ name, current: fields[index + 1] === '*', worktreePath: fields[index + 2] });
  }
  return branches;
}
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
  private pending = new Map<string, Promise<unknown>>();
  private async update<T>(root: string, action: () => Promise<T>): Promise<T> {
    const cwd = await scopedPath(root, '.');
    const operation = (this.pending.get(cwd) ?? Promise.resolve()).catch(() => {}).then(action);
    this.pending.set(cwd, operation);
    try { return await operation; } finally { if (this.pending.get(cwd) === operation) this.pending.delete(cwd); }
  }
  private async run(root: string, args: string[], strictUtf8 = true): Promise<string> {
    const cwd = await scopedPath(root, '.');
    try {
      const result = await this.runner('git', ['--no-pager', '--literal-pathspecs', '-C', cwd, ...args], { encoding: 'buffer', windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' } });
      return new TextDecoder('utf-8', { fatal: strictUtf8, ignoreBOM: true }).decode(Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout), 'utf8'));
    } catch { throw new Error('Git could not complete this action. Check the repository, Git identity, permissions and hooks.'); }
  }
  async status(root: string): Promise<GitStatus> { return parseGitStatus(await this.run(root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'])); }
  async branches(root: string): Promise<GitBranches> {
    const [status, output] = await Promise.all([this.status(root), this.run(root, ['for-each-ref', '--sort=refname', '--format=%(refname:strip=2)%00%(HEAD)%00%(worktreepath)%00', 'refs/heads/'])]);
    const branches = parseGitBranches(output);
    if (status.unborn && !branches.some(branch => branch.name === status.branch)) branches.unshift({ name: status.branch, current: true, worktreePath: (await scopedPath(root, '.')).split(sep).join('/') });
    return { status, branches };
  }
  async switchBranch(root: string, raw: string): Promise<GitBranches> { return this.changeBranch(root, raw, false); }
  async createBranch(root: string, raw: string): Promise<GitBranches> { return this.changeBranch(root, raw, true); }
  async worktrees(root: string): Promise<GitWorktree[]> { return parseGitWorktrees(await this.run(root, ['worktree', 'list', '--porcelain', '-z'])); }
  async createWorktree(root: string, raw: CreateWorktree): Promise<WorktreeCreated> {
    const input = createWorktreeSchema.parse(raw);
    return this.update(root, async () => {
      try { await this.run(root, ['check-ref-format', '--branch', input.branch]); } catch { throw new Error('Enter a valid Git branch name.'); }
      const snapshot = await this.branches(root), target = snapshot.branches.find(branch => branch.name === input.branch);
      if (input.mode === 'new' && target) throw new Error('This branch already exists.');
      if (input.mode === 'existing' && !target) throw new Error('This local branch no longer exists. Refresh the branch list.');
      if (input.mode === 'existing' && (target?.current || target?.worktreePath)) throw new Error('This branch is in use by another worktree.');
      if (snapshot.status.unborn) throw new Error('Create a commit before creating a worktree.');
      if (input.mode === 'new' && input.baseBranch && !snapshot.branches.some(branch => branch.name === input.baseBranch)) throw new Error('This base branch no longer exists. Refresh the branch list.');
      const commit = (await this.run(root, ['rev-parse', '--verify', input.mode === 'existing' ? `refs/heads/${input.branch}^{commit}` : input.baseBranch ? `refs/heads/${input.baseBranch}^{commit}` : 'HEAD^{commit}'])).trim();
      if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new Error('Git returned an invalid worktree base commit.');
      if (!isAbsolute(input.path) || ['.', '..'].includes(basename(input.path))) throw new Error('Choose an absolute worktree folder path.');
      let parent: string;
      try { parent = await realpath(dirname(input.path)); if (!(await stat(parent)).isDirectory()) throw new Error(); }
      catch { throw new Error('Choose an existing parent folder for the new worktree.'); }
      const path = join(parent, basename(input.path));
      for (const worktree of await this.worktrees(root)) {
        const displacement = relative(resolve(worktree.path), path);
        if (!displacement || displacement !== '..' && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement)) throw new Error('Choose a folder outside this repository’s existing worktrees.');
      }
      if (await lstat(path).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new Error('The target folder could not be checked. Choose another folder.'); })) throw new Error('The target folder already exists. Choose a new folder.');
      let failed = false;
      try { await this.run(root, ['worktree', 'add', ...(input.mode === 'new' ? ['--no-track', '-b', input.branch] : []), '--', path, input.mode === 'new' ? commit : input.branch]); }
      catch { failed = true; }
      const worktree = (await this.worktrees(root)).find(item => relative(path, resolve(item.path)) === '');
      if (!worktree || worktree.bare || !worktree.head || !worktree.branch || worktree.prunable !== undefined) throw new Error('Git could not create a complete worktree. Check the branch list and target folder before retrying; existing files are retained.');
      const actual = await realpath(path);
      return { worktree: { ...worktree, path: actual }, branches: await this.branches(root), ...(failed || worktree.branch !== input.branch || worktree.head !== commit ? { warning: 'post-add-error' as const } : {}) };
    });
  }
  private async changeBranch(root: string, raw: string, create: boolean): Promise<GitBranches> {
    const name = gitBranchNameSchema.parse(raw);
    return this.update(root, async () => {
      try { await this.run(root, ['check-ref-format', '--branch', name]); } catch { throw new Error('Enter a valid Git branch name.'); }
      const { status, branches } = await this.branches(root), target = branches.find(branch => branch.name === name);
      if (create && target) throw new Error('This branch already exists.');
      if (!create && !target) throw new Error('This local branch no longer exists. Refresh the branch list.');
      if (status.files.some(file => file.conflict)) throw new Error('Resolve merge conflicts before switching branches.');
      if (!create && target?.current) return { status, branches };
      if (!create && target?.worktreePath) throw new Error('This branch is in use by another worktree.');
      try { await this.run(root, ['switch', '--no-guess', ...(create ? ['-c', name] : ['--', name])]); }
      catch (error) {
        const actual = await this.branches(root);
        if (!actual.status.detached && actual.status.branch === name) return { ...actual, warning: 'post-switch-error' };
        throw error;
      }
      return this.branches(root);
    });
  }
  private path(root: string, path: string): string {
    if (!path || isAbsolute(path) || /[:\0]/.test(path)) throw new Error('Use a relative project file path.');
    const displacement = relative(resolve(root), resolve(root, path));
    if (!displacement || displacement === '..' || displacement.startsWith(`..${sep}`) || isAbsolute(displacement) || displacement.split(sep).some((part) => part.toLowerCase() === '.git')) throw new Error('This path is outside the selected project.');
    return displacement.split(sep).join('/');
  }
  async stage(root: string, paths: string[], staged: boolean): Promise<GitStatus> {
    return this.update(root, () => this.stageFiles(root, paths, staged));
  }
  private async stageFiles(root: string, paths: string[], staged: boolean): Promise<GitStatus> {
    if (!paths.length || paths.length > 1000) throw new Error('Choose between 1 and 1000 changed files.');
    const selected = paths.map((path) => this.path(root, path));
    const status = await this.status(root);
    if (selected.some((path) => !status.files.some((file) => this.path(root, file.path) === path || (file.originalPath && this.path(root, file.originalPath) === path)))) throw new Error('A selected file is no longer changed. Refresh the Git status.');
    if (staged) await this.run(root, ['add', '--', ...selected]);
    else await this.run(root, status.unborn ? ['rm', '--cached', '-f', '--', ...selected] : ['reset', '--quiet', 'HEAD', '--', ...selected]);
    return this.status(root);
  }
  async commit(root: string, message: string): Promise<GitStatus> {
    return this.update(root, () => this.commitFiles(root, message));
  }
  private async commitFiles(root: string, message: string): Promise<GitStatus> {
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
