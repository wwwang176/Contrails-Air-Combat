# -*- coding: utf-8 -*-
"""
美軍地面單位三台：M4A3 雪曼、M16 多管機槍運輸車（M45 四聯裝 .50）、
GMC CCKW-353 兩噸半卡車。日 M2 雷伊泰的車隊用。

用法（Blender 5.x）：**先執行 `build_ground.py`**（工具函式、材質、集合都在
那裡），再
    exec(open(r'tools/blender/build_ground_us.py', encoding='utf-8').read())
建完 `LOG_US` 裡有三角形數、尺寸與遊戲座標的命中盒；`export_us()` 匯出三支
GLB 到本 repo 的 models-src/。

座標與 `build_ground.py` 相同：Blender 系 X 橫向、**+Y 車頭／砲口**、Z 上、
底面 z = 0、中線 x = 0。材質只帶名字（LP_*），顏色由遊戲照名字重貼。

── 參考模型的量法與換算 ──────────────────────────────────────
  M4A3      參考模型就是公尺、+Y 車頭（車體長 5.83、寬 2.59，史實 5.84 × 2.62），
            照抄。車體頂由車尾 1.38 緩升到 1.69，前斜甲板 y 1.85 → 2.60 由 1.62
            降到 0.95。履帶頂 1.075 就是上車體（蓋在履帶上方那一截）的底。
  M16       參考模型沿 +X 車頭、單位不是公尺。縮放 0.0496（全長 131.2 對史實
            6.51；全寬出來 2.11 對 2.16）。天線頂到 3.87，不算。四聯裝槍塔在
            參考模型裡槍口朝前、水平，這裡照 Flak 38 抬 25°。
  CCKW      參考模型 −Y 車頭。長與高乘 1.19、寬乘 1.04：前軸到後雙軸中心 3.51
            → 史實 4.17、雙軸間距 0.95 → 1.12（史實 1.12）、輪半徑 0.387 → 0.46
            （7.50-20 輪胎）；寬若也乘 1.19 會變成 2.57，史實 2.24。
"""
import bpy, math, os
from mathutils import Vector, Matrix

REPO = r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\jp-m2"
OUT_DIR_US = os.path.join(REPO, "models-src")
LOG_US = {}


def fender(x0, x1, path, t=0.06):
    """一片順著側視輪廓彎的葉子板：`path` 是 [(y, 頂面 z), …]，由前往後；
    x0…x1 是它的橫向範圍，t 是板厚。從保險桿上方彎過輪子、落到踏板那一整條。"""
    return loft([(y, [(x0, z - t), (x1, z - t), (x1, z), (x0, z)]) for (y, z) in path])

# ═══════════════════════════ 1. M4A3 雪曼 ═══════════════════════════
C = fresh('M4A3')
LW = 0.84              # 兩條履帶之間的車體半寬
UW = 1.30              # 上車體半寬，蓋在履帶上方
ZT = 1.075             # 履帶頂＝上車體底
TR_IN, TR_OUT = 0.87, 1.29


def m4_prof(zb, zt, uw=UW):
    """車體橫剖面：下半縮在履帶之間，上半伸出去蓋在履帶上方。"""
    zk = min(ZT, zt)
    return [(0, zb), (LW, zb), (LW, zk), (uw, zk), (uw, zt), (0, zt),
            (-uw, zt), (-uw, zk), (-LW, zk), (-LW, zb)]


mk('M4_Hull', *loft([
    (-2.88, m4_prof(0.55, 1.36, 0.90)),
    (-2.60, m4_prof(0.36, 1.41, 1.10)),
    (-1.95, m4_prof(0.33, 1.48, UW)),
    ( 0.50, m4_prof(0.33, 1.69)),
    ( 1.80, m4_prof(0.33, 1.69)),
    ( 2.60, m4_prof(0.40, 0.95)),    # 前斜甲板：y 1.80 → 2.60 由 1.69 降到 0.95
    ( 2.82, m4_prof(0.62, 0.74)),    # 車鼻（傳動罩）
]), C, M_ARMOR)

