# -*- coding: utf-8 -*-
"""
He 111 H：1940–42 年轟炸聯隊。

    npx vite-node test/tools/livery-faces.ts -- he111 <faces.json>
    python tools/livery/he111.py <faces.json>

    上面 RLM 70／71 碎片迷彩，下面 RLM 65 淺藍；機身側面約半高分界
    十字：機身兩側、兩翼上下
    機身代號「A1＋EK」：聯隊碼在十字前面、個別機碼在後面

    尾翼**不畫**任何標記。
"""
import sys
from paint import Livery, PLAN, SIDE, BLACK

RLM70 = (62, 72, 56)
RLM71 = (86, 98, 72)
RLM65 = (150, 172, 186)


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['Mesh_31'], 3.4, 11.0)
    profile = L.fuselage_profile(['Mesh_30'])
    L.countershade(RLM70, RLM65, profile, 0.5)
    L.splinter('top', (RLM70, RLM71), 12, seed=11)
    L.splinter('left', (RLM70, RLM71), 8, seed=12, clip=L.side_above(profile, 0.5))
    L.splinter('right', (RLM70, RLM71), 8, seed=13, clip=L.side_above(profile, 0.5))
    L.panels(PLAN + SIDE, 1.0, 0.8, 2)

    for v in SIDE:
        L.balkenkreuz(v, 6.9, 0.3, 1.1)
        L.text(v, 5.45, 0.3, 'A1', 0.62, BLACK)
        L.text(v, 8.35, 0.3, 'EK', 0.62, BLACK)
    zc = sum(edges(7.6)) / 2
    for x in (-7.6, 7.6):
        L.balkenkreuz('top', x, zc, 1.5)
        L.balkenkreuz('bottom', x, zc, 1.5)
    L.save()


main(sys.argv[1])
