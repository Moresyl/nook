import { describe, expect, it, vi } from 'vitest';
import type { McpContent, McpResourceUpdate } from '../contracts/extensions';
import { observeMcpResource } from '../workbench/lib/mcp-resource-updates';

const id = 'resource-server'; const uri = 'test://resource/0';
const content = (revision: number): McpContent => ({ title: 'Resource', text: `revision ${revision}`, binaryItems: [] });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function setup() {
  let event!: (update: McpResourceUpdate) => void;
  const pending: { resolve: (value: McpContent) => void; reject: (error: unknown) => void }[] = [];
  const unsubscribe = vi.fn(); const handlers = { content: vi.fn(), busy: vi.fn(), error: vi.fn() };
  const bridge = {
    mcpReadResource: vi.fn((_id: string, _uri: string) => new Promise<McpContent>((resolve, reject) => { pending.push({ resolve, reject }); })),
    onMcpResource: vi.fn((callback: (update: McpResourceUpdate) => void) => { event = callback; return unsubscribe; }),
  };
  const stop = observeMcpResource(bridge, id, uri, handlers);
  return { bridge, handlers, pending, unsubscribe, stop, update: (update: McpResourceUpdate = { id, uri }) => event(update) };
}

describe('MCP preview updates', () => {
  it('publishes a completed read before the queued read settles and coalesces a notification burst without parallel requests', async () => {
    const fixture = setup();
    expect(fixture.bridge.mcpReadResource).toHaveBeenCalledWith(id, uri);
    fixture.update(); fixture.update(); fixture.update();
    expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(1);
    fixture.pending[0].resolve(content(1)); await flush();
    expect(fixture.handlers.content).toHaveBeenCalledWith(content(1));
    expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(2);
    expect(fixture.handlers.busy.mock.calls).toEqual([[true]]);
    fixture.pending[1].resolve(content(2)); await flush();
    expect(fixture.handlers.content.mock.calls).toEqual([[content(1)], [content(2)]]);
    expect(fixture.handlers.busy.mock.calls).toEqual([[true], [false]]); fixture.stop();
  });

  it('continues to show progress when every resource read receives another update before it finishes', async () => {
    const fixture = setup();
    for (let index = 0; index < 4; index++) {
      fixture.update(); fixture.pending[index].resolve(content(index + 1)); await flush();
      expect(fixture.handlers.content).toHaveBeenLastCalledWith(content(index + 1));
      expect(fixture.handlers.content).toHaveBeenCalledTimes(index + 1);
      expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(index + 2);
    }
    fixture.pending[4].resolve(content(5)); await flush();
    expect(fixture.handlers.busy).toHaveBeenLastCalledWith(false); fixture.stop();
  });

  it('disposes once and ignores queued updates and late completion or rejection from a previous selection', async () => {
    for (const reject of [false, true]) {
      const fixture = setup(); fixture.update(); fixture.stop(); fixture.stop(); fixture.update();
      if (reject) fixture.pending[0].reject(new Error('previous selection'));
      else fixture.pending[0].resolve(content(1));
      await flush();
      expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
      expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(1);
      expect(fixture.handlers.content).not.toHaveBeenCalled(); expect(fixture.handlers.error).not.toHaveBeenCalled();
      expect(fixture.handlers.busy.mock.calls).toEqual([[true], [false]]);
    }
  });

  it('ignores another server or resource while following a matching notification after the first read', async () => {
    const fixture = setup(); fixture.pending[0].resolve(content(1)); await flush();
    fixture.update({ id: 'other-server', uri }); fixture.update({ id, uri: 'test://resource/1' });
    expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(1);
    fixture.update(); expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(2);
    fixture.pending[1].resolve(content(2)); await flush();
    expect(fixture.handlers.content).toHaveBeenLastCalledWith(content(2)); fixture.stop();
  });

  it('reports a read failure, resets the busy state and retries on a subsequent matching update', async () => {
    const fixture = setup(); const failure = new Error('resource unavailable');
    fixture.pending[0].reject(failure); await flush();
    expect(fixture.handlers.error).toHaveBeenCalledWith(failure); expect(fixture.handlers.busy).toHaveBeenLastCalledWith(false);
    fixture.update(); expect(fixture.bridge.mcpReadResource).toHaveBeenCalledTimes(2);
    fixture.pending[1].resolve(content(2)); await flush();
    expect(fixture.handlers.content).toHaveBeenCalledWith(content(2)); expect(fixture.handlers.error).toHaveBeenCalledTimes(1);
    expect(fixture.handlers.busy.mock.calls).toEqual([[true], [false], [true], [false]]); fixture.stop();
  });
});
