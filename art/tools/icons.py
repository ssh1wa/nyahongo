"""App 图标方案：32×32 像素格，放大 32 倍到 1024×1024。

运行：uv run --with pillow --no-project python -I art/tools/icons.py
输出：art/icons/<方案>.png（1024）和 art/icons/compare.png（大图 + 手机桌面大小）
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
import cats as C  # noqa: E402
from accessories import TOP, accessories, anchors, render_acc  # noqa: E402
from pixel import Canvas  # noqa: E402

N = 32
OUT = Path(__file__).resolve().parents[1] / "icons"
LINE = "#3A2E2A"

# 7 格高的「あ」和「言」，手工点的像素字
GLYPH_A = ["..#....", "######.", "..#....", "..#####", ".##.#.#", "#.#.#.#", ".#..##."]
GLYPH_KOTO = ["...#...", "#######", ".......", ".#####.", ".......", ".#####.", ".#...#.", ".#####."]


def glyph(c: Canvas, g, x0, y0, col):
    for dy, row in enumerate(g):
        for dx, ch in enumerate(row):
            if ch == "#":
                c.px(x0 + dx, y0 + dy, col)


def cat_img(cid: str, hat: str | None = None) -> Image.Image:
    bs = C.bodies()
    cat = {c.id: c for c in C.cats()}[cid]
    im = Image.new("RGBA", (N, N + TOP), (0, 0, 0, 0))
    ci = C.render(cat, bs)
    im.alpha_composite(ci, (0, TOP))
    if hat:
        acc = {a.id: a for a in accessories()}[hat]
        im.alpha_composite(render_acc(acc, anchors(bs[cat.body])), (0, 0))
    return im


def option_a() -> Canvas:
    """ことねこ：朱红底 + 白猫 + 左上角一个「言」字气泡"""
    c = Canvas(N, N, "#C8553D")
    c.checker(0, 0, N - 1, N - 1, "#BE4B34", 120)
    c.paste(cat_img("shiro").crop((0, TOP, N, N + TOP)), 1, 4)
    c.rect(1, 1, 12, 12, LINE)
    c.rect(2, 2, 11, 11, "#FFFDF8")
    c.px(4, 13, LINE); c.px(5, 13, LINE); c.px(4, 12, "#FFFDF8")
    glyph(c, GLYPH_KOTO, 3, 3, "#C8553D")
    return c


def option_b() -> Canvas:
    """精听猫：奶油底 + 戴耳机的茶トラ + 音符"""
    c = Canvas(N, N, "#F6E7C8")
    for y in range(0, N, 4):
        c.rect(0, y, N - 1, y, "#F0DDB6")
    c.paste(cat_img("chatora", "heddohon"), 0, -5)
    for x, y in ((25, 5), (26, 5), (26, 4), (26, 3), (27, 3), (25, 6), (24, 6)):
        c.px(x, y, "#3F7DB8")
    for x, y in ((3, 8), (4, 8), (4, 7), (4, 6), (5, 6), (3, 9), (2, 9)):
        c.px(x, y, "#C8553D")
    return c


def option_c() -> Canvas:
    """読み猫：藍色底 + 翻开的书 + 从书后探出头的白猫"""
    c = Canvas(N, N, "#2F5D8A")
    c.speckle(0, 0, N - 1, 18, "#E8F0FF", 0.03, 5)
    c.paste(cat_img("shiro").crop((0, TOP, N, TOP + 22)), 0, 4)
    # 书：两页 + 书脊
    c.poly([(2, 22), (15.5, 24), (15.5, 31), (2, 29)], "#FFFDF8")
    c.poly([(16.5, 24), (30, 22), (30, 29), (16.5, 31)], "#F4EEDC")
    c.line(2, 22, 15, 24, LINE); c.line(17, 24, 30, 22, LINE)
    c.line(2, 22, 2, 29, LINE); c.line(30, 22, 30, 29, LINE)
    c.line(2, 29, 15, 31, LINE); c.line(17, 31, 30, 29, LINE)
    c.rect(15, 24, 16, 31, "#8A5A3B")
    for k in range(3):
        c.line(5, 25 + k * 1.6, 12, 26 + k * 1.6, "#B5AE9C")
        c.line(19, 26 + k * 1.6, 27, 25 + k * 1.6, "#B5AE9C")
    return c


def option_d() -> Canvas:
    """にゃほんご：若竹色底 + 年糕猫 + 「あ」对话框"""
    c = Canvas(N, N, "#7FB069")
    c.ellipse(16, 34, 20, 10, "#6E9E5A")
    c.paste(cat_img("mochi" if False else "kijishiro").crop((0, TOP, N, N + TOP)), 0, 3)
    c.rect(20, 1, 30, 10, LINE)
    c.rect(21, 2, 29, 9, "#FFFDF8")
    c.px(22, 11, LINE); c.px(23, 11, LINE); c.px(23, 10, "#FFFDF8")
    glyph(c, GLYPH_A, 22, 2, "#C8553D")
    return c


def option_e() -> Canvas:
    """猫と小判：深色底 + 金色小判 + 招き猫（游戏感最强）"""
    c = Canvas(N, N, "#2E2A44")
    c.glow(16, 16, 18, "#FFE58A", 70)
    c.ellipse(16, 25.5, 12, 5.5, "#C9963A")
    c.ellipse(16, 25, 11, 4.8, "#F2C94C")
    c.rect(10, 24, 22, 24, "#FFF2B0")
    c.paste(cat_img("maneki").crop((0, TOP, N, TOP + 27)), 0, -1)
    for x, y in ((4, 4), (28, 7), (3, 19)):
        c.px(x, y, "#FFF2B0")
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c.px(x + dx, y + dy, "#FFF2B0", 120)
    return c


OPTIONS = [
    ("a_kotoneko", "A ことねこ", option_a),
    ("b_kikineko", "B 聞き猫", option_b),
    ("c_yomineko", "C 読み猫", option_c),
    ("d_nyahongo", "D にゃほんご", option_d),
    ("e_nekotokoban", "E 猫と小判", option_e),
]


def rounded(im: Image.Image, r: float = 0.22) -> Image.Image:
    m = Image.new("L", im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=int(im.width * r), fill=255)
    out = im.copy()
    out.putalpha(m)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    big = 240
    sheet = Image.new("RGB", (len(OPTIONS) * (big + 30) + 30, big + 210), (245, 241, 232))
    d = ImageDraw.Draw(sheet)
    for i, (key, title, fn) in enumerate(OPTIONS):
        im = fn().image()
        im.resize((1024, 1024), Image.NEAREST).save(OUT / f"{key}.png")
        x0 = 30 + i * (big + 30)
        r = rounded(im.resize((big, big), Image.NEAREST))
        sheet.paste(r, (x0, 24), r)
        d.text((x0 + 4, big + 32), key, fill=(91, 84, 75))
        # 桌面实际大小（约 48dp ≈ 144px）放在深色和浅色两种壁纸上
        for j, bg in enumerate(((60, 70, 90), (230, 226, 218))):
            sx = x0 + j * 110
            d.rectangle([sx, big + 56, sx + 100, big + 196], fill=bg)
            sm = rounded(im.resize((64, 64), Image.NEAREST))
            sheet.paste(sm, (sx + 18, big + 80), sm)
    sheet.save(OUT / "compare.png")
    print("saved", OUT)


if __name__ == "__main__":
    main()
