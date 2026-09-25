# -*- coding: utf-8 -*-
"""
A6M5 零戰五二型：1944 年海軍。

    npx vite-node test/tools/livery-faces.ts -- a6m5 <faces.json>
    python tools/livery/a6m5.py <faces.json>

    上面暗綠、下面灰綠（引擎罩是黑色的 accent 材質，不在貼圖上）
    日之丸：機身兩側（白邊）、兩翼上下
    兩翼前緣內段的黃色敵我識別帶
    垂尾白色尾號、茶色螺旋槳整流罩
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE

GREEN = (74, 88, 64)
GRAY_GREEN = (166, 164, 140)
YELLOW = (226, 168, 34)
SPINNER = (112, 72, 46)

SPINNER_END = -1.85


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['A6M5_Wing'], 0.7, 5.3)
    profile = L.fuselage_profile(['A6M5_Fuselage'])
    L.countershade(GREEN, GRAY_GREEN, profile, 0.5)
    L.panels(PLAN + SIDE, 0.5, 0.5, 3)

    L.edge_strip(PLAN, edges, 0.7, 2.5, 0.2, YELLOW)
    for v in PLAN:
        L.rect(v, -0.5, -3.0, 0.5, SPINNER_END, SPINNER)
    for v in SIDE:
        L.rect(v, -3.0, -0.5, SPINNER_END, 0.5, SPINNER)
        L.hinomaru(v, 3.35, 0.2, 0.3, border=0.06)
        L.text(v, 5.75, 0.95, '53-122', 0.26, WHITE)
    zc = sum(edges(3.8)) / 2
    for x in (-3.8, 3.8):
        L.hinomaru('top', x, zc, 0.44)
        L.hinomaru('bottom', x, zc, 0.44)
    L.save()


main(sys.argv[1])
