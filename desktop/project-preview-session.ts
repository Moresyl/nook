import type { WebContents } from 'electron';
import type { ProjectPreviewSource } from './services/project-preview';

/** Both preview surfaces use the same private, offline session restrictions. */
export async function configureProjectPreview(contents: WebContents, source: ProjectPreviewSource): Promise<void> {
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', event => event.preventDefault());
  session.webRequest.onBeforeRequest((details, answer) => answer({ cancel: !details.url.startsWith(`${source.origin}/`) }));
  session.protocol.handle('nook-preview', request => source.response(request));
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-prevent-unload', event => event.preventDefault());
  contents.on('page-title-updated', event => event.preventDefault());
  await session.setProxy({ mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: '<-loopback>' });
}
