"""所有测试都用临时的 config.toml，绝不读写真实的配置文件（里面有用户的 API Key）。"""

import pytest

from nihongo_pc import config


@pytest.fixture(autouse=True)
def _isolated_config(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.toml")
