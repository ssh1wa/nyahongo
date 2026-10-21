"""LLM 校对的防护逻辑测试（用假的 chat_json，不调真实接口）。"""

import pytest

from nihongo_pc import refine
from nihongo_pc.config import LlmConfig
from nihongo_pc.furigana import tokenize


@pytest.fixture
def fake_llm(monkeypatch):
    replies = []
    monkeypatch.setattr(refine, "chat_json", lambda *a, **k: replies.pop(0))
    return replies


def test_text_keeps_light_edits_and_rejects_rewrites(fake_llm):
    fake_llm.append({"sentences": [
        {"id": 0, "text": "待て、諦めるのはまだ早い。", "zh": "等等，现在放弃还太早。"},
        {"id": 1, "text": "全然違う内容に書き換えられた文章です。", "zh": "x"},
    ]})
    out = refine.refine_text([{"text": "待て諦めるのはまだ早い", "start": 0, "end": 1},
                              {"text": "しかし", "start": 1, "end": 2}], LlmConfig(model="m"))
    assert out[0]["text"] == "待て、諦めるのはまだ早い。"
    assert out[0]["original"] == "待て諦めるのはまだ早い"
    assert out[0]["zh"] == "等等，现在放弃还太早。"
    assert out[1]["text"] == "しかし"  # 改写幅度太大，退回原文
    assert out[0]["start"] == 0 and out[1]["end"] == 2


def test_text_ignores_out_of_range_ids(fake_llm):
    fake_llm.append({"sentences": [{"id": 5, "text": "はい。", "zh": "是。"}]})
    out = refine.refine_text([{"text": "はい", "start": 0, "end": 1}], LlmConfig(model="m"))
    assert out[0]["text"] == "はい"


def sentence(text):
    return {"text": text, "tokens": tokenize(text)}


def index_of(tokens, surface, nth=0):
    return [i for i, t in enumerate(tokens) if t["surface"] == surface][nth]


def test_reading_fix_targets_one_occurrence(fake_llm):
    s = sentence("彼は上手に話すが、相手のほうが一枚上手だった。")
    second = index_of(s["tokens"], "上手", 1)
    fake_llm.append({"fixes": [{"id": 0, "n": second, "reading": "うわて"}]})
    assert refine.refine_readings([s], LlmConfig(model="m")) == 1
    first = s["tokens"][index_of(s["tokens"], "上手", 0)]
    assert first["reading"] == "じょうず"
    assert s["tokens"][second]["reading"] == "うわて"
    assert s["tokens"][second]["reading_auto"] == "じょうず"


def test_reading_fix_realigns_okurigana(fake_llm):
    s = sentence("予約していなかったので、入れませんでした。")
    n = index_of(s["tokens"], "入れ")
    fake_llm.append({"fixes": [{"id": 0, "n": n, "reading": "はいれ"}]})
    refine.refine_readings([s], LlmConfig(model="m"))
    assert s["tokens"][n]["furigana"] == [{"text": "入", "reading": "はい"}, {"text": "れ", "reading": None}]


@pytest.mark.parametrize("surface_sentence, surface, bad_reading", [
    ("一日中、家にいた。", "一", "いちにち"),  # 把相邻词的读音也算进来
    ("学校へ行く。", "行く", "かえる"),  # 送假名对不上
])
def test_reading_fix_rejects_implausible(fake_llm, surface_sentence, surface, bad_reading):
    s = sentence(surface_sentence)
    n = index_of(s["tokens"], surface)
    before = s["tokens"][n]["reading"]
    fake_llm.append({"fixes": [{"id": 0, "n": n, "reading": bad_reading}]})
    assert refine.refine_readings([s], LlmConfig(model="m")) == 0
    assert s["tokens"][n]["reading"] == before
