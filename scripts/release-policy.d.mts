export function releaseVersion(tag: string, version: string): { tag: string; version: string; prerelease: boolean };
export function releaseNotes(changelog: string, version: string): string;
export type McpSubscriptionProof = { checks: number; modelRequests: number; realNotificationsVerified: boolean; explicitDraftInsertionVerified: boolean; delayedUnsubscribeFiltered: boolean; templateSelectionVerified: boolean; disconnectRestartVerified: boolean; unsupportedServerVerified: boolean; zoomKeyboardVerified: boolean; originalDraftRetained: boolean };
export type McpBinaryProof = { checks: number; binaryModelRequests: number; realWorkerPreviewVerified: boolean; exactOriginalExportVerified: boolean; emptyAndUnsupportedExportVerified: boolean; promptBinaryTextOnlyVerified: boolean; staleSelectionVerified: boolean; zoomKeyboardVerified: boolean; restartDraftRetainedVerified: boolean };
export type AssistantRecipeProof = { checks: number; recipeModelRequests: number; assistantBindingVerified: boolean; defaultOptionalChoicesVerified: boolean; deletedAssistantRecoveryVerified: boolean; zoomKeyboardVerified: boolean; backupRestartVerified: boolean; originalDraftRetained: boolean };
export type ReleaseProof = {
  audit: { compiledAssetsMatchVerifiedBuild: boolean; removedUiFontReferencesVerified: boolean; oldProductIdentityMatches: string[]; unresolvedAssets: string[]; unresolvedDistribution: string[]; executableSha256: string; archiveSha256: string };
  desktop: { variant: string; checks: number; normalCloseVerified: boolean; runtimeErrors: string[]; executableSha256: string; archiveSha256: string; mcpResourceSubscriptions?: McpSubscriptionProof; mcpBinaryFiles?: McpBinaryProof; assistantRecipes?: AssistantRecipeProof };
  surfaces: ReleaseProof['desktop'];
  branches: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; modelRequests: number; ambiguousHistoryRecoveryVerified: boolean; manualOrderingVerified: boolean; orderingFailureRecoveryVerified: boolean; orderingBackupRestartVerified: boolean };
  temporary: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; temporaryModelRequests: number; persistenceExcludedVerified: boolean; backupsExcludedVerified: boolean; restartClearedVerified: boolean; storageModeImmutableVerified: boolean; regularDraftsRetainedVerified: boolean };
  comparisons: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; comparisonModelRequests: number; parallelStreamsVerified: boolean; independentFailureStopVerified: boolean; atomicSaveRetryVerified: boolean; backupsRestartVerified: boolean; temporaryExclusionVerified: boolean; originalDraftRetainedVerified: boolean; originalModelIdentityVerified: boolean };
  portable: { checks: number; launches: { longDocumentPathLength?: number }[]; longPathCleanupVerified: boolean; unpackedFilesVerified: number; runtimeErrors: string[]; wrapperSha256: string; childExecutableSha256: string };
  portableAudit: { executableSha256: string; archiveSha256: string; unresolvedAssets: string[]; unresolvedDistribution: string[] };
  bootstrap: { variants: { variant: string; executableSha256: string; plugins: { redistributionStatus: string }[] }[] };
  installer: { checks: number; normalCloseVerified: boolean; registrationVerified: boolean; shortcutsVerified: boolean; uninstalled: boolean; userDataRetained: boolean; executableSha256: string; archiveSha256: string; installerSha256: string };
};
export function verifyRuntimeProof(proof: ReleaseProof): void;
