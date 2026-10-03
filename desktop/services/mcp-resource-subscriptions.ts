import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

export class McpResourceSubscriptions {
  private active = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly client: Client, private readonly signal: AbortSignal, private readonly timeout: number,
    private readonly validate: (uri?: string) => void, private readonly changed: () => void,
    private readonly updated: (uri: string) => void, private readonly onError: (error: unknown) => Promise<void>) {
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
      const uri = notification.params.uri;
      if (!this.active.has(uri)) return;
      try { this.check(uri); this.updated(uri); } catch {}
    });
  }

  get supported(): boolean { return this.client.getServerCapabilities()?.resources?.subscribe === true; }
  uris(): string[] { return this.signal.aborted ? [] : [...this.active]; }

  private check(uri?: string): void { this.signal.throwIfAborted(); this.validate(uri); }
  private notify(): void { try { this.changed(); } catch {} }
  private async failed(error: unknown): Promise<void> { try { await this.onError(error); } catch {} }
  private options() { return { signal: this.signal, timeout: this.timeout, maxTotalTimeout: this.timeout }; }

  async set(uri: string, subscribed: boolean): Promise<void> {
    if (typeof uri !== 'string' || !uri || uri.length > 4096 || typeof subscribed !== 'boolean') throw new Error('Choose a valid MCP resource and subscription state.');
    if (this.pending >= 40) throw new Error('Too many pending MCP subscription changes. Wait and retry.');
    this.pending++;
    const operation = this.queue.then(async () => {
      this.check(subscribed ? uri : undefined);
      if (this.active.has(uri) === subscribed) return;
      if (subscribed && !this.supported) throw new Error('This MCP server does not support resource subscriptions.');
      if (subscribed && this.active.size >= 20) throw new Error('At most 20 MCP resources can be subscribed on one connection.');
      if (subscribed) {
        await this.client.subscribeResource({ uri }, this.options());
        try { this.check(uri); }
        catch (error) {
          if (!this.signal.aborted) await this.client.unsubscribeResource({ uri }, this.options()).catch(() => {});
          throw error;
        }
        this.active.add(uri);
      } else {
        await this.client.unsubscribeResource({ uri }, this.options());
        this.active.delete(uri);
        this.check();
      }
      this.notify();
    });
    this.queue = operation.catch(() => {});
    try { await operation; }
    catch (error) {
      await this.failed(error);
      const message = error instanceof Error && /^(?:This MCP server does not support|At most 20 MCP resources)/.test(error.message) ? error.message : 'Could not change the MCP resource subscription. Check its URI and connection, then retry.';
      throw new Error(message);
    } finally { this.pending--; }
  }

  refresh(): void {
    this.check();
    for (const uri of [...this.active]) {
      try { this.check(uri); }
      catch {
        this.active.delete(uri);
        void this.client.unsubscribeResource({ uri }, this.options()).catch((error) => this.failed(error));
        this.notify();
      }
    }
  }
}
