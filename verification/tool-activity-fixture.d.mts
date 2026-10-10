export function toolActivityFixture(directory: string): {
  handle(request: { url: string; [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array> }, response: { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown; end(chunk: string): unknown }): Promise<boolean>;
  requests: string[]; contexts: string[]; inputs: Map<string, string>;
  release(marker: string, phase: string): Promise<void>;
};
