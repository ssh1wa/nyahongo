"""英语模式（测试版）：英语视频音频 → 双语字幕 + 点词查词。

和日语不同，这里不逐词拆解：只要英文原句、中文翻译，以及每个单词能查到的词条。
- 断句：Whisper 英语自带标点，按句末标点 + 停顿切，太长的在逗号或停顿处再切
- 翻译：LLM 只翻译，不改英文原文
- 查词：ECDICT（英汉词典，带音标和中文释义，MIT），变形词（went / running）还原成原形再查

词典数据：ECDICT © skywind3000，MIT License（https://github.com/skywind3000/ECDICT）。
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import sys
import urllib.request
from pathlib import Path
from typing import Callable

from .config import LlmConfig
from .dictionary import DATA_DIR
from .llm import chat_json
from .refine import BATCH, CONTEXT, _run_batches

DB_PATH = DATA_DIR / "ecdict.sqlite"
SRC_DIR = DATA_DIR / "downloads" / "ecdict"
BASE_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/"
ATTRIBUTION = "英语词典：ECDICT © skywind3000，MIT License"
ID_OFFSET = 50_000_000  # 和 JMdict 的词条 id 错开，生词本里不会撞
DB_VERSION = 2

# ---------- 建库 ----------


def _download(name: str) -> Path:
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    path = SRC_DIR / name
    if not path.exists():
        print(f"下载 ECDICT：{name}")
        tmp = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(BASE_URL + name, tmp)
        tmp.rename(path)
    return path


def build_db(db_path: Path = DB_PATH) -> None:
    """ecdict.csv + lemma.en.txt → SQLite：words（词条）和 forms（变形 → 原形）。"""
    csv_path, lemma_path = _download("ecdict.csv"), _download("lemma.en.txt")
    csv.field_size_limit(sys.maxsize if sys.maxsize < 2**31 else 2**31 - 1)
    tmp = db_path.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript("""
        CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT, lower TEXT, phonetic TEXT, translation TEXT,
                            definition TEXT, pos TEXT, tag TEXT, collins INTEGER, oxford INTEGER, frq INTEGER, exchange TEXT);
        CREATE TABLE forms (form TEXT PRIMARY KEY, lemma TEXT);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)
    forms: dict[str, str] = {}
    with csv_path.open(encoding="utf-8", newline="") as f:
        rows = []
        for r in csv.DictReader(f):
            word = r["word"]
            rows.append((word, word.lower(), r["phonetic"], r["translation"].replace("\\n", "\n"),
                         r["definition"].replace("\\n", "\n"), r["pos"], r["tag"],
                         int(r["collins"] or 0), int(r["oxford"] or 0), int(r["frq"] or 0), r["exchange"]))
            # exchange 里的 0: 是这个词的原形（did → do）
            for part in r["exchange"].split("/"):
                if part.startswith("0:") and part[2:]:
                    forms.setdefault(word.lower(), part[2:].lower())
        con.executemany("INSERT INTO words (word, lower, phonetic, translation, definition, pos, tag, collins, oxford, frq, exchange)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    # lemma.en.txt：be/4109826 -> is,was,are,...（比 exchange 全，优先用它）。
    # 同一个变形可能属于几组（was 既是 be 的过去式，也是 wa 的复数），取词频高的那组
    best: dict[str, tuple[int, str]] = {}
    for line in lemma_path.read_text(encoding="utf-8").splitlines():
        if line.startswith(";") or "->" not in line:
            continue
        head, tail = line.split("->", 1)
        lemma, _, count = head.strip().partition("/")
        lemma, n = lemma.strip().lower(), int(count or 0)
        for form in tail.split(","):
            form = form.strip().lower()
            if form and form != lemma and n > best.get(form, (-1, ""))[0]:
                best[form] = (n, lemma)
    forms.update({form: lemma for form, (_, lemma) in best.items()})
    con.executemany("INSERT OR REPLACE INTO forms VALUES (?, ?)", forms.items())
    con.execute("CREATE INDEX words_lower ON words(lower)")
    con.execute("INSERT INTO meta VALUES ('version', ?)", (str(DB_VERSION),))
    con.commit()
    con.close()
    tmp.replace(db_path)


# ---------- 查词 ----------

POS_ZH = {"n": "名词", "v": "动词", "vt": "及物动词", "vi": "不及物动词", "a": "形容词", "adj": "形容词",
          "ad": "副词", "adv": "副词", "prep": "介词", "conj": "连词", "pron": "代词", "int": "感叹词",
          "interj": "感叹词", "num": "数词", "art": "冠词", "aux": "助动词", "abbr": "缩写", "pref": "前缀", "suf": "后缀"}
_POS_LINE = re.compile(r"^([a-z]+)\.\s*(.*)$")
_TAG_LINE = re.compile(r"^\[([^\]]+)\]\s*(.*)$")
# 「go的过去式」「sue过去分词形式」这类：词条只是在说它是哪个词的变形
_FORM_NOTE = re.compile(r"([a-z]\s*|的)(过去式|过去分词|现在分词|复数|比较级|最高级|第三人称)")
MAX_SENSES = 6


class EnglishDict:
    def __init__(self, db_path: Path = DB_PATH):
        if not db_path.exists():
            print("第一次使用英语模式：下载并建立 ECDICT 词典（约 70 MB，一两分钟）")
            build_db(db_path)
        self.con = sqlite3.connect(db_path, check_same_thread=False)
        self.con.row_factory = sqlite3.Row

    def _row(self, word: str) -> sqlite3.Row | None:
        rows = self.con.execute("SELECT * FROM words WHERE lower = ? ORDER BY (word = ?) DESC, frq = 0, frq LIMIT 1",
                                (word.lower(), word)).fetchone()
        return rows

    def lookup(self, word: str) -> dict | None:
        """查一个单词。变形先还原成原形（running → run），原形查不到再查原词。返回学习包词条格式。"""
        w = word.strip("'’").lower()
        if not w or not re.search(r"[a-z]", w):
            return None
        own = self._row(w)
        # 自己有正经词条的就用自己的（better、running）；词条只是「xx 的过去式 / 复数」之类的才还原成原形（went → go）
        if own is not None and own["translation"] and not _FORM_NOTE.search(own["translation"]):
            row = own
        else:
            lemma_row = self.con.execute("SELECT lemma FROM forms WHERE form = ?", (w,)).fetchone()
            row = self._row(lemma_row["lemma"]) if lemma_row and lemma_row["lemma"] != w else None
            if row is None or not row["translation"]:
                row = own
        if row is None or not row["translation"]:
            return None
        entry = _entry(row)
        if row["lower"] != w:
            entry["form"] = word  # 原文里是变形，词条是原形
        return entry


def _entry(row: sqlite3.Row) -> dict:
    """和日语词条同一个格式（手机端共用显示）：kanji 为空，readings 放单词本身，另带音标。"""
    senses = []
    for line in (row["translation"] or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        pos, tags = [], []
        if m := _POS_LINE.match(line):
            p = m.group(1)
            if p in POS_ZH:
                pos, line = [POS_ZH[p]], m.group(2)
        elif m := _TAG_LINE.match(line):
            tags, line = [m.group(1)], m.group(2)
        if line:
            senses.append({"pos": pos, "tags": tags, "en": [], "zh": line})
    definitions = [d.strip() for d in (row["definition"] or "").split("\n") if d.strip()][:3]
    if definitions and senses:
        senses[0]["en"] = definitions  # 英文释义放在第一个义项下面，手机上小字显示
    return {
        "id": ID_OFFSET + row["id"],
        "kanji": [],
        "readings": [row["word"]],
        "phonetic": row["phonetic"] or "",
        "common": bool(row["collins"] or row["oxford"] or row["frq"]),
        "senses": senses[:MAX_SENSES],
    }


# ---------- 分词 ----------

_TOKEN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*|\s+|[^\sA-Za-z\d]")


def tokenize(text: str) -> list[dict]:
    """按单词切开，空格和标点也保留成 token（手机端按顺序拼回原句）。单词 token 带 word=True。"""
    out = []
    for m in _TOKEN.finditer(text):
        s = m.group(0)
        token = {"surface": s}
        if re.match(r"[A-Za-z]", s):
            token["word"] = True
        out.append(token)
    return out


def attach_dictionary(sentences: list[dict], progress: Callable[[float, str], None]) -> dict:
    """给每个单词 token 标上词条 id，返回 {id: 词条}。"""
    progress(0, "加载英语词典（第一次会下载并建库）")
    d = EnglishDict()
    entries: dict[str, dict] = {}
    cache: dict[str, dict | None] = {}
    for k, s in enumerate(sentences):
        for t in s["tokens"]:
            if not t.get("word"):
                continue
            key = t["surface"].lower()
            if key not in cache:
                cache[key] = d.lookup(t["surface"])
            e = cache[key]
            if e:
                t["dict"] = e["id"]
                entries.setdefault(str(e["id"]), {k2: v for k2, v in e.items() if k2 != "form"})
        if k % 50 == 0:
            progress(k / max(1, len(sentences)), "查词")
    return entries


# ---------- 断句 ----------

SENTENCE_END = (".", "?", "!", "…")
ABBREVIATIONS = {"mr.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.", "vs.", "etc.", "e.g.", "i.e.", "u.s."}
HARD_GAP = 0.8
SOFT_GAP = 0.2
MAX_SECONDS = 9.0
MAX_CHARS = 110


def _text(words: list[dict]) -> str:
    return re.sub(r"\s+", " ", "".join(w["word"] for w in words)).strip()


def _ends_sentence(word: str) -> bool:
    w = word.strip().lower()
    return w.endswith(SENTENCE_END) and w not in ABBREVIATIONS


def _split_long(words: list[dict]) -> list[list[dict]]:
    """太长的句子：优先在逗号后切，其次在最长的停顿处切。"""
    if len(words) < 4 or (words[-1]["end"] - words[0]["start"] <= MAX_SECONDS and len(_text(words)) <= MAX_CHARS):
        return [words]
    mid = len(words) / 2
    commas = [i + 1 for i, w in enumerate(words[:-2]) if w["word"].strip().endswith((",", ";", ":")) and i >= 1]
    if commas:
        at = min(commas, key=lambda i: abs(i - mid))
    else:
        gaps = [(words[i]["start"] - words[i - 1]["end"], i) for i in range(2, len(words) - 1)]
        gap, at = max(gaps)
        if gap < SOFT_GAP:
            at = round(mid)
    return _split_long(words[:at]) + _split_long(words[at:])


def split_sentences(raw: list[dict]) -> list[dict]:
    chunks: list[list[dict]] = []
    for seg in raw:
        current: list[dict] = []
        for word in seg["words"]:
            if current and word["start"] - current[-1]["end"] > HARD_GAP:
                chunks.append(current)
                current = []
            current.append(word)
            if _ends_sentence(word["word"]):
                chunks.append(current)
                current = []
        if current:
            chunks.append(current)
    out = []
    for chunk in chunks:
        for part in _split_long(chunk):
            text = _text(part)
            if text and re.search(r"[A-Za-z]", text):
                out.append({"start": part[0]["start"], "end": part[-1]["end"], "text": text})
    return out


# ---------- 翻译 ----------

TRANSLATE_PROMPT = """你是英语影视字幕翻译。把每一句英文字幕翻译成自然、口语化的简体中文，像正规字幕组的译文。
- 不要改动、润色英文原文；只输出中文翻译
- 俚语、双关、语气词按意思意译；人名地名保留常见译法
- 句子的 id 和数量必须与输入一致，不要合并或拆分。context 里的句子只用来理解上下文，不要输出
只返回 JSON：{"sentences":[{"id":0,"zh":"中文翻译"}]}"""


def translate(sentences: list[dict], llm: LlmConfig, on_progress: Callable[[float], None] | None = None) -> list[dict]:
    out = [dict(s) for s in sentences]

    def request(start: int):
        payload = {
            "context": [s["text"] for s in sentences[max(0, start - CONTEXT):start]],
            "sentences": [{"id": start + i, "text": s["text"]} for i, s in enumerate(sentences[start:start + BATCH])],
        }
        return chat_json(llm, [
            {"role": "system", "content": TRANSLATE_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ], temperature=0.2, max_tokens=8000)

    for start, result in _run_batches(len(out), request, "翻译", on_progress):
        for item in result.get("sentences", []) if isinstance(result, dict) else []:
            try:
                idx = int(item.get("id"))
            except (TypeError, ValueError):
                continue
            if start <= idx < min(start + BATCH, len(out)):
                zh = str(item.get("zh") or "").strip()
                if zh:
                    out[idx]["zh"] = zh
    return out
