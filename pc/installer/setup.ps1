# にゃほんご PC 端：第一次运行、升级后准备运行环境（launch.ps1 需要时会打开这个窗口，准备好就自动关掉）。
# 没有 ffmpeg 就用 winget 装一个；uv 下载 Python 和依赖（第一次约 2.5 GB，之后升级只下载变了的部分）。
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'にゃほんご PC 端：正在准备'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PATH = "$Root\bin;$env:PATH"
$env:PYTHONIOENCODING = 'utf-8'

function Fail([string]$msg) {
    Write-Host ''
    Write-Host $msg -ForegroundColor Red
    Read-Host '按回车关闭这个窗口'
    exit 1
}

function Find-Ffmpeg {
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { return $true }
    if (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')) { return $true }
    $pkgs = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    return [bool](Get-ChildItem $pkgs -Filter 'Gyan.FFmpeg*' -Directory -ErrorAction SilentlyContinue |
        Get-ChildItem -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
}

Write-Host 'にゃほんご PC 端：正在准备运行环境' -ForegroundColor Yellow
Write-Host '只有第一次和升级后需要，准备好会自动打开 PC 端。'
Write-Host ''

if (-not (Find-Ffmpeg)) {
    Write-Host '正在安装 ffmpeg（处理音视频用，约 100 MB）……'
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail '这台电脑没有 winget，没法自动安装 ffmpeg。请从 https://www.gyan.dev/ffmpeg/builds/ 下载 ffmpeg，打开 PC 端后在「设置」里填 ffmpeg.exe 的路径。'
    }
    winget install -e --id Gyan.FFmpeg.Essentials --accept-package-agreements --accept-source-agreements --disable-interactivity
    if (-not (Find-Ffmpeg)) { Fail 'ffmpeg 安装失败，可以稍后重新打开 PC 端再试。' }
    Write-Host 'ffmpeg 装好了。' -ForegroundColor Green
    Write-Host ''
}

if (-not (Test-Path "$Root\pc\.venv")) {
    Write-Host '正在下载 Python 和需要的组件（约 2.5 GB），网速慢的话要等十几分钟，只有这一次。' -ForegroundColor Cyan
} else {
    Write-Host '正在更新组件……' -ForegroundColor Cyan
}
Set-Location "$Root\pc"
& "$Root\bin\uv.exe" sync --frozen
if ($LASTEXITCODE -ne 0) { Fail "下载组件失败（代码 $LASTEXITCODE）。多半是网络问题，重新打开 PC 端会接着下载。" }

# 记下这次准备的依赖版本，launch.ps1 据此判断要不要再准备
(Get-FileHash "$Root\pc\uv.lock").Hash | Set-Content "$Root\pc\.venv\nyahongo-ready.txt" -Encoding ascii
Write-Host ''
Write-Host '准备好了，正在打开 PC 端。' -ForegroundColor Green
Start-Sleep -Seconds 1
