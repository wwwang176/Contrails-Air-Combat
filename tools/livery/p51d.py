# -*- coding: utf-8 -*-
"""
P-51D 的塗裝貼圖：1944 年下半的第八航空軍，金屬原色。

    python tools/livery/p51d.py <faces.json>

<faces.json> 是 `tools/blender/p51d_livery_uv.py` 寫出的面投影，用來量翼前後緣。
輸出 public/textures/p51d.png。

內容：
    銀色原色，蒙皮分片深淺略有不同、分片線與操縱面框線
    機鼻上方與兩側上半的橄欖綠防眩漆，機鼻前緣一圈紅帶
    國籍標誌（藍框白星白條）：機身兩側、左翼上面、右翼下面
    機身代號：前面兩字、標誌後面一字
    機腹與兩翼下面的黑白辨識帶

所有位置都寫成機體座標（m），經 `layout` 投到各視圖；同一條帶子在上、側、
下三個視圖各畫一次，接得起來是因為三者從同一個座標換算。
"""
import json, math, os, random, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import layout  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'textures', 'p51d.png')

# 先畫兩倍大再縮回來，邊緣才有抗鋸齒
SS = 2

METAL = (176, 181, 186)
PANEL_LINE = (120, 124, 130)
OLIVE = (82, 80, 58)
RED = (170, 32, 30)
BLUE = (28, 46, 92)
WHITE = (236, 236, 232)
BLACK = (22, 22, 24)
CODE = (28, 28, 30)

# 機身站位（z）：引擎罩前緣、防眩漆後緣、分片線
NOSE_Z = -2.70
NOSE_BAND = -2.25
ANTIGLARE_END = 0.05
ANTIGLARE_SIDE_Y = 0.30
FUSELAGE_LINES = (-1.95, -1.20, -0.45, 1.20, 2.40, 3.60, 4.80, 5.70)

# 國籍標誌：圓半徑 R，白條長 R、高 R/2，外框 R/8
FUSELAGE_STAR = {'z': 3.15, 'y': 0.05, 'r': 0.30}
WING_STAR_X = 4.00
WING_STAR_R = 0.34

# 辨識帶：五條，白黑白黑白。翼下的外緣要在翼下標誌的內側
STRIPE_W = 0.30
WING_STRIPES_X0 = 1.60
FUSELAGE_STRIPES_Z0 = 4.50
FUSELAGE_STRIPES_TOP_Y = 0.15
# 機腹那一段只畫到尾錐的寬度，再寬就畫上平尾
FUSELAGE_STRIPES_HALF_X = 0.22
ANTIGLARE_HALF_X = 0.30

# 上下視裡主翼那一塊的後界（z）。主翼後緣最後到 2.06，平尾搬過來後從 2.56 開始
WING_REGION_END_Z = 2.3

# 翼面的分片線（|x|）與副翼外側
WING_LINES_X = (1.55, 3.30)
AILERON = (3.30, 5.25)
AILERON_CHORD = 0.26
FLAP = (1.60, 3.25)
FLAP_CHORD = 0.24


