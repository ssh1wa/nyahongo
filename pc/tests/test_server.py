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


@pytest.fixture
def no_worker(monkeypatch):
    """不真的处理任务，只记录提交了什么。"""
    submitted = []
    monkeypatch.setattr(server, "_submit", lambda job: submitted.append(job) or {"id": job.id})
    return submitted


def test_batch_dedupes_and_skips_blank(library, local, no_worker):
    r = local.post("/api/jobs/batch", json={"sources": ["https://a.example/1", " ", "https://a.example/1", "https://a.example/2"]})
    assert r.status_code == 200 and r.json()["created"] == 2
    assert [j.source for j in no_worker] == ["https://a.example/1", "https://a.example/2"]


def test_batch_expands_playlist(library, local, no_worker, monkeypatch):
    monkeypatch.setattr(server, "expand_playlist", lambda url, cfg: ("合集", [(f"{url}?p={i}", f"第 {i} 集") for i in (1, 2, 3)]))
    r = local.post("/api/jobs/batch", json={"sources": ["https://b.example/v"], "playlist": True})
    assert r.json()["created"] == 3
    assert [j.display for j in no_worker] == ["第 1 集", "第 2 集", "第 3 集"]


def test_batch_playlist_failure_falls_back_to_single(library, local, no_worker, monkeypatch):
    def boom(url, cfg):
        raise RuntimeError("网络错误")
    monkeypatch.setattr(server, "expand_playlist", boom)
    r = local.post("/api/jobs/batch", json={"sources": ["https://b.example/v"], "playlist": True}).json()
    assert r["created"] == 1 and len(r["failed"]) == 1


def test_batch_rejects_empty(library, local, no_worker):
    assert local.post("/api/jobs/batch", json={"sources": ["", "  "]}).status_code == 400


@pytest.fixture
def fake_dict(monkeypatch, tmp_path):
    db = tmp_path / "phone.sqlite"
    db.write_bytes(b"sqlite")
    monkeypatch.setattr(server.phone_dict, "ensure_fresh", lambda: db)
    monkeypatch.setattr(server.phone_dict, "info", lambda: {"exists": True, "size": 6, "zh": 0})
    return db


def test_phone_can_get_dictionary(fake_dict, phone):
    assert phone.get("/api/dictionary").json()["exists"] is True
    assert phone.get("/api/dictionary/file").content == b"sqlite"


def test_phone_cannot_start_paid_translation(fake_dict, phone):
    assert phone.post("/api/dictionary/translate-common").status_code == 403


def test_local_can_delete(library, local):
    assert local.delete("/api/library/pkg1").status_code == 200
    assert not library.exists()
