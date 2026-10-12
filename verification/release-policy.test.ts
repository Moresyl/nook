import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseNotes, releaseVersion, verifyRuntimeProof, verifySettingsSearchProof, verifyWorktreeCleanupProof, type ReleaseProof } from '../scripts/release-policy.mjs';
import { readRuntimeProof, runtimeProofFiles } from '../scripts/runtime-proof.mjs';

const hash = 'a'.repeat(64);
const contextSummaries = (): NonNullable<ReleaseProof['desktop']['contextSummaries']> => ({ checks: 6, requestCount: 10, summaryRequests: 3, originalMessages: 6, finalMessages: 14, readonlyPreviewVerified: true, actualContextRequestsVerified: true, cancellationFailureVerified: true, expiredFullContextVerified: true, restartHistoryVerified: true, restrictedQuickChatVerified: true, layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, contained: true, horizontalOverflow: false, nativeSize: [760, 620] }))), screenshots: Array.from({ length: 9 }, (_, index) => `context-summary-fixture-${index}.png`) });
const otherHash = 'b'.repeat(64);
const projectWorktrees = (): NonNullable<ReleaseProof['desktop']['projectWorktrees']> => ({ checks: 7, modelRequests: 0, bridgeValidationVerified: true, creationBusySourcePreservationVerified: true, registrationRetryVerified: true, existingBranchReuseVerified: true, hookSourcePreviewVerified: true, referenceZoomKeyboardVerified: true, restartDraftsVerified: true, rowLayout: { gap: '8px', padding: '12px', titleSize: '14px', titleWeight: '500', pathSize: '12px' }, screenshots: Array.from({ length: 12 }, (_, index) => `project-worktrees-${index}-shell.png`), layouts: projectBranches().layouts.map(row => ({ ...row, fields: ['工作树分支', '起始版本', '工作树文件夹'].map(label => ({ label, reachable: true, control: { top: 30, bottom: 52, left: 20, right: 480, width: 460, height: 22 }, content: { top: 20, bottom: 380 }, viewport: { width: 500, height: 400 } })) })) });
const toolActivities = (): NonNullable<ReleaseProof['desktop']['toolActivities']> => ({ checks: 8, commandRequests: 5, nativeStates: ['waiting', 'running', 'complete', 'error', 'stopped'], scopedClipboardPermission: true, exactOriginalCopy: true, staleClipboardGuard: true, deniedCopyRetry: true, focusBeforeInert: true, manualStreamingCollapse: true, restrictedQuickChat: true, reducedMotion: true, actualRestart: true, screenshots: Array.from({ length: 9 }, (_, i) => ({ filename: `tool-activities-fixture-${i}.png`, size: [760, 620] })), layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, fontSize: '14px', parentFontSize: '14px', gap: '4px', padding: '8px 0px 4px 24px', duration: '0.3s, 0.3s', contained: true, controlVisible: true, summaryWidth: 100, controlHeight: 24, outputScrollBounded: true, horizontalOverflow: false }))) });
const projectBranches = () => ({ checks: 8, modelRequests: 0, localListSearchVerified: true, creationValidationBusyVerified: true, overwriteRetryVerified: true, editorRefreshDraftConflictVerified: true, worktreeProjectScopeVerified: true, hookStatePreviewCleanupVerified: true, referenceZoomKeyboardVerified: true, restartDraftsVerified: true, screenshots: Array.from({ length: 13 }, (_, i) => `project-branches-${i}-shell.png`), layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, overflow: false, fieldPadding: '8px 12px 0px', fieldGap: '4px', fieldBackground: 'rgba(0, 0, 0, 0)', viewport: { width: 500, height: 400 }, dialog: { left: 10, top: 10, right: 490, bottom: 390, width: 480, height: 380 }, controls: Array.from({ length: 7 }, () => ({ visible: true, contentFits: true, width: 24, height: 24 })) }))) });
const browserTabs = () => ({ checks: 5, independentHistoryDraftsVerified: true, sharedTransientSessionVerified: true, selectedViewOnlyVerified: true, backgroundFailureCloseVerified: true, nativeShortcutsVerified: true, lastCloseFreshVerified: true, workbenchReloadAllTabsVerified: true, screenshots: Array.from({ length: 16 }, (_, i) => `browser-tabs-${i}.png`), layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, selectedVisible: true, addVisible: true, addWidth: 24, addHeight: 24, overflow: false, tabCount: 3, panelLinked: true, expected: { x: 10, y: 20, width: 200, height: 150 }, native: { x: 10, y: 20, width: 200, height: 150 } }))) });
const editorTabs = () => ({ selectedVisibilityVerified: true, keyboardNavigationVerified: true, dirtyCancelVerified: true, cleanCloseFocusVerified: true, saveFailureRetryVerified: true, originalDraftsRetained: true, screenshots: ['editor-tabs-initial.png', 'editor-tabs-close-cancel.png', 'editor-tabs-save-failure.png', ...['light', 'dark'].flatMap(theme => [100, 125, 150].map(zoom => `editor-tabs-${theme}-${zoom}.png`))], layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, selectedVisible: true, overflow: false, compact: true, actions: ['并排预览', '预览 HTML', '保存 Ctrl S'].map(name => ({ name, visible: true, width: 24, height: 24 })) }))) });
const minimumLayout = () => ['empty', 'attachment-long-input', 'conversation'].flatMap(state => ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ state, theme, zoom, nativeSize: [420, 360], controlsVisible: true, overflow: false, toolsKeyboardVerified: true }))));
const notes = (version = '1.2.3', newline = '\n') => [
  `## [${version}] - 2026-10-03`, '',
  '### 新功能', '消息正文查找支持实际代码块的水平定位。', '',
  '### 变更与安全', '完整保留原始许可证及依赖法律文档。', '',
  '### 修复与完善', '最小窗口缩放时保持发送按钮可见。', '',
  '### 安装', '下载 Windows x64 安装版或便携版，并核对 SHA-256。', '',
  '### English', 'Adds literal chat-body search and verifies Windows installation and portable execution.',
].join(newline);

