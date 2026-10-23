"""预生成语法课，打进 App：课程安排（单元）、每个语法点的中文简述、828 课课文和小测验。

提示词和 App 里 app/src/lib/grammar.ts 的一样（课文按语法点所在的级别写）。每课生成完就写进缓存，
中途断了重跑会跳过已经生成的，不会重复花钱。

运行（在 pc 目录）：uv run python tools/pregen_grammar.py [--only-course] [--workers 6]
输出：app/src/data/grammar/course.json、zh.json、lessons_N5.json … lessons_N1.json
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from nihongo_pc.config import load_config  # noqa: E402
from nihongo_pc.furigana import KANJI, char_type, tokenize  # noqa: E402
from nihongo_pc.llm import LlmError, chat_json  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = json.loads((ROOT / "app/src/data/grammar.json").read_text(encoding="utf-8"))
OUT = ROOT / "app/src/data/grammar"
CACHE = ROOT / "pc/workspace/pregen_grammar"
LEVELS = ["N5", "N4", "N3", "N2", "N1"]

RUBY = ('Japanese sentences are arrays of segments {"text":"学校","reading":"がっこう"}; readings (hiragana) only on '
        'kanji-bearing segments, null elsewhere; split kanji from okurigana.')


def clean_title(t: str) -> str:
    import re
    return re.sub(r"\s*[（(][^）)]*[a-z][^）)]*[）)]\s*$", "", t, flags=re.I).strip()


# ---------------------------------------------------------------- 课程安排

def design_course(cfg, level: str) -> list[dict]:
    """语法点多的级别 AI 一次容易漏排几个，最多试 3 次，取漏得最少的那次"""
    best: list[dict] | None = None
    for _ in range(3):
        units = design_course_once(cfg, level)
        missing = sum(len(u["ids"]) for u in units if u["title"].startswith("补充语法"))
        if best is None or missing < best[0]:
            best = (missing, units)
        if missing == 0:
            break
    print(f"  {level} 漏排 {best[0]} 个", flush=True)
    return best[1]


def design_course_once(cfg, level: str) -> list[dict]:
    points = LIBRARY[level]
    raw = chat_json(cfg, [
        {"role": "system", "content": f"""你是日语课程设计师，学生是中文母语者。把下面 {level} 级的全部语法点排成一门循序渐进的课程：
- 分成若干单元，每单元 5-8 个语法点，相关的放在一起（比如同一类表达、意思相近需要对比的）
- 先易后难，先高频后低频
- 每个语法点必须出现且只出现一次，用给出的 id
- 单元标题和主题用简体中文，简短具体
只返回 JSON：{{"units":[{{"title":"单元标题","theme":"一句话说明这单元学什么","ids":["N5-001","N5-007"]}}]}}"""},
        {"role": "user", "content": json.dumps([{"id": p["id"], "title": clean_title(p["title"]), "meaning": p["short"]} for p in points], ensure_ascii=False)},
    ], temperature=0.3, max_tokens=8000)
    units = [u for u in (raw.get("units") if isinstance(raw, dict) else None) or [] if isinstance(u, dict) and isinstance(u.get("ids"), list)]
    # 去重、去掉不存在的 id，漏掉的补到最后（和 App 里的处理一样）
    valid = {p["id"] for p in points}
    seen: set[str] = set()
    fixed = []
    for u in units:
        ids = [i for i in map(str, u["ids"]) if i in valid and not (i in seen or seen.add(i))]
        if ids:
            fixed.append({"title": str(u.get("title") or "单元"), "theme": str(u.get("theme") or ""), "ids": ids})
    missing = [p["id"] for p in points if p["id"] not in seen]
    for k in range(0, len(missing), 7):
        fixed.append({"title": f"补充语法 {k // 7 + 1}", "theme": "其他常见语法", "ids": missing[k:k + 7]})
    if not fixed:
        raise LlmError(f"{level} 课程设计失败")
    return fixed


def translate_meanings(cfg, level: str) -> dict[str, str]:
    points = LIBRARY[level]
    raw = chat_json(cfg, [
        {"role": "system", "content": '把每个日语语法点的英文简要说明翻译成简体中文，15 字以内，说清楚意思和用法即可。只返回 JSON：{"meanings":{"语法点id":"中文意思"}}，id 原样保留，不要遗漏。'},
        {"role": "user", "content": json.dumps({p["id"]: f"{clean_title(p['title'])}: {p['short']}" for p in points}, ensure_ascii=False)},
    ], temperature=0.1, max_tokens=8000)
    m = raw.get("meanings") if isinstance(raw, dict) else None
    valid = {p["id"] for p in points}
    return {k: v.strip() for k, v in (m or {}).items() if k in valid and isinstance(v, str) and v.strip()}


# ---------------------------------------------------------------- 课文

def lesson_prompt(level: str) -> str:
    return f"""你是耐心严谨的日语老师，学生是中文母语者，水平 {level}。根据给出的语法点资料（来自开源语法库，英文）写一课中文讲解。
