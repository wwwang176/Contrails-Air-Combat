# -*- coding: utf-8 -*-
"""
LST：Measure 31 綠色迷彩，三種圖案。

    npx vite-node test/tools/ship-livery-faces.ts -- lst <faces.json>
    python tools/livery/ship_lst.py <faces.json> <a|b|c> [檢查圖.png]

    a → ship_lst.png、b → ship_lst_b.png、c → ship_lst_c.png（`shipLiveries.ts` 的
    `variants`）。灘頭的 LST 每一艘輪流用一種，相鄰的兩艘不同。

    立面  霧綠、海綠、海軍綠的斜塊；水線的防污帶；淡鏽痕
    甲板  綠色迷彩、鋼板的深淺與接縫。兩棲艦的迷彩連甲板一起做，要融進長滿植被的
          小島（naval-encyclopedia 的兩棲艦條目）；確切的甲板設計沒查到，斑塊是照
          手法排的
    其餘  海軍綠（單色區 = 水平面、條與條之間的空白）

【圖案的出處】海軍 1944-06 替 LST-1 級出過 Design 18L，設計圖沒拿到。
- a 的右舷照 LST-942 在 1944 年底的彩色照片（圖說寫 Design 8L 或 18L）的配置畫：
  艦尾下半海綠、舯段下緣一塊深綠、中段大片霧綠夾一條海綠斜帶、艦首兩道深綠斜帶
- a 的左舷、b、c 都是照同一套手法另排的 —— **不是史實的設計**。同一批 LST 本來就
  有好幾種設計（8L、18L …），另排兩種是為了並排的船看得出不同

漆色照海軍規範的孟塞爾值換成 sRGB（C 光源轉 D65）：

    5-HG 霧綠    5GY 6/2    反射率 30%
    5-OG 海綠    5GY 5/2    反射率 20%
    5-NG 海軍綠  10GY 3/2   反射率 7%
    82 暗黑      N 2.5/     反射率 3%（防污帶）

鋼板深淺、鏽痕的量是**起始值**，由截圖裁定。
"""
import sys
from ship_paint import ShipLivery, SIDES

HAZE_GREEN = (143, 151, 124)   # 5-HG
OCEAN_GREEN = (118, 125, 101)  # 5-OG
NAVY_GREEN = (61, 75, 62)      # 5-NG
BOOT_TOP = (60, 60, 60)        # 82
RUST = (104, 70, 50)
SEAM = (44, 55, 45)

BOOT_TOP_Y = 0.4

# 艦尾與艦首的 z（船身的兩端）。圖案用 u 寫：0 = 艦尾、1 = 艦首
Z_STERN, Z_BOW = 50.4, -50.7

