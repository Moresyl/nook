import { z } from 'zod';

export const browserActionSchema = z.enum(['back', 'forward', 'reload', 'stop', 'focus']);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export const browserTabLimit = 16;
export type BrowserShortcut = { token: string; action: 'new' | 'close' | 'next' | 'previous' };
export type BrowserFailureReason = 'dns' | 'offline' | 'refused' | 'timeout' | 'certificate' | 'generic';
export type BrowserState = { token: string; sequence: number; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null; notice: string | null; failureReason?: BrowserFailureReason | null; failureCode?: string | null };

/** Only known network codes cross into the workbench; never forward native error messages. */
export function browserFailure(input: unknown): { reason: BrowserFailureReason; code: string } {
  const code = typeof input === 'string' && input.length <= 100 ? input.trim().toUpperCase() : '';
  switch (code) {
    case 'DNS_PROBE_POSSIBLE': case 'ERR_NAME_NOT_RESOLVED': return { reason: 'dns', code };
    case 'ERR_INTERNET_DISCONNECTED': return { reason: 'offline', code };
    case 'ERR_CONNECTION_REFUSED': return { reason: 'refused', code };
    case 'ERR_CONNECTION_TIMED_OUT': case 'ERR_TIMED_OUT': return { reason: 'timeout', code };
    case 'ERR_CERT_AUTHORITY_INVALID': case 'ERR_CERT_COMMON_NAME_INVALID': case 'ERR_CERT_DATE_INVALID':
    case 'ERR_CERT_INVALID': case 'ERR_CERT_REVOKED': case 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM': case 'ERR_CERT_NAME_CONSTRAINT_VIOLATION':
      return { reason: 'certificate', code };
    default: return /^ERR_CERT_[A-Z_]+$/.test(code) ? { reason: 'certificate', code: 'ERR_CERT_INVALID' } : { reason: 'generic', code: 'ERR_FAILED' };
  }
}

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
