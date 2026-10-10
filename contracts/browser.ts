import { z } from 'zod';

export const browserActionSchema = z.enum(['back', 'forward', 'reload', 'stop', 'focus']);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserState = { token: string; sequence: number; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null; notice: string | null };

export function browserUrl(input: unknown): string {
  const text = z.string().trim().min(1).max(8192).parse(input);
  let url: URL;
  try { url = new URL(text); } catch { throw new Error('Enter a complete HTTP or HTTPS address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Enter an HTTP or HTTPS address without embedded credentials.');
  return url.href;
}

export function browserNavigationAllowed(input: string): boolean {
  try { browserUrl(input); return true; } catch { return false; }
}
