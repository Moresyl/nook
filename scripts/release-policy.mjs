const identifier = '(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = `(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-${identifier}(?:\\.${identifier})*)?`;

function completeWorktreeSnapshots(proof) {
  if (proof?.checks !== 8 || proof.modelRequests !== 0 || !['ownedOnlyCaptureVerified', 'privateSaveFailureVerified', 'backupSeparationVerified', 'normalRestartVerified', 'detachedExactRestoreVerified', 'referenceZoomKeyboardVerified', 'restoreKeyboardVerified', 'acceptedShutdownVerified', 'corruptReadRecoveryVerified', 'replacementRejectionVerified', 'sourcePreservationVerified'].every(key => proof[key] === true)) return false;
  const six = rows => Array.isArray(rows) && rows.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => rows.filter(row => row?.theme === theme && row.zoom === zoom).length === 1));
  const whole = row => row && ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight', 'contentWidth', 'contentScrollWidth', 'documentWidth', 'viewportWidth'].every(key => Number.isFinite(row[key]))
    && row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left;
  const focused = (row, label) => row && ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight', 'outline'].every(key => Number.isFinite(row[key]))
    && row.label === label && row.outline > 0 && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left;
  return six(proof.layouts) && proof.layouts.every(whole)
    && six(proof.keyboardLayouts) && proof.keyboardLayouts.every(row => focused(row, '保存工作树快照'))
    && six(proof.restoreKeyboardLayouts) && proof.restoreKeyboardLayouts.every(row => focused(row, '恢复快照'))
    && six(proof.restoreLayouts) && proof.restoreLayouts.every(row => row.draftRetained === true && row.cancelFocusVerified === true && whole(row.error) && whole(row.cancel) && whole(row.submit))
    && Array.isArray(proof.screenshots) && proof.screenshots.length === 33 && new Set(proof.screenshots).size === 33 && proof.screenshots.every(name => typeof name === 'string' && /^worktree-snapshots-[a-z0-9-]+-shell\.png$/.test(name));
}

export function verifyWorktreeCleanupProof(proof) {
  const six = rows => Array.isArray(rows) && rows.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => rows.filter(row => row?.theme === theme && row.zoom === zoom).length === 1));
  const whole = row => row && ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight', 'outline', 'contentWidth', 'contentScrollWidth', 'documentWidth', 'viewportWidth'].every(key => Number.isFinite(row[key]))
    && typeof row.focused === 'boolean' && row.outline >= 0 && row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth
    && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left;
  const focused = (row, label) => whole(row) && row.focused === true && row.outline > 0 && row.label === label;
  const flags = ['ownedOnlyControlsVerified', 'dirtyPinLockProtectionVerified', 'activeTerminalProtectionVerified', 'replacementRejectionVerified', 'privateFailureGateVerified', 'referenceZoomKeyboardVerified', 'exactDeleteRestoreVerified', 'fixedChatAfterRemovalVerified', 'metadataFailureVerified', 'postCreateAutomaticVerified', 'disableConfirmationVerified', 'acceptedShutdownVerified', 'sourcePreservationVerified'];
  if (proof?.checks !== 10 || proof.modelRequests !== 0 || !flags.every(key => proof[key] === true)
    || !six(proof.layouts) || !proof.layouts.every(row => focused(row.error, '工作树包含修改、未跟踪或忽略文件，文件已保留。请先提交或移走这些文件，再重试。') && whole(row.cancel) && row.cancel.label === '取消' && whole(row.submit) && row.submit.label === '保存快照并删除')
    || !six(proof.keyboardLayouts) || !proof.keyboardLayouts.every(row => focused(row, '保存快照并删除'))
    || !six(proof.disableLayouts) || !proof.disableLayouts.every(row => focused(row.cancel, '保留自动清理') && whole(row.submit) && row.submit.label === '停用自动清理')
    || !Array.isArray(proof.screenshots) || proof.screenshots.length !== 27 || new Set(proof.screenshots).size !== 27 || !proof.screenshots.every(name => typeof name === 'string' && /^worktree-cleanup-[a-z0-9-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree cleanup verification is required');
  }
}

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

export function verifyComposerActionsProof(proof) {
  const flags = ['queryKeyboardVerified', 'templateCancellationVerified', 'caretInsertionVerified', 'scopeSelectionVerified', 'sixThemeZoomLayoutsVerified', 'quickChatVerified', 'fixtureCleanupVerified'];
  const themes = ['light', 'dark'];
  const zooms = [1, 1.25, 1.5];
  const expected = themes.flatMap(theme => zooms.flatMap(zoom => ['', '-empty'].map(state => `composer-actions${state}-${theme}-${zoom * 100}.png`)));
  const whole = row => row && ['left', 'right', 'top', 'bottom', 'chromeBottom', 'viewportWidth', 'viewportHeight', 'width', 'scrollWidth', 'activeTop', 'activeBottom', 'clipTop', 'clipBottom'].every(key => Number.isFinite(row[key]))
    && row.viewportWidth > 0 && row.viewportHeight > 0 && row.width > 0 && row.scrollWidth > 0 && row.scrollWidth <= row.width
    && row.left >= 0 && row.right <= row.viewportWidth && row.right > row.left && row.chromeBottom >= 0 && row.top >= row.chromeBottom + 8 && row.bottom <= row.viewportHeight && row.bottom > row.top
    && row.clipTop >= row.top && row.clipBottom <= row.bottom && row.clipBottom > row.clipTop && row.activeTop >= row.clipTop && row.activeBottom <= row.clipBottom && row.activeBottom > row.activeTop
    && row.focused === true && row.opacity === '1' && row.fontSize === '14px' && row.minHeight === '24px' && row.background === (row.theme === 'light' ? 'rgb(249, 249, 249)' : 'rgb(65, 65, 65)');
  const layouts = Array.isArray(proof?.layouts) && proof.layouts.length === 6 && themes.every(theme => zooms.every(zoom => proof.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1)) && proof.layouts.every(whole);
  const images = Array.isArray(proof?.screenshots) && proof.screenshots.length === expected.length && expected.every(name => proof.screenshots.filter(filename => filename === name).length === 1);
  const captures = Array.isArray(proof?.captures) && proof.captures.length === expected.length && expected.every(name => proof.captures.filter(row => row?.filename === name).length === 1) && proof.captures.every(row =>
    row.width === 760 && row.height === 540 && Array.isArray(row.nativeSize) && row.nativeSize.length === 2 && row.nativeSize[0] === row.width && row.nativeSize[1] === row.height
    && (row.filename.includes('-empty-') ? row.query === '/NO_MATCH_QUICK_ACTION' && row.selectedLabel === null && row.optionCount === 0 : row.query === '/快捷' && typeof row.selectedLabel === 'string' && row.selectedLabel.trim().length > 0 && Number.isInteger(row.optionCount) && row.optionCount > 0));
  if (proof?.checks !== 7 || proof.modelRequests !== 0 || !flags.every(key => proof[key] === true) || !layouts || !images || !captures) {
    throw new Error('Complete composer actions, draft retention and whole native capture verification is required');
  }
}

export function verifySettingsSearchProof(settings) {
  const sixSettingsLayouts = Array.isArray(settings?.layouts) && settings.layouts.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => settings.layouts.filter(row => row?.theme === theme && row.zoom === zoom && row.contained === true && row.sidebarOverflow === false && row.panelOverflow === false && row.searchStyleVerified === true).length === 1));
  const compactLayouts = Array.isArray(settings?.layouts) && settings.layouts.every(row => {
    const layout = row?.discard;
    return layout && Number.isFinite(layout.width) && layout.width > 0 && Number.isFinite(layout.expectedWidth) && layout.expectedWidth > 0 && layout.expectedWidth <= 420 && Math.abs(layout.width - layout.expectedWidth) < 1 && layout.radius === '16px' && layout.closeControls === 0 && ['contained', 'heightBounded', 'buttonsVisible', 'defaultCancelFocus'].every(key => layout[key] === true);
  });
  const forms = Array.isArray(settings?.protectedForms) && settings.protectedForms.length === 6 && new Set(settings.protectedForms).size === 6 && ['models', 'desktop', 'worktrees', 'mcp', 'plugins', 'memories'].every(form => settings.protectedForms.includes(form));
  if (settings?.checks !== 8 || settings.modelRequests !== 0 || !['keyboardVerified', 'destinationFocusVerified', 'draftRetentionVerified', 'heldPickerVerified', 'sessionResetVerified', 'explicitDiscardVerified', 'discardKeyboardFocusVerified', 'scopedDiscardVerified', 'revertedDraftVerified', 'compactDiscardLayoutsVerified', 'allSettingsFormsVerified'].every(key => settings[key] === true) || !sixSettingsLayouts || !compactLayouts || !forms || !Array.isArray(settings.screenshots) || settings.screenshots.length !== 34 || new Set(settings.screenshots).size !== 34 || !settings.screenshots.every(name => typeof name === 'string' && name.startsWith('settings-search-') && name.endsWith('-shell.png'))) {
    throw new Error('Complete settings search, draft retention and native layout verification is required');
  }
}