# 履帶的側視環：後端誘導輪、前端驅動輪較高，底下著地段 −2.00 … 2.30
M4_RING = [
    ((-2.55, 0.95), (-2.42, 0.86)), ((-2.55, 0.42), (-2.42, 0.48)),
    ((-2.05, 0.00), (-2.05, 0.13)), (( 2.30, 0.00), ( 2.30, 0.13)),
    (( 2.90, 0.62), ( 2.76, 0.62)), (( 2.80, 1.00), ( 2.66, 0.94)),
    (( 2.45, ZT),   ( 2.45, ZT - 0.11)), ((-2.30, ZT), (-2.30, ZT - 0.11)),
]
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    x0, x1 = sorted((s * TR_IN, s * TR_OUT))
    xc = s * (TR_IN + TR_OUT) / 2
    mk('M4_Track_' + tag, *band(M4_RING, x0, x1), C, M_TRACK)
    # 垂直懸吊（VVSS）：三組台車，每組兩個負重輪
    for i, yb in enumerate((-1.45, 0.05, 1.55)):
        for k, dy in enumerate((-0.30, 0.30)):
            mk('M4_Wheel_%s%d%d' % (tag, i, k), *cyl(xc, yb + dy, 0.30, 0.26, 0.30, axis='X', seg=12), C, M_TRACK)
        mk('M4_Bogie_%s%d' % (tag, i), *box(s * (LW + 0.05), yb, 0.55, 0.14, 0.62, 0.34), C, M_STEEL)
    mk('M4_Sprocket_' + tag, *cyl(xc, 2.60, 0.69, 0.32, 0.34, axis='X', seg=12), C, M_TRACK)
    mk('M4_Idler_' + tag, *cyl(xc, -2.25, 0.62, 0.27, 0.34, axis='X', seg=12), C, M_TRACK)

# 砲塔：鑄造的圓砲塔 —— 橫剖面是圓弧，俯視前窄、中寬、後面收成一個尾艙；
# 頂 2.46，後緣降到 2.28、前緣降到 2.02
M4_TB = 1.69


def m4_tprof(w, zt):
    h = zt - M4_TB
    return [(-w, M4_TB), (w, M4_TB), (w, M4_TB + 0.30 * h), (w * 0.94, M4_TB + 0.62 * h),
            (w * 0.78, M4_TB + 0.86 * h), (w * 0.45, zt), (-w * 0.45, zt),
            (-w * 0.78, M4_TB + 0.86 * h), (-w * 0.94, M4_TB + 0.62 * h), (-w, M4_TB + 0.30 * h)]


mk('M4_Turret', *loft([
    (-1.04, m4_tprof(0.40, 2.22)),
    (-0.88, m4_tprof(0.58, 2.36)),
    (-0.62, m4_tprof(0.72, 2.45)),
    (-0.30, m4_tprof(0.92, 2.46)),
    ( 0.20, m4_tprof(0.99, 2.46)),
    ( 0.55, m4_tprof(0.92, 2.45)),
    ( 0.80, m4_tprof(0.74, 2.38)),
    ( 0.96, m4_tprof(0.56, 2.24)),
    ( 1.06, m4_tprof(0.40, 2.04)),
]), C, M_ARMOR)
# 砲盾：比砲塔前緣窄、往前凸一點
mk('M4_Mantlet', *loft([
    (0.98, [(-0.33, 1.84), (0.33, 1.84), (0.36, 2.08), (0.33, 2.32), (-0.33, 2.32), (-0.36, 2.08)]),
    (1.22, [(-0.26, 1.88), (0.26, 1.88), (0.29, 2.08), (0.26, 2.28), (-0.26, 2.28), (-0.29, 2.08)]),
]), C, M_ARMOR)
mk('M4_Cupola', *cyl(0.45, -0.15, 2.52, 0.34, 0.12, axis='Z', seg=10), C, M_ARMOR)
mk('M4_Hatch', *box(-0.40, 0.05, 2.49, 0.46, 0.46, 0.06), C, M_ARMOR)
# 砲身：75 mm M3，y 1.20 → 3.02
mk('M4_Gun', *cyl(0, 2.11, 2.074, 0.075, 1.82, axis='Y', seg=10), C, M_STEEL)
mk('M4_BowMG', *cyl(0.55, 2.38, 1.26, 0.10, 0.22, axis='Y', seg=8), C, M_ARMOR)
mk('M4_BowMGBarrel', *cyl(0.55, 2.62, 1.26, 0.025, 0.36, axis='Y', seg=6), C, M_STEEL)
mk('M4_EngineDeck', *box(0, -1.95, 1.47, 1.70, 1.10, 0.06), C, M_ARMOR)

