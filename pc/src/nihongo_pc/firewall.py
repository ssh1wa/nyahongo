"""Windows 防火墙：手机要连电脑，得放行 PC 端的端口。

Windows 对没有放行规则的程序，会直接丢掉从别的设备发来的连接，手机那边只会一直转圈、最后「连不上」。
正常情况下第一次监听端口时系统会弹出「是否允许访问」，但这个提示常常不出现（装了第三方安全软件、用 pythonw 后台启动、
程序路径变了），新用户就卡在这里。所以 PC 端自己检查有没有放行规则，没有就在界面上提示，点一下「一键放行」，
弹出 Windows 的管理员授权框，同意后加一条按端口放行的规则（不绑定程序路径，PC 端怎么更新都有效）。
"""

from __future__ import annotations

import base64
import subprocess
import sys

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def rule_name(port: int) -> str:
    return f"Nyahongo PC {port}"  # 安装包里加的规则也是这个名字


def needs_rule(port: int) -> bool:
    """Windows 上还没有放行这个端口的规则（别的系统不用）"""
    if sys.platform != "win32":
        return False
    try:
        r = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name(port)}"],
            capture_output=True, creationflags=NO_WINDOW, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False  # 查不了就不打扰用户
    return r.returncode != 0


def allow(port: int) -> bool:
    """弹出管理员授权框，加一条放行规则。用户拒绝授权或失败返回 False"""
    if sys.platform != "win32":
        return False
    args = (f'advfirewall firewall add rule name="{rule_name(port)}" dir=in action=allow '
            f"protocol=TCP localport={port} profile=any")
    script = f"$ErrorActionPreference='Stop'; Start-Process -FilePath netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '{args}'"
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")  # 避免引号在多层命令行里被吃掉
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
            capture_output=True, creationflags=NO_WINDOW, timeout=180,  # 等用户点授权框
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return not needs_rule(port)
