import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { waitForDesktopPage } from './desktop-page.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.platform, 'win32', 'Portable-wrapper verification requires Windows');
const scratchRoot = resolve(tmpdir());
const space = await statfs(scratchRoot);
assert.ok(space.bavail * space.bsize >= 1_000_000_000, 'Portable verification requires 1 GB of free temporary space');
const directory = await mkdtemp(join(scratchRoot, 'qiyao-portable-'));
// Exercise long packaged assets while keeping the bootstrap executable's own
// path below MAX_PATH; the asset length is asserted in each real launch.
const extractionRoot = join(directory, `temporary-${'a'.repeat(Math.max(32, 128 - directory.length - 'temporary-'.length - 1))}`);
const data = join(directory, 'data');
const project = join(directory, 'project');
const portableDirectory = join(directory, '免安装 Nook');
for (const path of [extractionRoot, data, project, portableDirectory]) await mkdir(path);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const original = join(root, 'artifacts', `Nook-Portable-${metadata.version}-x64.exe`);
const executable = join(portableDirectory, 'Nook 免安装.exe');
await copyFile(original, executable);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const wrapperHash = sha256(await readFile(executable));
assert.equal(wrapperHash, sha256(await readFile(original)), 'The copied portable wrapper must match the built artifact');
const runFile = promisify(execFile);
const psEnv = { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') };
const systemSnapshot = async () => {
  const startedAt = Date.now();
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); $entries=@($roots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ } | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -match '^Nook(?:\\s|$)' } | Select-Object PSPath,DisplayName,UninstallString | Sort-Object PSPath); $links=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nook.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'Nook.lnk')) | ForEach-Object { if(Test-Path -LiteralPath $_) { @{Path=$_;Sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash} } }; @{Registry=$entries;Shortcuts=@($links)} | ConvertTo-Json -Depth 5 -Compress"], { windowsHide: true, timeout: 30_000, env: psEnv });
  const snapshot = JSON.parse(stdout);
  console.log('Portable system-snapshot timing', JSON.stringify({ elapsedMs: Date.now() - startedAt, timeoutMs: 30_000 }));
  return snapshot;
};
const ownedChildren = async () => {
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $prefix=$env:QIYAO_PORTABLE_SCRATCH+[IO.Path]::DirectorySeparatorChar; @(Get-CimInstance Win32_Process -Filter \"Name='Nook.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10_000, env: { ...psEnv, QIYAO_PORTABLE_SCRATCH: extractionRoot } });
  if (!stdout.trim()) return [];
  const value = JSON.parse(stdout); return Array.isArray(value) ? value : [value];
};
const initialSystem = await systemSnapshot();
const nonce = randomUUID();
const marker = `--qiyao-portable-verification=免安装测试 ${nonce}`;
const checks = [];
const errors = [];
const launches = [];
let application;
let succeeded = false;
const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };
async function waitUntil(operation, message, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await operation();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}
async function unpackedFiles(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await unpackedFiles(path, name));
    else {
      assert.ok(entry.isFile(), 'Packaged unpacked assets must contain only regular files and directories');
      const content = await readFile(path);
      files.push({ file: name, bytes: content.length, sha256: sha256(content) });
    }
  }
  return files;
}
async function debuggerEndpoint(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return null;
    return (await response.json()).find((item) => item.type === 'node')?.webSocketDebuggerUrl ?? null;
  } catch { return null; }
}
async function evaluateMain(endpoint, expression) {
  const socket = new WebSocket(endpoint);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Portable main-process operation timed out')), 5000);
      const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
      socket.addEventListener('error', () => finish(new Error('Portable main-process debugger failed')), { once: true });
      socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true } })), { once: true });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id === 1) finish(message.error || message.result?.exceptionDetails ? new Error('Portable main-process operation failed') : null, message.result?.result?.value);
      });
    });
  } finally { socket.close(); }
}
async function launch() {
  const inspector = await freePort();
  const cdp = await freePort();
  assert.notEqual(inspector, cdp, 'Portable debugger ports must be distinct');
  const env = { ...process.env, TEMP: extractionRoot, TMP: extractionRoot, QIYAO_DATA_DIRECTORY: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--inspect=127.0.0.1:${inspector}`, `--remote-debugging-port=${cdp}`, marker], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  let output = '';
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-65_536); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  application = { child, exited };
  const timing = { wrapperStartedAt: Date.now() }; launches.push(timing);
  // Cold extraction and copying precede the Electron process. Measure them
  // separately, retaining the existing 30-second application startup budget.
  const owned = await waitUntil(async () => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Portable wrapper exited during extraction: ${child.exitCode}\n${output}`);
    return (await ownedChildren()).find((item) => item.ParentProcessId === child.pid);
  }, 'Portable extraction did not start its own application', 120_000);
  timing.applicationObservedAt = Date.now();
  assert.ok(timing.applicationObservedAt - timing.wrapperStartedAt <= 120_000, 'Portable cold extraction exceeded its budget');
  console.log(`Portable extraction completed in ${timing.applicationObservedAt - timing.wrapperStartedAt} ms.`);
  const endpoints = await waitUntil(async () => {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Portable wrapper exited during startup: ${child.exitCode}`);
    const endpoint = await debuggerEndpoint(inspector);
    if (!endpoint) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${cdp}/json/version`, { signal: AbortSignal.timeout(1000) });
      const browser = response.ok && (await response.json()).webSocketDebuggerUrl;
      return browser ? { endpoint, browser } : null;
    } catch { return null; }
  }, 'Portable startup timed out', 30_000);
  const { endpoint } = endpoints;
  const main = await evaluateMain(endpoint, "({pid:process.pid,executable:process.execPath,arguments:process.argv,portableFile:process.env.PORTABLE_EXECUTABLE_FILE,portableDirectory:process.env.PORTABLE_EXECUTABLE_DIR,data:require('electron').app.getPath('userData')})");
  assert.equal(main.pid, owned.ProcessId, 'The main debugger must belong to the wrapper child');
  const extraction = dirname(main.executable);
  const scope = relative(extractionRoot, extraction);
  assert.ok(scope && scope !== '..' && !scope.startsWith(`..${sep}`) && !isAbsolute(scope), 'Portable child must belong to the isolated extraction directory');
  const longDocument = join(extraction, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'deps', 'winpty', 'misc', 'Font-Report-June2016', 'Windows10SetFontBugginess.txt');
  timing.longDocumentPathLength = longDocument.length;
  assert.ok(longDocument.length > 260, 'Portable cleanup must exercise an actual packaged document beyond MAX_PATH');
  assert.ok((await readFile(longDocument)).length > 0, 'The long-path packaged document must be retained and readable');
  assert.equal(main.portableFile, executable); assert.equal(main.portableDirectory, portableDirectory); assert.equal(main.data, data);
  assert.ok(main.arguments.includes(marker), 'Portable wrapper must forward an exact quoted Unicode argument');
  application.endpoint = endpoint; application.extraction = extraction; application.main = main;
  application.browser = await chromium.connectOverCDP(endpoints.browser, { timeout: 10_000 });
  const context = application.browser.contexts()[0];
  const page = await waitForDesktopPage(context, { timeoutMs: 10_000, hasExited: () => child.exitCode !== null || child.signalCode !== null });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('crash', () => errors.push('The portable renderer crashed.'));
  await waitUntil(() => page.evaluate(() => Boolean(window.qiyao)), 'Portable preload bridge did not become ready');
  timing.applicationReadyAt = Date.now();
  assert.ok(timing.applicationReadyAt - timing.applicationObservedAt <= 30_000, 'Portable Electron startup exceeded its original budget');
  application.page = page;
  return application;
}
async function close() {
  const current = application;
  assert.equal(current.page.isClosed(), false, 'The portable page must be live before requesting normal close');
  try { await current.page.evaluate(() => window.qiyao.windowAction('close')); }
  catch (error) {
    if (!current.page.isClosed() || !(error instanceof Error) || !/^page\.evaluate: Target page, context or browser has been closed(?:\r?\n|$)/.test(error.message)) throw error;
    console.log('Portable page closed before acknowledging the requested close; normal wrapper exit and extraction cleanup remain required.');
  }
  const exit = await Promise.race([current.exited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Portable wrapper did not exit normally')), 10_000);
    current.exited.then(() => clearTimeout(timer));
  })]);
  assert.equal(exit, 0, 'Portable wrapper must propagate the normal application exit');
  await current.browser.close();
  assert.equal(await stat(current.extraction).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error)), false, 'Portable extraction must be removed after normal exit');
  application = undefined;
}
try {
  await launch();
  pass('actual portable wrapper starts from a Chinese path with spaces and forwards exact Unicode arguments');
  const childHash = sha256(await readFile(application.main.executable));
  const nativeFiles = await unpackedFiles(join(root, 'artifacts', 'win-unpacked', 'resources', 'app.asar.unpacked'));
  assert.ok(nativeFiles.length > 0, 'The reference application must include unpacked assets');
  assert.deepEqual(await unpackedFiles(join(application.extraction, 'resources', 'app.asar.unpacked')), nativeFiles, 'Every unpacked asset must be extracted with its original relative name and exact bytes');
  const { stdout } = await runFile(process.execPath, [join(root, 'scripts', 'verify-package.mjs'), '--installer'], { windowsHide: true, timeout: 300_000, env: { ...process.env, QIYAO_AUDIT_DIRECTORY: application.extraction, QIYAO_AUDIT_KIND: 'portable' } });
  console.log(stdout.trim());
  pass('real extracted portable application retains all product, native, vendor and distribution files');
  await application.page.evaluate((path) => window.qiyao.saveProject({ id: 'portable-project', name: '免安装验证项目', path, instructions: '', createdAt: 1 }), project);
  await application.page.evaluate(() => window.qiyao.saveNote({ id: 'portable-note', title: '免安装持久化', content: 'PORTABLE_PERSISTENCE_EVIDENCE', createdAt: 1 }));
  const terminal = await application.page.evaluate(() => window.qiyao.terminalOpen('portable-project', { cols: 80, rows: 24 }));
  await waitUntil(() => application.page.evaluate(async () => (await window.qiyao.terminalList('portable-project')).some((item) => item.output.includes('PS '))), 'Portable native terminal did not become ready');
  await application.page.evaluate((id) => window.qiyao.terminalWrite(id, "Write-Output ('PORTABLE_' + 'PTY_EVIDENCE'); exit 7\r"), terminal.id);
  await waitUntil(() => application.page.evaluate(async () => (await window.qiyao.terminalList('portable-project')).some((item) => item.output.includes('PORTABLE_PTY_EVIDENCE') && item.exitCode === 7)), 'Portable PTY did not return the actual command output and exit code');
  await application.page.evaluate((id) => window.qiyao.terminalClose(id), terminal.id);
  pass('extracted portable native PTY returns real PowerShell output and exit code');
  const previousExtraction = application.extraction;
  await close();
  pass('normal application close exits the wrapper successfully and removes its extraction');
  const persisted = JSON.parse(await readFile(join(data, 'workspace.json'), 'utf8'));
  assert.ok(persisted.notes.some((note) => note.id === 'portable-note' && note.content === 'PORTABLE_PERSISTENCE_EVIDENCE'));
  const staleDocument = join(previousExtraction, 'cleanup-before-launch', 'b'.repeat(96), 'old-document.txt');
  assert.ok(staleDocument.length > 260);
  await mkdir(dirname(staleDocument), { recursive: true });
  await writeFile(staleDocument, nonce);
  await launch();
  assert.equal(application.extraction, previousExtraction, 'Restart must reuse the actual wrapper extraction target');
  assert.equal(await stat(staleDocument).then(() => true, (error) => error.code === 'ENOENT' ? false : Promise.reject(error)), false, 'Restart must remove the stale long-path document before extraction');
  const restored = await application.page.evaluate(() => window.qiyao.load());
  assert.ok(restored.notes.some((note) => note.id === 'portable-note' && note.content === 'PORTABLE_PERSISTENCE_EVIDENCE'));
  assert.equal(restored.projects.find((item) => item.id === 'portable-project').path, project);
  pass('a second real wrapper extraction removes stale long-path files and restores exact persisted notes and project scope');
  await close();
  pass('the restarted portable wrapper also exits normally and cleans its extraction');
  assert.equal(sha256(await readFile(executable)), wrapperHash);
  assert.deepEqual(await systemSnapshot(), initialSystem);
  pass('portable operation preserves its executable, existing installation registration and shortcuts');
  assert.deepEqual(errors, []);
  const result = { verifiedAt: new Date().toISOString(), version: metadata.version, variant: 'actual Windows portable wrapper', checks: checks.length, evidence: checks, wrapperSha256: wrapperHash, childExecutableSha256: childHash, launches, unpackedFilesVerified: nativeFiles.length, longPathCleanupVerified: true, runtimeErrors: errors, scope: 'Actual x64 portable wrapper, isolated data and temporary directories, Chinese/space path and exact forwarded Unicode arguments, complete extracted-package hashes and all unpacked-asset names/bytes including a retained document beyond MAX_PATH, real native PTY, cleanup of a stale long-path document before restart, two normal lifecycle exits, retained data and extraction cleanup. Cold extraction is measured separately with a 120-second budget; Electron startup retains 30 seconds. Default data location, native dialogs, other platforms and public release remain separate gates.' };
  await writeFile(join(root, 'verification', 'portable-result.json'), JSON.stringify(result, null, 2));
  succeeded = true;
} finally {
  if (application) {
    if (application.endpoint) await evaluateMain(application.endpoint, "require('electron').app.quit()").catch(() => {});
    if (application.browser) await application.browser.close().catch(() => {});
    // Cleanup is restricted to this newly created scratch directory and wrapper.
    await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $prefix=$env:QIYAO_PORTABLE_SCRATCH+[IO.Path]::DirectorySeparatorChar; Get-CimInstance Win32_Process -Filter \"Name='Nook.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { windowsHide: true, timeout: 10_000, env: { ...psEnv, QIYAO_PORTABLE_SCRATCH: extractionRoot } });
    if (application.child.exitCode === null) application.child.kill();
  }
  if (succeeded) {
    assert.equal(dirname(directory), scratchRoot); assert.match(basename(directory), /^qiyao-portable-[A-Za-z0-9]{6}$/);
    await rm(directory, { recursive: true, force: true });
  }
  else { console.error('Portable launch timing', launches); console.error(`Retained failed portable verification directory: ${directory}`); }
}