# ═══════════════════════════ 2. M16 MGMC ═══════════════════════════
C = fresh('M16')
BW = 1.03              # 後車廂半寬
FLOOR, WALL = 1.11, 1.65
M16_TR_IN, M16_TR_OUT = 0.66, 1.00

mk('M16_Frame', *box(0, 0.15, 0.72, 0.90, 6.10, 0.18), C, M_STEEL)
# 後車廂：開頂，底板加四面牆
mk('M16_BedFloor', *box(0, -1.40, FLOOR - 0.04, 2 * BW, 3.00, 0.08), C, M_ARMOR)
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    mk('M16_BedWall_' + tag, *box(s * (BW - 0.03), -1.40, (0.95 + WALL) / 2, 0.06, 3.00, WALL - 0.95), C, M_ARMOR)
mk('M16_BedTail', *box(0, -2.87, (0.70 + WALL) / 2, 2 * BW, 0.06, WALL - 0.70), C, M_ARMOR)
# 駕駛室：側牆與後車廂同高，前面一片立起來的裝甲擋風板
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    mk('M16_CabWall_' + tag, *box(s * (BW - 0.03), 0.62, (0.90 + WALL) / 2, 0.06, 1.04, WALL - 0.90), C, M_ARMOR)
mk('M16_CabFloor', *box(0, 0.62, 0.88, 2 * BW, 1.04, 0.08), C, M_ARMOR)
mk('M16_Windshield', *slab([(-0.96, 1.18, 1.20), (0.96, 1.18, 1.20), (0.96, 1.10, 1.90), (-0.96, 1.10, 1.90)], -0.05), C, M_ARMOR)
mk('M16_Dash', *box(0, 1.14, 1.05, 1.80, 0.10, 0.30), C, M_ARMOR)
# 引擎蓋與水箱裝甲
mk('M16_Hood', *loft([
    (1.18, [(-0.69, 0.82), (0.69, 0.82), (0.69, 1.46), (0.50, 1.53), (-0.50, 1.53), (-0.69, 1.46)]),
    (2.60, [(-0.66, 0.82), (0.66, 0.82), (0.66, 1.40), (0.48, 1.46), (-0.48, 1.46), (-0.66, 1.40)]),
]), C, M_ARMOR)
mk('M16_Radiator', *box(0, 2.66, 1.12, 1.30, 0.10, 0.62), C, M_ARMOR)
# 前葉子板：從車頭（0.95）彎上前輪（頂 1.22），落到駕駛室門下（0.92）
M16_FENDER = [(3.00, 0.95), (2.82, 1.12), (2.55, 1.21), (1.80, 1.22), (1.55, 1.10), (1.30, 0.92), (0.95, 0.92)]
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    x0, x1 = sorted((s * 0.62, s * 1.05))
    mk('M16_Fender_' + tag, *fender(x0, x1, M16_FENDER), C, M_ARMOR)
    mk('M16_WheelF_' + tag, *cyl(s * 0.83, 2.17, 0.47, 0.47, 0.30, axis='X', seg=12), C, M_TIRE)
mk('M16_Roller', *cyl(0, 3.30, 0.85, 0.13, 1.60, axis='X', seg=10), C, M_STEEL)
mk('M16_RollerArm', *box(0, 3.05, 0.80, 1.40, 0.50, 0.10), C, M_STEEL)

