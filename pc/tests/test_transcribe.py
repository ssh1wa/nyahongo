from nihongo_pc.transcribe import split_sentences


def words(*items):
    """items: (start, end, word)"""
    return [{"start": s, "end": e, "word": w} for s, e, w in items]


def seg(*items):
    ws = words(*items)
    return {"start": ws[0]["start"], "end": ws[-1]["end"], "text": "", "words": ws}


def texts(sentences):
    return [s["text"] for s in sentences]


def test_keeps_whisper_segment_boundaries():
    raw = [seg((0, 1, "おはよう")), seg((1.1, 2, "ございます"))]
    assert texts(split_sentences(raw)) == ["おはよう", "ございます"]


def test_splits_on_punctuation():
    raw = [seg((0, 1, "はい。"), (1.05, 2, "行こう"))]
    assert texts(split_sentences(raw)) == ["はい。", "行こう"]


def test_splits_on_long_pause():
    raw = [seg((0, 1, "待て"), (2, 3, "まだ早い"))]
    assert texts(split_sentences(raw)) == ["待て", "まだ早い"]


def test_long_sentence_split_at_biggest_gap():
    raw = [seg((0, 3, "あいうえおかきくけこさしすせそ"), (3.05, 4, "たちつてと"),
               (4.4, 8, "なにぬねのはひふへほまみむめも"))]
    assert texts(split_sentences(raw)) == ["あいうえおかきくけこさしすせそたちつてと",
                                          "なにぬねのはひふへほまみむめも"]


def test_long_sentence_without_pause_is_kept():
    raw = [seg((0, 4, "あいうえおかきくけこさしすせそ"), (4.01, 8, "なにぬねのはひふへほまみむめも"))]
    assert len(split_sentences(raw)) == 1


def test_timestamps_follow_words():
    raw = [seg((0.5, 1, "はい。"), (1.2, 2.5, "いいえ"))]
    first, second = split_sentences(raw)
    assert (first["start"], first["end"]) == (0.5, 1)
    assert (second["start"], second["end"]) == (1.2, 2.5)
