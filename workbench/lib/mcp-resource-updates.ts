import type { Bridge } from '../../contracts/bridge-contract';
import type { McpContent } from '../../contracts/extensions';

type ResourceBridge = Pick<Bridge, 'mcpReadResource' | 'onMcpResource'>;
type ResourceHandlers = { content: (content: McpContent) => void; busy: (busy: boolean) => void; error: (error: unknown) => void };

export function observeMcpResource(bridge: ResourceBridge, id: string, uri: string, handlers: ResourceHandlers): () => void {
  let live = true; let running = false; let dirty = false;
  async function refresh() {
    if (!live) return;
    dirty = true; if (running) return;
    running = true; handlers.busy(true);
    try {
      do {
        dirty = false;
        const next = await bridge.mcpReadResource(id, uri);
        if (live) handlers.content(next);
      } while (live && dirty);
    } catch (error) { if (live) handlers.error(error); }
    finally { running = false; if (live) handlers.busy(false); }
  }
  const unsubscribe = bridge.onMcpResource((event) => { if (event.id === id && event.uri === uri) void refresh(); });
  void refresh();
  return () => { if (!live) return; live = false; unsubscribe(); handlers.busy(false); };
}
