"""多设备同步：电脑保存一份合并好的学习数据（生词、复习、记录、小游戏账本……），手机、平板来拉取和上传。

合并在 App 里做（规则和数据结构都在 App 那边，见 app/src/lib/sync.ts），电脑只负责存：
- 每次上传必须带上它拉取时的版本号；期间别的设备已经传过（版本号对不上）就拒绝，App 重新拉取合并后再传。
  这样两台设备同时同步也不会互相覆盖。
- 每个旧版本都备份一份（保留最近 BACKUP_KEEP 个），万一哪台设备传了坏数据还能找回来。
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

BACKUP_KEEP = 30
_lock = threading.Lock()


class VersionConflict(Exception):
    def __init__(self, current: int):
        super().__init__(f"数据已经被别的设备更新（当前版本 {current}）")
        self.current = current


def _state_file(root: Path) -> Path:
    return root / "state.json"


def load(root: Path) -> dict:
    """{"version": 0, "doc": None} 表示还没有任何设备同步过。"""
    f = _state_file(root)
    if not f.exists():
        return {"version": 0, "doc": None, "updated_at": None, "device": None}
    return json.loads(f.read_text(encoding="utf-8"))


def save(root: Path, base: int, doc: dict, device: str = "") -> int:
    """base 不是当前版本时抛 VersionConflict。成功返回新版本号。"""
    with _lock:
        current = load(root)
        if base != current["version"]:
            raise VersionConflict(current["version"])
        root.mkdir(parents=True, exist_ok=True)
        f = _state_file(root)
        if f.exists():
            backups = root / "backups"
            backups.mkdir(exist_ok=True)
            f.replace(backups / f"state-v{current['version']}.json")
            old = sorted(backups.glob("state-v*.json"), key=lambda p: int(p.stem.split("-v")[1]))
            for p in old[:-BACKUP_KEEP]:
                p.unlink()
        version = current["version"] + 1
        data = {"version": version, "doc": doc, "updated_at": int(time.time() * 1000), "device": device}
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, f)
        return version
