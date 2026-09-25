# -*- coding: utf-8 -*-
"""
B-17G：1944 年第八航空軍，金屬原色。

    npx vite-node test/tools/livery-faces.ts -- b17g <faces.json>
    python tools/livery/b17g.py <faces.json>

    銀色原色，蒙皮分片深淺略有不同
    機鼻上方與內側發動機艙內側的橄欖綠防眩漆
    主翼、平尾前緣的黑色除冰靴
    國籍標誌：機身兩側、左翼上面、右翼下面
    大隊標誌：垂尾與右翼上面的黑三角，字母留金屬色；垂尾黑色序號
"""
import math
import sys
from paint import Livery, PLAN, SIDE, BLACK

METAL = (176, 181, 186)
OLIVE = (82, 80, 58)
BOOT = (30, 30, 32)


def triangle(L, view, a, b, size_m, letter):
    """大隊標誌：尖角朝上的黑三角，字母挖成金屬色"""
    cx, cy = L.px(view, a, b)
    s = L.m(size_m)
    h = s * math.sqrt(3) / 2
    L.d.polygon([(cx, cy - h * 2 / 3), (cx + s / 2, cy + h / 3), (cx - s / 2, cy + h / 3)], fill=BLACK)
    L.text(view, a, b + (0.12 * size_m if view in PLAN else -0.12 * size_m), letter, size_m * 0.42, METAL)


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['B17_Wing'], 1.4, 15.5)
    tail = L.wing_edges(['B17_Tailplane'], 1.0, 6.4)
    for v in PLAN + SIDE:
        L.fill(v, METAL)
    L.panels(PLAN + SIDE, 1.2, 1.0, 4)

    L.poly('top', [(-0.55, -6.3), (0.55, -6.3), (0.55, -3.4), (0.0, -3.1), (-0.55, -3.4)], OLIVE)
    for side in (-1, 1):
        L.rect('top', side * 2.3, -3.3, side * 2.95, -0.6, OLIVE)
    L.edge_strip(PLAN, edges, 3.95, 5.7, 0.3, BOOT)
    L.edge_strip(PLAN, edges, 7.45, 15.3, 0.3, BOOT)
    L.edge_strip(PLAN, tail, 1.2, 6.2, 0.25, BOOT)

    for v in SIDE:
        L.us_star(v, 9.4, 1.05, 0.52)
        triangle(L, v, 13.95, 4.35, 1.5, 'L')
        L.text(v, 13.75, 3.2, '338412', 0.34, BLACK)
    zc = sum(edges(11.0)) / 2
    L.us_star('top', -11.0, zc, 0.85)
    L.us_star('bottom', 11.0, zc, 0.85)
    triangle(L, 'top', 10.5, zc, 2.0, 'L')
    L.save()


main(sys.argv[1])
