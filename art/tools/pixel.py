"""画场景用的像素小工具：矩形、线、椭圆、多边形、分层渐变（不用真渐变，按色阶分带 + 交界处棋盘格过渡）、透视地板、半透明叠加。"""
from __future__ import annotations

import math
import random

from PIL import Image

RGB = tuple[int, int, int]


def hexc(s: str) -> RGB:
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def mix(a: RGB, b: RGB, t: float) -> RGB:
    return (round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t), round(a[2] + (b[2] - a[2]) * t))


def dark(c: RGB, k: float) -> RGB:
    return (int(c[0] * k), int(c[1] * k), int(c[2] * k))


def C(c) -> RGB:
    return hexc(c) if isinstance(c, str) else c


class Canvas:
    def __init__(self, w: int, h: int, bg=None):
        self.w, self.h = w, h
        self.p: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * w for _ in range(h)]
        if bg is not None:
            self.rect(0, 0, w - 1, h - 1, bg)

    # ---- 基本
    def px(self, x: int, y: int, c, a: int = 255):
        if 0 <= x < self.w and 0 <= y < self.h:
            c = C(c)
            if a >= 255:
                self.p[y][x] = (*c, 255)
            else:
                r, g, b, aa = self.p[y][x]
                if aa == 0:
                    self.p[y][x] = (*c, a)
                else:
                    t = a / 255
                    self.p[y][x] = (round(r + (c[0] - r) * t), round(g + (c[1] - g) * t), round(b + (c[2] - b) * t), max(aa, a))

    def get(self, x: int, y: int) -> RGB:
        r, g, b, _ = self.p[y][x]
        return (r, g, b)

    def rect(self, x0, y0, x1, y1, c, a=255):
        for y in range(max(0, y0), min(self.h, y1 + 1)):
            for x in range(max(0, x0), min(self.w, x1 + 1)):
                self.px(x, y, c, a)

    def frame(self, x0, y0, x1, y1, c, t=1):
        for i in range(t):
            self.rect(x0 + i, y0 + i, x1 - i, y0 + i, c)
            self.rect(x0 + i, y1 - i, x1 - i, y1 - i, c)
            self.rect(x0 + i, y0 + i, x0 + i, y1 - i, c)
            self.rect(x1 - i, y0 + i, x1 - i, y1 - i, c)

    def line(self, x0, y0, x1, y1, c, a=255):
        x0, y0, x1, y1 = round(x0), round(y0), round(x1), round(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, c, a)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx, cy, rx, ry, c, a=255):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.px(x, y, c, a)

    def poly(self, pts, c, a=255):
        ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(self.h, int(max(ys)) + 1)):
            yc = y + 0.5
            xs = []
            for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
                if (y1 <= yc < y2) or (y2 <= yc < y1):
                    xs.append(x1 + (yc - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(math.ceil(xs[i] - 0.5), math.floor(xs[i + 1] - 0.5) + 1):
                    self.px(x, y, c, a)

    # ---- 效果
    def bands(self, y0: int, y1: int, colors: list, x0: int = 0, x1: int | None = None):
        """竖直方向的分层渐变：等分成几条色带，交界处一行棋盘格过渡"""
        x1 = self.w - 1 if x1 is None else x1
        n = len(colors)
        h = y1 - y0 + 1
        for y in range(y0, y1 + 1):
            f = (y - y0) / h * n
            i = min(n - 1, int(f))
            c = C(colors[i])
            # 色带交界：上一行半格棋盘
            nxt = min(n - 1, i + 1)
            near = (i + 1) * h / n + y0 - y
            for x in range(x0, x1 + 1):
                if 0 < near <= 1 and nxt != i and (x + y) % 2 == 0:
                    self.px(x, y, colors[nxt])
                else:
                    self.px(x, y, c)

    def speckle(self, x0, y0, x1, y1, c, density: float, seed: int = 1, a=255):
        rnd = random.Random(seed)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if rnd.random() < density:
                    self.px(x, y, c, a)

    def checker(self, x0, y0, x1, y1, c, a=255):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x + y) % 2 == 0:
                    self.px(x, y, c, a)

    def glow(self, cx, cy, r, c, a_max=110):
        """圆形柔光：分 3 圈，越外越淡"""
        for k, a in ((1.0, a_max // 3), (0.7, a_max * 2 // 3), (0.42, a_max)):
            self.ellipse(cx, cy, r * k, r * k, c, a)

    def floor_lines(self, top: int, vx: float, xs_bottom: list[float], c, a=255, spread: float = 0.35):
        """一点透视的地板竖线：底边的 x 连到灭点方向"""
        for xb in xs_bottom:
            xt = vx + (xb - vx) * spread
            self.line(xt, top, xb, self.h - 1, c, a)

    def floor_rows(self, top: int, n: int, c, power: float = 1.7, a=255):
        """地板横线，越往下间距越大"""
        out = []
        for j in range(1, n + 1):
            y = top + round((self.h - 1 - top) * (j / (n + 0.4)) ** power)
            self.rect(0, y, self.w - 1, y, c, a)
            out.append(y)
        return out

    def image(self, scale: int = 1) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h))
        im.putdata([v for row in self.p for v in row])
        return im.resize((self.w * scale, self.h * scale), Image.NEAREST) if scale != 1 else im

    def paste(self, img: Image.Image, x0: int, y0: int):
        src = img.convert("RGBA").load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, a = src[x, y]
                if a:
                    self.px(x0 + x, y0 + y, (r, g, b), a)
