# 生成 PC 端（Windows 版）安装包：pc\installer\Output\nyahongo-pc-setup-<版本>.exe
# 需要：Inno Setup 6（winget install JRSoftware.InnoSetup）、uv（会把本机的 uv.exe 打进安装包）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw '找不到 Inno Setup：先运行 winget install JRSoftware.InnoSetup' }

$uv = (Get-Command uv -ErrorAction Stop).Source
New-Item -ItemType Directory -Force bin | Out-Null
Copy-Item $uv bin\uv.exe -Force

# 安装时勾了「国内网络」用的配置：和模板一样，只是打开了模型镜像
$cfg = Get-Content ..\config.example.toml -Raw -Encoding utf8
if ($cfg -notmatch 'hf_mirror = false') { throw 'config.example.toml 里找不到 hf_mirror = false' }
[IO.File]::WriteAllText("$PSScriptRoot\config.mirror.toml", ($cfg -replace 'hf_mirror = false', 'hf_mirror = true '), [Text.UTF8Encoding]::new($false))

# 图标：用 App 的图标生成多尺寸 ico
uv run --with pillow --no-project python -I -c @"
from PIL import Image
im = Image.open(r'..\..\app\assets\icon.png').convert('RGBA')
im.save('nyahongo.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
"@

# 版本号只在 __init__.py 里写一处
$init = Get-Content ..\src\nihongo_pc\__init__.py -Raw -Encoding utf8
if ($init -notmatch '__version__ = "([\d.]+)"') { throw '__init__.py 里找不到 __version__' }
$version = $Matches[1]

& $iscc /Q "/DAppVersion=$version" nyahongo.iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 出错（$LASTEXITCODE）" }
Get-ChildItem Output\*.exe | ForEach-Object { '{0}  {1:N1} MB' -f $_.FullName, ($_.Length / 1MB) }
