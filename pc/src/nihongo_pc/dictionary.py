"""JMdict 本地词典：建库、按分词结果查词、用 LLM 把英文义项翻译成中文（带缓存）。

词条内容（写法、读音、词性、义项划分）全部来自 JMdict，LLM 只负责翻译已有的英文义项，
不让它自己编词条。

词典数据：JMdict © Electronic Dictionary Research and Development Group，CC BY-SA 4.0；
JSON 版本来自 scriptin/jmdict-simplified。
"""

from __future__ import annotations

import json
import sqlite3
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .config import PC_ROOT, LlmConfig
from .furigana import KANA, char_type, to_hiragana
from .llm import LlmError, chat_json

DATA_DIR = PC_ROOT / "data"
DB_PATH = DATA_DIR / "jmdict.sqlite"
RELEASES_API = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest"
ATTRIBUTION = "词典数据：JMdict © EDRDG，CC BY-SA 4.0（JSON 版本来自 jmdict-simplified）"

PARALLEL = 4  # 同时发出的翻译请求数
MAX_SENSES = 8  # 取る 这类词有二十多个义项，只保留前面常用的
MAX_GLOSSES = 4
SKIP_POS = {"助詞", "助動詞", "補助記号", "記号", "空白"}  # 这些词性不查词典

# JMdict 词性标签 → 中文。按前缀匹配，先匹配更长的前缀
POS_ZH = [
    ("v5k-s", "五段动词"), ("v5", "五段动词"), ("v1", "一段动词"), ("vk", "カ变动词"),
    ("vs", "サ变动词"), ("vz", "サ变动词"), ("vr", "ラ变动词"), ("v", "动词"),
    ("adj-i", "イ形容词"), ("adj-ix", "イ形容词"), ("adj-na", "ナ形容词"), ("adj-no", "可接の的名词"),
    ("adj-pn", "连体词"), ("adj-t", "タルト形容词"), ("adj-f", "定语"), ("adj", "形容词"),
    ("adv-to", "副词（〜と）"), ("adv", "副词"), ("aux-v", "助动词"), ("aux-adj", "补助形容词"),
    ("aux", "助动词"), ("conj", "接续词"), ("cop", "判断词"), ("ctr", "量词"), ("exp", "惯用表达"),
    ("int", "感叹词"), ("n-pref", "名词（前缀）"), ("n-suf", "名词（后缀）"), ("num", "数词"),
    ("n", "名词"), ("pn", "代词"), ("pref", "前缀"), ("prt", "助词"), ("suf", "后缀"),
]
TRANSITIVITY_ZH = {"vi": "自动词", "vt": "他动词"}
MISC_ZH = {
    "uk": "常写假名", "col": "口语", "sl": "俗语", "hon": "尊敬语", "hum": "谦让语", "pol": "礼貌语",
    "arch": "古语", "obs": "旧用法", "rare": "罕用", "vulg": "粗俗", "derog": "贬义", "fam": "亲昵",
    "male": "男性用语", "fem": "女性用语", "on-mim": "拟声拟态", "id": "惯用语", "proverb": "谚语",
    "yoji": "四字熟语", "abbr": "缩略语", "joc": "戏谑", "sens": "敏感词", "dated": "过时",
}
# Sudachi 词性 → 期望的 JMdict 词性前缀，用来在同形词里挑对的那个
SUDACHI_POS_HINT = {
    "動詞": ("v",), "名詞": ("n", "pn"), "代名詞": ("pn",), "形容詞": ("adj-i",), "形状詞": ("adj-na",),
    "副詞": ("adv",), "感動詞": ("int",), "接続詞": ("conj",), "連体詞": ("adj-pn",),
    "接頭辞": ("pref",), "接尾辞": ("suf", "n-suf", "ctr"),
}


def pos_labels(tags: list[str]) -> list[str]:
    labels: list[str] = []
    for tag in tags:
        label = TRANSITIVITY_ZH.get(tag) or next((zh for p, zh in POS_ZH if tag.startswith(p)), None)
        if label and label not in labels:
            labels.append(label)
    return labels


# ---------- 建库 ----------

def _download_json(dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(dest_dir.glob("jmdict-eng-*.json"))
    if existing:
        return existing[-1]
    with urllib.request.urlopen(RELEASES_API, timeout=30) as r:
        release = json.load(r)
    asset = next(a for a in release["assets"]
                 if a["name"].startswith("jmdict-eng-") and "common" not in a["name"] and a["name"].endswith(".json.zip"))
    archive = dest_dir / "jmdict-eng.zip"
    urllib.request.urlretrieve(asset["browser_download_url"], archive)
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if n.endswith(".json") and "/" not in n and ".." not in n)
        z.extract(name, dest_dir)
    return dest_dir / name


