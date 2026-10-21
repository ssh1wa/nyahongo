"""8 个房间场景，160×96。地面从第 FLOOR 行开始，中下方留给猫和家具。

运行：uv run --with pillow --no-project python -I art/tools/scenes.py
输出：art/scenes/<id>.png 和放大版 <id>_x4.png
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pixel import Canvas, dark, hexc, mix  # noqa: E402

W, H = 160, 96
FLOOR = 58
OUT = Path(__file__).resolve().parents[1] / "scenes"
LINE = "#3A2E2A"


def wood_post(c: Canvas, x0: int, x1: int, y0: int, y1: int, base="#9C6B45"):
    b = hexc(base)
    c.rect(x0, y0, x1, y1, b)
    c.rect(x0, y0, x0, y1, mix(b, (255, 240, 220), 0.25))
    c.rect(x1, y0, x1, y1, dark(b, 0.78))


def wood_floor(c: Canvas, top: int, base: str, line: str, planks: int = 7, vertical: bool = False):
    c.bands(top, H - 1, [dark(hexc(base), 0.9), base, mix(hexc(base), (255, 240, 220), 0.08)])
    rows = c.floor_rows(top, planks, line, power=1.6)
    # 木板接缝错开
    rnd = random.Random(top)
    prev = top
    for y in rows + [H]:
        for _ in range(3):
            x = rnd.randint(4, W - 5)
            c.rect(x, prev + 1, x, y - 1, line, 140)
        prev = y
    if vertical:
        c.floor_lines(top, W / 2, [i * 24 - 40 for i in range(10)], line, 120)


# ---------------------------------------------------------------- 1 和室

def washitsu() -> Canvas:
    c = Canvas(W, H, "#EFE4CE")
    c.rect(0, 0, W - 1, 7, "#6E4A33")
    for x in range(0, W, 12):
        c.rect(x, 0, x, 7, "#5B3D2A")
    c.rect(0, 8, W - 1, 10, "#8A5A3B")
    c.rect(0, 10, W - 1, 10, "#6E4A33")
    # 障子（左右）
    for x0, x1 in ((19, 66), (104, 140)):
        c.rect(x0, 11, x1, FLOOR - 1, "#FBF6EA")
        for x in range(x0, x1 + 1, 6):
            c.rect(x, 11, x, FLOOR - 1, "#D2B48C")
        for y in range(11, FLOOR, 8):
            c.rect(x0, y, x1, y, "#D2B48C")
        c.frame(x0, 11, x1, FLOOR - 1, "#B48E62", 2)
        # 下午的光：纸面靠下更亮
        c.rect(x0 + 2, FLOOR - 16, x1 - 2, FLOOR - 3, "#FFF9E8", 90)
    # 床の間
    c.rect(70, 11, 100, FLOOR - 1, "#E2D3B6")
    c.rect(70, 11, 71, FLOOR - 1, "#C9B48E")
    c.rect(70, FLOOR - 8, 100, FLOOR - 1, "#8A5A3B")
    c.rect(70, FLOOR - 8, 100, FLOOR - 8, "#B98A5E")
    # 挂轴
    c.rect(79, 14, 90, 15, "#5B4335")
    c.rect(80, 16, 89, 44, "#6B8E5A")
    c.rect(81, 18, 88, 42, "#F4EEDC")
    for x, y0, y1 in ((83, 21, 27), (84, 22, 30), (86, 25, 33), (85, 34, 38), (84, 36, 37)):
        c.rect(x, y0, x, y1, "#5B5550")
    c.px(87, 23, "#C8352B")
    c.rect(79, 45, 90, 45, "#5B4335")
    # 花瓶和山茶
    c.rect(93, FLOOR - 14, 96, FLOOR - 9, "#5F7D93")
    c.rect(93, FLOOR - 14, 93, FLOOR - 9, "#7FA0B5")
    c.line(94, FLOOR - 15, 92, FLOOR - 24, "#5B4335")
    c.line(95, FLOOR - 15, 98, FLOOR - 22, "#5B4335")
    for x, y in ((91, FLOOR - 25), (98, FLOOR - 23), (93, FLOOR - 21)):
        c.rect(x, y, x + 1, y + 1, "#D8443A")
    c.px(92, FLOOR - 22, "#6B8E5A")
    wood_post(c, 14, 18, 8, FLOOR - 1)
    wood_post(c, 141, 145, 8, FLOOR - 1)
    c.rect(0, FLOOR - 1, W - 1, FLOOR - 1, "#6E4A33")
    # 榻榻米
    c.bands(FLOOR, H - 1, ["#B9B26E", "#C8C27E", "#D2CC8A"])
    for y in range(FLOOR + 1, H, 2):
        c.rect(0, y, W - 1, y, "#B5AE6C", 70)
    c.rect(0, FLOOR + 14, W - 1, FLOOR + 15, "#4E6B40")
    c.floor_lines(FLOOR, W / 2, [-30, 80, 190], "#4E6B40")
    c.floor_lines(FLOOR, W / 2 + 1, [-29, 81, 191], "#4E6B40")
    # 障子透过来的光斑
    c.poly([(22, FLOOR), (64, FLOOR), (52, H - 1), (2, H - 1)], "#F2EDB0", 70)
    c.poly([(106, FLOOR), (138, FLOOR), (158, H - 1), (118, H - 1)], "#F2EDB0", 60)
    return c


# ---------------------------------------------------------------- 2 縁側

def engawa() -> Canvas:
    c = Canvas(W, H, "#BFE3F5")
    c.bands(10, 40, ["#9FD3F0", "#B8E0F4", "#D3ECF8", "#E6F5FA"])
    for cx, cy, rx in ((40, 20, 14), (52, 18, 10), (118, 26, 12), (128, 24, 8)):
        c.ellipse(cx, cy, rx, rx * 0.45, "#FFFFFF")
        c.ellipse(cx, cy + 2, rx * 0.9, rx * 0.25, "#E4EEF4")
    # 远处的树和篱笆
    for cx, cy, r in ((10, 38, 14), (30, 34, 12), (52, 37, 13), (110, 35, 14), (134, 32, 15), (156, 37, 12)):
        c.ellipse(cx, cy, r, r * 0.8, "#5E8C4E")
        c.ellipse(cx - 3, cy - 3, r * 0.6, r * 0.45, "#6E9E5A")
    c.rect(0, 40, W - 1, FLOOR - 1, "#9CC27A")
    c.speckle(0, 40, W - 1, FLOOR - 1, "#8AB46A", 0.12, 3)
    for cx, cy, r in ((22, 46, 9), (70, 47, 8), (96, 45, 9)):
        c.ellipse(cx, cy, r, r * 0.6, "#7FB069")
        c.ellipse(cx - 2, cy - 2, r * 0.55, r * 0.3, "#94C47C")
        for i in range(4):
            c.px(int(cx - r * 0.5 + i * r * 0.35), int(cy - 1), "#F4A6BD")
    # 石灯笼
    c.rect(122, 38, 132, 40, "#8F8F8F")
    c.rect(124, 41, 130, 45, "#A9A9A9")
    c.rect(125, 42, 129, 44, "#F7DC6F")
    c.rect(121, 46, 133, 47, "#8F8F8F")
    c.rect(125, 48, 129, 55, "#9C9C9C")
    c.rect(122, 55, 132, 56, "#858585")
    # 屋檐
    c.rect(0, 0, W - 1, 9, "#5B4335")
    for x in range(4, W, 10):
        c.rect(x, 0, x + 1, 8, "#4A3529")
    c.rect(0, 9, W - 1, 10, "#3E2C22")
    wood_post(c, 6, 10, 10, FLOOR - 1, "#8A5A3B")
    wood_post(c, 149, 153, 10, FLOOR - 1, "#8A5A3B")
    # 风铃
    c.line(44, 11, 44, 16, "#8C8478")
    c.ellipse(44.5, 18.5, 3, 2.6, "#CFEAF7")
    c.rect(42, 17, 47, 17, "#D8443A")
    c.px(43, 18, "#FFFFFF")
    c.rect(44, 21, 44, 22, "#8C8478")
    c.rect(43, 23, 45, 29, "#F7E4E4")
    c.rect(43, 25, 45, 25, "#D8443A")
    # 檐廊木地板
    c.rect(0, FLOOR - 1, W - 1, FLOOR, "#6E4A33")
    wood_floor(c, FLOOR + 1, "#C9A06A", "#9E7748", 7)
    c.rect(0, FLOOR + 1, W - 1, FLOOR + 4, "#6E4A33", 60)  # 屋檐的影子
    return c


# ---------------------------------------------------------------- 3 放課後の教室

def kyoushitsu() -> Canvas:
    c = Canvas(W, H, "#EDE3CF")
    c.rect(0, 44, W - 1, FLOOR - 1, "#B08A5E")
    c.rect(0, 44, W - 1, 44, "#8A6A45")
    for x in range(0, W, 20):
        c.rect(x, 45, x, FLOOR - 1, "#9C7A50")
    # 窗户（左）+ 夕阳
    c.rect(4, 6, 34, 42, "#D9D4CC")
    for (x0, x1) in ((6, 19), (21, 32)):
        c.bands(8, 40, ["#7A6AA6", "#C98AA8", "#F2A673", "#F7C873", "#FBE2A0"], x0, x1)
    c.rect(4, 23, 34, 24, "#D9D4CC")
    c.ellipse(26, 36, 5, 4, "#FFF2C8")
    # 黑板
    c.rect(44, 8, 126, 38, "#8A5A3B")
    c.rect(46, 10, 124, 36, "#3F6B4E")
    c.speckle(46, 10, 124, 36, "#4A7A5A", 0.05, 9)
    for x0, y0, x1, y1 in ((54, 16, 72, 16), (54, 20, 66, 20), (82, 15, 100, 18), (86, 24, 108, 22), (58, 28, 76, 30), (104, 29, 116, 29)):
        c.line(x0, y0, x1, y1, "#CFE3D6", 150)
    c.rect(46, 37, 124, 38, "#6E4A33")
    c.rect(60, 36, 63, 36, "#FFFFFF")
    c.rect(66, 36, 68, 36, "#F4A6BD")
    # 钟
    c.ellipse(140, 12, 5, 5, "#F4F1EA")
    c.frame(135, 7, 145, 17, "#5B4335")
    c.line(140, 12, 140, 9, LINE)
    c.line(140, 12, 142, 12, LINE)
    # 夕阳斜照的光带
    for k in range(3):
        x = 30 + k * 26
        c.poly([(x, 6), (x + 12, 6), (x + 50, H - 1), (x + 34, H - 1)], "#FFD9A0", 45)
    # 木地板
    wood_floor(c, FLOOR, "#B98A5E", "#946A42", 7)
    # 右后方的课桌
    c.rect(132, 46, 156, 49, "#C9A06A")
    c.rect(132, 46, 156, 46, "#DDB884")
    c.rect(133, 50, 155, 53, "#9C7A50")
    c.rect(134, 54, 135, 62, "#8C8C8C")
    c.rect(153, 54, 154, 62, "#8C8C8C")
    return c


# ---------------------------------------------------------------- 4 図書館

def toshokan() -> Canvas:
    c = Canvas(W, H, "#5B3D2A")
    rnd = random.Random(4)
    books = ["#A8443A", "#3F5F9A", "#5E8C4E", "#C9963A", "#7A4A6A", "#E8DCC0", "#4E6B6B", "#B86A3A", "#2F3A66"]
    for bx0, bx1 in ((4, 50), (56, 104), (110, 156)):
        c.rect(bx0 - 2, 2, bx1 + 2, FLOOR - 1, "#6E4A33")
        c.rect(bx0, 4, bx1, FLOOR - 3, "#3E2A1E")
        for sy in range(4, FLOOR - 6, 13):
            x = bx0
            while x < bx1 - 1:
                w = rnd.choice((2, 2, 3, 3, 4))
                hgt = rnd.randint(8, 11)
                col = hexc(rnd.choice(books))
                if rnd.random() < 0.08:  # 偶尔空一格 / 斜靠
                    x += w
                    continue
                c.rect(x, sy + 12 - hgt, min(bx1, x + w - 1), sy + 11, col)
                c.rect(x, sy + 12 - hgt, x, sy + 11, mix(col, (255, 255, 255), 0.25))
                c.rect(x, sy + 14 - hgt, min(bx1, x + w - 1), sy + 14 - hgt, mix(col, (255, 230, 160), 0.5))
                x += w
            c.rect(bx0 - 2, sy + 12, bx1 + 2, sy + 13, "#8A5A3B")
            c.rect(bx0 - 2, sy + 12, bx1 + 2, sy + 12, "#A8794E")
    # 梯子（右边书架）
    c.line(128, 4, 120, FLOOR + 6, "#A8794E")
    c.line(133, 4, 126, FLOOR + 6, "#A8794E")
    for k in range(9):
        y = 8 + k * 7
        t = (y - 4) / (FLOOR + 2)
        c.line(128 - 8 * t, y, 133 - 7 * t, y, "#A8794E")
    # 吊灯和暖光
    c.line(80, 0, 80, 10, "#3E2A1E")
    c.poly([(74, 11), (86, 11), (89, 15), (71, 15)], "#4E6B40")
    c.rect(77, 15, 83, 16, "#FFE8A0")
    c.poly([(70, 16), (90, 16), (118, H - 1), (42, H - 1)], "#FFE8A0", 40)
    c.glow(80, 18, 26, "#FFE8A0", 60)
    c.speckle(56, 18, 104, 56, "#FFF6D8", 0.01, 17)
    # 地板 + 地毯
    wood_floor(c, FLOOR, "#7A5236", "#5B3D2A", 6)
    c.poly([(40, FLOOR + 8), (120, FLOOR + 8), (138, H - 4), (22, H - 4)], "#8C3A32")
    c.poly([(44, FLOOR + 10), (116, FLOOR + 10), (132, H - 6), (28, H - 6)], "#A8483E")
    c.poly([(48, FLOOR + 12), (112, FLOOR + 12), (126, H - 8), (34, H - 8)], "#8C3A32")
    c.poly([(50, FLOOR + 13), (110, FLOOR + 13), (124, H - 9), (36, H - 9)], "#A8483E")
    return c


# ---------------------------------------------------------------- 5 駄菓子屋

def dagashiya() -> Canvas:
    c = Canvas(W, H, "#C9A06A")
    for x in range(0, W, 9):
        c.rect(x, 0, x, FLOOR - 1, "#B08A5E")
    rnd = random.Random(5)
    # 上面挂着的零食
    c.line(0, 3, W - 1, 3, "#6E4A33")
    snack = ["#D8443A", "#F2C94C", "#3FA796", "#F4A6BD", "#3F7DB8", "#E9984A"]
    for x in range(6, W - 6, 7):
        col = hexc(rnd.choice(snack))
        c.rect(x, 4, x + 4, 10, col)
        c.rect(x, 4, x + 4, 4, mix(col, (255, 255, 255), 0.4))
        c.rect(x + 1, 7, x + 3, 7, "#FFFFFF")
    # 红灯笼
    for lx in (14, 146):
        c.line(lx, 3, lx, 12, "#3A2E2A")
        c.ellipse(lx + 0.5, 17, 5, 5.5, "#D8443A")
        for y in (14, 17, 20):
            c.rect(lx - 4, y, lx + 5, y, "#A82D25")
        c.rect(lx - 2, 11, lx + 3, 12, "#2B2624")
        c.rect(lx - 2, 22, lx + 3, 23, "#2B2624")
        c.glow(lx + 0.5, 17, 12, "#FFB080", 50)
    # 两层货架和糖果罐
    for sy in (20, 36):
        c.rect(24, sy + 12, 136, sy + 13, "#6E4A33")
        for jx in range(26, 134, 11):
            lid = hexc(rnd.choice(["#D8443A", "#3F7DB8", "#F2C94C", "#3FA796"]))
            c.rect(jx, sy, jx + 8, sy + 11, "#DDEBF0")
            c.rect(jx, sy, jx + 8, sy + 1, lid)
            c.rect(jx, sy + 2, jx, sy + 11, "#F4FAFC")
            c.rect(jx + 8, sy + 2, jx + 8, sy + 11, "#B5C8D0")
            for _ in range(9):
                c.px(rnd.randint(jx + 1, jx + 7), rnd.randint(sy + 5, sy + 10), rnd.choice(snack))
    # 后面的木柜台
    c.rect(0, FLOOR - 8, 22, FLOOR - 1, "#8A5A3B")
    c.rect(0, FLOOR - 8, 22, FLOOR - 8, "#B98A5E")
    c.rect(138, FLOOR - 8, W - 1, FLOOR - 1, "#8A5A3B")
    c.rect(138, FLOOR - 8, W - 1, FLOOR - 8, "#B98A5E")
    for x in (142, 148, 154):
        c.ellipse(x, FLOOR - 10, 2, 1.5, rnd.choice(snack))
    c.rect(0, FLOOR - 1, W - 1, FLOOR - 1, "#6E4A33")
    # 水泥地
    c.bands(FLOOR, H - 1, ["#A9A39A", "#B5AFA6", "#BFB9B0"])
    c.speckle(0, FLOOR, W - 1, H - 1, "#9C968D", 0.08, 6)
    c.floor_rows(FLOOR, 3, "#9C968D", power=1.5)
    c.glow(80, 30, 50, "#FFE0B0", 30)
    return c


# ---------------------------------------------------------------- 6 銭湯

def sentou() -> Canvas:
    c = Canvas(W, H, "#CFE6F0")
    # 富士山壁画
    c.bands(4, 44, ["#7FB8E6", "#9ACAEE", "#B8DAF2", "#D6EAF6"], 8, 151)
    c.poly([(80, 10), (124, 44), (36, 44)], "#4E79B5")
    c.poly([(80, 10), (90, 18), (86, 17), (83, 20), (79, 17), (75, 20), (72, 17), (70, 18)], "#FFFFFF")
    c.poly([(80, 10), (88, 16), (80, 14)], "#E4EEF8")
    c.poly([(80, 10), (124, 44), (110, 44), (80, 14)], "#3E6599", 120)
    for cx, cy, rx in ((40, 18, 12), (124, 14, 14), (30, 34, 16), (134, 32, 14)):
        c.ellipse(cx, cy, rx, rx * 0.32, "#FFFFFF")
    # 海浪
    c.rect(8, 38, 151, 44, "#3F6FA8")
    for x in range(8, 152, 8):
        c.line(x, 40, x + 4, 38, "#FFFFFF")
        c.px(x + 5, 39, "#FFFFFF")
    c.frame(7, 3, 152, 45, "#8A9BA8")
    # 墙砖
    c.rect(0, 46, W - 1, FLOOR - 1, "#F4F7F8")
    for y in range(46, FLOOR, 4):
        c.rect(0, y, W - 1, y, "#C9D7DE")
    for x in range(0, W, 6):
        c.rect(x, 46, x, FLOOR - 1, "#C9D7DE")
    for x in range(0, W, 6):
        c.rect(x, 0, x, 2, "#B5D3E2")
    c.rect(0, FLOOR - 1, W - 1, FLOOR - 1, "#8A9BA8")
    # 瓷砖地
    c.rect(0, FLOOR, W - 1, H - 1, "#DCE4E8")
    c.floor_rows(FLOOR, 6, "#B9C6CD", power=1.5)
    c.floor_lines(FLOOR, W / 2, [i * 16 - 40 for i in range(16)], "#B9C6CD")
    # 木桶和小凳
    for bx, by in ((12, 66), (22, 70)):
        c.poly([(bx, by), (bx + 10, by), (bx + 9, by + 8), (bx + 1, by + 8)], "#E9C46A")
        c.rect(bx, by, bx + 10, by, "#F7DC94")
        c.rect(bx + 1, by + 3, bx + 9, by + 3, "#C9A04A")
        c.ellipse(bx + 5, by, 5, 1.4, "#C9A04A")
    c.rect(132, 68, 150, 71, "#E9C46A")
    c.rect(132, 68, 150, 68, "#F7DC94")
    c.rect(134, 72, 136, 78, "#C9A04A")
    c.rect(146, 72, 148, 78, "#C9A04A")
    # 热气
    for cx, cy in ((30, 52), (60, 60), (100, 56), (130, 50)):
        c.ellipse(cx, cy, 10, 3, "#FFFFFF", 70)
        c.ellipse(cx + 4, cy - 3, 6, 2, "#FFFFFF", 60)
    return c


# ---------------------------------------------------------------- 7 夜桜

def yozakura() -> Canvas:
    c = Canvas(W, H, "#1E2546")
    c.bands(0, 48, ["#161B3A", "#1E2546", "#2A3160", "#3B3F7A"])
    rnd = random.Random(7)
    for _ in range(40):
        x, y = rnd.randint(0, W - 1), rnd.randint(0, 36)
        c.px(x, y, "#FFFFFF" if rnd.random() < 0.6 else "#C8D2FF")
    # 月亮
    c.glow(128, 15, 22, "#FFF2C8", 70)
    c.ellipse(128, 15, 8.5, 8.5, "#FFF6DC")
    c.ellipse(125, 13, 2, 1.6, "#EFE3C0")
    c.ellipse(131, 18, 1.6, 1.2, "#EFE3C0")
    # 对岸的山和远处的樱花
    c.poly([(0, 46), (30, 38), (60, 43), (96, 36), (130, 42), (159, 37), (159, 48), (0, 48)], "#262B50")
    for x in range(4, W, 10):
        c.ellipse(x, 44, 6, 3, "#8C5A8A")
    # 河
    c.rect(0, 48, W - 1, 59, "#1A2148")
    for y in range(49, 59, 2):
        for x in range(rnd.randint(0, 6), W, rnd.randint(9, 14)):
            c.rect(x, y, x + 2, y, "#3B4880")
    for y in range(49, 59, 2):
        c.rect(127, y, 129 + (y % 3), y, "#FFF2C8")
    # 两边的大樱花树
    def tree(cx, cy, s):
        c.rect(int(cx - 1), int(cy), int(cx + 1), 62, "#3A2A2E")
        c.line(cx, cy + 4, cx + s * 0.6, cy - 2, "#3A2A2E")
        for dx, dy, r in ((0, 0, 1.0), (-0.7, 0.2, 0.8), (0.7, 0.3, 0.8), (-0.3, -0.5, 0.75), (0.4, -0.45, 0.7)):
            c.ellipse(cx + dx * s, cy + dy * s * 0.6, s * r * 0.75, s * r * 0.5, "#E88AA8")
        for dx, dy, r in ((-0.2, -0.3, 0.6), (0.4, -0.2, 0.5), (-0.6, 0.0, 0.45)):
            c.ellipse(cx + dx * s, cy + dy * s * 0.6, s * r * 0.75, s * r * 0.45, "#F4A6BD")
        c.speckle(int(cx - s), int(cy - s * 0.6), int(cx + s), int(cy + s * 0.4), "#FDE6EE", 0.06, int(cx))
    tree(14, 20, 22)
    tree(148, 24, 20)
    # 灯笼串
    pts = [(x, 20 + 6 * math.sin(math.pi * x / W)) for x in range(0, W, 2)]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        c.line(x0, y0, x1, y1, "#2B2624")
    for x in range(8, W, 16):
        y = 20 + 6 * math.sin(math.pi * x / W)
        c.glow(x + 1, y + 4, 7, "#FFB070", 70)
        c.rect(x, int(y) + 1, x + 2, int(y) + 5, "#D8443A")
        c.rect(x, int(y) + 3, x + 2, int(y) + 3, "#F2A673")
    # 地面（石子路）
    c.bands(60, H - 1, ["#2E2B44", "#36324E", "#3E3A58"])
    c.speckle(0, 60, W - 1, H - 1, "#4A4666", 0.1, 8)
    c.floor_rows(60, 4, "#2A2740", power=1.6)
    # 花瓣：空中飘的和地上的
    for _ in range(36):
        x, y = rnd.randint(0, W - 1), rnd.randint(8, H - 1)
        c.px(x, y, "#F4A6BD" if rnd.random() < 0.7 else "#FDE6EE")
    return c


# ---------------------------------------------------------------- 8 雲の上の神社

def kumonoue() -> Canvas:
    c = Canvas(W, H)
    c.bands(0, 46, ["#5E7CC2", "#8C8ACB", "#C49ADA", "#F0A8C0", "#F7C78A", "#FBE6A0"])
    # 太阳和光芒
    c.glow(46, 46, 40, "#FFF6D8", 90)
    for ang in range(-80, 1, 16):
        a = math.radians(ang - 90)
        c.poly([(46, 46), (46 + 120 * math.cos(a - 0.05), 46 + 120 * math.sin(a - 0.05)),
                (46 + 120 * math.cos(a + 0.05), 46 + 120 * math.sin(a + 0.05))], "#FFF6D8", 45)
    c.ellipse(46, 46, 9, 9, "#FFF8E0")
    # 云海（先铺底色，云朵之间不能漏出透明）
    c.rect(0, 46, W - 1, 62, "#F1E6F2")
    rnd = random.Random(8)
    for row, y in enumerate((44, 48, 52, 57)):
        x = -10 + row * 7
        while x < W + 10:
            r = rnd.randint(7, 12)
            c.ellipse(x, y, r, r * 0.5, "#EADCF0" if row % 2 else "#F6EEF6")
            c.ellipse(x - 2, y - 2, r * 0.7, r * 0.3, "#FFFFFF")
            x += r + rnd.randint(4, 8)
    # 鸟居
    red, dk = "#D8443A", "#A82D25"
    c.rect(68, 22, 71, 62, red)
    c.rect(89, 22, 92, 62, red)
    c.rect(71, 22, 71, 62, dk)
    c.rect(92, 22, 92, 62, dk)
    c.rect(62, 16, 98, 18, red)
    c.rect(60, 14, 100, 15, "#2B2624")
    c.rect(66, 24, 94, 25, red)
    c.rect(66, 25, 94, 25, dk)
    c.rect(79, 18, 81, 24, red)
    c.rect(67, 61, 72, 62, "#2B2624")
    c.rect(88, 61, 93, 62, "#2B2624")
    # 石灯笼
    for lx in (18, 132):
        c.rect(lx, 40, lx + 10, 42, "#A9A39A")
        c.rect(lx + 2, 43, lx + 8, 48, "#BFB9B0")
        c.rect(lx + 3, 44, lx + 7, 47, "#FFE58A")
        c.glow(lx + 5, 45.5, 8, "#FFE58A", 60)
        c.rect(lx - 1, 49, lx + 11, 50, "#A9A39A")
        c.rect(lx + 3, 51, lx + 7, 60, "#B5AFA6")
        c.rect(lx, 60, lx + 10, 62, "#9C968D")
    # 石板地
    c.bands(62, H - 1, ["#C9C1B6", "#D6CFC5", "#E0DAD1"])
    c.floor_rows(62, 4, "#B5AFA6", power=1.5)
    c.floor_lines(62, W / 2, [i * 30 - 70 for i in range(11)], "#B5AFA6")
    c.rect(0, 62, W - 1, 62, "#A9A39A")
    # 金色光点
    for _ in range(26):
        x, y = rnd.randint(0, W - 1), rnd.randint(4, 70)
        c.px(x, y, "#FFF2B0")
        if rnd.random() < 0.4:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                c.px(x + dx, y + dy, "#FFF2B0", 110)
    return c


SCENES = {
    "washitsu": washitsu, "engawa": engawa, "kyoushitsu": kyoushitsu, "toshokan": toshokan,
    "dagashiya": dagashiya, "sentou": sentou, "yozakura": yozakura, "kumonoue": kumonoue,
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for k, fn in SCENES.items():
        im = fn().image()
        im.save(OUT / f"{k}.png")
        im.resize((W * 4, H * 4)).save(OUT / f"{k}_x4.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