const worktreeSettings = (): NonNullable<ReleaseProof['desktop']['worktreeSettings']> => ({
  checks: 10, modelRequests: 0, rootValidationVerified: true, busySaveVerified: true, saveFailurePreservationVerified: true, rootCreationVerified: true, backupRestartVerified: true, referenceZoomKeyboardVerified: true, directoryPickerVerified: true, pickerCases: 5, defaultRootVerified: true, defaultRootFailureVerified: true, defaultRootBackupRestartVerified: true,
  screenshots: Array.from({ length: 20 }, (_, index) => `worktree-settings-${index}-shell.png`),
  layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, width: 288, left: 144, right: 432, viewportWidth: 500, headingMargin: '8px', descriptionSize: '12px', pickerLeft: 440, pickerRight: 468, pickerTop: 100, pickerBottom: 128, contentLeft: 128, contentRight: 500, contentTop: 62, contentBottom: 360 }))),
  errorLayouts: Array.from({ length: 7 }, () => ({ top: 280, bottom: 316, left: 144, right: 490, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500, text: '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。' })),
});
const worktreeOverview = (): NonNullable<ReleaseProof['desktop']['worktreeOverview']> => ({
  checks: 6, modelRequests: 0, actualRepositoryAssociationVerified: true, refreshReadOnlyVerified: true, progressiveProjectResultsVerified: true, progressiveSanitizedErrorsVerified: true, managementLoadingProtectionVerified: true, errorRetryCloseVerified: true, boundedPagingVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true,
  queryPages: [Array.from({ length: 20 }, (_, index) => `project-${index}`), ['project-20'], Array.from({ length: 20 }, (_, index) => `project-${index}`)],
  screenshots: ['associations-light', 'refresh-light', 'error-light', 'loading-light', 'retry-light', 'partial-results', 'partial-error', 'management-loading', 'page-two-light',
    ...['light', 'dark'].flatMap(theme => [100, 125, 150].flatMap(zoom => ['pending', 'error', 'rows'].map(state => `${theme}-${zoom}-${state}`)))
  ].map(name => `worktree-overview-${name}-shell.png`),
  layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, contentWidth: 350, contentScrollWidth: 350, viewportWidth: 500, documentWidth: 500, pending: { top: 160, bottom: 210, left: 150, right: 480, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500 }, error: { top: 100, bottom: 140, left: 150, right: 480, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500 } }))),
});
const snapshotBounds = () => ({ top: 100, bottom: 140, left: 150, right: 480, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500, contentWidth: 350, contentScrollWidth: 350, documentWidth: 500, viewportWidth: 500 });
const snapshotFocus = (label: string) => ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, label, outline: 4, ...snapshotBounds() })));
const worktreeSnapshots = (): NonNullable<ReleaseProof['desktop']['worktreeSnapshots']> => ({
  checks: 8, modelRequests: 0, ownedOnlyCaptureVerified: true, privateSaveFailureVerified: true, backupSeparationVerified: true, normalRestartVerified: true, detachedExactRestoreVerified: true, referenceZoomKeyboardVerified: true, restoreKeyboardVerified: true, acceptedShutdownVerified: true, corruptReadRecoveryVerified: true, replacementRejectionVerified: true, sourcePreservationVerified: true,
  layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, ...snapshotBounds() }))), keyboardLayouts: snapshotFocus('保存工作树快照'), restoreKeyboardLayouts: snapshotFocus('恢复快照'),
  restoreLayouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, error: snapshotBounds(), cancel: snapshotBounds(), submit: snapshotBounds(), draftRetained: true, cancelFocusVerified: true }))),
  screenshots: Array.from({ length: 33 }, (_, index) => `worktree-snapshots-fixture-${index}-shell.png`),
});
function worktreeCleanup(): NonNullable<ReleaseProof['desktop']['worktreeCleanup']> {
  const bounds = (label: string, focused = false) => ({ ...snapshotBounds(), label, focused, outline: focused ? 4 : 0 });
  const cases = ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom })));
  return {
    checks: 10, modelRequests: 0, ownedOnlyControlsVerified: true, dirtyPinLockProtectionVerified: true, activeTerminalProtectionVerified: true, replacementRejectionVerified: true, privateFailureGateVerified: true, referenceZoomKeyboardVerified: true, exactDeleteRestoreVerified: true, fixedChatAfterRemovalVerified: true, metadataFailureVerified: true, postCreateAutomaticVerified: true, disableConfirmationVerified: true, acceptedShutdownVerified: true, sourcePreservationVerified: true,
    layouts: cases.map(row => ({ ...row, error: bounds('工作树包含修改、未跟踪或忽略文件，文件已保留。请先提交或移走这些文件，再重试。', true), cancel: bounds('取消'), submit: bounds('保存快照并删除') })),
    keyboardLayouts: cases.map(row => ({ ...row, ...bounds('保存快照并删除', true) })),
    disableLayouts: cases.map(row => ({ ...row, cancel: bounds('保留自动清理', true), submit: bounds('停用自动清理') })),
    screenshots: Array.from({ length: 27 }, (_, index) => `worktree-cleanup-fixture-${index}-shell.png`),
  };
}
function proof(): ReleaseProof {
  const audit = { compiledAssetsMatchVerifiedBuild: true, removedUiFontReferencesVerified: true, oldProductIdentityMatches: [], unresolvedAssets: [], unresolvedDistribution: [], executableSha256: hash, archiveSha256: otherHash };
  const desktop = { variant: 'packaged executable', checks: 361, normalCloseVerified: true, runtimeErrors: [], executableSha256: hash, archiveSha256: otherHash, settingsSearch: { checks: 6, modelRequests: 0, keyboardVerified: true, destinationFocusVerified: true, draftRetentionVerified: true, heldPickerVerified: true, sessionResetVerified: true, layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, contained: true, sidebarOverflow: false, panelOverflow: false, searchStyleVerified: true }))), screenshots: Array.from({ length: 18 }, (_, index) => `settings-search-${index}-shell.png`) }, projectBranches: projectBranches(), projectWorktrees: projectWorktrees(), worktreeSettings: worktreeSettings(), worktreeOverview: worktreeOverview(), worktreeConversations: worktreeConversations(), worktreeUpstream: worktreeUpstream(), worktreeRegistration: worktreeRegistration(), worktreeOwnership: worktreeOwnership(), worktreePinning: worktreePinning(), worktreeSnapshots: worktreeSnapshots(), worktreeCleanup: worktreeCleanup(), toolActivities: toolActivities(), contextSummaries: contextSummaries(),
    browser: { tabs: browserTabs(), checks: 14, modelRequests: 0, isolation: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: false, privateSession: true }, nativeHistoryVerified: true, pendingAddressStopVerified: true, sameUrlRedirectVerified: true, unsubmittedAddressRetained: true, popupPrivateNavigationDenied: true, failureRetryVerified: true, keyboardFocusVerified: true, draftRetained: true, modalOcclusionVerified: true, privateRestartVerified: true, workbenchReloadVerified: true, staleOwnerCloseVerified: true, screenshots: Array.from({ length: 15 }, (_, i) => `browser-${i}.png`), layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, viewport: { width: 200, height: 150 }, navigation: { selectedVisible: true, current: 'page' }, expected: { x: 10, y: 20, right: 210, bottom: 170 }, native: { x: 10, y: 20, width: 200, height: 150 } }))) },
    quickChat: { refreshRaceVerified: true, minimumErrorVerified: true, checks: 9, quickModelRequests: 3, mainFixtureRequests: 1, originalSha256: hash, minimumLayout: minimumLayout(), independentDraftsVerified: true, restrictedBridgeVerified: true, exactOriginalVerified: true, textOnlyTransportVerified: true, stopOwnerVerified: true, approvalScopeVerified: true, handoffVerified: true, windowStateVerified: true, shortcutTargetVerified: true, filesystemRetryVerified: true, backupRestartVerified: true, staleRevisionVerified: true, layout: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, controlsVisible: true, overflow: false }))) },
    mcpPdf: { checks: 8, explicitModelRequests: 1, previewPersisted: false, originalSha256: hash, exactOriginalVerified: true, promptPdfVerified: true, textOnlyModelTransportVerified: true, staleSubscriptionVerified: true, filesystemRetryVerified: true, restartVerified: true, backupRestoreVerified: true, restoreCompletionVerified: true, layout: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, controlsVisible: true, overflow: false }))) },
    pdfPreview: { checks: 6, canvasTextVerified: true, outlineTargetsVerified: true, fullDocumentSearchVerified: true, linksNotesZoomVerified: true, exportOwnershipRestartVerified: true },
    attachments: { pdfOriginal: { textOnlyProtocols: ['responses', 'openai', 'anthropic', 'gemini', 'ollama', 'azure-responses', 'azure-chat', 'azure-deployment'], restartBytesVerified: true, deduplicatedBackupVerified: true, missingFileRestoredVerified: true } },
    memories: { checks: 3 }, projectPreview: { checks: 10, outsideHttpRequests: 0, editorTabs: editorTabs(), docked: { checks: 5, floatingTransferVerified: true, projectRemovalVerified: true, workbenchReloadVerified: true, staleOwnerCloseVerified: true } },
    promptTransfer: { checks: 5, transferModelRequests: 0, exportModesVerified: true, inertPreviewCancelVerified: true, atomicImportRetryVerified: true, sharedFreshAssociationsVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true } };
  return {
    audit, desktop: { ...desktop, mcpResourceSubscriptions: { checks: 6, modelRequests: 0, realNotificationsVerified: true, explicitDraftInsertionVerified: true, delayedUnsubscribeFiltered: true, templateSelectionVerified: true, disconnectRestartVerified: true, unsupportedServerVerified: true, zoomKeyboardVerified: true, originalDraftRetained: true }, mcpBinaryFiles: { checks: 6, binaryModelRequests: 0, realWorkerPreviewVerified: true, exactOriginalExportVerified: true, emptyAndUnsupportedExportVerified: true, promptBinaryTextOnlyVerified: true, staleSelectionVerified: true, zoomKeyboardVerified: true, restartDraftRetainedVerified: true }, assistantRecipes: { checks: 4, recipeModelRequests: 0, assistantBindingVerified: true, defaultOptionalChoicesVerified: true, deletedAssistantRecoveryVerified: true, zoomKeyboardVerified: true, backupRestartVerified: true, originalDraftRetained: true } }, surfaces: { ...desktop, checks: 4 },
    preview: { ...desktop, ...structuredClone(desktop.projectPreview) },
    branches: { ...desktop, checks: 9, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, modelRequests: 0, ambiguousHistoryRecoveryVerified: true, manualOrderingVerified: true, orderingFailureRecoveryVerified: true, orderingBackupRestartVerified: true },
    temporary: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, temporaryModelRequests: 3, persistenceExcludedVerified: true, backupsExcludedVerified: true, restartClearedVerified: true, storageModeImmutableVerified: true, regularDraftsRetainedVerified: true },
    comparisons: { ...desktop, checks: 6, verificationRun: 'complete desktop suite', suiteChecks: desktop.checks, comparisonModelRequests: 11, parallelStreamsVerified: true, independentFailureStopVerified: true, atomicSaveRetryVerified: true, backupsRestartVerified: true, temporaryExclusionVerified: true, originalDraftRetainedVerified: true, originalModelIdentityVerified: true },
    portable: { checks: 7, launches: [{ longDocumentPathLength: 301 }, { longDocumentPathLength: 301 }], longPathCleanupVerified: true, unpackedFilesVerified: 50, runtimeErrors: [], wrapperSha256: hash, childExecutableSha256: hash },
    portableAudit: { executableSha256: hash, archiveSha256: otherHash, unresolvedAssets: [], unresolvedDistribution: [] },
    bootstrap: { variants: ['installer', 'uninstaller', 'portable'].map((variant) => ({ variant, executableSha256: hash, plugins: [{ redistributionStatus: 'verified' }] })) },
    installer: { checks: desktop.checks, normalCloseVerified: true, registrationVerified: true, shortcutsVerified: true, uninstalled: true, userDataRetained: true, executableSha256: hash, archiveSha256: otherHash, installerSha256: hash },
  };
}

function worktreeConversations(): NonNullable<ReleaseProof['desktop']['worktreeConversations']> {
  return {
    checks: 4, modelRequests: 0, linkedConversationVerified: true, projectDraftVerified: true, heldFailureRetryRestartVerified: true, staleTargetsVerified: true, sanitizedErrorsVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true,
    screenshots: Array.from({ length: 19 }, (_, index) => `worktree-conversations-${index}-shell.png`),
    keyboardLayouts: worktreeKeyboardLayouts().map(row => ({ ...row, label: '新建项目聊天' })),
    layouts: ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, contentWidth: 350, contentScrollWidth: 350, viewportWidth: 500, documentWidth: 500, top: 100, bottom: 140, left: 150, right: 480, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500 }))),
  };
}