def _compact(word: dict) -> dict:
    senses = []
    for s in word["sense"][:MAX_SENSES]:
        senses.append({
            "pos": s["partOfSpeech"],
            "misc": s["misc"],
            "info": s["info"],
            "en": [g["text"] for g in s["gloss"][:MAX_GLOSSES]],
        })
    return {
        "id": int(word["id"]),
        "k": [k["text"] for k in word["kanji"] if "sK" not in k["tags"]],
        "r": [r["text"] for r in word["kana"] if "sk" not in r["tags"]],
        "common": any(k["common"] for k in word["kanji"]) or any(r["common"] for r in word["kana"]),
        "s": senses,
    }


def build_db(json_path: Path | None = None, db_path: Path = DB_PATH) -> Path:
    json_path = json_path or _download_json(DATA_DIR / "downloads")
    data = json.loads(json_path.read_text(encoding="utf-8"))
    tmp = db_path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    conn = sqlite3.connect(tmp)
    conn.executescript("""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE forms (form TEXT NOT NULL, entry_id INTEGER NOT NULL, kana INTEGER NOT NULL,
                            common INTEGER NOT NULL, rare INTEGER NOT NULL);
    """)
    entries, forms = [], []
    for word in data["words"]:
        e = _compact(word)
        entries.append((e["id"], json.dumps(e, ensure_ascii=False, separators=(",", ":"))))
        for k in word["kanji"]:
            rare = int(bool({"rK", "sK", "oK", "iK"} & set(k["tags"])))
            forms.append((k["text"], e["id"], 0, int(k["common"]), rare))
        for r in word["kana"]:
            rare = int(bool({"rk", "sk", "ok", "ik"} & set(r["tags"])))
            forms.append((r["text"], e["id"], 1, int(r["common"]), rare))
    conn.executemany("INSERT INTO entries VALUES (?, ?)", entries)
    conn.executemany("INSERT INTO forms VALUES (?, ?, ?, ?, ?)", forms)
    conn.execute("CREATE INDEX forms_form ON forms(form)")
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("jmdict_version", data.get("version", "")), ("dict_date", data.get("dictDate", "")),
    ])
    conn.commit()
    conn.close()
    # 中文翻译缓存单独放，重建词库时不会丢
    tmp.replace(db_path)
    return db_path


# ---------- 查询 ----------

