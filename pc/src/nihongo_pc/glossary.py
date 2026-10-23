"""作品专有名词表：先查 Bangumi（番组计划）的角色名，再让 AI 补上读音、台词里的常用叫法、地名等。

用在两个地方：AI 校对（把听错的人名、专有名词改对）和注音（人名按词表的读音标）。
按作品名缓存在 workspace/glossary，同一部作品的每一集共用。

不交给 Whisper：试过 hotwords 和 initial_prompt，Whisper 会因此漏掉整段对白、把几句连成一句，
得不偿失（同一段 5 分钟动画：不给 26 句，给 40 个 hotwords 只剩 14 句）。
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable

from .config import Config
from .furigana import KANJI, align, char_type, to_hiragana
from .llm import LlmError, chat_json

BANGUMI = "https://api.bgm.tv"
USER_AGENT = "ssh1wa/nyahongo (https://github.com/ssh1wa/nyahongo)"  # Bangumi 要求带上
MAX_TERMS = 60
_KANA = re.compile(r"^[ぁ-ゟー]+$")

PROMPT = """你在为日语动画、日剧的字幕识别准备专有名词表。输入是作品名，可能附带 Bangumi 上查到的作品信息和角色名（日文原名）。
列出这部作品台词里常出现的专有名词：
- 角色：全名，以及台词里常用的叫法（只叫名字、只叫姓、昵称，例如「唯」「りっちゃん」「あずにゃん」）
- 地名、学校 / 组织 / 乐队等团体名、作品特有的术语和物品名
每个给出日文写法 text、平假名读音 reading（全部用平假名，不要空格）、类别 kind（人名 / 地名 / 组织 / 术语）。
只列你确定在这部作品里出现的词，不确定的不要列；主要角色优先，最多 60 个。
如果你不认识这部作品、也没有附带角色名，返回空列表。
只返回 JSON：{"title":"作品的日文原名","terms":[{"text":"平沢唯","reading":"ひらさわゆい","kind":"人名"}]}"""


def _get(url: str) -> object:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310 — 固定的 Bangumi 地址
        return json.load(r)


def search_bangumi(work: str) -> dict | None:
    """按作品名找 Bangumi 条目：先找动画，再找三次元（日剧）；名字完全对上的优先。"""
    q = urllib.parse.quote(work.strip(), safe="")
    first = None
    for kind in (2, 6):
        try:
            data = _get(f"{BANGUMI}/search/subject/{q}?type={kind}&responseGroup=small&max_results=5")
        except (OSError, ValueError):
            continue
        items = data.get("list") if isinstance(data, dict) else None
        for item in items or []:
            if work.strip().lower() in (str(item.get("name", "")).lower(), str(item.get("name_cn", "")).lower()):
                return item
        if items and first is None:
            first = items[0]
    return first


def bangumi_characters(subject_id: int) -> list[str]:
    """角色的日文名，主角在前。"""
    try:
        data = _get(f"{BANGUMI}/v0/subjects/{subject_id}/characters")
    except (OSError, ValueError):
        return []
    chars = [c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []
    chars.sort(key=lambda c: 0 if c.get("relation") == "主角" else 1)
    return [str(c["name"]).strip() for c in chars]


def _clean(terms: object) -> list[dict]:
    out, seen = [], set()
    for t in terms if isinstance(terms, list) else []:
        if not isinstance(t, dict):
            continue
        text = str(t.get("text") or "").strip()
        if not text or text in seen or len(text) > 20:
            continue
        reading = to_hiragana(re.sub(r"\s", "", str(t.get("reading") or "")))
        seen.add(text)
        out.append({"text": text, "reading": reading if _KANA.match(reading) else None,
                    "kind": str(t.get("kind") or "").strip()})
    return out[:MAX_TERMS]


def _cache_path(cfg: Config, work: str) -> Path:
    key = hashlib.sha1(work.strip().lower().encode("utf-8")).hexdigest()[:12]
    return cfg.workspace / "glossary" / f"{key}.json"


def build(cfg: Config, work: str, notice: Callable[[str], None] = print) -> dict | None:
    """返回 {work, title, source, terms: [{text, reading, kind}]}；什么都没找到返回 None。"""
    work = work.strip()
    if not work:
        return None
    cache = _cache_path(cfg, work)
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))

    subject = search_bangumi(work)
    names = bangumi_characters(int(subject["id"])) if subject else []
    title = str(subject.get("name") or work) if subject else work
    terms: list[dict] = []
    if cfg.llm.key() and cfg.llm.model:
        payload = {"work": work}
        if subject:
            payload["bangumi"] = {"name": subject.get("name"), "name_cn": subject.get("name_cn"), "characters": names[:80]}
        try:
            result = chat_json(cfg.llm, [
                {"role": "system", "content": PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ], temperature=0.2, max_tokens=4000, timeout=120)
            terms = _clean(result.get("terms") if isinstance(result, dict) else None)
            if not subject and isinstance(result, dict) and result.get("title"):
                title = str(result["title"]).strip()
        except LlmError as e:
            notice(f"AI 整理专有名词失败（{e}），只用 Bangumi 上的角色名")
    if not terms:  # 没有 AI 或 AI 失败：直接用 Bangumi 的角色名（没有读音）
        terms = _clean([{"text": n, "kind": "人名"} for n in names])
    if not terms:
        return None

    glossary = {
        "work": work,
        "title": title,
        "source": f"Bangumi「{subject.get('name_cn') or subject.get('name')}」" if subject else "AI",
        "terms": terms,
    }
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(glossary, ensure_ascii=False, indent=1), encoding="utf-8")
    return glossary


def for_prompt(glossary: dict | None) -> list[str]:
    """给 AI 校对用的列表：写法（读音）"""
    if not glossary:
        return []
    return [f"{t['text']}（{t['reading']}）" if t["reading"] else t["text"] for t in glossary["terms"]]


def readings(glossary: dict | None) -> dict[str, str]:
    """写法 → 读音，注音时人名按这个标"""
    if not glossary:
        return {}
    return {t["text"]: t["reading"] for t in glossary["terms"] if t["reading"]}


def apply_readings(sentences: list[dict], glossary: dict | None) -> int:
    """分词结果里和词表写法完全一样的词，读音改成词表的（分词器常把人名读错）。返回改了几处。"""
    table = readings(glossary)
    fixed = 0
    for s in sentences:
        for t in s.get("tokens") or []:
            reading = table.get(t["surface"])
            if not reading or reading == t.get("reading") or not any(char_type(ch) == KANJI for ch in t["surface"]):
                continue
            furigana = align(t["surface"], reading)
            if any(seg["reading"] for seg in furigana):  # 对不齐就不改
                t["reading"], t["furigana"] = reading, furigana
                fixed += 1
    return fixed


def parse_manual(text: str) -> list[dict]:
    """导入页手动填的：空格、顿号、逗号隔开，括号里可以写读音，例如「唯（ゆい） 桜が丘、放課後ティータイム」"""
    terms = []
    for item in re.split(r"[\s、，,;；]+", text.strip()):
        if m := re.fullmatch(r"(.+?)[（(]([^）)]*)[）)]", item):
            terms.append({"text": m.group(1), "reading": m.group(2), "kind": "手动"})
        elif item:
            terms.append({"text": item, "reading": "", "kind": "手动"})
    return _clean(terms)


def merge(glossary: dict | None, manual: list[dict]) -> dict | None:
    """手动填的放前面；写法重复的以手动为准"""
    if not manual:
        return glossary
    if not glossary:
        return {"work": None, "title": None, "source": "手动填写", "terms": manual}
    texts = {t["text"] for t in manual}
    return {**glossary, "source": f"{glossary['source']} 和手动填写",
            "terms": manual + [t for t in glossary["terms"] if t["text"] not in texts]}


# ---------------------------------------------------------------- 从标题认出作品名

GUESS_PROMPT = """下面是一个视频或音频的标题（可能是下载下来的标题，也可能是本地文件名）。判断它是哪部动画、日剧、电影、综艺或别的作品，
返回作品名：用最常见的叫法（中文或日文都行），去掉集数、季数、清晰度、字幕组、网站名这些。
如果看不出是哪部作品（比如新闻、讲座、Vlog、播客单集、教程），返回空字符串，不要猜。
只返回 JSON：{"work":"作品名或空字符串"}"""

_NOISE = re.compile(
    r"(第\s*[0-9０-９一二三四五六七八九十百]+\s*[話话集回季期巻卷部]|[#＃]\s*\d+|\bS\d+E\d+\b|\bEP?\s*\d+\b|\b\d{3,4}p\b"
    r"|在线观看|在線觀看|高清|中字|中文字幕|简中|繁中|全集|完整版|无修|BD|WEB-?DL|\bHD\b)", re.I)


def clean_title(title: str) -> str:
    """没有 AI 时粗略整理：去掉方括号里的字幕组、集数、清晰度，网站名之类的尾巴"""
    t = re.sub(r"\.(mp4|mkv|avi|mov|webm|m4a|mp3|flac|wav)$", "", title.strip(), flags=re.I)
    t = re.sub(r"^[\[【［(（][^\]】］)）]{0,30}[\]】］)）]\s*", "", t)  # 开头的字幕组
    t = re.split(r"\s*[-–—_|｜／/]\s*", t)[0] or t
    t = _NOISE.split(t)[0] if _NOISE.search(t) else t
    return re.sub(r"[\s　・:：]+$", "", t).strip()


def guess_work(cfg: Config, title: str) -> str | None:
    """从视频标题或文件名认出作品名；认不出返回 None"""
    if not title.strip():
        return None
    if cfg.llm.key() and cfg.llm.model:
        try:
            result = chat_json(cfg.llm, [
                {"role": "system", "content": GUESS_PROMPT},
                {"role": "user", "content": title.strip()[:200]},
            ], temperature=0.0, max_tokens=100, timeout=60)
            work = str(result.get("work") or "").strip() if isinstance(result, dict) else ""
            return work[:80] or None
        except LlmError:
            pass  # AI 出错就用规则整理
    work = clean_title(title)
    return work if len(work) >= 2 else None


def summary(glossary: dict) -> str:
    sample = "、".join(t["text"] for t in glossary["terms"][:6])
    more = "…" if len(glossary["terms"]) > 6 else ""
    return f"专有名词：从 {glossary['source']} 准备了 {len(glossary['terms'])} 个（{sample}{more}）"
