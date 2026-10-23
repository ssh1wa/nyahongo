"""用 LLM 校对字幕：加标点、改明显的识别错误、整句中文翻译、修正读音。

防止 LLM 改写原句：
- 句子编号和数量不许变（时间戳跟着句子走）
- 校对后和原文差异太大（相似度低于 MIN_SIMILARITY）的句子退回原文
- 读音修正必须能和汉字对齐，否则不采用
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from typing import Callable

from .config import LlmConfig
from .furigana import KANJI, align, char_type, to_hiragana
from .llm import LlmError, chat_json

BATCH = 30  # 每次请求的句子数
PARALLEL = 4  # 同时发出的请求数
CONTEXT = 4  # 每批前面附带几句上文（只读），帮助理解
MIN_SIMILARITY = 0.6
_PUNCT = re.compile(r"[\s、。，,．.！!？?「」『』（）()…・〜~ー—\-]")


def _similar(a: str, b: str) -> float:
    a, b = _PUNCT.sub("", a), _PUNCT.sub("", b)
    if not a and not b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


TEXT_PROMPT = """你是日语字幕校对。输入是语音识别（Whisper）生成的日语字幕，往往没有标点，偶尔有同音字或听错的词。
对每一句：
1. text：加上自然的日语标点（、。？！「」等）；只修正明显的识别错误（同音错字、错误的汉字写法、明显听错的词），可以参考上下文判断。不要改写、润色、补全或删减内容，口语、语气词、重复保持原样。
2. zh：给出自然、准确的简体中文翻译。
如果有 glossary（这部作品的人名、地名等专有名词，括号里是读音）：识别结果里读音相近、写法不对的人名或专有名词，按上下文改成 glossary 里的写法（例如角色「唯（ゆい）」被听成「優美」「由比」，改成「唯」）；用假名写的人名保持原样。
句子的 id 和数量必须与输入一致，不要合并或拆分句子。context 里的句子只用来理解上下文，不要输出。
只返回 JSON：{"sentences":[{"id":0,"text":"校对后的日语","zh":"中文翻译"}]}"""

READING_PROMPT = """你是日语读音校对。下面每句日语里的汉字词标成了 [编号:写法|读音]，读音是自动分词器给的平假名。
自动分词器不懂上下文，常见错误：
- 一词多读：人気（にんき/ひとけ）、上手（じょうず/うわて）、方（かた/ほう）、何（なに/なん）、今日（きょう/こんにち）、一日（いちにち/ついたち）
- 动词可能形被当成别的动词：「入れませんでした」在"进不去"的意思里是 入る 的可能形，读 はいれ，不是 いれ（放入）
- 人名地名、熟字训、连浊
如果输入带 glossary（这部作品的人名、地名，括号里是读音）：只有写法和 glossary 完全相同的词才按 glossary 的读音，写法不同的词不要套用。
逐个检查，只列出在这个上下文里读错的词：给出句子 id、编号 n，以及这个写法在此处的正确平假名读音（送假名也要包含在内，和写法完整对应）。读对的不要列出。
只返回 JSON：{"fixes":[{"id":句子id,"n":编号,"reading":"正确读音"}]}，没有错误就返回 {"fixes":[]}"""


def refine_text(
    sentences: list[dict], llm: LlmConfig, on_progress: Callable[[float], None] | None = None,
    glossary: list[str] | None = None,
) -> list[dict]:
    """返回新列表：每句加上 text（校对后）和 zh（中文翻译），保留 start/end。glossary：作品的专有名词"""
    out = [dict(s) for s in sentences]

    def request(start: int):
        # 上文取未校对的原文，各批互不依赖，可以并发
        payload = {
            "context": [s["text"] for s in sentences[max(0, start - CONTEXT) : start]],
            "sentences": [{"id": start + i, "text": s["text"]}
                          for i, s in enumerate(sentences[start : start + BATCH])],
        }
        if glossary:
            payload["glossary"] = glossary
        return chat_json(llm, [
            {"role": "system", "content": TEXT_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ], temperature=0.1, max_tokens=8000)

    for start, result in _run_batches(len(out), request, "校对", on_progress):
        items = result.get("sentences", []) if isinstance(result, dict) else []
        for item in items:
            try:
                idx = int(item.get("id"))
            except (TypeError, ValueError):
                continue
            if not start <= idx < min(start + BATCH, len(out)):
                continue
            s = out[idx]
            text = str(item.get("text") or "").strip()
            if text and _similar(s["text"], text) >= MIN_SIMILARITY:
                if text != s["text"]:
                    s["original"] = s["text"]
                s["text"] = text
            zh = str(item.get("zh") or "").strip()
            if zh:
                s["zh"] = zh
    return out


def _run_batches(total: int, request: Callable[[int], dict], label: str,
                 on_progress: Callable[[float], None] | None):
    """并发请求每一批（参数是批的起始下标），在调用方线程里按完成顺序逐个返回 (start, 结果)。"""
    starts = list(range(0, total, BATCH))
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        futures = {pool.submit(request, s): s for s in starts}
        for done, future in enumerate(as_completed(futures), 1):
            start = futures[future]
            try:
                result = future.result()
            except LlmError as e:
                print(f"  第 {start + 1} 句起的{label}失败（{e}），这批保持原样")
                result = None
            if result is not None:
                yield start, result
            if on_progress:
                on_progress(done / len(starts))


def _has_kanji_reading(t: dict) -> bool:
    return bool(t.get("reading")) and any(char_type(c) == KANJI for c in t["surface"])


def _annotated(tokens: list[dict]) -> str:
    """汉字词标成 [token 下标:写法|读音]，修正时按下标定位，同一句里重复出现的词不会改错。"""
    return "".join(
        f"[{i}:{t['surface']}|{t['reading']}]" if _has_kanji_reading(t) else t["surface"]
        for i, t in enumerate(tokens)
    )


def refine_readings(
    sentences: list[dict], llm: LlmConfig, on_progress: Callable[[float], None] | None = None,
    glossary: list[str] | None = None,
) -> int:
    """就地修正 sentences[i]['tokens'] 里的读音，返回修正了多少处。"""
    fixed = 0
    # 词表的读音 → 写法：词表里的读音只能给同样写法的词（AI 会把「唯（ゆい）」的读音套到「唯美」上）
    glossary_kana: dict[str, set[str]] = {}
    for g in glossary or []:
        if m := re.fullmatch(r"(.+)（(.+)）", g):
            glossary_kana.setdefault(m.group(2), set()).add(m.group(1))
    # 标注文本先在主线程里生成好，工作线程只发请求
    annotated = [_annotated(s["tokens"]) for s in sentences]

    def request(start: int):
        lines = [{"id": start + i, "text": annotated[start + i]}
                 for i, s in enumerate(sentences[start : start + BATCH])
                 if any(_has_kanji_reading(t) for t in s["tokens"])]
        if not lines:
            return {"fixes": []}
        return chat_json(llm, [
            {"role": "system", "content": READING_PROMPT},
            {"role": "user", "content": json.dumps({"glossary": glossary, "lines": lines} if glossary else lines,
                                                   ensure_ascii=False)},
        ], temperature=0.0, max_tokens=4000)

    for start, result in _run_batches(len(sentences), request, "读音校对", on_progress):
        for fix in result.get("fixes", []) if isinstance(result, dict) else []:
            try:
                idx, n = int(fix.get("id")), int(fix.get("n"))
            except (TypeError, ValueError):
                continue
            if not start <= idx < min(start + BATCH, len(sentences)):
                continue
            tokens = sentences[idx]["tokens"]
            reading = to_hiragana(str(fix.get("reading") or "").strip())
            if not 0 <= n < len(tokens) or not reading or not _has_kanji_reading(tokens[n]):
                continue
            t = tokens[n]
            if t["reading"] == reading or (reading in glossary_kana and t["surface"] not in glossary_kana[reading]):
                continue
            furigana = align(t["surface"], reading)
            # 对不齐说明给的读音和写法不匹配，不采用；
            # 平均每个汉字超过 3 个假名，多半是把相邻词的读音也算进来了（一 → いちにち）
            ruby = [seg for seg in furigana if seg["reading"]]
            kana_per_kanji = sum(len(s["reading"]) for s in ruby) / max(1, sum(len(s["text"]) for s in ruby))
            if ruby and kana_per_kanji <= 3:
                t["reading_auto"] = t["reading"]
                t["reading"] = reading
                t["furigana"] = furigana
                fixed += 1
    return fixed