class Dictionary:
    def __init__(self, db_path: Path = DB_PATH):
        if not db_path.exists():
            build_db(db_path=db_path)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.zh = sqlite3.connect(db_path.with_name("jmdict_zh.sqlite"), check_same_thread=False)
        self.zh.execute("CREATE TABLE IF NOT EXISTS zh (entry_id INTEGER PRIMARY KEY, data TEXT NOT NULL, model TEXT)")
        self._cache: dict[int, dict] = {}

    def get(self, entry_id: int) -> dict | None:
        if entry_id not in self._cache:
            row = self.conn.execute("SELECT data FROM entries WHERE id = ?", (entry_id,)).fetchone()
            if not row:
                return None
            self._cache[entry_id] = json.loads(row[0])
        return self._cache[entry_id]

    def lookup(self, base: str, reading: str | None = None, surface: str | None = None,
               pos: str | None = None, norm: str | None = None) -> dict | None:
        """按 Sudachi 的原形/读音/词性/标准化形挑出最可能的 JMdict 词条。reading 是表层形的平假名读音。"""
        keys = {k for k in (base, surface, norm, to_hiragana(base)) if k}
        rows = self.conn.execute(
            f"SELECT form, entry_id, kana, common, rare FROM forms WHERE form IN ({','.join('?' * len(keys))})",
            tuple(keys),
        ).fetchall()
        if not rows:
            return None

        reading_h = to_hiragana(reading) if reading else None
        hints = SUDACHI_POS_HINT.get(pos or "", ())
        best, best_score = None, float("-inf")
        for entry_id in {r[1] for r in rows}:
            e = self.get(entry_id)
            matched = [r for r in rows if r[1] == entry_id]
            score = 0.0
            score += 100 if any(r[0] == base for r in matched) else 40
            score += 20 if e["common"] else 0
            score -= 30 if all(r[4] for r in matched) else 0
            if reading_h and e["r"]:
                # 动词活用后读音只和词典形共享前缀（行っ/いっ ↔ いく），所以比公共前缀长度
                def common_prefix(a: str, b: str) -> int:
                    n = 0
                    while n < min(len(a), len(b)) and a[n] == b[n]:
                        n += 1
                    return n
                best_prefix = max(common_prefix(reading_h, to_hiragana(r)) for r in e["r"])
                score += 8 * best_prefix
                if any(to_hiragana(r) == reading_h for r in e["r"]):
                    score += 25
            if hints and e["s"] and any(t.startswith(hints) for t in e["s"][0]["pos"]):
                score += 15
            if norm and norm != base and norm in e["k"]:
                score += 60  # Sudachi 已经告诉我们是哪个汉字写法
            if base and all(char_type(c) == KANA for c in base) and e["k"]:
                # 原文写假名时，优先"通常写假名"的词（いる→居る，而不是 射る）
                score += 20 if e["s"] and "uk" in e["s"][0]["misc"] else -10
            score -= e["id"] / 1e9  # 分数相同时取 id 小的（通常是更基础的词条）
            if score > best_score:
                best, best_score = e, score
        return best

    def lookup_token(self, token: dict) -> dict | None:
        if token.get("pos") in SKIP_POS:
            return None
        return self.lookup(token["base"], token.get("reading") or to_hiragana(token["surface"]),
                           token["surface"], token.get("pos"), token.get("norm"))

    # ---------- 中文释义 ----------

    def get_zh(self, entry_ids: list[int]) -> dict[int, list[str]]:
        if not entry_ids:
            return {}
        rows = self.zh.execute(
            f"SELECT entry_id, data FROM zh WHERE entry_id IN ({','.join('?' * len(entry_ids))})",
            tuple(entry_ids),
        ).fetchall()
        return {r[0]: json.loads(r[1]) for r in rows}

    def translate(self, entry_ids: list[int], llm: LlmConfig, batch: int = 25,
                  on_progress=None) -> dict[int, list[str]]:
        """把还没有中文的词条批量翻译，返回全部词条的中文义项（与英文义项一一对应）。

        先按 batch 个一组并发翻译；义项数对不上被丢弃的词条，再按 5 个一组重试一次。
        """
        ids = list(dict.fromkeys(entry_ids))
        have = self.get_zh(ids)
        missing = [i for i in ids if i not in have]
        total = len(missing)
        done = 0
        for size in (batch, 5):
            chunks = [missing[i : i + size] for i in range(0, len(missing), size)]
            with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
                futures = [pool.submit(self._translate_batch, [self.get(i) for i in c], llm) for c in chunks]
                for future in as_completed(futures):
                    try:
                        result = future.result()
                    except LlmError as e:
                        print(f"  词条翻译失败（{e}），这批先跳过")
                        continue
                    self._save_zh(result, llm.model)  # 只在主线程写 SQLite
                    have.update(result)
                    done += len(result)
                    if on_progress and total:
                        on_progress(min(done / total, 1))
            missing = [i for i in missing if i not in have]
            if not missing:
                break
        if missing:
            print(f"  有 {len(missing)} 个词条没能翻译，会显示英文释义")
        return have

    def _save_zh(self, translated: dict[int, list[str]], model: str) -> None:
        self.zh.executemany(
            "INSERT OR REPLACE INTO zh VALUES (?, ?, ?)",
            [(i, json.dumps(s, ensure_ascii=False), model) for i, s in translated.items()],
        )
        self.zh.commit()

    def _translate_batch(self, entries: list[dict], llm: LlmConfig) -> dict[int, list[str]]:
        payload = [{
            "id": e["id"],
            "word": (e["k"] or e["r"])[0],
            "reading": e["r"][0] if e["r"] else "",
            "senses": [s["en"] for s in e["s"]],
        } for e in entries]
        result = chat_json(llm, [
            {"role": "system", "content": (
                "你是日语词典编辑。把每个 JMdict 词条的英文义项翻译成简洁、准确的简体中文释义，供中文母语的日语学习者使用。\n"
                "规则：\n"
                "- senses 里每一项是同一个义项的若干英文释义，把它合并译成一条中文释义，多个近义说法用「；」分隔\n"
                "- 输出的 senses 数量和顺序必须与输入完全一致，不能增删、合并或调换义项\n"
                "- 只翻译给出的英文含义，不要补充词典里没有的意思，不要加例句\n"
                "- 日语里常用的汉字词，如果中文同形词意思不同，按英文义项翻译，不要望文生义\n"
                '只返回 JSON：{"entries":[{"id":词条id,"senses":["中文释义1","中文释义2"]}]}'
            )},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ], temperature=0.1, max_tokens=8000)

        by_id = {e["id"]: e for e in entries}
        out: dict[int, list[str]] = {}
        for item in result.get("entries", []) if isinstance(result, dict) else []:
            try:
                entry_id = int(item.get("id"))
            except (TypeError, ValueError):
                continue
            senses = item.get("senses")
            e = by_id.get(entry_id)
            # 义项数对不上说明模型合并或漏了，宁可不用
            if not e or not isinstance(senses, list) or len(senses) != len(e["s"]):
                continue
            senses = [str(s).strip() for s in senses]
            if not all(senses):
                continue
            out[entry_id] = senses
        return out


def entry_for_package(e: dict, zh: list[str] | None) -> dict:
    """学习包里存的词条格式：手机和网页直接显示，不用再查词库。"""
    return {
        "id": e["id"],
        "kanji": e["k"],
        "readings": e["r"],
        "common": e["common"],
        "senses": [{
            "pos": pos_labels(s["pos"]),
            "tags": [MISC_ZH[m] for m in s["misc"] if m in MISC_ZH],
            "en": s["en"],
            "zh": zh[i] if zh else None,
        } for i, s in enumerate(e["s"])],
    }
