import assert from 'node:assert/strict';

export function taskPlanFixture() {
  const requests = [], initial = { explanation: '保留中文与 emoji 😀，任务步骤记录不执行工作。', steps: [{ step: '读取 README 中文 😀 <img src=x onerror=alert(1)>', status: 'in_progress' }, { step: '核对实际读取结果', status: 'pending' }, { step: '汇报待办步骤', status: 'pending' }] };
  const updated = { explanation: '实际读取结果已核对；仍保留最后一个待办步骤。', steps: initial.steps.map((step, index) => ({ ...step, status: index < 2 ? 'completed' : 'pending' })) };
  async function handle(request, response) {
    if (!request.url.startsWith('/task-plan/v1/')) return false;
    assert.ok(request.url.endsWith('/chat/completions'));
    let raw = ''; for await (const part of request) { raw += part; assert.ok(raw.length <= 200000); }
    const body = JSON.parse(raw), content = body.messages.findLast(item => item.role === 'user')?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : '';
    const marker = ['任务步骤完成验证', '任务步骤停止验证'].find(value => text.startsWith(value)); assert.ok(marker);
    const results = body.messages.filter(item => item.role === 'tool'), round = results.length;
    requests.push({ marker, round, tools: body.tools.map(tool => tool.function.name), text });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    function tool(name, args) { event({ choices: [{ delta: { tool_calls: [{ index: 0, id: `task-plan-${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }); }
    if (round === 0) tool('update_plan', initial);
    else if (marker === '任务步骤停止验证' && round === 1) tool('update_plan', { ...initial, steps: initial.steps.map(step => ({ ...step, status: 'in_progress' })) });
    else if (marker === '任务步骤停止验证') {
      assert.ok(results.at(-1).content.includes('Invalid tool arguments'));
      event({ choices: [{ delta: { content: '等待后续步骤。' } }] });
      await new Promise(resolve => {
        const timer = setTimeout(() => { response.end('data: [DONE]\n\n'); resolve(); }, 25000);
        response.once('close', () => { clearTimeout(timer); resolve(); });
      });
      return true;
    } else if (round === 1) { assert.deepEqual(JSON.parse(results[0].content), initial); tool('read_file', { path: 'README.md', start_line: 1, max_lines: 20 }); }
    else if (round === 2) { assert.ok(results.at(-1).content.includes('QIYAO_PROJECT_EVIDENCE')); tool('update_plan', updated); }
    else { assert.deepEqual(JSON.parse(results.at(-1).content), updated); event({ choices: [{ delta: { content: '读取与核对完成，最后一步仍待办。' } }] }); }
    response.end('data: [DONE]\n\n'); return true;
  }
  return { handle, requests, initial, updated };
}
