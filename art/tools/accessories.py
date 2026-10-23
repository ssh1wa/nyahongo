"""32 件饰品 × 6 种体型。

饰品不画成固定图片，而是按每种体型的锚点（头顶、头宽、眼睛、耳尖、脖子）贴图或生成，所以戴在哪种猫身上都对得上。
描边和阴影自动加：伸出猫身的地方加深色描边，压在毛上的地方用饰品本身的深色做分界。

输出的饰品图层是 32×40：比猫多出上方 8 行，给高帽子、光环留空间（猫画在第 8 行往下）。

运行：uv run --with pillow --no-project python -I art/tools/accessories.py
输出：art/accessories/<体型>/<饰品>.png，以及总览图 art/accessories/overview.png
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from cats import BODY_ORDER, N, OUTLINE, Body, bodies, cats, darken, ellipse, hexc, render, shape_of  # noqa: E402

TOP = 8  # 饰品图层比猫多出的上方行数
H = N + TOP
OUT = Path(__file__).resolve().parents[1] / "accessories"
Px = tuple[int, int]


# ---------------------------------------------------------------- 锚点

@dataclass
class Anchors:
    top: int  # 头顶描边所在行
    span: Callable[[int], tuple[int, int]]  # 某一行头的左右边界（含描边）
    body_span: Callable[[int], tuple[int, int]]
    eye_l: tuple[int, int, int, int]  # minx, miny, maxx, maxy
    eye_r: tuple[int, int, int, int]
    neck: int
    ear_l: Px  # 左耳尖
    ear_r: Px
    sil: set[Px]


def anchors(b: Body) -> Anchors:
    s = shape_of(b)
    head = ellipse(*b.head_e)
    top = min(y for x, y in head if x in (14, 15))

    def span_of(mask: set[Px]) -> Callable[[int], tuple[int, int]]:
        def f(y: int) -> tuple[int, int]:
            xs = [x for x, yy in mask if yy == y]
            return (min(xs), max(xs)) if xs else (15, 14)
        return f

    eyes = [(x, y) for (x, y), k in b.face.items() if k in ("e", "s")]
    el = [(x, y) for x, y in eyes if x < 15]
    er = [(x, y) for x, y in eyes if x >= 15]
    box = lambda pts: (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    ears_l = [(x, y) for x, y in b.ears if x < 15]
    ears_r = [(x, y) for x, y in b.ears if x >= 15]
    ear_l = min(ears_l, key=lambda p: (p[1], p[0]))
    ear_r = min(ears_r, key=lambda p: (p[1], -p[0]))
    return Anchors(top, span_of(head), span_of(b.body), box(el), box(er), s.neck, ear_l, ear_r, s.sil)


# ---------------------------------------------------------------- 饰品

@dataclass
class Acc:
    id: str
    rarity: str
    colors: dict[str, str]  # 图案字符 → 颜色；O 是描边
    build: Callable[[Anchors], dict[Px, str]]
    outline: bool = True  # 伸出猫身的部分自动描边
    sparkles: Callable[[Anchors], list[tuple[int, int, str]]] | None = None


def stamp(grid: list[str], x0: int, y0: int, flip: bool = False) -> dict[Px, str]:
    out: dict[Px, str] = {}
    w = max(len(r) for r in grid)
    for dy, row in enumerate(grid):
        for dx, ch in enumerate(row):
            if ch != ".":
                out[(x0 + (w - 1 - dx if flip else dx), y0 + dy)] = ch
    return out


def centered(grid: list[str], bottom: int) -> dict[Px, str]:
    """水平居中（画布中心在第 14、15 列之间），最后一行放在 bottom 行"""
    w = max(len(r) for r in grid)
    return stamp(grid, 15 - w // 2, bottom - len(grid) + 1)


def band(a: Anchors, y: int, rows: int, color: Callable[[int, int], str], pad: int = 0) -> dict[Px, str]:
    """沿头的宽度画一条横带（不盖住描边），pad 是两边往外多伸的格数"""
    out = {}
    for yy in range(y, y + rows):
        lo, hi = a.span(yy)
        for x in range(lo + 1 - pad, hi - pad + pad * 2):
            out[(x, yy)] = color(x, yy)
    return out


def body_band(a: Anchors, y: int, rows: int, color: Callable[[int, int], str], pad: int = 0) -> dict[Px, str]:
    out = {}
    for yy in range(y, y + rows):
        lo, hi = a.body_span(yy)
        for x in range(lo + 1 - pad, hi + pad):
            out[(x, yy)] = color(x, yy)
    return out


def mirror_pair(grid: list[str], x_left: int, y0: int) -> dict[Px, str]:
    """左边一份，右边镜像一份（对称轴在 14、15 列之间）"""
    w = max(len(r) for r in grid)
    out = stamp(grid, x_left, y0)
    out.update(stamp(grid, 29 - x_left - w + 1, y0, flip=True))
    return out


def horn_x(a: Anchors, inset: float = 0.42) -> int:
    lo, hi = a.span(a.top + 2)
    return round(15 - (hi - lo) * inset) - 1


def accessories() -> list[Acc]:
    L: list[Acc] = []
    ey = lambda a: min(a.eye_l[1], a.eye_r[1])

    # ---------- 普通 ----------
    def hachimaki(a):
        y = ey(a) - 3
        out = band(a, y, 2, lambda x, yy: "b" if x in (14, 15) else "a")
        lo, hi = a.span(y)
        out.update({(hi + 1, y): "a", (hi + 2, y - 1): "a", (hi + 1, y + 1): "a", (hi + 2, y + 2): "a", (hi + 3, y + 2): "a"})
        return out
    L.append(Acc("hachimaki", "common", {"a": "#F3EFE6", "b": "#D8443A"}, hachimaki))

    def ribon(a):
        x, y = a.ear_r
        return stamp(["aa.aa", "abbba", "aa.aa"], x - 2, y + 2)
    L.append(Acc("ribon", "common", {"a": "#E0483E", "b": "#A82D25"}, ribon))

    L.append(Acc("mugiwara", "common", {"a": "#E9C46A", "h": "#F7DC94", "b": "#C8352B"}, lambda a: centered([
        "......ahahahaa......",
        ".....aahahahaaa.....",
        ".....bbbbbbbbbb.....",
        "..aaahaaahaaahaaaa..",
        "aaaaaaaaaaaaaaaaaaaa",
    ], a.top + 2)))

    def megane(a):
        out = {}
        for x0, y0, x1, y1 in (a.eye_l, a.eye_r):
            for x in range(x0 - 1, x1 + 2):
                for y in range(y0 - 1, y1 + 2):
                    if x in (x0 - 1, x1 + 1) or y in (y0 - 1, y1 + 1):
                        out[(x, y)] = "a"
        y = a.eye_l[1]
        for x in range(a.eye_l[2] + 2, a.eye_r[0] - 1):
            out[(x, y)] = "a"
        return out
    L.append(Acc("megane", "common", {"a": "#7A4B32"}, megane, outline=False))

    def suzu(a):
        out = body_band(a, a.neck, 1, lambda x, y: "a")
        out.update({(14, a.neck + 1): "h", (15, a.neck + 1): "b", (14, a.neck + 2): "b", (15, a.neck + 2): "b"})
        return out
    L.append(Acc("suzu", "common", {"a": "#D8443A", "b": "#F2C94C", "h": "#FFF2B0"}, suzu))

    L.append(Acc("bere", "common", {"a": "#6B8E5A", "b": "#4E6B40"}, lambda a: centered([
        "........bb....",
        "...aaaaaaaaa..",
        ".aaaaaaaaaaaaa",
        "aaaaaaaaaaaaaa",
    ], a.top + 2)))

    L.append(Acc("keito", "common", {"a": "#D8443A", "h": "#EC7A70", "b": "#F3E3C3", "c": "#FFF6E4"}, lambda a: centered([
        "......cc......",
        ".....cccc.....",
        "....aahaha....",
        "..ahahahahaha..",
        ".ahahahahahaha.",
        "bbbbbbbbbbbbbbbb",
        "bbbbbbbbbbbbbbbb",
    ], a.top + 3)))

    def mafuraa(a):
        stripe = lambda x, y: "a" if (x // 2) % 2 == 0 else "b"
        out = body_band(a, a.neck - 1, 2, stripe, pad=1)
        lo, _ = a.body_span(a.neck)
        for i, y in enumerate(range(a.neck + 1, a.neck + 5)):
            out[(lo + 3, y)] = "a" if i % 2 == 0 else "b"
            out[(lo + 4, y)] = "a" if i % 2 == 0 else "b"
        return out
    L.append(Acc("mafuraa", "common", {"a": "#D8443A", "b": "#FFFDF8"}, mafuraa))

    L.append(Acc("chounekutai", "common", {"a": "#2F3A66", "b": "#1E2546"}, lambda a: stamp(["aa..aa", "aabbaa", "aa..aa"], 12, a.neck)))

    def heddohon(a):
        out = {}
        y_band = a.top - 1
        lo, hi = a.span(a.top + 1)
        for x in range(lo, hi + 1):
            out[(x, y_band)] = "a"
        e = ey(a)
        for y in range(a.top, e - 1):
            l, r = a.span(y)
            out[(l - 1, y)] = "a"
            out[(r + 1, y)] = "a"
        for y in range(e - 1, e + 3):
            l, r = a.span(y)
            out.update({(l - 2, y): "b", (l - 1, y): "b", (r + 1, y): "b", (r + 2, y): "b"})
        l, r = a.span(e - 1)
        out[(l - 2, e - 1)] = "h"
        out[(r + 1, e - 1)] = "h"
        return out
    L.append(Acc("heddohon", "common", {"a": "#3FA796", "b": "#2D7A6D", "h": "#8FD9CB"}, heddohon))

    # 狸猫变身用的那片叶子
    L.append(Acc("happa", "common", {"a": "#6FA552", "h": "#9CCB78", "b": "#5B4630"}, lambda a: centered([
        "....aa",
        "..aaha",
        ".aahaa",
        "aahaa.",
        ".aa...",
        "b.....",
    ], a.top + 1)))

    def sangurasu(a):
        out = {}
        for x0, y0, x1, y1 in (a.eye_l, a.eye_r):
            for x in range(x0 - 1, x1 + 2):
                for y in range(y0 - 1, y1 + 2):
                    edge = x in (x0 - 1, x1 + 1) or y in (y0 - 1, y1 + 1)
                    out[(x, y)] = "b" if edge else ("h" if (x, y) == (x0, y0) else "a")
        y = a.eye_l[1] - 1
        for x in range(a.eye_l[2] + 2, a.eye_r[0] - 1):
            out[(x, y)] = "b"
        return out
    L.append(Acc("sangurasu", "common", {"a": "#2A2A33", "b": "#1B1B22", "h": "#8A8AA0"}, sangurasu, outline=False))

    L.append(Acc("kaeru", "common", {"a": "#7DBB5A", "h": "#A8D98A", "w": "#FFFFFF", "k": "#3A2E2A"}, lambda a: centered([
        "..ww....ww..",
        ".wkkw..wkkw.",
        ".aaaaaaaaaa.",
        "aahaaaaaahaa",
        "aaaaaaaaaaaa",
    ], a.top + 2)))

    # ---------- 稀有 ----------
    def kitsunemen(a):
        _, hi = a.span(a.top + 3)
        return stamp([
            ".O....O.",
            "OaO..OaO",
            "OaaOOaaO",
            "OabaabaO",
            "OaaaaaaO",
            ".OaabaO.",
            "..OaaO..",
            "...OO...",
        ], hi - 4, a.top - 1)
    L.append(Acc("kitsunemen", "rare", {"a": "#FFFFFF", "b": "#D8443A", "O": "#3A2E2A"}, kitsunemen))

    def kamikazari(a):
        x, y = a.ear_l
        return stamp([".a.a.", "aabaa", ".aaa.", "..c..", "..h..", "..c..", "..h.."], x - 1, y + 2)
    L.append(Acc("kamikazari", "rare", {"a": "#F4A6BD", "b": "#F2C94C", "c": "#C9A04A", "h": "#E8F0FF"}, kamikazari))

    L.append(Acc("oninotsuno", "rare", {"a": "#D8443A", "b": "#F2C94C"}, lambda a: mirror_pair([".b", ".a", "aa", "aa"], horn_x(a), a.top - 2)))

    def tenugui(a):
        y = ey(a) - 3
        out = band(a, y, 2, lambda x, yy: "b" if (x + yy) % 3 == 0 else "a")
        lo, _ = a.span(y)
        out.update({(lo - 1, y): "a", (lo - 2, y - 1): "a", (lo - 1, y + 1): "a", (lo - 2, y + 2): "a", (lo - 3, y + 2): "a"})
        return out
    L.append(Acc("tenugui", "rare", {"a": "#3F5F9A", "b": "#E8EEF8"}, tenugui))

    L.append(Acc("gakubou", "rare", {"a": "#2F2D3A", "b": "#F2C94C", "c": "#45434F", "d": "#1B1A22"}, lambda a: centered([
        "..aaaaaaaaaa..",
        ".aaaaabbaaaaa.",
        "aaaaaaaaaaaaaa",
        "cccccccccccccc",
        "..dddddddddd..",
    ], a.top + 3)))

    L.append(Acc("kasa", "rare", {"a": "#D9B26A", "h": "#B88E46"}, lambda a: centered([
        "..........aa..........",
        "........aahaaa........",
        "......aaahaahaaa......",
        "....aahaaahaaahaaa....",
        "..aaahaaahaaahaaahaa..",
        "aaaaaaaaaaaaaaaaaaaaaa",
    ], a.top + 2)))

    def tengumen(a):
        _, hi = a.span(a.top + 3)
        return stamp([
            ".OOOOO....",
            "OaaaaaO...",
            "OacaacO...",
            "OaaaaaaaaO",
            "OaaaaaaOO.",
            ".OaaaaO...",
            "..OOOO....",
        ], hi - 4, a.top)
    L.append(Acc("tengumen", "rare", {"a": "#D23A2E", "c": "#F2C94C", "O": "#3A2E2A"}, tengumen))

    L.append(Acc("chonmage", "rare", {"a": "#2B2624", "b": "#FFFDF8", "h": "#4A4340"}, lambda a: centered(["..ah..", ".aaaha", ".aaaa.", "..bb..", ".aaaa."], a.top + 1)))

    def omamori(a):
        out = body_band(a, a.neck, 1, lambda x, y: "c")
        out.update(stamp([".bb.", "aaaa", "ahha", "aaaa", "aaaa"], 13, a.neck + 1))
        return out
    L.append(Acc("omamori", "rare", {"a": "#C8352B", "h": "#F2C94C", "b": "#F2C94C", "c": "#D8443A"}, omamori))

    L.append(Acc("santa", "rare", {"a": "#D8443A", "b": "#FFFDF8", "c": "#FFFDF8"}, lambda a: centered([
        "........aaa.cc",
        "......aaaaaacc",
        "....aaaaaaaa..",
        "..aaaaaaaaaa..",
        "bbbbbbbbbbbbbb",
        "bbbbbbbbbbbbbb",
    ], a.top + 3)))

    def kanzashi(a):
        x, y = a.ear_r
        return stamp(["...bb", "..bab", "..cb.", ".c...", "c.h..", "..d..", "..h..", "..d.."], x - 3, y + 1)
    L.append(Acc("kanzashi", "rare", {"a": "#F2C94C", "b": "#E3607A", "c": "#8A5A36", "d": "#F4A6BD", "h": "#FFFFFF"}, kanzashi))

    # ---------- 史诗 ----------
    L.append(Acc("oukan", "epic", {"a": "#F2C94C", "h": "#FFF2B0", "b": "#D8443A", "c": "#3F7DB8"}, lambda a: centered([
        "h....hh....h",
        "aa..aaaa..aa",
        "aahaaaaaahaa",
        "abaaaccaaaba",
        "aaaaaaaaaaaa",
    ], a.top + 2), sparkles=lambda a: [(4, a.top - 3, "#FFF2B0"), (26, a.top - 1, "#FFF2B0")]))

    def hanakanmuri(a):
        flowers = ["b", "a", "c", "a", "h", "a"]
        out = band(a, a.top + 1, 1, lambda x, y: flowers[x % 6], pad=1)
        out.update(band(a, a.top + 2, 1, lambda x, y: "a" if x % 3 else flowers[(x + 3) % 6], pad=1))
        lo, hi = a.span(a.top + 1)
        for x in range(lo, hi + 1):
            if x % 3 == 1:
                out[(x, a.top)] = flowers[(x // 3) % 3 * 2]
        return out
    L.append(Acc("hanakanmuri", "epic", {"a": "#7FB069", "b": "#F4A6BD", "c": "#F7DC6F", "h": "#FFFFFF"}, hanakanmuri,
                 sparkles=lambda a: [(5, a.top - 2, "#FDE6EE"), (25, a.top - 3, "#FFF6C8")]))

    L.append(Acc("tenshinowa", "epic", {"a": "#F7DC6F", "h": "#FFF8D8"}, lambda a: centered([
        "..ahhhhhha..",
        "aa........aa",
        "..aaaaaaaa..",
    ], a.top - 3), outline=False, sparkles=lambda a: [(6, a.top - 6, "#FFF8D8"), (24, a.top - 4, "#FFF8D8")]))

    L.append(Acc("mahou", "epic", {"a": "#6A4FA3", "h": "#8C72C8", "b": "#F2C94C", "c": "#FFF2B0"}, lambda a: centered([
        "............aa..",
        "...........aaa..",
        ".........aaaa...",
        "........aahaa...",
        ".......aaacaa...",
        "......aahaaaa...",
        ".....aaaaaacaa..",
        "....aacaahaaaa..",
        "...bbbbbbbbbbb..",
        "aaaaaaaaaaaaaaaa",
    ], a.top + 2), sparkles=lambda a: [(25, a.top - 6, "#FFF2B0"), (5, a.top - 2, "#FFF2B0")]))

    L.append(Acc("shiruku", "epic", {"a": "#2B2624", "h": "#4A4340", "b": "#C8352B"}, lambda a: centered([
        "..aaaaaaaa..",
        "..ahaaaaaa..",
        "..ahaaaaaa..",
        "..ahaaaaaa..",
        "..ahaaaaaa..",
        "..ahaaaaaa..",
        "..bbbbbbbb..",
        ".aaaaaaaaaa.",
        "aaaaaaaaaaaa",
    ], a.top + 2), sparkles=lambda a: [(5, a.top - 3, "#FFF2B0"), (25, a.top - 5, "#FFF2B0")]))

    # ---------- 传说 ----------
    def inari(a):
        out = {}
        ear = ["a....", "aa...", "aba..", "abba.", "abbba", "aaaaa"]
        (xl, yl), (xr, yr) = a.ear_l, a.ear_r
        # 狐耳要接在头顶上（盖住原来的猫耳），不能飘在空中
        ear = ["a.....", "aa....", "aba...", "abba..", "abbba.", "abbbba", "aaaaaa"]
        y0 = a.top + 2 - len(ear)
        out.update(stamp(ear, xl - 1, y0))
        out.update(stamp(ear, xr - 4, y0, flip=True))
        for x in range(12, 18):
            out[(x, a.top + 1)] = "c" if x % 2 == 0 else "d"
        lo, hi = a.span(ey(a))
        for x, y in ((lo - 3, ey(a) - 3), (lo - 3, ey(a) - 4), (lo - 4, ey(a) - 5), (hi + 3, ey(a) - 2), (hi + 3, ey(a) - 3), (hi + 4, ey(a) - 4)):
            out[(x, y)] = "f"
        return out
    L.append(Acc("inari", "legendary", {"a": "#F2C94C", "b": "#FFFDF8", "c": "#D8443A", "d": "#FFFFFF", "f": "#9ED8FF"}, inari,
                 sparkles=lambda a: [(3, a.top - 4, "#FFF2B0"), (27, a.top - 6, "#FFF2B0")]))

    def ryuu(a):
        horn = ["h...a.", "a..a..", ".a.a..", ".aah..", "..a...", "..a..."]
        out = mirror_pair(horn, horn_x(a, 0.5) - 3, a.top - 4)
        for x, y in ((3, a.top - 1), (4, a.top - 1), (4, a.top - 2), (25, a.top - 2), (26, a.top - 2), (26, a.top - 3)):
            out[(x, y)] = "c"
        return out
    L.append(Acc("ryuunotsuno", "legendary", {"a": "#3FA796", "h": "#B8F0E0", "c": "#F4FAFF"}, ryuu,
                 sparkles=lambda a: [(6, a.top - 6, "#B8F0E0"), (23, a.top - 7, "#B8F0E0")]))

    # 狐火：头的两边和上方飘着几团蓝色的火
    def kitsunebi(a):
        flame = ["..a..", ".aa..", ".aha.", "ahwha", "ahwha", ".aha."]
        small = [".a.", "aa.", "awa", ".a."]
        lo, hi = a.span(ey(a))
        out = stamp(flame, max(0, lo - 6), ey(a) - 8)  # 别超出画布：宽脸的猫火会被切掉
        out.update(stamp(flame, min(N - 5, hi + 2), ey(a) - 10, flip=True))
        out.update(stamp(small, 21, a.top - 8))
        return out
    L.append(Acc("kitsunebi", "legendary", {"a": "#4FA8FF", "h": "#A8DCFF", "w": "#FFFFFF"}, kitsunebi, outline=False,
                 sparkles=lambda a: [(4, a.top - 5, "#B8E2FF"), (10, a.top - 7, "#DFF4FF")]))
    return L


# ---------------------------------------------------------------- 渲染

def render_acc(acc: Acc, a: Anchors) -> Image.Image:
    raw = acc.build(a)
    pix = {(x, y): k for (x, y), k in raw.items() if 0 <= x < N and -TOP <= y < N}
    mask = set(pix)
    img = Image.new("RGBA", (N, H), (0, 0, 0, 0))
    p = img.load()
    for (x, y), k in pix.items():
        col = hexc(acc.colors[k]) if k != "O" else OUTLINE
        if k in ("a", "b") and ((x + 1, y) not in mask or (x, y + 1) not in mask):
            col = darken(col, 0.88)
        # 压在猫身上的下沿：用深一点的颜色做分界，不用黑线
        if k != "O" and (x, y + 1) not in mask and (x, y + 1) in a.sil and acc.outline:
            col = darken(col, 0.78)
        p[x, y + TOP] = (*col, 255)
    if acc.outline:
        for x, y in list(mask):
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                X, Y = x + dx, y + dy
                if (X, Y) in mask or (X, Y) in a.sil or not (0 <= X < N and -TOP <= Y < N):
                    continue
                p[X, Y + TOP] = (*OUTLINE, 255)
    for x, y, c in (acc.sparkles(a) if acc.sparkles else []):
        col = hexc(c)
        if 0 <= x < N and -TOP <= y < N:
            p[x, y + TOP] = (*col, 255)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                X, Y = x + dx, y + dy
                if 0 <= X < N and -TOP <= Y < N and (X, Y) not in mask and (X, Y) not in a.sil:
                    p[X, Y + TOP] = (*col, 130)
    return img


def main():
    bs = bodies()
    accs = accessories()
    all_cats = {c.id: c for c in cats()}
    show = {"manmaru": "chatora", "mochi": "sabatora", "surari": "shamu", "fuwa": "kuriimu", "chokon": "kinako", "oomimi": "kafeore"}
    order = list(BODY_ORDER)
    layers: dict[tuple[str, str], Image.Image] = {}
    for body in order:
        a = anchors(bs[body])
        (OUT / body).mkdir(parents=True, exist_ok=True)
        for acc in accs:
            im = render_acc(acc, a)
            layers[(body, acc.id)] = im
            im.save(OUT / body / f"{acc.id}.png")

    scale = 3
    cw, ch = N * scale, H * scale
    per_row = 4
    group_w = len(order) * (cw + 4) + 16
    label_h = 18
    rows = (len(accs) + per_row - 1) // per_row
    sheet = Image.new("RGB", (per_row * group_w + 16, rows * (ch + label_h + 14) + 12), (245, 241, 232))
    d = ImageDraw.Draw(sheet)
    rc = {"common": (140, 132, 120), "rare": (63, 125, 184), "epic": (154, 85, 200), "legendary": (210, 154, 30)}
    for i, acc in enumerate(accs):
        gx = 16 + (i % per_row) * group_w
        gy = 12 + (i // per_row) * (ch + label_h + 14)
        d.rectangle([gx - 4, gy - 2, gx + len(order) * (cw + 4) - 2, gy + ch + 1], fill=(255, 253, 248))
        for j, body in enumerate(order):
            cat_img = render(all_cats[show[body]], bs)
            comp = Image.new("RGBA", (N, H), (0, 0, 0, 0))
            comp.paste(cat_img, (0, TOP), cat_img)
            comp = Image.alpha_composite(comp, layers[(body, acc.id)])
            big = comp.resize((cw, ch), Image.NEAREST)
            sheet.paste(big, (gx + j * (cw + 4), gy), big)
        d.rectangle([gx - 4, gy + ch + 2, gx + len(order) * (cw + 4) - 2, gy + ch + 4], fill=rc[acc.rarity])
        d.text((gx, gy + ch + 6), acc.id, fill=(91, 84, 75))
    sheet.save(OUT / "overview.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
