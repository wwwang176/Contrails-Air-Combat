# -*- coding: utf-8 -*-
"""
Ju 87 B-2：1940 年俯衝轟炸聯隊（StG 2）。

    npx vite-node test/tools/livery-faces.ts -- ju87 <faces.json>
    python tools/livery/ju87.py <faces.json>

    上面 RLM 70／71 碎片迷彩，下面 RLM 65 淺藍；機身側面的分界壓得低（約三成高），
    淺藍只包機腹
    十字：機身兩側（座艙罩與尾翼之間）、兩翼上下
    機身代號「T6＋AC」：聯隊碼在十字前面、個別機碼在後面

    尾翼**不畫**任何標記。
"""
import sys
from paint import Livery, PLAN, SIDE, BLACK

RLM70 = (62, 72, 56)
RLM71 = (86, 98, 72)
RLM65 = (150, 172, 186)

CROSS_Z = 3.8         # 機身十字：座艙罩尾（2.43）與背鰭起點（4.5）之間
CODE_Z = (2.95, 4.65)
WING_CROSS_X = 5.0    # 翼上十字：該站弦長 1.6


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['JU87_Wing'], 1.0, 6.6)
    profile = L.fuselage_profile(['JU87_Fuselage'])
    L.countershade(RLM70, RLM65, profile, 0.3)
    L.splinter('top', (RLM70, RLM71), 12, seed=21)
    L.splinter('left', (RLM70, RLM71), 8, seed=22, clip=L.side_above(profile, 0.3))
    L.splinter('right', (RLM70, RLM71), 8, seed=23, clip=L.side_above(profile, 0.3))
    L.panels(PLAN + SIDE, 0.8, 0.6, 2)

    yb, yt = profile(CROSS_Z)
    yc = 0.5 * (yb + yt)
    for v in SIDE:
        L.balkenkreuz(v, CROSS_Z, yc, 0.8)
        L.text(v, CODE_Z[0], yc, 'T6', 0.5, BLACK)
        L.text(v, CODE_Z[1], yc, 'AC', 0.5, BLACK)
    zc = sum(edges(WING_CROSS_X)) / 2
    for x in (-WING_CROSS_X, WING_CROSS_X):
        L.balkenkreuz('top', x, zc, 1.2)
        L.balkenkreuz('bottom', x, zc, 1.2)
    L.save()


main(sys.argv[1])
