# -*- coding: utf-8 -*-
"""
F6F-5：1944–45 年美國海軍，全機光面海藍。

    npx vite-node test/tools/livery-faces.ts -- f6f5 <faces.json>
    python tools/livery/f6f5.py <faces.json>

    全機同一色（1944 年起艦載機改成一色海藍，不再上下分色）
    國籍標誌：機身兩側、左翼上面、右翼下面
    機鼻兩側白色機號
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE

SEA_BLUE = (63, 82, 102)
PANEL_LINE = (46, 60, 78)


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['F6F_Wing'], 0.9, 6.4)
    for v in PLAN + SIDE:
        L.fill(v, SEA_BLUE)
    L.panels(PLAN, 0.6, 0.6, 3)
    L.panels(SIDE, 0.6, 0.5, 3, seed=52)
    for v in PLAN:
        for side in (-1, 1):
            for x in (1.9, 4.0):
                le, te = edges(x)
                L.line(v, side * x, le, side * x, te, PANEL_LINE)
    for v in SIDE:
        for z in (-0.8, 1.6, 3.0, 4.8):
            L.line(v, z, -1.0, z, 1.4, PANEL_LINE)

    for v in SIDE:
        L.us_star(v, 3.95, 0.25, 0.32)
        L.text(v, -1.45, 0.12, '27', 0.5, WHITE)
    zc = sum(edges(4.4)) / 2
    L.us_star('top', -4.4, zc, 0.44)
    L.us_star('bottom', 4.4, zc, 0.44)
    L.save()


main(sys.argv[1])
