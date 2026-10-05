import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyNativeProviders({ page, application, endpoint, projectDirectory, screenshots, verified, waitForBridge, fixture }) {
  await application.resize(1280, 840); await page.evaluate(async (path) => { await window.qiyao.saveProject({ id: 'native-project', name: '原生模型验证项目', path, instructions: '', createdAt: 1 }); const state = await window.qiyao.load(); await window.qiyao.savePreferences({ ...state.preferences, theme: 'light' }); }, projectDirectory);
  await page.reload();
  const variants = [{ kind: 'gemini', name: 'Gemini 原生验证', mode: 'gemini', model: 'gemini-native', path: '/native/gemini/v1beta' },
    { kind: 'azure', name: 'Azure Responses 验证', mode: 'responses', model: 'azure-native', path: '/native/azure/openai/v1' },
    { kind: 'azure', name: 'Azure Chat 验证', mode: 'chat', model: 'azure-native', path: '/native/azure/openai/v1' },
    { kind: 'azure', name: 'Azure 部署接口验证', mode: 'deployment-chat', model: 'azure-native', path: '/native/azure/openai/v1' }];
  for (const [index, variant] of variants.entries()) {
    await page.getByRole('button', { name: /^设置/ }).click(); await page.getByRole('dialog').getByRole('button', { name: '添加连接', exact: true }).click();
    await page.getByLabel('连接名称', { exact: true }).fill(variant.name); await page.getByLabel('API 类型', { exact: true }).selectOption(variant.kind);
    if (variant.kind === 'azure') await page.getByLabel('Azure 接口', { exact: true }).selectOption(variant.mode);
    if (variant.mode === 'deployment-chat') assert.equal(await page.getByLabel('API 版本', { exact: true }).inputValue(), '2024-10-21');
    await page.getByLabel('API 地址', { exact: true }).fill(new URL(variant.path, endpoint).href); await page.getByLabel('API 密钥', { exact: true }).fill('native-fixture-key');
    if (variant.mode !== 'deployment-chat') { await page.getByRole('button', { name: '获取模型', exact: true }).click(); await page.waitForFunction((value) => [...document.querySelectorAll('dialog textarea')].some((node) => node.value === value), variant.model); }
    else await page.getByLabel('模型', { exact: true }).fill(variant.model);
    if (variant.kind === 'gemini') {
      assert.equal(await page.getByLabel('输入上限', { exact: true }).inputValue(), '32768'); assert.equal(await page.getByLabel('输出上限', { exact: true }).inputValue(), '8192'); assert.equal(await page.getByLabel('推理能力', { exact: true }).inputValue(), 'true'); assert.equal(await page.getByLabel('工具调用', { exact: true }).inputValue(), '');
      await page.getByLabel('本次输出预算', { exact: true }).fill('9000'); assert.equal(await page.getByRole('button', { name: '保存连接', exact: true }).isDisabled(), true);
    } else assert.equal(await page.getByLabel('输入上限', { exact: true }).inputValue(), '');
    await page.getByLabel('本次输出预算', { exact: true }).fill('500'); await page.getByLabel('本次输出预算', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, `${38 + index}-native-provider-${variant.mode}.png`) });
    await page.getByRole('button', { name: '保存连接', exact: true }).click(); await page.getByRole('dialog').getByText(variant.name, { exact: true }).waitFor(); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    async function start(marker, tool) {
      await page.keyboard.press('Control+n'); await page.getByRole('heading', { name: '今天想做些什么？' }).waitFor();
      await page.getByLabel('模型提供商', { exact: true }).selectOption({ label: variant.name }); await page.getByLabel('选择模型', { exact: true }).selectOption(variant.model);
      await page.getByLabel('选择项目', { exact: true }).selectOption(tool ? 'native-project' : ''); if (tool) await page.getByLabel('工作模式', { exact: true }).selectOption('plan');
      await page.getByRole('textbox', { name: '消息', exact: true }).fill(marker); await page.getByRole('button', { name: '发送消息', exact: true }).click();
    }
    const stream = `NATIVE_STREAM_${variant.mode}`; await start(stream, false); await page.getByLabel('助手回复', { exact: true }).getByText(`NATIVE_STREAM_COMPLETE ${stream}`, { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
    verified(`${variant.name}: settings, native authentication/routing and streamed reply`);
    await waitForBridge(page, async (marker) => { const state = await window.qiyao.load(); return state.threads.find((item) => item.messages.some((message) => message.content === marker))?.messages.at(-1)?.invocations?.[0]?.tokens?.totalTokens === 120; }, stream);
    await page.getByRole('button', { name: '查看 token 用量', exact: true }).click(); const streamCounts = await page.getByRole('dialog').locator('.usage-counts').first().evaluate((list) => Object.fromEntries([...list.children].map((item) => [item.querySelector('dt').textContent, item.querySelector('dd').textContent]))); assert.equal(streamCounts['输入'], '100'); assert.equal(streamCounts['输出'], '20'); assert.equal(streamCounts['合计'], '120'); assert.equal(streamCounts['推理（含在输出中）'], '4'); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    assert.match(await page.getByLabel('模型容量与最近请求').textContent(), /最近请求输入 100/); if (variant.kind === 'gemini') assert.match(await page.getByLabel('模型容量与最近请求').textContent(), /输入上限 32,768/);
    verified(`${variant.name}: actual streaming usage, service/manual capacities and configured output budget`);
    const tool = `NATIVE_TOOL_${variant.mode}`; await start(tool, true); await page.getByLabel('助手回复', { exact: true }).getByText(`NATIVE_TOOL_COMPLETE ${tool}`, { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
    await waitForBridge(page, async (marker) => { const state = await window.qiyao.load(); const thread = state.threads.find((item) => item.messages.some((message) => message.content === marker)); return thread?.messages.at(-1)?.activities?.some((activity) => activity.name === 'read_file' && activity.status === 'complete' && activity.output.includes('QIYAO_PROJECT_EVIDENCE')); }, tool);
    verified(`${variant.name}: actual project read, signed/reasoning/tool-ID continuation and persisted evidence`);
    const toolState = await page.evaluate(() => window.qiyao.load()); const toolRecords = toolState.threads.find((item) => item.messages.some((message) => message.content === tool)).messages.at(-1).invocations; assert.equal(toolRecords.length, 2); assert.deepEqual(toolRecords.map((item) => [item.round, item.status, item.tokens.inputTokens, item.tokens.outputTokens, item.tokens.totalTokens]), [[0, 'complete', 100, 10, 110], [1, 'complete', 200, 20, 220]]);
    await page.getByRole('button', { name: '查看 token 用量', exact: true }).click(); const toolCounts = await page.getByRole('dialog').locator('.usage-counts').first().evaluate((list) => Object.fromEntries([...list.children].map((item) => [item.querySelector('dt').textContent, item.querySelector('dd').textContent]))); assert.equal(toolCounts['输入'], '300'); assert.equal(toolCounts['输出'], '30'); assert.equal(toolCounts['合计'], '330'); assert.equal(await page.locator('.usage-request').count(), 2); if (index === 0) await page.screenshot({ path: join(screenshots, '43-token-usage-light.png') }); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); assert.match(await page.getByLabel('模型容量与最近请求').textContent(), /最近请求输入 200/);
    verified(`${variant.name}: per-round persisted usage and correct tool-continuation totals without cache/reasoning double counting`);
    const slow = `NATIVE_SLOW_${variant.mode}`; await start(slow, false); await page.getByLabel('助手回复', { exact: true }).getByText(`NATIVE_PARTIAL ${slow}`, { exact: true }).waitFor(); await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await waitForBridge(page, async (marker) => { const state = await window.qiyao.load(); const thread = state.threads.find((item) => item.messages.some((message) => message.content === marker)); return thread?.messages.at(-1)?.status === 'stopped'; }, slow);
    for (let attempt = 0; attempt < 50 && !fixture.cancellations.includes(slow); attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(fixture.cancellations.includes(slow)); verified(`${variant.name}: user stop retains partial text and closes its HTTP stream`);
    const stopped = (await page.evaluate(() => window.qiyao.load())).threads.find((item) => item.messages.some((message) => message.content === slow)).messages.at(-1).invocations[0]; assert.equal(stopped.status, 'interrupted'); assert.ok(stopped.finishedAt); if (variant.kind === 'gemini') assert.equal(stopped.tokens.totalTokens, 110); else assert.equal(stopped.tokens, undefined);
    await page.getByRole('button', { name: '查看 token 用量', exact: true }).click(); await page.getByRole('dialog').getByText('已中断', { exact: true }).waitFor(); if (variant.kind !== 'gemini') await page.getByRole('dialog').getByText('服务未返回用量。', { exact: true }).waitFor(); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    verified(`${variant.name}: interrupted request keeps known counters and presents missing usage as unknown`);
    if (variant.mode === 'responses') {
      await start('NATIVE_USAGE_FAILED', false);
      try { await waitForBridge(page, async () => { const state = await window.qiyao.load(); const message = state.threads.find((item) => item.messages.some((entry) => entry.content === 'NATIVE_USAGE_FAILED'))?.messages.at(-1); return message?.status === 'error' && message.invocations?.[0]?.tokens?.totalTokens === 150; }); }
      catch (error) { console.error('Native failed-usage diagnostics', await page.evaluate(async () => (await window.qiyao.load()).threads.filter((item) => item.messages.some((entry) => entry.content === 'NATIVE_USAGE_FAILED')).map((item) => ({ id: item.id, archived: item.archived, message: item.messages.at(-1) }))), fixture.requests.filter((item) => item.marker === 'NATIVE_USAGE_FAILED')); throw error; }
      await page.getByRole('button', { name: '查看 token 用量', exact: true }).click(); await page.getByRole('dialog').getByText('请求失败', { exact: true }).waitFor(); await page.screenshot({ path: join(screenshots, '45-token-usage-failed.png') }); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); verified('Responses incomplete event retains consumed tokens and marks the request failed');
    }
  }
  const last = variants.at(-1); await page.getByRole('button', { name: /^设置/ }).click(); await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${last.name}`) }).click();
  await page.getByRole('button', { name: '外观与交互', exact: true }).click(); await page.getByLabel('主题', { exact: true }).selectOption('dark'); await page.getByRole('button', { name: '模型连接', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${last.name}`) }).click();
  await application.resize(760, 540); await page.waitForFunction(() => innerWidth === 760 && document.documentElement.dataset.theme === 'dark');
  await page.getByLabel('API 版本', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '42-native-provider-dark-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByLabel('本次输出预算', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: join(screenshots, '46-model-capacity-dark-narrow.png') }); assert.equal(await page.evaluate(() => [...document.querySelectorAll('.capacity-grid input')].some((node) => node.getBoundingClientRect().right > innerWidth)), false);
  await page.getByLabel('API 地址', { exact: true }).fill('https://different.example.invalid/openai/v1'); await page.getByRole('button', { name: '保存连接', exact: true }).click();
  await waitForBridge(page, async (name) => (await window.qiyao.load()).providers.find((item) => item.name === name)?.hasKey === false, last.name);
  const state = await page.evaluate(() => window.qiyao.load()); assert.equal(state.providers.find((item) => item.name === last.name).hasKey, false);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); verified('native Azure minimum-window dark settings and changed destination credential invalidation');
  await page.getByRole('button', { name: '查看 token 用量', exact: true }).click(); await page.getByRole('dialog').getByText('服务未返回用量。', { exact: true }).waitFor(); await page.screenshot({ path: join(screenshots, '44-token-usage-dark-narrow.png') }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click(); verified('usage and capacity settings remain usable at the minimum dark window size');
  return { protocols: [...new Set(fixture.requests.map((item) => item.protocol))], requests: fixture.requests.length, cancelledStreams: [...fixture.cancellations], cloudCredentialsUsed: false };
}

