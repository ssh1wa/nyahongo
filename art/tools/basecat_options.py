"""基础猫的几个 32×32 方案：用几何形状拼出身体，自动描边和打阴影，再手工点上五官。

运行：uv run --project pc python art/tools/basecat_options.py
输出：art/base_cat_options/（每个方案的原尺寸 PNG、放大版，以及一张对比图）
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw

N = 32
OUT = Path(__file__).resolve().parents[1] / "base_cat_options"

OUTLINE = (58, 46, 42)
FUR = (255, 253, 248)
SHADE = (228, 220, 207)
SHADE2 = (204, 194, 179)
PINK = (244, 166, 189)
BLUSH = (247, 190, 200)
EYE = (58, 46, 42)
SHINE = (255, 255, 255)

Px = tuple[int, int]


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


def stroke(points: list[tuple[float, float]], r: float, steps: int = 60) -> set[Px]:
    """沿贝塞尔曲线（2 或 3 个控制点之后的任意阶）盖圆形笔刷"""
    def bez(t):
        pts = list(points)
        while len(pts) > 1:
            pts = [((1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]) for a, b in zip(pts, pts[1:])]
        return pts[0]
    out: set[Px] = set()
    for i in range(steps + 1):
        cx, cy = bez(i / steps)
        out |= ellipse(cx, cy, r, r)
    return out


def clip(s: set[Px]) -> set[Px]:
    return {(x, y) for x, y in s if 0 <= x < N and 0 <= y < N}


@dataclass
class Cat:
    name: str
    title: str
    parts: list[set[Px]]  # 从后往前画
    face: dict[Px, tuple[int, int, int]] = field(default_factory=dict)

    def render(self) -> list[list[tuple[int, int, int] | None]]:
        g: list[list] = [[None] * N for _ in range(N)]
        owner: list[list[int]] = [[-1] * N for _ in range(N)]
        for idx, part in enumerate(self.parts):
            part = clip(part)
            dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
            edge = {(x, y) for x, y in part if any((x + dx, y + dy) not in part for dx, dy in dirs)}
            inner = part - edge
            # 边缘外面全是前面画过的部件（比如下巴压在身体上）时，用浅一点的内线，不用黑描边，
            # 否则两条描边叠在一起会变成一坨黑
            def covered(x, y):
                return 0 <= x < N and 0 <= y < N and g[y][x] is not None
            soft = {(x, y) for x, y in edge
                    if all(covered(x + dx, y + dy) for dx, dy in dirs if (x + dx, y + dy) not in part)}
            for x, y in inner:
                g[y][x] = FUR
                owner[y][x] = idx
            # 右下方向背光：贴着右边、下边描边的一圈是阴影
            for x, y in inner:
                if (x + 1, y) in edge or (x, y + 1) in edge or (x + 1, y + 1) in edge:
                    g[y][x] = SHADE
            for x, y in edge:
                g[y][x] = SHADE2 if (x, y) in soft else OUTLINE
                owner[y][x] = idx
            # 这个部件压在后面部件上的地方，下面投一格阴影（下巴下、爪子后面）
            for x, y in edge:
                below = (x, y + 1)
                if below not in part and 0 <= y + 1 < N and owner[y + 1][x] not in (-1, idx) and g[y + 1][x] in (FUR, SHADE):
                    g[y + 1][x] = SHADE
        for (x, y), col in self.face.items():
            g[y][x] = col
        return g


def mirror(pairs: dict[Px, tuple], cx2: int = 29) -> dict[Px, tuple]:
    """五官左右对称：x 和 cx2 - x 成对（画布中心在第 14、15 列之间）"""
    out = dict(pairs)
    for (x, y), c in pairs.items():
        out[(cx2 - x, y)] = c
    return out


def designs() -> list[Cat]:
    cats: list[Cat] = []

    # 1 まんまる：大圆头、大眼睛、腮红，最萌的 Q 版
    head = ellipse(15, 13.5, 9.6, 7.6) | tri((6.0, 10.5), (7.2, 3.6), (12.6, 7.2)) | tri((24.0, 10.5), (22.8, 3.6), (17.4, 7.2))
    body = ellipse(15, 24.5, 7.8, 7.6)
    paws = ellipse(12, 30, 2.6, 2.1) | ellipse(18, 30, 2.6, 2.1)
    tail = stroke([(20.5, 29.5), (28.5, 30), (27, 21)], 1.6)
    face = mirror({
        (9, 13): EYE, (10, 13): EYE, (9, 14): EYE, (10, 14): EYE, (9, 15): EYE, (10, 15): EYE, (9, 13 + 0): SHINE,
        (7, 17): BLUSH, (8, 17): BLUSH,
        (8, 7): PINK, (9, 7): PINK, (9, 6): PINK, (8, 8): PINK,
        (13, 18): EYE,
    })
    face.update({(14, 17): PINK, (15, 17): PINK})
    face[(9, 13)] = SHINE
    face[(20, 13)] = EYE
    face[(19, 13)] = SHINE
    cats.append(Cat("1_manmaru", "1 manmaru", [tail, body, head, paws], face))

    # 2 ちょこん：端正地坐着，豆豆眼，最接近现在的占位猫
    head = ellipse(15, 12.5, 7.8, 6.4) | tri((8.0, 10.0), (8.6, 3.8), (13.0, 7.0)) | tri((22.0, 10.0), (21.4, 3.8), (17.0, 7.0))
    body = ellipse(15, 23.5, 6.6, 8.2)
    paws = ellipse(12.5, 30, 2.2, 2.0) | ellipse(17.5, 30, 2.2, 2.0)
    tail = stroke([(19.5, 30), (26, 30.5), (25.5, 23), (23.5, 21.5)], 1.5)
    face = mirror({
        (11, 12): EYE, (11, 13): EYE,
        (9, 15): BLUSH,
        (9, 7): PINK, (10, 7): PINK, (10, 6): PINK,
    })
    face.update({(14, 15): PINK, (15, 15): PINK, (13, 16): EYE, (16, 16): EYE})
    cats.append(Cat("2_chokon", "2 chokon", [tail, body, head, paws], face))

    # 3 もちもち：头和身体连成一团年糕，眯眼笑
    blob = ellipse(15, 22.5, 11.2, 9.4) | ellipse(15, 15.5, 9.4, 7.4) | tri((6.4, 12.5), (7.4, 6.0), (11.6, 9.0)) | tri((23.6, 12.5), (22.6, 6.0), (18.4, 9.0))
    paws = ellipse(11.5, 30.4, 2.4, 1.8) | ellipse(18.5, 30.4, 2.4, 1.8)
    tail = stroke([(24, 29), (29.2, 28.5), (29, 24)], 1.5)
    face = mirror({
        (9, 17): EYE, (10, 16): EYE, (11, 17): EYE,
        (7, 19): BLUSH, (8, 19): BLUSH,
        (8, 9): PINK, (9, 9): PINK, (9, 8): PINK,
    })
    face.update({(14, 19): PINK, (15, 19): PINK, (13, 20): EYE, (16, 20): EYE})
    cats.append(Cat("3_mochimochi", "3 mochimochi", [tail, blob, paws], face))

    # 4 すらり：小头长身，尾巴高高翘起，杏仁眼
    head = ellipse(15, 12.2, 6.8, 5.6) | tri((8.8, 10.0), (9.2, 3.2), (13.4, 7.2)) | tri((21.2, 10.0), (20.8, 3.2), (16.6, 7.2))
    body = ellipse(15, 23.8, 5.6, 8.0) | ellipse(15, 18, 3.6, 3)
    paws = ellipse(13, 30.2, 1.9, 1.8) | ellipse(17, 30.2, 1.9, 1.8)
    tail = stroke([(19, 29.5), (27.5, 28.5), (27, 16), (23.5, 14.5)], 1.3)
    face = mirror({
        (11, 12): EYE, (12, 12): EYE, (11, 13): EYE, (12, 13): EYE, (12, 12 + 0): SHINE,
        (10, 7): PINK, (10, 6): PINK, (11, 7): PINK,
    })
    face[(11, 12)] = SHINE
    face[(12, 12)] = EYE
    face[(17, 12)] = SHINE
    face[(18, 12)] = EYE
    face.update({(14, 15): PINK, (15, 15): PINK, (13, 16): EYE, (16, 16): EYE})
    cats.append(Cat("4_surari", "4 surari", [tail, body, head, paws], face))

    # 5 ふわふわ：圆头两边有蓬松的脸颊毛，ω 嘴
    head = (ellipse(15, 13.5, 8.6, 7.0) | tri((6.5, 10.0), (7.8, 4.0), (12.4, 7.2)) | tri((23.5, 10.0), (22.2, 4.0), (17.6, 7.2))
            | tri((5.0, 16.5), (8.0, 13.0), (8.5, 19.0)) | tri((25.0, 16.5), (22.0, 13.0), (21.5, 19.0)))
    body = ellipse(15, 24.5, 7.4, 7.6)
    paws = ellipse(12, 30, 2.4, 2.0) | ellipse(18, 30, 2.4, 2.0)
    tail = stroke([(20.5, 29.5), (27.5, 30.2), (28, 23.5), (26, 21.5)], 1.7)
    face = mirror({
        (10, 13): EYE, (10, 14): EYE, (11, 13): EYE, (11, 14): EYE,
        (8, 16): BLUSH, (9, 16): BLUSH,
        (9, 7): PINK, (9, 6): PINK, (10, 7): PINK,
    })
    face[(10, 13)] = SHINE
    face[(18, 13)] = SHINE
    face[(19, 13)] = EYE
    face.update({(14, 16): PINK, (15, 16): PINK, (13, 17): EYE, (16, 17): EYE})
    cats.append(Cat("5_fuwafuwa", "5 fuwafuwa", [tail, body, head, paws], face))
    return cats


def to_image(g, scale: int, bg=None) -> Image.Image:
    img = Image.new("RGBA", (N * scale, N * scale), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c:
                d.rectangle([x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1], fill=c)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cats = designs()
    grids = [c.render() for c in cats]
    for c, g in zip(cats, grids):
        to_image(g, 1).save(OUT / f"{c.name}.png")
        to_image(g, 12).save(OUT / f"{c.name}_x12.png")

    # 对比图：上排大图（浅色底），中排 App 里实际大小（2x），下排深色底
    big, gap = 10, 24
    cell = N * big
    w = len(cats) * (cell + gap) + gap
    h = gap + cell + 40 + N * 2 + gap + N * 4 + gap + 20
    sheet = Image.new("RGB", (w, h), (245, 241, 232))
    d = ImageDraw.Draw(sheet)
    dark_y = gap + cell + 40 + N * 2 + gap
    d.rectangle([0, dark_y - gap // 2, w, h], fill=(22, 20, 18))
    for i, (c, g) in enumerate(zip(cats, grids)):
        x0 = gap + i * (cell + gap)
        sheet.paste(to_image(g, big, (255, 253, 248, 255)), (x0, gap))
        d.text((x0 + cell // 2 - 30, gap + cell + 10), c.title, fill=(91, 84, 75))
        small = to_image(g, 2)
        sheet.paste(small, (x0 + cell // 2 - N, gap + cell + 40), small)
        dk = to_image(g, 4)
        sheet.paste(dk, (x0 + cell // 2 - N * 2, dark_y), dk)
    sheet.save(OUT / "compare.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
