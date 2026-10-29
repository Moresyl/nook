export function releaseVersion(tag: string, version: string): { tag: string; version: string; prerelease: boolean };
export function releaseNotes(changelog: string, version: string): string;
export type ImageExportProof = {
  cancelPreservedDestination: boolean; failureRetried: boolean; exactJpegBytes: boolean;
  delayedImageIsolation: boolean; draftUnchanged: boolean; quickChatVerified: boolean; sha256: string;
  layouts: { theme: string; actualTheme: string; zoom: number; contained: boolean; pageContained: boolean; failureRetried: boolean; exactJpegBytes: boolean; screenshot: string }[];
  quickLayouts: (ImageExportProof['layouts'][number] & { imageVisible: boolean; imageAreaHeight: number; warningKeyboard: boolean })[];
};
export function verifyImageExportProof(proof: ImageExportProof | undefined): void;
type ProjectFileMenuBounds = { zoom: number; left: number; right: number; top: number; bottom: number; width: number; height: number; chrome: number };
export type NavigationReleaseProof = {
  checks: number;
  chatNavigation?: {
    checks: number;
    sidebarNavigation?: Record<'paginationFocus' | 'currentChatBeyondFirstBatch' | 'originalDraftRetained' | 'keyboardCollapse' | 'collapseSurvivesNormalRestart' | 'searchRevealsCollapsedSection', boolean> & {
      fixtures: number;
      automaticPagination?: {
        batches: number; pageSize: number; composerFocusRetained: boolean; draftRetained: boolean; activeChatRetained: boolean;
        layouts: { theme: string; zoom: number; rows: number; screenshot: string }[];
      };
    };
  };
  projectTree?: {
    checks: number;
    virtualizedRows?: { boundedMountedCount: boolean; allLoadedRowsReachableByScroll: boolean; completeSiblingMetadata: boolean; rootLoadedCounts: number[] };
    stickyFolders?: Record<'ancestorStack' | 'subtreePushOff' | 'pointerCollapse' | 'keyboardCanonicalFocus' | 'noDuplicateTreeItems' | 'pagination' | 'refreshAndSearch', boolean> & {
      virtualizedLargeDirectory?: { files: number; pages: number; mountedRows: number; keyboardLastAndFirst: boolean; completeSiblingMetadata: boolean; collapseRetainedFocus: boolean };
      fileMenu?: Record<'pointerAndKeyboard' | 'rovingFocus' | 'compositionEscape' | 'outsideAndScrollDismissal' | 'unchangedResizeRetainsMenu' | 'changedResizeDismissesMenu' | 'openAndDirectoryToggle' | 'newFileParent' | 'copyFailureRetry' | 'lateCopyIsolation' | 'absolutePathCopy' | 'absolutePathFailureRetry' | 'latePathIsolation' | 'revealDispatch' | 'revealFailureRetry' | 'invalidPathRejected', boolean> & {
        themes: string[]; geometry: ProjectFileMenuBounds[];
        entryActionLayouts: (ProjectFileMenuBounds & { theme: string; actualTheme: string; errorContained: boolean; absolutePathCopied: boolean; revealRetried: boolean; screenshot: string })[];
        fileContents: Record<'exactUtf8BomAndCrlf' | 'emptyFile' | 'binaryInvalidUtf8OversizeAndMissingRejected' | 'readFailureRetry' | 'clipboardFailureRetry' | 'lateReadIsolation' | 'noEditorOpened' | 'directoriesExcluded', boolean> & {
          maximumSize: number;
          layouts: (ProjectFileMenuBounds & { theme: string; actualTheme: string; errorContained: boolean; keyboardErrorVisible: boolean; clipboardFailureRetried: boolean; screenshot: string })[];
        };
      };
    };
  };
};
export function verifyNavigationProof(proof: NavigationReleaseProof | undefined): void;
export type ComposerActionsProof = {
  checks: number; modelRequests: number; queryKeyboardVerified: boolean; templateCancellationVerified: boolean;
  caretInsertionVerified: boolean; scopeSelectionVerified: boolean; sixThemeZoomLayoutsVerified: boolean; quickChatVerified: boolean; fixtureCleanupVerified: boolean;
  screenshots: string[];
  captures: { filename: string; width: number; height: number; nativeSize: number[]; query: string; selectedLabel: string | null; optionCount: number }[];
  layouts: { theme: string; zoom: number; left: number; right: number; top: number; bottom: number; chromeBottom: number; viewportWidth: number; viewportHeight: number; width: number; scrollWidth: number; activeTop: number; activeBottom: number; clipTop: number; clipBottom: number; opacity: string; fontSize: string; minHeight: string; background: string; focused: boolean }[];
};
export function verifyComposerActionsProof(proof: ComposerActionsProof | undefined): void;
export type TaskPlanProof = {
  checks: number; actualReadOnlyTool: boolean; rawToolRecordsPreserved: boolean; projectFilesUnchanged: boolean; noPlanDocument: boolean;
  invalidUpdateRetainsPlan: boolean; stoppedStateAccurate: boolean; plainTextRendering: boolean; actualRestart: boolean; noModelReplay: boolean;
  screenshots: string[]; nativeCaptureSizes: { filename: string; size: number[] }[];
  layouts: { theme: string; size: number[]; zoom: number; contained: boolean; headerVisible: boolean; horizontalOverflow: boolean; padding: string; border: string; count: number;
    rows: { top: number; bottom: number; readableTop: number; readableBottom: number; contained: boolean }[] }[];
};
export function verifyTaskPlanProof(proof: TaskPlanProof | undefined): void;
export type QuickChatProof = { refreshRaceVerified: boolean; minimumErrorVerified: boolean; checks: number; quickModelRequests: number; mainFixtureRequests: number; originalSha256: string; layout: { theme: string; zoom: number; controlsVisible: boolean; overflow: boolean }[]; minimumLayout: { state: string; theme: string; zoom: number; nativeSize: number[]; controlsVisible: boolean; overflow: boolean; toolsKeyboardVerified: boolean }[]; independentDraftsVerified: boolean; restrictedBridgeVerified: boolean; exactOriginalVerified: boolean; textOnlyTransportVerified: boolean; stopOwnerVerified: boolean; approvalScopeVerified: boolean; handoffVerified: boolean; windowStateVerified: boolean; shortcutTargetVerified: boolean; filesystemRetryVerified: boolean; backupRestartVerified: boolean; staleRevisionVerified: boolean };
export type EditorTabFocusProof = { kind: 'tab' | 'close'; focused: boolean; focusVisible: boolean; outlineStyle: string; outlineColor: string; outlineWidth: number; outlineOffset: number; ring: { left: number; right: number; top: number; bottom: number }; viewport: { left: number; right: number; top: number; bottom: number } };
export type EditorTabsProof = { selectedVisibilityVerified: boolean; keyboardNavigationVerified: boolean; focusOutlinesVerified: boolean; dirtyCancelVerified: boolean; cleanCloseFocusVerified: boolean; saveFailureRetryVerified: boolean; originalDraftsRetained: boolean; screenshots: string[]; layouts: { theme: string; zoom: number; selectedVisible: boolean; overflow: boolean; compact: boolean; actions: { name: string; visible: boolean; width: number; height: number }[]; focus: EditorTabFocusProof[] }[] };
export type ProjectPreviewProof = { checks: number; outsideHttpRequests: number; editorTabs?: EditorTabsProof; docked?: { checks: number; floatingTransferVerified?: boolean; projectRemovalVerified?: boolean; workbenchReloadVerified?: boolean; staleOwnerCloseVerified?: boolean } };
export type BrowserFailureProof = { checks: number; connectionRefusedVerified: boolean; offlineVerified: boolean; certificateVerified: boolean; timeoutVerified: boolean; pendingDraftRetained: boolean; retryDraftRetained: boolean; detailsKeyboardVerified: boolean; sanitizedHostVerified: boolean; blankRecoveryVerified: boolean; layouts: { theme: string; zoom: number; summaryVisible: boolean; contained: boolean; overflow: boolean; detailsOpen: boolean; focusable: boolean; retryVisible: boolean; nativeHidden: boolean; hostOnly: boolean; clientHeight: number; scrollHeight: number }[] };
export type BrowserProof = { tabs?: BrowserTabsProof; failures?: BrowserFailureProof; checks: number; modelRequests: number; isolation: { sandbox: boolean; contextIsolation: boolean; nodeIntegration: boolean; preload: boolean; privateSession: boolean }; nativeHistoryVerified: boolean; pendingAddressStopVerified: boolean; sameUrlRedirectVerified: boolean; unsubmittedAddressRetained: boolean; popupPrivateNavigationDenied: boolean; failureRetryVerified: boolean; keyboardFocusVerified: boolean; draftRetained: boolean; modalOcclusionVerified: boolean; privateRestartVerified: boolean; workbenchReloadVerified: boolean; staleOwnerCloseVerified: boolean; screenshots: string[]; layouts: { theme: string; zoom: number; viewport: { width: number; height: number }; navigation: { selectedVisible: boolean; current: string }; expected: { x: number; y: number; right: number; bottom: number }; native: { x: number; y: number; width: number; height: number } }[] };
export type PdfPreviewProof = { checks: number; canvasTextVerified: boolean; outlineTargetsVerified: boolean; fullDocumentSearchVerified: boolean; linksNotesZoomVerified: boolean; exportOwnershipRestartVerified: boolean };
export type ProjectBranchesProof = { checks: number; modelRequests: number; localListSearchVerified: boolean; creationValidationBusyVerified: boolean; overwriteRetryVerified: boolean; editorRefreshDraftConflictVerified: boolean; worktreeProjectScopeVerified: boolean; hookStatePreviewCleanupVerified: boolean; referenceZoomKeyboardVerified: boolean; restartDraftsVerified: boolean; screenshots: string[]; layouts: { theme: string; zoom: number; overflow: boolean; fieldPadding: string; fieldGap: string; fieldBackground: string; viewport: { width: number; height: number }; dialog: { left: number; top: number; right: number; bottom: number; width: number; height: number }; controls: { visible: boolean; contentFits: boolean; width: number; height: number }[] }[]; actions: { checks: number; renameStateVerified: boolean; deleteCancelMergedOnlyVerified: boolean; unmergedWorktreeProjectGuardsVerified: boolean }; actionLayouts: { theme: string; zoom: number; mode: string; overflow: boolean; namesVisible: boolean; viewport: { width: number; height: number }; dialog: { left: number; top: number; right: number; bottom: number; width: number; height: number }; controls: { visible: boolean; contentFits: boolean; width: number; height: number; renderedHeight: number }[] }[] };
export type BrowserTabsProof = { checks: number; independentHistoryDraftsVerified: boolean; sharedTransientSessionVerified: boolean; selectedViewOnlyVerified: boolean; backgroundFailureCloseVerified: boolean; nativeShortcutsVerified: boolean; lastCloseFreshVerified: boolean; workbenchReloadAllTabsVerified: boolean; screenshots: string[]; layouts: { theme: string; zoom: number; selectedVisible: boolean; addVisible: boolean; addWidth: number; addHeight: number; overflow: boolean; tabCount: number; panelLinked: boolean; expected: { x: number; y: number; width: number; height: number }; native: { x: number; y: number; width: number; height: number } }[] };
export type PdfOriginalProof = { textOnlyProtocols: string[]; restartBytesVerified: boolean; deduplicatedBackupVerified: boolean; missingFileRestoredVerified: boolean };
export type McpSubscriptionProof = { checks: number; modelRequests: number; realNotificationsVerified: boolean; explicitDraftInsertionVerified: boolean; delayedUnsubscribeFiltered: boolean; templateSelectionVerified: boolean; disconnectRestartVerified: boolean; unsupportedServerVerified: boolean; zoomKeyboardVerified: boolean; originalDraftRetained: boolean };
export type McpBinaryProof = { checks: number; binaryModelRequests: number; realWorkerPreviewVerified: boolean; exactOriginalExportVerified: boolean; emptyAndUnsupportedExportVerified: boolean; promptBinaryTextOnlyVerified: boolean; staleSelectionVerified: boolean; zoomKeyboardVerified: boolean; restartDraftRetainedVerified: boolean };
export type McpPdfProof = { checks: number; explicitModelRequests: number; previewPersisted: boolean; originalSha256: string; exactOriginalVerified: boolean; promptPdfVerified: boolean; textOnlyModelTransportVerified: boolean; staleSubscriptionVerified: boolean; filesystemRetryVerified: boolean; restartVerified: boolean; backupRestoreVerified: boolean; restoreCompletionVerified: boolean; layout: { theme: string; zoom: number; controlsVisible: boolean; overflow: boolean }[] };
export type AssistantRecipeProof = { checks: number; recipeModelRequests: number; assistantBindingVerified: boolean; defaultOptionalChoicesVerified: boolean; deletedAssistantRecoveryVerified: boolean; zoomKeyboardVerified: boolean; backupRestartVerified: boolean; originalDraftRetained: boolean };
export type PromptTransferProof = { checks: number; transferModelRequests: number; exportModesVerified: boolean; inertPreviewCancelVerified: boolean; atomicImportRetryVerified: boolean; sharedFreshAssociationsVerified: boolean; zoomKeyboardVerified: boolean; backupRestartVerified: boolean; originalDraftRetained: boolean };
export type ToolActivitiesProof = {
  checks: number; commandRequests: number; nativeStates: string[];
  scopedClipboardPermission: boolean; exactOriginalCopy: boolean; staleClipboardGuard: boolean; deniedCopyRetry: boolean; focusBeforeInert: boolean; manualStreamingCollapse: boolean; restrictedQuickChat: boolean; reducedMotion: boolean; actualRestart: boolean;
  screenshots: { filename: string; size: number[] }[];
  layouts: { theme: string; zoom: number; fontSize: string; parentFontSize: string; gap: string; padding: string; duration: string; contained: boolean; controlVisible: boolean; summaryWidth: number; controlHeight: number; outputScrollBounded: boolean; horizontalOverflow: boolean }[];
};
export type ContextSummaryProof = { checks: number; requestCount: number; summaryRequests: number; originalMessages: number; finalMessages: number; readonlyPreviewVerified: boolean; actualContextRequestsVerified: boolean; cancellationFailureVerified: boolean; expiredFullContextVerified: boolean; restartHistoryVerified: boolean; restrictedQuickChatVerified: boolean; layouts: { theme: string; zoom: number; contained: boolean; horizontalOverflow: boolean; nativeSize: number[] }[]; screenshots: string[] };
export type ProjectWorktreesProof = { checks: number; modelRequests: number; bridgeValidationVerified: boolean; creationBusySourcePreservationVerified: boolean; registrationRetryVerified: boolean; existingBranchReuseVerified: boolean; hookSourcePreviewVerified: boolean; referenceZoomKeyboardVerified: boolean; restartDraftsVerified: boolean; rowLayout: { gap: string; padding: string; titleSize: string; titleWeight: string; pathSize: string }; screenshots: string[]; layouts: (ProjectBranchesProof['layouts'][number] & { fields: { label: string; reachable: boolean; control: { top: number; bottom: number; left: number; right: number; width: number; height: number }; content: { top: number; bottom: number }; viewport: { width: number; height: number } }[] })[] };
export type WorktreeSettingsProof = {
  checks: number; modelRequests: number; rootValidationVerified: boolean; busySaveVerified: boolean;
  saveFailurePreservationVerified: boolean; rootCreationVerified: boolean; backupRestartVerified: boolean;
  referenceZoomKeyboardVerified: boolean; directoryPickerVerified: boolean; pickerCases: number; screenshots: string[];
  defaultRootVerified: boolean; defaultRootFailureVerified: boolean; defaultRootBackupRestartVerified: boolean;
  layouts: { theme: string; zoom: number; width: number; left: number; right: number; viewportWidth: number; headingMargin: string; descriptionSize: string; pickerLeft: number; pickerRight: number; pickerTop: number; pickerBottom: number; contentLeft: number; contentRight: number; contentTop: number; contentBottom: number }[];
  errorLayouts: { top: number; bottom: number; left: number; right: number; viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number; text: string }[];
};
export type WorktreeOverviewProof = {
  checks: number; modelRequests: number; actualRepositoryAssociationVerified: boolean; refreshReadOnlyVerified: boolean;
  progressiveProjectResultsVerified: boolean; progressiveSanitizedErrorsVerified: boolean; managementLoadingProtectionVerified: boolean;
  refreshKeyboardFocusVerified: boolean; refreshDoesNotStealFocusVerified: boolean;
  errorRetryCloseVerified: boolean; boundedPagingVerified: boolean; referenceZoomKeyboardVerified: boolean; sourcePreservationVerified: boolean;
  queryPages: string[][]; screenshots: string[];
  refreshKeyboardLayouts: (WorktreeFocusLayout & { focused: boolean; focusVisible: boolean; outlineOffset: number; outlineColor: string })[];
  layouts: { theme: string; zoom: number; contentWidth: number; contentScrollWidth: number; viewportWidth: number; documentWidth: number;
    pending: { top: number; bottom: number; left: number; right: number; viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number };
    error: { top: number; bottom: number; left: number; right: number; viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number } }[];
};
export type WorktreeConversationsProof = {
  checks: number; modelRequests: number; linkedConversationVerified: boolean; projectDraftVerified: boolean;
  heldFailureRetryRestartVerified: boolean; staleTargetsVerified: boolean; sanitizedErrorsVerified: boolean;
  referenceZoomKeyboardVerified: boolean; sourcePreservationVerified: boolean; screenshots: string[];
  keyboardLayouts: (WorktreeFocusLayout & { label: string })[];
  layouts: { theme: string; zoom: number; contentWidth: number; contentScrollWidth: number; viewportWidth: number; documentWidth: number;
    top: number; bottom: number; left: number; right: number; viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number }[];
};
type WorktreeFocusLayout = {
  theme: string; zoom: number; outline: number; top: number; bottom: number; left: number; right: number;
  viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number;
};
export type WorktreeUpstreamProof = {
  checks: number; modelRequests: number; preferenceFailureRetryVerified: boolean; actualFetchPinnedCommitVerified: boolean;
  neverAndMissingUpstreamVerified: boolean; actualFailureRetryVerified: boolean; backupRestartVerified: boolean;
  referenceZoomKeyboardVerified: boolean; sourcePreservationVerified: boolean; screenshots: string[];
  keyboardLayouts: WorktreeFocusLayout[];
  layouts: { theme: string; zoom: number; contentWidth: number; contentScrollWidth: number; viewportWidth: number; documentWidth: number;
    top: number; bottom: number; left: number; right: number; viewportTop: number; viewportBottom: number; viewportLeft: number; viewportRight: number }[];
};
export type WorktreeRegistrationProof = {
  checks: number; modelRequests: number; inlineValidationCancelVerified: boolean; actualFailureSameIdRetryVerified: boolean;
  duplicatePreservationVerified: boolean; staleSourceVerified: boolean; backupRestartVerified: boolean;
  referenceZoomKeyboardVerified: boolean; sourcePreservationVerified: boolean; screenshots: string[];
  keyboardLayouts: (WorktreeFocusLayout & { label: string })[];
  layouts: WorktreeConversationsProof['layouts'];
};
export type WorktreeOwnershipProof = {
  checks: number; modelRequests: number; externalNonAdoptionVerified: boolean; newBranchReceiptVerified: boolean;
  existingBranchReceiptVerified: boolean; atomicFailureRetentionVerified: boolean; normalRestartVerified: boolean;
  backupSeparationVerified: boolean; sourcePreservationVerified: boolean; keyboardWarningLayoutsVerified: boolean;
  screenshots: string[];
  layouts: { theme: string; zoom: number; bounds: Omit<WorktreeConversationsProof['layouts'][number], 'theme' | 'zoom'>;
    focus: { left: number; right: number; top: number; bottom: number; width: number; height: number; outline: string; outlineWidth: number } }[];
};
export type WorktreePinningProof = {
  checks: number; modelRequests: number; ownedOnlyControlsVerified: boolean; heldFailureRetryVerified: boolean;
  staleSourceReadRecoveryVerified: boolean; backupSeparationVerified: boolean; normalRestartVerified: boolean;
  referenceZoomKeyboardVerified: boolean; replacementRejectionVerified: boolean; sourcePreservationVerified: boolean;
  screenshots: string[]; layouts: WorktreeConversationsProof['layouts'];
  keyboardLayouts: (WorktreeFocusLayout & { label: string })[];
};
export type WorktreeSnapshotsProof = {
  checks: number; modelRequests: number; ownedOnlyCaptureVerified: boolean; privateSaveFailureVerified: boolean;
  backupSeparationVerified: boolean; normalRestartVerified: boolean; detachedExactRestoreVerified: boolean;
  referenceZoomKeyboardVerified: boolean; restoreKeyboardVerified: boolean; acceptedShutdownVerified: boolean;
  corruptReadRecoveryVerified: boolean; replacementRejectionVerified: boolean; sourcePreservationVerified: boolean;
  screenshots: string[]; layouts: WorktreeConversationsProof['layouts'];
  keyboardLayouts: (WorktreeFocusLayout & { label: string })[];
  restoreKeyboardLayouts: (WorktreeFocusLayout & { label: string })[];
  restoreLayouts: { theme: string; zoom: number; error: Omit<WorktreeConversationsProof['layouts'][number], 'theme' | 'zoom'>;
    cancel: Omit<WorktreeConversationsProof['layouts'][number], 'theme' | 'zoom'>; submit: Omit<WorktreeConversationsProof['layouts'][number], 'theme' | 'zoom'>;
    draftRetained: boolean; cancelFocusVerified: boolean }[];
};
export type SettingsSearchProof = { checks: number; modelRequests: number; keyboardVerified: boolean; destinationFocusVerified: boolean; draftRetentionVerified: boolean; heldPickerVerified: boolean; sessionResetVerified: boolean; explicitDiscardVerified: boolean; discardKeyboardFocusVerified: boolean; scopedDiscardVerified: boolean; revertedDraftVerified: boolean; compactDiscardLayoutsVerified: boolean; allSettingsFormsVerified: boolean; protectedForms: string[]; screenshots: string[]; layouts: { theme: string; zoom: number; contained: boolean; sidebarOverflow: boolean; panelOverflow: boolean; searchStyleVerified: boolean; discard: { width: number; expectedWidth: number; radius: string; contained: boolean; heightBounded: boolean; buttonsVisible: boolean; defaultCancelFocus: boolean; closeControls: number } }[] };
export type ReleaseProof = {
  audit: { compiledAssetsMatchVerifiedBuild: boolean; removedUiFontReferencesVerified: boolean; oldProductIdentityMatches: string[]; unresolvedAssets: string[]; unresolvedDistribution: string[]; executableSha256: string; archiveSha256: string };
desktop: NavigationReleaseProof & { variant: string; checks: number; normalCloseVerified: boolean; runtimeErrors: string[]; executableSha256: string; archiveSha256: string; taskPlans?: TaskPlanProof; composerActions?: ComposerActionsProof; settingsSearch?: SettingsSearchProof; mcpResourceSubscriptions?: McpSubscriptionProof; mcpBinaryFiles?: McpBinaryProof; mcpPdf?: McpPdfProof; quickChat?: QuickChatProof; browser?: BrowserProof; projectBranches?: ProjectBranchesProof; projectWorktrees?: ProjectWorktreesProof; worktreeSettings?: WorktreeSettingsProof; worktreeOverview?: WorktreeOverviewProof; worktreeConversations?: WorktreeConversationsProof; worktreeUpstream?: WorktreeUpstreamProof; worktreeRegistration?: WorktreeRegistrationProof; worktreeOwnership?: WorktreeOwnershipProof; worktreePinning?: WorktreePinningProof; worktreeSnapshots?: WorktreeSnapshotsProof; worktreeCleanup?: WorktreeCleanupProof; toolActivities?: ToolActivitiesProof; contextSummaries?: ContextSummaryProof; assistantRecipes?: AssistantRecipeProof; promptTransfer?: PromptTransferProof; memories?: { checks: number; safeCancelVerified: boolean; deleteFailureRetentionVerified: boolean; pendingDismissalLocked: boolean; longDeleteContentVerified: boolean; defaultSurfaceVerified: boolean; screenshots: string[]; deletionLayouts: { theme: string; zoom: number; width: number; expectedWidth: number; radius: string; top: number; expectedTop: number; surfaceRgba: number[]; backdropBlur: string; borderWidth: string; shadow: string; overlayRgba: number[]; overlayBlur: string; closeWidth: number; closeHeight: number; heading: { size: string; lineHeight: string; weight: string; spacing: string }; contained: boolean; bounded: boolean; bodyPadding: string; footerPadding: string; buttonsVisible: boolean; cancelFocused: boolean; closeControls: number; longContentEscaped: boolean; independentScrollVerified: boolean }[] }; projectPreview?: ProjectPreviewProof; pdfPreview?: PdfPreviewProof; attachments?: { pdfOriginal?: PdfOriginalProof; imageExport?: ImageExportProof } };
  surfaces: ReleaseProof['desktop'] & { tooltipLifecycle?: {
    passed: boolean; sourceOpenDelayMs: number; sourceSkipIntervalMs: number; clockAdvanced: boolean;
    originalTimeoutCallbacksRetained: boolean; focusEmulationDisabledOnlyDuringNativeBlur: boolean; originalFocusEmulationRestored: boolean;
  } };
  preview: ReleaseProof['desktop'] & ProjectPreviewProof;
  branches: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; modelRequests: number; ambiguousHistoryRecoveryVerified: boolean; manualOrderingVerified: boolean; orderingFailureRecoveryVerified: boolean; orderingBackupRestartVerified: boolean };
  temporary: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; temporaryModelRequests: number; persistenceExcludedVerified: boolean; backupsExcludedVerified: boolean; restartClearedVerified: boolean; storageModeImmutableVerified: boolean; regularDraftsRetainedVerified: boolean };
  comparisons: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; comparisonModelRequests: number; parallelStreamsVerified: boolean; independentFailureStopVerified: boolean; atomicSaveRetryVerified: boolean; backupsRestartVerified: boolean; temporaryExclusionVerified: boolean; originalDraftRetainedVerified: boolean; originalModelIdentityVerified: boolean };
  portable: { checks: number; launches: { longDocumentPathLength?: number }[]; longPathCleanupVerified: boolean; unpackedFilesVerified: number; runtimeErrors: string[]; wrapperSha256: string; childExecutableSha256: string };
  portableAudit: { executableSha256: string; archiveSha256: string; unresolvedAssets: string[]; unresolvedDistribution: string[] };
  bootstrap: { variants: { variant: string; executableSha256: string; plugins: { redistributionStatus: string }[] }[] };
  installer: { checks: number; normalCloseVerified: boolean; registrationVerified: boolean; shortcutsVerified: boolean; uninstalled: boolean; userDataRetained: boolean; executableSha256: string; archiveSha256: string; installerSha256: string };
};
export function verifyRuntimeProof(proof: ReleaseProof): void;
export function verifySettingsSearchProof(proof: SettingsSearchProof | undefined): void;
type WorktreeCleanupBounds = Omit<WorktreeConversationsProof['layouts'][number], 'theme' | 'zoom'> & { label: string; outline: number; focused: boolean };
export type WorktreeCleanupProof = {
  checks: number; modelRequests: number; ownedOnlyControlsVerified: boolean; dirtyPinLockProtectionVerified: boolean;
  activeTerminalProtectionVerified: boolean; replacementRejectionVerified: boolean; privateFailureGateVerified: boolean;
  referenceZoomKeyboardVerified: boolean; exactDeleteRestoreVerified: boolean; fixedChatAfterRemovalVerified: boolean;
  metadataFailureVerified: boolean; postCreateAutomaticVerified: boolean; disableConfirmationVerified: boolean;
  acceptedShutdownVerified: boolean; sourcePreservationVerified: boolean; screenshots: string[];
  layouts: { theme: string; zoom: number; error: WorktreeCleanupBounds; cancel: WorktreeCleanupBounds; submit: WorktreeCleanupBounds }[];
  keyboardLayouts: (WorktreeCleanupBounds & { theme: string; zoom: number })[];
  disableLayouts: { theme: string; zoom: number; cancel: WorktreeCleanupBounds; submit: WorktreeCleanupBounds }[];
};
export function verifyWorktreeCleanupProof(proof: WorktreeCleanupProof | undefined): void;
