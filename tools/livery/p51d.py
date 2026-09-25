# -*- coding: utf-8 -*-
"""
P-51D：1944 年下半的第八航空軍，金屬原色。

    npx vite-node test/tools/livery-faces.ts -- p51d <faces.json>
    python tools/livery/p51d.py <faces.json>

    銀色原色，蒙皮分片深淺略有不同、分片線與操縱面框線
    機鼻上方與兩側上半的橄欖綠防眩漆，機鼻前緣一圈紅帶
    國籍標誌：機身兩側、左翼上面、右翼下面
    機身代號：前面兩字、標誌後面一字
    機腹與兩翼下面的黑白辨識帶（平尾在貼圖上搬開了，不會跟著上）
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE, BLACK

METAL = (176, 181, 186)
PANEL_LINE = (120, 124, 130)
OLIVE = (82, 80, 58)
RED = (170, 32, 30)
CODE = (28, 28, 30)

NOSE_Z = -2.70
NOSE_BAND = -2.25
ANTIGLARE_END = 0.05
ANTIGLARE_SIDE_Y = 0.30
ANTIGLARE_HALF_X = 0.30
FUSELAGE_LINES = (-1.95, -1.20, -0.45, 1.20, 2.40, 3.60, 4.80, 5.70)

FUSELAGE_STAR = (3.15, 0.05, 0.30)   # z, y, 圓半徑
WING_STAR_X = 4.00
WING_STAR_R = 0.34

# 辨識帶：五條，白黑白黑白。翼下的外緣要在翼下標誌的內側
STRIPE_W = 0.30
WING_STRIPES_X0 = 1.60
FUSELAGE_STRIPES_Z0 = 4.50
FUSELAGE_STRIPES_TOP_Y = 0.15
FUSELAGE_STRIPES_HALF_X = 0.22
# 上下視裡主翼那一塊的後界（z）。主翼後緣最後到 2.06，平尾搬過來後從 2.56 開始
WING_REGION_END_Z = 2.3

WING_LINES_X = (1.55, 3.30)
AILERON = (3.30, 5.25)
AILERON_CHORD = 0.26
FLAP = (1.60, 3.25)
FLAP_CHORD = 0.24


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['Mesh_23'], 1.6, 5.6)

    for v in PLAN + SIDE:
        L.fill(v, METAL)
    L.panels(PLAN, 0.5, 0.6, 5)
    L.panels(SIDE, 0.6, 0.45, 5, seed=52)

    # ── 分片線 ───────────────────────────────────────────────
    for z in FUSELAGE_LINES:
        for v in PLAN:
            L.line(v, -0.45, z, 0.45, z, PANEL_LINE)
        for v in SIDE:
            L.line(v, z, -1.2, z, 1.0, PANEL_LINE)
    for v in PLAN:
        for side in (-1, 1):
            for x in WING_LINES_X:
                le, te = edges(x)
                L.line(v, side * x, le, side * x, te, PANEL_LINE)
            xs = [1.6 + k * 0.2 for k in range(20)]
            for a, b in zip(xs, xs[1:]):
                za = edges(a)[0] + 0.3 * (edges(a)[1] - edges(a)[0])
                zb = edges(b)[0] + 0.3 * (edges(b)[1] - edges(b)[0])
                L.line(v, side * a, za, side * b, zb, PANEL_LINE)
            for (x0, x1), chord in ((AILERON, AILERON_CHORD), (FLAP, FLAP_CHORD)):
                xs = [x0 + (x1 - x0) * k / 10 for k in range(11)]
                pts = [(side * x, edges(x)[1] - chord * (edges(x)[1] - edges(x)[0])) for x in xs]
                for (a0, b0), (a1, b1) in zip(pts, pts[1:]):
                    L.line(v, a0, b0, a1, b1, PANEL_LINE)
                for x, (a, b) in ((x0, pts[0]), (x1, pts[-1])):
                    L.line(v, a, b, side * x, edges(x)[1], PANEL_LINE)

    # ── 辨識帶（只在下半部） ─────────────────────────────────────
    for k in range(5):
        c = WHITE if k % 2 == 0 else BLACK
        x0 = WING_STRIPES_X0 + k * STRIPE_W
        for side in (-1, 1):
            L.rect('bottom', side * x0, -2.0, side * (x0 + STRIPE_W), WING_REGION_END_Z, c)
        z0 = FUSELAGE_STRIPES_Z0 + k * STRIPE_W
        L.rect('bottom', -FUSELAGE_STRIPES_HALF_X, z0, FUSELAGE_STRIPES_HALF_X, z0 + STRIPE_W, c)
        for v in SIDE:
            L.rect(v, z0, -2.0, z0 + STRIPE_W, FUSELAGE_STRIPES_TOP_Y, c)

    # ── 防眩漆與機鼻紅帶 ───────────────────────────────────────
    w = ANTIGLARE_HALF_X
    L.poly('top', [(-w, NOSE_Z), (w, NOSE_Z), (w, ANTIGLARE_END - 0.2),
                   (0.0, ANTIGLARE_END), (-w, ANTIGLARE_END - 0.2)], OLIVE)
    for v in SIDE:
        L.poly(v, [(NOSE_Z, 1.2), (ANTIGLARE_END, 1.2), (ANTIGLARE_END, 0.55),
                   (ANTIGLARE_END - 0.35, ANTIGLARE_SIDE_Y), (NOSE_Z, ANTIGLARE_SIDE_Y)], OLIVE)
    for v in PLAN:
        L.rect(v, -0.8, NOSE_Z - 0.2, 0.8, NOSE_BAND, RED)
    for v in SIDE:
        L.rect(v, NOSE_Z - 0.2, -1.5, NOSE_BAND, 1.5, RED)

    # ── 國籍標誌與代號 ─────────────────────────────────────────
    z, y, r = FUSELAGE_STAR
    for v in SIDE:
        L.us_star(v, z, y, r)
        L.text(v, 2.05, 0.12, 'E9', 0.42, CODE)
        L.text(v, 4.25, 0.12, 'K', 0.42, CODE)
    zc = sum(edges(WING_STAR_X)) / 2
    L.us_star('top', -WING_STAR_X, zc, WING_STAR_R)
    L.us_star('bottom', WING_STAR_X, zc, WING_STAR_R)
    L.save()


main(sys.argv[1])
