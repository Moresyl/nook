import { describe, expect, it } from 'vitest';
import { allowRendererPermission } from '../desktop/services/renderer-permissions';
const input = { permission: 'clipboard-sanitized-write', owned: true, isMainFrame: true, requestingUrl: 'qiyao://app/index.html', mainFrameUrl: 'qiyao://app/index.html' };
describe('renderer permissions', () => {
  it('permits only clipboard writes for the exact owned top-level document', () => {
    expect(allowRendererPermission(input)).toBe(true);
    const url = 'qiyao://app/index.html?view=quick-chat'; expect(allowRendererPermission({ ...input, requestingUrl: url, mainFrameUrl: url })).toBe(true);
    expect(allowRendererPermission({ ...input, requestingUrl: 'http://localhost:5173/', mainFrameUrl: 'http://localhost:5173/' })).toBe(true);
  });
  it.each(['clipboard-read', 'deprecated-sync-clipboard-read', 'clipboard-write', 'media', 'geolocation', 'notifications', 'fileSystem', 'unknown'])('denies %s even for an owned window', permission => { expect(allowRendererPermission({ ...input, permission })).toBe(false); });
  it('denies unowned, child-frame, navigated and missing-document requests', () => {
    for (const overrides of [{ owned: false }, { isMainFrame: false }, { requestingUrl: 'qiyao://plugin/index.html' }, { requestingUrl: 'https://example.com/' }, { mainFrameUrl: '' }, { mainFrameUrl: undefined }, { requestingUrl: undefined }]) expect(allowRendererPermission({ ...input, ...overrides })).toBe(false);
  });
});
