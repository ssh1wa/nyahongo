"""42 只猫的像素图：6 种体型 × 7 只。

做法：每种体型用几何形状拼出身体，自动描边和打阴影，同时给每个像素标上部位（头顶、脸、耳朵、背、肚子、爪子、尾巴、尾尖）。
每只猫只是一份「部位 → 颜色」的配色，加上花纹和特效。动画以后也用同一套部位，所以所有猫的动作天然一致。

运行：uv run --with pillow --no-project python -I art/tools/cats.py
输出：art/cats/（每只猫原尺寸 PNG 和放大版，以及总览图 overview.png）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

N = 32
OUT = Path(__file__).resolve().parents[1] / "cats"
RGB = tuple[int, int, int]
Px = tuple[int, int]

OUTLINE: RGB = (58, 46, 42)
WHITE: RGB = (255, 253, 248)
PINK: RGB = (244, 166, 189)
BLUSH: RGB = (247, 190, 200)
SHINE: RGB = (255, 255, 255)


def hexc(s: str) -> RGB:
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def darken(c: RGB, k: float) -> RGB:
    return (int(c[0] * k), int(c[1] * k), int(c[2] * k))


def mix(a: RGB, b: RGB, t: float) -> RGB:
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))  # type: ignore[return-value]


# ---------------------------------------------------------------- 形状

def ellipse(cx: float, cy: float, rx: float, ry: float) -> set[Px]:
    return {(x, y) for x in range(N) for y in range(N) if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1}


def tri(a, b, c) -> set[Px]:
    def side(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    out = set()
    for x in range(N):
        for y in range(N):
            p = (x + 0.5, y + 0.5)
            d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
            if not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0)):
                out.add((x, y))
    return out


def bezier(points, t):
    pts = list(points)
    while len(pts) > 1:
        pts = [((1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]) for a, b in zip(pts, pts[1:])]
    return pts[0]


def stroke(points, r: float, steps: int = 60) -> set[Px]:
    out: set[Px] = set()
    for i in range(steps + 1):
        cx, cy = bezier(points, i / steps)
        out |= ellipse(cx, cy, r, r)
    return out


def sym(pairs: dict[Px, str]) -> dict[Px, str]:
    """五官左右对称（画布中心在第 14、15 列之间）"""
    out = dict(pairs)
    for (x, y), v in pairs.items():
        out[(29 - x, y)] = v
    return out


# ---------------------------------------------------------------- 体型

@dataclass
class Body:
    """一种体型：部件（从后往前）、头和身体的椭圆、五官位置"""
    key: str
    name: str
    tail: list[tuple[float, float]]
    tail_r: float
    body: set[Px]
    head: set[Px]
    head_e: tuple[float, float, float, float]
    body_e: tuple[float, float, float, float]
    ears: set[Px]
    paws: set[Px]
    eye_row: int
    face: dict[Px, str]  # e=眼睛 s=高光 n=鼻子 m=嘴 b=腮红 i=内耳
    merged: bool = False  # 头和身体是一整块（年糕）
    extra_tail: list[tuple[float, float]] | None = None


def bodies() -> dict[str, Body]:
    out: dict[str, Body] = {}

    # まんまる：大圆头、大眼睛
    ears = tri((6.0, 10.5), (7.2, 3.6), (12.6, 7.2)) | tri((24.0, 10.5), (22.8, 3.6), (17.4, 7.2))
    head_e = (15, 13.5, 9.6, 7.6)
    face = sym({(9, 13): "s", (10, 13): "e", (9, 14): "e", (10, 14): "e", (9, 15): "e", (10, 15): "e",
                (7, 17): "b", (8, 17): "b", (8, 7): "i", (9, 7): "i", (9, 6): "i", (8, 8): "i", (13, 18): "m"})
    face.update({(14, 17): "n", (15, 17): "n", (19, 13): "s", (20, 13): "e"})
    out["manmaru"] = Body("manmaru", "まんまる", [(20.5, 29.5), (28.5, 30), (27, 21)], 1.6,
                          ellipse(15, 24.5, 7.8, 7.6), ellipse(*head_e) | ears, head_e, (15, 24.5, 7.8, 7.6), ears,
                          ellipse(12, 30, 2.6, 2.1) | ellipse(18, 30, 2.6, 2.1), 13, face)

    # もちもち：头身一体
    ears = tri((6.4, 12.5), (7.4, 6.0), (11.6, 9.0)) | tri((23.6, 12.5), (22.6, 6.0), (18.4, 9.0))
    head_e = (15, 15.5, 9.4, 7.4)
    face = sym({(9, 17): "e", (10, 16): "e", (11, 17): "e", (7, 19): "b", (8, 19): "b",
                (8, 9): "i", (9, 9): "i", (9, 8): "i", (13, 20): "m"})
    face.update({(14, 19): "n", (15, 19): "n"})
    blob = ellipse(15, 22.5, 11.2, 9.4) | ellipse(*head_e) | ears
    out["mochi"] = Body("mochi", "もちもち", [(24, 29), (29.2, 28.5), (29, 24)], 1.5,
                        blob, set(), head_e, (15, 22.5, 11.2, 9.4), ears,
                        ellipse(11.5, 30.4, 2.4, 1.8) | ellipse(18.5, 30.4, 2.4, 1.8), 16, face, merged=True)

    # すらり：小头长身，尾巴高翘
    ears = tri((8.8, 10.0), (9.2, 3.2), (13.4, 7.2)) | tri((21.2, 10.0), (20.8, 3.2), (16.6, 7.2))
    head_e = (15, 12.2, 6.8, 5.6)
    face = sym({(11, 12): "s", (12, 12): "e", (11, 13): "e", (12, 13): "e", (10, 7): "i", (10, 6): "i", (11, 7): "i", (13, 16): "m"})
    face.update({(14, 15): "n", (15, 15): "n", (17, 12): "s", (18, 12): "e"})
    out["surari"] = Body("surari", "すらり", [(19, 29.5), (27.5, 28.5), (27, 16), (23.5, 14.5)], 1.3,
                         ellipse(15, 23.8, 5.6, 8.0) | ellipse(15, 18, 3.6, 3), ellipse(*head_e) | ears, head_e, (15, 23.8, 5.6, 8.0), ears,
                         ellipse(13, 30.2, 1.9, 1.8) | ellipse(17, 30.2, 1.9, 1.8), 12, face)

    # ふわふわ：脸颊有蓬毛
    ears = tri((6.5, 10.0), (7.8, 4.0), (12.4, 7.2)) | tri((23.5, 10.0), (22.2, 4.0), (17.6, 7.2))
    cheeks = tri((5.0, 16.5), (8.0, 13.0), (8.5, 19.0)) | tri((25.0, 16.5), (22.0, 13.0), (21.5, 19.0))
    head_e = (15, 13.5, 8.6, 7.0)
    face = sym({(10, 13): "s", (11, 13): "e", (10, 14): "e", (11, 14): "e", (8, 16): "b", (9, 16): "b",
                (9, 7): "i", (9, 6): "i", (10, 7): "i", (13, 17): "m"})
    face.update({(14, 16): "n", (15, 16): "n", (18, 13): "s", (19, 13): "e"})
    out["fuwa"] = Body("fuwa", "ふわふわ", [(20.5, 29.5), (27.5, 30.2), (28, 23.5), (26, 21.5)], 1.7,
                       ellipse(15, 24.5, 7.4, 7.6), ellipse(*head_e) | ears | cheeks, head_e, (15, 24.5, 7.4, 7.6), ears,
                       ellipse(12, 30, 2.4, 2.0) | ellipse(18, 30, 2.4, 2.0), 13, face)

    # ちょこん：小猫一样端正地坐着，个子小，豆豆眼（base_cat_options 里的第 2 个方案，再缩小一圈）
    ears = tri((9.0, 12.4), (9.4, 6.6), (13.2, 9.6)) | tri((21.0, 12.4), (20.6, 6.6), (16.8, 9.6))
    head_e = (15, 14.6, 6.8, 5.6)
    face = sym({(11, 14): "e", (11, 15): "e", (9, 17): "b", (10, 9): "i", (10, 10): "i", (11, 10): "i", (13, 18): "m"})
    face.update({(14, 17): "n", (15, 17): "n"})
    out["chokon"] = Body("chokon", "ちょこん", [(19, 30.2), (24.5, 30.6), (24.6, 25.0), (23.0, 23.6)], 1.3,
                         ellipse(15, 25.2, 5.6, 6.0), ellipse(*head_e) | ears, head_e, (15, 25.2, 5.6, 6.0), ears,
                         ellipse(12.8, 30.4, 1.9, 1.7) | ellipse(17.2, 30.4, 1.9, 1.7), 14, face)

    # おおみみ：大三角耳、小脸大眼，身子细、尾巴细长高翘（像德文卷毛猫）
    ears = tri((6.4, 13.4), (5.4, 2.6), (13.0, 9.2)) | tri((23.6, 13.4), (24.6, 2.6), (17.0, 9.2))
    head_e = (15, 15.0, 7.4, 6.0)
    face = sym({(10, 14): "s", (11, 14): "e", (10, 15): "e", (11, 15): "e", (10, 16): "e", (11, 16): "e",
                (9, 18): "b", (7, 8): "i", (7, 9): "i", (8, 9): "i", (7, 10): "i", (8, 10): "i", (8, 11): "i", (13, 19): "m"})
    face.update({(14, 18): "n", (15, 18): "n", (18, 14): "s", (19, 14): "e"})
    out["oomimi"] = Body("oomimi", "おおみみ", [(19.5, 30), (26.5, 29.5), (27.5, 21), (25, 18.5)], 1.2,
                         ellipse(15, 25.4, 6.0, 6.4), ellipse(*head_e) | ears, head_e, (15, 25.4, 6.0, 6.4), ears,
                         ellipse(12.8, 30.4, 1.9, 1.7) | ellipse(17.2, 30.4, 1.9, 1.7), 14, face)
    return out


# ---------------------------------------------------------------- 渲染：部位 + 明暗

@dataclass
class Shape:
    tone: list[list[str | None]]  # base / shade / soft / line
    region: list[list[str | None]]
    sil: set[Px]
    neck: int  # 项圈所在行
    tail_tips: list[tuple[float, float]]


def shape_of(b: Body) -> Shape:
    tone: list[list[str | None]] = [[None] * N for _ in range(N)]
    owner: list[list[str | None]] = [[None] * N for _ in range(N)]
    parts: list[tuple[str, set[Px]]] = []
    tips = [b.tail[-1]]
    if b.extra_tail:
        parts.append(("tail2", stroke(b.extra_tail, b.tail_r)))
        tips.append(b.extra_tail[-1])
    parts.append(("tail", stroke(b.tail, b.tail_r)))
    parts.append(("body", b.body))
    if not b.merged:
        parts.append(("head", b.head))
    parts.append(("paws", b.paws))

    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for name, part in parts:
        part = {(x, y) for x, y in part if 0 <= x < N and 0 <= y < N}
        edge = {(x, y) for x, y in part if any((x + dx, y + dy) not in part for dx, dy in dirs)}
        inner = part - edge

        def covered(x, y):
            return 0 <= x < N and 0 <= y < N and tone[y][x] is not None
        soft = {(x, y) for x, y in edge if all(covered(x + dx, y + dy) for dx, dy in dirs if (x + dx, y + dy) not in part)}
        for x, y in inner:
            tone[y][x] = "shade" if ((x + 1, y) in edge or (x, y + 1) in edge or (x + 1, y + 1) in edge) else "base"
            owner[y][x] = name
        for x, y in edge:
            tone[y][x] = "soft" if (x, y) in soft else "line"
            owner[y][x] = name
        for x, y in edge:
            if (x, y + 1) not in part and y + 1 < N and owner[y + 1][x] not in (None, name) and tone[y + 1][x] == "base":
                tone[y + 1][x] = "shade"

    hx, hy, hrx, hry = b.head_e
    bx, by, brx, bry = b.body_e
    head_ell = ellipse(*b.head_e)
    region: list[list[str | None]] = [[None] * N for _ in range(N)]
    for y in range(N):
        for x in range(N):
            o = owner[y][x]
            if o is None:
                continue
            if o in ("tail", "tail2"):
                pts = b.tail if o == "tail" else b.extra_tail
                ex, ey = pts[-1]  # type: ignore[index]
                region[y][x] = "tip" if (x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2 < 2.6 ** 2 else "tail"
            elif o == "paws":
                region[y][x] = "paw"
            elif o == "head" or (b.merged and ((x, y) in head_ell or (x, y) in b.ears)):
                if (x, y) in b.ears and (x, y) not in head_ell:
                    region[y][x] = "ear"
                elif y < b.eye_row:
                    region[y][x] = "crown"
                else:
                    region[y][x] = "face"
            else:
                region[y][x] = "chest" if abs(x + 0.5 - bx) <= brx * 0.42 and y >= by - bry * 0.55 else "back"
    # 项圈：头下面第一行身体
    neck = max(y for x, y in (head_ell if not b.merged else head_ell) if 13 <= x <= 16) + 1
    sil = {(x, y) for y in range(N) for x in range(N) if tone[y][x] is not None}
    return Shape(tone, region, sil, neck, tips)


# ---------------------------------------------------------------- 配色和花纹

Pattern = Callable[[int, int, str, RGB, "Ctx"], RGB]


@dataclass
class Ctx:
    body: Body
    shape: Shape


def h(x: int, y: int, salt: int = 0) -> int:
    return ((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) % 100


def stripes(dark: str) -> Pattern:
    d = hexc(dark)
    def f(x, y, reg, col, ctx):
        e = ctx.body.eye_row
        if reg == "crown" and y <= e - 2 and x in (12, 14, 15, 17) and y >= e - 5:
            return d
        if reg == "back" and y % 3 == 0:
            return d
        if reg == "tail" and (x + y) % 3 == 0:
            return d
        return col
    return f


def spots(dark: str) -> Pattern:
    d = hexc(dark)
    def f(x, y, reg, col, ctx):
        if reg in ("back", "crown", "tail") and h(x, y, 3) < 18 and (x + y) % 2 == 0:
            return d
        return col
    return f


def patches(*specs: tuple[str, str, float]) -> Pattern:
    """(位置, 颜色, 大小)。位置：lear 左耳一带、rear 右耳一带、lback 左背、rback 右背、tail 尾巴、leye 左眼周围"""
    def f(x, y, reg, col, ctx):
        hx, hy, hrx, hry = ctx.body.head_e
        bx, by, brx, bry = ctx.body.body_e
        for where, c, s in specs:
            if where == "tail" and reg in ("tail", "tip"):
                return hexc(c)
            centers = {
                "lear": (hx - hrx * 0.55, hy - hry * 0.55, hrx * 0.5 * s, hry * 0.55 * s),
                "rear": (hx + hrx * 0.55, hy - hry * 0.55, hrx * 0.5 * s, hry * 0.55 * s),
                "leye": (hx - hrx * 0.45, hy, hrx * 0.38 * s, hry * 0.45 * s),
                "lback": (bx - brx * 0.6, by - bry * 0.1, brx * 0.45 * s, bry * 0.5 * s),
                "rback": (bx + brx * 0.55, by - bry * 0.2, brx * 0.5 * s, bry * 0.5 * s),
            }
            if where in centers and reg not in ("chest",):
                cx, cy, rx, ry = centers[where]
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    return hexc(c)
        return col
    return f


def points(dark: str) -> Pattern:
    """重点色（暹罗）：耳朵、脸中间、爪子、尾巴深色"""
    d = hexc(dark)
    def f(x, y, reg, col, ctx):
        if reg in ("ear", "paw", "tail", "tip"):
            return d
        hx, hy = ctx.body.head_e[:2]
        if reg == "face":
            r2 = (x + 0.5 - hx) ** 2 + (y + 0.5 - (hy + 2.5)) ** 2
            if r2 < 9:
                return d
            if r2 < 16:
                return mix(col, d, 0.5)
        return col
    return f


def mottled(a: str, b: str) -> Pattern:
    ca, cb = hexc(a), hexc(b)
    def f(x, y, reg, col, ctx):
        if reg == "chest":
            return col
        v = h(x // 2, y, 7)
        return ca if v < 24 else cb if v < 40 else col
    return f


def speckles(c: str, density: int = 8) -> Pattern:
    cc = hexc(c)
    def f(x, y, reg, col, ctx):
        if reg in ("back", "crown", "tail") and h(x, y, 11) < density:
            return cc
        return col
    return f


def chain(*ps: Pattern) -> Pattern:
    def f(x, y, reg, col, ctx):
        for p in ps:
            col = p(x, y, reg, col, ctx)
        return col
    return f


@dataclass
class Cat:
    id: str
    body: str
    rarity: str  # common rare epic legendary
    colors: dict[str, str]  # 部位颜色；fur 是默认
    eye: str = "#3A2E2A"
    eye_r: str | None = None  # 右眼另一种颜色（オッドアイ）
    pattern: Pattern | None = None
    collar: tuple[str, str] | None = None  # 项圈颜色、铃铛颜色
    marks: list[tuple[int, int, str]] = field(default_factory=list)  # 相对额头中心的小标记 (dx, dy, 颜色)
    sparkles: list[tuple[int, int, str]] = field(default_factory=list)  # 画布上的闪光点
    glow: str | None = None
    extra_tail: list[tuple[float, float]] | None = None
    flames: str | None = None
    shine: list[tuple[int, int]] = field(default_factory=list)  # 金属高光（相对额头）
    blush: bool = True


REGIONS = ("crown", "face", "ear", "back", "chest", "paw", "tail", "tip")


def render(cat: Cat, bodies_: dict[str, Body]) -> Image.Image:
    import copy
    b = copy.copy(bodies_[cat.body])
    if cat.extra_tail:
        b.extra_tail = cat.extra_tail
    s = shape_of(b)
    ctx = Ctx(b, s)
    fur = hexc(cat.colors.get("fur", "#FFFDF8"))
    base = {r: hexc(cat.colors.get(r, cat.colors.get("fur", "#FFFDF8"))) for r in REGIONS}
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    px = img.load()

    if cat.glow:
        g = hexc(cat.glow)
        for x, y in [(x, y) for x in range(N) for y in range(N)]:
            if (x, y) in s.sil:
                continue
            if any((x + dx, y + dy) in s.sil for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                px[x, y] = (*g, 150)

    for y in range(N):
        for x in range(N):
            t = s.tone[y][x]
            if t is None:
                continue
            if t == "line":
                px[x, y] = (*OUTLINE, 255)
                continue
            reg = s.region[y][x] or "back"
            col = base[reg]
            if cat.pattern:
                col = cat.pattern(x, y, reg, col, ctx)
            if t == "shade":
                col = darken(col, 0.88)
            elif t == "soft":
                col = darken(col, 0.76)
            px[x, y] = (*col, 255)

    hx, hy = b.head_e[0], b.head_e[1]
    fx, fy = 14, b.eye_row - 3  # 额头中心（偏左那一列）
    for dx, dy, c in cat.marks:
        px[fx + dx, fy + dy] = (*hexc(c), 255)
    for dx, dy in cat.shine:
        px[fx + dx, fy + dy] = (255, 255, 240, 255)

    if cat.collar:
        cc, bell = hexc(cat.collar[0]), hexc(cat.collar[1])
        y = s.neck
        for x in range(N):
            if (x, y) in s.sil and s.tone[y][x] != "line" and abs(x + 0.5 - 15) <= 5:
                px[x, y] = (*cc, 255)
        for x in (14, 15):
            px[x, y + 1] = (*bell, 255)
        px[14, y + 2] = (*OUTLINE, 255)
        px[15, y + 2] = (*OUTLINE, 255)

    for (x, y), k in b.face.items():
        eye_hex = cat.eye_r if cat.eye_r and x >= 15 else cat.eye
        eye = hexc(eye_hex)
        if k == "e":
            px[x, y] = (*eye, 255)
        elif k == "s":
            px[x, y] = (*SHINE, 255) if eye_hex == "#3A2E2A" else (*darken(eye, 0.35), 255)
        elif k == "n":
            px[x, y] = (*PINK, 255)
        elif k == "m":
            px[x, y] = (*OUTLINE, 255)
        elif k == "b" and cat.blush:
            px[x, y] = (*BLUSH, 255)
        elif k == "i":
            inner = hexc(cat.colors.get("inner", "#F4A6BD"))
            px[x, y] = (*inner, 255)

    if cat.flames:
        fc = hexc(cat.flames)
        for tx, ty in s.tail_tips:
            ix, iy = int(tx), int(ty)
            for dx, dy, a in ((0, -2, 255), (0, -3, 200), (1, -2, 220), (-1, -3, 160), (0, -4, 140)):
                X, Y = ix + dx, iy + dy
                if 0 <= X < N and 0 <= Y < N and (X, Y) not in s.sil:
                    px[X, Y] = (*fc, a)

    for x, y, c in cat.sparkles:
        col = hexc(c)
        px[x, y] = (*col, 255)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            X, Y = x + dx, y + dy
            if 0 <= X < N and 0 <= Y < N and (X, Y) not in s.sil:
                px[X, Y] = (*col, 140)
    return img


# ---------------------------------------------------------------- 42 只猫

def cats() -> list[Cat]:
    BLACK, BLACK_S = "#3E3836", "#2E2927"
    return [
        # まんまる
        Cat("shiro", "manmaru", "common", {"fur": "#FFFDF8"}),
        Cat("chatora", "manmaru", "common", {"fur": "#EDA65E", "chest": "#F8E2C2", "paw": "#F8E2C2"}, pattern=stripes("#C9772E")),
        Cat("hachiware", "manmaru", "common", {"fur": BLACK, "face": "#FFFDF8", "chest": "#FFFDF8", "paw": "#FFFDF8"}),
        Cat("mike", "manmaru", "rare", {"fur": "#FFFDF8"}, pattern=patches(("lear", "#E8984A", 1.1), ("rback", BLACK, 1.0), ("tail", "#E8984A", 1))),
        Cat("kutsushita", "manmaru", "rare", {"fur": "#6A645F", "chest": "#FFFDF8", "paw": "#FFFDF8", "tip": "#FFFDF8"}),
        Cat("maneki", "manmaru", "epic", {"fur": "#FFFDF8"}, pattern=patches(("lear", "#E8984A", 0.9), ("rear", BLACK, 0.8), ("lback", "#E8984A", 0.8)),
            collar=("#D8443A", "#F2C94C"), sparkles=[(4, 5, "#F2C94C"), (27, 9, "#F2C94C"), (3, 24, "#FFE9A8")]),
        Cat("haiiro", "manmaru", "common", {"fur": "#9A9693", "chest": "#C9C5C1", "paw": "#C9C5C1", "inner": "#E8A7B6"}, eye="#6CA86A"),
        # もちもち
        Cat("sabatora", "mochi", "common", {"fur": "#B2B6BA", "face": "#E6E8EA", "chest": "#E6E8EA"}, pattern=stripes("#6A7177")),
        Cat("buchi", "mochi", "common", {"fur": "#FFFDF8"}, pattern=patches(("leye", BLACK, 1.0), ("rback", BLACK, 1.1), ("tail", BLACK, 1))),
        Cat("kijishiro", "mochi", "common", {"fur": "#9C8466", "face": "#FFFDF8", "chest": "#FFFDF8", "paw": "#FFFDF8"}, pattern=stripes("#5E4D3A")),
        Cat("sabi", "mochi", "rare", {"fur": "#4A3A31", "chest": "#5A4334"}, eye="#E8B04A", pattern=mottled("#C0702F", "#7A4A27")),
        Cat("chashiro", "mochi", "rare", {"fur": "#EDA65E", "face": "#FFFDF8", "chest": "#FFFDF8", "paw": "#FFFDF8", "tip": "#FFFDF8"}),
        Cat("kinmaneki", "mochi", "legendary", {"fur": "#F2C94C", "chest": "#F8DC7A", "face": "#F8DC7A", "inner": "#E8984A"},
            pattern=patches(("lear", "#D9A42A", 0.9)), collar=("#D8443A", "#FFF2B0"), glow="#FFE58A",
            shine=[(-4, -1), (-3, -1), (4, 0)], sparkles=[(3, 6, "#FFF2B0"), (28, 10, "#FFF2B0"), (2, 20, "#FFE58A"), (29, 21, "#FFE58A")]),
        Cat("daifuku", "mochi", "epic", {"fur": "#FFFDF8", "chest": "#FFFFFF", "inner": "#F4A6BD"}, pattern=speckles("#EFE6EA", 16),
            marks=[(0, 0, "#F4A6BD"), (1, 0, "#F4A6BD"), (0, -1, "#F7C3D0"), (1, 1, "#E37E9C")],
            sparkles=[(4, 9, "#FFFFFF"), (27, 7, "#F7C3D0"), (2, 22, "#FFFFFF")]),
        # すらり
        Cat("kuro", "surari", "common", {"fur": BLACK, "inner": "#8C5A6A"}, eye="#E8C547", blush=False),
        Cat("shamu", "surari", "rare", {"fur": "#F3E7D2", "chest": "#FAF2E4"}, eye="#4A8FD6", pattern=points("#5B4335")),
        Cat("roshian", "surari", "rare", {"fur": "#8E9AA6", "chest": "#A3AEB8", "inner": "#B88A96"}, eye="#6CC26A", pattern=speckles("#B9C3CC", 10), blush=False),
        Cat("bengaru", "surari", "rare", {"fur": "#E2A653", "chest": "#F4D9A8", "face": "#F0C88A"}, eye="#9CC24A", pattern=spots("#6B4426")),
        Cat("tsukimi", "surari", "epic", {"fur": "#2F3A66", "chest": "#3B4878", "inner": "#7A86C2"}, eye="#F2C94C", pattern=speckles("#C8D2FF", 7),
            marks=[(0, 0, "#F2C94C"), (1, -1, "#F2C94C"), (1, 1, "#F2C94C")], sparkles=[(4, 6, "#FFF2B0"), (27, 4, "#C8D2FF")], blush=False),
        Cat("nekomata", "surari", "legendary", {"fur": "#7B6AA6", "chest": "#9A8BC4", "inner": "#C9A9E0", "tip": "#4E4078"}, eye="#F3D35C",
            extra_tail=[(12, 29.5), (4, 28), (4.5, 17), (7.5, 15)], flames="#B8E2FF", glow="#C9A9E0", blush=False),
        Cat("takishiido", "surari", "common", {"fur": BLACK, "chest": "#FFFDF8", "paw": "#FFFDF8", "inner": "#8C5A6A"}, eye="#9CC24A", blush=False),
        # ふわふわ
        Cat("kijitora", "fuwa", "common", {"fur": "#A08868", "face": "#DCCBB0", "chest": "#DCCBB0"}, pattern=stripes("#5E4D3A")),
        Cat("kuriimu", "fuwa", "common", {"fur": "#F6E3C2", "chest": "#FBF1DE"}, eye="#C98A3A", pattern=stripes("#EED2A4")),
        Cat("mugiwaraneko", "fuwa", "common", {"fur": "#D9B77E", "chest": "#F1DFBC"}, pattern=stripes("#B58F55")),
        Cat("perusha", "fuwa", "rare", {"fur": "#F7F7F5", "chest": "#FFFFFF", "face": "#FFFFFF", "tip": "#B9BEC4", "ear": "#D9DCE0"}, eye="#4FA37A", pattern=speckles("#BFC4CA", 16)),
        Cat("sakura", "fuwa", "epic", {"fur": "#F6C4D2", "chest": "#FDE6EE", "face": "#FDE6EE", "inner": "#E37E9C"}, pattern=speckles("#FFFFFF", 6),
            sparkles=[(3, 8, "#F4A6BD"), (27, 5, "#F4A6BD"), (28, 17, "#FDE6EE")]),
        Cat("yukimi", "fuwa", "epic", {"fur": "#E6F0F8", "chest": "#FFFFFF", "inner": "#9EC3E6", "tail": "#CFE0EF"}, eye="#5DA2E0",
            marks=[(-1, -1, "#8FB8E0"), (2, -1, "#8FB8E0"), (0, 0, "#8FB8E0"), (1, 0, "#8FB8E0"), (-1, 1, "#8FB8E0"), (2, 1, "#8FB8E0")],
            sparkles=[(4, 6, "#FFFFFF"), (26, 3, "#CFE6FF"), (29, 15, "#FFFFFF")]),
        Cat("meinkuun", "fuwa", "rare", {"fur": "#8A6A4A", "face": "#B89A78", "chest": "#E9DCC8", "tip": "#3E3028", "ear": "#6E523A"},
            eye="#C9A13A", pattern=stripes("#4E3A2A")),
        # ちょこん
        Cat("mikan", "chokon", "common", {"fur": "#F29A3C", "chest": "#FBD9B0", "paw": "#FBD9B0"}),
        Cat("goma", "chokon", "common", {"fur": "#8A8580", "chest": "#D6D2CC"}, pattern=speckles("#3E3836", 16)),
        Cat("kinako", "chokon", "common", {"fur": "#E8CFA0", "chest": "#F7EBD3", "paw": "#F7EBD3"}, pattern=speckles("#C9A66E", 12)),
        Cat("azuki", "chokon", "rare", {"fur": "#6B3A35", "chest": "#8C524B", "inner": "#C98A8E"}, eye="#E8B04A", pattern=speckles("#4A2622", 10), blush=False),
        Cat("kohaku", "chokon", "rare", {"fur": "#D9932E", "chest": "#F0C27A", "face": "#E9AE55"}, eye="#F2C94C", pattern=mottled("#B5701E", "#EDB25C")),
        Cat("momiji", "chokon", "epic", {"fur": "#C8452E", "chest": "#F2B38A", "face": "#E37A4E"}, eye="#F2C94C", pattern=speckles("#F2A43C", 8),
            marks=[(0, 0, "#F2C94C"), (1, 0, "#F2C94C"), (0, -1, "#F2C94C"), (-1, 0, "#E8983A"), (2, 0, "#E8983A"), (0, 1, "#B5701E")],
            sparkles=[(4, 8, "#E8452E"), (26, 6, "#F2C94C"), (28, 18, "#E8983A"), (3, 21, "#F2C94C")]),
        Cat("komaneko", "chokon", "legendary", {"fur": "#B8B4AE", "chest": "#D6D3CE", "inner": "#D8443A", "tip": "#8F8A84"}, eye="#F2C94C",
            pattern=mottled("#9E9A94", "#C9C5BF"), collar=("#D8443A", "#F2C94C"), glow="#FFE58A",
            sparkles=[(4, 7, "#FFF2B0"), (26, 5, "#FFF2B0"), (2, 19, "#FFE58A"), (28, 21, "#FFE58A")]),
        # おおみみ
        Cat("kuri", "oomimi", "common", {"fur": "#8A5A36", "chest": "#B88A62", "inner": "#C98A8E"}, eye="#E8B04A"),
        Cat("kafeore", "oomimi", "common", {"fur": "#C8A27A", "face": "#E3CBAE", "chest": "#F3E7D6", "paw": "#F3E7D6"}),
        Cat("sabashiro", "oomimi", "common", {"fur": "#A8ADB2", "face": "#FFFDF8", "chest": "#FFFDF8", "paw": "#FFFDF8"}, pattern=stripes("#5F676E")),
        Cat("oddo", "oomimi", "rare", {"fur": "#FFFDF8"}, eye="#4A8FD6", eye_r="#E8B04A"),
        Cat("yukihyou", "oomimi", "rare", {"fur": "#D8DCE0", "chest": "#F4F6F8", "face": "#EEF1F4", "tip": "#4A4E52"}, eye="#6CB7C2", pattern=spots("#5A5F64")),
        Cat("hanabi", "oomimi", "epic", {"fur": "#2A2F55", "chest": "#363C6A", "inner": "#8C92D6"}, eye="#F2C94C", pattern=speckles("#FFD36A", 7),
            sparkles=[(3, 6, "#FF7AA8"), (27, 4, "#7AD7FF"), (28, 15, "#FFD36A"), (2, 17, "#9CF08A"), (25, 1, "#FF7AA8")], blush=False),
        Cat("houou", "oomimi", "legendary", {"fur": "#D9452E", "chest": "#F2B04A", "face": "#E8763A", "tip": "#F2C94C", "inner": "#F2C94C"}, eye="#F2C94C",
            pattern=speckles("#F2C94C", 8), flames="#FFB347", glow="#FFC870",
            sparkles=[(3, 7, "#FFF2B0"), (27, 6, "#FFF2B0"), (2, 20, "#FFC870")]),
    ]


RARITY_COLOR = {"common": (140, 132, 120), "rare": (63, 125, 184), "epic": (154, 85, 200), "legendary": (210, 154, 30)}
BODY_ORDER = ("manmaru", "mochi", "surari", "fuwa", "chokon", "oomimi")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bs = bodies()
    all_cats = cats()
    imgs = {}
    for c in all_cats:
        im = render(c, bs)
        imgs[c.id] = im
        im.save(OUT / f"{c.id}.png")
        im.resize((N * 12, N * 12), Image.NEAREST).save(OUT / f"{c.id}_x12.png")

    order = list(BODY_ORDER)
    scale, gap, label_h = 6, 18, 26
    cell = N * scale
    cols = 7
    w = gap + cols * (cell + gap) + 120
    row_h = cell + label_h + gap
    h = gap + len(order) * row_h
    sheet = Image.new("RGB", (w, h), (245, 241, 232))
    d = ImageDraw.Draw(sheet)
    for r, body in enumerate(order):
        group = [c for c in all_cats if c.body == body]
        y0 = gap + r * row_h
        d.text((gap + cols * (cell + gap) + 4, y0 + cell // 2 - 6), body, fill=(91, 84, 75))
        for i, c in enumerate(group):
            x0 = gap + i * (cell + gap)
            d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=(255, 253, 248))
            big = imgs[c.id].resize((cell, cell), Image.NEAREST)
            sheet.paste(big, (x0, y0), big)
            d.rectangle([x0, y0 + cell, x0 + cell - 1, y0 + cell + 3], fill=RARITY_COLOR[c.rarity])
            d.text((x0 + 4, y0 + cell + 8), c.id, fill=(91, 84, 75))
    sheet.save(OUT / "overview.png")
    print("saved", OUT, len(all_cats), "cats")


if __name__ == "__main__":
    main()
