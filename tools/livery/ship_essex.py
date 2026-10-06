# -*- coding: utf-8 -*-
"""
Essex：Measure 21（1945 年 3 月之前由 Measure 32/6-10D 改漆，NavSource 的照片說明）。

    npx vite-node test/tools/ship-livery-faces.ts -- essex <faces.json>
    python tools/livery/ship_essex.py <faces.json> [檢查圖.png]

    立面  海軍藍底、船殼鋼板一列列的深淺、水線的防污帶、機庫甲板舷緣往下的淡鏽痕
    甲板  木飛行甲板染 Flight Deck Stain 21（與 20-B 同色）：木板橫向鋪、一條條色帶的
          深淺與橫向的板縫；淺色直虛線三條（中線一條、兩舷靠甲板邊各一條）；兩座中線
          升降機的外框（Essex 級的側視與俯視圖）。兩端的「9」是貼花（`render/shipNumbers.ts`），不在這張圖上
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

# 甲板標線：三條虛線與升降機外框（淺色）。虛線由艦首一路到艦尾，兩端號碼疊在上面
# （號碼是貼花，字外透明，虛線從字縫裡露出來）。甲板兩端在 z −131.5 與 129.5
MARKING = (205, 205, 198)
ELEV_EDGE = (120, 132, 150)
DASH, DASH_W = 3.0, 0.4
DASH_FROM, DASH_TO = -130.5, 128.5
# 兩舷的邊線虛線：直線，離甲板主段最窄處 1.5 m。主段是兩端收圓角以內
EDGE_IN = 1.5
EDGE_FROM, EDGE_TO = -130.5, 128.5
EDGE_SPAN = (-115.0, 115.0)
# 兩座中線升降機：前一座在艦島之前、後一座在艦島之後。約 14.6 × 13.4 m。前一座與
# 艦首號碼的字框（z −122 … −93）之間留 16 m，貼太近看起來像號碼的框
ELEVATORS = (-70.0, 40.8)
ELEV_LEN, ELEV_WID = 14.6, 13.4


def deck_edges(L, step=1.0):
    """飛行甲板（不含舷側升降機）每一段 z 的右舷與左舷邊：回傳兩個 z → x 的函式，
    站位之間線性內插"""
    hi, lo = {}, {}
    for f in L.faces:
        if f['node'] != 'ESSEX_Deck':
            continue
        for x, y, z in f['pos']:
            k = round(z / step)
            hi[k] = max(hi.get(k, -1e9), x)
            lo[k] = min(lo.get(k, 1e9), x)
    ks = sorted(hi)

    def interp(table):
        def at(z):
            q = z / step
            if q <= ks[0]:
                return table[ks[0]]
            if q >= ks[-1]:
                return table[ks[-1]]
            for a, b in zip(ks, ks[1:]):
                if a <= q <= b:
                    t = (q - a) / (b - a)
                    return table[a] + (table[b] - table[a]) * t
        return at
    return interp(hi), interp(lo)


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
    # 木板是**橫向**鋪的（跨過甲板寬度）：沿長度一條 1.2 m 的色帶、橫向每 8 m 一段，
    # 相鄰兩條錯開半段；每 2.4 m 一道橫向的板縫／繫留條
    L.plates('deck', z0 - 2, z1 + 2, -hb - 2, hb + 2, 1.2, 8.0, 6, seed=91)
    z = z0
    while z <= z1:
        L.line('deck', z, -hb, z, hb, PLANK_SEAM, width_m=0.08)
        z += 2.4
    # 中線虛線：兩端號碼之間，3 m 一段、空 3 m
    z = DASH_FROM
    while z + DASH < DASH_TO:
        L.rect('deck', z, -DASH_W / 2, z + DASH, DASH_W / 2, MARKING)
        z += 2 * DASH
    # 兩舷的邊線虛線：**直線**，取甲板主段（EDGE_SPAN 之內）最窄處往內縮 EDGE_IN。
    # 兩端收圓角的地方線會跑出甲板外，那裡沒有甲板面，畫了也看不到
    stbd, port = deck_edges(L)
    zs = [EDGE_SPAN[0] + k for k in range(int(EDGE_SPAN[1] - EDGE_SPAN[0]) + 1)]
    xs = (min(stbd(q) for q in zs) - EDGE_IN, max(port(q) for q in zs) + EDGE_IN)
    print(f'邊線虛線 x = {xs[0]:.2f} / {xs[1]:.2f} m')
    z = EDGE_FROM
    while z + DASH < EDGE_TO:
        for x in xs:
            L.rect('deck', z, x - DASH_W / 2, z + DASH, x + DASH_W / 2, MARKING)
        z += 2 * DASH
    # 兩座中線升降機的外框
    for zc in ELEVATORS:
        zc0, zc1 = zc - ELEV_LEN / 2, zc + ELEV_LEN / 2
        xc = ELEV_WID / 2
        for a0, b0, a1, b1 in ((zc0, -xc, zc1, -xc), (zc0, xc, zc1, xc),
                               (zc0, -xc, zc0, xc), (zc1, -xc, zc1, xc)):
            L.line('deck', a0, b0, a1, b1, ELEV_EDGE, width_m=0.3)
    L.top(DECK_BLUE, (40, 52, 76), seed=141)
    L.save(outline)


if __name__ == '__main__':
    main(*sys.argv[1:])
