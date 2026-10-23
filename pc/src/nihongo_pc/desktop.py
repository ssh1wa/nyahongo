"""PC 端的桌面窗口：后台起服务，用系统自带的 WebView（Windows 是 Edge WebView2，Mac 是 WKWebView）开一个独立窗口，
不用浏览器、也没有命令行窗口。关掉窗口就退出。

界面还是 web/ 里那套网页，手机照样通过局域网连这个服务下载学习包、同步进度。
"""

from __future__ import annotations

import sys
import threading
import time
import urllib.request
from pathlib import Path

from .config import PC_ROOT

PORT = 8765
TITLE = "にゃほんご PC 端"
APP_ID = "ssh1wa.nyahongo.pc"  # 任务栏分组用，和安装包里快捷方式的 AppUserModelID 一致
ICON = Path(__file__).parent / "web" / "icon.ico"


def _log_to_file() -> None:
    """pythonw 启动时没有控制台，输出写到 logs/app.log，出问题时能查"""
    if sys.stdout is not None and sys.stderr is not None:
        return
    logs = PC_ROOT / "logs"
    logs.mkdir(exist_ok=True)
    f = open(logs / "app.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115  # 整个进程都要用
    f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} 启动 =====\n")
    sys.stdout = sys.stderr = f


def _running(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/ping", timeout=1) as r:
            return b"nihongo-pc" in r.read()
    except OSError:
        return False


def _start_server(url: str):
    import uvicorn

    from . import server

    server._lan.update(enabled=True, port=PORT)
    threading.Thread(target=server._worker, daemon=True).start()
    srv = uvicorn.Server(uvicorn.Config(server.app, host="0.0.0.0", port=PORT, log_level="warning"))
    threading.Thread(target=srv.run, daemon=True).start()
    for _ in range(150):  # 最多等 15 秒
        if _running(url):
            return srv
        time.sleep(0.1)
    raise RuntimeError("PC 端的服务没能启动，看看 logs/app.log")


def _set_icon(window) -> None:
    """Windows 上窗口左上角和任务栏用白猫图标（不然是 Python 的图标）"""
    if sys.platform != "win32" or not ICON.exists():
        return
    try:
        from System import Action  # pythonnet，pywebview 在 Windows 上用的就是它
        from System.Drawing import Icon

        form = window.native
        # 要在界面线程上改，而且只能投递过去（BeginInvoke）：在这里直接改、或者用会等待的 Invoke，
        # 界面线程正在等 shown 事件处理完，两边互相等，整个程序（包括后台服务）都会卡死
        form.BeginInvoke(Action(lambda: setattr(form, "Icon", Icon(str(ICON)))))
    except Exception as e:  # 换不了图标不影响使用
        print("设置窗口图标失败：", e)


def run() -> None:
    _log_to_file()
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)

    import webview

    url = f"http://127.0.0.1:{PORT}"
    srv = None if _running(url) else _start_server(url)  # 已经开着一个就直接连过去
    window = webview.create_window(
        TITLE, url, width=1200, height=840, min_size=(860, 600), background_color="#f5f1e8", text_select=True,
    )
    window.events.shown += lambda: _set_icon(window)
    # private_mode=False：记住深色模式、上次的选项这些（存在 webview 文件夹里）
    webview.start(private_mode=False, storage_path=str(PC_ROOT / "webview"))
    if srv is not None:
        srv.should_exit = True
