"""Sudachi 分词 + 送假名对齐，输出 [{text, reading}] 注音分段。

对齐规则（和安卓端保持一致）：
- 只有含汉字的段才有 reading，假名、标点、数字、字母的 reading 为 None
- reading 一律用平假名
- 汉字和送假名分开：行き/いき → [行(い), き]
- 无法唯一对齐时整个词不注音，避免错位
"""

from __future__ import annotations

import re
from functools import lru_cache

KANJI = "kanji"
KANA = "kana"
OTHER = "other"


def char_type(ch: str) -> str:
    code = ord(ch)
    if (
        0x4E00 <= code <= 0x9FFF
        or 0x3400 <= code <= 0x4DBF
        or 0xF900 <= code <= 0xFAFF
        or ch in "々〆ヶヵ"
    ):
        return KANJI
    if 0x3041 <= code <= 0x309F or 0x30A0 <= code <= 0x30FF:
        return KANA
    return OTHER


def to_hiragana(text: str) -> str:
    return "".join(
        chr(ord(ch) - 0x60) if 0x30A1 <= ord(ch) <= 0x30F6 and ch not in "ヵヶ" else ch
        for ch in text
    )


def _runs(text: str) -> list[tuple[str, str]]:
    runs: list[tuple[str, str]] = []
    for ch in text:
        t = char_type(ch)
        if runs and runs[-1][0] == t:
            runs[-1] = (t, runs[-1][1] + ch)
        else:
            runs.append((t, ch))
    return runs


def _merge_plain(segments: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for seg in segments:
        if merged and seg["reading"] is None and merged[-1]["reading"] is None:
            merged[-1] = {"text": merged[-1]["text"] + seg["text"], "reading": None}
        else:
            merged.append(seg)
    return merged


def align(surface: str, reading: str | None) -> list[dict]:
    """把一个词的读音对齐到汉字上。"""
    plain = [{"text": surface, "reading": None}]
    if not surface or not reading:
        return plain
    runs = _runs(surface)
    if not any(t == KANJI for t, _ in runs):
        return plain
    reading = to_hiragana(reading)

    def pattern(lazy: bool) -> str:
        group = "(.+?)" if lazy else "(.+)"
        return "".join(
            group if t == KANJI else re.escape(to_hiragana(s) if t == KANA else s)
            for t, s in runs
        )

    lazy = re.fullmatch(pattern(True), reading)
    greedy = re.fullmatch(pattern(False), reading)
    if not lazy or not greedy or lazy.groups() != greedy.groups():
        return plain  # 对不齐或有多种切法

    groups = iter(lazy.groups())
    segments = [
        {"text": s, "reading": next(groups)} if t == KANJI else {"text": s, "reading": None}
        for t, s in runs
    ]
    return _merge_plain(segments)


@lru_cache(maxsize=1)
def _tokenizer():
    from sudachipy import Dictionary

    return Dictionary(dict="core").tokenizer()


def tokenize(text: str) -> list[dict]:
    """分词，并给每个词附上原形、读音、词性和注音分段。"""
    from sudachipy import SplitMode

    tokens = []
    for m in _tokenizer().tokenize(text, SplitMode.C):
        surface = m.surface()
        reading = to_hiragana(m.reading_form()) if m.reading_form() else None
        if reading == to_hiragana(surface):
            reading = None
        tokens.append(
            {
                "surface": surface,
                "base": m.dictionary_form(),
                "norm": m.normalized_form(),  # 标准化形：いる → 居る，用来区分同音词
                "reading": reading,
                "pos": m.part_of_speech()[0],
                "furigana": align(surface, reading),
            }
        )
    return tokens
