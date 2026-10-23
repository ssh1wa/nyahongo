; にゃほんご PC 端（Windows 版）的安装程序（Inno Setup 6）。生成：在 pc\installer 里运行 build.ps1
; 装到当前用户自己的目录（不要管理员权限），PC 端会在安装目录里写配置、学习库、下载缓存。
; 安装包里只有代码、uv 和启动器；Python 和依赖第一次启动时由 setup.ps1 用 uv 下载，ffmpeg 没有的话用 winget 装。
; 打开以后是独立的窗口（pywebview），不用浏览器、没有命令行窗口。

#define AppName "にゃほんご PC 端"
#define AppVersion "0.3.0"
#define AppId "ssh1wa.nyahongo.pc"
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
; 0.2 叫「电脑端」：升级时不沿用旧的开始菜单文件夹名
UsePreviousGroup=no
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
Name: "mirror"; Description: "国内网络：语音识别模型从国内镜像（hf-mirror.com）下载（以后可以在设置里改）"; GroupDescription: "下载："

[Files]
Source: "..\src\nihongo_pc\*"; DestDir: "{app}\pc\src\nihongo_pc"; Excludes: "__pycache__,*.pyc"; Flags: recursesubdirs ignoreversion
Source: "..\pyproject.toml"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\uv.lock"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}\pc"; Flags: ignoreversion
Source: "..\config.example.toml"; DestDir: "{app}\pc"; Flags: ignoreversion
; 配置文件只在第一次安装时生成，升级不会覆盖已经填好的 Key。勾了「国内网络」用打开镜像的那一份（build.ps1 生成）
Source: "..\config.example.toml"; DestDir: "{app}\pc"; DestName: "config.toml"; Tasks: not mirror; Flags: onlyifdoesntexist uninsneveruninstall
Source: "config.mirror.toml"; DestDir: "{app}\pc"; DestName: "config.toml"; Tasks: mirror; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\uv.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "launch.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "nyahongo.ico"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; 旧版（0.2）用的启动方式留下的文件
Type: files; Name: "{app}\use-mirror.txt"
Type: filesandordirs; Name: "{userprograms}\にゃほんご 电脑端"
Type: files; Name: "{userdesktop}\にゃほんご 电脑端.lnk"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\nyahongo.ico"; AppUserModelID: "{#AppId}"
Name: "{group}\使用说明（GitHub）"; Filename: "{#Repo}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\nyahongo.ico"; AppUserModelID: "{#AppId}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\launch.ps1"""; WorkingDir: "{app}"; Description: "现在打开{#AppName}（第一次要下载约 2.5 GB 的组件）"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; 卸载时删掉下载的 Python 环境和缓存（很大）；学习库、配置、同步数据留着，免得误删学习记录
Type: filesandordirs; Name: "{app}\pc\.venv"
Type: filesandordirs; Name: "{app}\pc\src\nihongo_pc\__pycache__"
Type: filesandordirs; Name: "{app}\pc\webview"

[Messages]
chinesesimp.WelcomeLabel2=将在你的电脑上安装 [name/ver]（Windows 版）。%n%nPC 端把视频、播客做成带字幕的学习包，手机上的にゃほんご App 连上电脑后下载学习。%n%n第一次启动会自动下载 Python 和需要的组件（约 2.5 GB），请保持网络畅通。
