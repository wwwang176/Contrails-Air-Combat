# -*- coding: utf-8 -*-
"""
Essex：Measure 21（1945 年 3 月之前由 Measure 32/6-10D 改漆，NavSource 的照片說明）。

    npx vite-node test/tools/ship-livery-faces.ts -- essex <faces.json>
    python tools/livery/ship_essex.py <faces.json> [檢查圖.png]

    立面  海軍藍底、船殼鋼板一列列的深淺、水線的防污帶、機庫甲板舷緣往下的淡鏽痕
    甲板  木飛行甲板染 Flight Deck Stain 21（與 20-B 同色）：沿長度方向一條條木板帶的
          深淺與對接縫。艦首端一個大「9」，深色、淺色細邊，字頂朝艦首（從艦尾進場
          讀得正）—— 照 1945-05-20 的兩張空拍（Wikimedia Commons「USS Essex (CV-9)
          underway ... 20 May 1945」）。那兩張看不到白色的中線或邊線，所以不畫
    其餘  甲板藍（單色區、條與條之間的空白）

漆色照海軍規範（Ships-2）的孟塞爾值換成 sRGB（C 光源轉 D65），見 `ship_fletcher.py`。
鋼板深淺、木板帶、鏽痕的量是**起始值**，由截圖裁定。
"""
import sys
from ship_paint import ShipLivery, SIDES

NAVY_BLUE = (70, 81, 103)      # 5-N
DECK_BLUE = (55, 72, 101)      # 20-B／Flight Deck Stain 21
BOOT_TOP = (60, 60, 60)        # 82
RUST = (104, 70, 50)
PLANK_SEAM = (44, 58, 84)

BOOT_TOP_Y = 0.8

# 甲板舷號：深色字、淺色細邊。飛行甲板艦首端在 z −131.5，字心往艦尾 24 m
NUMBER = (38, 42, 50)
NUMBER_EDGE = (150, 155, 162)
DECK_NUMBER_Z = -107.5


def main(faces, outline=None):
    L = ShipLivery(faces)
    z0, z1 = L.L['zMin'], L.L['zMax']
    y0, y1 = L.L['yMin'], L.L['yMax']
    hb = L.L['halfBeam']
    top = L.hull_top('ESSEX_Hull')

    L.fill_all(DECK_BLUE)
    for s in SIDES:
        L.fill(s, NAVY_BLUE)
        # 鋼板：一列約 2.4 m 高、9 m 長
        L.plates(s, z0 - 2, z1 + 2, y0 - 2, y1 + 2, 9.0, 2.4, 4, seed=71 if s == 'port' else 72)
        L.streaks(s, z0 + 8, z1 - 8, top, 4.0, RUST, 60, seed=81 if s == 'port' else 82)
        # 往條外延伸 0.8 m（約 5 px），在延色的半個空白之內
        L.rect(s, z0 - 0.8, y0 - 0.8, z1 + 0.8, BOOT_TOP_Y, BOOT_TOP)

    L.fill('deck', DECK_BLUE)
    # 木板帶：沿長度方向，一條 1.2 m 寬、12 m 長一段，相鄰兩條錯開半段
    L.plates('deck', z0 - 2, z1 + 2, -hb - 2, hb + 2, 12.0, 1.2, 6, seed=91)
    L.seams('deck', z0, z1, -hb, hb, 12.0, 1.2, PLANK_SEAM, width_m=0.06)
    # 舷號：艦首端、中線上。字寬約是艦首那一段甲板寬的四成多（照片的比例），**起始值**
    L.text('deck', DECK_NUMBER_Z, 0.0, '9', 22.0, NUMBER, rotate=90,
           outline=NUMBER_EDGE, outline_m=0.3)
    L.save(outline)


main(*sys.argv[1:])
