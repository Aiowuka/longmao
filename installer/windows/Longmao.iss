#define MyAppName "Longmao"
#ifndef MyAppVersion
  #define MyAppVersion "0.5.0"
#endif
#define MyAppPublisher "AIowuka"
#define MyAppExeName "Longmao Start.cmd"

[Setup]
AppId={{C65D80C6-78FD-4FF9-9889-7DF3B0A90B9A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\Longmao
DefaultGroupName=Longmao
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=LongmaoSetup-{#MyAppVersion}-win-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Longmao Start.cmd
SetupLogging=yes

[Files]
Source: "..\..\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*;artifacts\*;installer\windows\output\*;config\totoro.json;*.log"

[Icons]
Name: "{group}\Longmao"; Filename: "{app}\Longmao Start.cmd"; WorkingDir: "{app}"
Name: "{group}\Longmao Status"; Filename: "{app}\Longmao Status.cmd"; WorkingDir: "{app}"
Name: "{group}\Longmao Configure"; Filename: "{app}\Longmao Configure.cmd"; WorkingDir: "{app}"
Name: "{group}\Longmao Stop"; Filename: "{app}\Longmao Stop.cmd"; WorkingDir: "{app}"
Name: "{group}\Longmao Repair"; Filename: "{app}\Longmao Repair.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\Longmao"; Filename: "{app}\Longmao Start.cmd"; WorkingDir: "{app}"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\windows\bootstrap.ps1"" -InstallRoot ""{app}"" -LaunchAfterInstall"; Description: "安装运行依赖并启动 Longmao"; Flags: postinstall runascurrentuser

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\windows\stop.ps1"" -InstallRoot ""{app}"""; Flags: runhidden runascurrentuser; RunOnceId: "StopLongmao"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
