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
    # 用真实日语：断句时会用 Sudachi 判断边界是不是在词中间，无意义的假名串切分不可预测
    raw = [seg((0, 3, "昨日は友達と一緒に新しい"), (3.05, 4, "映画を見に行きました"),
               (4.4, 8, "とても面白かったので来週もう一度行きます"))]
    assert texts(split_sentences(raw)) == ["昨日は友達と一緒に新しい映画を見に行きました",
                                          "とても面白かったので来週もう一度行きます"]


def test_long_sentence_without_pause_is_kept():
    raw = [seg((0, 4, "昨日は友達と一緒に新しい映画を"), (4.01, 8, "見に行ってとても面白かったです"))]
    assert len(split_sentences(raw)) == 1


def test_does_not_split_inside_a_word():
    # 「各自」中间停顿了 0.6 秒以上，也不能切成「各」和「自…」
    raw = [seg((149.07, 149.87, "各"), (150.48, 150.72, "自"), (150.72, 151.3, "テーマを挙げる"))]
    assert texts(split_sentences(raw)) == ["各自テーマを挙げる"]


def test_stray_fragments_before_music_are_moved_forward():
    # 实测数据：片头曲期间「本」「日」的时间戳被拉散，后面的话在 90 秒之后
    raw = [seg((54.42, 54.94, "本"), (82.49, 97.33, "日"), (147.25, 147.57, "の"),
               (147.57, 148.05, "授業"), (148.05, 149.07, "はこれだ"))]
    (s,) = split_sentences(raw)
    assert s["text"] == "本日の授業はこれだ"
    assert 146 < s["start"] < 147.25
    assert s["end"] == 149.07


def test_long_real_speech_before_gap_is_kept_apart():
    raw = [seg((10, 12, "最初の長い文章です"), (30, 31, "次"))]
    assert texts(split_sentences(raw)) == ["最初の長い文章です", "次"]


def test_spaces_between_japanese_are_removed():
    raw = [seg((0, 1, "の"), (1, 1.5, " 授業"), (1.5, 2, " は"), (2, 2.5, " OK です"))]
    assert texts(split_sentences(raw)) == ["の授業は OK です"]  # 英文和日文之间的空格保留


def test_timestamps_follow_words():
    raw = [seg((0.5, 1, "はい。"), (1.2, 2.5, "いいえ"))]
    first, second = split_sentences(raw)
    assert (first["start"], first["end"]) == (0.5, 1)
    assert (second["start"], second["end"]) == (1.2, 2.5)
