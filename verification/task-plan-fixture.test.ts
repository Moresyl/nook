import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { taskPlanFixture } from './task-plan-fixture.mjs';

async function request(fixture: ReturnType<typeof taskPlanFixture>, round = 0, marker = '任务步骤完成验证', url = '/task-plan/v1/chat/completions') {
  const response = Object.assign(new EventEmitter(), { writes: [] as string[], ended: false, writeHead: () => {}, write(text: string) { this.writes.push(text); }, end(text: string) { this.writes.push(text); this.ended = true; } });
  const initial = { role: 'tool', content: JSON.stringify(fixture.initial) }, read = { role: 'tool', content: marker === '任务步骤停止验证' ? 'Invalid tool arguments. Check the declared tool schema.' : 'QIYAO_PROJECT_EVIDENCE' };
  const results = round === 0 ? [] : round === 1 ? [initial] : round === 2 ? [initial, read] : [initial, read, { role: 'tool', content: JSON.stringify(fixture.updated) }];
  const body = { messages: [{ role: 'user', content: marker }, ...results], tools: [{ function: { name: 'update_plan' } }] };
  const input = { url, async *[Symbol.asyncIterator]() { yield JSON.stringify(body); } };
  if (marker === '任务步骤停止验证' && round === 2) response.on('newListener', event => { if (event === 'close') queueMicrotask(() => response.emit('close')); });
  return { handled: await fixture.handle(input, response), response };
}
describe('owned task plan model fixture', () => {
  it('keeps unrelated routes untouched and rejects unknown explicit verification markers', async () => {
    const fixture = taskPlanFixture(); expect((await request(fixture, 0, 'unknown', '/other')).handled).toBe(false);
    await expect(request(fixture, 0, 'unknown')).rejects.toThrow(); expect(fixture.requests).toEqual([]);
  });
  it('emits plan, actual read, validated update and final reply in the expected order', async () => {
    const fixture = taskPlanFixture(), outputs: string[] = [];
    for (let round = 0; round < 4; round++) { const result = await request(fixture, round); expect(result.handled).toBe(true); expect(result.response.ended).toBe(true); outputs.push(result.response.writes.join('')); }
    expect(outputs[0]).toContain('update_plan'); expect(outputs[1]).toContain('read_file'); expect(outputs[2]).toContain('update_plan'); expect(outputs[3]).toContain('最后一步仍待办');
    expect(fixture.requests.map((row: { round: number }) => row.round)).toEqual([0, 1, 2, 3]);
  });
  it('supplies a deliberately invalid multiple-active update for the real stopped-response path', async () => {
    const fixture = taskPlanFixture(), result = await request(fixture, 1, '任务步骤停止验证');
    expect(result.response.writes.join('')).toContain('update_plan'); expect(result.response.writes.join('')).toContain('in_progress');
    expect(result.response.ended).toBe(true);
  });
  it('releases a held streamed response when the native request closes without inventing completion', async () => {
    const result = await request(taskPlanFixture(), 2, '任务步骤停止验证');
    expect(result.handled).toBe(true); expect(result.response.ended).toBe(false); expect(result.response.writes.join('')).toContain('等待后续步骤');
  });
});
