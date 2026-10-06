# -*- coding: utf-8 -*-
"""
Fletcher：Measure 21（1942–43 太平洋），立面全身海軍藍、水平面甲板藍。

    npx vite-node test/tools/ship-livery-faces.ts -- fletcher <faces.json>
    python tools/livery/ship_fletcher.py <faces.json> [檢查圖.png]

    立面  海軍藍底、船殼鋼板一列列的深淺、水線的黑色防污帶、甲板邊往下的淡鏽痕
    甲板  甲板藍底、鋼板的深淺與接縫
    其餘  甲板藍（單色區、條與條之間的空白）

漆色照海軍規範（Ships-2）的孟塞爾值換成 sRGB（C 光源轉 D65）：

    5-N 海軍藍   5PB 3.4/3   反射率 9%
    20-B 甲板藍  5PB 3/4     反射率 5%
    82 暗黑      N 2.5/      反射率 3%（防污帶用它；防污帶本身的規格沒查到）

新漆的顏色。Measure 21 的深藍幾個月就氧化褪淺，舊船會比這淺。鋼板深淺、鏽痕的
量是**起始值**，由截圖裁定。
"""
import sys
from ship_paint import ShipLivery, SIDES

NAVY_BLUE = (70, 81, 103)      # 5-N
DECK_BLUE = (55, 72, 101)      # 20-B
BOOT_TOP = (60, 60, 60)        # 82
RUST = (104, 70, 50)
SEAM = (40, 52, 76)

# 防污帶的上緣，m（水線以上）
BOOT_TOP_Y = 0.45


def main(faces, outline=None):
    L = ShipLivery(faces)
    z0, z1 = L.L['zMin'], L.L['zMax']
    y0, y1 = L.L['yMin'], L.L['yMax']
    hb = L.L['halfBeam']
    top = L.hull_top('FLETCHER_Hull')

    L.fill_all(DECK_BLUE)
    for s in SIDES:
        L.fill(s, NAVY_BLUE)
        # 鋼板：一列約 1.8 m 高、6 m 長
        L.plates(s, z0 - 1, z1 + 1, y0 - 1, y1 + 1, 6.0, 1.8, 4, seed=11 if s == 'port' else 12)
        L.streaks(s, z0 + 4, z1 - 2, top, 2.4, RUST, 36, seed=21 if s == 'port' else 22)
        # 往條外延伸 0.4 m（約 7 px），在延色的半個空白之內
        L.rect(s, z0 - 0.4, y0 - 0.4, z1 + 0.4, BOOT_TOP_Y, BOOT_TOP)

    L.fill('deck', DECK_BLUE)
    L.plates('deck', z0 - 1, z1 + 1, -hb - 1, hb + 1, 6.0, 1.5, 5, seed=31)
    L.seams('deck', z0, z1, -hb, hb, 6.0, 1.5, SEAM)
    L.top(DECK_BLUE, SEAM, seed=41)
    L.save(outline)


if __name__ == '__main__':
    main(*sys.argv[1:])
