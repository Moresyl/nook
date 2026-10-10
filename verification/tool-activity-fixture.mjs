import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

export function toolActivityFixture(directory) {
  const requests = [], inputs = new Map();
  const token = marker => join(directory, `tool-activity-${marker}`);
  const release = (marker, phase) => writeFile(token(`${marker}-${phase}`), 'owned verification gate');
  async function handle(request, response) {
    if (!request.url.startsWith('/tool-activity/v1/')) return false;
    assert.ok(request.url.endsWith('/chat/completions'));
    let raw = ''; for await (const part of request) raw += part;
    const body = JSON.parse(raw), marker = body.messages.findLast(item => item.role === 'user').content;
    assert.ok(['工具记录拒绝验证', '工具记录停止验证', '工具记录完成验证'].includes(marker));
    requests.push(marker);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = value => response.write(`data: ${JSON.stringify(value)}\n\n`);
    const result = body.messages.findLast(item => item.role === 'tool');
    if (result) {
      assert.ok(result.content.includes(marker === '工具记录拒绝验证' ? 'The user denied command execution.' : 'TOOL_FINAL_OUTPUT'));
      event({ choices: [{ delta: { content: `${marker}已结束。` } }] });
    } else {
      const program = process.execPath;
      const source = `const fs=require('node:fs');console.log('TOOL_FIRST_OUTPUT 中文😀 <img src=x onerror=alert(1)> {"large":9007199254740993,"same":1,"same":2}');let next=false;const timer=setInterval(()=>{if(!next&&fs.existsSync(${JSON.stringify(token(`${marker}-next`))})){next=true;console.log('TOOL_NEXT_OUTPUT 保留原文');}if(fs.existsSync(${JSON.stringify(token(`${marker}-finish`))})){clearInterval(timer);console.log('TOOL_FINAL_OUTPUT');process.exit(0);}},60);setTimeout(()=>{console.error('owned fixture deadline');process.exit(9)},25000);`;
      const input = JSON.stringify({ program, args: ['-e', source], timeout_ms: 30000 }); inputs.set(marker, input);
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'owned-command', type: 'function', function: { name: 'run_command', arguments: input } }] }, finish_reason: 'tool_calls' }] });
    }
    response.end('data: [DONE]\n\n'); return true;
  }
  return { handle, requests, inputs, release };
}
