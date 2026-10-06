const identifier = '(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = `(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?`;

export function releaseVersion(tag, version) {
  if (typeof tag !== 'string' || tag !== tag.trim() || !new RegExp(`^v${versionPattern}$`).test(tag) || tag !== `v${version}`) {
    throw new Error('The release tag must exactly match the package version');
  }
  return { tag, version, prerelease: version.includes('-') };
}

export function releaseNotes(changelog, version) {
  releaseVersion(`v${version}`, version);
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const headings = lines.flatMap((line, index) => {
    const match = /^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?$/.exec(line);
    return match ? [{ version: match[1], index }] : [];
  });
  const matches = headings.filter((heading) => heading.version === version);
  if (matches.length !== 1) throw new Error('The changelog must contain one exact release section');
  const start = matches[0].index;
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  for (const heading of ['新功能', '变更与安全', '修复与完善', '安装', 'English']) {
    const index = body.split('\n').indexOf(`### ${heading}`);
    if (index < 0) throw new Error('Release notes require concrete Chinese sections and an English summary');
    const section = body.split('\n').slice(index + 1);
    const next = section.findIndex((line) => /^###? /.test(line));
    const content = section.slice(0, next < 0 ? undefined : next).join('\n').trim();
    if (content.length < 12 || /^(?:TBD|TODO|待补充|无|None)[.。]?$/i.test(content)) {
      throw new Error('A release-note section is empty or incomplete');
    }
  }
  return `${body}\n`;
}

export function verifyRuntimeProof({ audit, desktop, surfaces, preview, branches, temporary, comparisons, portable, portableAudit, bootstrap, installer }) {
  if (![audit.executableSha256, audit.archiveSha256, portable.wrapperSha256].every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Release proof requires complete SHA-256 values');
  }
  if (!audit.compiledAssetsMatchVerifiedBuild || !audit.removedUiFontReferencesVerified || audit.oldProductIdentityMatches?.length !== 0 || audit.unresolvedAssets?.length !== 0 || audit.unresolvedDistribution?.length !== 0) {
    throw new Error('The application-directory audit has unresolved release requirements');
  }
  for (const result of [desktop, surfaces, preview, branches, temporary, comparisons]) {
    if (!result || result.variant !== 'packaged executable' || !result.normalCloseVerified || result.runtimeErrors?.length !== 0 || result.executableSha256 !== audit.executableSha256 || result.archiveSha256 !== audit.archiveSha256) {
      throw new Error('Runtime proof must match the audited application and normal close');
    }
  }
  if (!Number.isInteger(desktop.checks) || desktop.checks < 223 || surfaces.checks !== 4 || portable.checks !== 7 || portable.launches?.length !== 2 || portable.runtimeErrors?.length !== 0 || portable.childExecutableSha256 !== audit.executableSha256 || portableAudit.executableSha256 !== audit.executableSha256 || portableAudit.archiveSha256 !== audit.archiveSha256 || portableAudit.unresolvedAssets?.length !== 0 || portableAudit.unresolvedDistribution?.length !== 0) {
    throw new Error('Complete desktop, surface and portable verification is required');
  }
  const completePreview = result => result?.checks === 9 && result.outsideHttpRequests === 0 && result.docked?.checks === 4 && result.docked.floatingTransferVerified === true && result.docked.projectRemovalVerified === true;
  if (!completePreview(preview)) throw new Error('Complete offline project-preview verification is required');
  if (desktop.memories?.checks !== 3) throw new Error('Complete memory verification is required');
  if (!completePreview(desktop.projectPreview)) throw new Error('Complete desktop must include offline project-preview verification');
  const subscriptions = desktop.mcpResourceSubscriptions;
  if (!subscriptions || subscriptions.checks !== 6 || subscriptions.modelRequests !== 0 || !['realNotificationsVerified', 'explicitDraftInsertionVerified', 'delayedUnsubscribeFiltered', 'templateSelectionVerified', 'disconnectRestartVerified', 'unsupportedServerVerified', 'zoomKeyboardVerified', 'originalDraftRetained'].every((key) => subscriptions[key] === true)) {
    throw new Error('Complete MCP resource-subscription verification is required');
  }
  const binary = desktop.mcpBinaryFiles;
  if (!binary || binary.checks !== 6 || binary.binaryModelRequests !== 0 || !['realWorkerPreviewVerified', 'exactOriginalExportVerified', 'emptyAndUnsupportedExportVerified', 'promptBinaryTextOnlyVerified', 'staleSelectionVerified', 'zoomKeyboardVerified', 'restartDraftRetainedVerified'].every((key) => binary[key] === true)) {
    throw new Error('Complete MCP binary-file verification is required');
  }
  const recipes = desktop.assistantRecipes;
  if (!recipes || recipes.checks !== 4 || recipes.recipeModelRequests !== 0 || !['assistantBindingVerified', 'defaultOptionalChoicesVerified', 'deletedAssistantRecoveryVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'].every((key) => recipes[key] === true)) {
    throw new Error('Complete assistant-recipe verification is required');
  }
  const transfer = desktop.promptTransfer;
  if (!transfer || transfer.checks !== 5 || transfer.transferModelRequests !== 0 || !['exportModesVerified', 'inertPreviewCancelVerified', 'atomicImportRetryVerified', 'sharedFreshAssociationsVerified', 'zoomKeyboardVerified', 'backupRestartVerified', 'originalDraftRetained'].every((key) => transfer[key] === true)) {
    throw new Error('Complete prompt-transfer verification is required');
  }
  if (branches.checks !== 9 || !branches.ambiguousHistoryRecoveryVerified || !branches.manualOrderingVerified || !branches.orderingFailureRecoveryVerified || !branches.orderingBackupRestartVerified || branches.verificationRun !== 'complete desktop suite' || branches.suiteChecks !== desktop.checks || branches.modelRequests !== 0) {
    throw new Error('Complete no-request branch-navigation verification is required');
  }
  if (temporary.checks !== 6 || temporary.verificationRun !== 'complete desktop suite' || temporary.suiteChecks !== desktop.checks || temporary.temporaryModelRequests !== 3 || !temporary.persistenceExcludedVerified || !temporary.backupsExcludedVerified || !temporary.restartClearedVerified || !temporary.storageModeImmutableVerified || !temporary.regularDraftsRetainedVerified) {
    throw new Error('Complete temporary-chat persistence, backup and restart verification is required');
  }
  if (comparisons.checks !== 6 || comparisons.verificationRun !== 'complete desktop suite' || comparisons.suiteChecks !== desktop.checks || comparisons.comparisonModelRequests !== 11 || !['parallelStreamsVerified', 'independentFailureStopVerified', 'atomicSaveRetryVerified', 'backupsRestartVerified', 'temporaryExclusionVerified', 'originalDraftRetainedVerified', 'originalModelIdentityVerified'].every((key) => comparisons[key] === true)) {
    throw new Error('Complete parallel model-comparison verification is required');
  }
  if (!portable.longPathCleanupVerified || !Number.isInteger(portable.unpackedFilesVerified) || portable.unpackedFilesVerified < 1 || !portable.launches.every((launch) => Number.isInteger(launch.longDocumentPathLength) && launch.longDocumentPathLength > 260)) {
    throw new Error('Portable long-path cleanup must be verified in both real launches');
  }
  if (!Array.isArray(bootstrap.variants) || bootstrap.variants.length !== 3 || ['installer', 'uninstaller', 'portable'].some((name) => !bootstrap.variants.some((variant) => variant.variant === name && variant.plugins?.length > 0 && variant.plugins.every((plugin) => plugin.redistributionStatus === 'verified')))) {
    throw new Error('Each Windows bootstrap requires verified original plugin inputs');
  }
  if (!installer.normalCloseVerified || !installer.registrationVerified || !installer.shortcutsVerified || !installer.uninstalled || !installer.userDataRetained || installer.checks !== desktop.checks || installer.executableSha256 !== audit.executableSha256 || installer.archiveSha256 !== audit.archiveSha256) {
    throw new Error('Installed-runtime, shortcut and uninstall proof is incomplete');
  }
  if (![installer.installerSha256, ...bootstrap.variants.map((variant) => variant.executableSha256)].every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Release proof requires complete bootstrap SHA-256 values');
  }
  if (bootstrap.variants.find((variant) => variant.variant === 'installer').executableSha256 !== installer.installerSha256 || bootstrap.variants.find((variant) => variant.variant === 'portable').executableSha256 !== portable.wrapperSha256) {
    throw new Error('Windows runtime proof must match its audited installer and portable bootstraps');
  }
}
