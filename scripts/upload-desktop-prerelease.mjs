import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const tag = process.env.RELEASE_TAG;
assert.match(tag ?? '', /^v\d+\.\d+\.\d+-alpha\.\d+$/);
const platform = process.env.RELEASE_PLATFORM;
const arch = process.env.RELEASE_ARCH;
assert.ok(['mac', 'linux'].includes(platform));
assert.ok(['x64', 'arm64'].includes(arch));
const run = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const release = JSON.parse(run(['release', 'view', tag, '--json', 'isPrerelease,isDraft,targetCommitish']));
assert.equal(release.isPrerelease, true, 'Only an explicitly published alpha release may receive these builds.');
assert.equal(release.isDraft, false);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const remote = JSON.parse(run(['api', `repos/${process.env.GH_REPO}/commits/${tag}`]));
assert.equal(remote.sha, head, 'The native build must match the release tag.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(tag, `v${metadata.version}`);
const extensions = platform === 'mac' ? ['.dmg', '.zip'] : ['.AppImage', '.deb'];
const files = (await readdir('artifacts')).filter(name => extensions.some(ext => name.endsWith(ext)));
assert.equal(files.length, 2, 'Each clean native build must produce both expected formats.');
const records = [];
for (const file of files) {
  const path = join('artifacts', file);
  assert.ok((await stat(path)).size > 0);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  records.push(`${hash.digest('hex')}  ${file}`);
}
const checksums = join('artifacts', `SHA256SUMS-${platform}-${arch}.txt`);
await writeFile(checksums, records.join('\n') + '\n');
run(['release', 'upload', tag, ...files.map(file => join('artifacts', file)), checksums]);
console.log(`Uploaded ${platform}/${arch}: ${files.join(', ')}`);
