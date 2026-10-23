"""设置页：读写 config.toml、不把 API Key 交给网页、局域网的设备读不到设置。"""

import pytest
from fastapi.testclient import TestClient

from nihongo_pc import config, server


@pytest.fixture
def cfg_file():
    # conftest.py 已经把 CONFIG_PATH 换成了临时文件
    return config.CONFIG_PATH


@pytest.fixture
def local():
    return TestClient(server.app, client=("127.0.0.1", 50000))


@pytest.fixture
def phone():
    return TestClient(server.app, client=("192.168.1.20", 50000))


def test_save_and_read_back(cfg_file, local):
    r = local.put("/api/settings", json={
        "llm": {"base_url": "https://api.deepseek.com", "api_key": "sk-test-1234567890abcd", "model": "deepseek-chat"},
        "download": {"proxy": "http://127.0.0.1:7890", "cookies_from_browser": "edge", "max_height": 1080},
        "whisper": {"model": "medium", "hf_mirror": True, "initial_prompt": "田中さん \"引号\""},
    })
    assert r.status_code == 200
    c = config.load_config(cfg_file)
    assert c.llm.base_url == "https://api.deepseek.com" and c.llm.api_key == "sk-test-1234567890abcd"
    assert c.download.proxy == "http://127.0.0.1:7890" and c.download.max_height == 1080
    assert c.whisper.model == "medium" and c.whisper.hf_mirror is True
    assert c.whisper.initial_prompt == '田中さん "引号"'


def test_key_is_never_sent_to_the_page(cfg_file, local):
    local.put("/api/settings", json={"llm": {"api_key": "sk-secret-abcdefgh9876"}})
    body = local.get("/api/settings").text
    assert "sk-secret" not in body
    data = local.get("/api/settings").json()
    assert data["llm"]["has_key"] is True and data["llm"]["key_tail"] == "9876"


def test_empty_key_keeps_the_old_one(cfg_file, local):
    local.put("/api/settings", json={"llm": {"api_key": "sk-old-key-000011112222"}})
    local.put("/api/settings", json={"llm": {"api_key": "", "model": "m2"}})
    assert config.load_config(cfg_file).llm.api_key == "sk-old-key-000011112222"
    local.put("/api/settings", json={"llm": {"api_key": None}})
    assert config.load_config(cfg_file).llm.api_key == ""


def test_phone_cannot_read_or_change_settings(cfg_file, phone):
    assert phone.get("/api/settings").status_code == 403
    assert phone.put("/api/settings", json={"llm": {"api_key": "x"}}).status_code == 403
    assert phone.post("/api/open-folder", json={"which": "library"}).status_code == 403


def test_stalling_default_model_is_replaced(cfg_file):
    cfg_file.write_text('[llm]\nmodel = "deepseek-ai/DeepSeek-V4.1-Flash"\n', encoding="utf-8")
    assert config.load_config().llm.model == config.DEFAULT_MODEL
    cfg_file.write_text('[llm]\nmodel = "deepseek-chat"\n', encoding="utf-8")
    assert config.load_config().llm.model == "deepseek-chat"  # 自己选的模型不动
