"""にゃほんご 的 App 图标：朱红底 + 白猫 + 写着「にゃ」的对话框。

猫和对话框是 32×32 的像素画；对话框里的字用 BIZ UDゴシック 不抗锯齿栅格化，像素比猫更细，但同样是清晰的硬边。
输出 app/assets/ 下的：icon.png、安卓自适应图标三层（前景 / 背景 / 单色）、启动图 splash-icon.png。

运行：uv run --with pillow --no-project python -I art/tools/app_icon.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import cats as C  # noqa: E402
from pixel import Canvas  # noqa: E402

N = 32
ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "app" / "assets"
PREVIEW = ROOT / "art" / "icons"
FONT = r"C:\Windows\Fonts\BIZ-UDGothicB.ttc"
TEXT = "にゃ"
RED, RED2 = "#C8553D", "#BE4B34"
LINE = "#3A2E2A"
# 对话框内部（32 格坐标，含边界）
BUBBLE = (1, 1, 13, 12)


def content() -> Canvas:
    """透明底：猫 + 对话框（不含字）"""
    c = Canvas(N, N)
    bs = C.bodies()
    cat = {k.id: k for k in C.cats()}["shiro"]
    c.paste(C.render(cat, bs), 3, 4)
    x0, y0, x1, y1 = BUBBLE
    c.rect(x0, y0, x1, y1, LINE)
    c.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, "#FFFDF8")
    # 对话框的小尾巴指向猫
    c.px(x0 + 4, y1 + 1, LINE); c.px(x0 + 5, y1 + 1, LINE); c.px(x0 + 6, y1 + 1, LINE)
    c.px(x0 + 5, y1, "#FFFDF8"); c.px(x0 + 4, y1, "#FFFDF8")
    c.px(x0 + 5, y1 + 2, LINE)
    return c


def background() -> Canvas:
    c = Canvas(N, N, RED)
    c.checker(0, 0, N - 1, N - 1, RED2, 120)
    return c


def text_layer(cell: int) -> Image.Image:
    """把「にゃ」不抗锯齿地画出来，放大到正好塞进对话框内部（cell 是每个 32 格像素的边长）"""
    x0, y0, x1, y1 = BUBBLE
    inner_w, inner_h = (x1 - x0 - 1) * cell, (y1 - y0 - 1) * cell
    # 用较小字号画出来再整体放大：笔画够粗，缩到桌面大小也认得出
    font = ImageFont.truetype(FONT, 20)
    l, t, r, bb = font.getbbox(TEXT)
    w, h = r - l + 4, bb - t + 4
    small = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(small)
    d.fontmode = "1"  # 不抗锯齿：硬边像素字
    d.text((1 - l, 1 - t), TEXT, font=font, fill=255, stroke_width=1, stroke_fill=255)  # 描一圈加粗，字形比膨胀更完整
    # 20px + 1 像素描边，缩到桌面大小笔画也不会断
    small = small.point(lambda v: 255 if v > 127 else 0)  # 描边会带一点抗锯齿，二值化成硬边
    k = int(min(inner_w * 0.9 // w, inner_h * 0.8 // h))
    big = small.resize((w * k, h * k), Image.NEAREST)
    layer = Image.new("RGBA", (N * cell, N * cell), (0, 0, 0, 0))
    color = Image.new("RGBA", big.size, (200, 85, 61, 255))
    ox = (x0 + 1) * cell + (inner_w - big.width) // 2
    oy = (y0 + 1) * cell + (inner_h - big.height) // 2
    layer.paste(color, (ox, oy), big)
    return layer


def render(cell: int, with_bg: bool) -> Image.Image:
    base = Image.new("RGBA", (N * cell, N * cell), (0, 0, 0, 0))
    if with_bg:
        base.alpha_composite(background().image().resize((N * cell, N * cell), Image.NEAREST))
    base.alpha_composite(content().image().resize((N * cell, N * cell), Image.NEAREST))
    base.alpha_composite(text_layer(cell))
    return base


def padded(cell: int, total: int) -> Image.Image:
    """自适应图标前景：内容缩小放在中间，外圈留给系统裁成圆形 / 圆角"""
    im = render(cell, False)
    out = Image.new("RGBA", (total, total), (0, 0, 0, 0))
    out.alpha_composite(im, ((total - im.width) // 2, (total - im.height) // 2))
    return out


def main():
    PREVIEW.mkdir(parents=True, exist_ok=True)
    # 普通图标和自适应图标用同一个构图：背景铺满，猫和对话框缩小放中间
    full = Image.alpha_composite(background().image().resize((1024, 1024), Image.NEAREST), padded(26, 1024))
    full.convert("RGB").save(ASSETS / "icon.png")
    full.save(PREVIEW / "nyahongo.png")
    # 自适应图标：系统只显示中间约 66%，内容按 18 倍放大（576px）放在 1024 中间
    fg = padded(18, 1024)  # 有的桌面（小米）会把图标放大裁切，留宽一点
    fg.save(ASSETS / "android-icon-foreground.png")
    background().image().resize((1024, 1024), Image.NEAREST).save(ASSETS / "android-icon-background.png")
    alpha = fg.split()[3]
    mono = Image.new("RGBA", fg.size, (255, 255, 255, 0))
    mono.putalpha(alpha)
    mono.save(ASSETS / "android-icon-monochrome.png")
    padded(16, 512).save(ASSETS / "splash-icon.png")
    # 预览：圆形 / 圆角裁剪和桌面大小
    prev = Image.new("RGB", (1024 + 360, 1024), (245, 241, 232))
    prev.paste(full.convert("RGB"), (0, 0))
    bgfull = background().image().resize((1024, 1024), Image.NEAREST)
    adaptive = Image.alpha_composite(bgfull, fg)
    for i, r in enumerate((0.5, 0.22)):
        m = Image.new("L", (1024, 1024), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, 1023, 1023], radius=int(1024 * r), fill=255)
        a = adaptive.copy(); a.putalpha(m)
        sm = a.resize((300, 300), Image.LANCZOS)
        prev.paste(sm, (1044, 30 + i * 330), sm)
        tiny = a.resize((96, 96), Image.LANCZOS)
        prev.paste(tiny, (1044 + 102, 700 + i * 140), tiny)
    prev.save(PREVIEW / "nyahongo_preview.png")
    print("saved")


if __name__ == "__main__":
    main()
