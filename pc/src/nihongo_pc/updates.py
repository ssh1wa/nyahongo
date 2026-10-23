"""检查更新：读 GitHub 上最新的 Release，和当前版本比较。"""

from __future__ import annotations

import json
import re
import time
import urllib.request

from . import __version__

REPO = "ssh1wa/nyahongo"
RELEASES = f"https://github.com/{REPO}/releases"
CACHE_SECONDS = 6 * 3600

_cache: dict = {}


def parse_version(v: str) -> tuple[int, ...]:
    """'v0.3.10' → (0, 3, 10)；认不出的部分当 0"""
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3]) or (0,)


def is_newer(latest: str, current: str) -> bool:
    return parse_version(latest) > parse_version(current)


def check(force: bool = False) -> dict:
    """返回 {current, latest, newer, url, notes, download}；网络出错时带 error。结果缓存 6 小时。"""
    if not force and _cache and time.time() - _cache["at"] < CACHE_SECONDS:
        return _cache["result"]
    result: dict = {"current": __version__, "url": RELEASES}
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest",
                                     headers={"Accept": "application/vnd.github+json", "User-Agent": "nyahongo-pc"})
        with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 — 固定的 GitHub 地址
            data = json.load(r)
        latest = str(data.get("tag_name") or "").lstrip("v")
        assets = {a.get("name"): a.get("browser_download_url") for a in data.get("assets") or []}
        result.update(
            latest=latest,
            newer=is_newer(latest, __version__),
            url=data.get("html_url") or RELEASES,
            notes=str(data.get("body") or "")[:2000],
            download=assets.get("nyahongo-pc-setup.exe"),
        )
    except (OSError, ValueError) as e:
        result["error"] = f"连不上 GitHub（{e}）"
        return result  # 出错不缓存，下次再试
    _cache.update(at=time.time(), result=result)
    return result
