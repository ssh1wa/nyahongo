"""局域网只读规则：其他设备只能读学习包，不能导入、删除、提交任务。"""

import json

import pytest
from fastapi.testclient import TestClient

from nihongo_pc import server
from nihongo_pc.config import Config


@pytest.fixture
def library(tmp_path, monkeypatch):
    pkg = tmp_path / "library" / "pkg1"
    pkg.mkdir(parents=True)
    (pkg / "meta.json").write_text(json.dumps({"id": "pkg1", "media": "media.m4a", "media_type": "audio",
                                               "created_at": ""}), encoding="utf-8")
    (pkg / "subtitles.json").write_text('{"sentences": []}', encoding="utf-8")
    (pkg / "media.m4a").write_bytes(b"audio")
    (pkg / "secret.txt").write_text("x")
    cfg = Config(library=tmp_path / "library", workspace=tmp_path / "ws")
    monkeypatch.setattr(server, "load_config", lambda: cfg)
    return pkg


@pytest.fixture
def phone():
    return TestClient(server.app, client=("192.168.1.20", 50000))


@pytest.fixture
def local():
    return TestClient(server.app, client=("127.0.0.1", 50000))


@pytest.mark.parametrize("path", [
    "/api/ping", "/api/library", "/api/library/pkg1", "/api/library/pkg1/files",
    "/api/library/pkg1/files/media.m4a", "/api/library/pkg1/media",
])
def test_phone_can_read(library, phone, path):
    assert phone.get(path).status_code == 200


@pytest.mark.parametrize("method, path", [
    ("DELETE", "/api/library/pkg1"), ("POST", "/api/jobs"), ("GET", "/api/jobs"),
    ("POST", "/api/upload?filename=a.mp4"), ("GET", "/"), ("GET", "/api/lan"),
])
def test_phone_cannot_write_or_see_ui(library, phone, method, path):
    assert phone.request(method, path).status_code == 403
    assert library.exists()


def test_only_package_files_are_served(library, phone):
    names = [f["name"] for f in phone.get("/api/library/pkg1/files").json()]
    assert names == ["media.m4a", "meta.json", "subtitles.json"]
    assert phone.get("/api/library/pkg1/files/secret.txt").status_code == 404
    assert phone.get("/api/library/pkg1/files/..%2Fmeta.json").status_code in (403, 404)


def test_local_can_delete(library, local):
    assert local.delete("/api/library/pkg1").status_code == 200
    assert not library.exists()
