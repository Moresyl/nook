import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.platform, 'win32', 'Windows shell integration verification requires Windows');
const runFile = promisify(execFile);
const builder = createRequire(import.meta.resolve('electron-builder'));
const library = createRequire(builder.resolve('app-builder-lib'));
const manifest = JSON.parse(await readFile(join(root, 'licenses', 'distribution.json'), 'utf8'));
const compiler = await library('./toolsets/windows').getMakeNsisPath(manifest.toolset);
const scratchRoot = resolve(tmpdir());
const scratch = await mkdtemp(join(scratchRoot, 'qiyao-shell-'));
const directory = join(scratch, '快捷方式 核验'); await mkdir(directory);
const appId = `Qiyao.Verification.${randomUUID().replaceAll('-', '')}`;
const escape = (value) => String(value).replaceAll('$', '$$').replaceAll('"', '$\\"');
const checks = [];
const installedLinks = process.env.QIYAO_INSTALLED_SHORTCUTS ? JSON.parse(process.env.QIYAO_INSTALLED_SHORTCUTS) : [];
if (installedLinks.length) {
  assert.ok(process.env.QIYAO_AUDIT_DIRECTORY, 'Installed shortcut verification requires the actual installation directory');
  assert.equal(installedLinks.length, 2, 'Verify both actual installer-owned shortcuts');
  assert.ok(installedLinks.every((path) => typeof path === 'string' && basename(path) === 'Nook.lnk'), 'Unexpected installed shortcut names');
}
let succeeded = false;
try {
  const executable = join(directory, '集成 核验.exe');
  const script = join(directory, 'fixture.nsi');
  const report = join(directory, 'fixture.ini');
  const target = join(process.env.SystemRoot, 'System32', 'cmd.exe');
  const shortcut = join(directory, '栖曜 测试.lnk');
  const repeat = join(directory, '再次 测试.lnk');
  const missing = join(directory, '不存在.lnk');
  const corrupt = join(directory, '损坏.lnk'); await writeFile(corrupt, 'not a shortcut');
  await writeFile(script, `Unicode true
Name "Qiyao shell fixture"
OutFile "${escape(executable)}"
RequestExecutionLevel user
SilentInstall silent
!include "${escape(join(root, 'identity', 'windows', 'shell.nsh'))}"
Section
SetOutPath "${escape(directory)}"
CreateShortcut "${escape(shortcut)}" "${escape(target)}" '/c echo "中文 参数"' "${escape(target)}" 0 "" "" "Original 中文 description"
StrCpy $0 "caller register zero"
StrCpy $9 "caller register nine"
Push "caller stack"
!insertmacro QiyaoSetShortcutAppID "${escape(shortcut)}" "${appId}"
WriteINIStr "${escape(report)}" Result Set "$qiyaoShellResult"
WriteINIStr "${escape(report)}" Result Register0 "$0"
WriteINIStr "${escape(report)}" Result Register9 "$9"
Pop $R0
WriteINIStr "${escape(report)}" Result Stack "$R0"
CopyFiles /SILENT "${escape(shortcut)}" "${escape(repeat)}"
!insertmacro QiyaoSetShortcutAppID "${escape(repeat)}" "${appId}.Updated"
WriteINIStr "${escape(report)}" Result Updated "$qiyaoShellResult"
!insertmacro QiyaoSetShortcutAppID "${escape(missing)}" "${appId}"
WriteINIStr "${escape(report)}" Result Missing "$qiyaoShellResult"
!insertmacro QiyaoSetShortcutAppID "${escape(corrupt)}" "${appId}"
WriteINIStr "${escape(report)}" Result Corrupt "$qiyaoShellResult"
!insertmacro QiyaoUnpinShortcut "${escape(shortcut)}"
WriteINIStr "${escape(report)}" Result Unpin "$qiyaoShellResult"
!insertmacro QiyaoClearAppDestinations "${appId}"
WriteINIStr "${escape(report)}" Result Destinations "$qiyaoShellResult"
${['', 'Qiyao Invalid', 'x'.repeat(129)].map((invalidId, index) => `!insertmacro QiyaoClearAppDestinations "${invalidId}"\nWriteINIStr "${escape(report)}" Result Invalid${index} "$qiyaoShellResult"\n!insertmacro QiyaoSetShortcutAppID "${escape(shortcut)}" "${invalidId}"\nWriteINIStr "${escape(report)}" Result InvalidSet${index} "$qiyaoShellResult"`).join('\n')}
SectionEnd
`);
  await runFile(compiler.path, ['-WX', '-INPUTCHARSET', 'UTF8', script], { env: { ...process.env, ...compiler.env }, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
  await runFile(executable, ['/S'], { windowsHide: true, timeout: 30_000 });
  const bytes = await readFile(report);
  const content = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le') : bytes.toString('utf8');
  const values = Object.fromEntries([...content.matchAll(/^([^=\r\n]+)=(.*)\r?$/gm)].map((match) => [match[1], match[2].trim()]));
  for (let index = 0; index < 3; index++) {
    assert.equal(Number(values[`Invalid${index}`]), -2147024809, 'Unsafe application identities must be rejected before cleanup');
    assert.equal(Number(values[`InvalidSet${index}`]), -2147024809, 'Unsafe application identities must not replace shortcut properties');
  }
  checks.push('Empty, spaced and oversized application identities are rejected before identity writes or destination cleanup');
  for (const field of ['Set', 'Updated']) assert.ok(Number(values[field]) >= 0, `${field} shortcut identity HRESULT: ${values[field]}`);
  assert.equal(values.Register0, 'caller register zero'); assert.equal(values.Register9, 'caller register nine'); assert.equal(values.Stack, 'caller stack');
  checks.push('Compiled original System-plugin integration preserves the caller registers and stack');
  for (const field of ['Missing', 'Corrupt']) assert.ok(Number(values[field]) < 0, `${field} shortcut must return a failed HRESULT`);
  assert.equal((await readFile(corrupt, 'utf8')), 'not a shortcut');
  checks.push('Missing and corrupt shortcuts return errors without altering the corrupt file');

  const reader = join(directory, 'reader.cjs'); const readerResult = join(directory, 'reader.json');
  const readerTrace = join(directory, 'reader-trace.jsonl');
  await mkdir(join(directory, 'reader-data'));
  await writeFile(reader, `const fs = require('node:fs');
const trace = phase => fs.appendFileSync(${JSON.stringify(readerTrace)}, JSON.stringify({ phase, at: Date.now() }) + '\\n');
trace('loaded');
let fixtureApp;
try {
  const { app, shell } = require('electron'); fixtureApp = app;
  app.setPath('userData', ${JSON.stringify(join(directory, 'reader-data'))});
  app.setAppUserModelId(${JSON.stringify(`${appId}.Reader`)});
  trace('configured');
  app.whenReady().then(() => {
    trace('ready');
    const result = ${JSON.stringify([shortcut, repeat, ...installedLinks])}.map((path, index) => { trace('read-' + index); const value = shell.readShortcutLink(path); trace('read-complete-' + index); return value; });
    fs.writeFileSync(${JSON.stringify(readerResult)}, JSON.stringify(result));
    trace('written');
    // This is a headless metadata command; all report writes are synchronous.
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
} catch (error) { console.error(error); if (fixtureApp) fixtureApp.exit(1); else process.exit(1); }
`);
  try {
    await runFile(builder.resolve('electron/dist/electron.exe'), [reader], { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    console.error(JSON.stringify({ code: error.code, signal: error.signal, killed: error.killed, stdout: error.stdout, stderr: error.stderr, trace: await readFile(readerTrace, 'utf8').catch(() => 'Reader trace was not created') }));
    throw error;
  }
  const details = JSON.parse(await readFile(readerResult, 'utf8'));
  for (let index = 0; index < 2; index++) {
    assert.equal(details[index].appUserModelId, index === 0 ? appId : `${appId}.Updated`);
    assert.equal(details[index].target.toLowerCase(), target.toLowerCase());
    assert.equal(details[index].cwd.toLowerCase(), directory.toLowerCase());
    assert.equal(details[index].args, '/c echo "中文 参数"');
    assert.equal(details[index].description, 'Original 中文 description');
  }
  checks.push('Independent Electron shell reads verify exact AppUserModelIDs and preserved Unicode target/arguments/working directory/description');
  for (const field of ['Unpin', 'Destinations']) assert.ok(Number.isInteger(Number(values[field])) && Number(values[field]) >= 0, `${field} fixture HRESULT: ${values[field]}`);
  checks.push('Unpin and destination cleanup execute only against isolated fixture shortcut and random AppUserModelID');
  if (installedLinks.length) {
    const installedDirectory = resolve(process.env.QIYAO_AUDIT_DIRECTORY);
    const installedExecutable = join(installedDirectory, 'Nook.exe');
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const records = [];
    for (let index = 0; index < installedLinks.length; index++) {
      const detail = details[index + 2];
      assert.equal(detail.appUserModelId, metadata.build.appId, 'Installed shortcut AppUserModelID must match the application');
      assert.equal(detail.target.toLowerCase(), installedExecutable.toLowerCase());
      assert.equal(detail.cwd.toLowerCase(), installedDirectory.toLowerCase());
      assert.equal(detail.args, '');
      assert.equal(detail.description, metadata.description);
      assert.equal(detail.icon.toLowerCase(), installedExecutable.toLowerCase());
      assert.equal(detail.iconIndex, 0);
      records.push({ file: basename(installedLinks[index]), appUserModelId: detail.appUserModelId, targetAndWorkingDirectoryVerified: true, descriptionVerified: true, iconVerified: true, sha256: createHash('sha256').update(await readFile(installedLinks[index])).digest('hex') });
    }
    await writeFile(join(root, 'verification', 'installed-shortcuts-result.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), records, executableSha256: createHash('sha256').update(await readFile(installedExecutable)).digest('hex'), scope: 'Read-only independent Electron shell inspection of the two actual installer-owned shortcuts. No physical pinned-item interaction is implied.' }, null, 2)}\n`);
    console.log('Verified exact actual installed shortcut AppUserModelIDs, targets, arguments, working directories, descriptions and icons.');
  }
  await writeFile(join(root, 'verification', 'shell-integration-result.json'), `${JSON.stringify({ verifiedAt: new Date().toISOString(), checks, results: { unpin: Number(values.Unpin), destinations: Number(values.Destinations) }, sourceSha256: createHash('sha256').update(await readFile(join(root, 'identity', 'windows', 'shell.nsh'))).digest('hex'), scope: 'Actual x86 NSIS/System calls and independent Windows shortcut reads. No existing user shortcut or application destination is changed. Physical pinned-item delivery and full installer integration remain separate checks.' }, null, 2)}\n`);
  succeeded = true;
  console.log(`Verified ${checks.length} isolated Windows shell integration checks.`);
} finally {
  if (succeeded) {
    assert.equal(dirname(scratch), scratchRoot); assert.match(basename(scratch), /^qiyao-shell-[A-Za-z0-9]{6}$/);
    await rm(scratch, { recursive: true, force: true });
  } else console.error(`Retained failed shell verification directory: ${scratch}`);
}
