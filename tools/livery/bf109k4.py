# -*- coding: utf-8 -*-
"""
Bf 109 K-4：1945 年本土防空。

    npx vite-node test/tools/livery-faces.ts -- bf109k4 <faces.json>
    python tools/livery/bf109k4.py <faces.json>             # 預設塗裝 → bf109k4.png
    python tools/livery/bf109k4.py <faces.json> --winter    # 冬季白漆 → bf109k4_winter.png

    上面 RLM 81／82 碎片迷彩，下面 RLM 76 淺藍
    機身側面 76 底、81／82 斑點，機背一條碎片迷彩
    十字：機身兩側、兩翼上面（後期只描白框）、兩翼下面
    機身白色戰術號碼、後段本土防空色帶（藍白藍）
    黑綠色螺旋槳整流罩

    尾翼**不畫**任何標記。

    冬季版：上面與側面噴整片白漆，漆薄的髒污處透出灰灰的底色，磨穿的小碎片（機翼前緣最多）露出
    原本的迷彩；本土防空色帶、黑綠色整流罩、十字與機號都畫在白漆上面，所以不被蓋掉。
"""
import sys
from paint import Livery, PLAN, SIDE, WHITE, BLACK

RLM81 = (98, 94, 72)
RLM82 = (86, 106, 70)
RLM76 = (178, 190, 186)
RLM70 = (40, 46, 38)
RVD_BLUE = (40, 70, 140)

SPINNER_END = -2.09
BAND = (4.12, 4.52)
CROSS_Z = 3.30


def main(faces, winter=False):
    L = Livery(faces, '_winter' if winter else '')
    edges = L.wing_edges(['BF109_Wing'], 0.5, 4.8)
    profile = L.fuselage_profile(['BF109_Fuselage'])

    L.fill('bottom', RLM76)
    L.splinter('top', (RLM81, RLM82), 9, seed=7)
    for v in SIDE:
        L.fill(v, RLM76)
    L.mottle(SIDE, [RLM81, RLM82], 900, 0.07, seed=3, clip=L.side_above(profile, 0.2))
    L.splinter('left', (RLM81, RLM82), 6, seed=8, clip=L.side_above(profile, 0.78))
    L.splinter('right', (RLM81, RLM82), 6, seed=9, clip=L.side_above(profile, 0.78))
    L.panels(PLAN + SIDE, 0.5, 0.5, 2)
    if winter:
        L.whitewash(('top',), seed=65, dirt=0.3, flake=0.05, cell_m=0.8, edges=edges, edge_x=(0.5, 4.8))
        L.whitewash(SIDE, seed=66, dirt=0.3, flake=0.06, cell_m=0.6, clip=L.side_above(profile, 0.2))
        L.panels(('top',) + SIDE, 0.5, 0.5, 1, seed=73)

    # 本土防空色帶
    band = [(BAND[0], BAND[0] + 0.13, RVD_BLUE), (BAND[0] + 0.13, BAND[1] - 0.13, WHITE),
            (BAND[1] - 0.13, BAND[1], RVD_BLUE)]
    for z0, z1, c in band:
        for v in SIDE:
            L.rect(v, z0, -1.0, z1, 1.2, c)
        for v in PLAN:
            L.rect(v, -0.5, z0, 0.5, z1, c)

    # 螺旋槳整流罩
    for v in PLAN:
        L.rect(v, -0.5, -3.0, 0.5, SPINNER_END, RLM70)
    # 【不畫白色螺旋】整流罩和機身是同一塊、不跟著螺旋槳轉，畫上去的螺旋是停著的
    for v in SIDE:
        L.rect(v, -3.0, -0.5, SPINNER_END, 1.2, RLM70)

    for v in SIDE:
        L.balkenkreuz(v, CROSS_Z, 0.36, 0.72)
        L.text(v, 2.35, 0.36, '7', 0.5, WHITE, outline=BLACK)
    zc = sum(edges(3.3)) / 2
    for x in (-3.3, 3.3):
        # 冬季：只描白框的簡化樣式畫在白漆上看不見，翼上十字改回黑十字
        L.balkenkreuz('top', x, zc, 0.95, style='full' if winter else 'outline')
        L.balkenkreuz('bottom', x, zc, 0.95)
    L.save()


if __name__ == '__main__':
    main([a for a in sys.argv[1:] if not a.startswith('--')][0], '--winter' in sys.argv)
