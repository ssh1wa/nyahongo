"""多设备同步：手机、平板通过局域网拉取 / 上传学习数据，版本号对不上要拒绝，旧版本留备份。"""

import pytest
from fastapi.testclient import TestClient

from nihongo_pc import server, sync
from nihongo_pc.config import Config


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    c = Config(library=tmp_path / "library", workspace=tmp_path / "ws", sync=tmp_path / "sync")
    monkeypatch.setattr(server, "load_config", lambda: c)
    return c


@pytest.fixture
def phone():
    return TestClient(server.app, client=("192.168.1.20", 50000))


@pytest.fixture
def tablet():
    return TestClient(server.app, client=("192.168.1.21", 50000))


def test_empty_before_first_sync(cfg, phone):
    r = phone.get("/api/sync")
    assert r.status_code == 200
    assert r.json()["version"] == 0 and r.json()["doc"] is None


def test_push_then_pull_from_another_device(cfg, phone, tablet):
    r = phone.put("/api/sync", json={"base": 0, "doc": {"words": [{"uid": "e1"}]}, "device": "phone"})
    assert r.status_code == 200 and r.json() == {"version": 1}
    got = tablet.get("/api/sync").json()
    assert got["version"] == 1
    assert got["doc"] == {"words": [{"uid": "e1"}]}
    assert got["device"] == "phone"


def test_stale_version_is_rejected(cfg, phone, tablet):
    phone.put("/api/sync", json={"base": 0, "doc": {"n": 1}})
    # 平板还是按版本 0 合并的，期间手机已经传过：必须拒绝，不能覆盖手机的数据
    r = tablet.put("/api/sync", json={"base": 0, "doc": {"n": 2}})
    assert r.status_code == 409
    assert r.json()["version"] == 1
    assert tablet.get("/api/sync").json()["doc"] == {"n": 1}


def test_old_versions_are_backed_up(cfg, phone):
    for v in range(sync.BACKUP_KEEP + 5):
        assert phone.put("/api/sync", json={"base": v, "doc": {"n": v}}).status_code == 200
    backups = sorted((cfg.sync / "backups").glob("state-v*.json"))
    assert len(backups) == sync.BACKUP_KEEP
    # 留下的是最新的那些
    assert (cfg.sync / "backups" / f"state-v{sync.BACKUP_KEEP + 4}.json").exists()
    assert not (cfg.sync / "backups" / "state-v1.json").exists()


@pytest.mark.parametrize("body", [{"doc": {}}, {"base": 0}, {"base": "0", "doc": {}}, {"base": 0, "doc": []}])
def test_bad_body(cfg, phone, body):
    assert phone.put("/api/sync", json=body).status_code == 400


def test_lan_still_cannot_write_elsewhere(cfg, phone):
    # 只开放同步这一个写入口，导入、删除学习包仍然不行
    assert phone.delete("/api/library/pkg1").status_code == 403
    assert phone.post("/api/sync", json={"base": 0, "doc": {}}).status_code == 403
