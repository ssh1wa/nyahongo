"""用 faster-whisper 把音频转成带时间戳的日语句子。

分两步：transcribe() 得到 Whisper 原始分段（带词级时间戳，可缓存），
split_sentences() 再把它切成适合逐句精听的句子。
"""

from __future__ import annotations

import os
import re
import site
import sys
from pathlib import Path
from typing import Callable

from .config import WhisperConfig
from .furigana import tokenize

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
MAX_WORD_SECONDS = 2.5  # 单个词超过这么长，多半是时间戳把音乐也算进去了
SECONDS_PER_CHAR = 0.3  # 估算正常语速下一个字的时长
STRAY_GAP = 5.0  # 同一分段内超过这个空白，前面的碎片视为时间戳错位
STRAY_CHARS = 3  # 只挪这么短的碎片，长的当作真实的话
_CJK_SPACE = re.compile(r"(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])")


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
    # Whisper 的词有时带前导空格，日文字符之间的空格去掉（英文单词之间的保留）
    return _CJK_SPACE.sub("", "".join(w["word"] for w in words)).strip()


def _too_long(words: list[dict]) -> bool:
    return words[-1]["end"] - words[0]["start"] > MAX_SECONDS or len(_text(words)) > MAX_CHARS


def _inside_word(left: list[dict], right: list[dict]) -> bool:
    """left 和 right 之间的边界是否落在一个词的内部（各|自、本|日），这种地方不能断句。"""
    tail = _text(left)[-8:]
    head = _text(right)[:8]
    if not tail or not head:
        return False
    pos = 0
    for t in tokenize(tail + head):
        end = pos + len(t["surface"])
        if pos < len(tail) < end:
            return True
        pos = end
    return False


def _repair_timing(words: list[dict]) -> list[dict]:
    """修正 Whisper 在音乐段附近给出的错位时间戳。

    同一个分段里出现几十秒的空白，说明前面零星几个字的时间被拉散到了音乐上
    （实测：「本日の授業」里「日」一个字占了 15 秒，后面的话在 90 秒之后）。
    这种零星的字挪到后面那段话的前面；单个字持续好几秒的，也压缩到正常的说话长度。
    """
    out = [dict(w) for w in words]
    for w in out:
        chars = max(1, len(w["word"].strip()))
        if w["end"] - w["start"] > MAX_WORD_SECONDS:
            # 只缩短不拉长：字数多的片段按语速算出来可能比实际还长
            w["start"] = round(max(w["start"], w["end"] - SECONDS_PER_CHAR * chars), 3)
    # 从后往前：被长空白隔开的短碎片，贴到下一个词前面
    for i in range(len(out) - 2, -1, -1):
        w, nxt = out[i], out[i + 1]
        if nxt["start"] - w["end"] > STRAY_GAP and len(w["word"].strip()) <= STRAY_CHARS:
            dur = min(w["end"] - w["start"], SECONDS_PER_CHAR * max(1, len(w["word"].strip())))
            w["end"] = nxt["start"]
            w["start"] = round(nxt["start"] - dur, 3)
    return out


def _split_long(words: list[dict]) -> list[list[dict]]:
    """在最长的停顿处递归二分，直到不再过长或找不到像样的停顿。不在词的中间切。"""
    if len(words) < 2 or not _too_long(words):
        return [words]
    gaps = sorted(((words[i]["start"] - words[i - 1]["end"], i) for i in range(1, len(words))), reverse=True)
    for gap, at in gaps:
        if gap < SOFT_GAP:
            break
        if not _inside_word(words[:at], words[at:]):
            return _split_long(words[:at]) + _split_long(words[at:])
    return [words]


def split_sentences(raw: list[dict]) -> list[dict]:
    """按句末标点、明显停顿和长度，把原始分段切成句子 [{start, end, text}]。"""
    chunks: list[list[dict]] = []
    for seg in raw:
        current: list[dict] = []
        for word in _repair_timing(seg["words"]):
            if (current and word["start"] - current[-1]["end"] > HARD_GAP
                    and not _inside_word(current, [word])):
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