export function verifyTaskPlanProof(proof) {
  const themes = ['light', 'dark'];
  const sizes = [[1280, 840], [760, 540]];
  const zooms = [1, 1.25, 1.5];
  const expected = themes.flatMap(theme => [
    ...sizes.flatMap(size => zooms.map(zoom => `task-plans-${theme}-${size[0]}-${zoom * 100}.png`)),
    `task-plans-${theme}-760-150-last-step.png`,
  ]).concat(['task-plans-stopped.png', 'task-plans-restart.png']);
  const flags = ['actualReadOnlyTool', 'rawToolRecordsPreserved', 'projectFilesUnchanged', 'noPlanDocument', 'invalidUpdateRetainsPlan', 'stoppedStateAccurate', 'plainTextRendering', 'actualRestart', 'noModelReplay'];
  const layouts = Array.isArray(proof?.layouts) && proof.layouts.length === 12
    && themes.every(theme => sizes.every(size => zooms.every(zoom => proof.layouts.filter(row => row?.theme === theme && row.zoom === zoom && Array.isArray(row.size) && row.size.length === 2 && row.size[0] === size[0] && row.size[1] === size[1]).length === 1)))
    && proof.layouts.every(row => row.contained === true && row.headerVisible === true && row.horizontalOverflow === false && row.padding === '12px' && row.count === 3
      && typeof row.border === 'string' && /^\d+(?:\.\d+)?px$/.test(row.border) && Math.abs(Number.parseFloat(row.border) - Math.floor(row.zoom) / row.zoom) < 0.00001
      && Array.isArray(row.rows) && row.rows.length === 3 && row.rows.every(step => step && step.contained === true
        && ['top', 'bottom', 'readableTop', 'readableBottom'].every(key => Number.isFinite(step[key]))
        && step.bottom > step.top && step.readableBottom > step.readableTop && step.top >= step.readableTop - 1 && step.bottom <= step.readableBottom + 1));
  const screenshots = Array.isArray(proof?.screenshots) && proof.screenshots.length === expected.length
    && expected.every(name => proof.screenshots.filter(filename => filename === name).length === 1);
  const captures = Array.isArray(proof?.nativeCaptureSizes) && proof.nativeCaptureSizes.length === expected.length
    && expected.every(name => proof.nativeCaptureSizes.filter(row => row?.filename === name).length === 1)
    && proof.nativeCaptureSizes.every(row => Array.isArray(row.size) && row.size.length === 2
      && row.size[0] === (row.filename.includes('-760-') ? 760 : 1280)
      && row.size[1] === (row.filename.includes('-760-') ? 540 : 840));
  if (proof?.checks !== 8 || !flags.every(key => proof[key] === true) || !layouts || !screenshots || !captures) {
    throw new Error('Complete task-plan preservation, per-step reachability and whole native capture verification is required');
  }
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
  if (!Number.isInteger(desktop.checks) || desktop.checks < 383 || surfaces.checks !== 5 || portable.checks !== 7 || portable.launches?.length !== 2 || portable.runtimeErrors?.length !== 0 || portable.childExecutableSha256 !== audit.executableSha256 || portableAudit.executableSha256 !== audit.executableSha256 || portableAudit.archiveSha256 !== audit.archiveSha256 || portableAudit.unresolvedAssets?.length !== 0 || portableAudit.unresolvedDistribution?.length !== 0) {
    throw new Error('Complete desktop, surface and portable verification is required');
  }
  const lifecycle = surfaces.tooltipLifecycle;
  if (lifecycle?.passed !== true || lifecycle.sourceOpenDelayMs !== 200 || lifecycle.sourceSkipIntervalMs !== 300 || lifecycle.clockAdvanced !== false || lifecycle.originalTimeoutCallbacksRetained !== true || lifecycle.focusEmulationDisabledOnlyDuringNativeBlur !== true || lifecycle.originalFocusEmulationRestored !== true) {
    throw new Error('Complete ordinary tooltip lifecycle verification is required');
  }
  verifyComposerActionsProof(desktop.composerActions);
  verifySettingsSearchProof(desktop.settingsSearch);
  verifyTaskPlanProof(desktop.taskPlans);
  const context = desktop.contextSummaries;
  const roots = desktop.worktreeSettings;
  const overview = desktop.worktreeOverview;
  const conversations = desktop.worktreeConversations;
  const upstream = desktop.worktreeUpstream;
  const registration = desktop.worktreeRegistration;
  const ownership = desktop.worktreeOwnership;
  const pinning = desktop.worktreePinning;
  if (!completeWorktreeSnapshots(desktop.worktreeSnapshots)) throw new Error('Complete worktree snapshot verification is required');
  verifyWorktreeCleanupProof(desktop.worktreeCleanup);
  if (pinning?.checks !== 6 || pinning.modelRequests !== 0 || !['ownedOnlyControlsVerified', 'heldFailureRetryVerified', 'staleSourceReadRecoveryVerified', 'backupSeparationVerified', 'normalRestartVerified', 'referenceZoomKeyboardVerified', 'replacementRejectionVerified', 'sourcePreservationVerified'].every(key => pinning[key] === true)
    || !Array.isArray(pinning.layouts) || pinning.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => pinning.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !pinning.layouts.every(row => ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight', 'contentWidth', 'contentScrollWidth', 'documentWidth', 'viewportWidth'].every(key => Number.isFinite(row[key])) && row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(pinning.keyboardLayouts) || pinning.keyboardLayouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => pinning.keyboardLayouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !pinning.keyboardLayouts.every(row => ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight', 'outline'].every(key => Number.isFinite(row[key])) && row.label === '固定工作树' && row.outline > 0 && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(pinning.screenshots) || pinning.screenshots.length !== 21 || new Set(pinning.screenshots).size !== 21 || !pinning.screenshots.every(name => typeof name === 'string' && /^worktree-pinning-[a-z0-9-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree pinning verification is required');
  }
  if (ownership?.checks !== 5 || ownership.modelRequests !== 0 || !['externalNonAdoptionVerified', 'newBranchReceiptVerified', 'existingBranchReceiptVerified', 'atomicFailureRetentionVerified', 'normalRestartVerified', 'backupSeparationVerified', 'sourcePreservationVerified', 'keyboardWarningLayoutsVerified'].every(key => ownership[key] === true)
    || !Array.isArray(ownership.layouts) || ownership.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => ownership.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !ownership.layouts.every(({ bounds: row, focus }) => row && focus && Object.values(row).every(Number.isFinite) && ['left', 'right', 'top', 'bottom', 'width', 'height', 'outlineWidth'].every(key => Number.isFinite(focus[key])) && row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left && focus.outlineWidth > 0 && focus.outline !== 'none' && focus.width > 0 && focus.height > 0 && focus.left >= 0 && focus.top >= 0 && focus.right <= focus.width && focus.bottom <= focus.height && focus.bottom > focus.top && focus.right > focus.left)
    || !Array.isArray(ownership.screenshots) || ownership.screenshots.length !== 10 || new Set(ownership.screenshots).size !== 10 || !ownership.screenshots.every(name => typeof name === 'string' && /^worktree-ownership-[a-z0-9-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree ownership verification is required');
  }
  if (registration?.checks !== 5 || registration.modelRequests !== 0 || !['inlineValidationCancelVerified', 'actualFailureSameIdRetryVerified', 'duplicatePreservationVerified', 'staleSourceVerified', 'backupRestartVerified', 'referenceZoomKeyboardVerified', 'sourcePreservationVerified'].every(key => registration[key] === true)
    || !Array.isArray(registration.layouts) || registration.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => registration.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !registration.layouts.every(row => row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(registration.keyboardLayouts) || registration.keyboardLayouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => registration.keyboardLayouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !registration.keyboardLayouts.every(row => row.label === '登记项目' && row.outline > 0 && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(registration.screenshots) || registration.screenshots.length !== 19 || new Set(registration.screenshots).size !== 19 || !registration.screenshots.every(name => typeof name === 'string' && /^worktree-registration-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree registration verification is required');
  }
  if (upstream?.checks !== 5 || upstream.modelRequests !== 0 || !['preferenceFailureRetryVerified', 'actualFetchPinnedCommitVerified', 'neverAndMissingUpstreamVerified', 'actualFailureRetryVerified', 'backupRestartVerified', 'referenceZoomKeyboardVerified', 'sourcePreservationVerified'].every(key => upstream[key] === true)
    || !Array.isArray(upstream.layouts) || upstream.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => upstream.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !upstream.layouts.every(row => row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(upstream.keyboardLayouts) || upstream.keyboardLayouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => upstream.keyboardLayouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !upstream.keyboardLayouts.every(row => row.outline > 0 && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(upstream.screenshots) || upstream.screenshots.length !== 20 || new Set(upstream.screenshots).size !== 20 || !upstream.screenshots.every(name => typeof name === 'string' && /^worktree-upstream-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree upstream verification is required');
  }
  if (conversations?.checks !== 4 || conversations.modelRequests !== 0 || !['linkedConversationVerified', 'projectDraftVerified', 'heldFailureRetryRestartVerified', 'staleTargetsVerified', 'sanitizedErrorsVerified', 'referenceZoomKeyboardVerified', 'sourcePreservationVerified'].every(key => conversations[key] === true)
    || !Array.isArray(conversations.layouts) || conversations.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => conversations.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !conversations.layouts.every(row => row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(conversations.keyboardLayouts) || conversations.keyboardLayouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => conversations.keyboardLayouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !conversations.keyboardLayouts.every(row => row.label === '新建项目聊天' && row.outline > 0 && row.top - row.outline >= row.viewportTop && row.bottom + row.outline <= row.viewportBottom && row.left - row.outline >= row.viewportLeft && row.right + row.outline <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(conversations.screenshots) || conversations.screenshots.length !== 19 || new Set(conversations.screenshots).size !== 19 || !conversations.screenshots.every(name => typeof name === 'string' && /^worktree-conversations-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree conversation verification is required');
  }
  const overviewOriginals = ['associations-light', 'refresh-light', 'refresh-keyboard-success', 'refresh-keyboard-other-control', 'error-light', 'loading-light', 'retry-light', 'partial-results', 'partial-error', 'management-loading', 'page-two-light',
    ...['light', 'dark'].flatMap(theme => [100, 125, 150].flatMap(zoom => ['pending', 'refresh-keyboard', 'error', 'rows'].map(state => `${theme}-${zoom}-${state}`)))
  ].map(name => `worktree-overview-${name}-shell.png`);
  if (overview?.checks !== 6 || overview.modelRequests !== 0 || !['actualRepositoryAssociationVerified', 'refreshReadOnlyVerified', 'progressiveProjectResultsVerified', 'progressiveSanitizedErrorsVerified', 'managementLoadingProtectionVerified', 'refreshKeyboardFocusVerified', 'refreshDoesNotStealFocusVerified', 'errorRetryCloseVerified', 'boundedPagingVerified', 'referenceZoomKeyboardVerified', 'sourcePreservationVerified'].every(key => overview[key] === true)
    || !Array.isArray(overview.queryPages) || overview.queryPages.length !== 3 || !overview.queryPages.every((ids, index) => Array.isArray(ids) && ids.length === (index === 1 ? 1 : 20) && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && id.length > 0))
    || overview.queryPages[0].some((id, index) => id !== overview.queryPages[2][index]) || overview.queryPages[0].includes(overview.queryPages[1][0])
    || !Array.isArray(overview.layouts) || overview.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => overview.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !overview.layouts.every(row => row.contentWidth > 0 && row.contentScrollWidth <= row.contentWidth && row.viewportWidth > 0 && row.documentWidth <= row.viewportWidth && row.error?.top >= row.error.viewportTop && row.error.bottom <= row.error.viewportBottom && row.error.left >= row.error.viewportLeft && row.error.right <= row.error.viewportRight && row.error.bottom > row.error.top && row.error.right > row.error.left)
    || !overview.layouts.every(row => row.pending && ['top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight'].every(key => Number.isFinite(row.pending[key])) && row.pending.top >= row.pending.viewportTop && row.pending.bottom <= row.pending.viewportBottom && row.pending.left >= row.pending.viewportLeft && row.pending.right <= row.pending.viewportRight && row.pending.bottom > row.pending.top && row.pending.right > row.pending.left)
    || !Array.isArray(overview.refreshKeyboardLayouts) || overview.refreshKeyboardLayouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => overview.refreshKeyboardLayouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !overview.refreshKeyboardLayouts.every(row => row.focused === true && row.focusVisible === true && Math.abs(row.outline - Math.floor(2 * row.zoom) / row.zoom) < 0.001 && Math.abs(row.outlineOffset - Math.floor(2 * row.zoom) / row.zoom) < 0.001 && row.outlineColor === (row.theme === 'dark' ? 'rgb(2, 133, 255)' : 'rgb(1, 105, 204)') && ['outline', 'outlineOffset', 'top', 'bottom', 'left', 'right', 'viewportTop', 'viewportBottom', 'viewportLeft', 'viewportRight'].every(key => Number.isFinite(row[key])) && row.top - row.outline - row.outlineOffset >= row.viewportTop && row.bottom + row.outline + row.outlineOffset <= row.viewportBottom && row.left - row.outline - row.outlineOffset >= row.viewportLeft && row.right + row.outline + row.outlineOffset <= row.viewportRight && row.bottom > row.top && row.right > row.left)
    || !Array.isArray(overview.screenshots) || overview.screenshots.length !== 35 || new Set(overview.screenshots).size !== 35 || !overviewOriginals.every(name => overview.screenshots.includes(name))) {
    throw new Error('Complete worktree overview verification is required');
  }
  if (roots?.checks !== 10 || roots.modelRequests !== 0 || roots.pickerCases !== 5 || !['rootValidationVerified', 'busySaveVerified', 'saveFailurePreservationVerified', 'rootCreationVerified', 'backupRestartVerified', 'referenceZoomKeyboardVerified', 'directoryPickerVerified', 'defaultRootVerified', 'defaultRootFailureVerified', 'defaultRootBackupRestartVerified'].every(key => roots[key] === true)
    || !Array.isArray(roots.layouts) || roots.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => roots.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !roots.layouts.every(row => row.width > 0 && row.width <= 288 && row.left >= 0 && row.right <= row.viewportWidth && row.headingMargin === '8px' && row.descriptionSize === '12px')
    || !roots.layouts.every(row => row.pickerLeft >= row.contentLeft && row.pickerRight <= row.contentRight && row.pickerTop >= row.contentTop && row.pickerBottom <= row.contentBottom && row.pickerRight > row.pickerLeft && row.pickerBottom > row.pickerTop)
    || !Array.isArray(roots.errorLayouts) || roots.errorLayouts.length !== 7 || !roots.errorLayouts.every(row => row?.top >= row.viewportTop && row.bottom <= row.viewportBottom && row.left >= row.viewportLeft && row.right <= row.viewportRight && row.bottom > row.top && row.right > row.left && row.text === '本地数据未能保存。请检查磁盘空间和文件夹权限，再重试。')
    || !Array.isArray(roots.screenshots) || roots.screenshots.length !== 20 || new Set(roots.screenshots).size !== 20 || !roots.screenshots.every(name => typeof name === 'string' && /^worktree-settings-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete worktree root settings verification is required');
  }
  const worktrees = desktop.projectWorktrees;
  if (worktrees?.checks !== 7 || worktrees.modelRequests !== 0 || !['bridgeValidationVerified', 'creationBusySourcePreservationVerified', 'registrationRetryVerified', 'existingBranchReuseVerified', 'hookSourcePreviewVerified', 'referenceZoomKeyboardVerified', 'restartDraftsVerified'].every(key => worktrees[key] === true)
    || worktrees.rowLayout?.gap !== '8px' || worktrees.rowLayout.padding !== '12px' || worktrees.rowLayout.titleSize !== '14px' || worktrees.rowLayout.titleWeight !== '500' || worktrees.rowLayout.pathSize !== '12px'
    || !Array.isArray(worktrees.layouts) || worktrees.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => worktrees.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !worktrees.layouts.every(row => row.overflow === false && row.fieldPadding === '8px 12px 0px' && row.fieldGap === '4px' && row.fieldBackground === 'rgba(0, 0, 0, 0)' && row.viewport?.width > 0 && row.viewport?.height > 0 && row.dialog?.left >= 0 && row.dialog?.top >= 0 && row.dialog?.right <= row.viewport.width && row.dialog?.bottom <= row.viewport.height && row.dialog.width > 0 && row.dialog.height > 0 && Array.isArray(row.controls) && row.controls.length >= 3 && row.controls.every(control => control?.visible === true && control.contentFits === true && control.width > 0 && control.height >= 20)
      && Array.isArray(row.fields) && row.fields.length === 3 && ['工作树分支', '起始版本', '工作树文件夹'].every(label => row.fields.filter(field => field?.label === label && field.reachable === true && field.control?.top >= field.content?.top && field.control.bottom <= field.content.bottom && field.control.left >= 0 && field.control.right <= field.viewport?.width && field.control.width > 0 && field.control.height >= 20).length === 1))
    || !Array.isArray(worktrees.screenshots) || worktrees.screenshots.length !== 12 || new Set(worktrees.screenshots).size !== 12 || !worktrees.screenshots.every(name => typeof name === 'string' && /^project-worktrees-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete project worktree verification is required');
  }
  if (!context || context.checks !== 6 || context.requestCount !== 10 || context.summaryRequests !== 3 || context.originalMessages !== 6 || context.finalMessages !== 14
    || !['readonlyPreviewVerified', 'actualContextRequestsVerified', 'cancellationFailureVerified', 'expiredFullContextVerified', 'restartHistoryVerified', 'restrictedQuickChatVerified'].every(key => context[key] === true)
    || !Array.isArray(context.layouts) || context.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => context.layouts.filter(row => row?.theme === theme && row.zoom === zoom && row.contained === true && row.horizontalOverflow === false && row.nativeSize?.[0] === 760 && row.nativeSize?.[1] === 620).length === 1))
    || !Array.isArray(context.screenshots) || context.screenshots.length !== 9 || new Set(context.screenshots).size !== 9 || !context.screenshots.every(name => typeof name === 'string' && /^context-summary-[A-Za-z0-9.-]+\.png$/.test(name))) {
    throw new Error('Complete context summary verification is required');
  }
  const completeTabFocus = (focus, kind, theme, zoom) => focus?.kind === kind && focus.focused === true && focus.focusVisible === true && focus.outlineStyle === 'solid'
    && focus.outlineColor === (theme === 'light' ? 'rgb(1, 105, 204)' : 'rgb(2, 133, 255)')
    && [focus.outlineWidth, focus.outlineOffset, ...['ring', 'viewport'].flatMap(key => ['left', 'right', 'top', 'bottom'].map(edge => focus[key]?.[edge]))].every(value => typeof value === 'number' && Number.isFinite(value))
    && Math.abs(focus.outlineWidth - Math.floor(2 * zoom) / zoom) < .001 && Math.abs(focus.outlineOffset + Math.floor(2 * zoom) / zoom) < .001
    && focus.ring.left < focus.ring.right && focus.ring.top < focus.ring.bottom && focus.viewport.left < focus.viewport.right && focus.viewport.top < focus.viewport.bottom
    && focus.ring.left >= focus.viewport.left - .001 && focus.ring.right <= focus.viewport.right + .001 && focus.ring.top >= focus.viewport.top - .001 && focus.ring.bottom <= focus.viewport.bottom + .001;
  const editorTabImages = ['editor-tabs-initial.png', 'editor-tabs-close-cancel.png', 'editor-tabs-save-failure.png', ...['light', 'dark'].flatMap(theme => [100, 125, 150].flatMap(zoom => [`editor-tabs-${theme}-${zoom}.png`, `editor-tabs-close-focus-${theme}-${zoom}.png`]))];
  const completeEditorTabs = result => result && ['selectedVisibilityVerified', 'keyboardNavigationVerified', 'focusOutlinesVerified', 'dirtyCancelVerified', 'cleanCloseFocusVerified', 'saveFailureRetryVerified', 'originalDraftsRetained'].every(key => result[key] === true)
    && Array.isArray(result.layouts) && result.layouts.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => result.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    && result.layouts.every(row => row.selectedVisible === true && row.overflow === false && typeof row.compact === 'boolean' && Array.isArray(row.actions) && row.actions.length === 3 && ['并排预览', '预览 HTML', '保存 Ctrl S'].every(name => row.actions.filter(action => action?.name === name && action.visible === true && action.width >= 24 && action.height >= 24 && (!row.compact || (action.width === 24 && action.height === 24))).length === 1))
    && result.layouts.every(row => Array.isArray(row.focus) && row.focus.length === 2 && ['tab', 'close'].every(kind => row.focus.filter(focus => completeTabFocus(focus, kind, row.theme, row.zoom)).length === 1))
    && Array.isArray(result.screenshots) && result.screenshots.length === editorTabImages.length && new Set(result.screenshots).size === editorTabImages.length && editorTabImages.every(name => result.screenshots.includes(name));
  const completePreview = result => result?.checks === 10 && result.outsideHttpRequests === 0 && result.docked?.checks === 5 && ["floatingTransferVerified", "projectRemovalVerified", "workbenchReloadVerified", "staleOwnerCloseVerified"].every(key => result.docked[key] === true) && completeEditorTabs(result.editorTabs);
  const browser = desktop.browser;
  const toolActivities = desktop.toolActivities;
  if (toolActivities?.checks !== 8 || toolActivities.commandRequests !== 5 || !['scopedClipboardPermission', 'exactOriginalCopy', 'staleClipboardGuard', 'deniedCopyRetry', 'focusBeforeInert', 'manualStreamingCollapse', 'restrictedQuickChat', 'reducedMotion', 'actualRestart'].every(key => toolActivities[key] === true)
    || !Array.isArray(toolActivities.nativeStates) || toolActivities.nativeStates.length !== 5 || new Set(toolActivities.nativeStates).size !== 5 || !['waiting', 'running', 'complete', 'error', 'stopped'].every(status => toolActivities.nativeStates.includes(status))
    || !Array.isArray(toolActivities.layouts) || toolActivities.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => toolActivities.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !toolActivities.layouts.every(row => row.fontSize === row.parentFontSize && parseFloat(row.fontSize) > 0 && row.gap === '4px' && row.padding === '8px 0px 4px 24px' && row.duration === '0.3s, 0.3s' && row.contained === true && row.controlVisible === true && row.summaryWidth >= 16 && row.controlHeight >= 20 && row.outputScrollBounded === true && row.horizontalOverflow === false)
    || !Array.isArray(toolActivities.screenshots) || toolActivities.screenshots.length !== 9 || new Set(toolActivities.screenshots.map(row => row?.filename)).size !== 9 || !toolActivities.screenshots.every(row => typeof row?.filename === 'string' && /^tool-activities-[A-Za-z0-9.-]+\.png$/.test(row.filename) && Array.isArray(row.size) && row.size.length === 2 && row.size.every(value => Number.isInteger(value) && value > 0))) {
    throw new Error('Complete tool activity verification is required');
  }
  const projectBranches = desktop.projectBranches;
  if (projectBranches?.checks !== 11 || projectBranches.modelRequests !== 0 || !['localListSearchVerified', 'creationValidationBusyVerified', 'overwriteRetryVerified', 'editorRefreshDraftConflictVerified', 'worktreeProjectScopeVerified', 'hookStatePreviewCleanupVerified', 'referenceZoomKeyboardVerified', 'restartDraftsVerified'].every(key => projectBranches[key] === true)
    || !Array.isArray(projectBranches.layouts) || projectBranches.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => projectBranches.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !projectBranches.layouts.every(row => row.overflow === false && row.fieldPadding === '8px 12px 0px' && row.fieldGap === '4px' && row.fieldBackground === 'rgba(0, 0, 0, 0)' && row.viewport?.width > 0 && row.viewport?.height > 0 && row.dialog?.left >= 0 && row.dialog?.top >= 0 && row.dialog?.right <= row.viewport.width && row.dialog?.bottom <= row.viewport.height && row.dialog.width > 0 && row.dialog.height > 0 && Array.isArray(row.controls) && row.controls.length >= 6 && row.controls.every(control => control?.visible === true && control.contentFits === true && control.width > 0 && control.height >= 20))
    || projectBranches.actions?.checks !== 3 || !['renameStateVerified', 'deleteCancelMergedOnlyVerified', 'unmergedWorktreeProjectGuardsVerified'].every(key => projectBranches.actions[key] === true)
    || !Array.isArray(projectBranches.actionLayouts) || projectBranches.actionLayouts.length !== 18 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => ['list', 'rename', 'delete'].every(mode => projectBranches.actionLayouts.filter(row => row?.theme === theme && row.zoom === zoom && row.mode === mode).length === 1)))
    || !projectBranches.actionLayouts.every(row => row.overflow === false && row.namesVisible === true && row.viewport?.width > 0 && row.viewport?.height > 0 && row.dialog?.left >= 0 && row.dialog?.top >= 0 && row.dialog?.right <= row.viewport.width && row.dialog?.bottom <= row.viewport.height && row.dialog.width > 0 && row.dialog.height > 0 && Array.isArray(row.controls) && row.controls.length >= 6 && row.controls.every(control => control?.visible === true && control.contentFits === true && control.width > 0 && control.height >= 20 && Number.isFinite(control.renderedHeight) && control.renderedHeight > 0))
    || !Array.isArray(projectBranches.screenshots) || projectBranches.screenshots.length !== 34 || new Set(projectBranches.screenshots).size !== 34 || !projectBranches.screenshots.every(name => typeof name === 'string' && /^project-branches-[A-Za-z0-9.-]+-shell\.png$/.test(name))) {
    throw new Error('Complete project branch verification is required');
  }
  const tabs = browser?.tabs;
  if (tabs?.checks !== 5 || !['independentHistoryDraftsVerified', 'sharedTransientSessionVerified', 'selectedViewOnlyVerified', 'backgroundFailureCloseVerified', 'nativeShortcutsVerified', 'lastCloseFreshVerified', 'workbenchReloadAllTabsVerified'].every(key => tabs[key] === true)
    || !Array.isArray(tabs.layouts) || tabs.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => tabs.layouts.filter(row => row?.theme === theme && row.zoom === zoom).length === 1))
    || !tabs.layouts.every(row => row.selectedVisible === true && row.addVisible === true && row.addWidth === 24 && row.addHeight === 24 && row.overflow === false && row.tabCount === 3 && row.panelLinked === true && row.expected && row.native && ['x', 'y', 'width', 'height'].every(key => Number.isInteger(row.native[key]) && row.native[key] === row.expected[key]) && row.native.x >= 0 && row.native.y >= 0 && row.native.width > 0 && row.native.height > 0)
    || !Array.isArray(tabs.screenshots) || tabs.screenshots.length !== 16 || new Set(tabs.screenshots).size !== 16 || !tabs.screenshots.every(name => typeof name === 'string' && /^browser-tabs-[A-Za-z0-9.-]+\.png$/.test(name))) {
    throw new Error('Complete private browser tabs verification is required');
  }
  if (browser?.checks !== 14 || browser.modelRequests !== 0 || !browser.isolation || !['sandbox', 'contextIsolation', 'privateSession'].every(key => browser.isolation[key] === true) || browser.isolation.nodeIntegration !== false || browser.isolation.preload !== false || !['nativeHistoryVerified', 'pendingAddressStopVerified', 'sameUrlRedirectVerified', 'unsubmittedAddressRetained', 'popupPrivateNavigationDenied', 'failureRetryVerified', 'keyboardFocusVerified', 'draftRetained', 'modalOcclusionVerified', 'privateRestartVerified', 'workbenchReloadVerified', 'staleOwnerCloseVerified'].every(key => browser[key] === true) || !Array.isArray(browser.layouts) || browser.layouts.length !== 6 || !['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => browser.layouts.filter(row => row.theme === theme && row.zoom === zoom).length === 1)) || !browser.layouts.every(row => row.navigation?.selectedVisible === true && row.navigation?.current === 'page' && row.native && row.expected && row.native.width > 0 && row.native.height > 0 && row.native.x >= 0 && row.native.y >= 0 && row.viewport?.width > 150 && row.viewport?.height > 100 && row.native?.x === row.expected?.x && row.native?.y === row.expected?.y && row.native?.width === row.expected.right - row.expected.x && row.native?.height === row.expected.bottom - row.expected.y) || !Array.isArray(browser.screenshots) || browser.screenshots.length !== 15 || new Set(browser.screenshots).size !== 15 || !browser.screenshots.every(name => typeof name === 'string' && /^browser-[A-Za-z0-9.-]+\.png$/.test(name))) {
    throw new Error('Complete private browser verification is required');
  }
  if (!completePreview(preview)) throw new Error('Complete offline project-preview verification is required');
  const memories = desktop.memories;
  const memoryLayouts = memories?.deletionLayouts;
  const memoryCases = Array.isArray(memoryLayouts) && memoryLayouts.length === 6 && new Set(memoryLayouts.map(row => `${row.theme}/${row.zoom}`)).size === 6
    && memoryLayouts.every(row => ['light', 'dark'].includes(row.theme) && [1, 1.25, 1.5].includes(row.zoom) && row.contained === true && row.bounded === true && row.buttonsVisible === true && row.cancelFocused === true && row.closeControls === 1 && row.radius === '20px' && row.bodyPadding === '20px' && row.footerPadding === '20px' && row.heading?.size === '20px' && row.heading?.lineHeight === '28px' && row.heading?.weight === '600' && row.heading?.spacing === 'normal' && Number.isFinite(row.top) && Number.isFinite(row.expectedTop) && row.expectedTop > 0 && Math.abs(row.top - row.expectedTop) < 1 && row.backdropBlur === 'blur(24px)' && row.borderWidth === '0px' && row.overlayBlur === 'none' && row.closeWidth === 32 && row.closeHeight === 32 && Array.isArray(row.surfaceRgba) && JSON.stringify(row.surfaceRgba) === JSON.stringify(row.theme === 'light' ? [255, 255, 255, 230] : [24, 24, 24, 230]) && JSON.stringify(row.overlayRgba) === '[0,0,0,34]' && typeof row.shadow === 'string' && row.shadow.includes('0px 0px 0px 0.5px') && row.shadow.includes('0px 4px 8px -2px') && Number.isFinite(row.width) && Number.isFinite(row.expectedWidth) && row.expectedWidth > 0 && row.expectedWidth <= 520 && Math.abs(row.width - row.expectedWidth) < 1 && row.longContentEscaped === true && row.independentScrollVerified === true);
  const memoryShots = ['memory-settings-light.png', 'memory-settings-dark.png', 'memory-delete-pending-shell.png', 'memory-delete-failure-shell.png', ...['light', 'dark'].flatMap(theme => [1, 1.25, 1.5].flatMap(zoom => ['short', 'long', 'scrolled'].map(state => `memory-delete-${theme}-${zoom}-${state}-shell.png`)))];
  if (memories?.checks !== 5 || !memoryCases || ['safeCancelVerified', 'deleteFailureRetentionVerified', 'pendingDismissalLocked', 'longDeleteContentVerified', 'defaultSurfaceVerified'].some(flag => memories[flag] !== true) || !Array.isArray(memories.screenshots) || memories.screenshots.length !== 22 || new Set(memories.screenshots).size !== 22 || !memoryShots.every(name => memories.screenshots.includes(name))) throw new Error('Complete memory verification is required');
  const pdf = desktop.pdfPreview;
  if (pdf?.checks !== 6 || !['canvasTextVerified', 'outlineTargetsVerified', 'fullDocumentSearchVerified', 'linksNotesZoomVerified', 'exportOwnershipRestartVerified'].every(key => pdf[key] === true)) {
    throw new Error('Complete PDF preview verification is required');
  }
  const originals = desktop.attachments?.pdfOriginal;
  const pdfProtocols = ['responses', 'openai', 'anthropic', 'gemini', 'ollama', 'azure-responses', 'azure-chat', 'azure-deployment'];
  if (!originals || !Array.isArray(originals.textOnlyProtocols) || originals.textOnlyProtocols.length !== pdfProtocols.length || !pdfProtocols.every(protocol => originals.textOnlyProtocols.includes(protocol)) || !['restartBytesVerified', 'deduplicatedBackupVerified', 'missingFileRestoredVerified'].every(key => originals[key] === true)) {
    throw new Error('Complete PDF original transport and backup verification is required');
  }
  if (!completePreview(desktop.projectPreview)) throw new Error('Complete desktop must include offline project-preview verification');
  const subscriptions = desktop.mcpResourceSubscriptions;
  if (!subscriptions || subscriptions.checks !== 6 || subscriptions.modelRequests !== 0 || !['realNotificationsVerified', 'explicitDraftInsertionVerified', 'delayedUnsubscribeFiltered', 'templateSelectionVerified', 'disconnectRestartVerified', 'unsupportedServerVerified', 'zoomKeyboardVerified', 'originalDraftRetained'].every((key) => subscriptions[key] === true)) {
    throw new Error('Complete MCP resource-subscription verification is required');
  }
  const binary = desktop.mcpBinaryFiles;
  if (!binary || binary.checks !== 6 || binary.binaryModelRequests !== 0 || !['realWorkerPreviewVerified', 'exactOriginalExportVerified', 'emptyAndUnsupportedExportVerified', 'promptBinaryTextOnlyVerified', 'staleSelectionVerified', 'zoomKeyboardVerified', 'restartDraftRetainedVerified'].every((key) => binary[key] === true)) {
    throw new Error('Complete MCP binary-file verification is required');
  }
  const mcpPdf = desktop.mcpPdf;
  const completePdfLayout = Array.isArray(mcpPdf?.layout) && mcpPdf.layout.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => mcpPdf.layout.some(row => row?.theme === theme && row.zoom === zoom && row.controlsVisible === true && row.overflow === false)));
  if (!mcpPdf || mcpPdf.checks !== 8 || mcpPdf.explicitModelRequests !== 1 || mcpPdf.previewPersisted !== false || !/^[a-f0-9]{64}$/.test(mcpPdf.originalSha256 ?? '') || !completePdfLayout || !['exactOriginalVerified', 'promptPdfVerified', 'textOnlyModelTransportVerified', 'staleSubscriptionVerified', 'filesystemRetryVerified', 'restartVerified', 'backupRestoreVerified', 'restoreCompletionVerified'].every(key => mcpPdf[key] === true)) {
    throw new Error('Complete MCP PDF attachment verification is required');
  }
  const recipes = desktop.assistantRecipes;
  const quickChat = desktop.quickChat;
  const quickLayout = Array.isArray(quickChat?.layout) && quickChat.layout.length === 6 && ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => quickChat.layout.some(row => row?.theme === theme && row.zoom === zoom && row.controlsVisible === true && row.overflow === false)));
  const quickMinimum = Array.isArray(quickChat?.minimumLayout) && quickChat.minimumLayout.length === 18 && ['empty', 'attachment-long-input', 'conversation'].every(state => ['light', 'dark'].every(theme => [1, 1.25, 1.5].every(zoom => quickChat.minimumLayout.some(row => row?.state === state && row.theme === theme && row.zoom === zoom && row.nativeSize?.length === 2 && row.nativeSize[0] === 420 && row.nativeSize[1] === 360 && row.controlsVisible === true && row.overflow === false && row.toolsKeyboardVerified === true))));
  if (quickChat?.refreshRaceVerified !== true || quickChat?.minimumErrorVerified !== true) throw new Error('Complete independent quick-chat refresh and minimum-window error verification is required');
  if (!quickChat || quickChat.checks !== 9 || quickChat.quickModelRequests !== 3 || quickChat.mainFixtureRequests !== 1 || !/^[a-f0-9]{64}$/.test(quickChat.originalSha256 ?? '') || !quickLayout || !quickMinimum || !['independentDraftsVerified', 'restrictedBridgeVerified', 'exactOriginalVerified', 'textOnlyTransportVerified', 'stopOwnerVerified', 'approvalScopeVerified', 'handoffVerified', 'windowStateVerified', 'shortcutTargetVerified', 'filesystemRetryVerified', 'backupRestartVerified', 'staleRevisionVerified'].every(key => quickChat[key] === true)) {
    throw new Error('Complete independent quick-chat verification is required');
  }
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
