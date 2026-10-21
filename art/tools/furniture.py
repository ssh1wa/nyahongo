"""8 件家具，32×32，和猫用同一套「形状 → 自动描边 → 右下阴影」的画法，风格一致。底部贴着第 31 行（放在地上）。

运行：uv run --with pillow --no-project python -I art/tools/furniture.py
输出：art/furniture/<id>.png、<id>_x12.png、overview.png
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from cats import OUTLINE, darken, ellipse, hexc, mix, stroke, tri  # noqa: E402

N = 32
OUT = Path(__file__).resolve().parents[1] / "furniture"
Px = tuple[int, int]
RGB = tuple[int, int, int]


def rect(x0, y0, x1, y1) -> set[Px]:
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def rrect(x0, y0, x1, y1) -> set[Px]:
    """去掉四个角的圆角矩形"""
    return rect(x0, y0, x1, y1) - {(x0, y0), (x1, y0), (x0, y1), (x1, y1)}


def poly(pts) -> set[Px]:
    out = set()
    for y in range(N):
        yc = y + 0.5
        xs = []
        for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
            if (y1 <= yc < y2) or (y2 <= yc < y1):
                xs.append(x1 + (yc - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            for x in range(N):
                if xs[i] <= x + 0.5 <= xs[i + 1]:
                    out.add((x, y))
    return out


@dataclass
class P:
    mask: set[Px]
    color: Callable[[int, int], RGB] | str
    soft_ok: bool = True  # 压在前一个部件上时用浅内线


@dataclass
class Item:
    id: str
    rarity: str
    parts: list[P]
    over: list[tuple[int, int, str, int]] = field(default_factory=list)  # 最后叠加的像素 (x, y, 颜色, 不透明度)
    glow: str | None = None
    sparkles: list[tuple[int, int, str]] = field(default_factory=list)


def paint(item: Item) -> Image.Image:
    tone: list[list[str | None]] = [[None] * N for _ in range(N)]
    color: list[list[RGB | None]] = [[None] * N for _ in range(N)]
    owner = [[-1] * N for _ in range(N)]
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for idx, part in enumerate(item.parts):
        m = {(x, y) for x, y in part.mask if 0 <= x < N and 0 <= y < N}
        edge = {(x, y) for x, y in m if any((x + dx, y + dy) not in m for dx, dy in dirs)}
        inner = m - edge

        def covered(x, y):
            return 0 <= x < N and 0 <= y < N and tone[y][x] is not None
        soft = {(x, y) for x, y in edge if part.soft_ok and all(covered(x + dx, y + dy) for dx, dy in dirs if (x + dx, y + dy) not in m)}
        fn = part.color if callable(part.color) else (lambda x, y, c=hexc(part.color): c)
        for x, y in m:
            color[y][x] = fn(x, y)
            owner[y][x] = idx
        for x, y in inner:
            tone[y][x] = "shade" if ((x + 1, y) in edge or (x, y + 1) in edge or (x + 1, y + 1) in edge) else "base"
        for x, y in edge:
            tone[y][x] = "soft" if (x, y) in soft else "line"
    sil = {(x, y) for x in range(N) for y in range(N) if tone[y][x]}
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    px = img.load()
    if item.glow:
        g = hexc(item.glow)
        for x in range(N):
            for y in range(N):
                if (x, y) in sil:
                    continue
                d = min((abs(x - a) + abs(y - b) for a, b in sil if abs(x - a) <= 3 and abs(y - b) <= 3), default=99)
                if d <= 3:
                    px[x, y] = (*g, (170, 110, 60)[d - 1])
    for y in range(N):
        for x in range(N):
            t = tone[y][x]
            if not t:
                continue
            if t == "line":
                px[x, y] = (*OUTLINE, 255)
                continue
            c = color[y][x]
            c = darken(c, 0.86) if t == "shade" else darken(c, 0.72) if t == "soft" else c
            px[x, y] = (*c, 255)
    for x, y, c, a in item.over:
        if 0 <= x < N and 0 <= y < N:
            col = hexc(c)
            if a >= 255 or px[x, y][3] == 0:
                px[x, y] = (*col, a)
            else:
                r, g, b, aa = px[x, y]
                t = a / 255
                px[x, y] = (round(r + (col[0] - r) * t), round(g + (col[1] - g) * t), round(b + (col[2] - b) * t), aa)
    for x, y, c in item.sparkles:
        col = hexc(c)
        px[x, y] = (*col, 255)
        for dx, dy in dirs:
            if (x + dx, y + dy) not in sil and 0 <= x + dx < N and 0 <= y + dy < N:
                px[x + dx, y + dy] = (*col, 130)
    return img


def items() -> list[Item]:
    L: list[Item] = []

    # 座布団：深红坐垫，中间一针，四角流苏
    over = [(15, 21, "#6E1F26", 255), (16, 21, "#6E1F26", 255)]
    for x, y in ((3, 17), (28, 17), (3, 27), (28, 27)):
        over.append((x, y, "#F2C94C", 255))
    L.append(Item("zabuton", "common", [
        P(rrect(3, 21, 28, 30), "#7E2630"),
        P(rrect(3, 17, 28, 27), lambda x, y: mix(hexc("#A8323A"), (255, 220, 220), 0.12) if 9 <= x <= 22 and 19 <= y <= 25 else hexc("#A8323A")),
    ], over))

    # ちゃぶ台：圆矮桌和一杯绿茶
    wood = "#B07A4A"
    L.append(Item("chabudai", "common", [
        P(rect(10, 22, 11, 29), "#7A5236", soft_ok=False),
        P(rect(20, 22, 21, 29), "#7A5236", soft_ok=False),
        P(ellipse(15.5, 20.5, 13.2, 4.6), "#8A5A3B"),
        P(ellipse(15.5, 18.5, 13, 4.4), lambda x, y: mix(hexc(wood), (255, 240, 220), 0.18) if y <= 16 else hexc(wood)),
        P(rect(6, 23, 7, 31), "#8A5A3B", soft_ok=False),
        P(rect(24, 23, 25, 31), "#8A5A3B", soft_ok=False),
        P(rect(17, 12, 20, 17), "#6B9E6A"),
    ], [(18, 12, "#9CC79A", 255), (19, 12, "#9CC79A", 255), (18, 10, "#FFFFFF", 120), (19, 9, "#FFFFFF", 90)]))

    # 本棚：矮书架，三层书
    books = ["#A8443A", "#3F5F9A", "#5E8C4E", "#C9963A", "#7A4A6A", "#E8DCC0", "#2F3A66"]
    parts = [P(rect(5, 5, 26, 31), "#8A5A3B"), P(rect(7, 7, 24, 29), "#4A3426")]
    k = 0
    for sy in (7, 15, 23):
        x = 7
        while x <= 23:
            w = (2, 3, 2, 2, 3)[k % 5]
            hgt = (6, 5, 6, 4, 5, 6)[k % 6]
            col = books[k % len(books)]
            parts.append(P(rect(x, sy + 6 - hgt, min(24, x + w - 1), sy + 5), col))
            x += w
            k += 1
        parts.append(P(rect(7, sy + 6, 24, sy + 7), "#A8794E"))
    L.append(Item("hondana", "common", parts, [(x, 5, "#B98A5E", 255) for x in range(6, 26)]))

    # こたつ：被子 + 桌面 + 两个橘子
    def futon(x, y):
        if y >= 28:
            return hexc("#A83A2E")  # 下摆一条深色边
        if x % 4 == 1 and y % 4 == 1:
            return hexc("#F3E3C3")
        if (x + 2) % 4 == 1 and (y + 2) % 4 == 1:
            return hexc("#F2A673")
        return hexc("#D8503A")
    L.append(Item("kotatsu", "rare", [
        P(poly([(4, 16), (27.5, 16), (31, 31.5), (0.5, 31.5)]), futon),
        P(rect(3, 12, 28, 16), lambda x, y: hexc("#C9935C") if y <= 13 else hexc("#A8794E")),
        P(ellipse(11, 10, 2.6, 2.4), "#F2933A"),
        P(ellipse(17, 10.5, 2.6, 2.4), "#F2933A"),
    ], [(11, 7, "#5E8C4E", 255), (12, 7, "#5E8C4E", 255), (17, 8, "#5E8C4E", 255), (10, 9, "#FFC27A", 255), (16, 9, "#FFC27A", 255)]))

    # 盆栽：蓝釉盆、弯曲的树干、三团松叶
    def leaves(x, y, cy):
        return hexc("#6E9E5A") if y < cy - 1 else hexc("#4E7A42")
    L.append(Item("bonsai", "rare", [
        P(stroke([(15, 25), (11, 20), (17, 15), (13, 9)], 1.2), "#6E4A33"),
        P(stroke([(16, 17), (21, 12)], 0.8), "#6E4A33"),
        P(ellipse(9.5, 12.5, 5.5, 2.8), lambda x, y: leaves(x, y, 12.5)),
        P(ellipse(21, 10, 6, 3), lambda x, y: leaves(x, y, 10)),
        P(ellipse(14, 6.5, 4.5, 2.4), lambda x, y: leaves(x, y, 6.5)),
        P(poly([(7, 23), (25, 23), (22.5, 31.5), (9.5, 31.5)]), lambda x, y: hexc("#5F8FC8") if y <= 24 else hexc("#3F6FA8")),
    ]))

    # 提灯：红纸灯笼放在小木架上，里面透出暖光
    def lantern(x, y):
        c = hexc("#D8443A")
        if (y - 6) % 3 == 0:
            c = hexc("#A82D25")
        if abs(x + 0.5 - 15.5) < 3 and 9 <= y <= 18:
            c = mix(c, hexc("#FFB070"), 0.45)
        return c
    L.append(Item("chouchin", "rare", [
        P(rect(15, 21, 16, 29), "#8A5A3B", soft_ok=False),
        P(rect(10, 29, 21, 31), "#6E4A33"),
        P(ellipse(15.5, 13.5, 7.5, 8.2), lantern),
        P(rect(12, 4, 19, 6), "#2B2624"),
        P(rect(12, 21, 19, 22), "#2B2624"),
    ], glow="#FFB070"))

    # 金魚鉢：玻璃鱼缸、两条金鱼、水面高光
    def bowl(x, y):
        if y == 12:
            return hexc("#C4E6F4") if x % 3 else hexc("#FFFFFF")  # 水面
        if y > 12:
            return hexc("#8FC8E6") if y < 22 else hexc("#7AB8DA")
        return hexc("#E4F3FA")
    over = []
    for x, y, c in ((10, 16, "#E8503A"), (11, 16, "#E8503A"), (12, 16, "#F2933A"), (9, 15, "#FFFFFF"), (9, 17, "#FFFFFF"), (13, 16, "#2B2624"),
                    (19, 21, "#E8503A"), (20, 21, "#FFFFFF"), (21, 21, "#E8503A"), (22, 20, "#E8503A"), (22, 22, "#E8503A"), (18, 21, "#2B2624"),
                    (8, 9, "#FFFFFF"), (7, 11, "#FFFFFF"), (7, 12, "#FFFFFF"), (15, 12, "#D4EEF8"), (16, 12, "#D4EEF8"), (17, 12, "#D4EEF8")):
        over.append((x, y, c, 255))
    L.append(Item("kingyobachi", "epic", [
        P(rect(9, 26, 22, 28), "#8A5A3B"),
        P(rect(10, 29, 11, 31), "#6E4A33", soft_ok=False),
        P(rect(20, 29, 21, 31), "#6E4A33", soft_ok=False),
        P(ellipse(15.5, 16, 10.5, 10) - rect(0, 0, 31, 5), bowl),
        P(ellipse(15.5, 6.5, 6.5, 1.6), "#CFE8F2"),
    ], over, sparkles=[(26, 7, "#FFFFFF"), (4, 20, "#D4EEF8")]))

    # 金屏風：四扇金屏风，画着松和鹤
    def screen(x, y):
        panel = (x - 2) // 7
        c = hexc("#F2C94C") if panel % 2 == 0 else hexc("#D9A42A")
        return c
    over = []
    # 松：几团深绿的云状松叶 + 弯曲的树干（画在左边两扇）
    for x, y in stroke([(9, 27), (8, 21), (11, 16), (9, 11)], 0.9):
        over.append((x, y, "#6E4A33", 255))
    for cx, cy, rx, ry in ((7, 10, 4.5, 2), (12, 14.5, 4, 1.8), (6, 18, 3.5, 1.6)):
        for x, y in ellipse(cx, cy, rx, ry):
            over.append((x, y, "#3F6B4E" if y >= cy else "#5E8C4E", 255))
    # 鹤：白身、黑尾、红顶，脖子往上伸（画在右边两扇）
    for x, y in ellipse(21, 16, 4, 2.2):
        over.append((x, y, "#FFFFFF", 255))
    for x, y in ((24, 15), (25, 14), (25, 13), (25, 12), (26, 11), (17, 16), (17, 17)):
        over.append((x, y, "#FFFFFF", 255))
    for x, y in ((16, 16), (16, 17), (17, 18), (18, 18), (19, 18)):
        over.append((x, y, "#2B2624", 255))
    over.append((26, 10, "#D8443A", 255))
    over.append((27, 11, "#C9963A", 255))
    for x, y in ((20, 18), (20, 19), (20, 20), (21, 21), (22, 18), (22, 19), (22, 20), (23, 21)):
        over.append((x, y, "#3A2E2A", 255))
    for x, y in [(4, 7), (12, 22), (18, 8), (26, 24), (16, 27)]:
        over.append((x, y, "#FFF6C8", 255))
    L.append(Item("kinbyoubu", "legendary", [
        P(rect(3, 28, 4, 31) | rect(27, 28, 28, 31), "#2B2624", soft_ok=False),
        P(rect(2, 4, 29, 29), screen),
    ], [(x, y, "#B8862A", 255) for x in (8, 15, 22) for y in range(5, 29)] + over  # 先画扇面分隔线，画在上面
        + [(x, 4, "#2B2624", 255) for x in range(2, 30)] + [(x, 29, "#2B2624", 255) for x in range(2, 30)],
        glow="#FFE58A", sparkles=[(1, 2, "#FFF2B0"), (30, 10, "#FFF2B0"), (31, 26, "#FFF2B0")]))
    return L


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    its = items()
    sc = 6
    sheet = Image.new("RGB", (len(its) * (N * sc + 10) + 10, N * sc + 40), (245, 241, 232))
    d = ImageDraw.Draw(sheet)
    rc = {"common": (140, 132, 120), "rare": (63, 125, 184), "epic": (154, 85, 200), "legendary": (210, 154, 30)}
    for i, it in enumerate(its):
        im = paint(it)
        im.save(OUT / f"{it.id}.png")
        im.resize((N * 12, N * 12), Image.NEAREST).save(OUT / f"{it.id}_x12.png")
        x0 = 10 + i * (N * sc + 10)
        d.rectangle([x0, 10, x0 + N * sc - 1, 10 + N * sc - 1], fill=(255, 253, 248))
        big = im.resize((N * sc, N * sc), Image.NEAREST)
        sheet.paste(big, (x0, 10), big)
        d.rectangle([x0, 10 + N * sc, x0 + N * sc - 1, 13 + N * sc], fill=rc[it.rarity])
        d.text((x0 + 4, 18 + N * sc), it.id, fill=(91, 84, 75))
    sheet.save(OUT / "overview.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
