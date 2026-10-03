import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { releaseNotes, releaseVersion, verifyRuntimeProof } from './release-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const runFile = promisify(execFile);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
try {
  assert.equal(process.argv.length, 3, 'Provide exactly one release tag');
  const metadata = await readJson('package.json');
  const release = releaseVersion(process.argv[2], metadata.version);
  const notes = releaseNotes(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), release.version);
  const { stdout } = await runFile('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true });
  const commit = stdout.trim(); assert.match(commit, /^[0-9a-f]{40}$/);
  const tagged = await runFile('git', ['rev-parse', '--verify', `${release.tag}^{commit}`], { cwd: root, windowsHide: true });
  assert.equal(tagged.stdout.trim(), commit, 'Build the exact tagged source before releasing');
  const changed = await runFile('git', ['diff', '--name-only', 'HEAD'], { cwd: root, windowsHide: true });
  const untracked = await runFile('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, windowsHide: true });
  assert.ok(`${changed.stdout}\n${untracked.stdout}`.split(/\r?\n/).filter(Boolean).every((path) => /^verification\/[a-z-]+-result\.json$/.test(path)), 'Release source must be committed; only generated verification results may differ');
  const proofs = {
    audit: await readJson('verification/package-audit-result.json'),
    desktop: await readJson('verification/packaged-result.json'),
    surfaces: await readJson('verification/surfaces-packaged-result.json'),
    branches: await readJson('verification/conversation-branches-packaged-result.json'),
    temporary: await readJson('verification/temporary-conversations-packaged-result.json'),
    portable: await readJson('verification/portable-result.json'),
    portableAudit: await readJson('verification/portable-package-audit-result.json'),
    bootstrap: await readJson('verification/distribution-bootstrap-result.json'),
    installer: await readJson('verification/pipeline-installer-result.json'),
  };
  verifyRuntimeProof(proofs);
  assert.equal(proofs.audit.version, release.version);
  assert.ok((await readJson('licenses/assets.json')).every((asset) => asset.status === 'verified'), 'Resolve every bundled asset before release');
  const directory = join(root, 'artifacts', 'release');
  await mkdir(directory, { recursive: true });
  assert.equal((await readdir(directory)).length, 0, 'Release output must start empty');
  const files = [`Qiyao-Setup-${release.version}-x64.exe`, `Qiyao-Portable-${release.version}-x64.exe`];
  const records = [];
  for (const file of files) {
    const content = await readFile(join(root, 'artifacts', file));
    const hash = sha256(content);
    const variant = file.includes('-Setup-') ? 'installer' : 'portable';
    assert.equal(hash, proofs.bootstrap.variants.find((item) => item.variant === variant).executableSha256, 'Bootstrap proof must match the release artifact');
    assert.equal(hash, variant === 'installer' ? proofs.installer.installerSha256 : proofs.portable.wrapperSha256, 'Execution proof must match the release artifact');
    await copyFile(join(root, 'artifacts', file), join(directory, file));
    records.push({ file, bytes: content.length, sha256: hash });
  }
  const source = `Qiyao-Source-${release.version}.zip`;
  await runFile('git', ['archive', '--format=zip', `--prefix=Qiyao-${release.version}/`, `--output=${join(directory, source)}`, commit], { cwd: root, windowsHide: true });
  records.push({ file: source, bytes: (await stat(join(directory, source))).size, sha256: sha256(await readFile(join(directory, source))) });
  await writeFile(join(directory, 'release-notes.md'), notes);
  await writeFile(join(directory, 'verification.json'), `${JSON.stringify({ ...release, commit, verifiedAt: new Date().toISOString(), artifacts: records, proofs }, null, 2)}\n`);
  const checksums = [...records.map((record) => `${record.sha256}  ${record.file}`), ...await Promise.all(['release-notes.md', 'verification.json'].map(async (file) => `${sha256(await readFile(join(directory, file)))}  ${file}`))];
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`);
  console.log(`Prepared ${release.tag}: exact tagged source, verified Windows artifacts, bilingual notes and SHA-256 values.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
