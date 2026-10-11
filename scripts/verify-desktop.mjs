import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { waitForDesktopPage } from './desktop-page.mjs';
import { mainProcessReadyExpression } from './desktop-main-ready.mjs';
import { drainDesktopOutput } from './desktop-output.mjs';
import { observeDesktopProcesses } from './desktop-process-observation.mjs';
import { verifyDesktopExit } from './desktop-exit.mjs';
import { startStartupProfileExpression, summarizeStartupProfile } from './startup-profile.mjs';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import electronExecutable from 'electron';
import { oauthFixture } from '../verification/oauth-fixture.mjs';
import { verifyPlugins } from './verify-plugins.mjs';
import { verifyPluginCrash } from './verify-plugin-crash.mjs';
import { verifyConversations } from './verify-conversations.mjs';
import { verifyComposerDrafts } from './verify-composer-drafts.mjs';
import { verifyPersistence } from './verify-persistence.mjs';
import { verifyRichContent } from './verify-rich-content.mjs';
import { richReply } from '../verification/rich-content-fixture.mjs';
import { nativeProviderFixture } from '../verification/native-provider-fixture.mjs';
import { verifyNativeProviders, verifyNativeProviderRestart } from './verify-native-providers.mjs';
import { attachmentProviderFixture } from '../verification/attachment-provider-fixture.mjs';
import { verifyAttachments } from './verify-attachments.mjs';
import { verifyPdfPreview } from './verify-pdf-preview.mjs';
import { knowledgeProviderFixture } from '../verification/knowledge-provider-fixture.mjs';
import { verifyKnowledge } from './verify-knowledge.mjs';
import { verifyBackups } from './verify-backups.mjs';
import { verifyAutomations } from './verify-automations.mjs';
import { automationProviderFixture } from '../verification/automation-provider-fixture.mjs';
import { verifyDesktopIntegration } from './verify-desktop-integration.mjs';
import { verifyAssistantProfiles } from './verify-assistant-profiles.mjs';
import { verifyPromptTemplates } from './verify-prompt-templates.mjs';
import { verifyAssistantRecipes } from './verify-assistant-recipes.mjs';
import { verifyPromptTransfer } from './verify-prompt-transfer.mjs';
import { verifyReplyVersions } from './verify-reply-versions.mjs';
import { verifyMessageEdits } from './verify-message-edits.mjs';
import { verifyCommands } from './verify-commands.mjs';
import { verifySurfaces } from './verify-surfaces.mjs';
import { verifyMemories } from './verify-memories.mjs';
import { verifyProjectTree } from './verify-project-tree.mjs';
import { verifyProjectPreview } from './verify-project-preview.mjs';
import { verifyDiffDisposal } from './verify-diff-disposal.mjs';
import { verifyChatNavigation } from './verify-chat-navigation.mjs';
import { verifyConversationBranches } from './verify-conversation-branches.mjs';
import { verifyTemporaryConversations } from './verify-temporary-conversations.mjs';
import { verifyModelComparisons } from './verify-model-comparisons.mjs';
import { verifyMcpResourceSubscriptions } from './verify-mcp-resource-subscriptions.mjs';
import { verifyMcpBinaryFiles } from './verify-mcp-binary-files.mjs';
import { verifyMcpPdf } from './verify-mcp-pdf.mjs';
import { verifyQuickChat } from './verify-quick-chat.mjs';
import { modelComparisonFixture } from '../verification/model-comparison-fixture.mjs';
import { chatNavigationFixture } from '../verification/chat-navigation-fixture.mjs';
import { replyProviderFixture } from '../verification/reply-provider-fixture.mjs';
import { toolActivityFixture } from '../verification/tool-activity-fixture.mjs';
import { contextSummaryFixture } from '../verification/context-summary-fixture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Match Playwright's Electron loader for unattended CDP interaction, without changing product defaults.
const rendererTestSwitches = ['disable-background-timer-throttling', 'disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'];
// Keep exact native viewport fixtures independent of the host's fractional display scaling.
// The suite still exercises Electron zoom; actual system-DPI acceptance is separate.
const desktopDeviceScaleFactor = process.env.NOOK_TEST_SYSTEM_DPI_ONLY || process.env.NOOK_TEST_SYSTEM_DPI_HOME_ONLY ? '' : '1';
const scratchRoot = resolve(tmpdir());
const scratchSpace = await statfs(scratchRoot);
if (scratchSpace.bavail * scratchSpace.bsize < 1_000_000_000) throw new Error('Desktop verification needs at least 1 GB of free temporary disk space. Archive old test workspaces or choose another TMP directory.');
const directory = await mkdtemp(join(scratchRoot, 'qiyao-electron-'));
if (process.env.QIYAO_TEST_STARTUP_DIAGNOSTICS) console.log('Desktop verification workspace', directory);
if (process.env.QIYAO_TEST_WORKSPACE_SEED) {
  for (const name of ['workspace.json', 'credentials.json', 'skills', 'plugins']) await cp(join(process.env.QIYAO_TEST_WORKSPACE_SEED, name), join(directory, name), { recursive: true });
  const originals = join(process.env.QIYAO_TEST_WORKSPACE_SEED, 'document-originals');
  const info = await stat(originals).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (info) {
    if (!info.isDirectory()) throw new Error('The verification seed original-document store must be a directory.');
    await cp(originals, join(directory, 'document-originals'), { recursive: true });
  }
}
const screenshots = join(root, 'verification', 'screenshots');
const packaged = Boolean(process.env.QIYAO_TEST_EXECUTABLE);
await mkdir(screenshots, { recursive: true });
const calls = [];
const agentContent = `DESKTOP_AGENT_FILE_EVIDENCE\n${'Review line\n'.repeat(100)}`;
const projectDirectory = join(directory, 'project-fixture');
await mkdir(projectDirectory);
await writeFile(join(projectDirectory, 'README.md'), 'QIYAO_PROJECT_EVIDENCE\nBefore change\n');
const runFile = promisify(execFile);
await runFile('git', ['init', '-q', projectDirectory], { windowsHide: true });
await runFile('git', ['-C', projectDirectory, 'add', 'README.md'], { windowsHide: true });
await runFile('git', ['-C', projectDirectory, '-c', 'user.name=Qiyao verification', '-c', 'user.email=verification@localhost', 'commit', '-qm', 'fixture', '--no-gpg-sign'], { windowsHide: true });
await writeFile(join(projectDirectory, 'README.md'), 'QIYAO_PROJECT_EVIDENCE\nAfter change\n');
await writeFile(join(projectDirectory, '.env'), 'TEST_SECRET_MUST_BE_EXCLUDED');
await writeFile(join(projectDirectory, 'editor-fixture.ts'), 'export const value = 1;\n');
await runFile('git', ['-C', projectDirectory, 'config', 'user.name', 'Qiyao verification'], { windowsHide: true });
await runFile('git', ['-C', projectDirectory, 'config', 'user.email', 'verification@localhost'], { windowsHide: true });
await runFile('git', ['-C', projectDirectory, 'config', 'commit.gpgSign', 'false'], { windowsHide: true });
const providerErrors = [];
const toolActivityProviders = toolActivityFixture(directory);
const contextSummaryProviders = contextSummaryFixture();
const oauth = await oauthFixture();
const nativeProviders = nativeProviderFixture();
const attachmentProviders = attachmentProviderFixture();
const knowledgeProviders = knowledgeProviderFixture();
const automationProviders = automationProviderFixture();
const replyProviders = replyProviderFixture();
const messageEditProviders = replyProviderFixture('/message-edits/');
const commandProviders = replyProviderFixture('/commands/');
const chatNavigationProviders = chatNavigationFixture();
const modelComparisonProviders = modelComparisonFixture();
async function providerRequest(request, response) {
  if (await contextSummaryProviders.handle(request, response)) return;
  if (await toolActivityProviders.handle(request, response)) return;
  if (await chatNavigationProviders.handle(request, response)) return;
  if (await modelComparisonProviders.handle(request, response)) return;
  if (await replyProviders.handle(request, response)) return;
  if (await messageEditProviders.handle(request, response)) return;
  if (await commandProviders.handle(request, response)) return;
  if (await automationProviders.handle(request, response)) return;
  if (await knowledgeProviders.handle(request, response)) return;
  if (await attachmentProviders.handle(request, response)) return;
  if (await nativeProviders.handle(request, response)) return;
  if (request.url === '/plugin-evidence') { response.end('PLUGIN_NETWORK_EVIDENCE'); return; }
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'verification-model' }] })); return;
  }
  let body = ''; for await (const chunk of request) body += chunk;
  const input = JSON.parse(body); calls.push(input);
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const responses = request.url === '/v1/responses';
  const history = responses ? input.input : input.messages;
  if (input.tools?.length) {
    const results = history.filter((item) => responses ? item.type === 'function_call_output' : item.role === 'tool');
    const extension = input.tools.find((tool) => (tool.name ?? tool.function?.name).startsWith('mcp_'));
    const skillTool = input.tools.find((tool) => (tool.name ?? tool.function?.name) === 'load_skill');
    const pluginTool = input.tools.find((tool) => (tool.name ?? tool.function?.name).startsWith('plugin_'));
    if (extension || skillTool || pluginTool) {
      let tool; let text;
      if (pluginTool) {
        assert.equal(pluginTool.strict ?? pluginTool.function?.strict, false);
        const prompt = history.find((item) => item.role === 'user')?.content ?? '';
        if (!results.length) tool = { name: pluginTool.name ?? pluginTool.function.name, arguments: JSON.stringify(prompt.includes('写入') ? { action: 'write' } : prompt.includes('读取') ? { action: 'read' } : prompt.includes('联网') ? { action: 'network' } : prompt.includes('停止') ? { action: 'slow' } : {}) };
        else {
          const output = results[0].output ?? results[0].content;
          if (prompt.includes('拒绝')) { assert.ok(output.includes('declined')); text = '插件调用已拒绝。'; }
          else if (prompt.includes('写入')) { assert.ok(output.includes('"error":false')); text = '插件写入已验证。'; }
          else if (prompt.includes('联网')) { assert.ok(output.includes('PLUGIN_NETWORK_EVIDENCE')); text = '插件联网已验证。'; }
          else if (prompt.includes('读取')) { const document = JSON.parse(output); assert.ok(document.text.includes('QIYAO_PROJECT_EVIDENCE')); assert.match(document.sha256, /^[a-f0-9]{64}$/); assert.equal(document.credentialsBlocked, true); assert.ok(!output.includes('TEST_SECRET_MUST_BE_EXCLUDED')); text = '插件读取已验证。'; }
          else { assert.ok(output.includes('PLUGIN_TOOL_EVIDENCE') && output.includes('"node":"undefined"') && output.includes('"app":"undefined"')); text = '插件工具已验证。'; }
        }
      } else if (extension) {
        const prompt = history.find((item) => item.role === 'user')?.content ?? '';
        const resources = prompt.includes('读取MCP资源'); const prompts = prompt.includes('加载MCP提示词');
        if (resources || prompts) {
          const action = !results.length ? resources ? 'list_resources' : 'list_prompts' : resources ? 'read_resource' : 'get_prompt';
          if (results.length < 2) {
            const definition = input.tools.find((item) => (item.name ?? item.function?.name).startsWith(`mcp_${action}_`)); assert.ok(definition);
            if (results.length) assert.ok((results[0].output ?? results[0].content).includes(resources ? 'fixture://document' : 'review'));
            tool = { name: definition.name ?? definition.function.name, arguments: JSON.stringify(!results.length ? { offset: 0, limit: 50 } : resources ? { uri: 'fixture://document' } : { name: 'review', arguments: { topic: 'MODEL_PROMPT_EVIDENCE' } }) };
          } else { assert.ok((results[1].output ?? results[1].content).includes(resources ? 'MCP_RESOURCE_EVIDENCE' : 'MCP_PROMPT_EVIDENCE:MODEL_PROMPT_EVIDENCE')); text = resources ? 'MCP 资源调用已验证。' : 'MCP 提示词调用已验证。'; }
        } else {
          assert.equal(extension.strict ?? extension.function?.strict, false);
          if (!results.length) tool = { name: extension.name ?? extension.function.name, arguments: JSON.stringify({ text: 'MCP_DESKTOP_EVIDENCE' }) };
          else if (prompt.includes('拒绝MCP')) { assert.ok((results[0].output ?? results[0].content).includes('declined')); text = 'MCP 调用已拒绝。'; }
          else { assert.ok((results[0].output ?? results[0].content).includes('STDIO_EVIDENCE:MCP_DESKTOP_EVIDENCE')); text = 'MCP 真实工具已验证。'; }
        }
      } else {
        assert.ok(!(input.instructions ?? '').includes('FULL_SKILL_BODY'));
        if (!results.length) tool = { name: 'load_skill', arguments: JSON.stringify({ id: importedSkillId }) };
        else if (results.length === 1) { assert.ok((results[0].output ?? results[0].content).includes('FULL_SKILL_BODY')); tool = { name: 'read_skill_file', arguments: JSON.stringify({ id: importedSkillId, path: 'references/method.md' }) }; }
        else { assert.ok((results[1].output ?? results[1].content).includes('SKILL_DESKTOP_EVIDENCE')); text = '技能及参考资料已验证。'; }
      }
      if (responses) {
        const output = tool ? [{ type: 'function_call', id: `extension-function-${results.length}`, call_id: `extension-call-${results.length}`, ...tool }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }];
        response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`);
      } else response.end(`data: ${JSON.stringify({ choices: [{ delta: tool ? { tool_calls: [{ index: 0, id: `extension-call-${results.length}`, type: 'function', function: tool }] } : { content: text }, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const agent = input.tools.some((tool) => (tool.name ?? tool.function?.name) === 'write_file');
    if (agent) {
      const prompt = history.find((item) => item.role === 'user')?.content ?? '';
      const denied = prompt.includes('拒绝');
      const stopped = prompt.includes('停止');
      let tool;
      let text;
      if (!results.length) tool = { name: 'write_file', arguments: JSON.stringify({ path: denied ? 'denied-fixture.txt' : stopped ? 'stopped-fixture.txt' : 'agent-fixture.txt', content: agentContent, expected_sha256: null }) };
      else if (denied) { assert.ok((results[0].output ?? results[0].content).includes('denied')); text = '修改已拒绝。'; }
      else if (results.length === 1) tool = { name: 'run_command', arguments: JSON.stringify({ program: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "Write-Output 'DESKTOP_AGENT_COMMAND_EVIDENCE'; Get-Content 'agent-fixture.txt'"], timeout_ms: 15000 }) };
      else {
        assert.ok((results[1].output ?? results[1].content).includes('DESKTOP_AGENT_COMMAND_EVIDENCE'));
        assert.ok((results[1].output ?? results[1].content).includes('DESKTOP_AGENT_FILE_EVIDENCE'));
        text = '执行任务已验证。';
      }
      if (responses) {
        const output = tool ? [{ type: 'function_call', id: `agent-function-${results.length}`, call_id: `agent-call-${results.length}`, ...tool }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }];
        response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`);
      } else response.end(`data: ${JSON.stringify({ choices: [{ delta: tool ? { tool_calls: [{ index: 0, id: `agent-call-${results.length}`, type: 'function', function: tool }] } : { content: text }, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    if (results.length) {
      assert.equal(results.length, 4);
      const evidence = results.map((result) => responses ? result.output : result.content).join('\n');
      assert.ok(evidence.includes('QIYAO_PROJECT_EVIDENCE'));
      assert.ok(evidence.includes('+After change'));
      assert.ok(!evidence.includes('TEST_SECRET_MUST_BE_EXCLUDED'));
      const text = '项目证据已确认：文件读取、内容搜索和 Git 改动均成功。';
      if (responses) response.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] } })}\n\n`);
      else response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const tools = [
      { name: 'list_files', arguments: '{"path":""}' },
      { name: 'read_file', arguments: '{"path":"README.md","start_line":1,"max_lines":20}' },
      { name: 'search_files', arguments: '{"path":"","query":"QIYAO_PROJECT_EVIDENCE","case_sensitive":true,"max_results":10}' },
      { name: 'git_diff', arguments: '{}' },
    ];
    if (responses) {
      const output = tools.map((tool, index) => ({ type: 'function_call', id: `function-${index}`, call_id: `call-${index}`, ...tool }));
      response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`);
    } else response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: tools.map((tool, index) => ({ index, id: `call-${index}`, type: 'function', function: tool })) }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  const slow = input.messages.at(-1).content.includes('slow');
  if (slow) {
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'First partial response' } }] })}\n\n`);
    return;
  }
  const chunks = input.messages.at(-1).content === 'RICH_CONTENT_NATIVE' ? [richReply.slice(0, 120), richReply.slice(120, 320), richReply.slice(320)] : ['这是通过本地测试服务返回的 ', '**真实流式回复**。\n\n', '| 项目 | 状态 |\n| --- | --- |\n| 工作台 | 正常 |'];
  let index = 0;
  const timer = setInterval(() => {
    if (index >= chunks.length) { response.end('data: [DONE]\n\n'); clearInterval(timer); }
    else response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] })}\n\n`);
  }, 25);
  response.on('close', () => clearInterval(timer));
}
const server = createServer((request, response) => { void providerRequest(request, response).catch((error) => { providerErrors.push(String(error)); response.destroy(); }); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, QIYAO_DATA_DIRECTORY: directory, QIYAO_TEST_STARTUP_DIAGNOSTICS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let application;
let authorizationBrowser;
let oauthServerId;
let currentPage;
let count = 0;
const errors = [];
const rendererDiagnostics = [];
const workerUrls = [];
let importedSkillId;
function verified(label) { count++; console.log(`PASS ${label}`); }
async function waitForBridge(page, predicate, argument) {
  const waitStartedAt = Date.now();
  const deadline = waitStartedAt + 10_000;
  const polls = [];
  while (Date.now() < deadline) {
    const startedAt = Date.now();
    const reached = await page.evaluate(predicate, argument);
    polls.push({ startedAt, completedAt: Date.now(), reached: Boolean(reached) });
    if (polls.length > 16) polls.shift();
    if (reached) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.error('Bridge wait failure timing', JSON.stringify({ waitStartedAt, failedAt: Date.now(), originalDeadlineMs: 10_000, originalPollIntervalMs: 100, polls }));
  throw new Error('The desktop bridge did not reach the expected state.');
}
async function waitForCheckpoint(content) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const primary = join(directory, 'workspace.json');
    const bytes = await readFile(primary);
    const state = JSON.parse(bytes.toString('utf8'));
    const journalPath = join(directory, 'workspace.checkpoints.json');
    let journalBytes;
    try {
      assert.ok((await stat(journalPath)).size <= 8 * 1024 * 1024, 'The durable response journal exceeds its recovery bound.');
      journalBytes = await readFile(journalPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (journalBytes) {
      assert.ok(journalBytes.length <= 8 * 1024 * 1024);
      const saved = JSON.parse(journalBytes.toString('utf8')); const signature = await stat(primary, { bigint: true });
      if (saved.baseSha256 === createHash('sha256').update(bytes).digest('hex') && signature.ino !== 0n
        && saved.signature.ino === signature.ino.toString() && saved.signature.mtimeNs === signature.mtimeNs.toString()) {
        assert.ok(saved.schemaVersion === 1 || saved.schemaVersion === 2);
        assert.ok(Array.isArray(saved.threads) && saved.threads.length <= 10000);
        const indices = new Set();
        for (const { index, thread } of saved.threads) {
          assert.ok(Number.isInteger(index) && index >= 0 && index < state.threads.length && !indices.has(index));
          assert.equal(thread.id, state.threads[index].id); assert.ok(!thread.temporary); indices.add(index); state.threads[index] = thread;
        }
      }
    }
    if (state.threads.at(-1)?.messages.at(-1)?.content === content) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The running response was not checkpointed to disk.');
}
async function launch() {
  application = undefined; currentPage = undefined;
  const startedAt = Date.now();
  const child = spawn(process.env.QIYAO_TEST_EXECUTABLE || electronExecutable, ['--inspect=0', '--remote-debugging-port=0', ...(desktopDeviceScaleFactor ? [`--force-device-scale-factor=${desktopDeviceScaleFactor}`] : []), ...rendererTestSwitches.map((name) => `--${name}`), ...(packaged ? [] : [root])], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (process.env.QIYAO_TEST_STARTUP_DIAGNOSTICS) console.log('Desktop spawned', { pid: child.pid, executable: child.spawnfile });
  const stdoutBytes = drainDesktopOutput(child.stdout);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  let diagnostics = '';
  let nodeUrl;
  let startupInspected = false;
  const debuggerUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { console.error('Desktop startup diagnostics', { pid: child.pid, executable: child.spawnfile, elapsedMs: Date.now() - startedAt, stdoutBytes: stdoutBytes() }); child.kill(); reject(new Error(`Desktop startup timed out: ${diagnostics.slice(-4000)}`)); }, 30_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Desktop exited with ${code}: ${diagnostics.slice(-4000)}`)); });
    child.stderr.on('data', (data) => {
      diagnostics += data.toString();
      nodeUrl ??= diagnostics.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
      if (nodeUrl && process.env.QIYAO_TEST_STARTUP_INSPECT && !startupInspected) {
        startupInspected = true;
        void evaluateMain("({ready:require('electron').app.isReady(),phases:globalThis.qiyaoStartupDiagnostics?.(),windows:require('electron').BrowserWindow.getAllWindows().map(window=>({id:window.id,loading:window.webContents.isLoading()}))})")
          .then(state => console.log('Early startup observation', JSON.stringify({ elapsedMs: Date.now() - startedAt, state })))
          .catch(error => console.log('Early startup observation failed', error.message));
      }
      const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  assert.ok(nodeUrl, 'The test process must expose its own main-process debugger.');
  async function evaluateMain(expression) {
    const socket = new WebSocket(nodeUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    try {
      return await new Promise((resolve, reject) => {
        const timeoutError = new Error('Main-process test operation timed out');
        const operationError = new Error('Main-process test operation failed');
        const timer = setTimeout(() => reject(timeoutError), 5000);
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data);
          if (message.id === 1) {
            clearTimeout(timer);
            if (message.error || message.result?.exceptionDetails) {
              const detail = String(message.error?.message ?? message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text).split('\n')[0].slice(0, 300);
              operationError.message = `Main-process test operation failed: ${detail}`;
              reject(operationError);
            } else resolve(message.result?.result?.value);
          }
        });
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true } }));
      });
    } finally {
      await new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Main-process debugger did not disconnect')), 5000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.close();
      });
    }
  }
  let browser; let page;
  let forcedClose = false;
  let profiling = false;
  const finishProfile = async () => {
    if (!profiling) return;
    profiling = false;
    const profile = await evaluateMain('globalThis.qiyaoCaptureStartupProfile?.()').catch(() => undefined);
    console.log('Desktop startup CPU samples', JSON.stringify(summarizeStartupProfile(profile) ?? { unavailable: true }));
  };
  try {
    assert.equal(await evaluateMain(mainProcessReadyExpression), true);
    const activeRendererSwitches = await evaluateMain(`${JSON.stringify(rendererTestSwitches)}.filter(name => require('electron').app.commandLine.hasSwitch(name))`);
    assert.deepEqual(activeRendererSwitches, rendererTestSwitches, 'The explicit renderer test configuration must be active.');
    console.log('Desktop renderer test switches', JSON.stringify(activeRendererSwitches));
    const activeDeviceScaleFactor = await evaluateMain("require('electron').app.commandLine.getSwitchValue('force-device-scale-factor')");
    assert.equal(activeDeviceScaleFactor, desktopDeviceScaleFactor, 'The native viewport fixture must use its explicit device scale.');
    console.log('Desktop test device scale factor', activeDeviceScaleFactor || 'system default');
    profiling = await evaluateMain(startStartupProfileExpression).catch(() => false);
    browser = await chromium.connectOverCDP(debuggerUrl);
    page = await waitForDesktopPage(browser.contexts()[0], { hasExited: () => child.exitCode !== null || child.signalCode !== null });
    await finishProfile();
  } catch (error) {
    await finishProfile();
    const pendingRequests = await evaluateMain('process._getActiveRequests().map(request => request.constructor.name)').catch(() => undefined);
    console.error('Desktop pending startup operations', JSON.stringify(pendingRequests ?? { unavailable: true }));
    const main = await evaluateMain("({capturedAt:Date.now(),ready:require('electron').app.isReady(),startup:globalThis.qiyaoStartupDiagnostics?.(),memory:process.memoryUsage(),cpu:process.cpuUsage(),processes:require('electron').app.getAppMetrics(),windows:require('electron').BrowserWindow.getAllWindows().map(window=>({id:window.id,url:window.webContents.getURL(),visible:window.isVisible(),destroyed:window.isDestroyed()}))})").catch(() => undefined);
    console.error('Desktop page startup diagnostics', JSON.stringify({ pid: child.pid, elapsedMs: Date.now() - startedAt, exitCode: child.exitCode, signalCode: child.signalCode, pages: browser?.contexts().flatMap((context) => context.pages().map((page) => ({ url: page.url(), closed: page.isClosed() }))), main }));
    console.error(diagnostics.slice(-4000).replace(/ws:\/\/[^\s]+/g, '[test debugger]'));
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await browser?.close().catch(() => {});
    throw error;
  }
  currentPage = page;
  application = { evaluateMain, resize: (width, height) => evaluateMain(`require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('qiyao://app/') && new URL(w.webContents.getURL()).searchParams.get('view') !== 'quick-chat').setSize(${width}, ${height})`), close: async ({ quit = false } = {}) => {
    if (!forcedClose && child.exitCode === null && child.signalCode === null) {
      const closeDiagnostic = "({capturedAt:Date.now(),events:globalThis.qiyaoCloseEvents,operations:globalThis.qiyaoCloseOperations,processes:require('electron').app.getAppMetrics().map(p=>({pid:p.pid,type:p.type})),windows:require('electron').BrowserWindow.getAllWindows().map(w=>({id:w.id,destroyed:w.isDestroyed(),visible:w.isVisible()})),handles:process._getActiveHandles().map(h=>h.constructor.name),filesystem:globalThis.qiyaoFilesystemFailures,memory:process.memoryUsage(),cpu:process.cpuUsage()})";
      const closeSnapshot = await evaluateMain(closeDiagnostic).catch(() => undefined);
      const closeStartedAt = Date.now();
      const observationTimers = [];
      if (process.platform === 'win32' && process.env.QIYAO_TEST_CLOSE_PROCESS_DIAGNOSTICS) {
        const pids = closeSnapshot?.processes?.map(p => p.pid) ?? [child.pid];
        for (const delay of [2000, 6000]) observationTimers.push(setTimeout(() => {
          void observeDesktopProcesses(pids).then(processes => console.log('Desktop native close observation', JSON.stringify({ requestedAt: closeStartedAt, observedAt: Date.now(), processes }))).catch(error => console.log(error.message));
        }, delay));
      }
      exited.then(() => observationTimers.forEach(clearTimeout));
      if (quit) await evaluateMain("require('electron').app.quit()").catch(() => {}); else await page.evaluate(() => window.qiyao.windowAction('close')).catch(() => {});
      let forced = false;
      // Shutdown must run without a newly attached inspector. Progress is already recorded on stderr.
      await Promise.race([exited, new Promise((resolve) => { const timer = setTimeout(() => { forced = true; forcedClose = true; console.error('Desktop close diagnostics', JSON.stringify(closeSnapshot ?? 'Main process unavailable'), diagnostics.slice(-2000).replace(/ws:\/\/[^\s]+/g, '[test debugger]')); child.kill(); resolve(); }, Math.max(0, 10_000 - (Date.now() - closeStartedAt))); exited.then(() => clearTimeout(timer)); })]);
      observationTimers.forEach(clearTimeout);
      console.log('Desktop exit observation', JSON.stringify({ elapsedMs: Date.now() - closeStartedAt, forced, exitCode: child.exitCode, signalCode: child.signalCode }));
      for (const line of diagnostics.split('\n').filter(line => line.startsWith('Desktop shutdown resources '))) console.log(line);
      assert.equal(forced, false, 'The desktop must flush drafts and exit without being forcibly killed.');
    }
    if (!forcedClose) verifyDesktopExit(child.exitCode, child.signalCode);
    await browser.close().catch(() => {});
  } };
  if (process.env.NOOK_TEST_LOCAL_CRASH_DUMPS === '1') {
    const local = await application.evaluateMain("({directory:require('electron').app.getPath('crashDumps'),uploadToServer:require('electron').crashReporter.getUploadToServer()})");
    assert.equal(local.directory, join(directory, 'local-crash-dumps')); assert.equal(local.uploadToServer, false);
    console.log('Desktop local crash diagnostics', JSON.stringify(local));
  }
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => { if (event.type() === 'error' || event.type() === 'warning') rendererDiagnostics.push(event.text()); });
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  await application.evaluateMain(`(() => {
    const { app, BrowserWindow } = require('electron'); const os = require('node:os');
    globalThis.nookRendererExits = [];
    globalThis.nookResourceSnapshot = () => ({ capturedAt: Date.now(), memory: process.memoryUsage(), systemFreeMemory: os.freemem(), processes: app.getAppMetrics().map(item => ({ pid: item.pid, type: item.type, memory: item.memory })) });
    for (const window of BrowserWindow.getAllWindows()) window.webContents.on('render-process-gone', (_event, details) => {
      const row = { reason: details.reason, exitCode: details.exitCode, ...globalThis.nookResourceSnapshot() };
      globalThis.nookRendererExits.push(row); if (globalThis.nookRendererExits.length > 8) globalThis.nookRendererExits.shift();
      console.error('Desktop renderer exit', JSON.stringify(row));
    });
  })()`);
  await application.evaluateMain("globalThis.qiyaoFilesystemFailures=[]; globalThis.qiyaoAuditRename=require('node:fs/promises').rename; globalThis.qiyaoAuditWriteFile=require('node:fs/promises').writeFile; const recordFilesystemError=(error,path)=>globalThis.qiyaoFilesystemFailures.push({code:error.code,syscall:error.syscall,destination:String(path).split(String.fromCharCode(92)).pop().split('/').pop()}); require('node:fs/promises').rename=async(from,to)=>{ try { return await globalThis.qiyaoAuditRename(from,to); } catch(error) { recordFilesystemError(error,to); throw error; } }; require('node:fs/promises').writeFile=async(path,...args)=>{ try { return await globalThis.qiyaoAuditWriteFile(path,...args); } catch(error) { recordFilesystemError(error,path); throw error; } };");
  await application.evaluateMain(`
    globalThis.qiyaoWorkerEvents = [];
    const workerThreads = require('node:worker_threads');
    const OriginalWorker = workerThreads.Worker;
    workerThreads.Worker = class extends OriginalWorker {
      constructor(path, options) {
        super(path, options);
        const record = { file: String(options?.workerData?.name ?? '').slice(0, 160), startedAt: Date.now() };
        globalThis.qiyaoWorkerEvents.push(record);
        this.once('online', () => { record.onlineAt = Date.now(); });
        this.once('message', () => { record.messageAt = Date.now(); });
        this.once('error', error => { record.errorAt = Date.now(); record.errorCode = error.code; });
        this.once('exit', code => { record.exitAt = Date.now(); record.exitCode = code; });
      }
    };
  `);
  await application.evaluateMain("globalThis.qiyaoCloseEvents=[]; globalThis.qiyaoCloseOperations=[]; const handlers=require('electron').ipcMain._invokeHandlers; const original=handlers.get('qiyao:invoke'); const observed=new Set(['load','saveComposerDraft','activateThread','savePreferences','saveEditorDraft','saveMessageDraft','finishWindowClose']); handlers.set('qiyao:invoke',async function(...args){ if(!observed.has(args[1]))return original.apply(this,args); const row={method:args[1],startedAt:Date.now()}; if(globalThis.qiyaoCloseOperations.length>=64)globalThis.qiyaoCloseOperations.shift(); globalThis.qiyaoCloseOperations.push(row); try{return await original.apply(this,args);}finally{row.finishedAt=Date.now();} }); const recordClose=(event,extra={})=>{ const item={event,at:Date.now(),...extra}; globalThis.qiyaoCloseEvents.push(item); console.error('QIYAO_TEST_CLOSE',JSON.stringify(item)); }; for(const event of ['before-quit','will-quit','window-all-closed']) require('electron').app.on(event,()=>recordClose(event)); for(const w of require('electron').BrowserWindow.getAllWindows()) { w.on('close',event=>recordClose('window-close',{prevented:event.defaultPrevented})); w.on('closed',()=>recordClose('window-closed')); const send=w.webContents.send.bind(w.webContents); w.webContents.send=(channel,...args)=>{ if(channel==='qiyao:before-close') recordClose('draft-flush-requested'); return send(channel,...args); }; }");
  await page.getByLabel('消息', { exact: true }).waitFor();
  await application.evaluateMain(`
    const snapshotShutdown = event => {
      const handles = process._getActiveHandles().map(handle => ({
        type: handle.constructor.name,
        ...(handle.constructor.name === 'ChildProcess' ? { pid: handle.pid, exitCode: handle.exitCode, signalCode: handle.signalCode, connected: handle.connected } : {}),
        ...(handle.constructor.name === 'Socket' ? { destroyed: handle.destroyed, readable: handle.readable, writable: handle.writable } : {})
      }));
      console.error('Desktop shutdown resources', JSON.stringify({ event, at: Date.now(), handles, resources: process.getActiveResourcesInfo(), workers: globalThis.qiyaoWorkerEvents?.slice(-16), terminals: globalThis.qiyaoPtyDiagnostics?.slice(-16) }));
    };
    require('electron').app.on('will-quit', () => snapshotShutdown('will-quit'));
    require('electron').app.on('quit', () => snapshotShutdown('quit'));
    process.once('exit', () => snapshotShutdown('process-exit'));
  `);
  await application.evaluateMain(`
    globalThis.qiyaoModelTransportEvents = [];
    const diagnosticChannels = require('node:diagnostics_channel');
    const fixtureOrigin = ${JSON.stringify(new URL(endpoint).origin)};
    const observedRequests = new WeakMap();
    let requestSequence = 0;
    const recordTransport = (message, phase) => {
      try {
        const request = message.request;
        if (!request || String(request.origin) !== fixtureOrigin) return;
        const path = new URL(request.path, fixtureOrigin).pathname;
        if (!path.startsWith('/message-edits/') && !path.startsWith('/model-comparison/')) return;
        let record = observedRequests.get(request);
        if (!record) {
          record = { id: ++requestSequence, method: request.method, path, firstObservedAt: Date.now(), phases: [] };
          observedRequests.set(request, record);
          globalThis.qiyaoModelTransportEvents.push(record);
          if (globalThis.qiyaoModelTransportEvents.length > 64) globalThis.qiyaoModelTransportEvents.shift();
        }
        record.phases.push({ phase, at: Date.now() });
        if (phase === 'headers') record.statusCode = message.response?.statusCode;
        if (phase === 'error') {
          const safeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined;
          record.errorCode = safeCode(message.error?.code);
          record.causeCode = safeCode(message.error?.cause?.code);
        }
      } catch { /* Test diagnostics cannot alter the actual transport. */ }
    };
    for (const phase of ['create', 'bodySent', 'headers', 'trailers', 'error']) {
      diagnosticChannels.channel('undici:request:' + phase).subscribe(message => recordTransport(message, phase));
    }
  `);
  await application.evaluateMain(`
    globalThis.qiyaoPtyDiagnostics = [];
    const applicationRequire = require('node:module').createRequire(require('node:path').join(require('electron').app.getAppPath(), 'package.json'));
    const terminalPrototype = applicationRequire('node-pty/lib/terminal').Terminal.prototype;
    globalThis.qiyaoPtyModuleSources = { defaultTerminalPath: require.resolve('node-pty/lib/terminal'), applicationTerminalPath: applicationRequire.resolve('node-pty/lib/terminal'), sameModule: require('node-pty/lib/terminal').Terminal === applicationRequire('node-pty/lib/terminal').Terminal };
    const dataDescriptor = Object.getOwnPropertyDescriptor(terminalPrototype, 'onData');
    const exitDescriptor = Object.getOwnPropertyDescriptor(terminalPrototype, 'onExit');
    const observedTerminals = new WeakMap();
    const observedTerminal = terminal => {
      let record = observedTerminals.get(terminal);
      if (!record) {
        record = { registeredAt: Date.now(), pid: terminal.pid, processName: String(terminal.process).slice(-160), cols: terminal.cols, rows: terminal.rows, chunks: 0, characters: 0 };
        observedTerminals.set(terminal, record); globalThis.qiyaoPtyDiagnostics.push(record);
        if (globalThis.qiyaoPtyDiagnostics.length > 32) globalThis.qiyaoPtyDiagnostics.shift();
      }
      return record;
    };
    Object.defineProperty(terminalPrototype, 'onData', { ...dataDescriptor, get() {
      const register = dataDescriptor.get.call(this); const record = observedTerminal(this);
      return listener => register(data => { record.firstDataAt ??= Date.now(); record.lastDataAt = Date.now(); record.chunks++; record.characters += data.length; listener(data); });
    } });
    Object.defineProperty(terminalPrototype, 'onExit', { ...exitDescriptor, get() {
      const register = exitDescriptor.get.call(this); const record = observedTerminal(this);
      return listener => register(event => { record.exitedAt = Date.now(); record.exitCode = event.exitCode; listener(event); });
    } });
    globalThis.qiyaoTerminalProcessSnapshot = () => ({ capturedAt: Date.now(), moduleSources: globalThis.qiyaoPtyModuleSources, terminals: globalThis.qiyaoPtyDiagnostics.slice(-16), mainMemory: process.memoryUsage(),
      systemMemory: { free: require('node:os').freemem(), total: require('node:os').totalmem() },
      applicationProcesses: require('electron').app.getAppMetrics().slice(-16).map(item => ({ pid: item.pid, type: item.type, cpu: item.cpu, memory: item.memory })) });
  `);
  return page;
}
let suiteCompleted = false;
let surfaceResult;
let textHintResult;
let memoriesResult;
let projectPreviewResult;
let projectTreeResult;
let terminalLifecycleResult;
let rendererCloseResult;
let backupsFocusedResult;
let chatNavigationResult;
let branchNavigationResult;
let temporaryConversationsResult;
let modelComparisonsResult;
let mcpResourceSubscriptionsResult;
let mcpBinaryFilesResult;
let mcpPdfResult;
let quickChatResult;
let assistantRecipesResult;
let promptTransferResult;
let fullResult;
let systemDpiResult;
let systemDpiHomeResult;
let browserResult;
let projectBranchesResult;
let toolActivitiesResult;
let contextSummariesResult;
let projectWorktreesResult;
let worktreeSettingsResult;
let worktreeOverviewResult;
let worktreeConversationsResult;
let worktreeUpstreamResult;
try {
  let page = await launch();
  if (process.env.NOOK_TEST_WORKTREE_UPSTREAM_ONLY) {
    const { verifyWorktreeUpstream } = await import('./verify-worktree-upstream.mjs');
    const run = await verifyWorktreeUpstream({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } });
    page = run.page; worktreeUpstreamResult = run.result;
    assert.equal(count, 5); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_WORKTREE_CONVERSATIONS_ONLY) {
    const { verifyWorktreeConversations } = await import('./verify-worktree-conversations.mjs');
    const run = await verifyWorktreeConversations({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } });
    page = run.page; worktreeConversationsResult = run.result;
    assert.equal(count, 4); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_WORKTREE_OVERVIEW_ONLY) {
    const { verifyWorktreeOverview } = await import('./verify-worktree-overview.mjs');
    const run = await verifyWorktreeOverview({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } });
    page = run.page; worktreeOverviewResult = run.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_WORKTREE_SETTINGS_ONLY) {
    const { verifyWorktreeSettings } = await import('./verify-worktree-settings.mjs');
    const run = await verifyWorktreeSettings({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } });
    page = run.page; worktreeSettingsResult = run.result;
    assert.equal(count, 10); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_PROJECT_WORKTREES_ONLY) {
    const { verifyProjectWorktrees } = await import('./verify-project-worktrees.mjs');
    const run = await verifyProjectWorktrees({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } });
    page = run.page; projectWorktreesResult = run.result;
    assert.equal(count, 7); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_CONTEXT_SUMMARIES_ONLY) {
    const { verifyContextSummaries } = await import('./verify-context-summaries.mjs');
    const run = await verifyContextSummaries({ page, application, getApplication: () => application, directory, screenshots, endpoint, fixture: contextSummaryProviders, verified, waitForBridge, errors, restart: async () => { await application.close(); return launch(); } });
    page = run.page; contextSummariesResult = run.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_TOOL_ACTIVITIES_ONLY) {
    const { verifyToolActivities } = await import('./verify-tool-activities.mjs');
    const run = await verifyToolActivities({ page, application, getApplication: () => application, directory, screenshots, endpoint, fixture: toolActivityProviders, verified, waitForBridge, errors, restart: async () => { await application.close(); return launch(); } });
    page = run.page; toolActivitiesResult = run.result;
    assert.equal(count, 8); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_PROJECT_BRANCHES_ONLY) {
    const { verifyProjectBranches } = await import('./verify-project-branches.mjs');
    const result = await verifyProjectBranches({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } });
    page = result.page; projectBranchesResult = result.result;
    assert.equal(count, 8); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_BROWSER_ONLY) {
    await page.evaluate(() => window.qiyao.openQuickChat());
    const { verifyBrowser } = await import('./verify-browser.mjs');
    const result = await verifyBrowser({ page, application, getApplication: () => application, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } });
    page = result.page; browserResult = result.result;
    assert.equal(count, 14); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_SYSTEM_DPI_HOME_ONLY) {
    const { verifySystemDpiHome } = await import('./verify-system-dpi-home.mjs');
    const result = await verifySystemDpiHome({ page, application, getApplication: () => application, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
    page = result.page; systemDpiHomeResult = result.result;
    assert.equal(count, 13); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_SYSTEM_DPI_ONLY) {
    const { verifySystemDpi } = await import('./verify-system-dpi.mjs');
    const result = await verifySystemDpi({ page, application, getApplication: () => application, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
    page = result.page; systemDpiResult = result.result;
    assert.equal(count, 13); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_RENDERER_CLOSE_ONLY) {
    const { verifyRendererClose } = await import('./verify-renderer-close.mjs');
    rendererCloseResult = await verifyRendererClose({ page, application, directory, verified, waitForBridge, modelRequests: () => calls.length });
    assert.equal(count, 2); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.NOOK_TEST_BACKUPS_ONLY) {
    const result = await verifyBackups({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; backupsFocusedResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.NOOK_TEST_QUICK_CHAT_ONLY) {
    const result = await verifyQuickChat({ page, application, getApplication: () => application, directory, screenshots, endpoint, calls, errors, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; quickChatResult = result.result;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_PDF_PREVIEW_ONLY) {
    const result = await verifyPdfPreview({ page, application, directory, screenshots, verified, restart: async () => { await application.close(); return launch(); } }); page = result.page;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    await writeFile(join(root, 'verification', 'pdf-preview-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), runtimeErrors: errors, ...result.result }, null, 2));
  } else if (process.env.QIYAO_TEST_PLUGIN_CRASH_ONLY) {
    const result = await verifyPluginCrash({ page, application, directory, domain: new URL(endpoint).host, waitForBridge, verified });
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'plugin-crash-packaged-result.json' : 'plugin-crash-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...result }, null, 2));
  } else if (process.env.QIYAO_TEST_PROJECT_PREVIEW_INTEGRATION_ONLY) {
    const treeRun = await verifyProjectTree({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = treeRun.page; projectTreeResult = treeRun.result;
    projectPreviewResult = await verifyProjectPreview({ page, application, directory, screenshots, waitForBridge, verified });
    assert.equal(count, 17); assert.equal(calls.length, 0); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_PROJECT_PREVIEW_ONLY) {
    await page.evaluate(() => window.qiyao.openQuickChat());
    projectPreviewResult = await verifyProjectPreview({ page, application, directory, screenshots, waitForBridge, verified });
    assert.equal(count, 10); assert.equal(calls.length, 0); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_DIFF_ONLY) {
    await page.evaluate((path) => window.qiyao.saveProject({ id: 'verification-project', name: '验证项目', path, instructions: '', createdAt: 1 }), projectDirectory);
    await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click(); await page.getByRole('button', { name: '验证项目', exact: true }).click();
    await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'README.md', exact: true }).click(); await page.locator('.monaco-editor .view-lines').getByText(/QIYAO_PROJECT_EVIDENCE/).waitFor();
    await verifyDiffDisposal({ page, open: async () => { await page.getByRole('button', { name: '查看改动', exact: true }).click(); await page.locator('.change-row').getByRole('button', { name: /README.md/ }).click(); }, close: () => page.getByRole('button', { name: '文件', exact: true }).click() });
    verified('closing a real diff during its worker computation cancels the obsolete view before disposing text models');
    assert.equal(count, 1); assert.equal(calls.length, 0); assert.deepEqual(errors, []);
  } else if (process.env.QIYAO_TEST_PROMPT_TRANSFER_ONLY) {
    const result = await verifyPromptTransfer({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; promptTransferResult = result.result;
    assert.equal(count, 5); assert.equal(calls.length, 0); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_RECIPES_ONLY) {
    const result = await verifyAssistantRecipes({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; assistantRecipesResult = result.result;
    assert.equal(count, 4); assert.equal(calls.length, 0); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_MCP_PDF_ONLY) {
    const result = await verifyMcpPdf({ page, application, getApplication: () => application, root, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, endpoint, calls }); page = result.page; mcpPdfResult = result.result;
    assert.equal(count, 8); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_MCP_BINARY_ONLY) {
    const result = await verifyMcpBinaryFiles({ page, application, getApplication: () => application, root, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, modelRequests: () => calls.length }); page = result.page; mcpBinaryFilesResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_MCP_SUBSCRIPTIONS_ONLY) {
    const result = await verifyMcpResourceSubscriptions({ page, application, getApplication: () => application, root, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, modelRequests: () => calls.length }); page = result.page; mcpResourceSubscriptionsResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_MODEL_COMPARISONS_ONLY) {
    const result = await verifyModelComparisons({ page, application, getApplication: () => application, endpoint, directory, screenshots, fixture: modelComparisonProviders, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); } }); page = result.page; modelComparisonsResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_TEMPORARY_CHATS_ONLY) {
    const result = await verifyTemporaryConversations({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, calls }); page = result.page; temporaryConversationsResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  } else if (process.env.QIYAO_TEST_BRANCHES_ONLY) {
    const result = await verifyConversationBranches({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); }, modelRequests: () => calls.length }); page = result.page; branchNavigationResult = result.result;
    assert.equal(count, 9); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_CHAT_NAVIGATION_ONLY) {
    const result = await verifyChatNavigation({ page, application, getApplication: () => application, endpoint, directory, screenshots, fixture: chatNavigationProviders, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); } }); page = result.page; chatNavigationResult = result.result;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_TERMINAL_LIFECYCLE_ONLY) {
    const { verifyTerminalLifecycle } = await import('./verify-terminal-lifecycle.mjs');
    const result = await verifyTerminalLifecycle({ page, application, getApplication: () => application, directory, projectDirectory, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; terminalLifecycleResult = result.result;
    assert.equal(count, 6); assert.deepEqual(errors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_PROJECT_TREE_ONLY) {
    const result = await verifyProjectTree({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = result.page; projectTreeResult = result.result;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_MEMORIES_ONLY) {
    memoriesResult = await verifyMemories({ page, application, directory, screenshots, projectDirectory, waitForBridge, verified });
    assert.equal(count, 3); assert.deepEqual(errors, []);
  } else if (process.env.QIYAO_TEST_TEXT_HINTS_ONLY) {
    const { verifyTextHints } = await import('./verify-text-hints.mjs');
    textHintResult = await verifyTextHints({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge });
    assert.equal(count, 7); assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_SURFACES_ONLY) {
    surfaceResult = await verifySurfaces({ page, application, screenshots, verified, waitForBridge });
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []); assert.equal(calls.length, 0);
  } else if (process.env.QIYAO_TEST_COMMANDS_ONLY) {
    const commands = await verifyCommands({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: commandProviders, restart: async () => { await application.close(); return launch(); } }); page = commands.page;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    await writeFile(join(root, 'verification', packaged ? 'commands-packaged-result.json' : 'commands-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...commands.result }, null, 2));
  } else if (process.env.QIYAO_TEST_MESSAGE_EDITS_ONLY) {
    const edits = await verifyMessageEdits({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: messageEditProviders, restart: async () => { await application.close(); return launch(); } }); page = edits.page;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    await writeFile(join(root, 'verification', packaged ? 'message-edits-packaged-result.json' : 'message-edits-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...edits.result }, null, 2));
  } else if (process.env.QIYAO_TEST_REPLIES_ONLY) {
    const replies = await verifyReplyVersions({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: replyProviders, restart: async () => { await application.close(); return launch(); } }); page = replies.page;
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    await writeFile(join(root, 'verification', packaged ? 'reply-versions-packaged-result.json' : 'reply-versions-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...replies.result }, null, 2));
  } else if (process.env.QIYAO_TEST_PROMPTS_ONLY) {
    const prompts = await verifyPromptTemplates({ page, application, getApplication: () => application, directory, projectDirectory, endpoint, screenshots, calls, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = prompts.page;
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'prompt-templates-packaged-result.json' : 'prompt-templates-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...prompts.result }, null, 2));
  } else if (process.env.QIYAO_TEST_ASSISTANTS_ONLY) {
    const assistants = await verifyAssistantProfiles({ page, application, getApplication: () => application, directory, endpoint, screenshots, calls, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = assistants.page;
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'assistant-profiles-packaged-result.json' : 'assistant-profiles-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...assistants.result }, null, 2));
  } else if (process.env.QIYAO_TEST_SHELL_ONLY) {
    const desktop = await verifyDesktopIntegration({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, restart: async (options) => { await application.close(options); return launch(); } }); page = desktop.page;
    assert.deepEqual(errors, []); assert.deepEqual(automationProviders.errors, []);
    await writeFile(join(root, 'verification', packaged ? 'desktop-integration-packaged-result.json' : 'desktop-integration-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, ...desktop.result }, null, 2));
  } else if (process.env.QIYAO_TEST_AUTOMATIONS_ONLY) {
    const automations = await verifyAutomations({ page, application, getApplication: () => application, directory, projectDirectory, endpoint, screenshots, fixture: automationProviders, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = automations.page;
    assert.deepEqual(errors, []); assert.deepEqual(automationProviders.errors, []);
    await writeFile(join(root, 'verification', packaged ? 'automations-packaged-result.json' : 'automations-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, ...automations.result }, null, 2));
  } else if (process.env.QIYAO_TEST_BACKUPS_ONLY) {
    const backups = await verifyBackups({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = backups.page;
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'backups-packaged-result.json' : 'backups-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, ...backups.result }, null, 2));
  } else if (process.env.QIYAO_TEST_KNOWLEDGE_ONLY) {
    const knowledge = await verifyKnowledge({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, fixture: knowledgeProviders, restart: async () => { await application.close(); return launch(); } }); page = knowledge.page;
    assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'knowledge-packaged-result.json' : 'knowledge-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, ...knowledge.result }, null, 2));
  } else if (process.env.QIYAO_TEST_ATTACHMENTS_ONLY) {
    const attachments = await verifyAttachments({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, fixture: attachmentProviders, restart: async () => { await application.close(); return launch(); } }); page = attachments.page;
    assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'attachments-packaged-result.json' : 'attachments-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, ...attachments.result }, null, 2));
  } else if (process.env.QIYAO_TEST_NATIVE_PROVIDERS_ONLY) {
    const result = await verifyNativeProviders({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge, fixture: nativeProviders }); assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    page = await verifyNativeProviderRestart({ restart: async () => { await application.close(); return launch(); }, verified }); assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'native-providers-packaged-result.json' : 'native-providers-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, ...result }, null, 2));
  } else if (process.env.QIYAO_TEST_RICH_CONTENT_ONLY) {
    const richContent = await verifyRichContent({ page, application, endpoint, screenshots, verified, waitForBridge }); assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'rich-content-packaged-result.json' : 'rich-content-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors, richContent, scope: 'Native streaming formulas, syntax highlighting, code copy, isolated readonly Mermaid preview/source, dark/minimum window, hostile directives, no external requests and failure recovery. Clipboard writes use a renderer fixture; source data uses the isolated local provider.' }, null, 2));
  } else if (process.env.QIYAO_TEST_PERSISTENCE_ONLY) {
    const result = await verifyPersistence({ page, application, directory, endpoint });
    assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'persistence-packaged-result.json' : 'persistence-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', ...result }, null, 2));
    console.log(`Verified real Windows file-sharing recovery and ${result.cycles} streaming/draft cycles with ${result.reads} concurrent JSON reads.`);
  } else if (process.env.QIYAO_TEST_PLUGINS_ONLY) {
    await page.evaluate(async (url) => { await window.qiyao.saveProvider({ id: 'responses', name: 'Responses 验证', kind: 'responses', endpoint: url, models: ['verification-model'], hasKey: false }, 'local-verification-key'); }, endpoint);
    await page.evaluate(async (path) => { await window.qiyao.saveProject({ id: 'verification-project', name: '验证项目', path, instructions: '', createdAt: 1 }); }, projectDirectory);
    await page.reload(); await page.getByRole('heading', { name: '今天想做些什么？' }).waitFor();
    await verifyPlugins({ page, application, directory, projectDirectory, domain: new URL(endpoint).host, screenshots, verified, waitForBridge });
    assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []); console.log(`Verified ${count} focused plugin checks.`);
  } else if (process.env.QIYAO_TEST_CONVERSATIONS_ONLY) {
    await page.evaluate(async (url) => { await window.qiyao.saveProvider({ id: 'history', name: 'History verification', kind: 'ollama', endpoint: url, models: ['verification-model'], hasKey: false }); }, endpoint);
    await page.reload(); await page.getByRole('heading', { name: '今天想做些什么？' }).waitFor();
    page = await verifyConversations({ page, application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
    page = await verifyComposerDrafts({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
    assert.deepEqual(providerErrors, []); assert.deepEqual(errors, []); console.log(`Verified ${count} focused conversation checks.`);
  } else {
  await application.resize(1280, 840); await page.waitForFunction(() => innerWidth === 1280 && innerHeight === 840);
  memoriesResult = await verifyMemories({ page, application, directory, screenshots, projectDirectory, waitForBridge, verified });
  await page.screenshot({ path: join(screenshots, '01-home-light.png') });
  const metrics = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, sidebar: document.querySelector('.sidebar').getBoundingClientRect().width, composerRadius: getComputedStyle(document.querySelector('.composer')).borderRadius, color: getComputedStyle(document.body).color }));
  assert.ok(metrics.font.includes('Inter'));
  const loadedUiFonts = await page.evaluate(async () => Promise.all([400, 510, 590, 700].map(async (weight) => (await document.fonts.load(`${weight} 12px "Inter"`)).map((font) => ({ family: font.family, status: font.status })))));
  assert.ok(loadedUiFonts.every((fonts) => fonts.length > 0 && fonts.every((font) => font.family === 'Inter' && font.status === 'loaded')), 'All reference UI weights must load the local distributable font');
  assert.equal(metrics.sidebar, 264); assert.equal(metrics.composerRadius, '24px');
  verified('launch and reference UI geometry');

  await page.getByRole('button', { name: /^设置/ }).click();
  await page.getByRole('button', { name: '添加模型连接', exact: true }).click();
  await page.getByLabel('连接名称').fill('测试连接');
  await page.getByLabel('API 类型').selectOption('ollama');
  await page.getByLabel('API 地址').fill(endpoint);
  await page.getByRole('button', { name: '获取模型', exact: true }).click();
  await page.getByLabel('模型', { exact: true }).fill('verification-model');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByRole('dialog').getByText('测试连接', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  verified('provider form, model discovery, and persisted configuration');

  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好，检查工作台');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByLabel('助手回复', { exact: true }).getByText('真实流式回复', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  assert.equal(calls.length, 1);
  await page.screenshot({ path: join(screenshots, '02-conversation.png') });
  verified('real renderer-preload-main-provider streaming and Markdown');

  const originalReply = JSON.parse(JSON.stringify((await page.evaluate(() => window.qiyao.load())).threads[0].messages[1]));
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  const regenerated = await page.evaluate(() => window.qiyao.load());
  assert.equal(regenerated.threads[0].messages.length, 2);
  assert.equal(calls.length, 2);
  const retainedReply = regenerated.threads.find((thread) => thread.forkedFrom?.kind === 'reply'); assert.ok(retainedReply?.archived);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...retainedReply.messages[1], replyVersion: undefined })), originalReply);
  await waitForBridge(page, async ({ threadId, messageId }) => { const thread = (await window.qiyao.load()).threads.find((item) => item.id === threadId); return thread?.messages.at(-1)?.id === messageId && thread.messages.at(-1).status === 'complete'; }, { threadId: regenerated.threads[0].id, messageId: regenerated.threads[0].messages.at(-1).id });
  verified('retry preserves the complete original reply as an archived version without duplicate user messages');

  await page.getByRole('button', { name: '置顶聊天', exact: true }).click();
  await page.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
  await page.getByRole('button', { name: '从这里创建分支', exact: true }).last().click();
  await page.getByRole('button', { name: /你好，检查工作台 · 分支/ }).first().waitFor();
  const branched = await page.evaluate(() => window.qiyao.load()); assert.equal(branched.threads.length, 3);
  assert.equal(branched.threads.filter((thread) => thread.forkedFrom?.kind === 'branch').length, 1); assert.equal(branched.threads.filter((thread) => thread.forkedFrom?.kind === 'reply' && thread.archived).length, 1);
  await page.getByRole('button', { name: '归档聊天', exact: true }).click();
  await page.getByRole('button', { name: '取消归档', exact: true }).waitFor();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.locator('.list-row').filter({ hasText: '你好，检查工作台 · 分支' }).getByRole('button', { name: '恢复聊天', exact: true }).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '搜索聊天与命令' }).fill('检查');
  assert.equal(await page.getByRole('dialog').locator('.command-list > button[data-command-group="聊天"]').count(), 3);
  assert.equal(await page.getByRole('dialog').locator('.command-list > button[data-command-group="聊天"]').filter({ hasText: '你好，检查工作台 · 原回复' }).count(), 1);
  await page.keyboard.press('Escape');
  verified('pin, branch, archive, restore and full-text search');

  await page.getByRole('button', { name: '助手', exact: true }).click();
  await page.getByRole('button', { name: '创建助手', exact: true }).click();
  await page.getByLabel('助手名称').fill('验证助手');
  await page.getByLabel('简介').fill('自定义工作方式');
  await page.getByLabel('工作指令').fill('Respond concisely.');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('验证助手', { exact: true }).waitFor();
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('button', { name: '添加资料', exact: true }).click();
  await page.getByLabel('标题').fill('验证资料');
  await page.getByLabel('内容', { exact: true }).fill('用于验证的本地资料。');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('验证资料', { exact: true }).waitFor();
  await page.locator('.list-row').filter({ hasText: '验证资料' }).getByRole('button', { name: '用于对话', exact: true }).click();
  assert.ok((await page.getByRole('textbox', { name: '消息' }).inputValue()).includes('用于验证的本地资料'));
  verified('assistant creation, local notes and conversation context');

  await page.keyboard.press('Control+n');
  await page.getByRole('textbox', { name: '消息' }).fill('slow response');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('First partial response', { exact: true }).waitFor();
  await waitForCheckpoint('First partial response');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByText('已停止生成', { exact: true }).waitFor();
  verified('stop preserves a streamed partial response');

  await page.evaluate((path) => window.qiyao.saveProject({ id: 'verification-project', name: '验证项目', path, instructions: 'Inspect real evidence.', createdAt: Date.now() }), projectDirectory);
  await page.reload();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('button', { name: '验证项目', exact: true }).click();
  await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'README.md', exact: true }).click();
  await page.locator('.monaco-editor .view-lines').getByText(/QIYAO_PROJECT_EVIDENCE/).waitFor();
  await verifyDiffDisposal({ page, open: async () => { await page.getByRole('button', { name: '查看改动', exact: true }).click(); await page.locator('.change-row').getByRole('button', { name: /README.md/ }).click(); await page.locator('.monaco-diff-editor').getByText('After change', { exact: true }).waitFor(); }, close: () => page.getByRole('button', { name: '文件', exact: true }).click() });
  await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'editor-fixture.ts', exact: true }).click();
  await page.locator('.editor-actionbar .path-text').getByText('editor-fixture.ts', { exact: true }).waitFor();
  const editorInput = page.locator('.project-main-panel:not([hidden]) .monaco-editor textarea.inputarea');
  await editorInput.waitFor(); await editorInput.focus(); await editorInput.press('Control+End'); await page.keyboard.insertText('// DESKTOP_EDITOR_DRAFT\n');
  await waitForBridge(page, async () => (await window.qiyao.load()).editorDrafts.some((draft) => draft.text.includes('DESKTOP_EDITOR_DRAFT')));
  assert.equal((await page.evaluate(() => window.qiyao.load())).editorDrafts[0].path, 'editor-fixture.ts');
  assert.ok((await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('value = 1'));
  assert.ok(!(await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('DESKTOP_EDITOR_DRAFT'));
  await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.locator('.monaco-editor .view-lines').getByText('// DESKTOP_EDITOR_DRAFT', { exact: true }).waitFor();
  await writeFile(join(projectDirectory, 'editor-fixture.ts'), 'export const value = 2;\n// EXTERNAL_EDIT\n');
  await page.getByRole('button', { name: /^保存 Ctrl S$/ }).click();
  await page.getByRole('dialog', { name: '文件已被其他操作修改' }).waitFor();
  assert.ok((await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('EXTERNAL_EDIT'));
  await page.getByRole('button', { name: '保留草稿，更新比较基准', exact: true }).click();
  await editorInput.focus(); await editorInput.press('Control+s');
  await page.getByRole('status').getByText('已保存', { exact: true }).waitFor();
  assert.ok((await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('DESKTOP_EDITOR_DRAFT'));
  assert.ok(!(await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('EXTERNAL_EDIT'));
  assert.equal((await page.evaluate(() => window.qiyao.load())).editorDrafts.length, 0);
  await assert.rejects(page.evaluate(() => window.qiyao.prepareDocument('verification-project', '../outside.txt')));
  await page.getByRole('button', { name: '新建文件', exact: true }).click();
  await page.getByLabel('相对路径').fill('created-in-editor.txt'); await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.locator('.editor-actionbar .path-text').getByText('created-in-editor.txt', { exact: true }).waitFor();
  await editorInput.waitFor(); await editorInput.focus(); await page.keyboard.insertText('新建文件内容\n'); await editorInput.press('Control+s');
  await page.getByRole('status').getByText('已保存', { exact: true }).waitFor();
  const createdContents = await readFile(join(projectDirectory, 'created-in-editor.txt'), 'utf8');
  assert.match(createdContents, /^新建文件内容\r?\n$/);
  await editorInput.focus(); await editorInput.press('Control+End'); await page.keyboard.insertText('DISCARD_EDITOR_DRAFT');
  await page.getByRole('button', { name: '关闭 created-in-editor.txt', exact: true }).click();
  await page.getByRole('dialog', { name: '保留文件改动？' }).waitFor(); await page.getByRole('button', { name: '丢弃草稿', exact: true }).click();
  await page.getByRole('dialog', { name: '保留文件改动？' }).waitFor({ state: 'hidden' });
  assert.equal(await readFile(join(projectDirectory, 'created-in-editor.txt'), 'utf8'), createdContents);
  assert.equal((await page.evaluate(() => window.qiyao.load())).editorDrafts.length, 0);
  verified('scoped new-file creation, UTF-8 editing and explicit draft discard preserve saved contents');
  assert.ok(workerUrls.some((url) => url.startsWith('qiyao://app/') && url.includes('ts.worker')));
  await page.screenshot({ path: join(screenshots, '10-project-editor.png') });
  verified('offline Monaco workers, real editing, durable drafts, conflict comparison and Ctrl S save');
  await page.getByRole('button', { name: '查看改动', exact: true }).click();
  const changeRow = page.locator('.change-row').filter({ hasText: 'editor-fixture.ts' });
  await changeRow.getByRole('button', { name: '暂存', exact: true }).click();
  await page.getByLabel('提交信息').fill('Verify editor workflow');
  await page.getByRole('button', { name: '提交已暂存改动', exact: true }).click();
  await waitForBridge(page, async () => !(await window.qiyao.gitStatus('verification-project')).files.some((file) => file.path === 'editor-fixture.ts'));
  assert.equal((await runFile('git', ['-C', projectDirectory, 'log', '-1', '--format=%s'], { windowsHide: true })).stdout.trim(), 'Verify editor workflow');
  assert.ok((await runFile('git', ['-C', projectDirectory, 'diff', '--', 'README.md'], { windowsHide: true })).stdout.includes('After change'));
  await page.screenshot({ path: join(screenshots, '11-project-git.png') });
  verified('Git review, explicit staging and commit preserve unrelated working changes');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.locator('.terminal-tabs').getByRole('button', { name: '新建终端', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).some((terminal) => terminal.output.includes('PS ')));
  const terminalInput = page.locator('.xterm-helper-textarea'); await terminalInput.focus();
  await page.keyboard.type("Write-Output 'DESKTOP_PTY_EVIDENCE'", { delay: 5 }); await terminalInput.press('Enter');
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).some((terminal) => terminal.output.includes('DESKTOP_PTY_EVIDENCE')));
  await page.locator('.xterm-accessibility-tree').getByText('DESKTOP_PTY_EVIDENCE', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button', { name: '项目', exact: true }).click(); await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.locator('.xterm-accessibility-tree').getByText('DESKTOP_PTY_EVIDENCE', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.qiyao.terminalList('verification-project'))).length, 1);
  await page.evaluate(async () => { const terminal = (await window.qiyao.terminalList('verification-project'))[0]; await window.qiyao.terminalWrite(terminal.id, "$qiyaoChild = Start-Process -FilePath powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-Command','Start-Sleep 60') -PassThru -WindowStyle Hidden; Write-Output ('QIYAO_CHILD_PID=' + $qiyaoChild.Id)\r"); });
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).some((terminal) => /QIYAO_CHILD_PID=\d+/.test(terminal.output)));
  const childPid = Number((await page.evaluate(() => window.qiyao.terminalList('verification-project')))[0].output.match(/QIYAO_CHILD_PID=(\d+)/)[1]);
  assert.ok(childPid > 0); process.kill(childPid, 0);
  await page.screenshot({ path: join(screenshots, '12-project-terminal.png') });
  await page.getByRole('button', { name: '关闭终端 1', exact: true }).click(); await page.getByRole('button', { name: '结束会话', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).length === 0);
  const childDeadline = Date.now() + 5000; let childGone = false;
  while (Date.now() < childDeadline) { try { process.kill(childPid, 0); } catch { childGone = true; break; } await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal(childGone, true, 'Closing the owned PTY must terminate its child process.');
  await page.locator('.terminal-tabs').getByRole('button', { name: '新建终端', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).some((terminal) => terminal.output.includes('PS ')));
  await terminalInput.focus(); await page.keyboard.type('exit 7', { delay: 5 }); await terminalInput.press('Enter');
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project'))[0]?.exitCode === 7);
  await page.getByRole('button', { name: '关闭终端 1', exact: true }).click();
  verified('real interactive PowerShell PTY, ANSI replay, resize, natural exit and owned process-tree cleanup');
  await page.getByRole('button', { name: '新建项目聊天', exact: true }).click();
  await page.getByLabel('工作模式').selectOption('plan');
  await page.getByRole('textbox', { name: '消息' }).fill('分析项目并给出方案');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('项目证据已确认：文件读取、内容搜索和 Git 改动均成功。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  assert.equal(await page.locator('.tool-complete').count(), 4);
  await page.locator('.tool-activity-toggle').nth(1).click();
  await page.locator('.tool-detail').getByText(/Total lines: 3/).waitFor();
  await page.locator('.tool-detail[data-expanded="true"]').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: join(screenshots, '06-project-analysis.png') });
  verified('project file preview, Git diff and four real read-only model tools');

  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '添加连接', exact: true }).click();
  await page.getByLabel('连接名称').fill('Responses 验证');
  await page.getByLabel('API 类型').selectOption('responses');
  await page.getByLabel('API 地址').fill(endpoint);
  await page.getByLabel('API 密钥').fill('local-verification-key');
  await page.getByLabel('模型', { exact: true }).fill('verification-model');
  await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await page.getByRole('dialog').getByText('Responses 验证', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.keyboard.press('Control+n');
  await page.getByLabel('模型提供商').selectOption({ label: 'Responses 验证' });
  await page.getByLabel('选择项目').selectOption('verification-project');
  await page.getByLabel('工作模式').selectOption('plan');
  await page.getByRole('textbox', { name: '消息' }).fill('使用 Responses 分析项目');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('项目证据已确认：文件读取、内容搜索和 Git 改动均成功。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  assert.equal(await page.locator('.tool-complete').count(), 4);
  assert.equal(calls.at(-1).store, false);
  assert.equal(calls.at(-1).input.filter((item) => item.type === 'function_call_output').length, 4);
  verified('native Responses provider, encrypted key storage and full tool continuation');

  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'MCP 工具', exact: true }).click();
  await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByLabel('服务器名称').fill('验证 MCP'); await page.getByLabel('启动程序').fill(process.execPath);
  await page.getByLabel('启动参数').fill(JSON.stringify([join(root, 'verification/mcp-fixture.mjs')]));
  await page.getByLabel('工作目录').fill(root);
  await page.getByRole('button', { name: '保存服务器', exact: true }).click();
  await page.getByRole('button', { name: '连接', exact: true }).click(); await page.getByRole('button', { name: '断开', exact: true }).waitFor();
  await page.getByRole('button', { name: '工具 2', exact: true }).click(); await page.getByLabel('测试工具', { exact: true }).selectOption('echo');
  await page.getByLabel('测试参数').fill('{"text":"MANUAL_MCP_EVIDENCE"}'); await page.getByRole('button', { name: '执行测试', exact: true }).click();
  await page.getByLabel('工具测试结果').getByText(/STDIO_EVIDENCE:MANUAL_MCP_EVIDENCE/).waitFor();
  await page.screenshot({ path: join(screenshots, '16-mcp-settings.png') });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  verified('MCP settings, real SDK stdio handshake, catalog and explicit manual tool test');
  for (const [prompt, decision, outcome] of [['调用MCP工具', '允许这次执行', 'MCP 真实工具已验证。'], ['拒绝MCP工具', '拒绝', 'MCP 调用已拒绝。'], ['停止MCP工具', '停止任务', '已停止生成']]) {
    await page.keyboard.press('Control+n'); await page.getByLabel('模型提供商').selectOption({ label: 'Responses 验证' });
    await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); await page.locator('.toggle-label').filter({ hasText: '验证 MCP' }).click(); assert.equal(await page.getByRole('switch', { name: '验证 MCP', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: '完成', exact: true }).click(); await page.getByRole('textbox', { name: '消息' }).fill(prompt); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('dialog', { name: '审批 MCP 工具调用', exact: true }).waitFor();
    const pending = await page.evaluate(() => window.qiyao.pendingApprovals()); assert.equal(pending[0].details.toolName, 'echo');
    if (decision === '允许这次执行') {
      await page.screenshot({ path: join(screenshots, '17-mcp-approval.png') });
      await page.reload(); await page.getByRole('dialog', { name: '审批 MCP 工具调用', exact: true }).waitFor();
      await page.getByRole('dialog').getByRole('button', { name: decision, exact: true }).click();
      await waitForBridge(page, async () => (await window.qiyao.load()).threads.at(-1)?.messages.at(-1)?.content === 'MCP 真实工具已验证。');
      await page.locator('.thread-list > button').filter({ hasText: prompt }).click(); await page.getByText(outcome, { exact: true }).waitFor();
    } else { await page.getByRole('dialog').getByRole('button', { name: decision, exact: true }).click(); await page.getByText(outcome, { exact: true }).waitFor(); }
    assert.equal((await page.evaluate(() => window.qiyao.pendingApprovals())).length, 0);
  }
  verified('MCP in independent chat, non-strict optional schema, reload-safe approval, denial and cancellation');
  await page.keyboard.press('Control+n'); await page.getByRole('textbox', { name: '消息' }).fill('保留原有草稿');
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: 'MCP 工具', exact: true }).click(); await page.getByRole('button', { name: '资源与提示词', exact: true }).click();
  await page.getByLabel('服务器资源').selectOption('fixture://document'); await page.getByRole('button', { name: '读取资源', exact: true }).click(); await page.getByLabel('MCP 内容预览').getByText(/MCP_RESOURCE_EVIDENCE:fixture:\/\/document/).waitFor();
  await page.getByRole('button', { name: '刷新目录', exact: true }).click(); await page.getByLabel('MCP 内容预览').waitFor({ state: 'hidden' });
  await page.getByLabel('资源模板', { exact: true }).selectOption('fixture://profiles/{user}'); await page.getByLabel('资源参数 user', { exact: true }).fill('中文用户');
  assert.equal(await page.getByLabel('资源 URI', { exact: true }).inputValue(), `fixture://profiles/${encodeURIComponent('中文用户')}`);
  await page.getByRole('button', { name: '读取资源', exact: true }).click(); await page.getByLabel('MCP 内容预览').getByText(/MCP_RESOURCE_EVIDENCE:fixture:\/\/profiles/).waitFor();
  await page.screenshot({ path: join(screenshots, '20-mcp-resource.png') });
  await page.getByLabel('服务器资源').selectOption('fixture://binary'); await page.getByRole('button', { name: '读取资源', exact: true }).click(); await page.getByText(/application\/octet-stream · 2 字节/).waitFor(); assert.equal(await page.getByRole('button', { name: '用于对话', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '提示词', exact: true }).click(); await page.getByLabel('服务器提示词').selectOption('review');
  assert.equal(await page.getByRole('button', { name: '加载提示词', exact: true }).isDisabled(), true);
  await page.getByLabel('提示词参数 topic（必填）').fill('桌面验证主题'); await page.getByRole('button', { name: '加载提示词', exact: true }).click();
  await page.getByLabel('MCP 内容预览').getByText(/MCP_PROMPT_EVIDENCE:桌面验证主题/).waitFor(); await page.screenshot({ path: join(screenshots, '21-mcp-prompt.png') });
  await application.resize(760, 540); await page.waitForFunction(() => window.innerHeight === 540 && window.innerWidth === 760);
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.settings-detail'); return panel.scrollWidth > panel.clientWidth; }), false);
  await page.getByRole('button', { name: '用于对话', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '22-mcp-content-narrow.png') });
  await page.getByRole('button', { name: '用于对话', exact: true }).click();
  const addedContent = await page.getByRole('textbox', { name: '消息' }).inputValue(); assert.ok(addedContent.startsWith('保留原有草稿')); assert.ok(addedContent.includes('[user]')); assert.ok(addedContent.includes('PROMPT_EMBEDDED_RESOURCE'));
  await application.resize(1280, 840); await page.waitForFunction(() => window.innerWidth === 1280);
  verified('MCP content UI, URI templates, binary metadata, required prompt arguments, manual refresh, preserved composer draft and minimum-window layout');
  for (const [prompt, operation, outcome] of [['读取MCP资源', 'resources/read', 'MCP 资源调用已验证。'], ['加载MCP提示词', 'prompts/get', 'MCP 提示词调用已验证。']]) {
    await page.keyboard.press('Control+n'); await page.getByLabel('模型提供商').selectOption({ label: 'Responses 验证' });
    await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); await page.locator('.toggle-label').filter({ hasText: '验证 MCP' }).click(); await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('textbox', { name: '消息' }).fill(prompt); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('dialog', { name: '审批 MCP 工具调用', exact: true }).waitFor(); const pending = await page.evaluate(() => window.qiyao.pendingApprovals()); assert.equal(pending[0].details.toolName, operation);
    await page.getByRole('dialog').getByRole('button', { name: '允许这次执行', exact: true }).click(); await page.getByText(outcome, { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor(); assert.equal(await page.locator('.tool-complete').count(), 2);
  }
  verified('MCP resource/prompt discovery and model continuation with exact remote-read approvals');
  await application.evaluateMain("globalThis.qiyaoOriginalOpen = require('electron').shell.openExternal; globalThis.qiyaoAuthorizationUrl = ''; globalThis.qiyaoOpenCount = 0; require('electron').shell.openExternal = async (url) => { globalThis.qiyaoAuthorizationUrl = url; globalThis.qiyaoOpenCount++; };");
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: 'MCP 工具', exact: true }).click(); await page.getByRole('button', { name: '添加服务器', exact: true }).click();
  await page.getByLabel('服务器名称').fill('验证 OAuth'); await page.getByLabel('连接方式').selectOption('http'); await page.getByLabel('服务器地址').fill(oauth.endpoint); await page.getByLabel('身份验证').selectOption('oauth'); await page.getByLabel('授权范围').fill('fixture.read');
  await page.getByRole('button', { name: '保存服务器', exact: true }).click(); oauthServerId = (await page.evaluate(() => window.qiyao.load())).mcpServers.find((item) => item.name === '验证 OAuth').id;
  const oauthRow = page.locator('.extension-server').filter({ hasText: '验证 OAuth' });
  await oauthRow.getByRole('button', { name: '连接', exact: true }).click(); await oauthRow.getByText(/需要登录/).waitFor(); assert.equal(await application.evaluateMain('globalThis.qiyaoOpenCount'), 0);
  await oauthRow.getByRole('button', { name: '登录', exact: true }).click(); await oauthRow.getByRole('button', { name: '取消登录', exact: true }).waitFor();
  const cancelledUrl = await application.evaluateMain('globalThis.qiyaoAuthorizationUrl'); const cancelledCallback = new URL(cancelledUrl).searchParams.get('redirect_uri');
  await oauthRow.getByRole('button', { name: '取消登录', exact: true }).click(); await oauthRow.getByRole('button', { name: '连接', exact: true }).waitFor(); await assert.rejects(fetch(cancelledCallback));
  verified('OAuth settings, background auth-required state, explicit login and cancellation release the loopback callback');
  await oauthRow.getByRole('button', { name: '登录', exact: true }).click(); await oauthRow.getByRole('button', { name: '取消登录', exact: true }).waitFor();
  const authorizationUrl = await application.evaluateMain('globalThis.qiyaoAuthorizationUrl');
  authorizationBrowser = await chromium.launch({ channel: 'chrome', headless: true }); const authorizationPage = await authorizationBrowser.newPage();
  await authorizationPage.goto(authorizationUrl); await authorizationPage.getByRole('button', { name: '授权', exact: true }).click(); await authorizationPage.getByText('授权已收到。请返回工作台查看连接结果。', { exact: true }).waitFor();
  await oauthRow.getByRole('button', { name: '断开', exact: true }).waitFor(); await page.screenshot({ path: join(screenshots, '23-mcp-oauth.png') });
  await authorizationBrowser.close(); authorizationBrowser = undefined;
  await oauthRow.getByRole('button', { name: '工具 1', exact: true }).click(); await page.getByLabel('测试工具', { exact: true }).selectOption('authenticated_echo'); await page.getByLabel('测试参数').fill('{}'); await page.getByRole('button', { name: '执行测试', exact: true }).click(); await page.getByLabel('工具测试结果').getByText('OAUTH_PROTOCOL_EVIDENCE', { exact: true }).waitFor();
  oauth.expire(); const authorizedContent = await page.evaluate((id) => window.qiyao.mcpReadResource(id, 'fixture://authorized'), oauthServerId); assert.ok(authorizedContent.text.includes('OAUTH_RESOURCE_EVIDENCE')); assert.ok(oauth.requests.some((request) => request.grant === 'refresh_token'));
  assert.equal(await application.evaluateMain('globalThis.qiyaoOpenCount'), 2); await application.evaluateMain("require('electron').shell.openExternal = globalThis.qiyaoOriginalOpen; delete globalThis.qiyaoOriginalOpen;");
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  verified('real Chrome OAuth consent, dynamic registration, PKCE, encrypted tokens, authenticated tools/resources and silent refresh');
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '外观与交互', exact: true }).click(); await page.getByLabel('主题').selectOption('dark'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: 'MCP 工具', exact: true }).click(); await page.locator('.extension-server').filter({ hasText: '验证 MCP' }).getByRole('button', { name: '资源与提示词', exact: true }).click();
  await page.getByLabel('服务器资源').selectOption('fixture://document'); await page.getByRole('button', { name: '读取资源', exact: true }).click(); await page.getByLabel('MCP 内容预览').waitFor(); await page.screenshot({ path: join(screenshots, '24-mcp-resource-dark.png') });
  await application.resize(760, 540); await page.waitForFunction(() => window.innerWidth === 760 && window.innerHeight === 540);
  await page.getByLabel('资源模板', { exact: true }).selectOption('fixture://profiles/{user}'); await page.getByLabel('资源参数 user', { exact: true }).fill('x'.repeat(400)); await page.getByRole('button', { name: '读取资源', exact: true }).click(); await page.getByLabel('MCP 内容预览').waitFor();
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.settings-detail'); return panel.scrollWidth > panel.clientWidth; }), false);
  await page.getByRole('button', { name: '提示词', exact: true }).click(); await page.getByLabel('服务器提示词').selectOption('review'); await page.getByLabel('提示词参数 topic（必填）').fill('深色窄窗口'); await page.getByRole('button', { name: '加载提示词', exact: true }).click(); await page.getByLabel('MCP 内容预览').waitFor(); await page.screenshot({ path: join(screenshots, '25-mcp-prompt-dark-narrow.png') });
  await page.getByRole('button', { name: '← 返回服务器列表', exact: true }).click(); await oauthRow.locator('.row-content').click(); await page.getByLabel('身份验证').waitFor(); await page.screenshot({ path: join(screenshots, '26-mcp-oauth-dark-narrow.png') });
  assert.equal(await page.evaluate(() => { const panel = document.querySelector('.settings-detail'); return panel.scrollWidth > panel.clientWidth; }), false);
  await page.getByRole('button', { name: '保存服务器', exact: true }).scrollIntoViewIfNeeded(); assert.equal(await page.getByRole('button', { name: '保存服务器', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '外观与交互', exact: true }).click(); await page.getByLabel('主题').selectOption('light'); await page.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await application.resize(1280, 840); await page.waitForFunction(() => window.innerWidth === 1280);
  verified('MCP resource/prompt and OAuth settings in dark and minimum-window layouts, including long resource URI wrapping');
  const skillSource = join(directory, 'skill-fixture'); await mkdir(join(skillSource, 'references'), { recursive: true });
  await writeFile(join(skillSource, 'SKILL.md'), '---\nname: 验证技能\ndescription: 按需读取说明和参考资料\n---\nFULL_SKILL_BODY\nRead references/method.md.');
  await writeFile(join(skillSource, 'references/method.md'), 'SKILL_DESKTOP_EVIDENCE'); await writeFile(join(skillSource, 'LICENSE'), 'Retain original skill license');
  await application.evaluateMain(`globalThis.qiyaoOriginalDialog = require('electron').dialog.showOpenDialog; require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(skillSource)}] });`);
  await page.keyboard.press('Control+,'); await page.getByRole('button', { name: '本地技能', exact: true }).click(); await page.getByRole('button', { name: '导入技能…', exact: true }).click();
  await page.getByRole('button', { name: /验证技能 已启用/ }).click();
  await application.evaluateMain("require('electron').dialog.showOpenDialog = globalThis.qiyaoOriginalDialog; delete globalThis.qiyaoOriginalDialog;");
  await page.getByLabel('技能文件').selectOption('LICENSE'); await page.getByText('Retain original skill license', { exact: true }).waitFor();
  await page.locator('.toggle-label').filter({ hasText: '启用技能' }).click(); await waitForBridge(page, async () => !(await window.qiyao.load()).skills[0].enabled);
  await page.waitForFunction(() => !document.querySelector('input[role="switch"]').disabled);
  await page.locator('.toggle-label').filter({ hasText: '启用技能' }).click(); await waitForBridge(page, async () => (await window.qiyao.load()).skills[0].enabled);
  await page.getByLabel('技能文件').selectOption('references/method.md'); await page.getByText('SKILL_DESKTOP_EVIDENCE', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, '18-skill-settings.png') });
  importedSkillId = (await page.evaluate(() => window.qiyao.load())).skills[0].id;
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.keyboard.press('Control+n');
  await page.getByRole('button', { name: '选择工具与技能', exact: true }).click(); await page.locator('.toggle-label').filter({ hasText: '验证技能' }).click(); assert.equal(await page.getByRole('switch', { name: '验证技能', exact: true }).isChecked(), true); await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('textbox', { name: '消息' }).fill('使用技能整理资料'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('技能及参考资料已验证。', { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor(); assert.equal(await page.locator('.tool-complete').count(), 2);
  await page.screenshot({ path: join(screenshots, '19-skill-conversation.png') });
  verified('skill folder import through dialog fixture, preserved license, enable state and progressive load/read model continuation');
  const pluginVerification = await verifyPlugins({ page, application, directory, projectDirectory, domain: new URL(endpoint).host, screenshots, verified, waitForBridge }); const pluginId = pluginVerification.id;

  await page.keyboard.press('Control+n');
  await page.getByLabel('模型提供商').selectOption({ label: 'Responses 验证' });
  await page.getByLabel('选择项目').selectOption('verification-project');
  await page.getByLabel('工作模式').selectOption('agent');
  await page.getByRole('textbox', { name: '消息' }).fill('执行测试任务');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('dialog', { name: '审批新建文件' }).waitFor();
  await page.getByRole('dialog').getByText(/^DESKTOP_AGENT_FILE_EVIDENCE/).waitFor();
  await assert.rejects(readFile(join(projectDirectory, 'agent-fixture.txt')));
  await page.screenshot({ path: join(screenshots, '07-file-approval.png') });
  const approvalBottom = await page.getByRole('button', { name: '允许这次修改', exact: true }).boundingBox();
  assert.ok(approvalBottom.y + approvalBottom.height <= await page.evaluate(() => window.innerHeight));
  await application.resize(760, 620);
  await page.waitForFunction(() => window.innerWidth === 760);
  assert.equal((await page.getByRole('dialog').boundingBox()).width, 760);
  await page.screenshot({ path: join(screenshots, '09-narrow-approval.png') });
  const narrowApprovalBottom = await page.getByRole('button', { name: '允许这次修改', exact: true }).boundingBox();
  assert.ok(narrowApprovalBottom.y + narrowApprovalBottom.height <= 620);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('dialog[open]').contains(document.activeElement)), true);
  }
  await application.resize(1280, 840);
  await page.waitForFunction(() => window.innerWidth === 1280);
  await page.reload();
  await page.getByRole('dialog', { name: '审批新建文件' }).waitFor();
  assert.equal((await page.evaluate(() => window.qiyao.pendingApprovals())).length, 1);
  await page.getByRole('button', { name: '允许这次修改', exact: true }).click();
  await page.getByRole('dialog', { name: '审批命令执行' }).waitFor();
  assert.equal(await readFile(join(projectDirectory, 'agent-fixture.txt'), 'utf8'), agentContent);
  await page.getByRole('dialog').getByText(/DESKTOP_AGENT_COMMAND_EVIDENCE/).waitFor();
  await page.screenshot({ path: join(screenshots, '08-command-approval.png') });
  await page.getByRole('button', { name: '允许这次执行', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.thread-list').getByRole('button', { name: '执行测试任务', exact: true }).click();
  await page.getByText('执行任务已验证。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  assert.equal(await page.locator('.tool-complete').count(), 2);
  verified('reviewed file creation and approved real command execution through Responses');

  for (const [prompt, filename, button] of [['拒绝测试修改', 'denied-fixture.txt', '拒绝'], ['停止测试任务', 'stopped-fixture.txt', '停止任务']]) {
    await page.keyboard.press('Control+n');
    await page.getByLabel('选择项目').selectOption('verification-project');
    await page.getByLabel('工作模式').selectOption('agent');
    await page.getByRole('textbox', { name: '消息' }).fill(prompt);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('dialog', { name: '审批新建文件' }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click();
    if (button === '拒绝') await page.getByText('修改已拒绝。', { exact: true }).waitFor();
    else await page.getByText('已停止生成', { exact: true }).waitFor();
    await assert.rejects(readFile(join(projectDirectory, filename)));
    assert.equal((await page.evaluate(() => window.qiyao.pendingApprovals())).length, 0);
  }
  verified('denial and stopping pending approval prevent file modifications');

  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: '外观与交互', exact: true }).click();
  await page.getByLabel('主题').selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: join(screenshots, '03-settings-dark.png') });
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.keyboard.press('Control+n');
  await page.screenshot({ path: join(screenshots, '04-home-dark.png') });
  await application.resize(760, 620);
  await page.waitForFunction(() => window.innerWidth === 760);
  await page.screenshot({ path: join(screenshots, '05-narrow.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  verified('dark theme and narrow window geometry');

  await application.resize(1280, 840);
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('tree', { name: '项目文件', exact: true }).getByRole('treeitem', { name: 'editor-fixture.ts', exact: true }).click();
  await page.locator('.editor-actionbar .path-text').getByText('editor-fixture.ts', { exact: true }).waitFor();
  await editorInput.waitFor(); await editorInput.focus(); await editorInput.press('Control+End'); await page.keyboard.insertText('// FINAL_CLOSE_DRAFT\n');
  const beforeRestart = await page.evaluate(() => window.qiyao.load());
  await application.close();
  const storedAtClose = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
  assert.ok(storedAtClose.editorDrafts[0].text.includes('FINAL_CLOSE_DRAFT'));
  assert.ok(!(await readFile(join(projectDirectory, 'editor-fixture.ts'), 'utf8')).includes('FINAL_CLOSE_DRAFT'));
  page = await launch();
  const afterRestart = await page.evaluate(() => window.qiyao.load());
  assert.deepEqual({ ...afterRestart, editorDrafts: [] }, JSON.parse(JSON.stringify({ ...beforeRestart, editorDrafts: [] })));
  assert.deepEqual(afterRestart, storedAtClose);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(afterRestart.threads.filter((thread) => thread.mode === 'plan').flatMap((thread) => thread.messages).flatMap((message) => message.activities ?? []).length, 8);
  verified('restart restores threads, models, projects, tools, notes, assistants and theme');
  await waitForBridge(page, async () => (await window.qiyao.pluginViews())[0]?.status === 'running');
  const restartedPlugin = await page.evaluate((id) => window.qiyao.pluginCommand(id, 'greet', {}), pluginId); assert.equal(restartedPlugin.count, 4); assert.equal(restartedPlugin.node, 'undefined');
  verified('actual app restart reactivates the previously authorized plugin and retains its isolated storage');
  await application.evaluateMain("globalThis.qiyaoOriginalOpen = require('electron').shell.openExternal; globalThis.qiyaoOpenCount = 0; require('electron').shell.openExternal = async () => { globalThis.qiyaoOpenCount++; };");
  assert.equal((await page.evaluate((id) => window.qiyao.mcpConnect(id), oauthServerId)).status, 'connected');
  assert.equal((await page.evaluate((id) => window.qiyao.mcpTestTool(id, 'authenticated_echo', '{}'), oauthServerId)).output, 'OAUTH_PROTOCOL_EVIDENCE');
  await page.evaluate((id) => window.qiyao.mcpForgetLogin(id), oauthServerId); assert.equal((await page.evaluate((id) => window.qiyao.mcpConnect(id), oauthServerId)).status, 'auth-required');
  assert.equal(await application.evaluateMain('globalThis.qiyaoOpenCount'), 0); await application.evaluateMain("require('electron').shell.openExternal = globalThis.qiyaoOriginalOpen; delete globalThis.qiyaoOriginalOpen;");
  verified('OAuth encrypted login survives actual app restart, reconnects without a browser and is cleared by explicit sign-out');
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.locator('.monaco-editor .view-lines').getByText('// FINAL_CLOSE_DRAFT', { exact: true }).waitFor();
  await page.screenshot({ path: join(screenshots, '13-draft-restored-dark.png') });
  await application.resize(760, 620); await page.waitForFunction(() => window.innerWidth === 760);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: join(screenshots, '14-project-narrow.png') });
  verified('native close flushes the latest editor input, preserves disk contents and restores a narrow dark editor');
  await application.resize(760, 540); await page.waitForFunction(() => window.innerHeight === 540);
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.locator('.terminal-tabs').getByRole('button', { name: '新建终端', exact: true }).click();
  await waitForBridge(page, async () => (await window.qiyao.terminalList('verification-project')).some((terminal) => terminal.output.includes('PS ')));
  const narrowPanels = await page.evaluate(() => { const terminal = document.querySelector('.project-terminal').getBoundingClientRect(); const editor = document.querySelector('.editor-canvas').getBoundingClientRect(); return { terminalTop: terminal.top, terminalBottom: terminal.bottom, editorHeight: editor.height, terminalHeight: terminal.height, windowHeight: window.innerHeight }; });
  assert.ok(narrowPanels.terminalTop >= 0 && narrowPanels.terminalBottom <= narrowPanels.windowHeight, JSON.stringify(narrowPanels));
  assert.ok(narrowPanels.editorHeight >= 60 && narrowPanels.terminalHeight >= 100, JSON.stringify(narrowPanels));
  await page.screenshot({ path: join(screenshots, '15-terminal-minimum-window.png') });
  verified('editor and terminal remain visible at the minimum supported 760 by 540 window size');
  page = await verifyConversations({ page, application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
  page = await verifyComposerDrafts({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } });
  const richContent = await verifyRichContent({ page, application, endpoint, screenshots, verified, waitForBridge });
  const nativeProviderResult = await verifyNativeProviders({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge, fixture: nativeProviders });
  page = await verifyNativeProviderRestart({ restart: async () => { await application.close(); return launch(); }, verified });
  const attachmentResult = await verifyAttachments({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, fixture: attachmentProviders, restart: async () => { await application.close(); return launch(); } }); page = attachmentResult.page;
  const pdfPreviewRun = await verifyPdfPreview({ page, application, directory, screenshots, verified, restart: async () => { await application.close(); return launch(); } }); page = pdfPreviewRun.page;
  const knowledgeStart = count;
  const knowledgeResult = await verifyKnowledge({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, fixture: knowledgeProviders, restart: async () => { await application.close(); return launch(); } }); page = knowledgeResult.page;
  await writeFile(join(root, 'verification', packaged ? 'knowledge-packaged-result.json' : 'knowledge-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - knowledgeStart, runtimeErrors: errors, ...knowledgeResult.result }, null, 2));
  const automationsStart = count;
  const automationsResult = await verifyAutomations({ page, application, getApplication: () => application, directory, projectDirectory, endpoint, screenshots, fixture: automationProviders, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = automationsResult.page;
  assert.deepEqual(automationProviders.errors, []);
  await writeFile(join(root, 'verification', packaged ? 'automations-packaged-result.json' : 'automations-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - automationsStart, runtimeErrors: errors, ...automationsResult.result }, null, 2));
  const desktopStart = count;
  const desktopResult = await verifyDesktopIntegration({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, restart: async (options) => { await application.close(options); return launch(); } }); page = desktopResult.page;
  assert.deepEqual(automationProviders.errors, []);
  await writeFile(join(root, 'verification', packaged ? 'desktop-integration-packaged-result.json' : 'desktop-integration-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - desktopStart, runtimeErrors: errors, ...desktopResult.result }, null, 2));
  const assistantsStart = count;
  const assistantsResult = await verifyAssistantProfiles({ page, application, getApplication: () => application, directory, endpoint, screenshots, calls, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = assistantsResult.page;
  await writeFile(join(root, 'verification', packaged ? 'assistant-profiles-packaged-result.json' : 'assistant-profiles-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - assistantsStart, runtimeErrors: errors, ...assistantsResult.result }, null, 2));
  const promptsStart = count;
  const promptsResult = await verifyPromptTemplates({ page, application, getApplication: () => application, directory, projectDirectory, endpoint, screenshots, calls, waitForBridge, verified, restart: async () => { await application.close(); return launch(); } }); page = promptsResult.page;
  await writeFile(join(root, 'verification', packaged ? 'prompt-templates-packaged-result.json' : 'prompt-templates-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - promptsStart, runtimeErrors: errors, ...promptsResult.result }, null, 2));
  const repliesStart = count;
  const repliesResult = await verifyReplyVersions({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: replyProviders, restart: async () => { await application.close(); return launch(); } }); page = repliesResult.page;
  await writeFile(join(root, 'verification', packaged ? 'reply-versions-packaged-result.json' : 'reply-versions-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - repliesStart, runtimeErrors: errors, ...repliesResult.result }, null, 2));

  const messageEditsStart = count;
  const messageEditsResult = await verifyMessageEdits({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: messageEditProviders, restart: async () => { await application.close(); return launch(); } }); page = messageEditsResult.page;
  await writeFile(join(root, 'verification', packaged ? 'message-edits-packaged-result.json' : 'message-edits-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - messageEditsStart, runtimeErrors: errors, ...messageEditsResult.result }, null, 2));
  const commandsStart = count;
  const commandResult = await verifyCommands({ page, application, getApplication: () => application, directory, endpoint, screenshots, waitForBridge, verified, fixture: commandProviders, restart: async () => { await application.close(); return launch(); } }); page = commandResult.page;
  await writeFile(join(root, 'verification', packaged ? 'commands-packaged-result.json' : 'commands-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - commandsStart, runtimeErrors: errors, ...commandResult.result }, null, 2));
  const backupsStart = count;
  const backupsResult = await verifyBackups({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = backupsResult.page;
  await writeFile(join(root, 'verification', packaged ? 'backups-packaged-result.json' : 'backups-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count - backupsStart, runtimeErrors: errors, ...backupsResult.result }, null, 2));
  const projectTreeRun = await verifyProjectTree({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = projectTreeRun.page; projectTreeResult = projectTreeRun.result;
  projectPreviewResult = await verifyProjectPreview({ page, application, directory, screenshots, waitForBridge, verified });
  const chatNavigationRun = await verifyChatNavigation({ page, application, getApplication: () => application, endpoint, directory, screenshots, fixture: chatNavigationProviders, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); } }); page = chatNavigationRun.page; chatNavigationResult = chatNavigationRun.result;
  const branchNavigationRun = await verifyConversationBranches({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); }, modelRequests: () => calls.length }); page = branchNavigationRun.page; branchNavigationResult = branchNavigationRun.result;
  assert.deepEqual(errors, []);
  assert.deepEqual(providerErrors, []);
  assert.deepEqual(oauth.errors, []);
  const temporaryConversationsRun = await verifyTemporaryConversations({ page, application, getApplication: () => application, endpoint, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, calls }); page = temporaryConversationsRun.page; temporaryConversationsResult = temporaryConversationsRun.result;
  assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  const modelComparisonRun = await verifyModelComparisons({ page, application, getApplication: () => application, endpoint, directory, screenshots, fixture: modelComparisonProviders, verified, waitForBridge, restart: async (beforeLaunch) => { await application.close(); await beforeLaunch?.(); return launch(); } }); page = modelComparisonRun.page; modelComparisonsResult = modelComparisonRun.result;
  assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  const mcpSubscriptionsRun = await verifyMcpResourceSubscriptions({ page, application, getApplication: () => application, root, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, modelRequests: () => calls.length }); page = mcpSubscriptionsRun.page; mcpResourceSubscriptionsResult = mcpSubscriptionsRun.result;
  assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  const mcpBinaryRun = await verifyMcpBinaryFiles({ page, application, getApplication: () => application, root, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, modelRequests: () => calls.length }); page = mcpBinaryRun.page; mcpBinaryFilesResult = mcpBinaryRun.result;
  const mcpPdfRun = await verifyMcpPdf({ page, application, getApplication: () => application, root, directory, screenshots, verified, waitForBridge, restart: async () => { await application.close(); return launch(); }, endpoint, calls }); page = mcpPdfRun.page; mcpPdfResult = mcpPdfRun.result;
  const recipeRun = await verifyAssistantRecipes({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = recipeRun.page; assistantRecipesResult = recipeRun.result;
  const transferRun = await verifyPromptTransfer({ page, application, getApplication: () => application, directory, screenshots, calls, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = transferRun.page; promptTransferResult = transferRun.result;
  const quickChatRun = await verifyQuickChat({ page, application, getApplication: () => application, directory, screenshots, endpoint, calls, errors, verified, waitForBridge, restart: async () => { await application.close(); return launch(); } }); page = quickChatRun.page; quickChatResult = quickChatRun.result;
  const { verifyBrowser } = await import('./verify-browser.mjs');
  const browserRun = await verifyBrowser({ page, application, getApplication: () => application, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } }); page = browserRun.page; browserResult = browserRun.result;
  const { verifyProjectBranches } = await import('./verify-project-branches.mjs');
  const projectBranchesRun = await verifyProjectBranches({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } }); page = projectBranchesRun.page; projectBranchesResult = projectBranchesRun.result;
  const { verifyProjectWorktrees } = await import('./verify-project-worktrees.mjs');
  const projectWorktreesRun = await verifyProjectWorktrees({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } }); page = projectWorktreesRun.page; projectWorktreesResult = projectWorktreesRun.result;
  const { verifyWorktreeSettings } = await import('./verify-worktree-settings.mjs');
  const worktreeSettingsRun = await verifyWorktreeSettings({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async () => { await application.close(); return launch(); } }); page = worktreeSettingsRun.page; worktreeSettingsResult = worktreeSettingsRun.result;
  const { verifyWorktreeOverview } = await import('./verify-worktree-overview.mjs');
  const worktreeOverviewRun = await verifyWorktreeOverview({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } }); page = worktreeOverviewRun.page; worktreeOverviewResult = worktreeOverviewRun.result;
  const { verifyWorktreeConversations } = await import('./verify-worktree-conversations.mjs');
  const worktreeConversationsRun = await verifyWorktreeConversations({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } }); page = worktreeConversationsRun.page; worktreeConversationsResult = worktreeConversationsRun.result;
  const { verifyWorktreeUpstream } = await import('./verify-worktree-upstream.mjs');
  const worktreeUpstreamRun = await verifyWorktreeUpstream({ page, application, getApplication: () => application, directory, screenshots, verified, waitForBridge, modelRequests: () => calls.length, restart: async beforeLaunch => { await application.close(); if (beforeLaunch) await beforeLaunch(); return launch(); } }); page = worktreeUpstreamRun.page; worktreeUpstreamResult = worktreeUpstreamRun.result;
  const { verifyToolActivities } = await import('./verify-tool-activities.mjs');
  const toolActivitiesRun = await verifyToolActivities({ page, application, getApplication: () => application, directory, screenshots, endpoint, fixture: toolActivityProviders, verified, waitForBridge, errors, restart: async () => { await application.close(); return launch(); } }); page = toolActivitiesRun.page; toolActivitiesResult = toolActivitiesRun.result;
  const { verifyContextSummaries } = await import('./verify-context-summaries.mjs');
  const contextSummariesRun = await verifyContextSummaries({ page, application, getApplication: () => application, directory, screenshots, endpoint, fixture: contextSummaryProviders, verified, waitForBridge, errors, restart: async () => { await application.close(); return launch(); } }); page = contextSummariesRun.page; contextSummariesResult = contextSummariesRun.result;
  assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
  const data = await readFile(join(directory, 'workspace.json'), 'utf8');
  assert.ok(data.includes('验证资料'));
  assert.ok(!(await readFile(join(directory, 'credentials.json'), 'utf8')).includes('local-verification-key'));
  const credentials = await readFile(join(directory, 'credentials.json'), 'utf8'); assert.ok(!credentials.includes('access-') && !credentials.includes('refresh-'));
  const screenshotNames = ['home-light', 'conversation', 'settings-dark', 'home-dark', 'narrow', 'project-analysis', 'file-approval', 'command-approval', 'narrow-approval', 'project-editor', 'project-git', 'project-terminal', 'draft-restored-dark', 'project-narrow', 'terminal-minimum-window', 'mcp-settings', 'mcp-approval', 'skill-settings', 'skill-conversation', 'mcp-resource', 'mcp-prompt', 'mcp-content-narrow', 'mcp-oauth', 'mcp-resource-dark', 'mcp-prompt-dark-narrow', 'mcp-oauth-dark-narrow', 'plugin-panel-light', 'plugin-panel-dark-narrow', 'plugin-approval', 'message-editor-light', 'message-editor-dark-narrow'];
  fullResult = { verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', checks: count, runtimeErrors: errors,
    scope: 'Desktop foundation, native model tools, approved execution, local code editing/drafts, Git review/stage/commit, interactive PTY terminals, MCP tools/resources/prompts/OAuth, local skills and core local plugin packages. Conversation checks cover selected-text quoting without sending, retained drafts/attachments, linked edit branches, validated retry, concurrent-history rejection, dark minimum-window dialogs and actual restart. Plugin checks use real sandboxed runtimes and isolated panels, model approvals, scoped file writes, stop/reload, grant revocation, renderer crash, startup deadline, complete backup restore and actual app restart. OAuth consent uses isolated Chrome; its external-launch boundary and native file/backup dialogs are intercepted only in the test process. Native picker/default-browser interaction, broader capabilities and release remain pending.',
    composerDraftScope: 'Per-owner text, attachments and selections; live backup restoration and fresh extension IDs; real filesystem rejection; close failure/timeout/cancellation/late receipt and actual restart; provider validation; sending during navigation and owner deletion. Native picker/confirmation dialogs and a close callback/filesystem replacement delay use isolated test fixtures.',
    richContent, nativeProviders: nativeProviderResult, attachments: attachmentResult.result, knowledge: knowledgeResult.result, automations: automationsResult.result, desktop: desktopResult.result, assistants: assistantsResult.result, prompts: promptsResult.result, replies: repliesResult.result, messageEdits: messageEditsResult.result, commands: commandResult.result, backups: backupsResult.result, projectTree: projectTreeRun.result, chatNavigation: chatNavigationRun.result, modelComparisons: modelComparisonRun.result, mcpResourceSubscriptions: mcpSubscriptionsRun.result, mcpBinaryFiles: mcpBinaryRun.result, pluginFonts: pluginVerification.fonts,
    richContentScope: 'Native streamed inline/display/fenced math with local reference fonts and accessible MathML; reference light/dark syntax colors including PowerShell; exact copy through a clipboard fixture; isolated readonly flowchart, sequence and class diagrams; SVG geometry/path preservation, theme/minimum-window layout and manual-scroll retention; inert hostile directives/HTML/remote math commands and complete malformed/oversized source recovery. Content substitutions are persisted through the bridge and reloaded.',
    screenshots: [...screenshotNames, 'composer-draft-dark-narrow', 'rich-content-light', 'rich-content-dark-narrow', 'rich-content-error-narrow', 'diagram-light', 'diagram-dark-narrow', 'native-provider-gemini', 'native-provider-responses', 'native-provider-chat', 'native-provider-deployment-chat', 'native-provider-dark-narrow', 'token-usage-light', 'token-usage-dark-narrow', 'token-usage-failed', 'model-capacity-dark-narrow', 'document-preview-light', 'image-preview-light', 'attachment-drag-light', 'image-preview-dark-narrow', 'knowledge-library-light', 'knowledge-source-light', 'knowledge-index-progress', 'knowledge-conversation-light', 'knowledge-source-dark-narrow', 'knowledge-library-dark-narrow', 'knowledge-settings-dark-narrow', 'backup-settings-light', 'backup-settings-dark-narrow', 'backup-export-progress', 'automation-list-light', 'automation-once-form-light', 'automation-history-light', 'automation-cron-dark-narrow', 'sidebar-history-dark-narrow', 'desktop-settings-light', 'desktop-settings-dark-narrow', 'desktop-error-dark-narrow', 'desktop-error-light', 'assistant-transfer-light', 'assistant-import-preview-light', 'assistant-import-error-dark-narrow', 'assistant-transfer-dark-narrow', 'prompt-templates-light', 'prompt-template-editor-light', 'prompt-template-preview-light', 'prompt-template-error-dark-narrow', 'prompt-templates-dark-narrow', 'reply-versions-light', 'reply-version-preview-light', 'reply-version-error-dark-narrow', 'reply-version-preview-dark-narrow', 'message-save-light', 'assistant-edit-preview-light', 'message-draft-conflict-dark-narrow', 'message-edit-save-error-dark-narrow', 'command-palette-light', 'plugin-command-preview-light', 'command-palette-error-dark-narrow', 'command-shortcuts-dark-narrow'].map((name, index) => `${String(index + 1).padStart(2, '0')}-${name}.png`).concat(projectTreeRun.result.screenshots, chatNavigationRun.result.screenshots) };
  fullResult.pdfPreview = pdfPreviewRun.result;
  fullResult.screenshots.push(...pdfPreviewRun.result.screenshots);
  }
  if (fullResult && branchNavigationResult) { fullResult.branchNavigation = branchNavigationResult; fullResult.screenshots.push(...branchNavigationResult.screenshots); }
  if (fullResult && temporaryConversationsResult) { fullResult.temporaryConversations = temporaryConversationsResult; fullResult.screenshots.push(...temporaryConversationsResult.screenshots); }
  if (fullResult && mcpBinaryFilesResult) fullResult.screenshots.push(...mcpBinaryFilesResult.screenshots);
  if (fullResult && mcpPdfResult) { fullResult.mcpPdf = mcpPdfResult; fullResult.screenshots.push(...mcpPdfResult.screenshots); }
  if (fullResult && assistantRecipesResult) { fullResult.assistantRecipes = assistantRecipesResult; fullResult.screenshots.push(...assistantRecipesResult.screenshots); }
  if (fullResult && promptTransferResult) { fullResult.promptTransfer = promptTransferResult; fullResult.screenshots.push(...promptTransferResult.screenshots); }
  if (fullResult && memoriesResult) { fullResult.memories = memoriesResult; fullResult.screenshots.push(...memoriesResult.screenshots); }
  if (fullResult && projectPreviewResult) { fullResult.projectPreview = projectPreviewResult; fullResult.screenshots.push(...projectPreviewResult.screenshots); }
  if (fullResult && quickChatResult) fullResult.quickChat = quickChatResult;
  if (fullResult && browserResult) { fullResult.browser = browserResult; fullResult.screenshots.push(...browserResult.screenshots, ...browserResult.tabs.screenshots); }
  if (fullResult && projectBranchesResult) { fullResult.projectBranches = projectBranchesResult; fullResult.screenshots.push(...projectBranchesResult.screenshots); }
  if (fullResult && projectWorktreesResult) { fullResult.projectWorktrees = projectWorktreesResult; fullResult.screenshots.push(...projectWorktreesResult.screenshots); }
  if (fullResult && worktreeSettingsResult) { fullResult.worktreeSettings = worktreeSettingsResult; fullResult.screenshots.push(...worktreeSettingsResult.screenshots); }
  if (fullResult && worktreeOverviewResult) { fullResult.worktreeOverview = worktreeOverviewResult; fullResult.screenshots.push(...worktreeOverviewResult.screenshots); }
  if (fullResult && worktreeConversationsResult) { fullResult.worktreeConversations = worktreeConversationsResult; fullResult.screenshots.push(...worktreeConversationsResult.screenshots); }
  if (fullResult && worktreeUpstreamResult) { fullResult.worktreeUpstream = worktreeUpstreamResult; fullResult.screenshots.push(...worktreeUpstreamResult.screenshots); }
  if (fullResult && toolActivitiesResult) { fullResult.toolActivities = toolActivitiesResult; fullResult.screenshots.push(...toolActivitiesResult.screenshots.map(capture => capture.filename)); }
  if (fullResult && contextSummariesResult) { fullResult.contextSummaries = contextSummariesResult; fullResult.screenshots.push(...contextSummariesResult.screenshots); }
  suiteCompleted = true;
} catch (error) {
  console.error(`Retained failed desktop verification directory: ${directory}`);
  if (application) console.error(await application.evaluateMain('globalThis.qiyaoFilesystemFailures').catch(() => 'Filesystem diagnostics unavailable'));
  if (application) console.error('File-worker diagnostics', await application.evaluateMain('({capturedAt:Date.now(),workers:globalThis.qiyaoWorkerEvents})').catch(() => 'Worker diagnostics unavailable'));
  if (application) console.error('Desktop resource diagnostics', JSON.stringify(await application.evaluateMain('({resources:globalThis.nookResourceSnapshot?.(),rendererExits:globalThis.nookRendererExits})').catch(() => ({ unavailable: true }))));
  if (application) console.error('Desktop geometry diagnostics', JSON.stringify(await application.evaluateMain(`(() => {
    const { BrowserWindow, screen } = require('electron');
    return {
      displays: screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor })),
      windows: BrowserWindow.getAllWindows().map(window => ({
        id: window.id, bounds: window.getBounds(), contentBounds: window.getContentBounds(),
        maximized: window.isMaximized(), fullscreen: window.isFullScreen(), zoomFactor: window.webContents.getZoomFactor(),
      })),
    };
  })()`).catch(() => ({ unavailable: true }))));
  if (application && process.env.QIYAO_TEST_SHELL_ONLY) console.error(await application.evaluateMain('globalThis.qiyaoDesktopAudit').catch(() => 'Desktop diagnostics unavailable'));
  if (rendererDiagnostics.length) console.error(rendererDiagnostics.join('\n'));
  if (providerErrors.length) console.error(providerErrors.join('\n'));
  if (currentPage) {
    console.error('Desktop viewport diagnostics', JSON.stringify(await currentPage.evaluate(() => ({
      width: innerWidth, height: innerHeight, devicePixelRatio,
      visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
    })).catch(() => ({ unavailable: true }))));
    await currentPage.screenshot({ path: join(screenshots, 'failure.png') }).catch(() => {});
    console.error(await currentPage.locator('body').innerText().catch(() => 'Could not read failed page.'));
    for (const frame of currentPage.frames().filter((item) => item.url().startsWith('qiyao-plugin:'))) { console.error(await frame.locator('body').innerText().catch(() => 'Could not read plugin frame.')); console.error(await frame.evaluate(() => globalThis.panelEvents).catch(() => [])); }
    console.error(await currentPage.evaluate(() => window.qiyao.pluginViews()).catch(() => []));
  }
  throw error;
} finally {
  let closeError;
  if (application) await application.close({ quit: !suiteCompleted }).catch((error) => { closeError = error; });
  if (authorizationBrowser) await authorizationBrowser.close();
  await oauth.close();
  await new Promise((resolve) => server.close(resolve));
  if (suiteCompleted && !closeError && modelComparisonsResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'model-comparisons-packaged-result.json' : 'model-comparisons-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused model-comparison suite' }), ...modelComparisonsResult }, null, 2));
    console.log(`Verified ${modelComparisonsResult.checks} model-comparison checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && mcpResourceSubscriptionsResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'mcp-resource-subscriptions-packaged-result.json' : 'mcp-resource-subscriptions-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused MCP resource-subscription suite' }), ...mcpResourceSubscriptionsResult }, null, 2));
    console.log(`Verified ${mcpResourceSubscriptionsResult.checks} MCP resource-subscription checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && quickChatResult) {
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'quick-chat-packaged-result.json' : 'quick-chat-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused quick-chat suite' }), ...quickChatResult }, null, 2));
    console.log(`Verified ${quickChatResult.checks} quick-chat checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && mcpPdfResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'mcp-pdf-packaged-result.json' : 'mcp-pdf-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused MCP PDF suite' }), ...mcpPdfResult }, null, 2));
    console.log(`Verified ${mcpPdfResult.checks} MCP PDF checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && mcpBinaryFilesResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'mcp-binary-files-packaged-result.json' : 'mcp-binary-files-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused MCP binary-file suite' }), ...mcpBinaryFilesResult }, null, 2));
    console.log(`Verified ${mcpBinaryFilesResult.checks} MCP binary-file checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && assistantRecipesResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'assistant-recipes-packaged-result.json' : 'assistant-recipes-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused assistant-recipe suite' }), ...assistantRecipesResult }, null, 2));
    console.log(`Verified ${assistantRecipesResult.checks} assistant-recipe checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && promptTransferResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'prompt-transfer-packaged-result.json' : 'prompt-transfer-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused prompt-transfer suite' }), ...promptTransferResult }, null, 2));
    console.log(`Verified ${promptTransferResult.checks} prompt-transfer checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && memoriesResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'memories-packaged-result.json' : 'memories-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...memoriesResult }, null, 2));
  }
  if (suiteCompleted && !closeError && textHintResult) {
    await writeFile(join(root, 'verification', packaged ? 'text-hints-packaged-result.json' : 'text-hints-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, normalCloseVerified: true, modelRequests: calls.length, ...textHintResult }, null, 2));
    console.log(`Verified ${textHintResult.checks} focused text-hint checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && surfaceResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'surfaces-packaged-result.json' : 'surfaces-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, modelRequests: calls.length, ...surfaceResult }, null, 2));
    console.log(`Verified ${surfaceResult.checks} focused surface checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && chatNavigationResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'chat-navigation-packaged-result.json' : 'chat-navigation-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused chat-navigation suite' }), ...chatNavigationResult }, null, 2));
    console.log(`Verified ${chatNavigationResult.checks} chat-navigation checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && branchNavigationResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'conversation-branches-packaged-result.json' : 'conversation-branches-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused branch-navigation suite' }), ...branchNavigationResult }, null, 2));
    console.log(`Verified ${branchNavigationResult.checks} conversation-branch checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && temporaryConversationsResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'temporary-conversations-packaged-result.json' : 'temporary-conversations-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused temporary-conversation suite' }), ...temporaryConversationsResult }, null, 2));
    console.log(`Verified ${temporaryConversationsResult.checks} temporary-conversation checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && terminalLifecycleResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'terminal-lifecycle-packaged-result.json' : 'terminal-lifecycle-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...terminalLifecycleResult }, null, 2));
    console.log(`Verified ${terminalLifecycleResult.checks} terminal-lifecycle checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && systemDpiResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'system-dpi-packaged-result.json' : 'system-dpi-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...systemDpiResult }, null, 2));
    console.log(`Verified ${systemDpiResult.checks} system-DPI checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && systemDpiHomeResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'system-dpi-home-packaged-result.json' : 'system-dpi-home-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...systemDpiHomeResult }, null, 2));
    console.log(`Verified ${systemDpiHomeResult.checks} system-DPI homepage checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && browserResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'browser-packaged-result.json' : 'browser-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused browser suite' }), ...browserResult }, null, 2));
    console.log(`Verified ${browserResult.checks} browser checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && worktreeUpstreamResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'worktree-upstream-packaged-result.json' : 'worktree-upstream-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused worktree-upstream suite' }), ...worktreeUpstreamResult }, null, 2));
    console.log(`Verified ${worktreeUpstreamResult.checks} worktree upstream checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && worktreeConversationsResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'worktree-conversations-packaged-result.json' : 'worktree-conversations-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused worktree-conversations suite' }), ...worktreeConversationsResult }, null, 2));
    console.log(`Verified ${worktreeConversationsResult.checks} worktree conversation checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && worktreeOverviewResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'worktree-overview-packaged-result.json' : 'worktree-overview-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused worktree-overview suite' }), ...worktreeOverviewResult }, null, 2));
    console.log(`Verified ${worktreeOverviewResult.checks} worktree overview checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && worktreeSettingsResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'worktree-settings-packaged-result.json' : 'worktree-settings-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused worktree-settings suite' }), ...worktreeSettingsResult }, null, 2));
    console.log(`Verified ${worktreeSettingsResult.checks} worktree settings checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && projectWorktreesResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'project-worktrees-packaged-result.json' : 'project-worktrees-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused project-worktree suite' }), ...projectWorktreesResult }, null, 2));
    console.log(`Verified ${projectWorktreesResult.checks} project worktree checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && contextSummariesResult) {
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'context-summaries-packaged-result.json' : 'context-summaries-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, normalCloseVerified: true, verificationRun: 'focused context-summary suite', ...contextSummariesResult }, null, 2));
    console.log(`Verified ${contextSummariesResult.checks} context summary checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && toolActivitiesResult) {
    assert.deepEqual(errors, []);
    await writeFile(join(root, 'verification', packaged ? 'tool-activities-packaged-result.json' : 'tool-activities-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused tool-activity suite' }), ...toolActivitiesResult }, null, 2));
    console.log(`Verified ${toolActivitiesResult.checks} tool activity checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && projectBranchesResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'project-branches-packaged-result.json' : 'project-branches-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused project-branch suite' }), ...projectBranchesResult }, null, 2));
    console.log(`Verified ${projectBranchesResult.checks} project branch checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && rendererCloseResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'renderer-close-packaged-result.json' : 'renderer-close-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...rendererCloseResult }, null, 2));
    console.log(`Verified ${rendererCloseResult.checks} renderer-close checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && backupsFocusedResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'backups-focused-packaged-result.json' : 'backups-focused-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', verificationRun: 'focused backup suite', checks: count, executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...backupsFocusedResult }, null, 2));
    console.log(`Verified ${count} focused backup checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && projectTreeResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'project-tree-packaged-result.json' : 'project-tree-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, runtimeErrors: errors, normalCloseVerified: true, ...(fullResult ? { verificationRun: 'complete desktop suite', suiteChecks: count } : { verificationRun: 'focused project-tree suite', modelRequests: calls.length }), ...projectTreeResult }, null, 2));
    console.log(`Verified ${projectTreeResult.checks} project-tree checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && projectPreviewResult) {
    assert.deepEqual(errors, []); assert.deepEqual(providerErrors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'project-preview-packaged-result.json' : 'project-preview-result.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), variant: packaged ? 'packaged executable' : 'development executable', executableSha256, archiveSha256, normalCloseVerified: true, runtimeErrors: errors, ...projectPreviewResult }, null, 2));
  }
  if (suiteCompleted && !closeError && fullResult) {
    assert.deepEqual(errors, []);
    const executableSha256 = packaged ? createHash('sha256').update(await readFile(process.env.QIYAO_TEST_EXECUTABLE)).digest('hex') : null;
    const archiveSha256 = packaged ? createHash('sha256').update(await readFile(join(dirname(process.env.QIYAO_TEST_EXECUTABLE), 'resources', 'app.asar'))).digest('hex') : null;
    await writeFile(join(root, 'verification', packaged ? 'packaged-result.json' : 'electron-result.json'), JSON.stringify({ ...fullResult, normalCloseVerified: true, executableSha256, archiveSha256 }, null, 2));
    console.log(`Verified ${count} Electron integration checks and normal application close.`);
  }
  if (suiteCompleted && !closeError && !process.env.QIYAO_TEST_KEEP_WORKSPACE) {
    assert.equal(dirname(directory), scratchRoot); assert.match(basename(directory), /^qiyao-electron-[A-Za-z0-9]{6}$/);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  if (suiteCompleted && closeError) throw closeError;
}
