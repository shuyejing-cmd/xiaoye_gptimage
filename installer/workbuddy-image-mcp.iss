#ifndef StageDir
  #define StageDir "stage"
#endif

[Setup]
AppId={{B5187E32-8649-48EC-BBD0-CBB91366321E}
AppName=WorkBuddy 图片 MCP
AppVersion=1.0.0
DefaultDirName={autopf}\WorkBuddy Image MCP
DefaultGroupName=WorkBuddy 图片 MCP
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=WorkBuddy-Image-MCP-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=WorkBuddy 图片 MCP

[Files]
Source: "{#StageDir}\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "{#StageDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "config-manager.mjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "config-cli.mjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "repair-config.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion

[Icons]
Name: "{group}\检测连接"; Filename: "{cmd}"; Parameters: "/k """"{app}\runtime\node.exe"" ""{app}\installer\config-cli.mjs"" doctor"""; WorkingDir: "{app}"
Name: "{group}\修复配置"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\repair-config.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"

[UninstallRun]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\installer\config-cli.mjs"" uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveWorkBuddyMcpConfig"

[Code]
var
  KeyPage: TInputQueryWizardPage;
  ImageDirPage: TInputDirWizardPage;

procedure InitializeWizard;
begin
  KeyPage := CreateInputQueryPage(wpSelectDir, '连接你的账户', '粘贴个人 MCP Key', 'Key 只用于当前 Windows 用户的 WorkBuddy 配置，请勿截图或转发。');
  KeyPage.Add('个人 Key：', True);
  ImageDirPage := CreateInputDirPage(KeyPage.ID, '选择参考图目录', 'WorkBuddy 可以读取哪些图片？', '请选择你允许图片 MCP 读取的目录。安装后可重新运行安装器修改。', False, '新建目录');
  ImageDirPage.Add('允许读取的目录：');
  ImageDirPage.Values[0] := ExpandConstant('{userpictures}');
end;

function ValidateKey(const Key: String): Boolean;
var
  Http: Variant;
begin
  Result := False;
  try
    Http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    Http.SetTimeouts(5000, 5000, 10000, 10000);
    Http.Open('GET', 'https://xiaoyeai.cn/v1/account/balance', False);
    Http.SetRequestHeader('Authorization', 'Bearer ' + Key);
    Http.Send('');
    Result := Http.Status = 200;
  except
    Result := False;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = KeyPage.ID then
  begin
    if Trim(KeyPage.Values[0]) = '' then
    begin
      MsgBox('请粘贴网站生成的个人 Key。', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (CurPageID = ImageDirPage.ID) and (not ValidateKey(Trim(KeyPage.Values[0]))) then
  begin
    MsgBox('Key 验证失败。请检查网络，或从网站重新复制个人 Key。', mbError, MB_OK);
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  KeyFile, Params: String;
begin
  if CurStep = ssPostInstall then
  begin
    KeyFile := ExpandConstant('{tmp}\workbuddy-image-key.txt');
    SaveStringToFile(KeyFile, Trim(KeyPage.Values[0]), False);
    Params := '"' + ExpandConstant('{app}\installer\config-cli.mjs') + '" install' +
      ' --gateway=https://xiaoyeai.cn' +
      ' --key-file="' + KeyFile + '"' +
      ' --roots="' + ImageDirPage.Values[0] + '"' +
      ' --install-dir="' + ExpandConstant('{app}') + '"';
    if not Exec(ExpandConstant('{app}\runtime\node.exe'), Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      RaiseException('WorkBuddy 配置写入失败，原配置已保留或恢复。');
  end;
end;
