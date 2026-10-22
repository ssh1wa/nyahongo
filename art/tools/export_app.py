"""把美术导出成 App 用的素材，并生成 app/src/game/spriteData.ts（素材 require 表 + 帧数据）。

- cats/<id>.png：这只猫全部动画帧，48×40 一格，8 列
- portraits.png：24 只猫的立绘（32×32 一格）
- hats_<体型>.png：24 件饰品戴在这种体型上的图层（32×40 一格，比猫多上方 8 行）
- furniture.png：8 件家具（32×32 一格）
- scenes/<id>.png：8 个场景（160×96）
- storeroom_bg.png、store_*.png：仓库（放宝箱、小判、毛玉），见 storeroom.py

运行：uv run --with pillow --no-project python -I art/tools/export_app.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import anim as A  # noqa: E402
import cats as C  # noqa: E402
from accessories import H as ACC_H, TOP as ACC_TOP, accessories, anchors, render_acc  # noqa: E402
from furniture import items as furniture_items, paint as paint_furniture  # noqa: E402
from scenes import SCENES  # noqa: E402
from chests import STYLE as CHEST_STYLE, frame as chest_frame  # noqa: E402
import storeroom as ST  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "app" / "assets" / "game"
TS = ROOT / "app" / "src" / "game" / "spriteData.ts"
COLS = 8


def main():
    (ASSETS / "cats").mkdir(parents=True, exist_ok=True)
    (ASSETS / "scenes").mkdir(parents=True, exist_ok=True)
    TS.parent.mkdir(parents=True, exist_ok=True)
    bs = C.bodies()
    A.setup(bs)
    cats = C.cats()
    accs = accessories()

    # ---- 猫的动画帧
    anim_index: dict[str, list[int]] = {}
    head: dict[str, list[list[int]]] = {}
    frame_count = 0
    for cat in cats:
        b = copy.copy(bs[cat.body])
        if cat.extra_tail:
            A.cat_extra_tail[cat.body] = cat.extra_tail
        r = A.rig_of(b)
        an = A.animations(r)
        A.cat_extra_tail.pop(cat.body, None)
        frames = [fr for name in an for fr in an[name]]
        if not anim_index:
            i = 0
            for name, frs in an.items():
                anim_index[name] = list(range(i, i + len(frs)))
                i += len(frs)
            frame_count = i
        head.setdefault(cat.body, [list(fr.head) for fr in frames])
        rows = (len(frames) + COLS - 1) // COLS
        sheet = Image.new("RGBA", (COLS * A.W, rows * A.H), (0, 0, 0, 0))
        for k, fr in enumerate(frames):
            sheet.paste(A.paint(fr, cat, b, 0), ((k % COLS) * A.W, (k // COLS) * A.H))
        sheet.save(ASSETS / "cats" / f"{cat.id}.png", optimize=True)

    # ---- 立绘
    por = Image.new("RGBA", (len(cats) * C.N, C.N), (0, 0, 0, 0))
    for i, cat in enumerate(cats):
        por.paste(C.render(cat, bs), (i * C.N, 0))
    por.save(ASSETS / "portraits.png", optimize=True)

    # ---- 饰品（每种体型一张）
    for key, b in bs.items():
        a = anchors(b)
        sheet = Image.new("RGBA", (len(accs) * C.N, ACC_H), (0, 0, 0, 0))
        for i, acc in enumerate(accs):
            sheet.paste(render_acc(acc, a), (i * C.N, 0))
        sheet.save(ASSETS / f"hats_{key}.png", optimize=True)

    # ---- 家具和场景
    fits = furniture_items()
    fsheet = Image.new("RGBA", (len(fits) * 32, 32), (0, 0, 0, 0))
    for i, it in enumerate(fits):
        fsheet.paste(paint_furniture(it), (i * 32, 0))
    fsheet.save(ASSETS / "furniture.png", optimize=True)
    for k, fn in SCENES.items():
        fn().image().save(ASSETS / "scenes" / f"{k}.png", optimize=True)
    for r in CHEST_STYLE:
        sheet = Image.new("RGBA", (64 * 12, 64), (0, 0, 0, 0))
        for i in range(12):
            sheet.paste(chest_frame(r, i).image(), (i * 64, 0))
        sheet.save(ASSETS / f"chest_{r}.png", optimize=True)
    for k, im in ST.sheets().items():
        im.save(ASSETS / f"{k}.png", optimize=True)

    # ---- sprites.ts
    meta = {
        "frame": {"w": A.W, "h": A.H, "cols": COLS, "count": frame_count, "ox": A.OX, "oy": A.OY},
        "anims": anim_index,
        "head": head,
        "hatTop": ACC_TOP,
        "cats": {c.id: {"body": c.body, "index": i} for i, c in enumerate(cats)},
        "hats": [a.id for a in accs],
        "furniture": [it.id for it in fits],
        "scenes": list(SCENES),
        # 家具的占地（不透明像素的左右范围），猫走动时用来避让
        "furnitureFoot": {it.id: foot(paint_furniture(it)) for it in fits},
        # 仓库：背景大小、宝箱位置（左上角）、小判和毛玉的位置
        "store": {
            "w": ST.W, "h": ST.H, "floor": ST.FLOOR, "chest": [ST.CHEST_W, ST.CHEST_H], "big": [ST.BIG_W, ST.BIG_H], "spots": ST.SPOTS,
            "koban": [*ST.KOBAN_AT, ST.KOBAN_W, ST.KOBAN_H], "yarn": [*ST.YARN_AT, ST.YARN_W, ST.YARN_H],
        },
    }
    lines = [
        "// 由 art/tools/export_app.py 生成，不要手改。",
        "/* eslint-disable */",
        "",
        f"export const SPRITE_META = {json.dumps(meta, ensure_ascii=False)} as const;",
        "",
        "export const CAT_SHEETS: Record<string, number> = {",
        *[f"  {c.id}: require('../../assets/game/cats/{c.id}.png')," for c in cats],
        "};",
        "",
        "export const HAT_SHEETS: Record<string, number> = {",
        *[f"  {k}: require('../../assets/game/hats_{k}.png')," for k in bs],
        "};",
        "",
        "export const SCENE_IMAGES: Record<string, number> = {",
        *[f"  {k}: require('../../assets/game/scenes/{k}.png')," for k in SCENES],
        "};",
        "",
        "export const CHEST_SHEETS: Record<string, number> = {",
        *[f"  {r}: require('../../assets/game/chest_{r}.png')," for r in CHEST_STYLE],
        "};",
        "",
        "export const PORTRAITS = require('../../assets/game/portraits.png');",
        "export const FURNITURE = require('../../assets/game/furniture.png');",
        "export const STORE_IMAGES = {",
        *[f"  {k}: require('../../assets/game/{k}.png')," for k in ST.sheets()],
        "};",
        "",
    ]
    TS.write_text("\n".join(lines), encoding="utf-8")
    print("frames per cat:", frame_count, "->", ASSETS)


def foot(im: Image.Image) -> list[int]:
    px = im.load()
    xs = [x for x in range(im.width) for y in range(im.height) if px[x, y][3] > 200]
    return [min(xs), max(xs)] if xs else [0, im.width - 1]


if __name__ == "__main__":
    main()
