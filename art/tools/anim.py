"""猫的动画：4 种体型各一套骨架，24 只猫换色共用。

每一帧是一个「姿势」：头、身体、爪子、尾巴的位置和大小。画法和静态立绘一样（cats.py）：几何形状拼身体、自动描边打阴影、
每个像素标部位再按猫的配色上色。花纹按部位的局部坐标计算，所以会跟着身体一起动，不会闪。
走路、站立时身体和腿是侧面（朝右），头保持正脸，饰品可以直接沿用立绘的锚点。

画布 48×40，地面在最下面一行。坐姿的猫和立绘完全一样（立绘的 32×32 放在 x=8、y=8）。

运行：uv run --with pillow --no-project python -I art/tools/anim.py
输出：art/anim/preview.gif（4 种体型 × 全部动作的预览），art/anim/<猫>.png（每只猫的全部帧）、frames.json（帧序列和饰品位置）
"""
from __future__ import annotations

import copy
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import cats as C  # noqa: E402
from accessories import TOP as ACC_TOP, accessories, anchors, render_acc  # noqa: E402

W, H = 48, 40
OX, OY = 8, 8  # 立绘 32×32 在画布里的位置
GROUND = H - 1
OUT = Path(__file__).resolve().parents[1] / "anim"
Px = tuple[int, int]


# ---------------------------------------------------------------- 形状（画布坐标）

def E(cx: float, cy: float, rx: float, ry: float, ang: float = 0.0) -> set[Px]:
    ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    out = set()
    for x in range(W):
        for y in range(H):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u, v = dx * ca + dy * sa, -dx * sa + dy * ca
            if (u / rx) ** 2 + (v / ry) ** 2 <= 1:
                out.add((x, y))
    return out


def S(points, r: float, steps: int = 50) -> set[Px]:
    out: set[Px] = set()
    for i in range(steps + 1):
        cx, cy = C.bezier(points, i / steps)
        out |= E(cx, cy, r, r)
    return out


def shift(s: set[Px], dx: int, dy: int) -> set[Px]:
    return {(x + dx, y + dy) for x, y in s}


def lift(s: set[Px], dy: int) -> set[Px]:
    return shift(s, 0, -dy)


# ---------------------------------------------------------------- 部件和绘制

@dataclass
class Part:
    name: str
    mask: set[Px]
    region: Callable[[int, int], str]
    local: Callable[[int, int], tuple[int, int]]  # 花纹按局部坐标算，跟着身体走
    far: bool = False  # 远侧的腿，颜色暗一点


@dataclass
class Frame:
    parts: list[Part]
    head: Px  # 头相对立绘位置的偏移（画布坐标 = 立绘坐标 + (OX, OY) + head）
    eyes: str = "open"  # open / half / closed / happy / wide
    mouth: str = "normal"  # normal / open / tongue
    tail_tips: list[tuple[float, float]] = field(default_factory=list)
    collar: bool = True


