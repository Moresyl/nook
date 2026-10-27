[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$taskSetup = Join-Path $taskRoot "artifacts/Nook-Setup-$taskVersion-x64.exe"
$taskScratchRoot = if ($env:QIYAO_INSTALLER_AUDIT_ROOT) { [IO.Path]::GetFullPath($env:QIYAO_INSTALLER_AUDIT_ROOT) } else { [Environment]::GetFolderPath('LocalApplicationData') }
if (-not (Test-Path -LiteralPath $taskScratchRoot -PathType Container)) { throw 'The installer audit root must be an existing directory.' }
$taskScratch = Join-Path $taskScratchRoot ('NookInstallerAudit-' + [Guid]::NewGuid().ToString('N'))
$taskInstall = Join-Path $taskScratch '安装 Nook'
$taskRegistryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Get-NookRegistration {
  @($taskRegistryRoots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ } | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -match '^(?:Nook|Qiyao)(?:\s|$)' })
}
$taskLinks = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nook.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Nook.lnk'))
$taskProfiles = @('Nook', 'nook-workspace', 'Qiyao', 'qiyao-workspace') | ForEach-Object { Join-Path ([Environment]::GetFolderPath('ApplicationData')) $_ }
if (@(Get-NookRegistration).Count -ne 0 -or @($taskLinks + $taskProfiles | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0) { throw 'Existing Nook installation, shortcuts and user profiles must be preserved.' }
if (-not (Test-Path -LiteralPath $taskSetup) -or (Test-Path -LiteralPath $taskScratch)) { throw 'Expected a built installer and a new isolated target.' }
$taskNonce = [Guid]::NewGuid().ToString('N')
$taskSentinels = @()
$taskRegistered = $false
$taskPassed = $false
New-Item -ItemType Directory -Path $taskScratch > $null
try {
  foreach ($taskProfile in $taskProfiles) {
    New-Item -ItemType Directory -Path $taskProfile > $null
    $taskSentinel = Join-Path $taskProfile "installer-retention-$taskNonce.txt"
    [IO.File]::WriteAllText($taskSentinel, $taskNonce, [Text.UTF8Encoding]::new($false))
    $taskSentinels += $taskSentinel
  }
  # NSIS requires /D last and unquoted, including paths with spaces.
  $taskProcess = Start-Process -FilePath $taskSetup -ArgumentList "/S /currentuser /D=$taskInstall" -WindowStyle Hidden -PassThru -Wait
  if ($taskProcess.ExitCode -ne 0) { throw 'The isolated current-user installer failed.' }
  $taskEntries = @(Get-NookRegistration)
  $taskExpectedUninstall = '"' + (Join-Path $taskInstall 'Uninstall Nook.exe') + '" /currentuser'
  if ($taskEntries.Count -ne 1 -or $taskEntries[0].PSPath -notmatch 'HKEY_CURRENT_USER' -or $taskEntries[0].UninstallString -ne $taskExpectedUninstall -or $taskEntries[0].Publisher -ne 'Nook' -or $taskEntries[0].DisplayVersion -ne $taskVersion) { throw 'Unexpected installation registration, version or scope.' }
  $taskRegistered = $true
  $env:QIYAO_AUDIT_DIRECTORY = $taskInstall
  Remove-Item Env:QIYAO_AUDIT_KIND -ErrorAction SilentlyContinue
  node scripts/verify-package.mjs --installer
  if ($LASTEXITCODE -ne 0) { throw 'Installed-package audit failed.' }
  $env:QIYAO_INSTALLED_SHORTCUTS = ConvertTo-Json -InputObject $taskLinks -Compress
  node scripts/verify-shell-integration.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installed shortcut audit failed.' }
  Get-ChildItem Env: | Where-Object { $_.Name -like 'QIYAO_TEST_*_ONLY' -or $_.Name -like 'NOOK_TEST_*_ONLY' } | Remove-Item
  Remove-Item Env:QIYAO_TEST_WORKSPACE_SEED -ErrorAction SilentlyContinue
  $env:QIYAO_TEST_EXECUTABLE = Join-Path $taskInstall 'Nook.exe'
  pnpm test:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Installed desktop verification failed.' }
  $taskDesktop = Get-Content verification/packaged-result.json -Raw | ConvertFrom-Json
  $taskAudit = Get-Content verification/package-audit-result.json -Raw | ConvertFrom-Json
  $taskInstalledAudit = Get-Content verification/installed-package-audit-result.json -Raw | ConvertFrom-Json
  if (-not $taskDesktop.normalCloseVerified -or $taskDesktop.runtimeErrors.Count -ne 0 -or $taskDesktop.checks -lt 337 -or $taskDesktop.memories.checks -ne 5 -or $taskDesktop.projectPreview.checks -ne 10 -or $taskDesktop.projectPreview.outsideHttpRequests -ne 0 -or $taskDesktop.projectPreview.docked.checks -ne 5 -or -not $taskDesktop.projectPreview.docked.floatingTransferVerified -or -not $taskDesktop.projectPreview.docked.projectRemovalVerified -or -not $taskDesktop.projectPreview.docked.workbenchReloadVerified -or -not $taskDesktop.projectPreview.docked.staleOwnerCloseVerified -or $taskDesktop.projectBranches.checks -ne 11 -or $taskDesktop.toolActivities.checks -ne 8 -or $taskDesktop.executableSha256 -ne $taskAudit.executableSha256 -or $taskDesktop.archiveSha256 -ne $taskAudit.archiveSha256 -or $taskInstalledAudit.executableSha256 -ne $taskAudit.executableSha256 -or $taskInstalledAudit.archiveSha256 -ne $taskAudit.archiveSha256) { throw 'Installed runtime must normally close and match the built application.' }
  $taskWorktrees = $taskDesktop.projectWorktrees
  if ($taskDesktop.checks -lt 412) { throw 'Installed runtime must include all current sidebar-pagination, project-tree and complete desktop checks.' }
  $taskMemory = $taskDesktop.memories
  if (-not $taskMemory.safeCancelVerified -or -not $taskMemory.deleteFailureRetentionVerified -or -not $taskMemory.pendingDismissalLocked -or -not $taskMemory.longDeleteContentVerified -or -not $taskMemory.defaultSurfaceVerified -or $taskMemory.deletionLayouts.Count -ne 6 -or $taskMemory.screenshots.Count -ne 22 -or @($taskMemory.screenshots | Sort-Object -Unique).Count -ne 22) { throw 'Installed runtime must include safe, failure-retaining memory deletion and six native long-content layouts.' }
  node --input-type=module -e 'import {readFileSync} from "node:fs"; import {verifyComposerActionsProof, verifySettingsSearchProof, verifyTaskPlanProof, verifyNavigationProof} from "./scripts/release-policy.mjs"; const proof = JSON.parse(readFileSync(process.argv[1], "utf8")); verifyComposerActionsProof(proof.composerActions); verifySettingsSearchProof(proof.settingsSearch); verifyTaskPlanProof(proof.taskPlans); verifyNavigationProof(proof);' verification/packaged-result.json
  if ($LASTEXITCODE -ne 0) { throw 'Installed runtime must verify task-plan preservation, composer actions, settings keyboard navigation and drafts, six sidebar pagination layouts, and complete project-tree virtualization and menus.' }
  $taskRoots = $taskDesktop.worktreeSettings
  if ($taskDesktop.checks -lt 337 -or $taskRoots.checks -ne 10 -or $taskRoots.modelRequests -ne 0 -or $taskRoots.pickerCases -ne 5 -or -not $taskRoots.directoryPickerVerified -or -not $taskRoots.defaultRootVerified -or -not $taskRoots.defaultRootFailureVerified -or -not $taskRoots.defaultRootBackupRestartVerified -or -not $taskRoots.rootValidationVerified -or -not $taskRoots.busySaveVerified -or -not $taskRoots.saveFailurePreservationVerified -or -not $taskRoots.rootCreationVerified -or -not $taskRoots.backupRestartVerified -or -not $taskRoots.referenceZoomKeyboardVerified) { throw 'Installed runtime must verify owned directory selection, default root preparation and failure preservation, root validation, busy-save locking, actual Git creation, backup restoration and restart.' }
  $taskOverview = $taskDesktop.worktreeOverview
  $taskConversations = $taskDesktop.worktreeConversations
  $taskUpstream = $taskDesktop.worktreeUpstream
  $taskRegistration = $taskDesktop.worktreeRegistration
  $taskOwnership = $taskDesktop.worktreeOwnership
  $taskPinning = $taskDesktop.worktreePinning
  $taskSnapshots = $taskDesktop.worktreeSnapshots
  if ($taskDesktop.checks -lt 355) { throw 'Installed runtime must include all ten cleanup checks in the complete desktop suite.' }
  node --input-type=module -e 'import {readFileSync} from "node:fs"; import {verifyWorktreeCleanupProof} from "./scripts/release-policy.mjs"; verifyWorktreeCleanupProof(JSON.parse(readFileSync(process.argv[1], "utf8")).worktreeCleanup);' verification/packaged-result.json
  if ($LASTEXITCODE -ne 0) { throw 'Installed runtime must verify complete snapshot-first cleanup, active/fixed/replaced protections, actual automatic creation scheduling, native confirmation layouts and normal quit drainage.' }
  $taskSnapshotChecks = @('ownedOnlyCaptureVerified', 'privateSaveFailureVerified', 'backupSeparationVerified', 'normalRestartVerified', 'detachedExactRestoreVerified', 'referenceZoomKeyboardVerified', 'restoreKeyboardVerified', 'acceptedShutdownVerified', 'corruptReadRecoveryVerified', 'replacementRejectionVerified', 'sourcePreservationVerified')
  if ($taskDesktop.checks -lt 345 -or $taskSnapshots.checks -ne 8 -or $taskSnapshots.modelRequests -ne 0 -or @($taskSnapshotChecks | Where-Object { $taskSnapshots.$_ -ne $true }).Count -ne 0) { throw 'Installed runtime must verify private owned snapshots, exact staged and working recovery, backup/restart separation, accepted quit drainage, safe read/write failures and replacement refusal.' }
  if ($taskSnapshots.layouts.Count -ne 6 -or $taskSnapshots.keyboardLayouts.Count -ne 6 -or $taskSnapshots.restoreLayouts.Count -ne 6 -or $taskSnapshots.restoreKeyboardLayouts.Count -ne 6 -or $taskSnapshots.screenshots.Count -ne 33 -or @($taskSnapshots.screenshots | Sort-Object -Unique).Count -ne 33 -or @($taskSnapshots.screenshots | Where-Object { $_ -cnotmatch '^worktree-snapshots-[a-z0-9-]+-shell\.png$' }).Count -ne 0) { throw 'Installed runtime must retain six explicit save/restore error/focus layouts and 33 safe unique snapshot originals.' }
  if ($taskPinning.checks -ne 6 -or $taskPinning.modelRequests -ne 0 -or -not $taskPinning.ownedOnlyControlsVerified -or -not $taskPinning.heldFailureRetryVerified -or -not $taskPinning.staleSourceReadRecoveryVerified -or -not $taskPinning.backupSeparationVerified -or -not $taskPinning.normalRestartVerified -or -not $taskPinning.referenceZoomKeyboardVerified -or -not $taskPinning.replacementRejectionVerified -or -not $taskPinning.sourcePreservationVerified) { throw 'Installed runtime must verify actual local pinning, held-write retry, stale-source/read recovery, backup separation, restart and replaced-directory rejection.' }
  if ($taskPinning.layouts.Count -ne 6 -or $taskPinning.keyboardLayouts.Count -ne 6 -or $taskPinning.screenshots.Count -ne 21 -or @($taskPinning.screenshots | Sort-Object -Unique).Count -ne 21 -or @($taskPinning.screenshots | Where-Object { $_ -cnotmatch '^worktree-pinning-[a-z0-9-]+-shell\.png$' }).Count -ne 0) { throw 'Installed runtime must retain six pinning error/focus layouts and 21 safe unique originals.' }
  foreach ($taskTheme in @('light', 'dark')) { foreach ($taskZoom in @(1, 1.25, 1.5)) {
    $taskPinningErrors = @($taskPinning.layouts | Where-Object { $_.theme -eq $taskTheme -and $_.zoom -eq $taskZoom })
    $taskPinningFocuses = @($taskPinning.keyboardLayouts | Where-Object { $_.theme -eq $taskTheme -and $_.zoom -eq $taskZoom })
    if ($taskPinningErrors.Count -ne 1 -or $taskPinningFocuses.Count -ne 1) { throw 'Installed runtime must verify every pinning error and keyboard theme/zoom exactly once.' }
    $taskPinningError = $taskPinningErrors[0]
    $taskPinningFocus = $taskPinningFocuses[0]
    foreach ($taskDimension in @($taskPinningError.top, $taskPinningError.bottom, $taskPinningError.left, $taskPinningError.right, $taskPinningError.viewportTop, $taskPinningError.viewportBottom, $taskPinningError.viewportLeft, $taskPinningError.viewportRight, $taskPinningError.contentWidth, $taskPinningError.contentScrollWidth, $taskPinningError.documentWidth, $taskPinningError.viewportWidth, $taskPinningFocus.top, $taskPinningFocus.bottom, $taskPinningFocus.left, $taskPinningFocus.right, $taskPinningFocus.viewportTop, $taskPinningFocus.viewportBottom, $taskPinningFocus.viewportLeft, $taskPinningFocus.viewportRight, $taskPinningFocus.outline)) {
      if ($null -eq $taskDimension -or [double]::IsNaN([double]$taskDimension) -or [double]::IsInfinity([double]$taskDimension)) { throw 'Installed pinning geometry must contain finite dimensions.' }
    }
    if ($taskPinningError.contentWidth -le 0 -or $taskPinningError.contentScrollWidth -gt $taskPinningError.contentWidth -or $taskPinningError.viewportWidth -le 0 -or $taskPinningError.documentWidth -gt $taskPinningError.viewportWidth -or $taskPinningError.top -lt $taskPinningError.viewportTop -or $taskPinningError.bottom -gt $taskPinningError.viewportBottom -or $taskPinningError.left -lt $taskPinningError.viewportLeft -or $taskPinningError.right -gt $taskPinningError.viewportRight -or $taskPinningError.bottom -le $taskPinningError.top -or $taskPinningError.right -le $taskPinningError.left) { throw 'Installed runtime must show complete pinning errors without horizontal overflow.' }
    if ($taskPinningFocus.label -ne '固定工作树' -or $taskPinningFocus.outline -le 0 -or $taskPinningFocus.top - $taskPinningFocus.outline -lt $taskPinningFocus.viewportTop -or $taskPinningFocus.bottom + $taskPinningFocus.outline -gt $taskPinningFocus.viewportBottom -or $taskPinningFocus.left - $taskPinningFocus.outline -lt $taskPinningFocus.viewportLeft -or $taskPinningFocus.right + $taskPinningFocus.outline -gt $taskPinningFocus.viewportRight -or $taskPinningFocus.bottom -le $taskPinningFocus.top -or $taskPinningFocus.right -le $taskPinningFocus.left) { throw 'Installed runtime must show the whole keyboard pin focus outline.' }
  } }
  if ($taskOwnership.checks -ne 5 -or $taskOwnership.modelRequests -ne 0 -or -not $taskOwnership.externalNonAdoptionVerified -or -not $taskOwnership.newBranchReceiptVerified -or -not $taskOwnership.existingBranchReceiptVerified -or -not $taskOwnership.atomicFailureRetentionVerified -or -not $taskOwnership.normalRestartVerified -or -not $taskOwnership.backupSeparationVerified -or -not $taskOwnership.sourcePreservationVerified -or -not $taskOwnership.keyboardWarningLayoutsVerified) { throw 'Installed runtime must verify actual local worktree creation receipts, external non-adoption, failed receipt retention, restart and backup separation.' }
  if ($taskOwnership.layouts.Count -ne 6 -or $taskOwnership.screenshots.Count -ne 10 -or @($taskOwnership.screenshots | Sort-Object -Unique).Count -ne 10 -or @($taskOwnership.screenshots | Where-Object { $_ -notmatch '^worktree-ownership-[a-z0-9-]+-shell\.png$' }).Count -ne 0) { throw 'Installed runtime must retain all worktree ownership layouts and ten safe unique originals.' }
  foreach ($taskTheme in @('light', 'dark')) { foreach ($taskZoom in @(1, 1.25, 1.5)) {
    $taskOwnershipLayout = @($taskOwnership.layouts | Where-Object { $_.theme -eq $taskTheme -and $_.zoom -eq $taskZoom })
    if ($taskOwnershipLayout.Count -ne 1) { throw 'Installed runtime must verify every ownership theme and zoom exactly once.' }
    $taskOwnershipBounds = $taskOwnershipLayout[0].bounds
    $taskOwnershipFocus = $taskOwnershipLayout[0].focus
    foreach ($taskDimension in @($taskOwnershipBounds.PSObject.Properties.Value) + @($taskOwnershipFocus.left, $taskOwnershipFocus.right, $taskOwnershipFocus.top, $taskOwnershipFocus.bottom, $taskOwnershipFocus.width, $taskOwnershipFocus.height, $taskOwnershipFocus.outlineWidth)) {
      if ($null -eq $taskDimension -or [double]::IsNaN([double]$taskDimension) -or [double]::IsInfinity([double]$taskDimension)) { throw 'Installed ownership geometry must contain finite dimensions.' }
    }
    if ($taskOwnershipBounds.contentWidth -le 0 -or $taskOwnershipBounds.contentScrollWidth -gt $taskOwnershipBounds.contentWidth -or $taskOwnershipBounds.viewportWidth -le 0 -or $taskOwnershipBounds.documentWidth -gt $taskOwnershipBounds.viewportWidth -or $taskOwnershipBounds.top -lt $taskOwnershipBounds.viewportTop -or $taskOwnershipBounds.bottom -gt $taskOwnershipBounds.viewportBottom -or $taskOwnershipBounds.left -lt $taskOwnershipBounds.viewportLeft -or $taskOwnershipBounds.right -gt $taskOwnershipBounds.viewportRight -or $taskOwnershipBounds.bottom -le $taskOwnershipBounds.top -or $taskOwnershipBounds.right -le $taskOwnershipBounds.left) { throw 'Installed runtime must show the whole ownership warning without horizontal overflow.' }
    if ($taskOwnershipFocus.outlineWidth -le 0 -or $taskOwnershipFocus.outline -eq 'none' -or $taskOwnershipFocus.width -le 0 -or $taskOwnershipFocus.height -le 0 -or $taskOwnershipFocus.left -lt 0 -or $taskOwnershipFocus.top -lt 0 -or $taskOwnershipFocus.right -gt $taskOwnershipFocus.width -or $taskOwnershipFocus.bottom -gt $taskOwnershipFocus.height -or $taskOwnershipFocus.bottom -le $taskOwnershipFocus.top -or $taskOwnershipFocus.right -le $taskOwnershipFocus.left) { throw 'Installed runtime must show the complete ownership submit focus outline.' }
  } }
  if ($taskRegistration.checks -ne 5 -or $taskRegistration.modelRequests -ne 0 -or -not $taskRegistration.inlineValidationCancelVerified -or -not $taskRegistration.actualFailureSameIdRetryVerified -or -not $taskRegistration.duplicatePreservationVerified -or -not $taskRegistration.staleSourceVerified -or -not $taskRegistration.backupRestartVerified -or -not $taskRegistration.referenceZoomKeyboardVerified -or -not $taskRegistration.sourcePreservationVerified) { throw 'Installed runtime must verify actual worktree project registration, same-ID failure retry, duplicate preservation, stale-source rejection, backup restoration and keyboard submission.' }
  if ($taskRegistration.layouts.Count -ne 6 -or $taskRegistration.screenshots.Count -ne 19 -or @($taskRegistration.screenshots | Sort-Object -Unique).Count -ne 19 -or @($taskRegistration.screenshots | Where-Object { $_ -notmatch '^worktree-registration-[A-Za-z0-9.-]+-shell\.png$' }).Count -ne 0 -or @($taskRegistration.keyboardLayouts | Where-Object { $_.label -ne '登记项目' }).Count -ne 0) { throw 'Installed runtime must retain worktree registration originals, errors and actual submit labels.' }
  foreach ($taskTheme in @('light', 'dark')) { foreach ($taskZoom in @(1, 1.25, 1.5)) {
    $taskRegistrationError = @($taskRegistration.layouts | Where-Object { $_.theme -eq $taskTheme -and $_.zoom -eq $taskZoom })
    if ($taskRegistrationError.Count -ne 1 -or $taskRegistrationError[0].contentWidth -le 0 -or $taskRegistrationError[0].contentScrollWidth -gt $taskRegistrationError[0].contentWidth -or $taskRegistrationError[0].viewportWidth -le 0 -or $taskRegistrationError[0].documentWidth -gt $taskRegistrationError[0].viewportWidth -or $taskRegistrationError[0].top -lt $taskRegistrationError[0].viewportTop -or $taskRegistrationError[0].bottom -gt $taskRegistrationError[0].viewportBottom -or $taskRegistrationError[0].left -lt $taskRegistrationError[0].viewportLeft -or $taskRegistrationError[0].right -gt $taskRegistrationError[0].viewportRight -or $taskRegistrationError[0].bottom -le $taskRegistrationError[0].top -or $taskRegistrationError[0].right -le $taskRegistrationError[0].left) { throw 'Installed runtime must retain complete worktree registration errors without horizontal overflow in every theme and zoom.' }
  } }
  if ($taskUpstream.checks -ne 5 -or $taskUpstream.modelRequests -ne 0 -or -not $taskUpstream.preferenceFailureRetryVerified -or -not $taskUpstream.actualFetchPinnedCommitVerified -or -not $taskUpstream.neverAndMissingUpstreamVerified -or -not $taskUpstream.actualFailureRetryVerified -or -not $taskUpstream.backupRestartVerified -or -not $taskUpstream.referenceZoomKeyboardVerified -or -not $taskUpstream.sourcePreservationVerified) { throw 'Installed runtime must verify real upstream fetches, pinned local creation, never and missing upstream policies, failed-fetch recovery, backup restoration and native keyboard operation.' }
  foreach ($taskWorktreeKeyboard in @($taskUpstream, $taskConversations, $taskRegistration)) {
    if ($taskWorktreeKeyboard.keyboardLayouts.Count -ne 6) { throw 'Installed runtime must retain all six worktree keyboard layouts.' }
    foreach ($taskTheme in @('light', 'dark')) { foreach ($taskZoom in @(1, 1.25, 1.5)) {
      $taskFocus = @($taskWorktreeKeyboard.keyboardLayouts | Where-Object { $_.theme -eq $taskTheme -and $_.zoom -eq $taskZoom })
      if ($taskFocus.Count -ne 1 -or $taskFocus[0].outline -le 0 -or ($taskFocus[0].top - $taskFocus[0].outline) -lt $taskFocus[0].viewportTop -or ($taskFocus[0].bottom + $taskFocus[0].outline) -gt $taskFocus[0].viewportBottom -or ($taskFocus[0].left - $taskFocus[0].outline) -lt $taskFocus[0].viewportLeft -or ($taskFocus[0].right + $taskFocus[0].outline) -gt $taskFocus[0].viewportRight) { throw 'Installed runtime must retain complete worktree focus outlines at each theme and zoom.' }
    } }
  }
  if ($taskConversations.checks -ne 4 -or $taskConversations.modelRequests -ne 0 -or -not $taskConversations.linkedConversationVerified -or -not $taskConversations.projectDraftVerified -or -not $taskConversations.heldFailureRetryRestartVerified -or -not $taskConversations.staleTargetsVerified -or -not $taskConversations.sanitizedErrorsVerified -or -not $taskConversations.referenceZoomKeyboardVerified -or -not $taskConversations.sourcePreservationVerified) { throw 'Installed runtime must verify actual linked chats, independent project drafts, held checkpoint failure preservation, retry and restart, stale targets, sanitized feedback and minimum-window keyboard operation.' }
  if ($taskOverview.checks -ne 6 -or $taskOverview.modelRequests -ne 0 -or -not $taskOverview.actualRepositoryAssociationVerified -or -not $taskOverview.refreshReadOnlyVerified -or -not $taskOverview.errorRetryCloseVerified -or -not $taskOverview.boundedPagingVerified -or -not $taskOverview.referenceZoomKeyboardVerified -or -not $taskOverview.sourcePreservationVerified) { throw 'Installed runtime must verify real worktree associations, read-only refresh, error retry, closed-request cancellation, bounded project paging, minimum-window keyboard operation and source preservation.' }
  if ($taskWorktrees.checks -ne 7 -or $taskWorktrees.modelRequests -ne 0 -or -not $taskWorktrees.bridgeValidationVerified -or -not $taskWorktrees.creationBusySourcePreservationVerified -or -not $taskWorktrees.registrationRetryVerified -or -not $taskWorktrees.existingBranchReuseVerified -or -not $taskWorktrees.hookSourcePreviewVerified -or -not $taskWorktrees.referenceZoomKeyboardVerified -or -not $taskWorktrees.restartDraftsVerified) { throw 'Installed runtime must verify worktree creation, source preservation, project-save retry, occupied branches, hooks, restricted quick chat and restart.' }
  $taskContext = $taskDesktop.contextSummaries
  if ($taskContext.checks -ne 6 -or $taskContext.requestCount -ne 10 -or $taskContext.summaryRequests -ne 3 -or $taskContext.originalMessages -ne 6 -or $taskContext.finalMessages -ne 14 -or -not $taskContext.readonlyPreviewVerified -or -not $taskContext.actualContextRequestsVerified -or -not $taskContext.cancellationFailureVerified -or -not $taskContext.expiredFullContextVerified -or -not $taskContext.restartHistoryVerified -or -not $taskContext.restrictedQuickChatVerified) { throw 'Installed runtime must verify all context-summary requests, original history, cancellation, expiry, restricted quick chat and restart.' }
  $taskPdf = $taskDesktop.pdfPreview
  if ($taskPdf.checks -ne 6 -or -not $taskPdf.canvasTextVerified -or -not $taskPdf.outlineTargetsVerified -or -not $taskPdf.fullDocumentSearchVerified -or -not $taskPdf.linksNotesZoomVerified -or -not $taskPdf.exportOwnershipRestartVerified) { throw 'Installed runtime must include complete PDF reading and original-file verification.' }
  $taskPassed = $true
} finally {
  if ($taskRegistered) {
    $taskEntries = @(Get-NookRegistration)
    if ($taskEntries.Count -ne 1 -or $taskEntries[0].UninstallString -ne $taskExpectedUninstall) { throw 'The uninstall target no longer matches the owned installation.' }
    if (@(Get-CimInstance Win32_Process -Filter "Name='Nook.exe'" | Where-Object { [StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath, (Join-Path $taskInstall 'Nook.exe')) }).Count -ne 0) { throw 'The owned installed application must exit before uninstalling.' }
    $taskProcess = Start-Process -FilePath (Join-Path $taskInstall 'Uninstall Nook.exe') -ArgumentList '/S /currentuser' -WindowStyle Hidden -PassThru -Wait
    if ($taskProcess.ExitCode -ne 0) { throw 'The owned uninstaller failed.' }
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while (Test-Path -LiteralPath $taskInstall) {
      if ([DateTime]::UtcNow -ge $taskDeadline) { throw 'The owned application directory remains after uninstall.' }
      Start-Sleep -Milliseconds 200
    }
    if (@(Get-NookRegistration).Count -ne 0 -or @($taskLinks | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0) { throw 'Owned registration or shortcuts remain after uninstall.' }
    foreach ($taskSentinel in $taskSentinels) { if ([IO.File]::ReadAllText($taskSentinel) -ne $taskNonce) { throw 'Uninstall removed or changed user data.' } }
    if ($taskPassed) {
      @{verifiedAt=[DateTime]::UtcNow.ToString('o');version=$taskVersion;installerSha256=(Get-FileHash -LiteralPath $taskSetup -Algorithm SHA256).Hash.ToLowerInvariant();executableSha256=$taskDesktop.executableSha256;archiveSha256=$taskDesktop.archiveSha256;checks=$taskDesktop.checks;normalCloseVerified=$true;registrationVerified=$true;shortcutsVerified=$true;uninstalled=$true;userDataRetained=$true;scope='Actual current-user silent install into an owned Unicode path, complete installed-runtime regression, original package hashes, shortcut metadata and silent uninstall with fresh data sentinels. Native wizard interaction remains a separate check.'} | ConvertTo-Json -Depth 4 | Set-Content verification/pipeline-installer-result.json -Encoding utf8
    }
  }
  if ($taskPassed) {
    foreach ($taskSentinel in $taskSentinels) {
      Remove-Item -LiteralPath $taskSentinel
      $taskProfile = Split-Path -Parent $taskSentinel
      if (@(Get-ChildItem -LiteralPath $taskProfile -Force).Count -eq 0) { Remove-Item -LiteralPath $taskProfile }
    }
    if (@(Get-ChildItem -LiteralPath $taskScratch -Force).Count -eq 0) { Remove-Item -LiteralPath $taskScratch }
  } else { Write-Warning "Retained failed installer fixture: $taskScratch" }
  Remove-Item Env:QIYAO_AUDIT_DIRECTORY, Env:QIYAO_INSTALLED_SHORTCUTS, Env:QIYAO_TEST_EXECUTABLE -ErrorAction SilentlyContinue
}
