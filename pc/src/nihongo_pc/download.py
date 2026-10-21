"""用 yt-dlp 从网页链接下载视频/音频，顺带取回人工日语字幕（如果有）。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import yt_dlp

from .config import Config

JA_SUB_LANGS = ["ja", "ja-JP", "jpn"]


@dataclass
class Downloaded:
    media: Path
    title: str
    source_url: str
    source_id: str
    subtitle: Path | None  # 人工字幕（.vtt），没有则为 None


def is_url(text: str) -> bool:
    return urlparse(text).scheme in ("http", "https")


def _needs_proxy(url: str, cfg: Config) -> bool:
    host = urlparse(url).hostname or ""
    return any(host == d or host.endswith("." + d) for d in cfg.download.proxy_domains)


def _progress_hook(on_progress: Callable[[float, str], None]):
    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        done = d.get("downloaded_bytes") or 0
        speed = d.get("speed")
        detail = f"{done / 1048576:.0f} MB"
        if total:
            detail += f" / {total / 1048576:.0f} MB"
        if speed:
            detail += f"  {speed / 1048576:.1f} MB/s"
        on_progress(min(done / total, 0.99) if total else 0, detail)

    return hook


def download(
    url: str,
    cfg: Config,
    audio_only: bool = False,
    on_progress: Callable[[float, str], None] | None = None,
) -> Downloaded:
    out_dir = cfg.workspace / "downloads"
    out_dir.mkdir(parents=True, exist_ok=True)
    h = cfg.download.max_height

    opts: dict = {
        "outtmpl": str(out_dir / "%(extractor)s_%(id)s.%(ext)s"),
        "noplaylist": True,
        # 通过 Python 调用时默认不重试；B 站 CDN 常在中途断开
        "retries": 10,
        "fragment_retries": 10,
        "continuedl": True,
        "http_chunk_size": 10 * 1024 * 1024,
        "ffmpeg_location": cfg.ffmpeg_path(),
        # 只要人工字幕；平台自动生成的字幕通常不如 Whisper
        "writesubtitles": True,
        "writeautomaticsub": False,
        "subtitleslangs": JA_SUB_LANGS,
        "subtitlesformat": "vtt/best",
        "postprocessors": [{"key": "FFmpegSubtitlesConvertor", "format": "vtt"}],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    if on_progress:
        opts["progress_hooks"] = [_progress_hook(on_progress)]
    if audio_only:
        opts["format"] = "bestaudio/best"
    else:
        opts["format"] = f"bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b"
        # 同等清晰度下优先 H.265/H.264（手机都能硬解，打包时可直接复制不用重新编码），
        # 其次才是 AV1/VP9
        opts["format_sort"] = [f"res:{h}", "vcodec:h265", "acodec:aac"]
        opts["merge_output_format"] = "mp4"
    if cfg.download.proxy and _needs_proxy(url, cfg):
        opts["proxy"] = cfg.download.proxy
    if cfg.download.cookies_from_browser:
        opts["cookiesfrombrowser"] = (cfg.download.cookies_from_browser,)

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if info.get("_type") == "playlist":
            raise RuntimeError("这是一个播放列表，第一版只支持单个视频链接")
        media = Path(ydl.prepare_filename(info))
        if not audio_only:
            media = media.with_suffix(".mp4")
        if not media.exists():  # 合并或转封装后扩展名可能变化
            candidates = sorted(media.parent.glob(media.stem + ".*"))
            candidates = [c for c in candidates if c.suffix not in (".vtt", ".part")]
            if not candidates:
                raise RuntimeError(f"下载完成但找不到媒体文件：{media}")
            media = candidates[0]

    subtitle = None
    for lang in JA_SUB_LANGS:
        sub = media.with_name(f"{media.stem}.{lang}.vtt")
        if sub.exists():
            subtitle = sub
            break

    return Downloaded(
        media=media,
        title=info.get("title") or media.stem,
        source_url=info.get("webpage_url") or url,
        source_id=f"{info.get('extractor_key', 'web')}_{info.get('id', media.stem)}",
        subtitle=subtitle,
    )


_VTT_TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})")
_VTT_TAG = re.compile(r"<[^>]+>")


def _vtt_seconds(text: str) -> float:
    m = _VTT_TIME.fullmatch(text.strip().split(" ")[0])
    if not m:
        raise ValueError(text)
    hours = int(m.group(1) or 0)
    return hours * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000


def parse_vtt(path: Path) -> list[dict]:
    """把 VTT 字幕解析成 [{start, end, text}]。"""
    segments: list[dict] = []
    blocks = re.split(r"\r?\n\r?\n", path.read_text(encoding="utf-8"))
    for block in blocks:
        lines = [line for line in block.splitlines() if line.strip()]
        for i, line in enumerate(lines):
            if "-->" not in line:
                continue
            start, end = (part.strip() for part in line.split("-->", 1))
            text = "".join(_VTT_TAG.sub("", t).strip() for t in lines[i + 1 :])
            if text:
                segments.append(
                    {"start": _vtt_seconds(start), "end": _vtt_seconds(end), "text": text}
                )
            break
    return segments
