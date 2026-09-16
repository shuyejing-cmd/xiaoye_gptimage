$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StageDir = Join-Path $PSScriptRoot 'stage'
$OutputDir = Join-Path $PSScriptRoot 'output'
$Version = '1.1.0'
$ExpectedPublisher = 'CN=Xiaoye AI'
if (-not $StageDir.StartsWith($PSScriptRoot) -or -not $OutputDir.StartsWith($PSScriptRoot)) { throw 'Installer paths escaped the installer directory.' }
$Iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source
if (-not $Iscc) { throw 'Inno Setup iscc.exe was not found. Install Inno Setup 6 and retry.' }
Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $StageDir 'runtime'), (Join-Path $StageDir 'app') | Out-Null
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $StageDir 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'src') -Destination (Join-Path $StageDir 'app\src') -Recurse
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'node_modules') -Destination (Join-Path $StageDir 'app\node_modules') -Recurse
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'package.json') -Destination (Join-Path $StageDir 'app\package.json')
& $Iscc "/DStageDir=$StageDir" (Join-Path $PSScriptRoot 'workbuddy-image-mcp.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed with exit code $LASTEXITCODE." }
$InstallerPath = Join-Path $OutputDir 'WorkBuddy-Image-MCP-Setup.exe'
if (-not (Test-Path -LiteralPath $InstallerPath)) { throw 'Inno Setup did not create the expected installer.' }
if ($env:CODE_SIGN_CERT_SHA1) {
  $SignTool = (Get-Command signtool.exe -ErrorAction Stop).Source
  & $SignTool sign /sha1 $env:CODE_SIGN_CERT_SHA1 /fd SHA256 /tr 'https://timestamp.digicert.com' /td SHA256 $InstallerPath
  if ($LASTEXITCODE -ne 0) { throw "Installer signing failed with exit code $LASTEXITCODE." }
  & $SignTool verify /pa $InstallerPath
  if ($LASTEXITCODE -ne 0) { throw "Installer signature verification failed with exit code $LASTEXITCODE." }
  $Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
  if ($Signature.Status -ne 'Valid' -or $null -eq $Signature.SignerCertificate -or $Signature.SignerCertificate.Subject -cne $ExpectedPublisher) {
    throw "Installer publisher must exactly match $ExpectedPublisher."
  }
  $Sha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $VersionedInstallerName = "WorkBuddy-Image-MCP-Setup-$Version.exe"
  $ManifestName = "workbuddy-image-mcp-$Version.json"
  $ManifestPath = Join-Path $OutputDir $ManifestName
  & $NodeExe (Join-Path $PSScriptRoot 'release-manifest.mjs') `
    "--version=$Version" `
    "--sha256=$Sha256" `
    "--publisher=$ExpectedPublisher" `
    "--installer-url=https://xiaoyeai.cn/install/$VersionedInstallerName" `
    "--output=$ManifestPath"
  if ($LASTEXITCODE -ne 0) { throw "Release manifest generation failed with exit code $LASTEXITCODE." }
  $InstallPublishDir = Join-Path $ProjectRoot 'web\public\install'
  $DownloadDir = Join-Path $ProjectRoot 'web\public\downloads'
  New-Item -ItemType Directory -Force $InstallPublishDir, $DownloadDir | Out-Null
  Copy-Item -LiteralPath $InstallerPath -Destination (Join-Path $InstallPublishDir $VersionedInstallerName) -Force
  Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $InstallPublishDir $ManifestName) -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'workbuddy-image-mcp-bootstrap.ps1') -Destination (Join-Path $InstallPublishDir 'workbuddy-image-mcp.ps1') -Force
  Copy-Item -LiteralPath $InstallerPath -Destination (Join-Path $DownloadDir 'WorkBuddy-Image-MCP-Setup.exe') -Force
  Write-Host "Signed installer, manifest, and bootstrap published to $InstallPublishDir"
} else {
  Write-Warning 'Unsigned test installer created locally. Nothing was published to the website.'
}
Write-Host "Installer created in $OutputDir"
