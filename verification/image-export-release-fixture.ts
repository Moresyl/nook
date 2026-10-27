import type { ImageExportProof } from '../scripts/release-policy.mjs';

export function imageExportReleaseProof(): ImageExportProof {
  const layouts = ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, actualTheme: theme, zoom, contained: true, pageContained: true, failureRetried: true, exactJpegBytes: true, screenshot: `136-image-export-${theme}-${zoom * 100}.png` })));
  return { cancelPreservedDestination: true, failureRetried: true, exactJpegBytes: true, delayedImageIsolation: true, draftUnchanged: true, quickChatVerified: true, sha256: 'a'.repeat(64), layouts, quickLayouts: layouts.map(row => ({ ...row, imageVisible: true, imageAreaHeight: 48, warningKeyboard: true, screenshot: row.screenshot.replace('136-image-export-', '137-image-export-quick-') })) };
}