# 半履帶：y −2.58 … 0.08，前端驅動輪、後端誘導輪、中間四個小負重輪
M16_RING = [
    ((-2.58, 0.62), (-2.46, 0.62)), ((-2.40, 0.22), (-2.30, 0.30)),
    ((-2.05, 0.00), (-2.05, 0.12)), ((-0.40, 0.00), (-0.40, 0.12)),
    (( 0.08, 0.55), (-0.04, 0.58)), ((-0.20, 0.92), (-0.24, 0.82)),
    ((-2.30, 0.92), (-2.26, 0.82)),
]
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    x0, x1 = sorted((s * M16_TR_IN, s * M16_TR_OUT))
    xc = s * (M16_TR_IN + M16_TR_OUT) / 2
    mk('M16_Track_' + tag, *band(M16_RING, x0, x1), C, M_TRACK)
    mk('M16_Sprocket_' + tag, *cyl(xc, -0.26, 0.60, 0.29, 0.26, axis='X', seg=12), C, M_TRACK)
    mk('M16_Idler_' + tag, *cyl(xc, -2.27, 0.60, 0.24, 0.26, axis='X', seg=12), C, M_TRACK)
    for i, y in enumerate((-0.70, -1.05, -1.48, -1.84)):
        mk('M16_Wheel_%s%d' % (tag, i), *cyl(xc, y, 0.18, 0.17, 0.26, axis='X', seg=10), C, M_TRACK)

# M45 四聯裝：迴旋座在後車廂中央，槍耳 (y −1.88, z 2.08)
M45_Y, M45_Z = -1.88, 2.08
M45_ELEV = 25.0
# 【槍座用車身的綠，不用 LP_GunGrey】那一色在遊戲裡是德軍火砲的沙黃
mk('M16_M45Pedestal', *cyl(0, M45_Y, (FLOOR + 1.62) / 2, 0.34, 1.62 - FLOOR, axis='Z', seg=10), C, M_ARMOR)
mk('M16_M45Body', *rotx(box(0, M45_Y + 0.10, M45_Z, 0.88, 0.80, 0.70), M45_ELEV, M45_Y, M45_Z), C, M_ARMOR)
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    # 護盾：槍的兩側各一片，上下兩挺之間
    mk('M16_M45Shield_' + tag,
       *slab([(s * 0.30, M45_Y + 0.52, 1.72), (s * 1.00, M45_Y + 0.52, 1.72),
              (s * 0.95, M45_Y + 0.36, 2.60), (s * 0.30, M45_Y + 0.36, 2.60)], -0.05), C, M_ARMOR)
    mk('M16_M45Ammo_' + tag, *rotx(box(s * 0.80, M45_Y - 0.05, M45_Z + 0.05, 0.22, 0.46, 0.46), M45_ELEV, M45_Y, M45_Z), C, M_ARMOR)
    for k, (dx, dz) in enumerate(((0.52, 0.18), (0.66, -0.06))):
        # 槍管 1.30：槍口落在槍耳前 1.3 m
        mk('M16_Barrel_%s%d' % (tag, k),
           *rotx(cyl(s * dx, M45_Y + 0.95, M45_Z + dz, 0.030, 1.30, axis='Y', seg=8), M45_ELEV, M45_Y, M45_Z), C, M_STEEL)
        mk('M16_Receiver_%s%d' % (tag, k),
           *rotx(box(s * dx, M45_Y + 0.05, M45_Z + dz, 0.12, 0.60, 0.16), M45_ELEV, M45_Y, M45_Z), C, M_STEEL)

# ═══════════════════════════ 3. GMC CCKW-353 ═══════════════════════════
C = fresh('CCKW')
CK_HW = 1.10           # 貨斗半寬（史實全寬 2.24）
CK_CW = 0.76           # 駕駛室半寬 —— 比貨斗窄，俯視的辨識點
CK_BED, CK_SIDE = 1.25, 1.75

