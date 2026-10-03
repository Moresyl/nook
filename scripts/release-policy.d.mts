export function releaseVersion(tag: string, version: string): { tag: string; version: string; prerelease: boolean };
export function releaseNotes(changelog: string, version: string): string;
export type ReleaseProof = {
  audit: { compiledAssetsMatchVerifiedBuild: boolean; removedUiFontReferencesVerified: boolean; oldProductIdentityMatches: string[]; unresolvedAssets: string[]; unresolvedDistribution: string[]; executableSha256: string; archiveSha256: string };
  desktop: { variant: string; checks: number; normalCloseVerified: boolean; runtimeErrors: string[]; executableSha256: string; archiveSha256: string };
  surfaces: ReleaseProof['desktop'];
  branches: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; modelRequests: number; ambiguousHistoryRecoveryVerified: boolean; manualOrderingVerified: boolean; orderingFailureRecoveryVerified: boolean; orderingBackupRestartVerified: boolean };
  temporary: ReleaseProof['desktop'] & { verificationRun: string; suiteChecks: number; temporaryModelRequests: number; persistenceExcludedVerified: boolean; backupsExcludedVerified: boolean; restartClearedVerified: boolean; storageModeImmutableVerified: boolean; regularDraftsRetainedVerified: boolean };
  portable: { checks: number; launches: { longDocumentPathLength?: number }[]; longPathCleanupVerified: boolean; unpackedFilesVerified: number; runtimeErrors: string[]; wrapperSha256: string; childExecutableSha256: string };
  portableAudit: { executableSha256: string; archiveSha256: string; unresolvedAssets: string[]; unresolvedDistribution: string[] };
  bootstrap: { variants: { variant: string; executableSha256: string; plugins: { redistributionStatus: string }[] }[] };
  installer: { checks: number; normalCloseVerified: boolean; registrationVerified: boolean; shortcutsVerified: boolean; uninstalled: boolean; userDataRetained: boolean; executableSha256: string; archiveSha256: string; installerSha256: string };
};
export function verifyRuntimeProof(proof: ReleaseProof): void;
