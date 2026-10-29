import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { browserFailure } from '../contracts/browser';
import { BrowserLoadError } from '../workbench/components/browser-load-error';

describe('browser failure classification', () => {
  it.each([
    ['DNS_PROBE_POSSIBLE', 'dns'], ['ERR_NAME_NOT_RESOLVED', 'dns'], ['ERR_INTERNET_DISCONNECTED', 'offline'],
    ['ERR_CONNECTION_REFUSED', 'refused'], ['ERR_CONNECTION_TIMED_OUT', 'timeout'], ['ERR_TIMED_OUT', 'timeout'],
    ['ERR_CERT_AUTHORITY_INVALID', 'certificate'], ['ERR_CERT_COMMON_NAME_INVALID', 'certificate'], ['ERR_CERT_DATE_INVALID', 'certificate'],
    ['ERR_CERT_INVALID', 'certificate'], ['ERR_CERT_REVOKED', 'certificate'], ['ERR_CERT_WEAK_SIGNATURE_ALGORITHM', 'certificate'], ['ERR_CERT_NAME_CONSTRAINT_VIOLATION', 'certificate'],
  ])('classifies the bounded native code %s', (code, reason) => {
    expect(browserFailure(code)).toEqual({ reason, code });
    expect(browserFailure(` ${code.toLowerCase()} `)).toEqual({ reason, code });
  });
  it('recognizes other certificate failures without forwarding arbitrary suffixes', () => {
    expect(browserFailure('ERR_CERT_PRIVATE_DETAIL')).toEqual({ reason: 'certificate', code: 'ERR_CERT_INVALID' });
  });
  it.each([undefined, null, {}, 5, '', 'ERR_FAILED', 'https://private.example/?token=secret', '<script>private</script>', 'ERR_CERT_秘密', 'ERR_CERT_INVALID\nPRIVATE', 'ERR_CERT_' + 'X'.repeat(101)])('uses a sanitized generic fallback for %j', input => {
    expect(browserFailure(input)).toEqual({ reason: 'generic', code: 'ERR_FAILED' });
  });
});

describe('browser load error content', () => {
  it.each([
    ['dns', '服务器 IP 地址', '检查 DNS 设置'], ['offline', '离线状态', '检查网络连接'], ['refused', '拒绝建立连接', '检查网站服务'],
    ['timeout', '响应超时', '检查网络连接'], ['certificate', '证书', '检查网站证书'], ['generic', '无法加载', '检查网络连接'],
  ] as const)('renders actionable %s content without the failed path or query', (reason, summary, detail) => {
    const html = renderToStaticMarkup(createElement(BrowserLoadError, { url: 'https://example.com/private?token=secret#fragment', reason, code: 'ERR_FAILED', onRetry: () => {} }));
    expect(html).toContain('role="alert"'); expect(html).toContain('tabindex="0"'); expect(html).toContain('无法访问此站点');
    expect(html).toContain('example.com'); expect(html).toContain(summary); expect(html).toContain(detail);
    expect(html).toContain('<details>'); expect(html).toContain('<summary>排查建议</summary>'); expect(html).toContain('>重试</button>');
    for (const privateText of ['/private', 'token=secret', '#fragment']) expect(html).not.toContain(privateText);
    if (reason === 'certificate') expect(html).not.toContain('检查代理');
  });
  it.each(['file:///private', 'https://user:secret@example.com', 'invalid'])('does not echo invalid or credential-bearing URLs %s', url => {
    const html = renderToStaticMarkup(createElement(BrowserLoadError, { url, onRetry: () => {} }));
    expect(html).toContain('无法加载 此网站'); expect(html).not.toContain(url); expect(html).not.toContain('secret'); expect(html).toContain('ERR_FAILED');
  });
  it('supports an earlier browser state without a reason or code', () => {
    const html = renderToStaticMarkup(createElement(BrowserLoadError, { url: 'https://example.com', reason: null, code: null, onRetry: () => {} }));
    expect(html).toContain('无法加载 example.com'); expect(html).toContain('ERR_FAILED');
  });
});
