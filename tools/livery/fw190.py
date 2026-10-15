# -*- coding: utf-8 -*-
"""
Fw 190 D-9：1945 年初的西線本土防空。

    npx vite-node test/tools/livery-faces.ts -- fw190 <faces.json>
    python tools/livery/fw190.py <faces.json>       # → fw190.png

    上面 RLM 81／82 碎片迷彩，下面 RLM 76 淺藍
    機身側面與垂尾 76 底、81／82 斑點，機背一條碎片迷彩
    十字：機身兩側、兩翼上面（後期只描白框）、兩翼下面
    座艙後方黑色戰術號碼、機身後段 JG 26 的本土防空色帶（黑白黑）
    黑綠色螺旋槳整流罩

    尾翼**不畫**任何標記。
"""
import sys
from PIL import Image, ImageChops
from paint import Livery, PLAN, SIDE, WHITE, BLACK

RLM81 = (92, 88, 66)
RLM82 = (82, 104, 66)
RLM76 = (176, 188, 186)
RLM70 = (40, 46, 38)

# 整流罩與機身的接縫
SPINNER_END = -2.33
BAND = (4.30, 4.80)
CROSS_Z = 3.55


def main(faces):
    L = Livery(faces)
    edges = L.wing_edges(['FW190_Wing'], 0.7, 5.0)
    profile = L.fuselage_profile(['FW190_Fuselage'])

    L.fill('bottom', RLM76)
    L.splinter('top', (RLM81, RLM82), 9, seed=11)
    for v in SIDE:
        L.fill(v, RLM76)
    L.mottle(SIDE, [RLM81, RLM82], 1000, 0.07, seed=5, clip=L.side_above(profile, 0.25))
    L.splinter('left', (RLM81, RLM82), 6, seed=12, clip=L.side_above(profile, 0.80))
    L.splinter('right', (RLM81, RLM82), 6, seed=13, clip=L.side_above(profile, 0.80))
    # 垂尾側面回到 76 底加斑點；碎片迷彩只留在機背
    fin = Image.new('L', L.im.size, 0)
    for v in SIDE:
        fin = ImageChops.lighter(fin, L.mask(v, ['FW190_Fin']).resize(L.im.size, Image.NEAREST))
        L.rect_on(v, ['FW190_Fin'], 4.8, -1.0, 7.4, 2.0, RLM76)
    L.mottle(SIDE, [RLM81, RLM82], 1000, 0.07, seed=6, clip=fin)
    L.panels(PLAN + SIDE, 0.5, 0.5, 2)

    # 本土防空色帶
    third = (BAND[1] - BAND[0]) / 3
    band = [(BAND[0], BAND[0] + third, BLACK), (BAND[0] + third, BAND[1] - third, WHITE),
            (BAND[1] - third, BAND[1], BLACK)]
    for z0, z1, c in band:
        for v in SIDE:
            L.rect(v, z0, -1.0, z1, 1.0, c)
        for v in PLAN:
            L.rect_on(v, ['FW190_Fuselage'], -0.5, z0, 0.5, z1, c)

    # 螺旋槳整流罩。【不畫白色螺旋】整流罩不跟著螺旋槳轉，畫上去的螺旋是停著的
    for v in PLAN:
        L.rect(v, -0.5, -3.0, 0.5, SPINNER_END, RLM70)
    for v in SIDE:
        L.rect(v, -3.0, -0.5, SPINNER_END, 0.5, RLM70)

    for v in SIDE:
        L.balkenkreuz(v, CROSS_Z, 0.04, 0.76)
        L.text(v, 2.80, 0.02, '12', 0.42, BLACK, outline=WHITE)
    zc = sum(edges(3.6)) / 2
    for x in (-3.6, 3.6):
        L.balkenkreuz('top', x, zc, 0.95, style='outline')
        L.balkenkreuz('bottom', x, zc, 0.95)
    L.save()


if __name__ == '__main__':
    main(sys.argv[1])
