"""读取 config.toml；没有的项用默认值。"""

from __future__ import annotations

import os
import shutil
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

PC_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = PC_ROOT / "config.toml"


@dataclass
class DownloadConfig:
    proxy: str = ""  # 例如 http://127.0.0.1:7890，留空表示不用代理
    proxy_domains: list[str] = field(
        default_factory=lambda: ["youtube.com", "youtu.be", "nicovideo.jp"]
    )
    cookies_from_browser: str = ""  # 例如 "edge" / "chrome"，留空表示不读 Cookie
    max_height: int = 720


@dataclass
class WhisperConfig:
    model: str = "large-v3"
    device: str = "auto"  # auto / cuda / cpu
    compute_type: str = "auto"  # auto：GPU 用 float16，CPU 用 int8
    beam_size: int = 5
    initial_prompt: str = ""  # 可填角色名、专有名词，帮助识别


@dataclass
class LlmConfig:
    base_url: str = "https://api.deepinfra.com/v1/openai"
    api_key: str = ""  # 留空则读环境变量 NIHONGO_LLM_API_KEY
    model: str = ""

    def key(self) -> str:
        return self.api_key or os.environ.get("NIHONGO_LLM_API_KEY", "")


@dataclass
class Config:
    workspace: Path = PC_ROOT / "workspace"  # 下载的原始文件
    library: Path = PC_ROOT / "library"  # 生成的学习包，手机从这里同步
    ffmpeg: str = ""
    download: DownloadConfig = field(default_factory=DownloadConfig)
    whisper: WhisperConfig = field(default_factory=WhisperConfig)
    llm: LlmConfig = field(default_factory=LlmConfig)

    def ffmpeg_path(self) -> str:
        if self.ffmpeg:
            return self.ffmpeg
        found = shutil.which("ffmpeg")
        if found:
            return found
        # winget 装完后，当前终端的 PATH 可能还没刷新
        links = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Links/ffmpeg.exe"
        if links.exists():
            return str(links)
        packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/WinGet/Packages"
        for exe in packages.glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe"):
            return str(exe)
        raise RuntimeError("找不到 ffmpeg，请安装后重试，或在 config.toml 里填写 ffmpeg 路径")


def load_config(path: Path = CONFIG_PATH) -> Config:
    cfg = Config()
    if not path.exists():
        return cfg
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    paths = data.get("paths", {})
    if "workspace" in paths:
        cfg.workspace = (PC_ROOT / paths["workspace"]).resolve()
    if "library" in paths:
        cfg.library = (PC_ROOT / paths["library"]).resolve()
    cfg.ffmpeg = data.get("ffmpeg", {}).get("path", "")
    for key, value in data.get("download", {}).items():
        setattr(cfg.download, key, value)
    for key, value in data.get("whisper", {}).items():
        setattr(cfg.whisper, key, value)
    for key, value in data.get("llm", {}).items():
        setattr(cfg.llm, key, value)
    return cfg
