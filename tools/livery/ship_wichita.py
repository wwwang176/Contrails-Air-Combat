# -*- coding: utf-8 -*-
"""
Wichita：Measure 22（1943–45 年的照片）。

    npx vite-node test/tools/ship-livery-faces.ts -- wichita <faces.json>
    python tools/livery/ship_wichita.py <faces.json> [檢查圖.png]

    立面  一條水平分界線：線下 5-N 海軍藍、線上 5-H 霧灰。線的高度是主甲板舷緣
          最低的那一點 —— 規範要的是水平線、不沿舷弧走，所以艦首那一段舷弧高起來
          的地方露出一塊霧灰的楔形
          船殼鋼板一列列的深淺、水線的防污帶、甲板邊往下的淡鏽痕
    甲板  甲板藍底、鋼板的深淺與接縫
    其餘  甲板藍（單色區、條與條之間的空白）

漆色照海軍規範（Ships-2）的孟塞爾值換成 sRGB（C 光源轉 D65）：

    5-N 海軍藍   5PB 3.4/3   反射率 9%
    5-H 霧灰     5PB 6/2     反射率 28%
    20-B 甲板藍  5PB 3/4     反射率 5%
    82 暗黑      N 2.5/      反射率 3%（防污帶用它；防污帶本身的規格沒查到）

鋼板深淺、鏽痕的量是**起始值**，由截圖裁定。
"""
import sys
from ship_paint import ShipLivery, SIDES

NAVY_BLUE = (70, 81, 103)      # 5-N
HAZE_GRAY = (141, 148, 159)    # 5-H
DECK_BLUE = (55, 72, 101)      # 20-B
BOOT_TOP = (60, 60, 60)        # 82
RUST = (104, 70, 50)
SEAM = (40, 52, 76)

# 防污帶的上緣，m（水線以上）
BOOT_TOP_Y = 0.6


def main(faces, outline=None):
    L = ShipLivery(faces)
    z0, z1 = L.L['zMin'], L.L['zMax']
    y0, y1 = L.L['yMin'], L.L['yMax']
    hb = L.L['halfBeam']
    top = L.hull_top('WICHITA_Hull')
    line = top.lowest
    print(f'Measure 22 分界線 y = {line:.2f} m')

    L.fill_all(DECK_BLUE)
    for s in SIDES:
        L.fill(s, HAZE_GRAY)
        # 線下海軍藍，往條外延伸 0.4 m（約 4 px），在延色的半個空白之內
        L.rect(s, z0 - 0.4, y0 - 0.4, z1 + 0.4, line, NAVY_BLUE)
        # 鋼板：一列約 2 m 高、7 m 長
        L.plates(s, z0 - 1, z1 + 1, y0 - 1, y1 + 1, 7.0, 2.0, 4, seed=41 if s == 'port' else 42)
        L.streaks(s, z0 + 6, z1 - 3, top, 3.0, RUST, 44, seed=51 if s == 'port' else 52)
        L.rect(s, z0 - 0.4, y0 - 0.4, z1 + 0.4, BOOT_TOP_Y, BOOT_TOP)

    L.fill('deck', DECK_BLUE)
    L.plates('deck', z0 - 1, z1 + 1, -hb - 1, hb + 1, 7.0, 1.8, 5, seed=61)
    L.seams('deck', z0, z1, -hb, hb, 7.0, 1.8, SEAM)
    L.save(outline)


main(*sys.argv[1:])
