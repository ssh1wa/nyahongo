"""作品专有名词表和检查更新（不联网：Bangumi、AI、GitHub 都换成假的）。"""

import json

from nihongo_pc import config, glossary, updates
from nihongo_pc.furigana import tokenize


def _cfg(tmp_path):
    cfg = config.Config()
    cfg.workspace = tmp_path
    cfg.llm.api_key = "sk-test"
    return cfg


def test_build_uses_bangumi_then_ai_and_caches(tmp_path, monkeypatch):
    calls = {"ai": 0}
    monkeypatch.setattr(glossary, "search_bangumi", lambda work: {"id": 1, "name": "けいおん!", "name_cn": "轻音少女"})
    monkeypatch.setattr(glossary, "bangumi_characters", lambda sid: ["平沢唯", "秋山澪"])

    def fake_chat(llm, messages, **kw):
        calls["ai"] += 1
        sent = json.loads(messages[1]["content"])
        assert sent["bangumi"]["characters"] == ["平沢唯", "秋山澪"]  # 角色名交给 AI 补读音
        return {"title": "けいおん!", "terms": [
            {"text": "平沢唯", "reading": "ヒラサワ ユイ", "kind": "人名"},  # 片假名、空格会被整理
            {"text": "平沢唯", "reading": "ひらさわゆい", "kind": "人名"},  # 重复的去掉
            {"text": "唯", "reading": "yui", "kind": "人名"},  # 读音不是假名就不要读音
        ]}

    monkeypatch.setattr(glossary, "chat_json", fake_chat)
    cfg = _cfg(tmp_path)
    g = glossary.build(cfg, "轻音少女")
    assert g["source"] == "Bangumi「轻音少女」"
    assert g["terms"] == [{"text": "平沢唯", "reading": "ひらさわゆい", "kind": "人名"},
                          {"text": "唯", "reading": None, "kind": "人名"}]
    assert glossary.build(cfg, " 轻音少女 ") == g and calls["ai"] == 1  # 同一部作品走缓存


def test_without_ai_uses_bangumi_names(tmp_path, monkeypatch):
    monkeypatch.setattr(glossary, "search_bangumi", lambda work: {"id": 1, "name": "x"})
    monkeypatch.setattr(glossary, "bangumi_characters", lambda sid: ["平沢唯"])
    cfg = _cfg(tmp_path)
    cfg.llm.api_key = ""
    g = glossary.build(cfg, "轻音少女")
    assert [t["text"] for t in g["terms"]] == ["平沢唯"]


def test_nothing_found(tmp_path, monkeypatch):
    monkeypatch.setattr(glossary, "search_bangumi", lambda work: None)
    monkeypatch.setattr(glossary, "chat_json", lambda *a, **k: {"terms": []})
    assert glossary.build(_cfg(tmp_path), "不存在的作品") is None


def test_apply_readings_fixes_names():
    # 分词器把人名「梓」读成 し
    g = {"terms": [{"text": "梓", "reading": "あずさ", "kind": "人名"}]}
    sentences = [{"tokens": tokenize("梓が来た")}]
    assert glossary.apply_readings(sentences, g) == 1
    tok = next(t for t in sentences[0]["tokens"] if t["surface"] == "梓")
    assert tok["reading"] == "あずさ" and tok["furigana"] == [{"text": "梓", "reading": "あずさ"}]


def test_manual_terms_merge_first():
    manual = glossary.parse_manual("唯（ゆい） 桜が丘、放課後ティータイム(ほうかごてぃーたいむ)")
    assert [(t["text"], t["reading"]) for t in manual] == [
        ("唯", "ゆい"), ("桜が丘", None), ("放課後ティータイム", "ほうかごてぃーたいむ")]
    auto = {"work": "x", "title": "x", "source": "AI", "terms": [{"text": "唯", "reading": "ゆいい", "kind": "人名"},
                                                                {"text": "澪", "reading": "みお", "kind": "人名"}]}
    merged = glossary.merge(auto, manual)
    assert [t["text"] for t in merged["terms"]] == ["唯", "桜が丘", "放課後ティータイム", "澪"]
    assert merged["terms"][0]["reading"] == "ゆい"  # 重复的以手动为准
    assert glossary.merge(None, manual)["source"] == "手动填写"
    assert glossary.merge(auto, []) is auto


def test_guess_work_without_ai_cleans_title(tmp_path):
    cfg = _cfg(tmp_path)
    cfg.llm.api_key = ""
    assert glossary.guess_work(cfg, "轻音少女 第二季第01集在线观看-打驴动漫") == "轻音少女"
    assert glossary.guess_work(cfg, "【4K】葬送のフリーレン 第12話「本物の勇者」") == "葬送のフリーレン"
    assert glossary.guess_work(cfg, "[Sakurato] Bocchi the Rock! - 05 [1080p][CHS].mkv") == "Bocchi the Rock!"
    assert glossary.guess_work(cfg, "") is None


def test_guess_work_uses_ai(tmp_path, monkeypatch):
    monkeypatch.setattr(glossary, "chat_json", lambda *a, **k: {"work": ""})
    assert glossary.guess_work(_cfg(tmp_path), "NHKニュース 7時") is None  # AI 认不出就不猜


def test_for_prompt():
    g = {"terms": [{"text": "唯", "reading": "ゆい", "kind": "人名"}, {"text": "DEATH DEVIL", "reading": None, "kind": "组织"}]}
    assert glossary.for_prompt(g) == ["唯（ゆい）", "DEATH DEVIL"]
    assert glossary.for_prompt(None) == []


def test_version_compare():
    assert updates.is_newer("0.3.10", "0.3.9")
    assert updates.is_newer("v1.0.0", "0.9.9")
    assert not updates.is_newer("0.3.0", "0.3.0")
    assert not updates.is_newer("0.2.9", "0.3.0")


def test_reading_check_does_not_spread_glossary_readings(monkeypatch):
    from nihongo_pc import refine
    from nihongo_pc.config import LlmConfig

    sentences = [{"tokens": tokenize("平沢唯美")}]
    n = next(i for i, t in enumerate(sentences[0]["tokens"]) if t["surface"] == "唯美")
    # AI 把「唯」的读音 ゆい 套到了「唯美」上：不采用
    monkeypatch.setattr(refine, "chat_json", lambda *a, **k: {"fixes": [{"id": 0, "n": n, "reading": "ゆい"}]})
    assert refine.refine_readings(sentences, LlmConfig(), glossary=["唯（ゆい）"]) == 0
