param(
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [string]$ManifestUrl = 'https://xiaoyeai.cn/install/workbuddy-image-mcp-1.1.0.json'
)

$ErrorActionPreference = 'Stop'
$ExpectedPublisher = 'CN=Xiaoye AI'
$ExpectedVersion = '1.1.0'
$ManifestPath = $null
$InstallerPath = $null
$ResolvedTokenFile = $null
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

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ManifestUri = Assert-HttpsUrl $ManifestUrl 'manifest URL'
  $ResolvedTokenFile = (Resolve-Path -LiteralPath $TokenFile).Path
  $FullTokenPath = [IO.Path]::GetFullPath($ResolvedTokenFile)
  if (-not $FullTokenPath.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'installation_token_file_insecure'
  }

  $ManifestPath = Get-TemporaryPath '.json'
  Invoke-WebRequest -Uri $ManifestUri -OutFile $ManifestPath -UseBasicParsing -MaximumRedirection 0
  $Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($Manifest.version -ne $ExpectedVersion -or
      $Manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or
      $Manifest.publisher -ne $ExpectedPublisher) {
    throw 'installer_verification_failed: invalid manifest'
  }
  $InstallerUri = Assert-HttpsUrl $Manifest.installer_url 'installer URL'

  $InstallerPath = Get-TemporaryPath '.exe'
  Invoke-WebRequest -Uri $InstallerUri -OutFile $InstallerPath -UseBasicParsing -MaximumRedirection 0
  $ActualHash = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualHash -cne ([string]$Manifest.sha256).ToLowerInvariant()) {
    throw 'installer_verification_failed: SHA-256 mismatch'
  }
  $Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
  if ($Signature.Status -ne 'Valid' -or
      $null -eq $Signature.SignerCertificate -or
      $Signature.SignerCertificate.Subject -cne $ExpectedPublisher) {
    throw 'installer_verification_failed: publisher signature mismatch'
  }

  $InstallerArguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/TOKENFILE=`"$FullTokenPath`"")
  $Process = Start-Process -FilePath $InstallerPath -ArgumentList $InstallerArguments -Wait -PassThru
  if ($Process.ExitCode -ne 0) { throw "installation_failed: installer exit code $($Process.ExitCode)" }
  Write-Output 'installed'
} finally {
  if ($InstallerPath) { Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue }
  if ($ManifestPath) { Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction SilentlyContinue }
  if ($ResolvedTokenFile) { Remove-Item -LiteralPath $ResolvedTokenFile -Force -ErrorAction SilentlyContinue }
  elseif ($TokenFile) { Remove-Item -LiteralPath $TokenFile -Force -ErrorAction SilentlyContinue }
  if ($PSCommandPath -and ([IO.Path]::GetFullPath($PSCommandPath)).StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  }
}
