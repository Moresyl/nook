import { describe, expect, it } from 'vitest';
import { latestTaskPlan, taskPlanSchema } from '../contracts/task-plan';
import type { ToolActivity } from '../contracts/tools';
import { ProjectTools } from '../desktop/services/project-tools';
import { ExecutionTools, executionToolDefinitions } from '../desktop/services/execution-tools';

const plan = { explanation: '保留原文，核对中文 😀', steps: [{ step: '读取资料', status: 'completed' }, { step: '实现并验证', status: 'in_progress' }, { step: '汇报结果', status: 'pending' }] };
const activity = (overrides: Partial<ToolActivity> = {}): ToolActivity => ({ id: 'activity', name: 'update_plan', input: '{}', output: JSON.stringify(plan), status: 'complete', startedAt: 1, finishedAt: 2, ...overrides });
const project = { id: 'missing', name: 'Project', path: 'Z:/not-a-real-project', instructions: '', createdAt: 1 };

describe('task plan record contract', () => {
  it('accepts bounded empty explanations and all three explicit statuses without altering text', () => {
    expect(taskPlanSchema.parse(plan)).toEqual(plan);
    expect(taskPlanSchema.parse({ explanation: '', steps: [{ step: ' A\n B ', status: 'pending' }] }).steps[0].step).toBe(' A\n B ');
    expect(taskPlanSchema.safeParse({ explanation: 'x'.repeat(2000), steps: Array.from({ length: 20 }, (_, index) => ({ step: 'x'.repeat(300), status: index ? 'pending' : 'in_progress' })) }).success).toBe(true);
  });
  it.each([
    null, {}, { ...plan, extra: true }, { ...plan, explanation: 'x'.repeat(2001) }, { ...plan, explanation: '\0' },
    { ...plan, steps: [] }, { ...plan, steps: Array.from({ length: 21 }, () => ({ step: 'Step', status: 'pending' })) },
    ...['', '   ', '\0', 'x'.repeat(301)].map(step => ({ ...plan, steps: [{ step, status: 'pending' }] })),
    { ...plan, steps: [{ step: 'Step', status: 'running' }] }, { ...plan, steps: [{ step: 'Step', status: 'pending', extra: true }] },
    { ...plan, steps: [{ step: 'A', status: 'in_progress' }, { step: 'B', status: 'in_progress' }] },
  ])('rejects invalid or out-of-bounds records %#', value => { expect(taskPlanSchema.safeParse(value).success).toBe(false); });
  it('selects the newest successful validated output and never promotes pending, failed or stopped input', () => {
    const old = activity(), next = { explanation: '', steps: [{ step: 'Done', status: 'completed' }] };
    expect(latestTaskPlan([])).toBeNull();
    expect(latestTaskPlan([old, activity({ output: JSON.stringify(next) })])).toEqual(next);
    for (const status of ['running', 'waiting', 'error', 'stopped'] as const) {
      expect(latestTaskPlan([old, activity({ status, input: JSON.stringify(next), output: JSON.stringify(next) })])).toEqual(plan);
      expect(latestTaskPlan([activity({ status })])).toBeNull();
    }
    for (const output of ['bad json', 'null', '{}', JSON.stringify({ ...plan, steps: [] })]) expect(latestTaskPlan([old, activity({ output })])).toEqual(plan);
    expect(latestTaskPlan([activity({ name: 'external_plan' })])).toBeNull();
  });
});

describe('task plan tools', () => {
  it.each([new ProjectTools(), new ExecutionTools()])('records steps without project filesystem access or approval %#', async tools => {
    const result = await tools.execute({ id: 'call', name: 'update_plan', arguments: JSON.stringify(plan) }, project, new AbortController().signal);
    expect(result).toEqual({ callId: 'call', output: JSON.stringify(plan), error: false });
    expect(executionToolDefinitions.some(tool => tool.name === 'update_plan')).toBe(true);
  });
  it('returns a recoverable error for invalid arguments and honors cancellation before recording', async () => {
    const tools = new ProjectTools(), call = { id: 'call', name: 'update_plan', arguments: '{"explanation":"","steps":[]}' };
    expect(await tools.execute(call, project, new AbortController().signal)).toMatchObject({ error: true, output: 'Invalid tool arguments. Check the declared tool schema.' });
    expect(await tools.execute({ ...call, arguments: 'broken' }, project, new AbortController().signal)).toMatchObject({ error: true });
    const controller = new AbortController(); controller.abort();
    await expect(tools.execute({ ...call, arguments: JSON.stringify(plan) }, project, controller.signal)).rejects.toThrow();
  });
});
