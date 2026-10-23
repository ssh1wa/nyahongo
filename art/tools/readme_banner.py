"""README 头图：左边像素图书馆里两只猫（一只戴眼镜读书，一只戴耳机听），右边标题和功能标签。

运行：uv run --with pillow --no-project python -I art/tools/readme_banner.py
输出：docs/banner.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import cats as C  # noqa: E402
from accessories import TOP, accessories, anchors, render_acc  # noqa: E402

ART = Path(__file__).resolve().parents[1]
OUT = ART.parent / "docs" / "banner.png"
FONTS = Path("C:/Windows/Fonts")

W, H = 1280, 400
SC = 4  # 场景 160×96 放大 4 倍
PAD = 8
BG = (251, 245, 233)
INK = (74, 52, 38)
SUB = (140, 108, 84)
# 功能标签：文字、底色
CHIPS = [("精听", (255, 222, 196)), ("精读", (214, 234, 210)), ("查词", (212, 226, 245)),
         ("复习", (243, 220, 236)), ("猫屋", (250, 232, 178))]
# 两只猫：猫、饰品、在场景里的位置
PAIR = [("shamu", "megane", (52, 60)), ("kafeore", "heddohon", (84, 60))]


def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def scene() -> Image.Image:
    bs = C.bodies()
    cats = {c.id: c for c in C.cats()}
    accs = {a.id: a for a in accessories()}
    room = Image.open(ART / "scenes" / "toshokan.png").convert("RGBA")
    for fid, fx, fy in (("hondana", 118, 58), ("chouchin", 14, 60)):
        room.alpha_composite(Image.open(ART / "furniture" / f"{fid}.png"), (fx, fy))
    for cid, aid, (x, y) in PAIR:
        cat = cats[cid]
        room.alpha_composite(C.render(cat, bs), (x, y))
        room.alpha_composite(render_acc(accs[aid], anchors(bs[cat.body])), (x, y - TOP))
    return room.resize((room.width * SC, room.height * SC), Image.NEAREST)


def main():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    card = Image.new("RGBA", (W, H), BG + (255,))
    img.paste(card, (0, 0), rounded_mask((W, H), 32))
    pic = scene()
    img.paste(pic, (PAD, PAD), rounded_mask(pic.size, 26))

    d = ImageDraw.Draw(img)
    x0 = PAD + pic.width + 56
    title = ImageFont.truetype(str(FONTS / "YuGothB.ttc"), 104)
    sub = ImageFont.truetype(str(FONTS / "msyhbd.ttc"), 34)
    chip = ImageFont.truetype(str(FONTS / "msyhbd.ttc"), 26)
    small = ImageFont.truetype(str(FONTS / "msyh.ttc"), 22)
    d.text((x0 - 6, 62), "にゃほんご", font=title, fill=INK)
    d.text((x0, 196), "和猫猫一起，看剧读书学日语", font=sub, fill=SUB)
    cx, cy = x0, 266
    for text, color in CHIPS:
        tw = d.textlength(text, font=chip)
        d.rounded_rectangle((cx, cy, cx + tw + 36, cy + 48), 24, fill=color)
        d.text((cx + 18, cy + 7), text, font=chip, fill=INK)
        cx += tw + 36 + 12
    d.text((x0, 340), "PC 处理视频 → 手机逐句精听 · 离线词典 · AI 讲解", font=small, fill=SUB)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print("saved", OUT)


if __name__ == "__main__":
    main()
