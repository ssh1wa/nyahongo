"""命令行入口。

  nihongo add <链接或本地文件> [--audio-only] [--force-whisper] [--retranscribe] [--no-compress]
  nihongo list
  nihongo menu
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .config import load_config
from .pipeline import Options, PackageExists, PipelineError, run


def cmd_add(args: argparse.Namespace) -> None:
    opts = Options(audio_only=args.audio_only, force_whisper=args.force_whisper,
                   retranscribe=args.retranscribe, no_compress=args.no_compress,
                   overwrite=args.overwrite, lang=args.lang)
    try:
        r = run(args.source, load_config(), opts)
    except PackageExists as e:
        sys.exit(f"{e}（加 --overwrite 重新生成）")
    except PipelineError as e:
        sys.exit(str(e))
    print(f"完成：{r.pkg_dir}（{r.sentence_count} 句，{r.size_mb:.1f} MB，用时 {r.seconds:.0f} 秒）")


def cmd_list(_: argparse.Namespace) -> None:
    cfg = load_config()
    metas = sorted(cfg.library.glob("*/meta.json")) if cfg.library.exists() else []
    if not metas:
        print("学习库是空的")
        return
    for path in metas:
        m = json.loads(path.read_text(encoding="utf-8"))
        minutes = m["duration"] / 60
        print(f"{m['id']:<40} {minutes:5.1f} 分  {m['sentence_count']:4} 句  {m['title']}")


MENU = """
==============================
  日语学习包生成工具
==============================
  1. 视频链接 / 本地视频文件
  2. 只要音频（播客）
  3. 查看已有学习包
  4. 打开学习包文件夹
  0. 退出
"""


def _ask(prompt: str) -> str | None:
    try:
        return input(prompt).strip()
    except EOFError:  # 输入流结束（比如窗口被关掉），直接退出
        return None


def _run_add(source: str, audio_only: bool) -> None:
    args = argparse.Namespace(source=source, audio_only=audio_only, force_whisper=False,
                              retranscribe=False, no_compress=False, overwrite=False)
    try:
        cmd_add(args)
    except SystemExit as e:  # cmd_add 用 sys.exit 报告"已存在"等情况
        message = str(e.code or "")
        print(message)
        if "已存在" in message and _ask("要覆盖重新生成吗？(y/N)：") in ("y", "Y"):
            args.overwrite = True
            cmd_add(args)
    except Exception as e:  # 菜单里出错不退出，方便接着处理下一个
        print(f"出错了：{type(e).__name__}: {e}")


def cmd_menu(_: argparse.Namespace) -> None:
    while True:
        print(MENU)
        choice = _ask("请选择：")
        if choice is None or choice == "0":
            return
        if choice in ("1", "2"):
            source = _ask("粘贴链接，或把文件拖进窗口后按回车：")
            if source:
                _run_add(source.strip('"'), audio_only=choice == "2")
        elif choice == "3":
            cmd_list(_)
        elif choice == "4":
            library = load_config().library
            library.mkdir(parents=True, exist_ok=True)
            os.startfile(library)


def cmd_ui(args: argparse.Namespace) -> None:
    from .server import serve

    serve(port=args.port, open_browser=not args.no_browser, lan=args.lan)


def main() -> None:
    # Windows 终端默认可能不是 UTF-8，日语会乱码
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(prog="nihongo", description="日语学习包生成工具")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="从链接或本地文件生成学习包")
    add.add_argument("source", help="网页链接或本地媒体文件路径")
    add.add_argument("--audio-only", action="store_true", help="只保留音频（播客）")
    add.add_argument("--force-whisper", action="store_true", help="即使有人工字幕也用 Whisper 转写")
    add.add_argument("--retranscribe", action="store_true", help="忽略缓存，重新用 Whisper 转写")
    add.add_argument("--no-compress", action="store_true", help="不压缩，直接复制原文件")
    add.add_argument("--overwrite", action="store_true", help="覆盖已存在的学习包")
    add.add_argument("--lang", choices=["ja", "en"], default="ja", help="视频的语言；en 是英语模式（测试版：双语字幕 + 点词查词）")
    add.set_defaults(func=cmd_add)

    ls = sub.add_parser("list", help="列出已有学习包")
    ls.set_defaults(func=cmd_list)

    menu = sub.add_parser("menu", help="交互式菜单")
    menu.set_defaults(func=cmd_menu)

    ui = sub.add_parser("ui", help="打开网页界面（启动.bat 用的就是这个）")
    ui.add_argument("--port", type=int, default=8765)
    ui.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    ui.add_argument("--lan", action="store_true", help="允许同一局域网的手机读取和下载学习包")
    ui.set_defaults(func=cmd_ui)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
