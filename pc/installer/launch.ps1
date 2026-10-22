# にゃほんご 电脑端的启动器（安装版用；开始菜单、桌面的快捷方式都指向它）。
# 第一次运行：没有 ffmpeg 就用 winget 装一个；uv 会自动下载 Python 和依赖（约 2.5 GB），之后就不用再下载。
# 用户自己下载源码的话，还是双击 pc\启动.bat。
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Host.UI.RawUI.WindowTitle = 'にゃほんご 电脑端（关掉这个窗口就停止了）'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$env:PATH = "$Root\bin;$env:PATH"
$env:PYTHONIOENCODING = 'utf-8'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
# 安装时勾了「国内网络」：语音识别模型从国内镜像下载
if (Test-Path "$Root\use-mirror.txt") { $env:HF_ENDPOINT = 'https://hf-mirror.com' }

function Pause-AndExit([int]$code) {
    Write-Host ''
    Read-Host '按回车关闭这个窗口'
    exit $code
}

function Find-Ffmpeg {
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { return $true }
    $links = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
    if (Test-Path $links) { return $true }
    $pkgs = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    return [bool](Get-ChildItem $pkgs -Filter 'Gyan.FFmpeg*' -Directory -ErrorAction SilentlyContinue |
        Get-ChildItem -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
}

Write-Host 'にゃほんご 电脑端' -ForegroundColor Yellow
Write-Host ''

if (-not (Find-Ffmpeg)) {
    Write-Host '第一次运行：正在安装 ffmpeg（处理音视频用，约 100 MB）……'
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Host '这台电脑没有 winget，没法自动安装 ffmpeg。' -ForegroundColor Red
        Write-Host '请从 https://www.gyan.dev/ffmpeg/builds/ 下载 ffmpeg，然后在 config.toml 的 [ffmpeg] 里填上 ffmpeg.exe 的路径。'
        Pause-AndExit 1
    }
    winget install -e --id Gyan.FFmpeg.Essentials --accept-package-agreements --accept-source-agreements --disable-interactivity
    if (-not (Find-Ffmpeg)) {
        Write-Host 'ffmpeg 安装失败。可以稍后重试，或者手动安装后再打开。' -ForegroundColor Red
        Pause-AndExit 1
    }
    Write-Host 'ffmpeg 装好了。' -ForegroundColor Green
}

if (-not (Test-Path "$Root\pc\.venv")) {
    Write-Host '第一次启动：正在下载 Python 和需要的组件（约 2.5 GB），网速慢的话要等十几分钟，只有这一次。' -ForegroundColor Cyan
    Write-Host '下载完会自动打开浏览器。'
    Write-Host ''
}

Set-Location "$Root\pc"
& "$Root\bin\uv.exe" run --frozen nihongo ui --lan
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Host ''
    Write-Host "电脑端意外退出了（代码 $code）。看看上面的报错；网络问题的话，重新打开一次通常就好。" -ForegroundColor Red
    Pause-AndExit $code
}
