import pytest

from nihongo_pc.dictionary import DB_PATH, Dictionary, pos_labels
from nihongo_pc.furigana import tokenize

pytestmark = pytest.mark.skipif(not DB_PATH.exists(), reason="还没有建 JMdict 词库")


@pytest.fixture(scope="module")
def d():
    return Dictionary()


def lookup(d, sentence, surface):
    token = next(t for t in tokenize(sentence) if t["surface"] == surface)
    return d.lookup_token(token)


@pytest.mark.parametrize("sentence, surface, kanji, reading", [
    ("学校へ行きませんでした。", "行き", "行く", "いく"),
    ("家にいる。", "いる", "居る", "いる"),
    ("お金が要る。", "要る", "要る", "いる"),
    ("彼は料理が上手だ。", "上手", "上手", "じょうず"),
    ("明日は雨が降るでしょう。", "降る", "降る", "ふる"),
    ("ちょっと待って", "待っ", "待つ", "まつ"),
    ("本当に大丈夫？", "大丈夫", "大丈夫", "だいじょうぶ"),
    ("もう一度見る", "見る", "見る", "みる"),
])
def test_lookup_picks_right_entry(d, sentence, surface, kanji, reading):
    e = lookup(d, sentence, surface)
    assert e is not None
    assert kanji in e["k"]
    assert reading in e["r"]


def test_particles_are_not_looked_up(d):
    assert lookup(d, "学校へ行く", "へ") is None


def test_pos_labels():
    assert pos_labels(["v5k-s", "vi"]) == ["五段动词", "自动词"]
    assert pos_labels(["adj-na", "n"]) == ["ナ形容词", "名词"]
    assert pos_labels(["v1", "vt"]) == ["一段动词", "他动词"]
