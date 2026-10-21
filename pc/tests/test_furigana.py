from nihongo_pc.furigana import align, to_hiragana, tokenize


def r(text, reading=None):
    return {"text": text, "reading": reading}


def test_kanji_only():
    assert align("学校", "ガッコウ") == [r("学校", "がっこう")]


def test_okurigana_split():
    assert align("行きませんでした", "いきませんでした") == [r("行", "い"), r("きませんでした")]


def test_kana_inside_word():
    assert align("取り扱い", "とりあつかい") == [r("取", "と"), r("り"), r("扱", "あつか"), r("い")]


def test_prefix_kana():
    assert align("お茶", "おちゃ") == [r("お"), r("茶", "ちゃ")]


def test_pure_kana_has_no_reading():
    assert align("ゲーム", "げーむ") == [r("ゲーム")]
    assert align("きます", "きます") == [r("きます")]


def test_katakana_reading_is_normalized():
    assert align("食べる", "タベル") == [r("食", "た"), r("べる")]


def test_mismatch_falls_back_to_plain():
    assert align("行き", "かえり") == [r("行き")]


def test_iteration_mark():
    assert align("人々", "ひとびと") == [r("人々", "ひとびと")]


def test_digits_cannot_align():
    assert align("3人", "さんにん") == [r("3人")]


def test_to_hiragana_keeps_long_vowel():
    assert to_hiragana("コーヒー") == "こーひー"


def test_tokenize_sentence():
    tokens = tokenize("学校へ行きませんでした。")
    assert [t["surface"] for t in tokens][:2] == ["学校", "へ"]
    gakkou = tokens[0]
    assert gakkou["reading"] == "がっこう"
    assert gakkou["furigana"] == [r("学校", "がっこう")]
    iki = next(t for t in tokens if t["surface"].startswith("行"))
    assert iki["base"] == "行く"
    assert iki["furigana"][0] == r("行", "い")
    assert tokens[1]["reading"] is None
