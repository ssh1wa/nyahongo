"""房间合成预览：每个场景放一只猫（戴饰品）和两件家具，检查比例和构图。

运行：uv run --with pillow --no-project python -I art/tools/room_preview.py
输出：art/room_preview.png
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import cats as C  # noqa: E402
from accessories import TOP, accessories, anchors, render_acc  # noqa: E402

ART = Path(__file__).resolve().parents[1]
W, H = 160, 96

ROOMS = [
    ("washitsu", "shiro", "hachimaki", ("zabuton", 18, 64), ("chabudai", 112, 62)),
    ("engawa", "chatora", "mugiwara", ("bonsai", 16, 60), ("zabuton", 116, 64)),
    ("kyoushitsu", "kuro", "gakubou", ("hondana", 12, 58), ("chabudai", 118, 62)),
    ("toshokan", "shamu", "megane", ("hondana", 118, 58), ("chouchin", 14, 60)),
    ("dagashiya", "mike", "ribon", ("kotatsu", 112, 62), ("chouchin", 16, 60)),
    ("sentou", "sabatora", "tenugui", ("kingyobachi", 120, 60), ("zabuton", 14, 64)),
    ("yozakura", "sakura", "kamikazari", ("chouchin", 18, 62), ("bonsai", 116, 62)),
    ("kumonoue", "kinmaneki", "inari", ("kinbyoubu", 14, 60), ("kingyobachi", 120, 62)),
]


def main():
    bs = C.bodies()
    cats = {c.id: c for c in C.cats()}
    accs = {a.id: a for a in accessories()}
    sc, gap = 3, 10
    sheet = Image.new("RGB", (2 * (W * sc + gap) + gap, 4 * (H * sc + gap) + gap), (245, 241, 232))
    for i, (scene, cid, aid, *furn) in enumerate(ROOMS):
        room = Image.open(ART / "scenes" / f"{scene}.png").convert("RGBA")
        for fid, fx, fy in furn:
            f = Image.open(ART / "furniture" / f"{fid}.png")
            room.alpha_composite(f, (fx, fy))
        cat = cats[cid]
        b = bs[cat.body]
        ci = C.render(cat, bs)
        x0, y0 = 64, 60
        room.alpha_composite(ci, (x0, y0))
        hat = render_acc(accs[aid], anchors(b))
        room.alpha_composite(hat, (x0, y0 - TOP))
        sheet.paste(room.resize((W * sc, H * sc), Image.NEAREST), (gap + (i % 2) * (W * sc + gap), gap + (i // 2) * (H * sc + gap)))
    sheet.save(ART / "room_preview.png")
    print("saved", ART / "room_preview.png")


if __name__ == "__main__":
    main()
