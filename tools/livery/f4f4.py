# -*- coding: utf-8 -*-
"""
F4F-4：1942 年美國海軍，藍灰上面、淺灰下面。

    npx vite-node test/tools/livery-faces.ts -- f4f4 <faces.json>
    python tools/livery/f4f4.py <faces.json>

    上下分色，機身側面的分界約在半高、手噴的微微起伏
    國籍標誌是 1942 年那種圓裡一顆星、沒有白條：機身兩側、左翼上面、右翼下面
    機身白色機號
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE

BLUE_GRAY = (84, 98, 107)
LIGHT_GRAY = (176, 178, 176)


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['F4F_Wing'], 0.9, 5.6)
    profile = L.fuselage_profile(['F4F_Fuselage'])
    L.countershade(BLUE_GRAY, LIGHT_GRAY, profile, 0.55, wave=0.03)
    L.panels(PLAN, 0.6, 0.6, 3)
    L.panels(SIDE, 0.6, 0.5, 3, seed=52)

    for v in SIDE:
        L.us_star(v, 3.0, 0.2, 0.36, bars=False)
        L.text(v, 1.85, 0.2, '12', 0.42, WHITE)
    zc = sum(edges(3.9)) / 2
    L.us_star('top', -3.9, zc, 0.5, bars=False)
    L.us_star('bottom', 3.9, zc, 0.5, bars=False)
    L.save()


main(sys.argv[1])
