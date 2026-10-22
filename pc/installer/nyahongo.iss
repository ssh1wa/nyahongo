; にゃほんご 电脑端的安装程序（Inno Setup 6）。生成：在 pc\installer 里运行 build.ps1
; 装到当前用户自己的目录（不要管理员权限），电脑端会在安装目录里写配置、学习库、下载缓存。
; 安装包里只有代码、uv 和启动器；Python 和依赖第一次启动时由 uv 下载，ffmpeg 没有的话由启动器用 winget 装。

#define AppName "にゃほんご 电脑端"
#define AppVersion "0.2.0"
#define Repo "https://github.com/ssh1wa/nyahongo"

[Setup]
AppId={{6B0F2C4E-8D3A-4F7B-9E21-3C5A7D9B1E64}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=ssh1wa
AppPublisherURL={#Repo}
AppSupportURL={#Repo}/issues
DefaultDirName={autopf}\Nyahongo
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=nyahongo-pc-setup-{#AppVersion}
SetupIconFile=nyahongo.ico
UninstallDisplayIcon={app}\nyahongo.ico
LicenseFile=..\..\LICENSE
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "快捷方式："
Name: "mirror"; Description: "国内网络：语音识别模型从国内镜像（hf-mirror.com）下载"; GroupDescription: "下载："

[Files]
Source: "..\src\nihongo_pc\*"; DestDir: "{app}\pc\src\nihongo_pc"; Excludes: "__pycache__,*.pyc"; Flags: recursesubdirs ignoreversion
Source: "..\pyproject.toml"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\uv.lock"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\config.example.toml"; DestDir: "{app}\pc"; Flags: ignoreversion
; 配置文件只在第一次安装时生成，升级不会覆盖已经填好的 Key
Source: "..\config.example.toml"; DestDir: "{app}\pc"; DestName: "config.toml"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\uv.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "launch.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "nyahongo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "use-mirror.txt"; DestDir: "{app}"; Tasks: mirror; Flags: ignoreversion

[InstallDelete]
; 重新安装时没勾国内镜像，就去掉以前的标记
Type: files; Name: "{app}\use-mirror.txt"; Tasks: not mirror

[Icons]
Name: "{group}\{#AppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\nyahongo.ico"
Name: "{group}\填写 AI Key 和设置（config.toml）"; Filename: "{sys}\notepad.exe"; Parameters: """{app}\pc\config.toml"""
Name: "{group}\打开学习库文件夹"; Filename: "{app}\pc"
Name: "{group}\使用说明（GitHub）"; Filename: "{#Repo}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\nyahongo.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\notepad.exe"; Parameters: """{app}\pc\config.toml"""; Description: "现在填写 AI 的 API Key（可以以后再填）"; Flags: postinstall nowait skipifsilent unchecked
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; Description: "启动{#AppName}（第一次要下载约 2.5 GB 的组件）"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; 卸载时删掉下载的 Python 环境和缓存（很大）；学习库、配置、同步数据留着，免得误删学习记录
Type: filesandordirs; Name: "{app}\pc\.venv"
Type: filesandordirs; Name: "{app}\pc\src\nihongo_pc\__pycache__"
Type: files; Name: "{app}\use-mirror.txt"

[Messages]
chinesesimp.WelcomeLabel2=将在你的电脑上安装 [name/ver]。%n%n电脑端把视频、播客做成带字幕的学习包，手机上的にゃほんご App 连上电脑后下载学习。%n%n第一次启动会自动下载 Python 和需要的组件（约 2.5 GB），请保持网络畅通。
