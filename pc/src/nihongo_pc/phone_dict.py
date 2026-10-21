"""给手机打包的离线词典：JMdict 全部词条 + 已经翻译好的中文释义，一个 SQLite 文件。

手机在设置里从电脑下载这个文件，阅读和翻译时查词用。中文释义只包含电脑上已经翻译过的词条，
其余词条在手机上按需让 AI 翻译。
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .dictionary import ATTRIBUTION, DATA_DIR, Dictionary, entry_for_package

PHONE_DB = DATA_DIR / "phone-dict.sqlite"
FORMAT_VERSION = 1


def info() -> dict:
    """当前打包好的离线词典信息；没打包过时 exists=False。"""
    if not PHONE_DB.exists():
        return {"exists": False}
    conn = sqlite3.connect(PHONE_DB)
    try:
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    finally:
        conn.close()
    return {
        "exists": True,
        "version": f"{meta.get('jmdict_version', '')}+{meta.get('built_at', '')}",
        "entries": int(meta.get("entries", 0)),
        "zh": int(meta.get("zh", 0)),
        "size": PHONE_DB.stat().st_size,
        "built_at": int(meta.get("built_at", 0)),
        "attribution": ATTRIBUTION,
    }


def is_stale(d: Dictionary) -> bool:
    """电脑上新翻译了词条后，离线词典需要重新打包。"""
    current = info()
    if not current["exists"]:
        return True
    zh_now = d.zh.execute("SELECT COUNT(*) FROM zh").fetchone()[0]
    return zh_now != current["zh"]


def build(d: Dictionary | None = None) -> Path:
    d = d or Dictionary()
    zh = {row[0]: json.loads(row[1]) for row in d.zh.execute("SELECT entry_id, data FROM zh")}
    tmp = PHONE_DB.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    out = sqlite3.connect(tmp)
    out.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE forms (form TEXT NOT NULL, entry_id INTEGER NOT NULL, kana INTEGER NOT NULL,
                            common INTEGER NOT NULL, rare INTEGER NOT NULL);
    """)
    batch = []
    for entry_id, raw in d.conn.execute("SELECT id, data FROM entries"):
        e = json.loads(raw)
        batch.append((entry_id, json.dumps(entry_for_package(e, zh.get(entry_id)), ensure_ascii=False, separators=(",", ":"))))
        if len(batch) >= 5000:
            out.executemany("INSERT INTO entries VALUES (?, ?)", batch)
            batch.clear()
    out.executemany("INSERT INTO entries VALUES (?, ?)", batch)
    out.executemany("INSERT INTO forms VALUES (?, ?, ?, ?, ?)", d.conn.execute("SELECT form, entry_id, kana, common, rare FROM forms"))
    out.execute("CREATE INDEX forms_form ON forms(form)")
    jm_version = dict(d.conn.execute("SELECT key, value FROM meta").fetchall()).get("dict_date", "")
    entries = out.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    out.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("format", str(FORMAT_VERSION)), ("jmdict_version", jm_version), ("built_at", str(int(time.time()))),
        ("entries", str(entries)), ("zh", str(len(zh))),
    ])
    out.commit()
    out.execute("VACUUM")
    out.close()
    tmp.replace(PHONE_DB)
    return PHONE_DB


def ensure_fresh() -> Path:
    d = Dictionary()
    if is_stale(d):
        build(d)
    return PHONE_DB


def translate_common(llm, on_progress=None) -> int:
    """预翻译所有常用词条（JMdict 标为 common 的约 2.2 万个），返回这次新翻译的数量。"""
    d = Dictionary()
    ids = [row[0] for row in d.conn.execute("SELECT DISTINCT entry_id FROM forms WHERE common = 1")]
    before = d.zh.execute("SELECT COUNT(*) FROM zh").fetchone()[0]
    d.translate(ids, llm, batch=25, on_progress=on_progress)
    return d.zh.execute("SELECT COUNT(*) FROM zh").fetchone()[0] - before
