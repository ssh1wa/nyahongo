"""开箱动画：4 种稀有度各一套 12 帧（64×64）。只有一种宝箱（木箱金边），抽到什么开箱前就定了，
稀有度只靠效果表现：晃到最后两下时盖缝透出的光色、打开时的光柱 / 光芒 / 粒子，越稀有越华丽。

帧：0 静止，1 预备（往上一跳），2~5 晃动（越晃越厉害，5 盖子缝里漏光），6 盖子掀开一点、强光，7 打开、光柱，
8~11 光芒循环（翻出结果卡时一直在背后转）。App 按稀有度决定晃几次（越稀有越久）。

运行：uv run --with pillow --no-project python -I art/tools/chests.py
输出：art/chests/<稀有度>.png（12 帧横排）和 preview.gif
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from pixel import Canvas, dark, hexc, mix  # noqa: E402

S = 64
OUT = Path(__file__).resolve().parents[1] / "chests"
LINE = "#3A2E2A"

BOX = dict(body="#A8794E", band="#E0B44A", trim="#F2C94C", lock="#F2C94C", gems=None)
STYLE = {
    "common": dict(BOX, light="#FFF6D8", glow=None, rays=6),
    "rare": dict(BOX, light="#9ED8FF", glow="#9ED8FF", rays=8),
    "epic": dict(BOX, light="#E0C2FF", glow="#C9A9E0", rays=10),
    "legendary": dict(BOX, light="#FFE58A", glow="#FFE58A", rays=16),
}

X0, X1 = 17, 46  # 箱体左右
BODY_TOP, BOTTOM = 39, 56
LID_TOP = 31


def sparkle(c: Canvas, x: int, y: int, col: str, big: bool = False):
    c.px(x, y, "#FFFFFF")
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        c.px(x + dx, y + dy, col, 230)
    if big:
        for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            c.px(x + dx, y + dy, col, 120)


def rays(c: Canvas, cx: float, cy: float, n: int, phase: float, col: str, length: float, alpha: int):
    for i in range(n):
        a = 2 * math.pi * (i / n) + phase
        w = 0.09 if n <= 8 else 0.06
        c.poly([(cx, cy), (cx + length * math.cos(a - w), cy + length * math.sin(a - w)), (cx + length * math.cos(a + w), cy + length * math.sin(a + w))], col, alpha)


def chest(c: Canvas, st: dict, dx: int = 0, dy: int = 0, lid: int = 0, rarity: str = "common"):
    """lid：0 关着，1~3 掀开一条缝，4 完全打开"""
    body, band, trim = hexc(st["body"]), hexc(st["band"]), hexc(st["trim"])
    x0, x1 = X0 + dx, X1 + dx
    bt, bb = BODY_TOP + dy, BOTTOM + dy
    # 打开时盖子在后面（先画），看到内侧
    if lid >= 4:
        lt = LID_TOP - 7 + dy
        c.rect(x0 + 1, lt, x1 - 1, bt - 6, dark(body, 0.55))
        c.rect(x0 + 1, lt, x1 - 1, lt + 1, trim)
        c.frame(x0, lt - 1, x1, bt - 5, LINE)
        c.rect(x0 + 1, bt - 3, x1 - 1, bt, "#2B2016")
        c.rect(x0 + 3, bt - 3, x1 - 3, bt - 1, st["light"])
    # 箱体
    c.rect(x0, bt, x1, bb, LINE)
    c.rect(x0 + 1, bt + 1, x1 - 1, bb - 1, body)
    c.rect(x0 + 1, bt + 1, x0 + 1, bb - 1, mix(body, (255, 255, 240), 0.25))
    c.rect(x1 - 2, bt + 1, x1 - 1, bb - 1, dark(body, 0.8))
    c.rect(x0 + 1, bb - 2, x1 - 1, bb - 1, dark(body, 0.75))
    for bx in (x0 + 5, x1 - 6):
        c.rect(bx, bt + 1, bx + 1, bb - 1, band)
    c.rect(x0 + 1, bb - 4, x1 - 1, bb - 4, dark(band, 0.85))
    # 盖子（关着或掀开一点）
    if lid < 4:
        lift = (0, 1, 2, 3)[lid]
        lt, lb = LID_TOP + dy - lift, bt - lift
        if lift:
            c.rect(x0 + 1, lb, x1 - 1, bt, st["light"])
            c.rect(x0 - 3, bt - 1, x1 + 3, bt, st["light"], 120)
        c.rect(x0, lt + 2, x1, lb, LINE)
        c.rect(x0 + 2, lt, x1 - 2, lt + 2, LINE)
        c.rect(x0 + 1, lt + 1, x1 - 1, lb - 1, body)
        c.rect(x0 + 3, lt + 1, x1 - 3, lt + 1, mix(body, (255, 255, 240), 0.35))
        c.rect(x0 + 1, lb - 1, x1 - 1, lb - 1, dark(body, 0.75))
        for bx in (x0 + 5, x1 - 6):
            c.rect(bx, lt + 1, bx + 1, lb - 1, band)
        c.rect(x0 + 1, lb - 2, x1 - 1, lb - 2, trim)
        # 锁扣
        cx = (x0 + x1) // 2
        c.rect(cx - 2, lb - 2, cx + 2, lb + 3, LINE)
        c.rect(cx - 1, lb - 1, cx + 1, lb + 2, st["lock"])
        c.px(cx, lb + 1, LINE)
        if st["gems"]:
            c.px(x0 + 2, lt + 4, st["gems"])
            c.px(x1 - 2, lt + 4, st["gems"])
            c.px(cx, lt + 2, st["gems"])


def frame(rarity: str, i: int) -> Canvas:
    st = STYLE[rarity]
    c = Canvas(S, S)
    rnd = random.Random(i * 31 + len(rarity))
    cx, cy = 31.5, BODY_TOP - 1
    shake = {"common": 1, "rare": 1, "epic": 2, "legendary": 2}[rarity]
    # 只在最后两下晃动时透出一点稀有度的颜色（前面都一样，不剧透）
    if st["glow"] and 4 <= i <= 5:
        c.glow(cx, 44, 24 + (i % 2) * 3, st["glow"], {"rare": 35, "epic": 55, "legendary": 80}[rarity])
    if i == 0:
        chest(c, st, rarity=rarity)
    elif i == 1:
        chest(c, st, dy=-1, rarity=rarity)
    elif 2 <= i <= 5:
        dx = (-shake, shake, -shake - 1, shake + 1)[i - 2]
        chest(c, st, dx=dx, lid=1 if i >= 4 and rarity != "common" else 1 if i == 5 else 0, rarity=rarity)
        if i >= 4 and rarity in ("epic", "legendary"):
            for _ in range(2):
                sparkle(c, rnd.randint(8, 56), rnd.randint(18, 50), st["light"])
    elif i == 6:
        c.glow(cx, cy, 30, st["light"], 120)
        rays(c, cx, cy, st["rays"], 0.2, st["light"], 34, 90)
        chest(c, st, lid=3, rarity=rarity)
    else:
        # 打开：光柱 + 旋转的光芒 + 闪光
        ph = (i - 7) * (math.pi / st["rays"]) * 0.5
        c.glow(cx, cy, 34, st["light"], 130 if rarity != "common" else 90)
        rays(c, cx, cy, st["rays"], ph, st["light"], 40, 110 if rarity != "common" else 70)
        for k, a in ((9, 70), (6, 120), (3, 200)):
            c.rect(int(cx - k), 0, int(cx + k), int(cy), st["light"], a)
        chest(c, st, lid=4, rarity=rarity)
        n = {"common": 2, "rare": 4, "epic": 6, "legendary": 9}[rarity]
        for _ in range(n):
            sparkle(c, rnd.randint(4, 59), rnd.randint(2, 54), st["light"], big=rarity == "legendary")
        if rarity == "legendary":
            # 飞起来的小判
            for k in range(4):
                x = int(cx + (k - 1.5) * 9 + math.sin(i + k) * 2)
                y = int(cy - 6 - ((i - 7) * 5 + k * 7) % 28)
                c.rect(x, y, x + 2, y + 1, "#F2C94C")
                c.px(x, y, "#FFF2B0")
                c.px(x + 2, y + 1, "#C9963A")
    return c


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sheets = {}
    for r in STYLE:
        sheet = Image.new("RGBA", (S * 12, S), (0, 0, 0, 0))
        for i in range(12):
            sheet.paste(frame(r, i).image(), (i * S, 0))
        sheet.save(OUT / f"{r}.png")
        sheets[r] = sheet
    # 预览：四种并排，按 App 的节奏播放
    seq = {
        "common": [0, 0, 0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 8, 9, 10, 11],
        "rare": [0, 0, 1, 2, 3, 2, 3, 5, 6, 7, 8, 9, 10, 11, 8, 9, 10],
        "epic": [0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 10, 11, 8],
        "legendary": [0, 1, 0, 1, 2, 3, 4, 5, 4, 5, 4, 5, 6, 6, 7, 8, 9],
    }
    n = max(len(v) for v in seq.values()) + 6
    scale = 4
    frames = []
    for t in range(n):
        im = Image.new("RGB", (4 * (S * scale + 10) + 10, S * scale + 20), (40, 34, 30))
        for j, r in enumerate(STYLE):
            s = seq[r]
            k = s[min(t, len(s) - 1)] if t < len(s) else (8 + (t - len(s)) % 4)
            f = sheets[r].crop((k * S, 0, (k + 1) * S, S)).resize((S * scale, S * scale), Image.NEAREST)
            im.paste(f, (10 + j * (S * scale + 10), 10), f)
        frames.append(im)
    frames[0].save(OUT / "preview.gif", save_all=True, append_images=frames[1:], duration=110, loop=0)
    ImageDraw.Draw(frames[-1])
    frames[9].save(OUT / "preview_open.png")
    frames[3].save(OUT / "preview_closed.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