mk('CK_Frame', *box(0, 0.10, 0.80, 0.90, 6.60, 0.18), C, M_STEEL)
mk('CK_Bumper', *box(0, 3.45, 0.86, 1.90, 0.14, 0.20), C, M_STEEL)
# 引擎蓋：往前收窄、往前降（參考模型 y −2.4 → −1.4 由 1.24 升到 1.44）
mk('CK_Hood', *loft([
    (1.62, [(-0.56, 1.10), (0.56, 1.10), (0.56, 1.60), (0.34, 1.71), (-0.34, 1.71), (-0.56, 1.60)]),
    (2.86, [(-0.42, 1.10), (0.42, 1.10), (0.42, 1.40), (0.26, 1.48), (-0.26, 1.48), (-0.42, 1.40)]),
]), C, M_TRUCK)
mk('CK_Grille', *loft([
    (2.86, [(-0.44, 0.92), (0.44, 0.92), (0.44, 1.46), (-0.44, 1.46)]),
    (3.00, [(-0.44, 0.92), (0.44, 0.92), (0.44, 1.46), (-0.44, 1.46)]),
]), C, M_STEEL)
# 前葉子板：一整條從保險桿上方（0.92）彎上輪子（頂 1.18），再落到駕駛室下的
# 踏板（0.80）—— 參考模型最顯眼的輪廓，做成兩塊平板的話像 ZiS
CK_FENDER = [(3.22, 0.92), (3.05, 1.08), (2.80, 1.17), (2.30, 1.19), (1.95, 1.15),
             (1.72, 0.98), (1.55, 0.82), (0.62, 0.80)]
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    x0, x1 = sorted((s * 0.50, s * 1.06))
    mk('CK_Fender_' + tag, *fender(x0, x1, CK_FENDER), C, M_TRUCK)
    mk('CK_Tank_' + tag, *cyl(s * 0.72, 0.60, 0.95, 0.20, 0.70, axis='Y', seg=8), C, M_TRUCK)
# 駕駛室：車頂 2.28，前面是擋風玻璃
mk('CK_Cab', *box(0, 1.08, 1.61, 2 * CK_CW, 0.95, 1.14), C, M_TRUCK)
mk('CK_CabRoof', *box(0, 1.08, 2.24, 2 * CK_CW + 0.04, 1.00, 0.08), C, M_TRUCK)
mk('CK_Windscreen', *box(0, 1.56, 1.95, 1.30, 0.04, 0.46), C, M_GLASS)
for s in (-1, 1):
    mk('CK_SideWindow_%s' % ('R' if s > 0 else 'L'), *box(s * (CK_CW + 0.01), 1.12, 1.92, 0.04, 0.60, 0.42), C, M_GLASS)
# 貨斗與帆布篷：y −3.27 … 0.54
mk('CK_BedFloor', *box(0, -1.37, CK_BED, 2 * CK_HW, 3.80, 0.10), C, M_STEEL)
for s in (-1, 1):
    mk('CK_BedSide_%s' % ('R' if s > 0 else 'L'), *box(s * (CK_HW - 0.04), -1.37, (CK_BED + CK_SIDE) / 2, 0.08, 3.80, CK_SIDE - CK_BED), C, M_TRUCK)
mk('CK_BedTail', *box(0, -3.25, (CK_BED + CK_SIDE) / 2, 2 * CK_HW, 0.08, CK_SIDE - CK_BED), C, M_TRUCK)
mk('CK_BedHead', *box(0, 0.50, (CK_BED + 2.00) / 2, 2 * CK_HW, 0.08, 2.00 - CK_BED), C, M_TRUCK)
mk('CK_Tilt', *loft([
    ( 0.52, [(-CK_HW, CK_SIDE), (CK_HW, CK_SIDE), (CK_HW, 2.55), (0.80, 2.80), (0.30, 2.86),
             (-0.30, 2.86), (-0.80, 2.80), (-CK_HW, 2.55)]),
    (-3.22, [(-CK_HW, CK_SIDE), (CK_HW, CK_SIDE), (CK_HW, 2.55), (0.80, 2.80), (0.30, 2.86),
             (-0.30, 2.86), (-0.80, 2.80), (-CK_HW, 2.55)]),
]), C, M_CANVAS)
# 輪子：前軸 y 2.34，後雙軸 −1.27 與 −2.40；後輪是雙胎，所以比前輪寬
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    mk('CK_WheelF_' + tag, *cyl(s * 0.87, 2.34, 0.46, 0.46, 0.26, axis='X', seg=12), C, M_TIRE)
    for i, y in enumerate((-1.27, -2.40)):
        mk('CK_WheelR_%s%d' % (tag, i), *cyl(s * 0.80, y, 0.46, 0.46, 0.48, axis='X', seg=12), C, M_TIRE)

