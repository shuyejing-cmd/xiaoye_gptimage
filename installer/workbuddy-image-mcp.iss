#ifndef StageDir
  #define StageDir "stage"
#endif

[Setup]
AppId={{B5187E32-8649-48EC-BBD0-CBB91366321E}
AppName=WorkBuddy 图片 MCP
AppVersion=1.1.0
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
Source: "config-discovery.mjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "installation-client.mjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "repair-config.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion

[Icons]
Name: "{group}\检测连接"; Filename: "{cmd}"; Parameters: "/k """"{app}\runtime\node.exe"" ""{app}\installer\config-cli.mjs"" doctor --install-dir=""{app}"""""; WorkingDir: "{app}"
Name: "{group}\修复配置"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\repair-config.ps1"" -InstallDir ""{app}"""; WorkingDir: "{app}"

[UninstallRun]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\installer\config-cli.mjs"" uninstall --install-dir=""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveWorkBuddyMcpConfig"

[Code]
var
  KeyPage: TInputQueryWizardPage;
  ImageDirPage: TInputDirWizardPage;
  TokenFileParam: String;
  ConfigPathParam: String;
  RootsParam: String;
  ResultFileParam: String;

procedure InitializeWizard;
begin
  TokenFileParam := ExpandConstant('{param:TOKENFILE|}');
  ConfigPathParam := ExpandConstant('{param:CONFIG|}');
  RootsParam := ExpandConstant('{param:ROOTS|}');
  ResultFileParam := ExpandConstant('{param:RESULTFILE|}');
  KeyPage := CreateInputQueryPage(wpSelectDir, '连接你的账户', '粘贴个人 MCP Key', 'Key 只用于当前 Windows 用户的 WorkBuddy 配置，请勿截图或转发。');
  KeyPage.Add('个人 Key：', True);
  ImageDirPage := CreateInputDirPage(KeyPage.ID, '选择参考图目录', 'WorkBuddy 可以读取哪些图片？', '请选择你允许图片 MCP 读取的目录。安装后可重新运行安装器修改。', False, '新建目录');
  ImageDirPage.Add('允许读取的目录：');
  if RootsParam <> '' then
    ImageDirPage.Values[0] := RootsParam
  else
    ImageDirPage.Values[0] := ExpandConstant('{userpictures}');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (TokenFileParam <> '') and (PageID = KeyPage.ID);
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
  if (TokenFileParam = '') and (CurPageID = KeyPage.ID) then
  begin
    if Trim(KeyPage.Values[0]) = '' then
    begin
      MsgBox('请粘贴网站生成的个人 Key。', mbError, MB_OK);
      Result := False;
    end;
  end;
  if (TokenFileParam = '') and (CurPageID = ImageDirPage.ID) and (not ValidateKey(Trim(KeyPage.Values[0]))) then
  begin
    MsgBox('Key 验证失败。请检查网络，或从网站重新复制个人 Key。', mbError, MB_OK);
    Result := False;
  end;
end;

function CliErrorMessage(ResultCode: Integer): String;
begin
  case ResultCode of
    20: Result := '检测到多个 WorkBuddy 配置文件。请让 WorkBuddy 重新运行安装命令并指定 /CONFIG。';
    21: Result := '未找到 WorkBuddy 配置文件。请先启动一次 WorkBuddy，或让 WorkBuddy 指定 /CONFIG。';
    22: Result := '安装码文件权限不安全，已拒绝读取。请从网站重新生成安装提示词。';
    23: Result := '安装码无效、已过期或已使用。请从网站重新生成安装提示词。';
    24: Result := '暂时无法连接安装服务，请检查网络后重试。';
    25: Result := '配置自检失败，原 WorkBuddy 配置已经恢复。可使用“修复配置”继续。';
    26: Result := 'WorkBuddy 配置结构无效，原文件未修改。请使用“修复配置”。';
    27: Result := '安装码已过期，请回网站重新生成。';
    28: Result := '安装码已经使用，请回网站重新生成。';
    29: Result := '个人 Key 已撤销或账户不可用，请回网站重新创建 Key。';
  else
    Result := 'WorkBuddy 配置写入失败，原配置已保留或恢复。';
  end;
end;

function CliErrorCode(ResultCode: Integer): String;
begin
  case ResultCode of
    20: Result := 'workbuddy_config_ambiguous';
    21: Result := 'workbuddy_config_not_found';
    22: Result := 'installation_token_file_insecure';
    23: Result := 'invalid_installation_token';
    24: Result := 'installation_exchange_unavailable';
    25: Result := 'workbuddy_config_self_check_failed';
    26: Result := 'workbuddy_config_invalid';
    27: Result := 'installation_token_expired';
    28: Result := 'installation_token_used';
    29: Result := 'api_key_invalid';
    30: Result := 'invalid_session';
    31: Result := 'account_suspended';
  else
    Result := 'installation_failed';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  KeyFile, Params, RootsValue: String;
begin
  if CurStep = ssPostInstall then
  begin
    RootsValue := ImageDirPage.Values[0];
    if RootsParam <> '' then RootsValue := RootsParam;
    KeyFile := '';
    try
      if TokenFileParam <> '' then
        Params := '"' + ExpandConstant('{app}\installer\config-cli.mjs') + '" install-token' +
          ' --gateway=https://xiaoyeai.cn' +
          ' --token-file="' + TokenFileParam + '"'
      else
      begin
        KeyFile := ExpandConstant('{tmp}\workbuddy-image-key.txt');
        SaveStringToFile(KeyFile, Trim(KeyPage.Values[0]), False);
        Params := '"' + ExpandConstant('{app}\installer\config-cli.mjs') + '" install' +
          ' --gateway=https://xiaoyeai.cn' +
          ' --key-file="' + KeyFile + '"';
      end;
      Params := Params +
        ' --roots="' + RootsValue + '"' +
        ' --install-dir="' + ExpandConstant('{app}') + '"';
      if ConfigPathParam <> '' then Params := Params + ' --config="' + ConfigPathParam + '"';
      if not Exec(ExpandConstant('{app}\runtime\node.exe'), Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
        ResultCode := 1;
      if ResultCode <> 0 then
      begin
        if ResultFileParam <> '' then SaveStringToFile(ResultFileParam, CliErrorCode(ResultCode), False);
        RaiseException(CliErrorMessage(ResultCode));
      end;
      if ResultFileParam <> '' then SaveStringToFile(ResultFileParam, 'installed', False);
    finally
      if TokenFileParam <> '' then DeleteFile(TokenFileParam);
      if KeyFile <> '' then DeleteFile(KeyFile);
    end;
  end;
end;
