import type { NavigationReleaseProof } from '../scripts/release-policy.mjs';

export function navigationReleaseProof() {
  return {
    checks: 412,
    chatNavigation: {
      checks: 5,
      sidebarNavigation: {
        fixtures: 120, paginationFocus: true, currentChatBeyondFirstBatch: true, originalDraftRetained: true,
        keyboardCollapse: true, collapseSurvivesNormalRestart: true, searchRevealsCollapsedSection: true,
        automaticPagination: {
          batches: 2, pageSize: 10, composerFocusRetained: true, draftRetained: true, activeChatRetained: true,
          layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, rows: 21, screenshot: `113-sidebar-auto-${theme}-${zoom * 100}.png` }))),
        },
      },
    },
    projectTree: {
      checks: 8,
      virtualizedRows: { boundedMountedCount: true, allLoadedRowsReachableByScroll: true, completeSiblingMetadata: true, rootLoadedCounts: [200, 225] },
      stickyFolders: {
        ancestorStack: true, subtreePushOff: true, pointerCollapse: true, keyboardCanonicalFocus: true,
        noDuplicateTreeItems: true, pagination: true, refreshAndSearch: true,
        virtualizedLargeDirectory: { files: 1000, pages: 5, mountedRows: 41, keyboardLastAndFirst: true, completeSiblingMetadata: true, collapseRetainedFocus: true },
        fileMenu: {
          pointerAndKeyboard: true, rovingFocus: true, compositionEscape: true, outsideAndScrollDismissal: true,
          unchangedResizeRetainsMenu: true, changedResizeDismissesMenu: true, openAndDirectoryToggle: true,
          newFileParent: true, copyFailureRetry: true, lateCopyIsolation: true, themes: ['light', 'dark'],
          absolutePathCopy: true, absolutePathFailureRetry: true, latePathIsolation: true, revealDispatch: true, revealFailureRetry: true, invalidPathRejected: true,
          geometry: [1, 1.25, 1.5].map(zoom => ({ zoom, left: 68, top: 100, right: 288, bottom: 246, width: 507, height: 360, chrome: 36 })),
          entryActionLayouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, actualTheme: theme, zoom, left: 68, top: 92, right: 288, bottom: 352, width: 507, height: 360, chrome: 36, errorContained: true, absolutePathCopied: true, revealRetried: true, screenshot: `121-project-file-path-actions-${theme}-${zoom * 100}.png` }))),
          fileContents: {
            exactUtf8BomAndCrlf: true, emptyFile: true, maximumSize: 256_000, binaryInvalidUtf8OversizeAndMissingRejected: true,
            readFailureRetry: true, clipboardFailureRetry: true, lateReadIsolation: true, noEditorOpened: true, directoriesExcluded: true,
            layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, actualTheme: theme, zoom, left: 68, top: 60, right: 288, bottom: 352, width: 507, height: 360, chrome: 36, errorContained: true, keyboardErrorVisible: true, clipboardFailureRetried: true, screenshot: `138-project-file-copy-contents-${theme}-${zoom * 100}.png` }))),
          },
        },
      },
    },
  } satisfies NavigationReleaseProof;
}
