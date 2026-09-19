param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$SmokeRoot = (Join-Path $env:TEMP 'workbuddy-installer-smoke')
)

$ErrorActionPreference = 'Stop'
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$InstallDir = Join-Path $SmokeRoot 'install'
$TokenFile = Join-Path $SmokeRoot 'missing-token.txt'
$ResultFile = Join-Path $SmokeRoot 'result.txt'
$LogFile = Join-Path $SmokeRoot 'setup.log'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{B5187E32-8649-48EC-BBD0-CBB91366321E}_is1'
$Programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
$SmokeGroup = "WorkBuddy Image MCP Smoke $PID"
$SmokeShortcutDir = Join-Path $Programs $SmokeGroup
$ExpectedInstallLocation = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\', '/')

if (Test-Path -LiteralPath $UninstallKey) {
  $ExistingLocation = [string](Get-ItemPropertyValue -LiteralPath $UninstallKey -Name InstallLocation -ErrorAction SilentlyContinue)
  $ExistingLocation = [IO.Path]::GetFullPath($ExistingLocation).TrimEnd('\', '/')
  if (-not $ExistingLocation.Equals($ExpectedInstallLocation, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to overwrite an existing WorkBuddy Image MCP installation during the smoke test.'
  }
}

Remove-Item -LiteralPath $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $SmokeRoot | Out-Null
try {
  $Arguments = @(
    '/VERYSILENT',
    '/SUPPRESSMSGBOXES',
    '/NORESTART',
    '/NOICONS',
    "/GROUP=`"$SmokeGroup`"",
    "/LOG=`"$LogFile`"",
    "/DIR=`"$InstallDir`"",
    "/TOKENFILE=`"$TokenFile`"",
    "/RESULTFILE=`"$ResultFile`""
  )
  $Process = Start-Process -FilePath $InstallerPath -ArgumentList $Arguments -Wait -PassThru
  if (-not (Test-Path -LiteralPath $ResultFile)) {
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 80 | Write-Host }
    throw 'Installer did not reach the CLI result contract.'
  }
  $Result = (Get-Content -LiteralPath $ResultFile -Raw).Trim()
  if ($Result -cne 'installation_token_file_insecure') {
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 80 | Write-Host }
    throw "Unexpected installer result: $Result"
  }
  Write-Output "INSTALLER_INITIALIZATION_OK exit=$($Process.ExitCode)"
} finally {
  $OwnsSmokeInstall = $false
  if (Test-Path -LiteralPath $UninstallKey) {
    $SmokeLocation = [string](Get-ItemPropertyValue -LiteralPath $UninstallKey -Name InstallLocation -ErrorAction SilentlyContinue)
    $SmokeLocation = [IO.Path]::GetFullPath($SmokeLocation).TrimEnd('\', '/')
    if ($SmokeLocation.Equals($ExpectedInstallLocation, [StringComparison]::OrdinalIgnoreCase)) {
      $OwnsSmokeInstall = $true
      Remove-Item -LiteralPath $UninstallKey -Recurse -Force
    }
  }
  if ($OwnsSmokeInstall) {
    Remove-Item -LiteralPath $SmokeShortcutDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $SmokeRoot -Recurse -Force -ErrorAction SilentlyContinue
}
