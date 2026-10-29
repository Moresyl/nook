import { browserNavigationAllowed, type BrowserFailureReason } from '../../contracts/browser';
import { Button } from './controls';
import { Glyph } from './glyphs';

export function BrowserLoadError({ url, reason = 'generic', code, onRetry }: { url: string; reason?: BrowserFailureReason | null; code?: string | null; onRetry(): void }) {
  const host = browserNavigationAllowed(url) ? new URL(url).hostname : '此网站';
  const summaries: Record<BrowserFailureReason, string> = {
    dns: `无法找到 ${host} 的服务器 IP 地址。`,
    offline: `无法加载 ${host}，因为计算机处于离线状态。`,
    refused: `${host} 拒绝建立连接。`,
    timeout: `${host} 响应超时。`,
    certificate: `无法验证 ${host} 的证书。`,
    generic: `无法加载 ${host}。`,
  };
  return <div className="browser-load-error" role="region" aria-label="网页加载失败" tabIndex={0}>
    <div className="browser-load-error-content">
      <div role="alert"><Glyph name="globe" size={28} /><h2>无法访问此站点</h2><p>{summaries[reason ?? 'generic']}</p></div>
      <p className="browser-load-error-try">尝试：</p>
      <ul><li>检查网址是否正确</li><li>{reason === 'certificate' ? '检查系统日期与时间，或联系网站管理员' : '检查网络连接'}</li></ul>
      <p className="browser-load-error-code">{code || 'ERR_FAILED'}</p>
      <Button onClick={onRetry}>重试</Button>
      <details>
        <summary>排查建议</summary>
        {reason === 'certificate' ? <><h3>检查网站证书</h3><p>确认网址和系统时间正确。如果问题持续，请联系网站管理员处理证书问题。</p></> : <>
          <h3>检查网络连接</h3><p>确认设备已连接网络，并尝试稍后重新加载。</p>
          {reason === 'dns' && <><h3>检查 DNS 设置</h3><p>确认域名拼写正确。如果你不清楚如何检查 DNS，请联系网络管理员。</p></>}
          {reason === 'refused' && <><h3>检查网站服务</h3><p>确认网站服务正在运行，网址中的端口正确。</p></>}
          <h3>检查代理和网络访问设置</h3><p>如果使用代理，请检查系统网络设置。公司或学校网络的访问限制可向网络管理员咨询。</p>
        </>}
      </details>
    </div>
  </div>;
}
