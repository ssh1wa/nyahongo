"""把媒体和字幕打包成手机能用的学习包。

library/<包 id>/
  media.mp4 或 media.m4a   压缩后的媒体
  subtitles.json            句子 + 分词 + 注音
  meta.json                 标题、来源、时长等
"""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

from .config import Config
from .furigana import tokenize

FORMAT_VERSION = 1


def package_id(source_id: str) -> str:
    return re.sub(r"[^\w\-]+", "_", source_id).strip("_")[:80]


_VIDEO_STREAM = re.compile(r"Video: (\w+).*?, (yuv\w+)[(,].*?(\d{2,5})x(\d{2,5})")
_AUDIO_STREAM = re.compile(r"Audio: (\w+)")


def probe(media: Path, ffmpeg: str) -> dict:
    """读出视频编码、像素格式、高度和音频编码；没有视频流时 vcodec 为 None。"""
    # ffmpeg -i 不带输出会以非 0 退出，但会把流信息打印到 stderr
    out = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(media)], capture_output=True, text=True, errors="replace"
    ).stderr
    info = {"vcodec": None, "pix_fmt": None, "height": 0, "acodec": None}
    if m := _VIDEO_STREAM.search(out):
        info.update(vcodec=m.group(1), pix_fmt=m.group(2), height=int(m.group(4)))
    if m := _AUDIO_STREAM.search(out):
        info["acodec"] = m.group(1)
    return info


def compress(media: Path, out_dir: Path, cfg: Config, audio_only: bool) -> Path:
    ffmpeg = cfg.ffmpeg_path()
    info = probe(media, ffmpeg)
    if audio_only or info["vcodec"] is None:
        out = out_dir / "media.m4a"
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(media),
               "-vn", "-c:a", "aac", "-b:a", "96k", str(out)]
        subprocess.run(cmd, check=True)
        return out

    out = out_dir / "media.mp4"
    h = cfg.download.max_height
    audio = ["-c:a", "copy"] if info["acodec"] == "aac" else ["-c:a", "aac", "-b:a", "96k"]

    # 已经是手机能硬解的格式就不重新编码：更快，也不会越压越大
    if (
        info["vcodec"] in ("h264", "hevc")
        and info["pix_fmt"] == "yuv420p"
        and info["height"] <= h
    ):
        tag = ["-tag:v", "hvc1"] if info["vcodec"] == "hevc" else []
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(media),
               "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", *tag, *audio,
               "-movflags", "+faststart", str(out)]
        subprocess.run(cmd, check=True)
        return out

    print(f"  重新编码视频（原格式 {info['vcodec']} / {info['pix_fmt']} / {info['height']}p）")
    base = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(media),
            "-vf", f"scale=-2:'min({h},ih)'", "-pix_fmt", "yuv420p",  # 手机硬解只认 4:2:0
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart"]
    # 优先用显卡编码 H.265；不行就退回 CPU 的 H.264
    nvenc = base + ["-c:v", "hevc_nvenc", "-preset", "p5", "-cq", "28", "-tag:v", "hvc1", str(out)]
    result = subprocess.run(nvenc, capture_output=True, text=True, errors="replace")
    if result.returncode != 0:
        reason = "，需要更新 NVIDIA 驱动" if "minimum required Nvidia driver" in result.stderr else ""
        print(f"  显卡编码不可用{reason}，改用 CPU 编码（较慢）")
        x264 = base + ["-c:v", "libx264", "-preset", "medium", "-crf", "24", str(out)]
        subprocess.run(x264, check=True)
    return out


def make_thumbnail(video: Path, pkg_dir: Path, ffmpeg: str) -> Path | None:
    """从视频大约 1/5 处截一帧做封面。失败也不影响学习包。"""
    out = pkg_dir / "thumb.jpg"
    duration = 0.0
    probe_out = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video)],
                               capture_output=True, text=True, errors="replace").stderr
    if m := re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", probe_out):
        duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{duration * 0.2:.1f}",
           "-i", str(video), "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(out)]
    return out if subprocess.run(cmd).returncode == 0 and out.exists() else None


def build_subtitles(sentences: list[dict], source: str) -> dict:
    return {
        "version": FORMAT_VERSION,
        "source": source,  # whisper / manual
        "sentences": [
            {
                "id": i,
                "start": s["start"],
                "end": s["end"],
                "text": s["text"],
                "tokens": tokenize(s["text"]),
            }
            for i, s in enumerate(sentences)
        ],
    }


def write_package(
    pkg_dir: Path,
    *,
    media: Path,
    title: str,
    source_url: str,
    subtitles: dict,
    whisper_model: str | None,
) -> None:
    meta = {
        "version": FORMAT_VERSION,
        "id": pkg_dir.name,
        "title": title,
        "source_url": source_url,
        "media": media.name,
        "media_type": "video" if media.suffix == ".mp4" else "audio",
        "duration": subtitles["sentences"][-1]["end"] if subtitles["sentences"] else 0,
        "sentence_count": len(subtitles["sentences"]),
        "subtitle_source": subtitles["source"],
        "whisper_model": whisper_model,
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    (pkg_dir / "subtitles.json").write_text(
        json.dumps(subtitles, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (pkg_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
