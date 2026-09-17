param([Parameter(Mandatory=$true)][string]$InstallDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$RecoveredKeyFile = Join-Path $InstallDir 'installer\.recovered-api-key'
$HasRecoveredKey = Test-Path -LiteralPath $RecoveredKeyFile
$Key = ''
if (-not $HasRecoveredKey) {
  $Key = [Microsoft.VisualBasic.Interaction]::InputBox('Paste a new personal MCP Key. The Key is only sent to the WorkBuddy gateway.', 'Repair WorkBuddy Image MCP')
  if ([string]::IsNullOrWhiteSpace($Key)) { exit 1 }
}
$Dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$Dialog.Description = 'Choose the folder that WorkBuddy may read reference images from.'
if ($Dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
$KeyFile = ''
try {
  $Arguments = @((Join-Path $InstallDir 'installer\config-cli.mjs'), 'repair', '--gateway=https://xiaoyeai.cn', "--roots=$($Dialog.SelectedPath)", "--install-dir=$InstallDir")
  if (-not $HasRecoveredKey) {
    $KeyFile = Join-Path ([IO.Path]::GetTempPath()) ("workbuddy-image-key-{0}.txt" -f [guid]::NewGuid())
    Set-Content -LiteralPath $KeyFile -Value $Key -NoNewline -Encoding UTF8
    $Arguments += "--key-file=$KeyFile"
  }
  & (Join-Path $InstallDir 'runtime\node.exe') @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Repair failed. The previous configuration has been restored.' }
  [System.Windows.Forms.MessageBox]::Show('The WorkBuddy Image MCP configuration has been repaired.', 'Repair complete') | Out-Null
} finally {
  if ($KeyFile) { Remove-Item -LiteralPath $KeyFile -Force -ErrorAction SilentlyContinue }
}
