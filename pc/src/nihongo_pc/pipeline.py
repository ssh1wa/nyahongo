"""完整处理流程：下载/导入 → 转写 → 分词注音 → 打包。命令行和网页界面共用。"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config
from .dictionary import Dictionary, entry_for_package
from .download import download, is_url, parse_vtt
from .furigana import tokenize
from .package import build_subtitles, compress, make_thumbnail, package_id, write_package
from .refine import refine_readings, refine_text
from .transcribe import split_sentences, transcribe

STAGES = ["下载", "转写", "AI 校对", "分词查词", "打包"]

# (阶段序号 0-4, 阶段内进度 0-1 或 None, 说明文字)
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
    refine: bool = True  # 配置了 AI 接口时做校对、翻译和读音检查
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
    print(f"\r[{stage + 1}/{len(STAGES)}] {STAGES[stage]}{pct}  {detail}".ljust(60), end="", flush=True)
    if fraction is None or fraction >= 1:
        print()


def _refine_text_cached(cfg: Config, pkg_id: str, sentences: list[dict], on_progress) -> list[dict]:
    """AI 校对结果按"原文 + 模型"缓存，重新打包时不重复花钱。"""
    digest = hashlib.sha1(
        ("\n".join(s["text"] for s in sentences) + cfg.llm.model).encode("utf-8")
    ).hexdigest()[:12]
    cache = cfg.workspace / "refined" / f"{pkg_id}.{digest}.json"
    if cache.exists():
        on_progress(1)
        return json.loads(cache.read_text(encoding="utf-8"))
    refined = refine_text(sentences, cfg.llm, on_progress)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(refined, ensure_ascii=False), encoding="utf-8")
    return refined


_dictionary: Dictionary | None = None


def _attach_dictionary(cfg: Config, sentences: list[dict], translate: bool, progress) -> dict:
    """给每个词标上 JMdict 词条 id，返回学习包要带的词条表 {id: 词条}。"""
    global _dictionary
    if _dictionary is None:
        progress(0, "加载词典（第一次会下载并建库）")
        _dictionary = Dictionary()
    ids: list[int] = []
    for s in sentences:
        for t in s["tokens"]:
            e = _dictionary.lookup_token(t)
            if e:
                t["dict"] = e["id"]
                ids.append(e["id"])
    unique = list(dict.fromkeys(ids))
    zh = (_dictionary.translate(unique, cfg.llm, on_progress=lambda f: progress(f, "翻译词条释义"))
          if translate else _dictionary.get_zh(unique))
    return {str(i): entry_for_package(_dictionary.get(i), zh.get(i)) for i in unique}


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

    use_llm = opts.refine and bool(cfg.llm.key() and cfg.llm.model)
    refined_by = None
    if use_llm:
        sentences = _refine_text_cached(cfg, pkg_dir.name, sentences,
                                        lambda f: progress(2, f, "加标点、校对错字、整句翻译"))
        refined_by = cfg.llm.model
        progress(2, 1, f"校对了 {sum(1 for s in sentences if 'original' in s)} 句")
    else:
        progress(2, 1, "跳过（没有配置 AI 接口）" if opts.refine else "跳过")

    progress(3, 0, f"分词 {len(sentences)} 句")
    for s in sentences:
        s["tokens"] = tokenize(s["text"])
    if use_llm:
        fixed = refine_readings(sentences, cfg.llm, lambda f: progress(3, f * 0.4, "AI 检查读音"))
        progress(3, 0.4, f"修正了 {fixed} 处读音")
    dictionary = _attach_dictionary(cfg, sentences, use_llm, lambda f, msg: progress(3, 0.4 + f * 0.6, msg))
    subtitles = build_subtitles(sentences, sub_source)
    progress(3, 1, f"{len(sentences)} 句 · {len(dictionary)} 个词条")

    progress(4, None if opts.no_compress else 0, "压缩媒体")
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
                  subtitles=subtitles, whisper_model=model,
                  dictionary=dictionary, refined_by=refined_by)
    progress(4, 1, "完成")

    size = sum(f.stat().st_size for f in pkg_dir.iterdir()) / 1024 / 1024
    return Result(pkg_dir, title, len(sentences), size, time.time() - started)