export async function verifyNativeProviderRestart({ restart, verified }) {
  const page = await restart();
  await page.evaluate(async () => {
    const state = await window.qiyao.load(); const provider = state.providers.find((item) => item.name === 'Gemini 原生验证');
    if (!provider?.hasKey) throw new Error('The native Gemini credential was not restored.');
    if (provider.modelCatalog?.[0]?.inputTokenLimit !== 32768 || provider.modelCatalog?.[0]?.maxOutputTokens !== 500 || provider.modelCatalog?.[0]?.source !== 'service') throw new Error('The native model capacity was not restored.');
    for (const thread of state.threads.filter((item) => item.messages.some((message) => message.content.startsWith('NATIVE_TOOL_')))) { const records = thread.messages.at(-1).invocations; if (records.length !== 2 || records[0].tokens.totalTokens !== 110 || records[1].tokens.totalTokens !== 220) throw new Error('The per-round native usage was not restored.'); }
  });
  await page.keyboard.press('Control+n'); await page.getByRole('heading', { name: '今天想做些什么？' }).waitFor();
  await page.getByLabel('模型提供商', { exact: true }).selectOption({ label: 'Gemini 原生验证' }); await page.getByLabel('选择模型', { exact: true }).selectOption('gemini-native'); await page.getByLabel('选择项目', { exact: true }).selectOption('');
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('NATIVE_RESTART_GEMINI'); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByLabel('助手回复', { exact: true }).getByText('NATIVE_STREAM_COMPLETE NATIVE_RESTART_GEMINI', { exact: true }).waitFor(); await page.getByRole('button', { name: '重新生成', exact: true }).waitFor();
  verified('native application restart decrypts the destination-bound Gemini key and streams through the saved native connection'); return page;
}