function worktreeKeyboardLayouts() {
  return ['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].map(zoom => ({ theme, zoom, outline: 4, top: 100, bottom: 124, left: 400, right: 480, viewportTop: 62, viewportBottom: 360, viewportLeft: 128, viewportRight: 500 })));
}
function worktreeUpstream(): NonNullable<ReleaseProof['desktop']['worktreeUpstream']> {
  return {
    checks: 5, modelRequests: 0, preferenceFailureRetryVerified: true, actualFetchPinnedCommitVerified: true, neverAndMissingUpstreamVerified: true, actualFailureRetryVerified: true, backupRestartVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true,
    screenshots: Array.from({ length: 20 }, (_, index) => `worktree-upstream-${index}-shell.png`),
    layouts: worktreeConversations().layouts,
    keyboardLayouts: worktreeKeyboardLayouts(),
  };
}

function worktreePinning(): NonNullable<ReleaseProof['desktop']['worktreePinning']> {
  return {
    checks: 6, modelRequests: 0, ownedOnlyControlsVerified: true, heldFailureRetryVerified: true,
    staleSourceReadRecoveryVerified: true, backupSeparationVerified: true, normalRestartVerified: true,
    referenceZoomKeyboardVerified: true, replacementRejectionVerified: true, sourcePreservationVerified: true,
    screenshots: Array.from({ length: 21 }, (_, index) => `worktree-pinning-${index}-shell.png`),
    layouts: worktreeConversations().layouts,
    keyboardLayouts: worktreeKeyboardLayouts().map(row => ({ ...row, label: '固定工作树' })),
  };
}

describe('worktree cleanup release evidence', () => {
  it('requires all real safety, scheduler, preservation and shutdown outcomes', () => {
    expect(() => verifyWorktreeCleanupProof(undefined)).toThrow('worktree cleanup');
    const missing = proof(); delete missing.desktop.worktreeCleanup; expect(() => verifyRuntimeProof(missing)).toThrow('worktree cleanup');
    for (const [key, value] of Object.entries(worktreeCleanup())) {
      if (typeof value !== 'boolean') continue;
      const invalid = worktreeCleanup(); (invalid as unknown as Record<string, unknown>)[key] = false; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup');
    }
    for (const [key, value] of Object.entries({ checks: 9, modelRequests: 1 })) { const invalid = worktreeCleanup(); (invalid as unknown as Record<string, unknown>)[key] = value; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup'); }
    expect(() => verifyWorktreeCleanupProof(worktreeCleanup())).not.toThrow(); expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('rejects previous complete-suite counts without the ten cleanup checks', () => {
    for (const checks of [345, 354]) { const invalid = proof(); invalid.desktop.checks = checks; expect(() => verifyRuntimeProof(invalid)).toThrow('Complete desktop'); }
  });
  it('requires distinct theme and zoom cases in deletion, focus and disable confirmation arrays', () => {
    for (const key of ['layouts', 'keyboardLayouts', 'disableLayouts'] as const) {
      const missing = worktreeCleanup(); missing[key] = []; expect(() => verifyWorktreeCleanupProof(missing)).toThrow('worktree cleanup');
      const duplicate = worktreeCleanup(); duplicate[key][1].zoom = 1; expect(() => verifyWorktreeCleanupProof(duplicate)).toThrow('worktree cleanup');
      const wrong = worktreeCleanup(); wrong[key][0].theme = 'unknown'; expect(() => verifyWorktreeCleanupProof(wrong)).toThrow('worktree cleanup');
    }
  });
  it('rejects clipped, overflowing and nonfinite confirmation errors or footer controls', () => {
    for (const key of ['error', 'cancel', 'submit'] as const) for (const [dimension, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, documentWidth: 501, viewportWidth: 0, outline: NaN, viewportTop: Infinity })) {
      const invalid = worktreeCleanup(); (invalid.layouts[0][key] as unknown as Record<string, unknown>)[dimension] = value; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup');
    }
    for (const key of ['cancel', 'submit'] as const) { const invalid = worktreeCleanup(); invalid.disableLayouts[0][key].bottom = 361; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup'); }
  });
  it('rejects lost focus or mislabeled deletion and disable actions', () => {
    for (const [key, value] of Object.entries({ outline: 0, focused: false, label: 'Another action', top: 63 })) {
      for (const kind of ['keyboard', 'error', 'disable'] as const) { const invalid = worktreeCleanup(); const row = kind === 'keyboard' ? invalid.keyboardLayouts[0] : kind === 'error' ? invalid.layouts[0].error : invalid.disableLayouts[0].cancel; (row as unknown as Record<string, unknown>)[key] = value; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup'); }
    }
    const wrong = worktreeCleanup(); wrong.disableLayouts[0].submit.label = 'Cancel'; expect(() => verifyWorktreeCleanupProof(wrong)).toThrow('worktree cleanup');
  });
  it('requires twenty-seven safe distinct native originals', () => {
    const missing = worktreeCleanup(); missing.screenshots.pop(); expect(() => verifyWorktreeCleanupProof(missing)).toThrow('worktree cleanup');
    const duplicate = worktreeCleanup(); duplicate.screenshots[1] = duplicate.screenshots[0]; expect(() => verifyWorktreeCleanupProof(duplicate)).toThrow('worktree cleanup');
    for (const name of ['../escape-shell.png', 'worktree-snapshots-error-shell.png', 'worktree-cleanup-error.png']) { const invalid = worktreeCleanup(); invalid.screenshots[0] = name; expect(() => verifyWorktreeCleanupProof(invalid)).toThrow('worktree cleanup'); }
  });
});

describe('settings search release evidence', () => {
  it('shares the complete settings gate with actual installation verification', () => {
    expect(() => verifySettingsSearchProof(proof().desktop.settingsSearch)).not.toThrow();
    expect(() => verifySettingsSearchProof(undefined)).toThrow('settings search');
    const incomplete = proof().desktop.settingsSearch!; incomplete.heldPickerVerified = false;
    expect(() => verifySettingsSearchProof(incomplete)).toThrow('settings search');
  });
  it('requires all original checks plus the six new native checks', () => {
    const old = proof(); old.desktop.checks = 355; expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.settingsSearch; expect(() => verifyRuntimeProof(missing)).toThrow('settings search');
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('rejects missing behaviors, requests, incomplete layouts and duplicated screenshots', () => {
    for (const [key, value] of Object.entries({ checks: 5, modelRequests: 1, keyboardVerified: false, destinationFocusVerified: false, draftRetentionVerified: false, heldPickerVerified: false, sessionResetVerified: false })) {
      const invalid = proof(); (invalid.desktop.settingsSearch as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('settings search');
    }
    const overflow = proof(); overflow.desktop.settingsSearch!.layouts[0].sidebarOverflow = true; expect(() => verifyRuntimeProof(overflow)).toThrow('settings search');
    const oldStyle = proof(); oldStyle.desktop.settingsSearch!.layouts[0].searchStyleVerified = false; expect(() => verifyRuntimeProof(oldStyle)).toThrow('settings search');
    const duplicateLayout = proof(); duplicateLayout.desktop.settingsSearch!.layouts[1] = duplicateLayout.desktop.settingsSearch!.layouts[0]; expect(() => verifyRuntimeProof(duplicateLayout)).toThrow('settings search');
    const duplicateImage = proof(); duplicateImage.desktop.settingsSearch!.screenshots[1] = duplicateImage.desktop.settingsSearch!.screenshots[0]; expect(() => verifyRuntimeProof(duplicateImage)).toThrow('settings search');
    const missingImage = proof(); missingImage.desktop.settingsSearch!.screenshots.pop(); expect(() => verifyRuntimeProof(missingImage)).toThrow('settings search');
    const wrongImage = proof(); wrongImage.desktop.settingsSearch!.screenshots[0] = 'old-proof.png'; expect(() => verifyRuntimeProof(wrongImage)).toThrow('settings search');
  });
});

describe('worktree snapshot release evidence', () => {
  it('requires real private capture, exact restore, restart, backup separation and accepted quit drainage', () => {
    const missing = proof(); delete missing.desktop.worktreeSnapshots; expect(() => verifyRuntimeProof(missing)).toThrow('worktree snapshot');
    for (const [key, value] of Object.entries({ checks: 7, modelRequests: 1, ownedOnlyCaptureVerified: false, privateSaveFailureVerified: false, backupSeparationVerified: false, normalRestartVerified: false, detachedExactRestoreVerified: false, referenceZoomKeyboardVerified: false, restoreKeyboardVerified: false, acceptedShutdownVerified: false, corruptReadRecoveryVerified: false, replacementRejectionVerified: false, sourcePreservationVerified: false })) {
      const invalid = proof(); (invalid.desktop.worktreeSnapshots as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot');
    }
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('rejects previous complete-suite counts that omit the new native snapshot checks', () => {
    for (const checks of [337, 344]) { const invalid = proof(); invalid.desktop.checks = checks; expect(() => verifyRuntimeProof(invalid)).toThrow('Complete desktop'); }
  });
  it('requires six distinct explicit theme/zoom cases for all save and restore evidence arrays', () => {
    for (const key of ['layouts', 'keyboardLayouts', 'restoreLayouts', 'restoreKeyboardLayouts'] as const) {
      const missing = proof(); missing.desktop.worktreeSnapshots![key] = []; expect(() => verifyRuntimeProof(missing)).toThrow('worktree snapshot');
      const duplicate = proof(); duplicate.desktop.worktreeSnapshots![key][1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree snapshot');
      const wrong = proof(); wrong.desktop.worktreeSnapshots![key][0].theme = 'unknown'; expect(() => verifyRuntimeProof(wrong)).toThrow('worktree snapshot');
    }
  });
  it('rejects clipped, overflowing, empty or nonfinite save feedback', () => {
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501, viewportTop: NaN })) {
      const invalid = proof(); (invalid.desktop.worktreeSnapshots!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot');
    }
  });
  it('rejects clipped restore errors or footer buttons and lost target drafts or cancel focus', () => {
    for (const kind of ['error', 'cancel', 'submit'] as const) for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, documentWidth: 501, viewportTop: Infinity })) {
      const invalid = proof(); (invalid.desktop.worktreeSnapshots!.restoreLayouts[0][kind] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot');
    }
    for (const key of ['draftRetained', 'cancelFocusVerified'] as const) { const invalid = proof(); invalid.desktop.worktreeSnapshots!.restoreLayouts[0][key] = false; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot'); }
  });
  it('rejects missing, misplaced, nonfinite or mislabeled actual keyboard focus outlines', () => {
    for (const kind of ['keyboardLayouts', 'restoreKeyboardLayouts'] as const) for (const [key, value] of Object.entries({ outline: 0, top: 63, bottom: 358, left: 130, right: 498, viewportTop: NaN, label: 'Other control' })) {
      const invalid = proof(); (invalid.desktop.worktreeSnapshots![kind][0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot');
    }
  });
  it('requires thirty-three distinct safe snapshot originals', () => {
    const missing = proof(); missing.desktop.worktreeSnapshots!.screenshots.pop(); expect(() => verifyRuntimeProof(missing)).toThrow('worktree snapshot');
    const duplicate = proof(); duplicate.desktop.worktreeSnapshots!.screenshots[1] = duplicate.desktop.worktreeSnapshots!.screenshots[0]; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree snapshot');
    for (const name of ['../escape-shell.png', 'worktree-pinning-error-shell.png', 'worktree-snapshots-error.png', 'worktree-snapshots-秘密-shell.png']) { const invalid = proof(); invalid.desktop.worktreeSnapshots!.screenshots[0] = name; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree snapshot'); }
  });
});

describe('worktree pinning release evidence', () => {
  it('requires the complete count and all actual local-pin, failure, replacement and recovery guarantees', () => {
    for (const checks of [331, 336]) { const invalid = proof(); invalid.desktop.checks = checks; expect(() => verifyRuntimeProof(invalid)).toThrow('Complete desktop'); }
    const missing = proof(); delete missing.desktop.worktreePinning; expect(() => verifyRuntimeProof(missing)).toThrow('worktree pinning');
    for (const [key, value] of Object.entries({ checks: 5, modelRequests: 1, ownedOnlyControlsVerified: false, heldFailureRetryVerified: false, staleSourceReadRecoveryVerified: false, backupSeparationVerified: false, normalRestartVerified: false, referenceZoomKeyboardVerified: false, replacementRejectionVerified: false, sourcePreservationVerified: false, layouts: [], keyboardLayouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreePinning as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree pinning');
    }
  });
  it('rejects clipped errors, overflow, non-finite bounds and missing theme/zoom cases', () => {
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501, viewportBottom: Infinity, viewportLeft: NaN })) {
      const invalid = proof(); (invalid.desktop.worktreePinning!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree pinning');
    }
    const reversed = proof(); reversed.desktop.worktreePinning!.layouts[0].bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('worktree pinning');
    const duplicate = proof(); duplicate.desktop.worktreePinning!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree pinning');
  });
  it('requires the actual pin label and complete finite keyboard outline bounds', () => {
    for (const [key, value] of Object.entries({ label: '其他按钮', outline: 0, top: 62, bottom: 360, left: 128, right: 500, viewportBottom: Infinity, viewportLeft: NaN })) {
      const invalid = proof(); (invalid.desktop.worktreePinning!.keyboardLayouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree pinning');
    }
    const reversed = proof(); reversed.desktop.worktreePinning!.keyboardLayouts[0].bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('worktree pinning');
    const duplicate = proof(); duplicate.desktop.worktreePinning!.keyboardLayouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree pinning');
  });
  it('requires 21 safe unique originals from this feature', () => {
    const duplicate = proof(); duplicate.desktop.worktreePinning!.screenshots[1] = duplicate.desktop.worktreePinning!.screenshots[0]; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree pinning');
    for (const filename of ['../escape-shell.png', 'worktree-ownership-error-shell.png', 'worktree-pinning-error.png', 'worktree-pinning-秘密-shell.png']) {
      const invalid = proof(); invalid.desktop.worktreePinning!.screenshots[0] = filename; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree pinning');
    }
  });
});

function worktreeOwnership(): NonNullable<ReleaseProof['desktop']['worktreeOwnership']> {
  return {
    checks: 5, modelRequests: 0, externalNonAdoptionVerified: true, newBranchReceiptVerified: true,
    existingBranchReceiptVerified: true, atomicFailureRetentionVerified: true, normalRestartVerified: true,
    backupSeparationVerified: true, sourcePreservationVerified: true, keyboardWarningLayoutsVerified: true,
    screenshots: Array.from({ length: 10 }, (_, index) => `worktree-ownership-${index}-shell.png`),
    layouts: worktreeConversations().layouts.map(({ theme, zoom, ...bounds }) => ({ theme, zoom, bounds, focus: { left: 150, right: 490, top: 100, bottom: 140, width: 500, height: 400, outline: 'solid', outlineWidth: 2 } })),
  };
}

describe('worktree ownership release evidence', () => {
  it('requires the new complete count and every real creation, retention, restart and separation guarantee', () => {
    for (const checks of [326, 330]) { const invalid = proof(); invalid.desktop.checks = checks; expect(() => verifyRuntimeProof(invalid)).toThrow('Complete desktop'); }
    const missing = proof(); delete missing.desktop.worktreeOwnership; expect(() => verifyRuntimeProof(missing)).toThrow('worktree ownership');
    for (const [key, value] of Object.entries({ checks: 4, modelRequests: 1, externalNonAdoptionVerified: false, newBranchReceiptVerified: false, existingBranchReceiptVerified: false, atomicFailureRetentionVerified: false, normalRestartVerified: false, backupSeparationVerified: false, sourcePreservationVerified: false, keyboardWarningLayoutsVerified: false, layouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeOwnership as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree ownership');
    }
  });
  it('rejects clipped warning geometry, overflow, non-finite dimensions and missing theme/zoom pairs', () => {
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeOwnership!.layouts[0].bounds as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree ownership');
    }
    const finite = proof(); finite.desktop.worktreeOwnership!.layouts[0].bounds.viewportWidth = Infinity; expect(() => verifyRuntimeProof(finite)).toThrow('worktree ownership');
    const reversed = proof(); reversed.desktop.worktreeOwnership!.layouts[0].bounds.bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('worktree ownership');
    const duplicate = proof(); duplicate.desktop.worktreeOwnership!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree ownership');
  });
  it('requires full visible keyboard focus bounds rather than just a positive outline', () => {
    for (const [key, value] of Object.entries({ outlineWidth: 0, outline: 'none', left: -1, top: -1, right: 501, bottom: 401, width: 0, height: 0 })) {
      const invalid = proof(); (invalid.desktop.worktreeOwnership!.layouts[0].focus as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree ownership');
    }
    const finite = proof(); finite.desktop.worktreeOwnership!.layouts[0].focus.left = NaN; expect(() => verifyRuntimeProof(finite)).toThrow('worktree ownership');
  });
  it('rejects duplicated, unrelated and unsafe retained original filenames', () => {
    const duplicate = proof(); duplicate.desktop.worktreeOwnership!.screenshots[1] = duplicate.desktop.worktreeOwnership!.screenshots[0]; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree ownership');
    for (const filename of ['../escape-shell.png', 'worktree-registration-error-shell.png', 'worktree-ownership-error.png', 'worktree-ownership-秘密-shell.png']) {
      const invalid = proof(); invalid.desktop.worktreeOwnership!.screenshots[0] = filename; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree ownership');
    }
  });
});

function worktreeRegistration(): NonNullable<ReleaseProof['desktop']['worktreeRegistration']> {
  return {
    checks: 5, modelRequests: 0, inlineValidationCancelVerified: true, actualFailureSameIdRetryVerified: true,
    duplicatePreservationVerified: true, staleSourceVerified: true, backupRestartVerified: true, referenceZoomKeyboardVerified: true, sourcePreservationVerified: true,
    screenshots: Array.from({ length: 19 }, (_, index) => `worktree-registration-${index}-shell.png`),
    layouts: worktreeConversations().layouts,
    keyboardLayouts: worktreeKeyboardLayouts().map(row => ({ ...row, label: '登记项目' })),
  };
}

describe('worktree registration release evidence', () => {
  it('requires every actual registration, same-ID retry, duplicate, stale-source, recovery and preservation guarantee', () => {
    const missing = proof(); delete missing.desktop.worktreeRegistration; expect(() => verifyRuntimeProof(missing)).toThrow('worktree registration');
    for (const [key, value] of Object.entries({ checks: 4, modelRequests: 1, inlineValidationCancelVerified: false, actualFailureSameIdRetryVerified: false, duplicatePreservationVerified: false, staleSourceVerified: false, backupRestartVerified: false, referenceZoomKeyboardVerified: false, sourcePreservationVerified: false, layouts: [], keyboardLayouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeRegistration as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree registration');
    }
  });
  it('rejects clipped errors, horizontal overflow, reversed geometry and missing theme/zoom cases', () => {
    for (const [field, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeRegistration!.layouts[0] as unknown as Record<string, unknown>)[field] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree registration');
    }
    const reversed = proof(); reversed.desktop.worktreeRegistration!.layouts[0].bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('worktree registration');
    const duplicate = proof(); duplicate.desktop.worktreeRegistration!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree registration');
    const theme = proof(); theme.desktop.worktreeRegistration!.layouts[0].theme = 'other'; expect(() => verifyRuntimeProof(theme)).toThrow('worktree registration');
  });
  it('requires actual submit labels and fully visible focus outlines in all six keyboard cases', () => {
    for (const [field, value] of Object.entries({ label: '其他按钮', outline: 0, top: 62, bottom: 360, left: 128, right: 500 })) {
      const invalid = proof(); (invalid.desktop.worktreeRegistration!.keyboardLayouts[0] as unknown as Record<string, unknown>)[field] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree registration');
    }
    const duplicate = proof(); duplicate.desktop.worktreeRegistration!.keyboardLayouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree registration');
    const reversed = proof(); reversed.desktop.worktreeRegistration!.keyboardLayouts[0].bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('worktree registration');
  });
  it('rejects duplicated, unrelated and unsafe original filenames', () => {
    const duplicate = proof(); duplicate.desktop.worktreeRegistration!.screenshots[1] = duplicate.desktop.worktreeRegistration!.screenshots[0]; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree registration');
    for (const filename of ['../escape-shell.png', 'worktree-upstream-error-shell.png', 'worktree-registration-error.png', 'worktree-registration-秘密-shell.png']) {
      const invalid = proof(); invalid.desktop.worktreeRegistration!.screenshots[0] = filename; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree registration');
    }
  });
});

describe('worktree upstream release evidence', () => {
  it('requires every native policy, real-fetch, recovery and preservation guarantee', () => {
    const missing = proof(); delete missing.desktop.worktreeUpstream; expect(() => verifyRuntimeProof(missing)).toThrow('worktree upstream');
    for (const [key, value] of Object.entries({ checks: 4, modelRequests: 1, preferenceFailureRetryVerified: false, actualFetchPinnedCommitVerified: false, neverAndMissingUpstreamVerified: false, actualFailureRetryVerified: false, backupRestartVerified: false, referenceZoomKeyboardVerified: false, sourcePreservationVerified: false, layouts: [], keyboardLayouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeUpstream as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree upstream');
    }
  });
  it('rejects clipped errors, horizontal overflow, missing zooms and duplicate originals', () => {
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeUpstream!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree upstream');
    }
    const duplicate = proof(); duplicate.desktop.worktreeUpstream!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree upstream');
    const screenshot = proof(); screenshot.desktop.worktreeUpstream!.screenshots[1] = screenshot.desktop.worktreeUpstream!.screenshots[0]; expect(() => verifyRuntimeProof(screenshot)).toThrow('worktree upstream');
  });
});

describe.each(['worktreeUpstream', 'worktreeConversations'] as const)('%s focus outline release evidence', key => {
  it('rejects missing keyboard measurements, duplicate zooms and partially clipped outlines', () => {
    const missing = proof(); delete (missing.desktop[key] as unknown as Record<string, unknown>).keyboardLayouts; expect(() => verifyRuntimeProof(missing)).toThrow('Complete worktree');
    for (const [field, value] of Object.entries({ outline: 0, top: 62, bottom: 360, left: 128, right: 500 })) {
      const invalid = proof(); (invalid.desktop[key]!.keyboardLayouts[0] as unknown as Record<string, unknown>)[field] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('Complete worktree');
    }
    const duplicate = proof(); duplicate.desktop[key]!.keyboardLayouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('Complete worktree');
    const reversed = proof(); reversed.desktop[key]!.keyboardLayouts[0].bottom = 99; expect(() => verifyRuntimeProof(reversed)).toThrow('Complete worktree');
  });
});
describe('worktree conversation release evidence', () => {
  it('rejects missing native navigation and every incomplete preservation guarantee', () => {
    const missing = proof(); delete missing.desktop.worktreeConversations; expect(() => verifyRuntimeProof(missing)).toThrow('worktree conversation');
    for (const [key, value] of Object.entries({ checks: 3, modelRequests: 1, linkedConversationVerified: false, projectDraftVerified: false, heldFailureRetryRestartVerified: false, staleTargetsVerified: false, sanitizedErrorsVerified: false, referenceZoomKeyboardVerified: false, sourcePreservationVerified: false, layouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeConversations as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree conversation');
    }
  });
  it('rejects clipped or overflowing errors, missing zoom cases and duplicate originals', () => {
    for (const [key, value] of Object.entries({ top: 0, bottom: 400, left: 0, right: 501, contentWidth: 0, contentScrollWidth: 351, documentWidth: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeConversations!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree conversation');
    }
    const duplicate = proof(); duplicate.desktop.worktreeConversations!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree conversation');
    const screenshot = proof(); screenshot.desktop.worktreeConversations!.screenshots[1] = screenshot.desktop.worktreeConversations!.screenshots[0]; expect(() => verifyRuntimeProof(screenshot)).toThrow('worktree conversation');
  });
});
describe('worktree overview release evidence', () => {
  it('requires the actual overview and all read-only, retry, paging and source guarantees', () => {
    const missing = proof(); delete missing.desktop.worktreeOverview; expect(() => verifyRuntimeProof(missing)).toThrow('worktree overview');
    for (const [key, value] of Object.entries({ checks: 5, modelRequests: 1, actualRepositoryAssociationVerified: false, refreshReadOnlyVerified: false, progressiveProjectResultsVerified: false, progressiveSanitizedErrorsVerified: false, managementLoadingProtectionVerified: false, errorRetryCloseVerified: false, boundedPagingVerified: false, referenceZoomKeyboardVerified: false, sourcePreservationVerified: false, queryPages: [], layouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeOverview as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('rejects unbounded, duplicate, empty, repeated or reordered query pages', () => {
    const mutate = (change: (pages: string[][]) => void) => { const invalid = proof(); change(invalid.desktop.worktreeOverview!.queryPages); expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview'); };
    mutate(pages => pages[0].push('extra')); mutate(pages => pages[0][1] = pages[0][0]); mutate(pages => pages[0][0] = '');
    mutate(pages => pages[1][0] = pages[0][0]); mutate(pages => pages[2].reverse()); mutate(pages => pages[1].push('extra'));
  });
  it('requires progressive receipts and real pending bounds in every theme and zoom', () => {
    for (const key of ['progressiveProjectResultsVerified', 'progressiveSanitizedErrorsVerified', 'managementLoadingProtectionVerified']) {
      const invalid = proof(); delete (invalid.desktop.worktreeOverview as unknown as Record<string, unknown>)[key]; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    for (let index = 0; index < 6; index++) {
      const invalid = proof(); delete (invalid.desktop.worktreeOverview!.layouts[index] as unknown as Record<string, unknown>).pending; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
  });
  it('rejects clipped, empty, inverted and non-finite pending project rectangles', () => {
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeOverview!.layouts[0].pending as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    for (const [key, value] of Object.entries({ bottom: 160, right: 150, top: 211, left: 481 })) {
      const invalid = proof(); (invalid.desktop.worktreeOverview!.layouts[0].pending as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    for (const key of ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight']) {
      for (const value of [undefined, NaN, Infinity, -Infinity]) {
        const invalid = proof(); (invalid.desktop.worktreeOverview!.layouts[0].pending as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
      }
    }
  });
  it('rejects the old eighteen originals and substituted required progressive state images', () => {
    const stale = proof(); stale.desktop.worktreeOverview!.screenshots = stale.desktop.worktreeOverview!.screenshots.slice(0, 18); expect(() => verifyRuntimeProof(stale)).toThrow('worktree overview');
    for (const name of ['partial-results', 'partial-error', 'management-loading', ...['light', 'dark'].flatMap(theme => [100, 125, 150].map(zoom => `${theme}-${zoom}-pending`))]) {
      const invalid = proof(), images = invalid.desktop.worktreeOverview!.screenshots;
      images[images.indexOf(`worktree-overview-${name}-shell.png`)] = 'worktree-overview-unverified-shell.png'; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
  });
  it('rejects clipped errors, horizontal overflow and duplicate layouts or originals', () => {
    for (const [key, value] of Object.entries({ contentWidth: 0, contentScrollWidth: 351, viewportWidth: 0, documentWidth: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeOverview!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501 })) {
      const invalid = proof(); (invalid.desktop.worktreeOverview!.layouts[0].error as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree overview');
    }
    const duplicate = proof(); duplicate.desktop.worktreeOverview!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree overview');
    const screenshot = proof(); screenshot.desktop.worktreeOverview!.screenshots[1] = screenshot.desktop.worktreeOverview!.screenshots[0]; expect(() => verifyRuntimeProof(screenshot)).toThrow('worktree overview');
  });
});

describe('worktree root settings release evidence', () => {
  it('rejects the previous suite and requires all actual root, failure, creation and restoration guarantees', () => {
    for (const checks of [303,305,306,311,312,315,316,320,321,325]) { const old = proof(); old.desktop.checks = checks; expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop'); }
    const missing = proof(); delete missing.desktop.worktreeSettings; expect(() => verifyRuntimeProof(missing)).toThrow('worktree root settings');
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
    for (const [key, value] of Object.entries({ checks: 7, modelRequests: 1, rootValidationVerified: false, busySaveVerified: false, saveFailurePreservationVerified: false, rootCreationVerified: false, backupRestartVerified: false, referenceZoomKeyboardVerified: false, directoryPickerVerified: false, pickerCases: 4, defaultRootVerified: false, defaultRootFailureVerified: false, defaultRootBackupRestartVerified: false, layouts: [], errorLayouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.worktreeSettings as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree root settings');
    }
  });
  it('rejects clipped errors, duplicate zooms or screenshots and incorrect shared field geometry', () => {
    for (const [key, value] of Object.entries({ width: 289, left: -1, right: 501, headingMargin: '0px', descriptionSize: '13px', pickerLeft: 127, pickerRight: 501, pickerTop: 61, pickerBottom: 361 })) {
      const invalid = proof(); (invalid.desktop.worktreeSettings!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree root settings');
    }
    for (const [key, value] of Object.entries({ top: 61, bottom: 361, left: 127, right: 501, text: 'English save error' })) {
      const invalid = proof(); (invalid.desktop.worktreeSettings!.errorLayouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('worktree root settings');
    }
    const duplicate = proof(); duplicate.desktop.worktreeSettings!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('worktree root settings');
    const screenshot = proof(); screenshot.desktop.worktreeSettings!.screenshots[1] = screenshot.desktop.worktreeSettings!.screenshots[0]; expect(() => verifyRuntimeProof(screenshot)).toThrow('worktree root settings');
  });
});

describe('project worktree release evidence', () => {
  it('requires the new complete suite and every creation, preservation, retry and isolation guarantee', () => {
    const old = proof(); old.desktop.checks = 289; expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.projectWorktrees; expect(() => verifyRuntimeProof(missing)).toThrow('project worktree');
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
    for (const [key, value] of Object.entries({ checks: 6, modelRequests: 1, bridgeValidationVerified: false, creationBusySourcePreservationVerified: false, registrationRetryVerified: false, existingBranchReuseVerified: false, hookSourcePreviewVerified: false, referenceZoomKeyboardVerified: false, restartDraftsVerified: false, layouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.projectWorktrees as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('project worktree');
    }
  });
  it('rejects missing reference row metrics, clipped fields, duplicate zooms and incomplete native screenshots', () => {
    for (const [key, value] of Object.entries({ gap: '4px', padding: '8px', titleSize: '12px', titleWeight: '400', pathSize: '14px' })) {
      const invalid = proof(); (invalid.desktop.projectWorktrees!.rowLayout as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('project worktree');
    }
    const clipped = proof(); clipped.desktop.projectWorktrees!.layouts[0].fields[0].control.bottom = 381; expect(() => verifyRuntimeProof(clipped)).toThrow('project worktree');
    const unreachable = proof(); unreachable.desktop.projectWorktrees!.layouts[0].fields[0].reachable = false; expect(() => verifyRuntimeProof(unreachable)).toThrow('project worktree');
    const missing = proof(); missing.desktop.projectWorktrees!.layouts[0].fields.pop(); expect(() => verifyRuntimeProof(missing)).toThrow('project worktree');
    const duplicate = proof(); duplicate.desktop.projectWorktrees!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('project worktree');
    const screenshot = proof(); screenshot.desktop.projectWorktrees!.screenshots[1] = screenshot.desktop.projectWorktrees!.screenshots[0]; expect(() => verifyRuntimeProof(screenshot)).toThrow('project worktree');
  });
});

describe('context summary release evidence', () => {
  it('rejects old complete desktop records that did not exercise context summaries', () => {
    const old = proof(); old.desktop.checks = 283; expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.contextSummaries; expect(() => verifyRuntimeProof(missing)).toThrow('context summary');
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('requires actual requests, source preservation, cancellation, quick-chat isolation and complete native layouts', () => {
    for (const [key, value] of Object.entries({ checks: 5, requestCount: 9, summaryRequests: 2, originalMessages: 5, finalMessages: 12, readonlyPreviewVerified: false, actualContextRequestsVerified: false, cancellationFailureVerified: false, expiredFullContextVerified: false, restartHistoryVerified: false, restrictedQuickChatVerified: false, layouts: [], screenshots: [] })) {
      const invalid = proof(); (invalid.desktop.contextSummaries as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('context summary');
    }
    const overflow = proof(); overflow.desktop.contextSummaries!.layouts[0].horizontalOverflow = true; expect(() => verifyRuntimeProof(overflow)).toThrow('context summary');
    const duplicate = proof(); duplicate.desktop.contextSummaries!.screenshots[1] = duplicate.desktop.contextSummaries!.screenshots[0]; expect(() => verifyRuntimeProof(duplicate)).toThrow('context summary');
  });
});

describe('tool activity release evidence', () => {
  it('rejects older suites and missing tool activity evidence', () => {
    const old = proof(); old.desktop.checks = 275; expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.toolActivities; expect(() => verifyRuntimeProof(missing)).toThrow('tool activity');
  });
  it('requires real phases, native request counts and every interaction guarantee', () => {
    for (const [key, value] of Object.entries({ checks: 7, commandRequests: 0, nativeStates: ['complete', 'error'], scopedClipboardPermission: false, exactOriginalCopy: false, staleClipboardGuard: false, deniedCopyRetry: false, focusBeforeInert: false, manualStreamingCollapse: false, restrictedQuickChat: false, reducedMotion: false, actualRestart: false })) {
      const invalid = proof(); (invalid.desktop.toolActivities as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('tool activity');
    }
    const duplicate = proof(); duplicate.desktop.toolActivities!.nativeStates = ['complete', 'complete', 'error', 'stopped', 'running']; expect(() => verifyRuntimeProof(duplicate)).toThrow('tool activity');
  });
  it('rejects lost labels, overflow, weakened motion/layout and duplicate zoom cases', () => {
    for (const [key, value] of Object.entries({ fontSize: '12px', parentFontSize: '13px', gap: '8px', padding: '0px', duration: '0.6s', contained: false, controlVisible: false, summaryWidth: 0, controlHeight: 19, outputScrollBounded: false, horizontalOverflow: true })) {
      const invalid = proof(); (invalid.desktop.toolActivities!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('tool activity');
    }
    const duplicate = proof(); duplicate.desktop.toolActivities!.layouts[1].zoom = 1; expect(() => verifyRuntimeProof(duplicate)).toThrow('tool activity');
  });
  it('requires all distinct native screenshot records and meaningful dimensions', () => {
    for (const captures of [[], Array(9).fill({ filename: 'tool-activities-copy.png', size: [760, 620] }), toolActivities().screenshots.map(row => ({ ...row, size: [0, 620] })), toolActivities().screenshots.map(row => ({ ...row, filename: row.filename.replace('tool-activities-', 'other-') }))]) {
      const invalid = proof(); invalid.desktop.toolActivities!.screenshots = captures; expect(() => verifyRuntimeProof(invalid)).toThrow('tool activity');
    }
  });
});
describe('project branch release evidence', () => {
  it('rejects prior suites and missing, incomplete or unsafe branch evidence', () => {
    const prior = proof(); prior.desktop.checks = 267; expect(() => verifyRuntimeProof(prior)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.projectBranches; expect(() => verifyRuntimeProof(missing)).toThrow('project branch');
    for (const [key, value] of Object.entries({ checks: 7, modelRequests: 1, localListSearchVerified: false, creationValidationBusyVerified: false, overwriteRetryVerified: false, editorRefreshDraftConflictVerified: false, worktreeProjectScopeVerified: false, hookStatePreviewCleanupVerified: false, referenceZoomKeyboardVerified: false, restartDraftsVerified: false, layouts: [], screenshots: Array(13).fill('project-branches-duplicate-shell.png') })) {
      const invalid = proof(); (invalid.desktop.projectBranches as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('project branch');
    }
  });
  it('rejects clipped controls, invalid field tokens, duplicate layouts and malformed captures', () => {
    for (const [key, value] of Object.entries({ overflow: true, fieldPadding: '0px', fieldGap: '8px', fieldBackground: 'rgb(0, 0, 0)', viewport: { width: 0, height: 0 }, dialog: { left: -1, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, controls: [], zoom: 1.25 })) {
      const invalid = proof(); (invalid.desktop.projectBranches!.layouts[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('project branch');
    }
    for (const [key, value] of Object.entries({ contentFits: false, visible: false, width: 0, height: 19 })) { const invalid = proof(); (invalid.desktop.projectBranches!.layouts[0].controls[0] as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('project branch'); }
    const capture = proof(); capture.desktop.projectBranches!.screenshots[0] = 'other.png'; expect(() => verifyRuntimeProof(capture)).toThrow('project branch');
  });
});

describe('private browser release evidence', () => {
  it('rejects old suites and incomplete multi-tab behavior, geometry or screenshots', () => {
    const prior = proof(); prior.desktop.checks = 262; expect(() => verifyRuntimeProof(prior)).toThrow('Complete desktop');
    const oldBrowser = proof(); oldBrowser.desktop.browser!.checks = 9; expect(() => verifyRuntimeProof(oldBrowser)).toThrow('private browser');
    const missing = proof(); delete missing.desktop.browser!.tabs; expect(() => verifyRuntimeProof(missing)).toThrow('browser tabs');
    for (const [key, value] of Object.entries({ checks: 4, independentHistoryDraftsVerified: false, sharedTransientSessionVerified: false, selectedViewOnlyVerified: false, backgroundFailureCloseVerified: false, nativeShortcutsVerified: false, lastCloseFreshVerified: false, workbenchReloadAllTabsVerified: false, layouts: [], screenshots: Array(16).fill('browser-tabs-duplicate.png') })) {
      const invalid = proof(); (invalid.desktop.browser!.tabs as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('browser tabs');
    }
    for (const change of [{ selectedVisible: false }, { addVisible: false }, { addWidth: 23 }, { addHeight: 23 }, { overflow: true }, { tabCount: 1 }, { panelLinked: false }, { expected: undefined }, { native: { x: 10, y: 20, width: 199, height: 150 } }, { theme: 'dark', zoom: 1.5 }]) {
      const invalid = proof(); Object.assign(invalid.desktop.browser!.tabs!.layouts[0], change); expect(() => verifyRuntimeProof(invalid)).toThrow('browser tabs');
    }
  });
  it('rejects a prior suite or browser navigation clipped outside its viewport', () => {
    const previous = proof(); previous.desktop.checks = 261; expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
    for (const [selectedVisible, current] of [[false, 'page'], [true, '']] as const) {
      const invalid = proof(); invalid.desktop.browser!.layouts[0].navigation = { selectedVisible, current };
      expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
  });
  it('rejects the previous suite and missing browser behavior or isolation proof', () => {
    const previous = proof(); previous.desktop.checks = 252; expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
    const missing = proof(); delete missing.desktop.browser; expect(() => verifyRuntimeProof(missing)).toThrow('private browser');
    for (const [key, value] of Object.entries({ checks: 8, modelRequests: 1, nativeHistoryVerified: false, pendingAddressStopVerified: false, sameUrlRedirectVerified: false, unsubmittedAddressRetained: false, popupPrivateNavigationDenied: false, failureRetryVerified: false, keyboardFocusVerified: false, draftRetained: false, modalOcclusionVerified: false, privateRestartVerified: false, workbenchReloadVerified: false, staleOwnerCloseVerified: false })) {
      const invalid = proof(); (invalid.desktop.browser as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
    for (const [key, value] of Object.entries({ sandbox: false, contextIsolation: false, privateSession: false, nodeIntegration: true, preload: true })) {
      const invalid = proof(); (invalid.desktop.browser!.isolation as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
  });
  it('requires every unique theme/zoom case, exact native bounds and original screenshot names', () => {
    for (const layouts of [[], proof().desktop.browser!.layouts.slice(1), Array(6).fill(proof().desktop.browser!.layouts[0])]) {
      const invalid = proof(); invalid.desktop.browser!.layouts = layouts; expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
    for (const change of [{ width: 199 }, { height: 149 }, { x: 11 }, { y: 21 }]) {
      const invalid = proof(); Object.assign(invalid.desktop.browser!.layouts[0].native, change); expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
    const geometry = proof(); delete (geometry.desktop.browser!.layouts[0] as unknown as Record<string, unknown>).expected; expect(() => verifyRuntimeProof(geometry)).toThrow('private browser');
    for (const screenshots of [[], Array(15).fill('browser-duplicate.png'), Array.from({ length: 15 }, (_, i) => `unrelated-${i}.png`)]) {
      const invalid = proof(); invalid.desktop.browser!.screenshots = screenshots; expect(() => verifyRuntimeProof(invalid)).toThrow('private browser');
    }
  });
});

describe('PDF release evidence', () => {
  it('requires independent quick-chat boundaries, original identity, request counts and every minimum-window theme/zoom pair', () => {
    const missing = proof(); delete missing.desktop.quickChat; expect(() => verifyRuntimeProof(missing)).toThrow('quick-chat');
    for (const [key, value] of Object.entries({ checks: 8, quickModelRequests: 4, mainFixtureRequests: 0, originalSha256: '', layout: [], independentDraftsVerified: false, restrictedBridgeVerified: false, exactOriginalVerified: false, textOnlyTransportVerified: false, stopOwnerVerified: false, approvalScopeVerified: false, handoffVerified: false, windowStateVerified: false, shortcutTargetVerified: false, filesystemRetryVerified: false, backupRestartVerified: false, staleRevisionVerified: false })) {
      const invalid = proof(); (invalid.desktop.quickChat as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    for (const change of [{ zoom: 1.25 }, { theme: 'light' }, { controlsVisible: false }, { overflow: true }]) {
      const invalid = proof(); invalid.desktop.quickChat!.layout[5] = { ...invalid.desktop.quickChat!.layout[5], ...change }; expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    const previous = proof(); previous.desktop.checks = 243; previous.installer.checks = 243; previous.branches.suiteChecks = 243; previous.temporary.suiteChecks = 243; previous.comparisons.suiteChecks = 243;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects missing, clipped, wrong-size or duplicated minimum-height quick-chat states', () => {
    for (const layout of [undefined, [], minimumLayout().slice(1), minimumLayout().slice(0, 6), Array(18).fill(minimumLayout()[0])]) {
      const invalid = proof(); (invalid.desktop.quickChat as unknown as Record<string, unknown>).minimumLayout = layout;
      expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    for (const change of [{ state: 'empty' }, { theme: 'light' }, { zoom: 1.25 }, { nativeSize: [420, 580] }, { nativeSize: [640, 360] }, { nativeSize: [420, 360, 1] }, { controlsVisible: false }, { overflow: true }, { toolsKeyboardVerified: false }]) {
      const invalid = proof(); invalid.desktop.quickChat!.minimumLayout[17] = { ...invalid.desktop.quickChat!.minimumLayout[17], ...change };
      expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    for (const key of ['refreshRaceVerified', 'minimumErrorVerified']) {
      const invalid = proof(); (invalid.desktop.quickChat as unknown as Record<string, unknown>)[key] = false;
      expect(() => verifyRuntimeProof(invalid)).toThrow('quick-chat');
    }
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
  });
  it('requires complete MCP PDF evidence, exact request count and both themes at every zoom', () => {
    const missing = proof(); delete missing.desktop.mcpPdf; expect(() => verifyRuntimeProof(missing)).toThrow('MCP PDF');
    for (const [key, value] of [['checks', 7], ['explicitModelRequests', 0], ['explicitModelRequests', 2], ['previewPersisted', true], ['originalSha256', 'invalid'], ['layout', []], ['layout', Array(6).fill(null)]] as const) {
      const invalid = proof(); (invalid.desktop.mcpPdf as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
    }
    for (const key of ['exactOriginalVerified', 'promptPdfVerified', 'textOnlyModelTransportVerified', 'staleSubscriptionVerified', 'filesystemRetryVerified', 'restartVerified', 'backupRestoreVerified', 'restoreCompletionVerified']) {
      for (const value of [false, undefined, 'true']) {
        const invalid = proof(); (invalid.desktop.mcpPdf as unknown as Record<string, unknown>)[key] = value; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
      }
    }
    for (const change of [{ theme: 'light' }, { zoom: 2 }, { controlsVisible: false }, { overflow: true }]) {
      const invalid = proof(); invalid.desktop.mcpPdf!.layout[5] = { ...invalid.desktop.mcpPdf!.layout[5], ...change }; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP PDF');
    }
  });
  it('rejects missing, partial and non-boolean viewer evidence', () => {
    const missing = proof(); delete missing.desktop.pdfPreview;
    expect(() => verifyRuntimeProof(missing)).toThrow('PDF preview');
    const count = proof(); count.desktop.pdfPreview!.checks = 5;
    expect(() => verifyRuntimeProof(count)).toThrow('PDF preview');
    for (const key of ['canvasTextVerified', 'outlineTargetsVerified', 'fullDocumentSearchVerified', 'linksNotesZoomVerified', 'exportOwnershipRestartVerified']) {
      for (const value of [false, undefined, 'true']) {
        const incomplete = proof(); (incomplete.desktop.pdfPreview as unknown as Record<string, unknown>)[key] = value;
        expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF preview');
      }
    }
  });
  it('requires every unique HTTP protocol and exact-byte backup/restart checks', () => {
    const missing = proof(); delete missing.desktop.attachments;
    expect(() => verifyRuntimeProof(missing)).toThrow('PDF original');
    for (const protocols of [[], ['responses'], Array(8).fill('responses'), [...proof().desktop.attachments!.pdfOriginal!.textOnlyProtocols, 'unknown']]) {
      const incomplete = proof(); incomplete.desktop.attachments!.pdfOriginal!.textOnlyProtocols = protocols;
      expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF original');
    }
    for (const key of ['restartBytesVerified', 'deduplicatedBackupVerified', 'missingFileRestoredVerified']) {
      for (const value of [false, undefined, 'true']) {
        const incomplete = proof(); (incomplete.desktop.attachments!.pdfOriginal as unknown as Record<string, unknown>)[key] = value;
        expect(() => verifyRuntimeProof(incomplete)).toThrow('PDF original');
      }
    }
  });
  it('rejects a previous suite count even when its other evidence is populated', () => {
    const old = proof(); old.desktop.checks = 223; old.installer.checks = 223;
    old.branches.suiteChecks = 223; old.temporary.suiteChecks = 223; old.comparisons.suiteChecks = 223;
    expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
  });
});

describe('release version and notes', () => {
  it('distinguishes exact stable and prerelease versions', () => {
    expect(releaseVersion('v1.2.3', '1.2.3')).toEqual({ tag: 'v1.2.3', version: '1.2.3', prerelease: false });
    expect(releaseVersion('v0.1.0-alpha.1', '0.1.0-alpha.1').prerelease).toBe(true);
  });
  it.each([['1.2.3', '1.2.3'], ['v2.0.0', '1.2.3'], ['v01.2.3', '01.2.3'], ['v1.2.3\n', '1.2.3\n'], ['v1.2.3-alpha.01', '1.2.3-alpha.01'], ['v1.2.3;echo', '1.2.3;echo'], ['v1.2.3/../x', '1.2.3/../x'], ['v1.2.3+build', '1.2.3+build'], ['', ''], [undefined, '1.2.3']])('rejects unmatched or unsafe tag %j for version %j', (tag, version) => {
    expect(() => releaseVersion(tag as string, version as string)).toThrow('exactly match');
  });
  it.each(['\n', '\r\n'])('extracts only the exact bilingual release with %j newlines', (newline) => {
    const changelog = `# Changes${newline}${notes('1.2.3', newline)}${newline}## [1.2.2]${newline}OLD_NOTES`;
    const result = releaseNotes(changelog, '1.2.3');
    expect(result.startsWith('### 新功能')).toBe(true);
    expect(result).toContain('### English');
    expect(result).not.toMatch(/OLD_NOTES|\r|## \[1/);
    expect(releaseNotes(notes(), '1.2.3')).toBe(result);
  });
  it('rejects absent and duplicate version sections', () => {
    for (const content of ['## [1.2.2]\nOld notes', `${notes()}\n${notes()}`]) expect(() => releaseNotes(content, '1.2.3')).toThrow('one exact');
  });
  it('requires populated Chinese installation/change/fix sections and English summary', () => {
    for (const heading of ['新功能', '变更与安全', '修复与完善', '安装', 'English']) {
      expect(() => releaseNotes(notes().replace(`### ${heading}`, '### Other'), '1.2.3')).toThrow('Chinese');
      const content = notes().replace(new RegExp(`(### ${heading}\\n)[^\\n]+`), '$1TODO');
      expect(() => releaseNotes(content, '1.2.3')).toThrow('incomplete');
    }
  });
});

describe('Windows release execution evidence', () => {
  it('rejects retained installed or portable results for a different audited wrapper even when their application body is identical', () => {
    const installed = proof(); installed.installer.installerSha256 = otherHash;
    const portable = proof(); portable.bootstrap.variants.find((variant) => variant.variant === 'portable')!.executableSha256 = otherHash;
    for (const value of [installed, portable]) expect(() => verifyRuntimeProof(value)).toThrow('bootstraps');
  });
  it('requires valid hashes for the installer and each actual bootstrap executable', () => {
    for (const value of ['', 'unavailable', hash.toUpperCase(), undefined]) {
      const installed = proof(); installed.installer.installerSha256 = value as string;
      expect(() => verifyRuntimeProof(installed)).toThrow('SHA-256');
      for (const name of ['installer', 'uninstaller', 'portable']) {
        const bootstrap = proof(); bootstrap.bootstrap.variants.find((variant) => variant.variant === name)!.executableSha256 = value as string;
        expect(() => verifyRuntimeProof(bootstrap)).toThrow('SHA-256');
      }
    }
  });
  it('accepts matching complete runtime and actual distribution evidence', () => {
    expect(() => verifyRuntimeProof(proof())).not.toThrow();
    const future = proof(); const nextChecks = future.desktop.checks + 1; future.desktop.checks = nextChecks; future.installer.checks = nextChecks; future.branches.suiteChecks = nextChecks; future.temporary.suiteChecks = nextChecks; future.comparisons.suiteChecks = nextChecks;
    expect(() => verifyRuntimeProof(future)).not.toThrow();
  });
  it('rejects missing or malformed executable/archive/wrapper hashes', () => {
    const first = proof(); first.audit.executableSha256 = '';
    const second = proof(); second.audit.archiveSha256 = 'unavailable';
    const third = proof(); third.portable.wrapperSha256 = hash.toUpperCase();
    for (const value of [first, second, third]) expect(() => verifyRuntimeProof(value)).toThrow('SHA-256');
  });
  it('rejects unresolved fonts, old identity, distribution rights and stale compiled assets', () => {
    const cases = [proof(), proof(), proof(), proof(), proof()];
    cases[0].audit.unresolvedAssets = ['Font']; cases[1].audit.oldProductIdentityMatches = ['Old product'];
    cases[2].audit.unresolvedDistribution = ['Plugin']; cases[3].audit.compiledAssetsMatchVerifiedBuild = false;
    cases[4].audit.removedUiFontReferencesVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('unresolved');
  });
  it('rejects source/forced-close/error or mismatched packaged execution', () => {
    for (const key of ['desktop', 'surfaces', 'preview', 'branches', 'temporary', 'comparisons'] as const) {
      const cases = [proof(), proof(), proof(), proof(), proof()];
      cases[0][key].variant = 'development executable'; cases[1][key].normalCloseVerified = false;
      cases[2][key].runtimeErrors = ['Failure']; cases[3][key].executableSha256 = otherHash; cases[4][key].archiveSha256 = hash;
      for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('normal close');
    }
  });
  it('rejects missing, partial or network-accessing project preview evidence', () => {
    const absent = proof(); delete (absent as Partial<ReleaseProof>).preview; expect(() => verifyRuntimeProof(absent)).toThrow('normal close');
    const cases = [proof(), proof(), proof()]; cases[0].preview.checks = 4; cases[1].preview.outsideHttpRequests = 1;
    delete (cases[2].preview as Partial<ReleaseProof['preview']>).outsideHttpRequests;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('project-preview');
  });
  it('rejects old floating-only and incomplete docked lifecycle evidence in focused and complete suites', () => {
    for (const surface of ['preview', 'desktop'] as const) {
      for (const defect of ['old', 'missing', 'partial', 'transfer', 'removal', 'reload', 'stale'] as const) {
        const value = proof(), result = surface === 'preview' ? value.preview : value.desktop.projectPreview!;
        if (defect === 'old') result.checks = 5;
        if (defect === 'missing') delete result.docked;
        if (defect === 'partial') result.docked!.checks = 3;
        if (defect === 'transfer') result.docked!.floatingTransferVerified = false;
        if (defect === 'removal') delete result.docked!.projectRemovalVerified;
        if (defect === 'reload') delete result.docked!.workbenchReloadVerified;
        if (defect === 'stale') result.docked!.staleOwnerCloseVerified = false;
        expect(() => verifyRuntimeProof(value)).toThrow('project-preview');
      }
    }
  });
  it('requires file tab keyboard, close/retry, original drafts and exact theme/zoom/action evidence in both suites', () => {
    for (const surface of ['preview', 'desktop'] as const) {
      const mutate = (update: (result: NonNullable<ReleaseProof['preview']['editorTabs']>) => void) => {
        const value = proof(), result = surface === 'preview' ? value.preview : value.desktop.projectPreview!; update(result.editorTabs!); expect(() => verifyRuntimeProof(value)).toThrow('project-preview');
      };
      for (const key of ['selectedVisibilityVerified', 'keyboardNavigationVerified', 'dirtyCancelVerified', 'cleanCloseFocusVerified', 'saveFailureRetryVerified', 'originalDraftsRetained'] as const) mutate(result => { result[key] = false; });
      mutate(result => { result.layouts = []; }); mutate(result => { result.layouts[0] = result.layouts[1]; });
      mutate(result => { result.layouts[0].selectedVisible = false; }); mutate(result => { result.layouts[0].overflow = true; });
      mutate(result => { result.layouts[0].actions[0].width = 23; }); mutate(result => { result.layouts[0].actions[0].height = 25; }); mutate(result => { result.layouts[0].actions[0].visible = false; }); mutate(result => { result.layouts[0].actions[0].name = 'wrong'; });
      mutate(result => { result.screenshots.pop(); }); mutate(result => { result.screenshots[0] = result.screenshots[1]; });
      const old = proof(), result = surface === 'preview' ? old.preview : old.desktop.projectPreview!; delete result.editorTabs; expect(() => verifyRuntimeProof(old)).toThrow('project-preview');
    }
  });
  it('rejects incomplete desktop/settings/portable checks and different portable body', () => {
    const cases = Array.from({ length: 11 }, proof);
    cases[0].desktop.checks = 199; cases[1].desktop.checks = Number.NaN; cases[2].surfaces.checks = 3;
    cases[3].portable.checks = 6; cases[4].portable.launches = [{}]; cases[5].portable.runtimeErrors = ['Failure'];
    cases[6].portable.childExecutableSha256 = otherHash; cases[7].portableAudit.executableSha256 = otherHash;
    cases[8].portableAudit.archiveSha256 = hash; cases[9].portableAudit.unresolvedAssets = ['Font']; cases[10].portableAudit.unresolvedDistribution = ['Plugin'];
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('portable verification');
  });
  it('requires memory and offline preview checks within the complete desktop suite', () => {
    const missing = proof(); delete missing.desktop.memories; expect(() => verifyRuntimeProof(missing)).toThrow('memory verification');
    for (const count of [0, 2, 4, Number.NaN]) {
      const partial = proof(); partial.desktop.memories!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('memory verification');
    }
    const absent = proof(); delete absent.desktop.projectPreview; expect(() => verifyRuntimeProof(absent)).toThrow('desktop must include');
    for (const count of [0, 4, 6, Number.NaN]) {
      const partial = proof(); partial.desktop.projectPreview!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('desktop must include');
    }
    for (const count of [1, -1, Number.NaN, undefined]) {
      const outside = proof(); outside.desktop.projectPreview!.outsideHttpRequests = count as number; expect(() => verifyRuntimeProof(outside)).toThrow('desktop must include');
    }
  });
  it('rejects old 215/218-check complete suites even when every matching-body count agrees', () => {
    for (const count of [215, 218]) {
      const old = proof(); old.desktop.checks = count; old.installer.checks = count;
      old.branches.suiteChecks = count; old.temporary.suiteChecks = count; old.comparisons.suiteChecks = count;
      expect(() => verifyRuntimeProof(old)).toThrow('Complete desktop');
    }
  });
  it('rejects missing, focused, incomplete, stale or requesting branch-navigation evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).branches;
    expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = [proof(), proof(), proof(), proof(), proof()];
    cases[0].branches.checks = 5; cases[1].branches.verificationRun = 'focused branch-navigation suite';
    cases[2].branches.suiteChecks = 178; cases[3].branches.modelRequests = 1; cases[4].branches.ambiguousHistoryRecoveryVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('branch-navigation verification');
  });
  it('rejects missing or failed manual order, write-recovery and ordered-backup/restart evidence', () => {
    for (const key of ['manualOrderingVerified', 'orderingFailureRecoveryVerified', 'orderingBackupRestartVerified'] as const) {
      const failed = proof(); failed.branches[key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('branch-navigation verification');
      const absent = proof(); delete (absent.branches as Partial<ReleaseProof['branches']>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('branch-navigation verification');
    }
  });
  it('rejects missing, focused, stale or incomplete temporary-chat privacy and restart evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).temporary;
    expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = Array.from({ length: 9 }, proof);
    cases[0].temporary.checks = 5; cases[1].temporary.verificationRun = 'focused temporary-conversation suite';
    cases[2].temporary.suiteChecks = 184; cases[3].temporary.temporaryModelRequests = 2;
    cases[4].temporary.persistenceExcludedVerified = false; cases[5].temporary.backupsExcludedVerified = false;
    cases[6].temporary.restartClearedVerified = false; cases[7].temporary.storageModeImmutableVerified = false; cases[8].temporary.regularDraftsRetainedVerified = false;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('temporary-chat');
  });
  it('rejects missing, focused, stale, partial or unverified parallel comparison evidence', () => {
    const missing = proof(); delete (missing as Partial<ReleaseProof>).comparisons; expect(() => verifyRuntimeProof(missing)).toThrow('normal close');
    const cases = Array.from({ length: 4 }, proof); cases[0].comparisons.checks = 5; cases[1].comparisons.verificationRun = 'focused model-comparison suite'; cases[2].comparisons.suiteChecks = 199; cases[3].comparisons.comparisonModelRequests = 10;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('parallel model-comparison');
    for (const key of ['parallelStreamsVerified', 'independentFailureStopVerified', 'atomicSaveRetryVerified', 'backupsRestartVerified', 'temporaryExclusionVerified', 'originalDraftRetainedVerified', 'originalModelIdentityVerified'] as const) {
      const failed = proof(); failed.comparisons[key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('parallel model-comparison');
      const absent = proof(); delete (absent.comparisons as Partial<ReleaseProof['comparisons']>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('parallel model-comparison');
      const invalid = proof(); (invalid.comparisons as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('parallel model-comparison');
    }
  });
  it('requires complete native MCP subscription evidence without accepting absent, partial or string-valued claims', () => {
    const missing = proof(); delete missing.desktop.mcpResourceSubscriptions; expect(() => verifyRuntimeProof(missing)).toThrow('MCP resource-subscription');
    const partial = proof(); partial.desktop.mcpResourceSubscriptions!.checks = 5; expect(() => verifyRuntimeProof(partial)).toThrow('MCP resource-subscription');
    const requesting = proof(); requesting.desktop.mcpResourceSubscriptions!.modelRequests = 1; expect(() => verifyRuntimeProof(requesting)).toThrow('MCP resource-subscription');
    for (const key of ['realNotificationsVerified', 'explicitDraftInsertionVerified', 'delayedUnsubscribeFiltered', 'templateSelectionVerified', 'disconnectRestartVerified', 'unsupportedServerVerified', 'zoomKeyboardVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.mcpResourceSubscriptions![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('MCP resource-subscription');
      const absent = proof(); delete (absent.desktop.mcpResourceSubscriptions as Partial<NonNullable<ReleaseProof['desktop']['mcpResourceSubscriptions']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('MCP resource-subscription');
      const invalid = proof(); (invalid.desktop.mcpResourceSubscriptions as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP resource-subscription');
    }
  });
  it('requires complete native binary-file evidence and rejects absent, partial, model-sending or non-boolean claims', () => {
    const missing = proof(); delete missing.desktop.mcpBinaryFiles; expect(() => verifyRuntimeProof(missing)).toThrow('MCP binary-file');
    const partial = proof(); partial.desktop.mcpBinaryFiles!.checks = 5; expect(() => verifyRuntimeProof(partial)).toThrow('MCP binary-file');
    const sending = proof(); sending.desktop.mcpBinaryFiles!.binaryModelRequests = 1; expect(() => verifyRuntimeProof(sending)).toThrow('MCP binary-file');
    for (const key of ['realWorkerPreviewVerified', 'exactOriginalExportVerified', 'emptyAndUnsupportedExportVerified', 'promptBinaryTextOnlyVerified', 'staleSelectionVerified', 'zoomKeyboardVerified', 'restartDraftRetainedVerified'] as const) {
      const failed = proof(); failed.desktop.mcpBinaryFiles![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('MCP binary-file');
      const absent = proof(); delete (absent.desktop.mcpBinaryFiles as Partial<NonNullable<ReleaseProof['desktop']['mcpBinaryFiles']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('MCP binary-file');
      const invalid = proof(); (invalid.desktop.mcpBinaryFiles as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('MCP binary-file');
    }
    const previous = proof(); previous.desktop.checks = 200; expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects the previous complete 206-check body even with matching installation and suite counts', () => {
    const previous = proof(); previous.desktop.checks = 206; previous.installer.checks = 206;
    previous.branches.suiteChecks = 206; previous.temporary.suiteChecks = 206; previous.comparisons.suiteChecks = 206;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects absent, partial, excessive, requesting or incomplete assistant-recipe evidence', () => {
    const missing = proof(); delete missing.desktop.assistantRecipes; expect(() => verifyRuntimeProof(missing)).toThrow('assistant-recipe');
    for (const count of [3, 5, Number.NaN]) {
      const partial = proof(); partial.desktop.assistantRecipes!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('assistant-recipe');
    }
    for (const count of [1, -1, Number.NaN, undefined]) {
      const sending = proof(); (sending.desktop.assistantRecipes as unknown as Record<string, unknown>).recipeModelRequests = count; expect(() => verifyRuntimeProof(sending)).toThrow('assistant-recipe');
    }
  });
  it('requires exact boolean proof for recipe binding, parameters, removal recovery, zoom, backup and the retained draft', () => {
    for (const key of ['assistantBindingVerified', 'defaultOptionalChoicesVerified', 'deletedAssistantRecoveryVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.assistantRecipes![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('assistant-recipe');
      const absent = proof(); delete (absent.desktop.assistantRecipes as Partial<NonNullable<ReleaseProof['desktop']['assistantRecipes']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('assistant-recipe');
      const invalid = proof(); (invalid.desktop.assistantRecipes as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('assistant-recipe');
    }
  });
  it('rejects the previous 210-check application even with matching complete suite and installation counts', () => {
    const previous = proof(); previous.desktop.checks = 210; previous.installer.checks = 210;
    previous.branches.suiteChecks = 210; previous.temporary.suiteChecks = 210; previous.comparisons.suiteChecks = 210;
    expect(() => verifyRuntimeProof(previous)).toThrow('Complete desktop');
  });
  it('rejects missing, partial, excessive and requesting prompt-transfer proof', () => {
    const missing = proof(); delete missing.desktop.promptTransfer; expect(() => verifyRuntimeProof(missing)).toThrow('prompt-transfer');
    for (const count of [0, 4, 6, Number.NaN]) { const partial = proof(); partial.desktop.promptTransfer!.checks = count; expect(() => verifyRuntimeProof(partial)).toThrow('prompt-transfer'); }
    for (const count of [1, -1, Number.NaN, '0']) { const requesting = proof(); (requesting.desktop.promptTransfer as unknown as Record<string, unknown>).transferModelRequests = count; expect(() => verifyRuntimeProof(requesting)).toThrow('prompt-transfer'); }
  });
  it('requires exact booleans for prompt export, preview/cancel, atomic retry, fresh shared bindings, zoom, backup and draft retention', () => {
    for (const key of ['exportModesVerified', 'inertPreviewCancelVerified', 'atomicImportRetryVerified', 'sharedFreshAssociationsVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'] as const) {
      const failed = proof(); failed.desktop.promptTransfer![key] = false; expect(() => verifyRuntimeProof(failed)).toThrow('prompt-transfer');
      const absent = proof(); delete (absent.desktop.promptTransfer as Partial<NonNullable<ReleaseProof['desktop']['promptTransfer']>>)[key]; expect(() => verifyRuntimeProof(absent)).toThrow('prompt-transfer');
      const invalid = proof(); (invalid.desktop.promptTransfer as unknown as Record<string, unknown>)[key] = 'true'; expect(() => verifyRuntimeProof(invalid)).toThrow('prompt-transfer');
    }
  });
  it('rejects absent cleanup proof and untested or incomplete long-path launches', () => {
    const cases = [proof(), proof(), proof(), proof(), proof(), proof()];
    cases[0].portable.longPathCleanupVerified = false; cases[1].portable.launches[0] = {};
    cases[2].portable.launches[1].longDocumentPathLength = 260; cases[3].portable.launches[1].longDocumentPathLength = 301.5;
    cases[4].portable.unpackedFilesVerified = 0; cases[5].portable.unpackedFilesVerified = Number.NaN;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('long-path cleanup');
  });
  it('requires all three bootstrap variants with licensed original inputs', () => {
    const cases = [proof(), proof(), proof(), proof()];
    cases[0].bootstrap.variants.pop(); cases[1].bootstrap.variants[2].variant = 'installer';
    cases[2].bootstrap.variants[1].plugins = []; cases[3].bootstrap.variants[2].plugins[0].redistributionStatus = 'unresolved';
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('original plugin');
  });
  it('rejects incomplete installation, uninstall, data retention or mismatched installed body', () => {
    for (const key of ['normalCloseVerified', 'registrationVerified', 'shortcutsVerified', 'uninstalled', 'userDataRetained'] as const) {
      const value = proof(); value.installer[key] = false;
      expect(() => verifyRuntimeProof(value)).toThrow('uninstall proof');
    }
    const cases = [proof(), proof(), proof()]; cases[0].installer.checks = 172;
    cases[1].installer.executableSha256 = otherHash; cases[2].installer.archiveSha256 = hash;
    for (const value of cases) expect(() => verifyRuntimeProof(value)).toThrow('uninstall proof');
  });
});

const proofDirectories: string[] = [];
afterEach(async () => { await Promise.all(proofDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function proofFiles() {
  const root = await mkdtemp(join(tmpdir(), 'qiyao-runtime-proof-')); proofDirectories.push(root); await mkdir(join(root, 'verification'));
  const value = proof(); await Promise.all(Object.entries(runtimeProofFiles).map(([key, name]) => writeFile(join(root, 'verification', name), JSON.stringify(value[key as keyof ReleaseProof]))));
  return { root, value };
}
describe('complete runtime proof file loader', () => {
  it('loads all eleven independent records and passes their matching-body policy without changing their data', async () => {
    const { root, value } = await proofFiles(); const actual = await readRuntimeProof(root); expect(Object.keys(actual)).toHaveLength(11); expect(actual).toEqual(value); expect(() => verifyRuntimeProof(actual)).not.toThrow();
  });
  it('rejects missing required comparison evidence without exposing its filesystem location', async () => {
    const { root } = await proofFiles(); await rm(join(root, 'verification', runtimeProofFiles.comparisons)); const error = await readRuntimeProof(root).catch((error) => error);
    expect(error.message).toContain('comparisons'); expect(error.message).not.toContain(root);
  });
  it('rejects malformed JSON, null, arrays and primitive records without exposing their contents', async () => {
    const { root } = await proofFiles(); for (const content of ['PRIVATE_INVALID_JSON', 'null', '[]', '"PRIVATE_RECORD_CONTENT"']) { await writeFile(join(root, 'verification', runtimeProofFiles.audit), content); const error = await readRuntimeProof(root).catch((error) => error); expect(error.message).toContain('proof (audit)'); expect(error.message).not.toMatch(/PRIVATE|qiyao-runtime-proof-/); }
  });
});
