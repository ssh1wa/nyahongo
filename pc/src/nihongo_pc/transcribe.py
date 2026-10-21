"""用 faster-whisper 把音频转成带时间戳的日语句子。

分两步：transcribe() 得到 Whisper 原始分段（带词级时间戳，可缓存），
split_sentences() 再把它切成适合逐句精听的句子。
"""

from __future__ import annotations

import os
import site
import sys
from pathlib import Path
from typing import Callable

from .config import WhisperConfig

# 静音或纯音乐段上 Whisper 常编出的句子
HALLUCINATIONS = {
    "ご視聴ありがとうございました",
    "ご視聴ありがとうございました。",
    "チャンネル登録よろしくお願いします",
    "チャンネル登録お願いします",
    "最後までご視聴いただきありがとうございました",
}

SENTENCE_END = tuple("。？！?!")
HARD_GAP = 0.6  # 词间停顿超过这个秒数一定断句
SOFT_GAP = 0.15  # 句子太长时，只在至少这么长的停顿处切
MAX_SECONDS = 7.0  # 超过这个时长或字数就尝试再切
MAX_CHARS = 32


def _register_cuda_dlls() -> None:
    """Windows 上让 CTranslate2 找到 pip 装的 cuBLAS / cuDNN。"""
    if sys.platform != "win32":
        return
    for base in site.getsitepackages():
        for sub in ("nvidia/cublas/bin", "nvidia/cudnn/bin", "nvidia/cuda_nvrtc/bin"):
            d = Path(base) / sub
            if d.is_dir():
                os.add_dll_directory(str(d))
                os.environ["PATH"] = str(d) + os.pathsep + os.environ["PATH"]


_model_cache: dict[tuple, object] = {}


def _load_model(cfg: WhisperConfig):
    """加载模型；网页界面里连续处理多个视频时复用同一个模型。"""
    key = (cfg.model, cfg.device, cfg.compute_type)
    if key not in _model_cache:
        _model_cache.clear()  # 只留一个，显存有限
        _model_cache[key] = _create_model(cfg)
    return _model_cache[key]


def _create_model(cfg: WhisperConfig):
    _register_cuda_dlls()
    import ctranslate2
    from faster_whisper import WhisperModel

    device = cfg.device
    if device == "auto":
        device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    compute_type = cfg.compute_type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"
    return WhisperModel(cfg.model, device=device, compute_type=compute_type)


def transcribe(
    media: Path, cfg: WhisperConfig, on_progress: Callable[[float], None] | None = None
) -> list[dict]:
    """返回 Whisper 原始分段 [{start, end, text, words: [{start, end, word}]}]。"""
    model = _load_model(cfg)
    segments, info = model.transcribe(
        str(media),
        language="ja",
        beam_size=cfg.beam_size,
        word_timestamps=True,
        vad_filter=True,  # 跳过静音段，减少幻觉
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,  # 防止一句话错了之后连环重复
        initial_prompt=cfg.initial_prompt or None,
    )

    raw: list[dict] = []
    duration = info.duration or 1
    for seg in segments:
        if on_progress:
            on_progress(min(seg.end / duration, 0.99))
        if seg.text.strip() in HALLUCINATIONS:
            continue
        if seg.no_speech_prob > 0.6 and seg.avg_logprob < -1.0:
            continue
        words = [
            {"start": round(w.start, 3), "end": round(w.end, 3), "word": w.word}
            for w in seg.words or []
        ]
        if words:
            raw.append({"start": words[0]["start"], "end": words[-1]["end"],
                        "text": seg.text.strip(), "words": words})
    return raw


def _text(words: list[dict]) -> str:
    return "".join(w["word"] for w in words).strip()


def _too_long(words: list[dict]) -> bool:
    return words[-1]["end"] - words[0]["start"] > MAX_SECONDS or len(_text(words)) > MAX_CHARS


def _split_long(words: list[dict]) -> list[list[dict]]:
    """在最长的停顿处递归二分，直到不再过长或找不到像样的停顿。"""
    if len(words) < 2 or not _too_long(words):
        return [words]
    gaps = [(words[i]["start"] - words[i - 1]["end"], i) for i in range(1, len(words))]
    gap, at = max(gaps)
    if gap < SOFT_GAP:
        return [words]
    return _split_long(words[:at]) + _split_long(words[at:])


def split_sentences(raw: list[dict]) -> list[dict]:
    """按句末标点、明显停顿和长度，把原始分段切成句子 [{start, end, text}]。"""
    chunks: list[list[dict]] = []
    for seg in raw:
        current: list[dict] = []
        for word in seg["words"]:
            if current and word["start"] - current[-1]["end"] > HARD_GAP:
                chunks.append(current)
                current = []
            current.append(word)
            if word["word"].strip().endswith(SENTENCE_END):
                chunks.append(current)
                current = []
        if current:
            chunks.append(current)

    sentences = []
    for chunk in chunks:
        for part in _split_long(chunk):
            text = _text(part)
            if text:
                sentences.append({"start": part[0]["start"], "end": part[-1]["end"], "text": text})
    return sentences
