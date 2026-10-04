[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
$taskSetup = Join-Path $taskRoot "artifacts/Qiyao-Setup-$taskVersion-x64.exe"
$taskScratch = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('QiyaoInstallerAudit-' + [Guid]::NewGuid().ToString('N'))
$taskInstall = Join-Path $taskScratch '安装 栖曜'
$taskRegistryRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
function Get-QiyaoRegistration {
  @($taskRegistryRoots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ } | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } | Where-Object { $_.DisplayName -match '^Qiyao(?:\s|$)' })
}
$taskLinks = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Qiyao.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Qiyao.lnk'))
$taskProfiles = @('Qiyao', 'qiyao-workspace') | ForEach-Object { Join-Path ([Environment]::GetFolderPath('ApplicationData')) $_ }
if (@(Get-QiyaoRegistration).Count -ne 0 -or @($taskLinks + $taskProfiles | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0) { throw 'Existing Qiyao installation, shortcuts and user profiles must be preserved.' }
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
  $taskEntries = @(Get-QiyaoRegistration)
  $taskExpectedUninstall = '"' + (Join-Path $taskInstall 'Uninstall Qiyao.exe') + '" /currentuser'
  if ($taskEntries.Count -ne 1 -or $taskEntries[0].PSPath -notmatch 'HKEY_CURRENT_USER' -or $taskEntries[0].UninstallString -ne $taskExpectedUninstall -or $taskEntries[0].Publisher -ne 'Qiyao' -or $taskEntries[0].DisplayVersion -ne $taskVersion) { throw 'Unexpected installation registration, version or scope.' }
  $taskRegistered = $true
  $env:QIYAO_AUDIT_DIRECTORY = $taskInstall
  Remove-Item Env:QIYAO_AUDIT_KIND -ErrorAction SilentlyContinue
  node scripts/verify-package.mjs --installer
  if ($LASTEXITCODE -ne 0) { throw 'Installed-package audit failed.' }
  $env:QIYAO_INSTALLED_SHORTCUTS = ConvertTo-Json -InputObject $taskLinks -Compress
  node scripts/verify-shell-integration.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installed shortcut audit failed.' }
  Get-ChildItem Env: | Where-Object { $_.Name -like 'QIYAO_TEST_*_ONLY' } | Remove-Item
  Remove-Item Env:QIYAO_TEST_WORKSPACE_SEED -ErrorAction SilentlyContinue
  $env:QIYAO_TEST_EXECUTABLE = Join-Path $taskInstall 'Qiyao.exe'
  pnpm test:desktop
  if ($LASTEXITCODE -ne 0) { throw 'Installed desktop verification failed.' }
  $taskDesktop = Get-Content verification/packaged-result.json -Raw | ConvertFrom-Json
  $taskAudit = Get-Content verification/package-audit-result.json -Raw | ConvertFrom-Json
  $taskInstalledAudit = Get-Content verification/installed-package-audit-result.json -Raw | ConvertFrom-Json
  if (-not $taskDesktop.normalCloseVerified -or $taskDesktop.runtimeErrors.Count -ne 0 -or $taskDesktop.checks -lt 215 -or $taskDesktop.executableSha256 -ne $taskAudit.executableSha256 -or $taskDesktop.archiveSha256 -ne $taskAudit.archiveSha256 -or $taskInstalledAudit.executableSha256 -ne $taskAudit.executableSha256 -or $taskInstalledAudit.archiveSha256 -ne $taskAudit.archiveSha256) { throw 'Installed runtime must normally close and match the built application.' }
  $taskPassed = $true
} finally {
  if ($taskRegistered) {
    $taskEntries = @(Get-QiyaoRegistration)
    if ($taskEntries.Count -ne 1 -or $taskEntries[0].UninstallString -ne $taskExpectedUninstall) { throw 'The uninstall target no longer matches the owned installation.' }
    if (@(Get-CimInstance Win32_Process -Filter "Name='Qiyao.exe'" | Where-Object { [StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath, (Join-Path $taskInstall 'Qiyao.exe')) }).Count -ne 0) { throw 'The owned installed application must exit before uninstalling.' }
    $taskProcess = Start-Process -FilePath (Join-Path $taskInstall 'Uninstall Qiyao.exe') -ArgumentList '/S /currentuser' -WindowStyle Hidden -PassThru -Wait
    if ($taskProcess.ExitCode -ne 0) { throw 'The owned uninstaller failed.' }
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while (Test-Path -LiteralPath $taskInstall) {
      if ([DateTime]::UtcNow -ge $taskDeadline) { throw 'The owned application directory remains after uninstall.' }
      Start-Sleep -Milliseconds 200
    }
    if (@(Get-QiyaoRegistration).Count -ne 0 -or @($taskLinks | Where-Object { Test-Path -LiteralPath $_ }).Count -ne 0) { throw 'Owned registration or shortcuts remain after uninstall.' }
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
