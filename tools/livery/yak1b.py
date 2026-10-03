# -*- coding: utf-8 -*-
"""
Yak-1B：1943 年蘇軍戰鬥機（庫斯克）。

    npx vite-node test/tools/livery-faces.ts -- yak1b <faces.json>
    python tools/livery/yak1b.py <faces.json>             # 預設塗裝 → yak1b.png
    python tools/livery/yak1b.py <faces.json> --winter    # 冬季白漆 → yak1b_winter.png

    上面黃綠底、暗色大面積波浪，下面淺藍；機身側面分界壓在一成高，淺藍只包龍骨
    紅星（白邊）：機身兩側、垂直尾翼兩側、兩翼上下

    冬季版：上面與側面（分界線以上）蓋斑駁的水洗白漆，下面仍是淺藍；紅星畫在白漆上面，
    白邊再加一圈細紅邊（白底上才襯得出來）。
"""
import sys
from paint import Livery, PLAN, SIDE, SS

# 參考圖各區域中位數的明暗再壓深一階：遊戲裡有日照與霧，照原值畫會過亮
GREEN = (118, 128, 80)
DARK = (36, 37, 31)
LIGHT_BLUE = (199, 215, 218)

DEMARCATION = 0.10    # 機身側面的分界高度（機身高的比例），淺藍只包龍骨
STAR_Z = 2.90         # 機身紅星：主翼後緣之後、座艙罩尾（2.10）之後
STAR_Y = -0.08        # 星心高度；該站機身 y −0.54…0.50
STAR_R = 0.43
WING_STAR_X = 3.1
FIN_STAR_Y = 0.95     # 垂直尾翼的星：高度（y 0.40…1.54 的中段）


def main(faces, winter=False):
    L = Livery(faces, '_winter' if winter else '')
    edges = L.wing_edges(['YAK_Wing'], 1.0, 4.6)
    # 白漆上的星星：白邊加寬、外面再一圈細紅邊
    border, outer = (0.045, 0.02) if winter else (0.03, 0.0)
    profile = L.fuselage_profile(['YAK_Fuselage'])

    L.countershade(GREEN, LIGHT_BLUE, profile, DEMARCATION, wave=0.05, seed=31)

    # 大面積波浪：上視沿前後拉長；側視只蓋分界線以上
    L.waves(['top'], DARK, seed=41, cell_m=1.1, stretch=2.2, coverage=0.45)
    L.waves(SIDE, DARK, seed=42, cell_m=0.5, stretch=2.5, coverage=0.45,
            clip=L.side_above(profile, DEMARCATION))
    L.panels(PLAN + SIDE, 0.8, 0.5, 2)
    if winter:
        L.whitewash(('top',), seed=63, coverage=0.8, cell_m=0.8, edges=edges, edge_x=(1.0, 4.6))
        L.whitewash(SIDE, seed=64, coverage=0.8, cell_m=0.6, clip=L.side_above(profile, DEMARCATION))
        L.panels(('top',) + SIDE, 0.8, 0.5, 1, seed=72)

    for v in SIDE:
        L.red_star(v, STAR_Z, STAR_Y, STAR_R, border, outer)

    # 垂直尾翼：量該高度的前後緣，星擺在弦的正中
    fin = L.mask('left', ['YAK_Fin']).load()
    row = int(L.px('left', 0, FIN_STAR_Y)[1] / SS)
    cols = [u for u in range(1024) if fin[u, row]]
    fin_le = (min(cols) - 512) / L.scale + L.planZ
    fin_te = (max(cols) - 512) / L.scale + L.planZ
    fin_r = min(0.22, 0.3 * (fin_te - fin_le))
    for v in SIDE:
        L.red_star(v, 0.5 * (fin_le + fin_te), FIN_STAR_Y, fin_r, border, outer)

    le, te = edges(WING_STAR_X)
    wing_r = min(0.40, 0.3 * (te - le))
    zc = 0.5 * (le + te)
    for x in (-WING_STAR_X, WING_STAR_X):
        L.red_star('top', x, zc, wing_r, border, outer)
        L.red_star('bottom', x, zc, wing_r, border, outer)
    yb, yt = profile(STAR_Z)
    print(f'機身星 y {STAR_Y - 0.809 * STAR_R:.2f}…{STAR_Y + STAR_R:.2f}（機身 {yb:.2f}…{yt:.2f}）、翼星 r={wing_r:.2f}（弦 {te - le:.2f}）')
    L.save()


main([a for a in sys.argv[1:] if not a.startswith('--')][0], '--winter' in sys.argv)
