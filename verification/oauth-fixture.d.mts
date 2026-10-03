export function oauthFixture(mode?: 'http' | 'sse'): Promise<{
  endpoint: string; issuer: string;
  requests: { path: string; authorization: string; grant?: string }[];
  errors: string[];
  authorize(url: string | URL): Promise<void>;
  registerClient(id: string, secret: string, redirect: string): void;
  notifyTools(): Promise<void>;
  expire(): void;
  disableRefresh(): void;
  close(): Promise<void>;
}>;
