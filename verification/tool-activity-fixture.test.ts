import { describe, expect, it } from 'vitest';
import { toolActivityFixture } from './tool-activity-fixture.mjs';

async function request(fixture: ReturnType<typeof toolActivityFixture>, content: unknown, result?: string, url = '/tool-activity/v1/chat/completions') {
  const chunks: string[] = [], body = JSON.stringify({ messages: [{ role: 'user', content }, ...(result === undefined ? [] : [{ role: 'tool', content: result }])] });
  const input = { url, async *[Symbol.asyncIterator]() { yield body; } }, output = { writeHead() {}, write(text: string) { chunks.push(text); }, end(text: string) { chunks.push(text); } };
  const handled = await fixture.handle(input, output); return { handled, events: chunks.join('') };
}
describe('tool activity HTTP fixture context', () => {
  it('recognizes the explicit marker while preserving attached document context', async () => {
    const fixture = toolActivityFixture('owned-fixture'), content = '工具记录拒绝验证\n\n附件：上下文😀.txt\nPROMPT_TRANSFER_CONTEXT';
    const response = await request(fixture, content); expect(response.handled).toBe(true); expect(response.events).toContain('run_command'); expect(fixture.requests).toEqual(['工具记录拒绝验证']); expect(fixture.contexts).toEqual([content]); expect(JSON.parse(fixture.inputs.get('工具记录拒绝验证')!).args[0]).toBe('-e');
  });
  it('handles text parts alongside images without dropping attached text', async () => {
    const fixture = toolActivityFixture('owned-fixture'); await request(fixture, [{ type: 'text', text: '工具记录完成验证' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }, { type: 'text', text: '保留上下文 中文😀' }]);
    expect(fixture.contexts).toEqual(['工具记录完成验证\n保留上下文 中文😀']); expect(fixture.requests).toEqual(['工具记录完成验证']);
  });
  it('validates real denied and completed output before returning a final reply', async () => {
    const fixture = toolActivityFixture('owned-fixture');
    expect((await request(fixture, '工具记录拒绝验证', 'The user denied command execution.')).events).toContain('工具记录拒绝验证已结束。');
    expect((await request(fixture, '工具记录完成验证', 'TOOL_FINAL_OUTPUT\nExit code: 0')).events).toContain('工具记录完成验证已结束。');
    await expect(request(fixture, '工具记录完成验证', 'unexpected partial output')).rejects.toThrow();
  });
  it('ignores unrelated routes and rejects missing or unknown markers', async () => {
    const fixture = toolActivityFixture('owned-fixture'); expect((await request(fixture, 'unrelated', undefined, '/other/chat/completions')).handled).toBe(false);
    for (const value of [undefined, 'unknown', []]) await expect(request(fixture, value)).rejects.toThrow('explicit user marker');
  });
});