# ═══════════════════════════ 收尾與量測 ═══════════════════════════
TAGS_US = ('M4A3', 'M16', 'CCKW')
BARREL_NODES_US = {'M4A3': ('M4_Gun',), 'M16': ('M16_Barrel_',), 'CCKW': ()}
GLB_NAMES_US = {'M4A3': 'm4a3.glb', 'M16': 'm16.glb', 'CCKW': 'cckw.glb'}
# 排在德軍那四台後面（它們在 x 0 … 26）
LAYOUT_X_US = {'M4A3': 36.0, 'M16': 45.0, 'CCKW': 54.0}

for tag in TAGS_US:
    objs = list(bpy.data.collections['LP_' + tag].objects)
    for ob in objs:
        ob.data.validate()
    lo, hi = col_bounds(objs)
    LOG_US[tag] = {
        'tris': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs),
        'size_xyz': [round(hi[i] - lo[i], 3) for i in range(3)],
        'min_z': round(lo.z, 3),
        'hitbox': game_box([o for o in objs if not o.name.startswith(BARREL_NODES_US[tag])]),
    }


def layout_us(on=True):
    for tag in TAGS_US:
        for o in bpy.data.collections['LP_' + tag].objects:
            o.location.x = LAYOUT_X_US[tag] if on else 0.0
    bpy.context.view_layer.update()


def place_refs():
    """參考模型擺到各自那台旁邊（同一個 x、往 +x 再偏 4 m），換算成與低模同一套
    座標，方便並排對照。只動參考模型的根節點。"""
    specs = {
        # 集合名、低模的 tag、繞 Z 轉幾度、各軸縮放
        'REF_M4': ('M4A3', 0.0, (1.0, 1.0, 1.0)),
        'REF_M16': ('M16', 90.0, (0.0496, 0.0496, 0.0496)),
        'REF_TRUCKS': ('CCKW', 180.0, (1.04, 1.19, 1.19)),
    }
    for cname, (tag, rot, sc) in specs.items():
        col = bpy.data.collections.get(cname)
        if col is None:
            continue
        name = 'REFROOT_' + tag
        root = bpy.data.objects.get(name)
        if root is None:
            root = bpy.data.objects.new(name, None)
            col.objects.link(root)
        for o in col.objects:
            if o is not root and o.parent is None:
                o.parent = root
        root.rotation_euler = (0, 0, math.radians(rot))
        root.location = (LAYOUT_X_US[tag] + 4.0, 0, 0)
        # 縮放放在根節點上：旋轉之後才縮放，所以寬乘在世界 X、長乘在世界 Y
        root.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        mw = root.matrix_world
        root.matrix_world = Matrix.Diagonal((*sc, 1.0)) @ Matrix.Translation(-mw.translation) @ mw
        root.matrix_world = Matrix.Translation(Vector((LAYOUT_X_US[tag] + 4.0, 0, 0))) @ root.matrix_world
    bpy.context.view_layer.update()


def export_us():
    """三支各匯一個 GLB，理由與 `export_all` 相同（位移歸零、temp_override）。"""
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    os.makedirs(OUT_DIR_US, exist_ok=True)
    layout_us(False)
    out = {}
    for tag in TAGS_US:
        objs = list(bpy.data.collections['LP_' + tag].objects)
        with bpy.context.temp_override(window=win, area=area, region=region):
            bpy.ops.object.select_all(action='DESELECT')
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            path = os.path.join(OUT_DIR_US, GLB_NAMES_US[tag])
            bpy.ops.export_scene.gltf(
                filepath=path, export_format='GLB', use_selection=True,
                export_yup=True, export_extras=True, export_apply=True,
                export_normals=False, export_texcoords=False,
            )
        out[tag] = {'path': path, 'bytes': os.path.getsize(path)}
    layout_us(True)
    return out


layout_us(True)
place_refs()
