"""完整处理流程：下载/导入 → 转写 → 分词注音 → 打包。命令行和网页界面共用。"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config
from .download import download, is_url, parse_vtt
from .package import build_subtitles, compress, make_thumbnail, package_id, write_package
from .transcribe import split_sentences, transcribe

STAGES = ["下载", "转写", "分词注音", "打包"]

# (阶段序号 0-3, 阶段内进度 0-1 或 None, 说明文字)
ProgressFn = Callable[[int, float | None, str], None]


class PipelineError(Exception):
    """可以直接展示给用户的错误。"""


class PackageExists(PipelineError):
    def __init__(self, pkg_id: str):
        super().__init__(f"学习包已存在：{pkg_id}")
        self.pkg_id = pkg_id


@dataclass
class Options:
    audio_only: bool = False
    force_whisper: bool = False  # 即使有人工字幕也用 Whisper
    retranscribe: bool = False  # 忽略转写缓存
    no_compress: bool = False
    overwrite: bool = False
    title: str | None = None  # 本地文件可以指定标题


@dataclass
class Result:
    pkg_dir: Path
    title: str
    sentence_count: int
    size_mb: float
    seconds: float


def _print_progress(stage: int, fraction: float | None, detail: str) -> None:
    pct = f" {fraction:6.1%}" if fraction is not None else ""
    print(f"\r[{stage + 1}/4] {STAGES[stage]}{pct}  {detail}".ljust(60), end="", flush=True)
    if fraction is None or fraction >= 1:
        print()


def package_exists(cfg: Config, pkg_id: str) -> bool:
    return (cfg.library / pkg_id / "meta.json").exists()


def run(source: str, cfg: Config, opts: Options, progress: ProgressFn = _print_progress) -> Result:
    started = time.time()

    if is_url(source):
        progress(0, 0, "获取视频信息")
        d = download(source, cfg, audio_only=opts.audio_only,
                     on_progress=lambda f, msg: progress(0, f, msg))
        media, title, url, sid, sub = d.media, d.title, d.source_url, d.source_id, d.subtitle
    else:
        media = Path(source).expanduser().resolve()
        if not media.exists():
            raise PipelineError(f"文件不存在：{media}")
        title, url, sid, sub = opts.title or media.stem, "", f"local_{media.stem}", None
    progress(0, 1, title)

    pkg_dir = cfg.library / package_id(sid)
    if package_exists(cfg, pkg_dir.name) and not opts.overwrite:
        raise PackageExists(pkg_dir.name)
    pkg_dir.mkdir(parents=True, exist_ok=True)

    if sub and not opts.force_whisper:
        progress(1, 1, "使用网站提供的人工日语字幕")
        sentences, sub_source, model = parse_vtt(sub), "manual", None
    else:
        model, sub_source = cfg.whisper.model, "whisper"
        # 原始转写按模型缓存，改断句规则后重跑不用再转写
        cache = cfg.workspace / "transcripts" / f"{pkg_dir.name}.{package_id(model)}.json"
        if cache.exists() and not opts.retranscribe:
            raw = json.loads(cache.read_text(encoding="utf-8"))
            progress(1, 1, "使用已缓存的转写结果")
        else:
            progress(1, 0, "加载 Whisper 模型")
            raw = transcribe(media, cfg.whisper, on_progress=lambda f: progress(1, f, "识别语音"))
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
            progress(1, 1, "转写完成")
        sentences = split_sentences(raw)
    if not sentences:
        raise PipelineError("没有识别到任何日语句子")

    progress(2, 0, f"{len(sentences)} 句")
    subtitles = build_subtitles(sentences, sub_source)
    progress(2, 1, f"{len(sentences)} 句")

    progress(3, None if opts.no_compress else 0, "压缩媒体")
    for old in pkg_dir.glob("media.*"):
        old.unlink()
    if opts.no_compress:
        packed = pkg_dir / ("media" + media.suffix)
        shutil.copy2(media, packed)
    else:
        packed = compress(media, pkg_dir, cfg, opts.audio_only)
    if packed.suffix == ".mp4":
        make_thumbnail(packed, pkg_dir, cfg.ffmpeg_path())
    write_package(pkg_dir, media=packed, title=title, source_url=url,
                  subtitles=subtitles, whisper_model=model)
    progress(3, 1, "完成")

    size = sum(f.stat().st_size for f in pkg_dir.iterdir()) / 1024 / 1024
    return Result(pkg_dir, title, len(sentences), size, time.time() - started)