class Painter:
    def __init__(self, faces):
        self.im = Image.new('RGB', (layout.WIDTH * SS, layout.HEIGHT * SS), METAL)
        self.d = ImageDraw.Draw(self.im)
        self.faces = faces

    def px(self, view, a, b):
        """上下視 (a, b) = (x, z)；左右視 (a, b) = (z, y)"""
        if view in ('top', 'bottom'):
            u, v = layout.project(view, a, 0.0, b)
        else:
            u, v = layout.project(view, 0.0, b, a)
        return (u * SS, v * SS)

    def poly(self, view, pts, fill):
        self.d.polygon([self.px(view, a, b) for a, b in pts], fill=fill)

    def rect(self, view, a0, b0, a1, b1, fill):
        self.poly(view, [(a0, b0), (a1, b0), (a1, b1), (a0, b1)], fill)

    def line(self, view, a0, b0, a1, b1, fill, width_m=0.018):
        self.d.line([self.px(view, a0, b0), self.px(view, a1, b1)], fill=fill,
                    width=max(1, round(width_m * layout.SCALE * SS)))

    # ── 圖上直接畫（已經是「看過去」的方向，上 = 機首或機頂） ─────────
    def star_and_bar(self, cx, cy, r):
        """國籍標誌。cx, cy 是像素；r 是圓半徑，px"""
        d = self.d
        b = r / 8
        # 藍色外框：圓 + 白條外擴 b
        d.ellipse([cx - r - b, cy - r - b, cx + r + b, cy + r + b], fill=BLUE)
        d.rectangle([cx - 2 * r - b, cy - r / 4 - b, cx + 2 * r + b, cy + r / 4 + b], fill=BLUE)
        # 白條與藍圓
        d.rectangle([cx - 2 * r, cy - r / 4, cx + 2 * r, cy + r / 4], fill=WHITE)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BLUE)
        # 白星：尖端碰到圓
        pts = []
        for k in range(10):
            rr = r if k % 2 == 0 else r * 0.382
            t = -math.pi / 2 + k * math.pi / 5
            pts.append((cx + rr * math.cos(t), cy + rr * math.sin(t)))
        d.polygon(pts, fill=WHITE)

    def text(self, cx, cy, s, height_px):
        font = ImageFont.truetype('arialbd.ttf', int(height_px * 1.36))
        box = self.d.textbbox((0, 0), s, font=font)
        w, h = box[2] - box[0], box[3] - box[1]
        self.d.text((cx - w / 2 - box[0], cy - h / 2 - box[1]), s, font=font, fill=CODE)


def wing_edges(faces):
    """上視裡每一個 |x| 的翼前緣與後緣 z，由面的投影量出來"""
    mask = Image.new('L', (layout.WIDTH, layout.HEIGHT), 0)
    d = ImageDraw.Draw(mask)
    for f in faces:
        if f['view'] == 'top':
            d.polygon([tuple(p) for p in f['pts']], fill=255)
    px = mask.load()
    le, te = {}, {}
    for k in range(0, 57):
        x = 1.6 + k * 0.07
        u, _ = layout.top(x, 0)
        col = [v for v in range(0, 1024) if px[int(u), v]]
        # 只看主翼那一段，平尾在後面
        rows = [v for v in col
                if (v - layout.TOP_ORIGIN[1]) / layout.SCALE + layout.PLAN_CENTER_Z < WING_REGION_END_Z]
        if not rows:
            continue
        z0 = (min(rows) - layout.TOP_ORIGIN[1]) / layout.SCALE + layout.PLAN_CENTER_Z
        z1 = (max(rows) - layout.TOP_ORIGIN[1]) / layout.SCALE + layout.PLAN_CENTER_Z
        le[round(x, 2)], te[round(x, 2)] = z0, z1
    return le, te


def edge_at(table, x):
    ks = sorted(table)
    x = min(max(abs(x), ks[0]), ks[-1])
    for a, b in zip(ks, ks[1:]):
        if a <= x <= b:
            t = (x - a) / (b - a) if b > a else 0
            return table[a] + (table[b] - table[a]) * t
    return table[ks[-1]]


