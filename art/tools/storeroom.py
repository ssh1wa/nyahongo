"""猫屋的仓库（蔵）：宝箱、小判、毛玉都放在这里。点宝箱开箱，点空的位置花小判添一个宝箱。

- storeroom_bg.png：仓库背景 160×72（木梁、白墙、腰板、木地板，不放杂物）。小判、毛玉靠墙放在右上角，前面专门堆宝箱
- store_chest.png、store_chest_big.png：后排、前排的宝箱（24×19、30×24）× 3 帧（0 静止，1 盖子上闪一下，2 轻轻跳一下），近大远小
- store_koban.png：放小判的三方（木台）32×24 × 3 帧（0 空，1 一小堆，2 堆满）
- store_yarn.png：装毛玉的竹篮 28×22 × 3 帧（0 空，1 两三个，2 装满）

位置（背景坐标）见 SPOTS、KOBAN_AT、YARN_AT，App 按同样的数字摆放。

运行：uv run --with pillow --no-project python -I art/tools/storeroom.py
输出：art/storeroom/*.png 和预览 preview_x4.png
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from pixel import Canvas, dark, hexc, mix  # noqa: E402

W, H = 160, 72
FLOOR = 30
OUT = Path(__file__).resolve().parents[1] / "storeroom"
LINE = "#3A2E2A"

CHEST_W, CHEST_H = 24, 19  # 后排的宝箱
BIG_W, BIG_H = 30, 24  # 前排的宝箱：近一点，稍微大一点
# 宝箱的位置（左上角）和大小（L 大 / S 小），按出现的顺序：先摆满前排，再往后摆。
# 后排只在左半边（右边靠墙放着小判和毛玉）
SPOTS = [
    (65, 46, "L"), (112, 44, "L"), (20, 47, "L"),
    (44, 31, "S"), (70, 29, "S"), (18, 32, "S"),
]
# 小判和毛玉靠墙放在右上角，底边贴着地板最后面一点
KOBAN_W, KOBAN_H = 32, 24
KOBAN_AT = (90, 12)
YARN_W, YARN_H = 28, 22
YARN_AT = (128, 14)


# ---------------------------------------------------------------- 背景

def background() -> Canvas:
    """干净的仓库：木梁、白墙、腰板、木地板，不放杂物"""
    c = Canvas(W, H, "#E9E1CF")
    rnd = random.Random(7)
    c.speckle(0, 6, W - 1, FLOOR - 9, "#DDD3BE", 0.05, 3)
    # 天花板的梁和两边的柱子
    c.rect(0, 0, W - 1, 4, "#4A3222")
    c.rect(0, 4, W - 1, 4, "#33231A")
    for x0 in (0, W - 5):
        c.rect(x0, 0, x0 + 4, FLOOR - 1, "#5B3D2A")
        c.rect(x0 + 1, 0, x0 + 1, FLOOR - 1, "#6E4A33")
        c.rect(x0 + 4, 0, x0 + 4, FLOOR - 1, "#3E2A1D")
    # 下半截的腰板（竖木板）
    c.rect(5, FLOOR - 9, W - 6, FLOOR - 1, "#7A5236")
    c.rect(5, FLOOR - 9, W - 6, FLOOR - 9, "#94673F")
    for x in range(9, W - 6, 7):
        c.rect(x, FLOOR - 8, x, FLOOR - 1, "#664329")
    # 木地板：越往前木板越宽
    c.bands(FLOOR, H - 1, ["#8F6440", "#9C6E47", "#A87A50"])
    rows = c.floor_rows(FLOOR, 6, "#7A5236", power=1.6)
    prev = FLOOR
    for y in rows + [H]:
        for _ in range(3):
            x = rnd.randint(8, W - 9)
            c.rect(x, prev + 1, x, y - 1, "#7A5236", 150)
        prev = y
    c.rect(0, FLOOR, W - 1, FLOOR, "#5B3D2A")
    return c


# ---------------------------------------------------------------- 小宝箱

def chest_sprite(w: int, h: int, frame: int) -> Canvas:
    """宝箱（关着），配色和开箱动画里的一样。frame：0 静止，1 盖子上闪一下，2 轻轻跳一下"""
    c = Canvas(w, h)
    body, band, trim = hexc("#A8794E"), hexc("#E0B44A"), hexc("#F2C94C")
    dy = -1 if frame == 2 else 0
    x0, x1 = 1, w - 2
    lid = max(5, round(h * 0.34))  # 盖子高度
    lt, bb = 2 + dy, h - 2 + dy
    bt = lt + lid
    bands = (x0 + round(w * 0.2), x1 - round(w * 0.2))
    # 地上的影子（跳起来时影子留在原地、变小）
    c.rect(x0 + 1 + (frame == 2), h - 1, x1 - 1 - (frame == 2), h - 1, "#2B2016", 90)
    # 箱体
    c.rect(x0, bt, x1, bb, LINE)
    c.rect(x0 + 1, bt + 1, x1 - 1, bb - 1, body)
    c.rect(x0 + 1, bt + 1, x0 + 1, bb - 1, mix(body, (255, 255, 240), 0.25))
    c.rect(x1 - 1, bt + 1, x1 - 1, bb - 1, dark(body, 0.8))
    c.rect(x0 + 1, bb - 1, x1 - 1, bb - 1, dark(body, 0.75))
    for bx in bands:
        c.rect(bx, bt + 1, bx, bb - 1, band)
    # 盖子（上面圆一点）
    c.rect(x0, lt + 1, x1, bt, LINE)
    c.rect(x0 + 1, lt, x1 - 1, lt, LINE)
    c.rect(x0 + 1, lt + 1, x1 - 1, bt - 1, body)
    c.rect(x0 + 2, lt + 1, x1 - 2, lt + 1, mix(body, (255, 255, 240), 0.35))
    for bx in bands:
        c.rect(bx, lt + 1, bx, bt - 1, band)
    c.rect(x0 + 1, bt - 1, x1 - 1, bt - 1, trim)
    # 锁扣
    cx = (x0 + x1) // 2
    c.rect(cx - 1, bt - 2, cx + 2, bt + 2, LINE)
    c.rect(cx, bt - 1, cx + 1, bt + 1, trim)
    if frame == 1:
        sx, sy = bands[0], lt + 1
        c.px(sx, sy, "#FFFFFF")
        for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c.px(sx + ddx, sy + ddy, "#FFF6D8", 220)
    return c


def small_chest(frame: int) -> Canvas:
    return chest_sprite(CHEST_W, CHEST_H, frame)


def big_chest(frame: int) -> Canvas:
    return chest_sprite(BIG_W, BIG_H, frame)


# ---------------------------------------------------------------- 小判

def koban(level: int) -> Canvas:
    """三方（木台）上放小判。level：0 空，1 一小堆，2 堆满"""
    c = Canvas(KOBAN_W, KOBAN_H)
    wood, rim = hexc("#C9A06A"), hexc("#B08A5E")
    # 台子：上面的托盘 + 下面带孔的底座
    c.rect(4, 15, 27, 16, LINE)
    c.rect(5, 14, 26, 15, wood)
    c.rect(5, 14, 26, 14, mix(wood, (255, 245, 225), 0.35))
    c.rect(3, 16, 28, 17, LINE)
    c.rect(4, 16, 27, 16, rim)
    c.rect(8, 18, 23, KOBAN_H - 1, LINE)
    c.rect(9, 18, 22, KOBAN_H - 2, wood)
    c.rect(9, 18, 9, KOBAN_H - 2, mix(wood, (255, 245, 225), 0.3))
    c.ellipse(15.5, 20.5, 2, 1.5, "#6E4A33")
    gold, light, shade = hexc("#F2C94C"), hexc("#FFF2B0"), hexc("#C9963A")

    def coin(x: int, y: int):
        # 小判：横着的椭圆金币，中间一道竖纹
        c.ellipse(x + 2.5, y + 1.5, 3.2, 2.2, LINE)
        c.ellipse(x + 2.5, y + 1.5, 2.5, 1.5, gold)
        c.px(x + 1, y + 1, light)
        c.px(x + 2, y + 1, light)
        c.rect(x + 3, y + 1, x + 3, y + 2, shade)

    piles = {
        0: [],
        1: [(9, 11), (15, 11), (12, 9)],
        2: [(6, 11), (11, 11), (16, 11), (21, 11), (8, 8), (13, 8), (18, 8), (11, 5), (16, 5), (13, 2)],
    }[level]
    for x, y in piles:
        coin(x, y)
    if level == 2:
        c.px(26, 3, "#FFFFFF")
        for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c.px(26 + ddx, 3 + ddy, "#FFF2B0", 200)
    return c


# ---------------------------------------------------------------- 毛玉

def yarn(level: int) -> Canvas:
    """竹篮装毛玉。level：0 空，1 两三个，2 装满"""
    c = Canvas(YARN_W, YARN_H)
    balls = {
        0: [],
        1: [(9, 10, "#E86A8A"), (17, 11, "#6FA8DC")],
        2: [(6, 10, "#E86A8A"), (13, 9, "#6FA8DC"), (20, 10, "#F2C94C"), (10, 5, "#8BC48A"), (17, 5, "#C79BE0")],
    }[level]
    # 先画篮子后面的边，再画毛玉，最后画篮子前面
    c.rect(2, 9, YARN_W - 3, 10, "#8A6A3E")
    for bx, by, col in balls:
        col = hexc(col)
        c.ellipse(bx + 0.5, by + 0.5, 4.2, 4.2, LINE)
        c.ellipse(bx + 0.5, by + 0.5, 3.5, 3.5, col)
        c.line(bx - 2, by - 1, bx + 2, by + 2, dark(col, 0.8))
        c.line(bx - 1, by - 3, bx + 2, by, dark(col, 0.8))
        c.px(bx - 1, by - 1, mix(col, (255, 255, 255), 0.5))
    straw, straw_d = hexc("#C9A86A"), hexc("#A8874E")
    c.poly([(1, 11), (YARN_W - 2, 11), (YARN_W - 4, YARN_H - 2), (3, YARN_H - 2)], LINE)
    c.poly([(2, 12), (YARN_W - 3, 12), (YARN_W - 5, YARN_H - 3), (4, YARN_H - 3)], straw)
    for y in range(13, YARN_H - 2, 2):
        c.rect(3, y, YARN_W - 4, y, straw_d)
    for x in range(5, YARN_W - 4, 3):
        c.rect(x, 12, x, YARN_H - 3, straw_d, 150)
    c.rect(1, 11, YARN_W - 2, 11, "#E0C58C")
    c.rect(4, YARN_H - 1, YARN_W - 5, YARN_H - 1, "#2B2016", 90)
    return c


def sheet(frames: list[Canvas]) -> Image.Image:
    w, h = frames[0].w, frames[0].h
    im = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        im.paste(f.image(), (i * w, 0))
    return im


def sheets() -> dict[str, Image.Image]:
    return {
        "storeroom_bg": background().image(),
        "store_chest": sheet([small_chest(i) for i in range(3)]),
        "store_chest_big": sheet([big_chest(i) for i in range(3)]),
        "store_koban": sheet([koban(i) for i in range(3)]),
        "store_yarn": sheet([yarn(i) for i in range(3)]),
    }


def preview(n_chests: int, koban_level: int, yarn_level: int) -> Image.Image:
    im = background().image()
    im.alpha_composite(koban(koban_level).image(), KOBAN_AT)
    im.alpha_composite(yarn(yarn_level).image(), YARN_AT)
    small, big = small_chest(0).image(), big_chest(0).image()
    # 后面的先画
    for (sx, sy, size) in sorted(SPOTS[:n_chests], key=lambda p: p[1]):
        im.alpha_composite(big if size == "L" else small, (sx, sy))
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for k, im in sheets().items():
        im.save(OUT / f"{k}.png")
    shots = [preview(0, 0, 0), preview(3, 1, 1), preview(6, 2, 2)]
    full = Image.new("RGBA", (W * 4, (H * 4 + 8) * len(shots)), (40, 34, 30, 255))
    for i, s in enumerate(shots):
        full.paste(s.resize((W * 4, H * 4), Image.NEAREST), (0, i * (H * 4 + 8)))
    full.save(OUT / "preview_x4.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
