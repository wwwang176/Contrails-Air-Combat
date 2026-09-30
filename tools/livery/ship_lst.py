# -*- coding: utf-8 -*-
"""
LST：Measure 31 綠色迷彩。

    npx vite-node test/tools/ship-livery-faces.ts -- lst <faces.json>
    python tools/livery/ship_lst.py <faces.json> [檢查圖.png]

    立面  淺的霧綠打底，海綠與海軍綠的斜塊；水線的防污帶；淡鏽痕
    甲板  海軍綠底、海綠的斑塊、鋼板的深淺與接縫。兩棲艦的迷彩連甲板一起做，
          要融進長滿植被的小島（naval-encyclopedia 的兩棲艦條目）；確切的甲板
          設計沒查到，斑塊是照手法排的
    其餘  海軍綠（單色區 = 水平面、條與條之間的空白）

【圖案的出處】海軍 1944-06 替 LST-1 級出過 Design 18L，設計圖沒拿到。右舷照
LST-942 在 1944 年底的彩色照片（圖說寫 Design 8L 或 18L）的配置畫：艦尾下半海綠、
舯段下緣一塊深綠、中段大片霧綠夾一條海綠斜帶、艦首兩道深綠斜帶。**左舷照片看不到**，
圖案是照同一套手法另排的 —— 迷彩兩舷本來就不同，這一側不是史實。

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

# (顏色, [(u, y), ...])。y 是 m（水線為 0）；超出船身的部分畫在空處，不影響
PATTERN = {
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
    # 甲板：(u, x)，x 是 m（+X 右舷）
    'deck': [
        (OCEAN_GREEN, [(0.05, -9), (0.22, -9), (0.30, 9), (0.14, 9)]),
        (OCEAN_GREEN, [(0.48, -9), (0.58, -9), (0.50, 9), (0.40, 9)]),
        (OCEAN_GREEN, [(0.74, -9), (0.84, -9), (0.92, 9), (0.80, 9)]),
    ],
}


def z_of(u):
    return Z_STERN + u * (Z_BOW - Z_STERN)


def main(faces, outline=None):
    L = ShipLivery(faces)
    z0, z1 = L.L['zMin'], L.L['zMax']
    y0, y1 = L.L['yMin'], L.L['yMax']
    hb = L.L['halfBeam']
    top = L.hull_top('LST_Body')

    L.fill_all(NAVY_GREEN)
    for s in SIDES:
        L.fill(s, HAZE_GREEN)
        for color, pts in PATTERN[s]:
            L.poly(s, [(z_of(u), y) for u, y in pts], color)
        # 鋼板：一列約 1.6 m 高、6 m 長
        L.plates(s, z0 - 1, z1 + 1, y0 - 1, y1 + 1, 6.0, 1.6, 4, seed=111 if s == 'port' else 112)
        L.streaks(s, z0 + 4, z1 - 3, top, 2.2, RUST, 30, seed=121 if s == 'port' else 122)
        # 往條外延伸 0.4 m（約 5 px），在延色的半個空白之內
        L.rect(s, z0 - 0.4, y0 - 0.4, z1 + 0.4, BOOT_TOP_Y, BOOT_TOP)

    L.fill('deck', NAVY_GREEN)
    for color, pts in PATTERN['deck']:
        L.poly('deck', [(z_of(u), x) for u, x in pts], color)
    L.plates('deck', z0 - 1, z1 + 1, -hb - 1, hb + 1, 6.0, 1.5, 5, seed=131)
    L.seams('deck', z0, z1, -hb, hb, 6.0, 1.5, SEAM)
    L.save(outline)


main(*sys.argv[1:])