- 以资料为依据，不要编造资料里没有的用法；资料有误时按标准日语纠正
- 例句自然、日常，难度符合学生水平，5 句
- 3 道选择题，考查是否真正理解这个语法（接续、意思、和相近语法的区别），每题 4 个选项
{RUBY}
只返回 JSON：
{{"meaning":"一句话中文意思","formation":"接续方式（中文说明，如：动词て形 + もいい）","explanation":"用法讲解，2-4 段","nuance":"语感、和相近语法的区别","mistakes":["中文母语者常见错误"],
 "examples":[{{"japanese":[{{"text":"...","reading":null}}],"chinese":"中文"}}],
 "quiz":[{{"question":[{{"text":"日语题干，空白处用（　）","reading":null}}],"prompt":"中文说明这题考什么","options":["选项1","选项2","选项3","选项4"],"answer":0,"explanation":"为什么"}}]}}"""


def segs(v) -> list[dict]:
    out = []
    for s in v if isinstance(v, list) else []:
        if isinstance(s, dict) and isinstance(s.get("text"), str) and s["text"]:
            r = s.get("reading")
            out.append({"text": s["text"], "reading": r if isinstance(r, str) and r.strip() else None})
    return out


def shape_lesson(raw: dict, p: dict) -> dict:
    s = lambda v, d="": v.strip() if isinstance(v, str) else d  # noqa: E731
    examples = [{"japanese": j, "chinese": s(e.get("chinese"))} for e in raw.get("examples") or [] if isinstance(e, dict) and (j := segs(e.get("japanese")))]
    quiz = []
    for q in raw.get("quiz") or []:
        if not isinstance(q, dict):
            continue
        opts = [str(o) for o in q.get("options") or [] if isinstance(o, (str, int, float))]
        try:
            ans = int(round(float(q.get("answer"))))
        except (TypeError, ValueError):
            continue
        question = segs(q.get("question"))
        if len(opts) >= 2 and 0 <= ans < len(opts) and question:
            quiz.append({"question": question, "prompt": s(q.get("prompt")), "options": opts, "answer": ans, "explanation": s(q.get("explanation"))})
    return {
        "meaning": s(raw.get("meaning"), p["short"]),
        "formation": s(raw.get("formation"), p.get("formation", "")),
        "explanation": s(raw.get("explanation")),
        "nuance": s(raw.get("nuance")),
        "mistakes": [m.strip() for m in raw.get("mistakes") or [] if isinstance(m, str) and m.strip()],
        "examples": examples,
        "quiz": quiz,
    }


def make_lesson(cfg, level: str, p: dict) -> dict:
    for attempt in range(3):
        raw = chat_json(cfg, [
            {"role": "system", "content": lesson_prompt(level)},
            {"role": "user", "content": json.dumps({"title": p["title"], "short": p["short"], "explanation": p["long"], "formation": p["formation"], "examples": p["examples"]}, ensure_ascii=False)},
        ], temperature=0.4, max_tokens=8192, timeout=300)  # 课文长，模型有时要一两分钟才写完（试过 flex 档：长输出排队十几分钟都不返回）
        lesson = shape_lesson(raw if isinstance(raw, dict) else {}, p)
        if lesson["explanation"] and len(lesson["examples"]) >= 3 and len(lesson["quiz"]) >= 2:
            return lesson
    raise LlmError(f"{p['id']} 生成的课文不完整")


def fill_readings(segments: list[dict]) -> list[dict]:
    """AI 漏注音的汉字段用 Sudachi 补上（对不齐的仍然不注，宁缺毋错）。"""
    out = []
    for s in segments:
        if s["reading"] or not any(char_type(ch) == KANJI for ch in s["text"]):
            out.append(s)
            continue
        out.extend(f for tok in tokenize(s["text"]) for f in tok["furigana"])
    return out


def fill_lesson(lesson: dict) -> dict:
    for e in lesson["examples"]:
        e["japanese"] = fill_readings(e["japanese"])
    for q in lesson["quiz"]:
        q["question"] = fill_readings(q["question"])
    return lesson


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-course", action="store_true", help="只生成课程安排和中文简述")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--model", help="用别的模型生成（默认用 PC 端设置里的模型）")
    args = ap.parse_args()
    cfg = load_config().llm
    if args.model:
        cfg.model = args.model
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    # 课程安排和简述：每级一次，也缓存
    for name, fn in (("course", design_course), ("zh", translate_meanings)):
        path = OUT / f"{name}.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        for lv in LEVELS:
            if lv not in data:
                data[lv] = fn(cfg, lv)
                path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
                print(f"{name} {lv}: {len(data[lv])}", flush=True)
    if args.only_course:
        return

    todo = [(lv, p) for lv in LEVELS for p in LIBRARY[lv] if not (CACHE / f"{p['id']}.json").exists()]
    total = sum(len(LIBRARY[lv]) for lv in LEVELS)
    print(f"课文：已有 {total - len(todo)}，还要生成 {len(todo)}", flush=True)
    lock = threading.Lock()
    done = failed = 0
    with ThreadPoolExecutor(args.workers) as pool:
        futs = {pool.submit(make_lesson, cfg, lv, p): p for lv, p in todo}
        for f in as_completed(futs):
            p = futs[f]
            try:
                (CACHE / f"{p['id']}.json").write_text(json.dumps(f.result(), ensure_ascii=False), encoding="utf-8")
                with lock:
                    done += 1
            except Exception as e:  # 单课失败不影响别的，重跑会补上
                with lock:
                    failed += 1
                print(f"失败 {p['id']}: {e}", flush=True)
            if (done + failed) % 20 == 0:
                print(f"进度 {done + failed}/{len(todo)}（失败 {failed}）", flush=True)

    # 合并成每级一个文件，App 按级别懒加载
    for lv in LEVELS:
        lessons = {}
        for p in LIBRARY[lv]:
            f = CACHE / f"{p['id']}.json"
            if f.exists():
                lessons[p["id"]] = fill_lesson(json.loads(f.read_text(encoding="utf-8")))
        (OUT / f"lessons_{lv}.json").write_text(json.dumps(lessons, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"lessons {lv}: {len(lessons)}/{len(LIBRARY[lv])}", flush=True)
    print(f"完成：新生成 {done}，失败 {failed}", flush=True)


if __name__ == "__main__":
    main()
