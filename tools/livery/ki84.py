# -*- coding: utf-8 -*-
"""
Ki-84 疾風：1944–45 年陸軍。

    npx vite-node test/tools/livery-faces.ts -- ki84 <faces.json>
    python tools/livery/ki84.py <faces.json>

    上面暗綠、下面金屬原色，機身側面約半高分界
    日之丸：機身兩側（白邊）、兩翼上下
    兩翼前緣內段的黃色敵我識別帶
    機鼻上方黑色防眩漆、茶色螺旋槳整流罩、垂尾紅色部隊標記
"""
import sys
from paint import Livery, PLAN, SIDE

GREEN = (85, 96, 63)
METAL = (168, 172, 172)
YELLOW = (226, 168, 34)
ANTIGLARE = (32, 34, 36)
SPINNER = (118, 70, 42)
UNIT_RED = (168, 36, 32)

SPINNER_END = -2.45


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['KI84_Wing'], 0.7, 5.4)
    profile = L.fuselage_profile(['KI84_Fuselage'])
    L.countershade(GREEN, METAL, profile, 0.5)
    L.panels(PLAN + SIDE, 0.5, 0.5, 3)

    L.edge_strip(PLAN, edges, 0.7, 2.6, 0.2, YELLOW)
    L.poly('top', [(-0.24, -2.2), (0.24, -2.2), (0.24, 0.45), (0.0, 0.62), (-0.24, 0.45)], ANTIGLARE)
    for v in PLAN:
        L.rect(v, -0.5, -3.2, 0.5, SPINNER_END, SPINNER)
    for v in SIDE:
        L.rect(v, -3.2, -0.5, SPINNER_END, 0.5, SPINNER)
        L.poly(v, [(5.55, 0.62), (5.95, 0.62), (6.75, 1.45), (6.35, 1.45)], UNIT_RED)
        L.hinomaru(v, 3.7, 0.12, 0.3, border=0.06)
    zc = sum(edges(4.0)) / 2
    for x in (-4.0, 4.0):
        L.hinomaru('top', x, zc, 0.42)
        L.hinomaru('bottom', x, zc, 0.42)
    L.save()


main(sys.argv[1])