def paint(faces):
    p = Painter(faces)
    rnd = random.Random(51)
    le, te = wing_edges(faces)

    # ── 蒙皮分片：每片深淺差一點，金屬拼起來的樣子 ──────────────
    for view in ('top', 'bottom'):
        for i in range(-12, 12):
            for j in range(-9, 16):
                s = rnd.randint(-5, 5)
                c = tuple(max(0, min(255, v + s)) for v in METAL)
                p.rect(view, i * 0.5, j * 0.6, (i + 1) * 0.5, (j + 1) * 0.6, c)
    for view in ('left', 'right'):
        for i in range(-9, 16):
            for j in range(-6, 8):
                s = rnd.randint(-5, 5)
                c = tuple(max(0, min(255, v + s)) for v in METAL)
                p.rect(view, i * 0.6, j * 0.45, (i + 1) * 0.6, (j + 1) * 0.45, c)

    # ── 分片線 ───────────────────────────────────────────────
    for z in FUSELAGE_LINES:
        for view in ('top', 'bottom'):
            p.line(view, -0.45, z, 0.45, z, PANEL_LINE)
        for view in ('left', 'right'):
            p.line(view, z, -1.2, z, 1.0, PANEL_LINE)
    for view in ('top', 'bottom'):
        for side in (-1, 1):
            for x in WING_LINES_X:
                p.line(view, side * x, edge_at(le, x), side * x, edge_at(te, x), PANEL_LINE)
            # 主樑：前緣後 30% 弦長
            xs = [1.6 + k * 0.2 for k in range(20)]
            for a, b in zip(xs, xs[1:]):
                za = edge_at(le, a) + 0.3 * (edge_at(te, a) - edge_at(le, a))
                zb = edge_at(le, b) + 0.3 * (edge_at(te, b) - edge_at(le, b))
                p.line(view, side * a, za, side * b, zb, PANEL_LINE)
            # 副翼與襟翼的框
            for (x0, x1), chord in ((AILERON, AILERON_CHORD), (FLAP, FLAP_CHORD)):
                pts = []
                xs = [x0 + (x1 - x0) * k / 10 for k in range(11)]
                for x in xs:
                    pts.append((side * x, edge_at(te, x) - chord * (edge_at(te, x) - edge_at(le, x))))
                for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
                    p.line(view, a0, b0, a1, b1, PANEL_LINE)
                for x, (a, b) in ((x0, pts[0]), (x1, pts[-1])):
                    p.line(view, a, b, side * x, edge_at(te, x), PANEL_LINE)

    # ── 辨識帶（只在下半部） ─────────────────────────────────────
    for k in range(5):
        c = WHITE if k % 2 == 0 else BLACK
        # 兩翼下面
        x0 = WING_STRIPES_X0 + k * STRIPE_W
        for side in (-1, 1):
            # 後端停在主翼後緣之後一點：再往後是平尾在貼圖上的位置
            p.rect('bottom', side * x0, -2.0, side * (x0 + STRIPE_W), WING_REGION_END_Z, c)
        # 機腹與兩側下半
        z0 = FUSELAGE_STRIPES_Z0 + k * STRIPE_W
        p.rect('bottom', -FUSELAGE_STRIPES_HALF_X, z0, FUSELAGE_STRIPES_HALF_X, z0 + STRIPE_W, c)
        for view in ('left', 'right'):
            p.rect(view, z0, -2.0, z0 + STRIPE_W, FUSELAGE_STRIPES_TOP_Y, c)

    # ── 防眩漆與機鼻紅帶 ───────────────────────────────────────
    w = ANTIGLARE_HALF_X
    p.poly('top', [(-w, NOSE_Z), (w, NOSE_Z), (w, ANTIGLARE_END - 0.2),
                   (0.0, ANTIGLARE_END), (-w, ANTIGLARE_END - 0.2)], OLIVE)
    for view in ('left', 'right'):
        p.poly(view, [(NOSE_Z, 1.2), (ANTIGLARE_END, 1.2), (ANTIGLARE_END, 0.55),
                      (ANTIGLARE_END - 0.35, ANTIGLARE_SIDE_Y), (NOSE_Z, ANTIGLARE_SIDE_Y)], OLIVE)
    for view in ('top', 'bottom'):
        p.rect(view, -0.8, NOSE_Z - 0.2, 0.8, NOSE_BAND, RED)
    for view in ('left', 'right'):
        p.rect(view, NOSE_Z - 0.2, -1.5, NOSE_BAND, 1.5, RED)

    # ── 國籍標誌 ───────────────────────────────────────────────
    s = FUSELAGE_STAR
    for view in ('left', 'right'):
        cx, cy = p.px(view, s['z'], s['y'])
        p.star_and_bar(cx, cy, s['r'] * layout.SCALE * SS)
    zc = (edge_at(le, WING_STAR_X) + edge_at(te, WING_STAR_X)) / 2
    for view, x in (('top', -WING_STAR_X), ('bottom', WING_STAR_X)):
        cx, cy = p.px(view, x, zc)
        p.star_and_bar(cx, cy, WING_STAR_R * layout.SCALE * SS)

    # ── 機身代號：兩字在標誌前面，一字在後面 ────────────────────
    h = 0.42 * layout.SCALE * SS
    for view in ('left', 'right'):
        for z, code in ((2.05, 'E9'), (4.25, 'K')):
            cx, cy = p.px(view, z, 0.12)
            p.text(cx, cy, code, h)

    return p.im.resize((layout.WIDTH, layout.HEIGHT), Image.LANCZOS)


if __name__ == '__main__':
    faces = json.load(open(sys.argv[1], encoding='utf-8'))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    paint(faces).save(OUT, optimize=True)
    print(OUT, os.path.getsize(OUT) // 1024, 'KB')
