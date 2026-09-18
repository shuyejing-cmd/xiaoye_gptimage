param(
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [Parameter(Mandatory=$true)][string]$ManifestUrl
)

$ErrorActionPreference = 'Stop'
$ExpectedPublisher = 'CN=Xiaoye AI'
$ExpectedVersion = '1.2.1'
$ManifestPath = $null
$InstallerPath = $null
$ResultPath = $null
$CleanupTokenFile = $null
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())

function Assert-HttpsUrl([string]$Value, [string]$Name) {
  $Uri = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$Uri) -or $Uri.Scheme -ne 'https') {
    throw "installer_verification_failed: $Name must use HTTPS"
  }
  return $Uri
}

function Get-TemporaryPath([string]$Extension) {
  return Join-Path $TempRoot ("workbuddy-image-{0}{1}" -f [guid]::NewGuid(), $Extension)
}

function Get-Sha256Hex([string]$Path) {
  $Stream = [System.IO.File]::OpenRead($Path)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
    $Stream.Dispose()
  }
}

function Invoke-DownloadWithRetry {
  param(
    [string[]]$Urls,
    [string]$Destination,
    [int]$MaxAttempts = 3
  )
  foreach ($Url in $Urls) {
    $DownloadUri = Assert-HttpsUrl $Url 'download URL'
    for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
      try {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $DownloadUri -OutFile $Destination -UseBasicParsing -TimeoutSec 120
        if ((Get-Item -LiteralPath $Destination).Length -gt 0) { return $DownloadUri }
      } catch {
        if ($Attempt -lt $MaxAttempts) { Start-Sleep -Seconds ([Math]::Min(2 * $Attempt, 5)) }
      }
    }
  }
  throw 'installer_download_failed'
}

function Resolve-PrivateTokenFile([string]$Value) {
  $Resolved = (Resolve-Path -LiteralPath $Value).Path
  $FullPath = [IO.Path]::GetFullPath($Resolved)
  if (-not $FullPath.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      (Get-Item -LiteralPath $FullPath).PSIsContainer) {
    throw 'installation_token_file_insecure'
  }
  $script:CleanupTokenFile = $FullPath
  $Me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  & icacls.exe $FullPath /inheritance:r /grant:r "*$($Me.Value):(R,W)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'installation_token_file_insecure' }
  $Acl = [System.IO.File]::GetAccessControl($FullPath)
  $Rules = $Acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  $Unsafe = $Rules | Where-Object {
    $_.AccessControlType -eq 'Allow' -and
    $_.IdentityReference.Value -notin @($Me.Value, 'S-1-5-18', 'S-1-5-32-544')
  }
  if ($Unsafe) { throw 'installation_token_file_insecure' }
  return $FullPath
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ManifestUri = Assert-HttpsUrl $ManifestUrl 'manifest URL'
  $FullTokenPath = Resolve-PrivateTokenFile $TokenFile
  $CleanupTokenFile = $FullTokenPath

  $ManifestPath = Get-TemporaryPath '.json'
  Invoke-DownloadWithRetry -Urls @($ManifestUri.AbsoluteUri) -Destination $ManifestPath | Out-Null
  if ((Get-Item -LiteralPath $ManifestPath).Length -le 0) { throw 'installer_verification_failed: empty manifest' }
  $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($Manifest.version -ne $ExpectedVersion -or
      $Manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or
      $null -eq $Manifest.signed -or
      $Manifest.signed.GetType() -ne [bool]) {
    throw 'installer_verification_failed: invalid manifest'
  }
  $InstallerUrls = @([string]$Manifest.installer_url)
  if ($Manifest.fallback_installer_urls) {
    $InstallerUrls += @($Manifest.fallback_installer_urls | ForEach-Object { [string]$_ })
  }

  $InstallerPath = Get-TemporaryPath '.exe'
  Invoke-DownloadWithRetry -Urls $InstallerUrls -Destination $InstallerPath | Out-Null
  if ((Get-Item -LiteralPath $InstallerPath).Length -lt 10MB) { throw 'installer_verification_failed: installer too small' }
  $ActualHash = Get-Sha256Hex $InstallerPath
  if ($ActualHash -cne ([string]$Manifest.sha256).ToLowerInvariant()) {
    throw 'installer_verification_failed: SHA-256 mismatch'
  }
  if ($Manifest.signed) {
    if ($Manifest.publisher -ne $ExpectedPublisher) { throw 'installer_verification_failed: publisher mismatch' }
    $Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
    if ($Signature.Status -ne 'Valid' -or
        $null -eq $Signature.SignerCertificate -or
        $Signature.SignerCertificate.Subject -cne $ExpectedPublisher) {
      throw 'installer_verification_failed: publisher signature mismatch'
    }
  }

  $ResultPath = Get-TemporaryPath '.result'
  $InstallerArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/TOKENFILE=`"$FullTokenPath`"", "/RESULTFILE=`"$ResultPath`"")
  $Process = Start-Process -FilePath $InstallerPath -ArgumentList $InstallerArguments -Wait -PassThru
  $InstallerResult = if (Test-Path -LiteralPath $ResultPath) { (Get-Content -LiteralPath $ResultPath -Raw).Trim() } else { '' }
  if ($Process.ExitCode -ne 0) {
    if ($InstallerResult -match '^(invalid_installation_token|installation_token_expired|installation_token_used|installation_token_file_insecure|api_key_invalid|invalid_session|account_suspended|workbuddy_config_ambiguous|workbuddy_config_not_found|workbuddy_config_invalid|workbuddy_config_self_check_failed|installation_exchange_unavailable)$') {
      throw $InstallerResult
    }
    throw "installation_failed: installer exit code $($Process.ExitCode)"
  }
  if ($InstallerResult -ne 'installed') { throw 'installation_failed: missing installer result' }
  Write-Output 'installed'
} finally {
  if ($InstallerPath) { Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue }
  if ($ManifestPath) { Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue }
  if ($ResultPath) { Remove-Item -LiteralPath $ResultPath -Force -ErrorAction SilentlyContinue }
  if ($CleanupTokenFile) { Remove-Item -LiteralPath $CleanupTokenFile -Force -ErrorAction SilentlyContinue }
  if ($PSCommandPath -and ([IO.Path]::GetFullPath($PSCommandPath)).StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  }
}
