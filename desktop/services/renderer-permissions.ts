export function allowRendererPermission({ permission, owned, isMainFrame, requestingUrl, mainFrameUrl }: { permission: string; owned: boolean; isMainFrame: boolean; requestingUrl?: string; mainFrameUrl?: string }): boolean {
  return permission === 'clipboard-sanitized-write' && owned && isMainFrame && Boolean(mainFrameUrl) && requestingUrl === mainFrameUrl;
}
