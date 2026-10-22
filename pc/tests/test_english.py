import pytest

from nihongo_pc import english


def words(*items):
    """[(词, 开始, 结束)] → Whisper 风格的词列表（词前带空格）"""
    return [{"word": " " + w, "start": s, "end": e} for w, s, e in items]


def test_tokenize_keeps_spaces_and_punctuation():
    toks = english.tokenize("I'm gonna tell you, it's 3.5 dollars!")
    assert "".join(t["surface"] for t in toks) == "I'm gonna tell you, it's 3.5 dollars!"
    assert [t["surface"] for t in toks if t.get("word")] == ["I'm", "gonna", "tell", "you", "it's", "dollars"]


def test_split_on_sentence_end_but_not_abbreviation():
    raw = [{"words": words(("Mr.", 0, 0.3), ("Smith", 0.3, 0.6), ("left.", 0.6, 1.0), ("Then", 1.1, 1.3), ("what?", 1.3, 1.6))}]
    out = english.split_sentences(raw)
    assert [s["text"] for s in out] == ["Mr. Smith left.", "Then what?"]
    assert out[1]["start"] == 1.1


def test_split_on_long_pause():
    raw = [{"words": words(("so", 0, 0.2), ("anyway", 0.2, 0.6), ("look", 2.0, 2.3), ("here", 2.3, 2.6))}]
    assert [s["text"] for s in english.split_sentences(raw)] == ["so anyway", "look here"]


def test_long_sentence_splits_at_comma():
    items = [(f"w{i}," if i == 9 else f"w{i}", i * 0.6, i * 0.6 + 0.5) for i in range(20)]
    out = english.split_sentences([{"words": words(*items)}])
    assert len(out) == 2
    assert out[0]["text"].endswith("w9,")


@pytest.mark.skipif(not english.DB_PATH.exists(), reason="ECDICT 还没建库")
def test_lookup_restores_base_form():
    d = english.EnglishDict()
    assert d.lookup("went")["readings"] == ["go"]
    assert d.lookup("was")["readings"] == ["be"]
    assert d.lookup("better")["readings"] == ["better"]  # 自己就是常用词，不还原成 good
    assert d.lookup("sued")["readings"] == ["sue"]
    assert d.lookup("went")["id"] >= english.ID_OFFSET
    assert d.lookup("!!!") is None
