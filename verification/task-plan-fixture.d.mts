import type { TaskPlan } from '../contracts/task-plan';
export function taskPlanFixture(): {
  handle(request: { url: string; [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> }, response: { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown; end(chunk: string): unknown; once(event: 'close', listener: () => void): unknown }): Promise<boolean>;
  requests: { marker: string; round: number; tools: string[]; text: string }[];
  initial: TaskPlan;
  updated: TaskPlan;
};
