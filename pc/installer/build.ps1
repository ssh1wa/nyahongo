# 生成电脑端安装包：pc\installer\Output\nyahongo-pc-setup-<版本>.exe
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

# 「国内网络」选项装上的标记文件，内容不重要
Set-Content use-mirror.txt '安装时选了国内网络：语音识别模型从 hf-mirror.com 下载。删掉这个文件就改回官方源。' -Encoding utf8

# 图标：用 App 的图标生成多尺寸 ico
uv run --with pillow --no-project python -I -c @"
from PIL import Image
im = Image.open(r'..\..\app\assets\icon.png').convert('RGBA')
im.save('nyahongo.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
"@

& $iscc /Q nyahongo.iss
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 出错（$LASTEXITCODE）" }
Get-ChildItem Output\*.exe | ForEach-Object { '{0}  {1:N1} MB' -f $_.FullName, ($_.Length / 1MB) }