def paint(frame: Frame, cat: C.Cat, b: C.Body, tick: int = 0) -> Image.Image:
    tone: list[list[str | None]] = [[None] * W for _ in range(H)]
    owner: list[list[int]] = [[-1] * W for _ in range(H)]
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for idx, part in enumerate(frame.parts):
        m = {(x, y) for x, y in part.mask if 0 <= x < W and 0 <= y < H}
        edge = {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in dirs)}
        inner = m - edge

        def covered(x, y):
            return 0 <= x < W and 0 <= y < H and tone[y][x] is not None
        soft = {(x, y) for x, y in edge if all(covered(x + dx, y + dy) for dx, dy in dirs if (x + dx, y + dy) not in m)}
        for x, y in inner:
            tone[y][x] = "shade" if ((x + 1, y) in edge or (x, y + 1) in edge or (x + 1, y + 1) in edge) else "base"
            owner[y][x] = idx
        for x, y in edge:
            tone[y][x] = "soft" if (x, y) in soft else "line"
            owner[y][x] = idx
        for x, y in edge:
            if (x, y + 1) not in m and y + 1 < H and owner[y + 1][x] not in (-1, idx) and tone[y + 1][x] == "base":
                tone[y + 1][x] = "shade"

    sil = {(x, y) for x in range(W) for y in range(H) if tone[y][x] is not None}
    ctx = C.Ctx(b, None)  # type: ignore[arg-type]
    base = {r: C.hexc(cat.colors.get(r, cat.colors.get("fur", "#FFFDF8"))) for r in C.REGIONS}
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()

    if cat.glow:
        g = C.hexc(cat.glow)
        for x in range(W):
            for y in range(H):
                if (x, y) not in sil and any((x + dx, y + dy) in sil for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                    px[x, y] = (*g, 150)

    for y in range(H):
        for x in range(W):
            t = tone[y][x]
            if t is None:
                continue
            if t == "line":
                px[x, y] = (*C.OUTLINE, 255)
                continue
            part = frame.parts[owner[y][x]]
            reg = part.region(x, y)
            col = base[reg]
            if cat.pattern:
                lx, ly = part.local(x, y)
                col = cat.pattern(lx, ly, reg, col, ctx)
            if part.far:
                col = C.darken(col, 0.86)
            if t == "shade":
                col = C.darken(col, 0.88)
            elif t == "soft":
                col = C.darken(col, 0.76)
            px[x, y] = (*col, 255)

    hx, hy = frame.head
    fx, fy = OX + hx + 14, OY + hy + b.eye_row - 3
    for dx, dy, c in cat.marks:
        px[fx + dx, fy + dy] = (*C.hexc(c), 255)
    for dx, dy in cat.shine:
        px[fx + dx, fy + dy] = (255, 255, 240, 255)

    if cat.collar and frame.collar:
        neck = C.shape_of(b).neck + OY + hy
        cc, bell = C.hexc(cat.collar[0]), C.hexc(cat.collar[1])
        for x in range(OX + hx + 10, OX + hx + 20):
            if (x, neck) in sil and tone[neck][x] != "line":
                px[x, neck] = (*cc, 255)
        bx = OX + hx + 14
        for x in (bx, bx + 1):
            px[x, neck + 1] = (*bell, 255)
            px[x, neck + 2] = (*C.OUTLINE, 255)

    draw_face(px, frame, cat, b)

    if cat.flames:
        fc = C.hexc(cat.flames)
        flick = (0, -1, 0, 1)[tick % 4]
        for tx, ty in frame.tail_tips:
            ix, iy = int(tx), int(ty)
            for dx, dy, a in ((0, -2, 255), (0, -3, 200), (1, -2, 220), (-1, -3, 160), (flick, -4, 140)):
                X, Y = ix + dx, iy + dy
                if 0 <= X < W and 0 <= Y < H and (X, Y) not in sil:
                    px[X, Y] = (*fc, a)

    # 闪光点一闪一闪（每个点错开）
    for i, (x, y, c) in enumerate(cat.sparkles):
        if (tick // 3 + i) % 3 == 0:
            continue
        col = C.hexc(c)
        X0, Y0 = x + OX, y + OY
        if 0 <= X0 < W and 0 <= Y0 < H and (X0, Y0) not in sil:
            px[X0, Y0] = (*col, 255)
            for dx, dy in dirs:
                X, Y = X0 + dx, Y0 + dy
                if 0 <= X < W and 0 <= Y < H and (X, Y) not in sil:
                    px[X, Y] = (*col, 130)
    return img


def draw_face(px, frame: Frame, cat: C.Cat, b: C.Body):
    hx, hy = frame.head
    eye = C.hexc(cat.eye)
    eyes = [(x, y) for (x, y), k in b.face.items() if k in ("e", "s")]
    boxes = []
    for side in (lambda p: p[0] < 15, lambda p: p[0] >= 15):
        pts = [p for p in eyes if side(p)]
        boxes.append((min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)))
    closed_style = cat.body == "mochi"  # 年糕猫本来就是眯眼

    def put(x, y, col):
        X, Y = x + OX + hx, y + OY + hy
        if 0 <= X < W and 0 <= Y < H:
            px[X, Y] = (*col, 255)

    for (x, y), k in b.face.items():
        if k in ("e", "s"):
            if frame.eyes == "open" or (closed_style and frame.eyes in ("half", "wide")):
                put(x, y, eye if k == "e" else (C.SHINE if cat.eye == "#3A2E2A" else C.darken(eye, 0.35)))
            elif frame.eyes == "wide":
                put(x, y, eye if k == "e" else C.SHINE)
            elif frame.eyes == "half":
                x0, y0, x1, y1 = boxes[0] if x < 15 else boxes[1]
                if y >= y1 - (1 if y1 - y0 >= 2 else 0):
                    put(x, y, eye)
        elif k == "n":
            put(x, y, C.PINK)
        elif k == "m":
            put(x, y, C.OUTLINE)
        elif k == "b" and cat.blush:
            put(x, y, C.BLUSH)
        elif k == "i":
            put(x, y, C.hexc(cat.colors.get("inner", "#F4A6BD")))
    if frame.eyes in ("closed", "happy") or (frame.eyes == "half" and closed_style):
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            if frame.eyes == "happy" and not closed_style:
                # ^ ^
                for x in range(x0, x1 + 1):
                    put(x, y1 if x in (x0, x1) else y1 - 1, C.OUTLINE)
                if x1 - x0 == 1:
                    put(x0 - 1 if i == 0 else x1 + 1, y1, C.OUTLINE)
            elif closed_style and frame.eyes == "happy":
                for (x, y), k in b.face.items():
                    if k == "e" and ((x < 15) == (i == 0)):
                        put(x, y, C.OUTLINE)
            else:
                for x in range(x0, x1 + 1):
                    put(x, y1, C.OUTLINE)
    if frame.mouth in ("open", "tongue"):
        mx = [x for (x, y), k in b.face.items() if k == "n"]
        my = max(y for (x, y), k in b.face.items() if k == "n")
        put(min(mx), my + 1, C.PINK if frame.mouth == "tongue" else C.OUTLINE)
        put(max(mx), my + 1, C.PINK if frame.mouth == "tongue" else C.OUTLINE)
        if frame.mouth == "open":
            put(min(mx), my + 2, (200, 90, 110))
            put(max(mx), my + 2, (200, 90, 110))


# ---------------------------------------------------------------- 骨架

@dataclass
class Rig:
    b: C.Body
    head_mask: set[Px]  # 立绘坐标
    head_ell: set[Px]
    # 站姿参数
    st_body: tuple[float, float, float, float]  # cx, cy, rx, ry（画布坐标）
    leg_r: float
    leg_xs: tuple[float, float, float, float]  # 后远、后近、前远、前近
    st_head_dy: int
    st_tail: list[tuple[float, float]]


def rig_of(b: C.Body) -> Rig:
    head_ell = C.ellipse(*b.head_e)
    head_mask = (head_ell | b.ears) if b.merged else b.head
    bx, by, brx, bry = b.body_e
    hx, hy, hrx, hry = b.head_e
    if b.key == "manmaru":
        body, leg_r, legs = (17.5, 31.0, 9.0, 5.2), 1.4, (11.5, 13.5, 21.5, 23.5)
    elif b.key == "mochi":
        body, leg_r, legs = (18.0, 31.0, 11.0, 6.5), 1.5, (10.5, 12.5, 23.0, 25.0)
    elif b.key == "surari":
        body, leg_r, legs = (17.0, 29.5, 8.6, 4.4), 1.2, (11.0, 13.0, 21.0, 23.0)
    else:
        body, leg_r, legs = (17.5, 31.0, 9.0, 5.4), 1.5, (11.5, 13.5, 21.5, 23.5)
    # 头的下沿压住身体前上方
    head_bottom = OY + hy + hry
    st_head_dy = round((body[1] + 1.5) - head_bottom)
    tail_x0 = body[0] - body[2] + 1.5
    tail = [(tail_x0, body[1] - 1), (tail_x0 - 5, body[1] - 2), (tail_x0 - 5.5, body[1] - 9), (tail_x0 - 3, body[1] - 11)]
    return Rig(b, head_mask, head_ell, body, leg_r, legs, st_head_dy, tail)


def head_part(r: Rig, dx: int, dy: int, merged_with: set[Px] | None = None, body_region=None) -> Part:
    b = r.b
    m = shift(r.head_mask, OX + dx, OY + dy)

    def region(x, y):
        lx, ly = x - OX - dx, y - OY - dy
        if (lx, ly) in b.ears and (lx, ly) not in r.head_ell:
            return "ear"
        if (lx, ly) in r.head_ell or (lx, ly) in b.head:
            return "crown" if ly < b.eye_row else "face"
        return body_region(x, y) if body_region else "face"
    if merged_with is not None:
        m = m | merged_with
    return Part("head", m, region, lambda x, y: (x - OX - dx, y - OY - dy))


def sit_body_region(b: C.Body, dx: int, dy: int):
    bx, by, brx, bry = b.body_e

    def f(x, y):
        lx, ly = x - OX - dx, y - OY - dy
        return "chest" if abs(lx + 0.5 - bx) <= brx * 0.42 and ly >= by - bry * 0.55 else "back"
    return f


def tail_part(points, r: float, name="tail") -> Part:
    ex, ey = points[-1]
    return Part(name, S(points, r),
                lambda x, y: "tip" if (x + 0.5 - ex) ** 2 + (y + 0.5 - ey) ** 2 < 2.6 ** 2 else "tail",
                lambda x, y: (x - OX, y - OY))


def sit_tail(b: C.Body, dx: float = 0, dy: float = 0, tip_dx: float = 0, tip_dy: float = 0, pts=None):
    pts = [(x + OX + dx, y + OY + dy) for x, y in (pts or b.tail)]
    pts[-1] = (pts[-1][0] + tip_dx, pts[-1][1] + tip_dy)
    return pts


def sitting(r: Rig, *, breath: float = 0, head_dy: int = 0, head_dx: int = 0, body_dy: float = 0, tip: tuple[float, float] = (0, 0),
            lift_y: int = 0, squash: float = 0, paws: str = "both", eyes="open", mouth="normal", raised_paw: tuple[float, float] | None = None,
            body_dx: int = 0) -> Frame:
    """坐姿。breath：呼吸（0~1），squash：压扁（正）/拉长（负），raised_paw：举起来的爪子位置（立绘坐标）"""
    b = r.b
    bx, by, brx, bry = b.body_e
    ry = bry + 0.45 * breath - 0.9 * squash
    rx = brx + 0.6 * squash
    cy = by + body_dy - 0.25 * breath + 0.9 * squash
    bdx = body_dx
    body_mask = shift(C.ellipse(bx, cy, rx, ry), OX + bdx, OY) if True else set()
    if b.key == "surari":
        body_mask |= shift(C.ellipse(15, 18 + body_dy, 3.6, 3), OX + bdx, OY)
    if b.merged:
        body_mask = shift(C.ellipse(bx, cy, rx, ry), OX + bdx, OY)
    hdy = head_dy + round(squash * 1.2)
    parts: list[Part] = []
    tips = []
    tpts = sit_tail(b, bdx, 0, *tip)
    if cat_extra_tail.get(b.key):
        et = [(x + OX + bdx, y + OY) for x, y in cat_extra_tail[b.key]]
        et[-1] = (et[-1][0] - tip[0], et[-1][1] + tip[1])
        parts.append(tail_part(et, b.tail_r, "tail2"))
        tips.append(et[-1])
    parts.append(tail_part(tpts, b.tail_r))
    tips.append(tpts[-1])
    breg = sit_body_region(b, bdx, round(body_dy))
    if b.merged:
        parts.append(head_part(r, head_dx, hdy, merged_with=body_mask, body_region=breg))
    else:
        parts.append(Part("body", body_mask, breg, lambda x, y: (x - OX - bdx, y - OY)))
        parts.append(head_part(r, head_dx, hdy))
    paw_mask = set()
    left = shift(paw_left[b.key], OX + bdx, OY)
    right = shift(paw_right[b.key], OX + bdx, OY)
    if paws in ("both", "right"):
        paw_mask |= right
    if paws in ("both", "left"):
        paw_mask |= left
    if paws == "forward":
        paw_mask |= shift(left, -1, 0) | shift(right, 1, 0)
    if raised_paw:
        px_, py_ = raised_paw
        paw_mask |= shift(C.ellipse(px_, py_, 2.0, 1.8), OX + head_dx, OY + hdy)
    parts.append(Part("paws", paw_mask, lambda x, y: "paw", lambda x, y: (x - OX, y - OY)))
    fr = Frame(parts, (head_dx, hdy), eyes, mouth, tips)
    if lift_y:
        for p in fr.parts:
            p.mask = lift(p.mask, lift_y)
            reg, loc = p.region, p.local
            p.region = (lambda reg: lambda x, y: reg(x, y + lift_y))(reg)
            p.local = (lambda loc: lambda x, y: loc(x, y + lift_y))(loc)
        fr.head = (fr.head[0], fr.head[1] - lift_y)
        fr.tail_tips = [(x, y - lift_y) for x, y in fr.tail_tips]
    return fr


paw_left: dict[str, set[Px]] = {}
paw_right: dict[str, set[Px]] = {}
cat_extra_tail: dict[str, list] = {}


def loaf(r: Rig, *, t: float = 1.0, breath: float = 0, eyes="open", tip: float = 0, head_extra: int = 0) -> Frame:
    """趴下（t=1）以及坐→趴的过渡（0<t<1）"""
    b = r.b
    bx, by, brx, bry = b.body_e
    hx, hy, hrx, hry = b.head_e
    ground = 31.5
    lry = bry * (1 - 0.32 * t) + 0.4 * breath
    lrx = brx * (1 + 0.32 * t)
    cy = ground - lry
    body_mask = shift(C.ellipse(bx, cy, lrx, lry), OX, OY)
    head_drop = round(t * max(2.0, (cy - lry * 0.6) - (hy + hry * 0.55))) + head_extra
    parts: list[Part] = []
    tpts = [(x + OX, y + OY) for x, y in b.tail]
    # 尾巴收到身体前面、贴着地面
    end = tpts[-1]
    tpts = [tpts[0], (tpts[1][0], tpts[1][1] + 1.5 * t), (end[0] - 2 * t + tip, end[1] + 6 * t)]
    tips = [tpts[-1]]
    if cat_extra_tail.get(b.key):
        et = [(x + OX, y + OY) for x, y in cat_extra_tail[b.key]]
        et = [et[0], (et[1][0], et[1][1] + 1.5 * t), (et[-1][0] + 2 * t - tip, et[-1][1] + 6 * t)]
        parts.append(tail_part(et, b.tail_r, "tail2"))
        tips.append(et[-1])
    parts.append(tail_part(tpts, b.tail_r))
    breg = sit_body_region(b, 0, 0)
    if b.merged:
        parts.append(head_part(r, 0, head_drop, merged_with=body_mask, body_region=breg))
    else:
        parts.append(Part("body", body_mask, breg, lambda x, y: (x - OX, y - OY)))
        parts.append(head_part(r, 0, head_drop))
    # 前爪往前收在胸前
    pl, pr = paw_left[b.key], paw_right[b.key]
    paws = shift(pl, OX - round(t), OY) | shift(pr, OX + round(t), OY)
    parts.append(Part("paws", paws, lambda x, y: "paw", lambda x, y: (x - OX, y - OY)))
    return Frame(parts, (0, head_drop), eyes, "normal", tips)


def standing(r: Rig, *, phase: float = 0.0, walk: float = 0.0, bob: int = 0, breath: float = 0, tip: tuple[float, float] = (0, 0),
             angle: float = 0, front_dx: float = 0, head_dy: int = 0, lift_y: int = 0, eyes="open", mouth="normal",
             front_lift: float = 0) -> Frame:
    """站姿 / 走路。phase 0~1 是步态周期，walk 是步幅（0 = 站着不动）。angle 负数是前低后高（伸懒腰）"""
    b = r.b
    cx, cy, rx, ry = r.st_body
    cy += bob
    ry += 0.35 * breath
    body = E(cx, cy, rx, ry, angle)
    ground = GROUND - 0.5

    def leg(x: float, ph: float, front: bool) -> set[Px]:
        sw = math.sin(2 * math.pi * ph)
        foot_x = x + walk * sw + (front_dx if front else 0)
        up = max(0.0, math.cos(2 * math.pi * ph)) * (1.3 if walk else 0)
        if front and front_lift:
            up = front_lift
        hip_y = cy + ry * 0.35 + (math.sin(math.radians(angle)) * (x - cx))
        return S([(x, hip_y), (foot_x, ground - up)], r.leg_r, 20)

    hf, hn, ff, fn = r.leg_xs
    tail = [(px_, py_ + bob) for px_, py_ in r.st_tail]
    tail[-1] = (tail[-1][0] + tip[0], tail[-1][1] + tip[1])
    if angle < 0:  # 伸懒腰：后面抬高，尾巴翘
        tail = [(x, y + math.sin(math.radians(angle)) * (x - cx)) for x, y in tail]

    def local_body(x, y):
        bx, by, brx, bry = b.body_e
        return (round(bx + (cy - y) / ry * brx * 0.8), round(by - (x - cx) / rx * bry))

    def body_region(x, y):
        return "chest" if y > cy + ry * 0.35 else "back"

    def leg_region(x, y):
        return "paw" if y >= GROUND - 2 - (1 if walk else 0) else "back"

    parts = [
        Part("leg_hf", leg(hf, phase + 0.5, False), leg_region, local_body, far=True),
        Part("leg_ff", leg(ff, phase, True), leg_region, local_body, far=True),
    ]
    tips = []
    if cat_extra_tail.get(b.key):
        t2 = [(x - 1, y + 3) for x, y in tail]
        t2[-1] = (t2[-1][0] - 2, t2[-1][1] + 1)
        parts.append(tail_part(t2, b.tail_r, "tail2"))
        tips.append(t2[-1])
    parts.append(tail_part(tail, b.tail_r))
    tips.append(tail[-1])
    parts.append(Part("body", body, body_region, local_body))
    parts.append(Part("leg_hn", leg(hn, phase, False), leg_region, local_body))
    parts.append(Part("leg_fn", leg(fn, phase + 0.5, True), leg_region, local_body))
    hdy = r.st_head_dy + bob + head_dy
    hdx = round(front_dx * 0.5)
    parts.append(head_part(r, hdx, hdy))
    fr = Frame(parts, (hdx, hdy), eyes, mouth, tips, collar=True)
    if lift_y:
        for p in fr.parts:
            p.mask = lift(p.mask, lift_y)
            reg, loc = p.region, p.local
            p.region = (lambda reg: lambda x, y: reg(x, y + lift_y))(reg)
            p.local = (lambda loc: lambda x, y: loc(x, y + lift_y))(loc)
        fr.head = (fr.head[0], fr.head[1] - lift_y)
        fr.tail_tips = [(x, y - lift_y) for x, y in fr.tail_tips]
    return fr


def blend_sit_stand(r: Rig, t: float) -> Frame:
    """坐 → 站的中间帧：身体斜着，后腿还蹲着，前腿伸直"""
    b = r.b
    bx, by, brx, bry = b.body_e
    scx, scy, srx, sry = r.st_body
    cx = (bx + OX) * (1 - t) + scx * t
    cy = (by + OY) * (1 - t) + scy * t
    rx = brx * (1 - t) + srx * t
    ry = bry * (1 - t) + sry * t
    ang = 90 * (1 - t)  # 竖着的椭圆 → 横着
    body = E(cx, cy, ry if ang > 45 else rx, rx if ang > 45 else ry, ang - 90 if ang > 45 else ang)
    hdy = round(r.st_head_dy * t)
    hf, hn, ff, fn = r.leg_xs
    ground = GROUND - 0.5
    parts = [Part("leg_ff", S([(ff, cy), (ff, ground)], r.leg_r, 20), lambda x, y: "paw" if y >= GROUND - 2 else "back", lambda x, y: (x - OX, y - OY), far=True)]
    tail = [((1 - t) * (x + OX) + t * sx, (1 - t) * (y + OY) + t * sy) for (x, y), (sx, sy) in zip(b.tail + [b.tail[-1]] * (len(r.st_tail) - len(b.tail)), r.st_tail)]
    parts.append(tail_part(tail, b.tail_r))
    breg = lambda x, y: "chest" if y > cy + ry * 0.2 else "back"
    parts.append(Part("body", body, breg, lambda x, y: (x - OX, y - OY)))
    parts.append(Part("leg_fn", S([(fn, cy), (fn, ground)], r.leg_r, 20), lambda x, y: "paw" if y >= GROUND - 2 else "back", lambda x, y: (x - OX, y - OY)))
    parts.append(Part("paws", shift(paw_left[b.key], OX - 3, OY), lambda x, y: "paw", lambda x, y: (x - OX, y - OY)))
    parts.append(head_part(r, 0, hdy))
    return Frame(parts, (0, hdy), "open", "normal", [tail[-1]])


# ---------------------------------------------------------------- 动作

def animations(r: Rig) -> dict[str, list[Frame]]:
    b = r.b
    sit0 = lambda **k: sitting(r, **k)
    mouth_x = [x for (x, y), k in b.face.items() if k == "n"]
    mouth_y = max(y for (x, y), k in b.face.items() if k == "n")
    pawx = min(mouth_x) - 0.5
    A: dict[str, list[Frame]] = {}
    # 待机：呼吸 + 尾巴尖摆。最后一帧接回第一帧，不重复第一帧
    A["idle"] = [sit0(), sit0(breath=0.5, tip=(0.6, -0.4)), sit0(breath=1, head_dy=-1, tip=(1.2, -0.8)), sit0(breath=0.5, tip=(0.6, -0.4))]
    A["blink"] = [sit0(eyes="half"), sit0(eyes="closed")]
    # 理毛：举左前爪到嘴边舔，再擦脸
    A["groom"] = [
        sit0(paws="right", raised_paw=(pawx, mouth_y + 2.5), eyes="closed", head_dy=1),
        sit0(paws="right", raised_paw=(pawx, mouth_y + 2.0), eyes="closed", mouth="tongue", head_dy=1),
        sit0(paws="right", raised_paw=(pawx, mouth_y + 1.5), eyes="closed", mouth="tongue", head_dy=1),
        sit0(paws="right", raised_paw=(pawx - 2.5, mouth_y - 1.5), eyes="closed", head_dy=1),
        sit0(paws="right", raised_paw=(pawx - 1.5, mouth_y + 0.5), eyes="closed", head_dy=1),
        sit0(paws="right", raised_paw=(pawx - 0.5, mouth_y + 2.0), eyes="closed", head_dy=1),
    ]
    # 开心跳：蹲 → 起跳 → 最高点 → 落地压扁 → 回坐姿
    A["happy"] = [sit0(), sit0(squash=1, eyes="happy"), sit0(squash=-0.6, lift_y=3, eyes="happy", tip=(0, -2)),
                  sit0(squash=-0.4, lift_y=5, eyes="happy", tip=(0, -3)), sit0(squash=0.8, eyes="happy"), sit0()]
    # 坐 ↔ 趴、打盹
    A["lie"] = [sit0(), loaf(r, t=0.5), loaf(r, t=1.0)]
    A["sleep"] = [loaf(r, eyes="closed", head_extra=1), loaf(r, eyes="closed", head_extra=1, breath=0.6),
                  loaf(r, eyes="closed", head_extra=1, breath=1, tip=1), loaf(r, eyes="closed", head_extra=1, breath=0.6)]
    # 站、走
    st = lambda **k: standing(r, **k)
    A["stand"] = [st(), st(breath=1, tip=(1, -1))]
    bobs = [0, 1, 0, 0, 1, 0]
    A["walk"] = [st(phase=i / 6, walk=2.2, bob=bobs[i], tip=((0, 0.6, 0.6, 0, -0.6, -0.6)[i], 0)) for i in range(6)]
    A["sit_stand"] = [sit0(), blend_sit_stand(r, 0.5), st()]
    A["stretch"] = [st(), st(angle=-7, front_dx=1.5, head_dy=1), st(angle=-14, front_dx=3, head_dy=3, eyes="happy"),
                    st(angle=-14, front_dx=3, head_dy=3, eyes="closed", mouth="open"), st(angle=-7, front_dx=1.5, head_dy=1), st()]
    A["play"] = [sit0(), sit0(squash=1.2, eyes="wide", body_dy=0.5), sit0(squash=1.2, eyes="wide", body_dy=0.5, body_dx=-1),
                 st(lift_y=3, angle=8, front_dx=3, eyes="wide", tip=(0, -2)), st(front_lift=3, front_dx=2, eyes="wide"), sit0()]
    return A


# 每个动作的播放节奏（每格 100ms）：帧号序列，循环播放
TIMELINE: dict[str, list[int]] = {
    "idle": [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
    "blink": [-1] * 20 + [0, 1, 1, 0] + [-1] * 24,  # -1 = 待机第 1 帧
    "groom": [0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5],
    "happy": [0] * 14 + [1, 1, 2, 3, 3, 4, 5, 5],
    "lie": [0] * 8 + [1, 2] + [2] * 8 + [1, 0],
    "sleep": [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
    "stand": [0, 0, 0, 0, 1, 1, 1, 1],
    "walk": [0, 1, 2, 3, 4, 5],
    "sit_stand": [0] * 8 + [1, 2] + [2] * 8 + [1, 0],
    "stretch": [0] * 6 + [1, 2, 2, 3, 3, 3, 3, 2, 4, 5] + [5] * 6,
    "play": [0] * 8 + [1, 1, 2, 1, 2, 1, 3, 4, 4, 5] + [5] * 6,
}


_hat_cache: dict[tuple[str, str], Image.Image] = {}


def hat_layer(acc, b: C.Body) -> Image.Image:
    """饰品图层（32×40，上方多 8 行），贴的时候放在 (OX + 头偏移x, OY + 头偏移y - 8)"""
    k = (acc.id, b.key)
    if k not in _hat_cache:
        _hat_cache[k] = render_acc(acc, anchors(b))
    return _hat_cache[k]


def setup(bs: dict[str, C.Body]):
    for key, b in bs.items():
        paw_left[key] = {p for p in b.paws if p[0] < 15}
        paw_right[key] = {p for p in b.paws if p[0] >= 15}


# ---------------------------------------------------------------- 输出

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bs = C.bodies()
    setup(bs)
    all_cats = {c.id: c for c in C.cats()}
    order = ["manmaru", "mochi", "surari", "fuwa"]
    show = {"manmaru": "mike", "mochi": "sabatora", "surari": "shamu", "fuwa": "kijitora"}
    hats = {"manmaru": "mugiwara", "mochi": "keito", "surari": "oukan", "fuwa": "heddohon"}  # 检查饰品是否跟着头走
    names = list(TIMELINE)
    accs = {a.id: a for a in accessories()}

    # 预览：一行一种体型，一列一个动作；48 格（4.8 秒）一循环
    scale = 3
    cw, ch = W * scale, H * scale
    label = 16
    ticks = 48
    frames_out = []
    rendered: dict[tuple[str, str, int], Image.Image] = {}
    for body in order:
        b = bs[body]
        cat = all_cats[show[body]]
        cat_b = copy.copy(b)
        if cat.extra_tail:
            cat_extra_tail[body] = cat.extra_tail
        r = rig_of(cat_b)
        anims = animations(r)
        cat_extra_tail.pop(body, None)
        for name in names:
            for i, fr in enumerate(anims[name]):
                rendered[(body, name, i)] = (fr, cat, cat_b)  # type: ignore[assignment]
        rendered[(body, "idle_first", 0)] = (anims["idle"][0], cat, cat_b)  # type: ignore[assignment]
    for t in range(ticks):
        sheet = Image.new("RGB", (len(names) * (cw + 6) + 6, len(order) * (ch + 6) + label + 6), (245, 241, 232))
        d = ImageDraw.Draw(sheet)
        for j, name in enumerate(names):
            d.text((6 + j * (cw + 6) + 4, 4), name, fill=(91, 84, 75))
        for i, body in enumerate(order):
            for j, name in enumerate(names):
                tl = TIMELINE[name]
                fi = tl[t % len(tl)]
                key = (body, "idle_first", 0) if fi < 0 else (body, name, fi)
                fr, cat, cb = rendered[key]  # type: ignore[misc]
                im = paint(fr, cat, cb, t)
                cell = Image.new("RGBA", (W, H), (255, 253, 248, 255))
                cell = Image.alpha_composite(cell, im)
                hl = hat_layer(accs[hats[body]], cb)
                hx, hy = fr.head
                layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                layer.paste(hl, (OX + hx, OY + hy - ACC_TOP), hl)
                cell = Image.alpha_composite(cell, layer)
                sheet.paste(cell.resize((cw, ch), Image.NEAREST), (6 + j * (cw + 6), label + 6 + i * (ch + 6)))
        frames_out.append(sheet)
    frames_out[0].save(OUT / "preview.gif", save_all=True, append_images=frames_out[1:], duration=100, loop=0)
    frames_out[0].save(OUT / "preview_first.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
