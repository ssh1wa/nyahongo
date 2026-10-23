# にゃほんご PC 端的启动器（开始菜单、桌面的快捷方式都指向它，在隐藏的窗口里运行）。
# 运行环境没准备好（第一次、升级后、ffmpeg 没装）就先打开 setup.ps1 的窗口准备，然后打开 PC 端窗口。
# 用户自己下载源码的话，还是双击 pc\启动.bat。
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$venv = "$Root\pc\.venv"
$ready = "$venv\nyahongo-ready.txt"

function Find-Ffmpeg {
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { return $true }
    if (Test-Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe')) { return $true }
    $pkgs = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    return [bool](Get-ChildItem $pkgs -Filter 'Gyan.FFmpeg*' -Directory -ErrorAction SilentlyContinue |
        Get-ChildItem -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-Ready {
    (Test-Path "$venv\Scripts\pythonw.exe") -and (Test-Path $ready) -and
        ((Get-Content $ready -ErrorAction SilentlyContinue) -eq (Get-FileHash "$Root\pc\uv.lock").Hash) -and (Find-Ffmpeg)
}

if (-not (Test-Ready)) {
    Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$Root\setup.ps1`"" -Wait
    if (-not (Test-Ready)) { exit 1 }  # 准备失败，setup 窗口里已经说明了原因
}

$env:PATH = "$Root\bin;$env:PATH"
Start-Process "$venv\Scripts\pythonw.exe" -ArgumentList '-m', 'nihongo_pc', 'app' -WorkingDirectory "$Root\pc"
