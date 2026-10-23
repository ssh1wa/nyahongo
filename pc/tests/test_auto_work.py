from types import SimpleNamespace

from nihongo_pc import server


def _cfg(key, model):
    return SimpleNamespace(llm=SimpleNamespace(key=lambda: key, model=model))


def test_auto_work_follows_ai_key_when_not_specified(monkeypatch):
    monkeypatch.setattr(server, "load_config", lambda: _cfg("sk-x", "m"))
    assert server._auto_work(None) is True
    monkeypatch.setattr(server, "load_config", lambda: _cfg("", "m"))
    assert server._auto_work(None) is False  # 没填 Key 默认不开
    monkeypatch.setattr(server, "load_config", lambda: _cfg("sk-x", ""))
    assert server._auto_work(None) is False  # 没选模型也不开


def test_auto_work_explicit_choice_wins(monkeypatch):
    monkeypatch.setattr(server, "load_config", lambda: _cfg("sk-x", "m"))
    assert server._auto_work(False) is False  # 用户自己关了就不开
    monkeypatch.setattr(server, "load_config", lambda: _cfg("", ""))
    assert server._auto_work(True) is True
