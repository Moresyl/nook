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
  if (-not $taskDesktop.normalCloseVerified -or $taskDesktop.runtimeErrors.Count -ne 0 -or $taskDesktop.checks -lt 312 -or $taskDesktop.memories.checks -ne 3 -or $taskDesktop.projectPreview.checks -ne 10 -or $taskDesktop.projectPreview.outsideHttpRequests -ne 0 -or $taskDesktop.projectPreview.docked.checks -ne 5 -or -not $taskDesktop.projectPreview.docked.floatingTransferVerified -or -not $taskDesktop.projectPreview.docked.projectRemovalVerified -or -not $taskDesktop.projectPreview.docked.workbenchReloadVerified -or -not $taskDesktop.projectPreview.docked.staleOwnerCloseVerified -or $taskDesktop.projectBranches.checks -ne 8 -or $taskDesktop.toolActivities.checks -ne 8 -or $taskDesktop.executableSha256 -ne $taskAudit.executableSha256 -or $taskDesktop.archiveSha256 -ne $taskAudit.archiveSha256 -or $taskInstalledAudit.executableSha256 -ne $taskAudit.executableSha256 -or $taskInstalledAudit.archiveSha256 -ne $taskAudit.archiveSha256) { throw 'Installed runtime must normally close and match the built application.' }
  $taskWorktrees = $taskDesktop.projectWorktrees
  $taskRoots = $taskDesktop.worktreeSettings
  if ($taskDesktop.checks -lt 312 -or $taskRoots.checks -ne 10 -or $taskRoots.modelRequests -ne 0 -or $taskRoots.pickerCases -ne 5 -or -not $taskRoots.directoryPickerVerified -or -not $taskRoots.defaultRootVerified -or -not $taskRoots.defaultRootFailureVerified -or -not $taskRoots.defaultRootBackupRestartVerified -or -not $taskRoots.rootValidationVerified -or -not $taskRoots.busySaveVerified -or -not $taskRoots.saveFailurePreservationVerified -or -not $taskRoots.rootCreationVerified -or -not $taskRoots.backupRestartVerified -or -not $taskRoots.referenceZoomKeyboardVerified) { throw 'Installed runtime must verify owned directory selection, default root preparation and failure preservation, root validation, busy-save locking, actual Git creation, backup restoration and restart.' }
  $taskOverview = $taskDesktop.worktreeOverview
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