# 每一種圖案：立面的底色、甲板的底色，與三條各自的色塊 (顏色, [(u, y 或 x), ...])。
# 立面的 y 是 m（水線為 0）；甲板的 x 是 m（+X 右舷）。伸出條外的部分會被裁掉
VARIANTS = {
    'a': {
        'side': HAZE_GREEN, 'deck_base': NAVY_GREEN,
        'starboard': [
            (OCEAN_GREEN, [(-0.02, -2), (0.33, -2), (0.30, 3.5), (-0.02, 5.0)]),
            (OCEAN_GREEN, [(0.60, -2), (0.66, -2), (0.62, 9), (0.55, 9)]),
            (OCEAN_GREEN, [(0.10, 9), (0.20, 9), (0.18, 17), (0.08, 17)]),
            (NAVY_GREEN, [(0.35, -2), (0.47, -2), (0.46, 2.5), (0.40, 4.0), (0.36, 3.0)]),
            (NAVY_GREEN, [(0.77, -2), (0.83, -2), (0.92, 9), (0.86, 9)]),
            (NAVY_GREEN, [(0.94, -2), (1.03, -2), (1.03, 9), (0.97, 9), (0.95, 4)]),
            (NAVY_GREEN, [(0.16, 8), (0.22, 8), (0.26, 16), (0.20, 16)]),
        ],
        'port': [
            (OCEAN_GREEN, [(-0.02, -2), (0.20, -2), (0.24, 9), (-0.02, 9)]),
            (OCEAN_GREEN, [(0.48, -2), (0.58, -2), (0.52, 9), (0.44, 9)]),
            (NAVY_GREEN, [(0.26, -2), (0.36, -2), (0.33, 5), (0.27, 3)]),
            (NAVY_GREEN, [(0.70, -2), (0.76, -2), (0.84, 9), (0.78, 9)]),
            (NAVY_GREEN, [(0.88, -2), (0.96, -2), (1.03, 5), (1.03, 9), (0.95, 9)]),
            (NAVY_GREEN, [(0.10, 9), (0.15, 9), (0.12, 17), (0.07, 17)]),
        ],
        'deck': [
            (OCEAN_GREEN, [(0.05, -9), (0.22, -9), (0.30, 9), (0.14, 9)]),
            (OCEAN_GREEN, [(0.48, -9), (0.58, -9), (0.50, 9), (0.40, 9)]),
            (OCEAN_GREEN, [(0.74, -9), (0.84, -9), (0.92, 9), (0.80, 9)]),
        ],
    },
    # 細一點的斜帶，一路斜到底
    'b': {
        'side': HAZE_GREEN, 'deck_base': OCEAN_GREEN,
        'starboard': [
            (OCEAN_GREEN, [(-0.02, -2), (0.12, -2), (0.20, 9), (-0.02, 9)]),
            (OCEAN_GREEN, [(0.40, -2), (0.52, -2), (0.46, 9), (0.34, 9)]),
            (NAVY_GREEN, [(0.18, -2), (0.26, -2), (0.34, 9), (0.26, 9)]),
            (NAVY_GREEN, [(0.55, -2), (0.62, -2), (0.70, 9), (0.63, 9)]),
            (NAVY_GREEN, [(0.80, -2), (0.90, -2), (0.84, 9), (0.74, 9)]),
            (NAVY_GREEN, [(0.05, 9), (0.12, 9), (0.20, 17), (0.13, 17)]),
        ],
        'port': [
            (OCEAN_GREEN, [(0.14, -2), (0.28, -2), (0.22, 9), (0.08, 9)]),
            (OCEAN_GREEN, [(0.66, -2), (0.74, -2), (0.82, 9), (0.72, 9)]),
            (NAVY_GREEN, [(0.36, -2), (0.44, -2), (0.52, 9), (0.44, 9)]),
            (NAVY_GREEN, [(0.88, -2), (1.03, -2), (1.03, 9), (0.94, 9)]),
            (NAVY_GREEN, [(-0.02, -2), (0.06, -2), (0.02, 6), (-0.02, 7)]),
            (NAVY_GREEN, [(0.16, 9), (0.22, 9), (0.14, 17), (0.08, 17)]),
        ],
        'deck': [
            (NAVY_GREEN, [(0.10, -9), (0.18, -9), (0.26, 9), (0.18, 9)]),
            (NAVY_GREEN, [(0.44, -9), (0.52, -9), (0.60, 9), (0.52, 9)]),
            (NAVY_GREEN, [(0.78, -9), (0.86, -9), (0.94, 9), (0.86, 9)]),
        ],
    },
    # 海綠打底，大塊的霧綠與深綠
    'c': {
        'side': OCEAN_GREEN, 'deck_base': NAVY_GREEN,
        'starboard': [
            (HAZE_GREEN, [(0.10, 3), (0.30, 3), (0.34, 17), (0.08, 17)]),
            (HAZE_GREEN, [(0.60, 2), (0.78, 4), (0.80, 9), (0.58, 9)]),
            (NAVY_GREEN, [(0.35, -2), (0.55, -2), (0.50, 3), (0.38, 4)]),
            (NAVY_GREEN, [(0.85, -2), (1.03, -2), (1.03, 6), (0.92, 8)]),
            (NAVY_GREEN, [(-0.02, -2), (0.08, -2), (0.05, 4), (-0.02, 5)]),
            (NAVY_GREEN, [(0.15, 9), (0.19, 9), (0.23, 17), (0.19, 17)]),
        ],
        'port': [
            (HAZE_GREEN, [(0.02, 2), (0.24, 5), (0.22, 17), (0.00, 17)]),
            (HAZE_GREEN, [(0.46, 3), (0.66, 1), (0.70, 9), (0.44, 9)]),
            (NAVY_GREEN, [(0.24, -2), (0.40, -2), (0.36, 4), (0.26, 3)]),
            (NAVY_GREEN, [(0.72, -2), (0.86, -2), (0.90, 9), (0.80, 9)]),
            (NAVY_GREEN, [(0.10, 9), (0.14, 9), (0.10, 17), (0.06, 17)]),
        ],
        'deck': [
            (OCEAN_GREEN, [(0.00, -9), (0.30, -9), (0.30, 1), (0.00, 3)]),
            (OCEAN_GREEN, [(0.40, 0), (0.70, -2), (0.70, 9), (0.40, 9)]),
            (OCEAN_GREEN, [(0.80, -9), (1.03, -9), (1.03, -1), (0.84, 1)]),
        ],
    },
}


def z_of(u):
    return Z_STERN + u * (Z_BOW - Z_STERN)


def main(faces, variant, outline=None):
    V = VARIANTS[variant]
    L = ShipLivery(faces)
    z0, z1 = L.L['zMin'], L.L['zMax']
    y0, y1 = L.L['yMin'], L.L['yMax']
    hb = L.L['halfBeam']
    top = L.hull_top('LST_Body')

    L.fill_all(NAVY_GREEN)
    for s in SIDES:
        L.fill(s, V['side'])
        for color, pts in V[s]:
            L.poly(s, [(z_of(u), y) for u, y in pts], color)
        # 鋼板：一列約 1.6 m 高、6 m 長
        L.plates(s, z0 - 1, z1 + 1, y0 - 1, y1 + 1, 6.0, 1.6, 4, seed=111 if s == 'port' else 112)
        L.streaks(s, z0 + 4, z1 - 3, top, 2.2, RUST, 30, seed=121 if s == 'port' else 122)
        # 往條外延伸 0.4 m（約 5 px），在延色的半個空白之內
        L.rect(s, z0 - 0.4, y0 - 0.4, z1 + 0.4, BOOT_TOP_Y, BOOT_TOP)

    L.fill('deck', V['deck_base'])
    for color, pts in V['deck']:
        L.poly('deck', [(z_of(u), x) for u, x in pts], color)
    L.plates('deck', z0 - 1, z1 + 1, -hb - 1, hb + 1, 6.0, 1.5, 5, seed=131)
    L.seams('deck', z0, z1, -hb, hb, 6.0, 1.5, SEAM)
    L.top(NAVY_GREEN, SEAM, seed=161)
    L.save(outline, suffix='' if variant == 'a' else '_' + variant)


main(*sys.argv[1:])
