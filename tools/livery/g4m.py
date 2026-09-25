# -*- coding: utf-8 -*-
"""
G4M 一式陸攻：1944 年海軍。

    npx vite-node test/tools/livery-faces.ts -- g4m <faces.json>
    python tools/livery/g4m.py <faces.json>

    上面暗綠、下面灰，機身與發動機艙側面約半高分界
    日之丸：機身兩側（白邊）、兩翼上下
    兩翼前緣發動機艙外側的黃色敵我識別帶
    垂尾白色尾號
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE

GREEN = (75, 90, 68)
GRAY = (160, 160, 146)
YELLOW = (226, 168, 34)


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['G4M_Wing'], 1.2, 12.2)
    profile = L.fuselage_profile(['G4M_Fuselage'])
    L.countershade(GREEN, GRAY, profile, 0.5)
    L.panels(PLAN + SIDE, 1.0, 0.9, 3)

    L.edge_strip(PLAN, edges, 3.9, 6.8, 0.35, YELLOW)
    for v in SIDE:
        L.hinomaru(v, 8.0, 0.15, 0.5, border=0.1)
        L.text(v, 11.9, 1.75, '763-12', 0.5, WHITE)
    zc = sum(edges(8.8)) / 2
    for x in (-8.8, 8.8):
        L.hinomaru('top', x, zc, 0.75)
        L.hinomaru('bottom', x, zc, 0.75)
    L.save()


main(sys.argv[1])
