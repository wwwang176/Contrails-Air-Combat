# -*- coding: utf-8 -*-
"""
LST-1 級戰車登陸艦，擱淺在雷伊泰灘頭：艦艏兩扇蚌殼門打開、跳板放下。
遊戲裡是一艘**不會動的船**（`world/ships.ts` 的 `lst`）：船體盒、血量、防空砲位
都照其他三艘的規矩。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_lst.py', encoding='utf-8').read())
工具函式、`mk` 與集合來自 `build_ground.py`，還沒載入的話這支自己先執行它。
建完 `LOG_LST` 裡有三角形數、尺寸、艦體座標的包圍盒與 `empl`（防空砲位，
`export_ship_aa.py` 讀它）；`export_lst()` 匯出 models-src/lst.glb。

座標：建模時與 `build_ground.py` 相同 —— Blender 系 X 橫向、**+Y 艦艏**、Z 上、
龍骨最低點 z = 0、中線 x = 0。**匯出時整艘下移 `WATERLINE`**，GLB 的原點落在
水線 × 艦體中點 × 中線，與其他船同一套（遊戲把船的原點放在海面上）。

【顏色就是 GLB 的顏色】船的 GLB 在遊戲裡照原樣畫，不像地面單位照材質名重貼，
所以材質的顏色要填真的（`srgb`），與 `build_fletcher.py` 同一套色號。

── 參考模型的量法 ──────────────────────────────────────────────
  參考模型是整支 1:1 公分、帶骨架變形的網格：頂點要取**變形後**的
  （`evaluated_get(...).to_mesh()`），直接讀 `data.vertices` 會落在另一套座標。
  `bake_ref_lst()` 把它烘成靜態網格、轉成本檔的座標，放進 REF_LST。
  全長 101.0、全寬 15.2（史實 99.9 × 15.2）。
  船殼   主甲板 8.17；龍骨 y −30 最低，往艏緩升到 1.45、往艉在 −40 之後陡升
         （俥葉的切口）。艏樓 y 30 → 45 由 8.47 升到 10.25。艏端 y 44 … 45 比
         參考模型飽滿 —— 開口的下角要落在船殼裡，否則黑框兩個角懸在空中。
  艏門   蚌殼門鉸鏈在 x ±3.9、y 44；門高 z 2.5 … 9.93。門上方是一截艏樓頂蓋
         （y 45 … 50.5，底 10.1），關門時門就收在它底下。
  跳板   門後面，收起時斜靠 y 43.8 … 46.8；寬 4.7。
  艦橋   甲板室 y −39.5 … −19.5、頂 10.5；駕駛台 x ±2.5、y −31.5 … −21.5、
         頂 12.7；操舵室 12.7 → 16.1；主桅 (0, −32) 頂 28.2。甲板室前緣有三根
         通風管到 11.5；甲板室兩舷各吊一艘小艇，艇架頂 13.9。
  砲座   40 mm：艉一座 (0, −47.3)、艏樓左右錯開兩座、艏頂蓋上一座；20 mm 四座。
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

REPO = globals().get('REPO_ROOT', r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\jp-m2")
OUT_DIR_LST = os.path.join(REPO, "models-src")
LOG_LST = {}
if 'mk' not in globals():
    exec(open(os.path.join(REPO, 'tools', 'blender', 'build_ground.py'), encoding='utf-8').read(), globals())

# 【水線】龍骨往上 1.5 m：艦艏龍骨（1.45）剛好貼著水面，跳板末端（1.3）沒入
# 水下 0.2 m —— 艦艏停在水線外、跳板搭上沙灘的樣子
WATERLINE = 1.5


def srgb(h):
    r, g, b = ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


M_HULL = mat('LST_Body',  srgb(0x565f66))    # 舷側灰（Measure 21），與 Fletcher 同色
M_DECK = mat('LST_Deck',  srgb(0x3b3b39))    # 鋼甲板
M_HOLD = mat('LST_Hold',  srgb(0x141618))    # 開口與窗
M_RAFT = mat('LST_Raft',  srgb(0x7d7357))    # 救生筏的帆布
M_GUNS = mat('LST_Steel', srgb(0x4a4f55))    # 砲管、砲架


# ═══════════════════════════ 工具 ═══════════════════════════

def wallz(path, t):
    """一片直立的板：`path` 是 [(x, y, z0, z1), …]，每一點各自的底與頂，往
    俯視折線的左側加厚 t。艏門（下緣往艏尖抬）、防浪牆與欄杆（跟著甲板升）用。"""
    n = len(path)
    pts = [Vector((p[0], p[1])) for p in path]
    v = []
    for i, (x, y, z0, z1) in enumerate(path):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        o = Vector((-d.y, d.x)) * t
        v += [(x, y, z0), (x, y, z1), (x + o.x, y + o.y, z0), (x + o.x, y + o.y, z1)]
    f = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        f += [(a, b, b + 1, a + 1), (a + 2, a + 3, b + 3, b + 2),
              (a, a + 2, b + 2, b), (a + 1, b + 1, b + 3, a + 3)]
    e = 4 * (n - 1)
    f += [(0, 1, 3, 2), (e, e + 2, e + 3, e + 1)]
    return v, f


def hex_cup(cx, cy, z0, z1, r, wall=0.16, depth=1.0):
    """開頂的六邊形砲座：外牆 z0 → z1，裡面的地板低於牆頂 `depth`。低多邊形下
    六邊就夠圓，與 Fletcher 的 `hex_ring` 同一個做法。"""
    zf = z1 - depth
    ang = [math.pi / 6 + i * math.pi / 3 for i in range(6)]
    rings = [(r, z0), (r, z1), (r - wall, z1), (r - wall, zf)]
    v = [(cx + rr * math.cos(a), cy + rr * math.sin(a), z) for (rr, z) in rings for a in ang]
    f = [tuple(range(6))[::-1]]
    for k in range(3):
        a, b = 6 * k, 6 * (k + 1)
        for i in range(6):
            j = (i + 1) % 6
            f.append((a + i, a + j, b + j, b + i))
    f.append(tuple(range(18, 24)))
    return v, f


def rod(p0, p1, r, seg=6):
    """兩點之間的細圓柱：砲管、桅杆的支索、探照燈塔的腳。"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.normalized().to_track_quat('Z', 'Y')
    v, f = cyl(0, 0, d.length / 2, r, d.length, axis='Z', seg=seg)
    return [tuple(p0 + q @ Vector(p)) for p in v], f


def rotz_about(path, deg, px, py):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(px + (x - px) * c - (y - py) * s, py + (x - px) * s + (y - py) * c) for (x, y) in path]


def lerp_tab(tab, y):
    """tab = [(y, a, b, …), …] 依 y 遞增；回傳 y 處線性內插的 (a, b, …)。"""
    if y <= tab[0][0]:
        return tab[0][1:]
    for p, q in zip(tab, tab[1:]):
        if y <= q[0]:
            t = (y - p[0]) / (q[0] - p[0])
            return tuple(a + (b - a) * t for a, b in zip(p[1:], q[1:]))
    return tab[-1][1:]


def along(path, step):
    """沿俯視折線 [(x, y), …] 每 `step` 公尺取一點（含起點）。"""
    out = [path[0]]
    carry = 0.0
    for (x0, y0), (x1, y1) in zip(path, path[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        s = step - carry
        while s <= seg:
            t = s / seg
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
            s += step
        carry = seg - (s - step)
    return out


C = fresh('LST')
# `fresh` 只刪物件，網格留下來變孤兒、還佔著名字：新網格就會叫 LST_Hull.001，
# GLB 每重建一次內容都不同
for _m in [m for m in bpy.data.meshes if m.users == 0 and m.name.startswith('LST_')]:
    bpy.data.meshes.remove(_m)

# ═══════════════════════════ 船殼 ═══════════════════════════
# 一站：(y, 龍骨 z, 甲板 z, 船底半寬, 舭部點 (半寬, z), 甲板半寬)
HULL = [
    (-50.3, 6.60, 8.00, 0.4, (1.0, 7.2), 1.2),
    (-49.0, 5.60, 8.17, 0.6, (1.8, 6.6), 2.6),
    (-48.0, 3.35, 8.17, 0.5, (1.8, 5.0), 3.6),
    (-46.0, 2.04, 8.17, 0.6, (2.9, 5.0), 4.9),
    (-44.0, 1.61, 8.17, 1.2, (3.9, 5.0), 5.9),
    (-40.0, 0.75, 8.17, 2.6, (5.8, 5.0), 7.0),
    (-35.0, 0.30, 8.17, 5.0, (7.3, 3.0), 7.5),
    (-30.0, 0.00, 8.17, 6.6, (7.5, 1.0), 7.61),
    ( 30.0, 1.23, 8.47, 6.8, (7.55, 2.1), 7.61),
    ( 36.0, 1.33, 9.27, 6.2, (7.1, 2.3), 7.17),
    ( 40.0, 1.44, 9.84, 5.4, (6.4, 2.4), 6.49),
    ( 42.0, 1.45, 9.95, 4.4, (5.7, 2.5), 5.80),
    ( 44.0, 1.45, 10.10, 2.4, (4.6, 2.6), 4.90),
    ( 45.0, 1.60, 10.25, 1.2, (4.0, 2.5), 4.50),
]
# 甲板是一片 0.3 m 厚的板蓋在船殼上 —— 分開塗色；兩者只在側面相接、沒有共面
DECK_T = 0.30
mk('LST_Hull', *loft([
    (y, [(b, k), (w1, z1), (w, zd - DECK_T), (-w, zd - DECK_T), (-w1, z1), (-b, k)])
    for (y, k, zd, b, (w1, z1), w) in HULL
]), C, M_HULL)
mk('LST_Deck', *loft([
    (y, [(w, zd - DECK_T), (w, zd), (-w, zd), (-w, zd - DECK_T)])
    for (y, k, zd, b, (w1, z1), w) in HULL
]), C, M_DECK)

# 艏樓頂蓋：門上方那一截，俯視收成尖頭
HOOD_Z0 = 10.0
HOOD = [(45.0, 4.5, 10.25), (46.5, 3.8, 10.45), (48.0, 2.7, 10.6), (49.3, 1.5, 10.75), (50.4, 0.15, 10.9)]
mk('LST_Hood', *loft([(y, [(w, HOOD_Z0), (w, zt), (-w, zt), (-w, HOOD_Z0)]) for (y, w, zt) in HOOD]), C, M_DECK)

# 甲板緣：(y, 半寬, 甲板面 z)，由艉到艏尖，欄杆、防浪牆、小艇架都沿著它
EDGE = [(y, w, zd) for (y, k, zd, b, _, w) in HULL] + [(y, w, zt) for (y, w, zt) in HOOD[1:]]

# ── 艏門 ──
# 開口：戰車甲板的入口，整片黑。下緣是跳板的鉸鏈，上緣頂到頂蓋底
OPEN_Z0 = 2.5
mk('LST_Opening', *box(0, 45.04, (OPEN_Z0 + HOOD_Z0) / 2, 7.4, 0.08, HOOD_Z0 - OPEN_Z0), C, M_HOLD)

# 跳板：鉸鏈在開口底 (y 45.3, z 2.5)，放下 8.2 m 斜到 (y 53.5)，末端沒入水線下 0.2 m。
# `world/leyte.ts` 的 `LST_RAMP_REACH` 是艦體中點到這個末端的距離
RAMP_A, RAMP_B, RAMP_HW = Vector((0, 45.3, OPEN_Z0)), Vector((0, 53.5, WATERLINE - 0.2)), 2.35
mk('LST_Ramp', *slab([(-RAMP_HW, RAMP_A.y, RAMP_A.z), (RAMP_HW, RAMP_A.y, RAMP_A.z),
                      (RAMP_HW, RAMP_B.y, RAMP_B.z), (-RAMP_HW, RAMP_B.y, RAMP_B.z)], 0.25), C, M_DECK)

# 蚌殼門：關著時由鉸鏈 (±4.3, 45) 彎到艏尖，下緣往艏尖抬（艏底是圓的）；
# 開門往外轉 70°，兩扇順著艦艏往前斜伸
DOOR_PATH = [(4.3, 45.0, 1.7), (3.9, 46.6, 2.0), (3.0, 48.2, 2.4), (1.6, 49.4, 2.8), (0.1, 50.0, 3.1)]
DOOR_OPEN = 70.0
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    plan = rotz_about([(s * x, y) for (x, y, _) in DOOR_PATH], -s * DOOR_OPEN, s * 4.3, 45.0)
    mk('LST_Door_' + tag, *wallz([(x, y, z0, 9.95) for (x, y), (_, _, z0) in zip(plan, DOOR_PATH)], 0.15 * s), C, M_HULL)

# ── 艏樓防浪牆：y 34 起沿甲板緣一路圍到艏尖，高 1.1 ──
BULWARK_H = 1.1
_bw = [(34.0, *lerp_tab(EDGE, 34.0))] + [e for e in EDGE if e[0] > 34.0]
_bw_path = [(-w, y, zd, zd + BULWARK_H) for (y, w, zd) in _bw] + \
           [(w, y, zd, zd + BULWARK_H) for (y, w, zd) in reversed(_bw[:-1])]
mk('LST_Bulwark', *wallz(_bw_path, -0.12), C, M_HULL)

# ── 主甲板欄杆：防浪牆後端往艉繞一圈，扶手一道、立柱每 8 m ──
RAIL_IN = 0.10
_rail = [(y, w - RAIL_IN, zd) for (y, w, zd) in EDGE if y < 34.0] + [(34.0, *lerp_tab(EDGE, 34.0))]
_rail[-1] = (34.0, _rail[-1][1] - RAIL_IN, _rail[-1][2])
_ring = [(-w, y, zd) for (y, w, zd) in reversed(_rail)] + [(w, y, zd) for (y, w, zd) in _rail]
mk('LST_Rail', *wallz([(x, y, zd + 0.94, zd + 1.0) for (x, y, zd) in _ring], -0.06), C, M_HULL)
_zmap = [(y, zd) for (y, w, zd) in _rail]
for i, (x, y) in enumerate(along([(x, y) for (x, y, _) in _ring], 8.0)):
    zd = lerp_tab(_zmap, y)[0]
    mk('LST_Stanchion_%02d' % i, *box(x, y, zd + 0.5, 0.06, 0.06, 1.0), C, M_HULL)

# ═══════════════════════════ 甲板上 ═══════════════════════════
Z_DECK = 8.17

# ── 艦橋 ──
mk('LST_HouseFwd', *box(0, -21.5, (Z_DECK + 10.5) / 2, 14.8, 4.0, 10.5 - Z_DECK), C, M_HULL)
mk('LST_HouseAft', *box(0, -31.5, (Z_DECK + 10.5) / 2, 12.0, 16.0, 10.5 - Z_DECK), C, M_HULL)
mk('LST_HouseDoors', *box(0, -19.44, 9.2, 10.0, 0.12, 1.9), C, M_HOLD)
mk('LST_Bridge', *box(0, -26.5, 11.6, 5.0, 10.0, 2.2), C, M_HULL)
mk('LST_BridgeWindows', *box(0, -21.44, 12.05, 4.4, 0.12, 0.5), C, M_HOLD)
mk('LST_Conn', *box(0, -23.6, 14.4, 2.4, 2.4, 3.4), C, M_HULL)
mk('LST_ConnWindows', *box(0, -22.34, 15.4, 2.0, 0.12, 0.45), C, M_HOLD)
# 甲板室前緣三根通風管
for i, x in enumerate((-2.0, 0.0, 2.0)):
    mk('LST_Vent_%d' % i, *cyl(x, -18.2, (Z_DECK + 11.5) / 2, 0.35, 11.5 - Z_DECK, axis='Z', seg=6), C, M_HULL)

# ── 主桅：桅杆、橫桁、瞭望台（支索太細，遠處看不出來，不做） ──
mk('LST_Mast', *cyl(0, -32.0, (12.7 + 28.2) / 2, 0.22, 28.2 - 12.7, axis='Z', seg=6, r2=0.14), C, M_HULL)
mk('LST_Yard', *box(0, -32.0, 24.5, 4.2, 0.16, 0.16), C, M_HULL)
mk('LST_MastTop', *box(0, -32.0, 20.0, 1.2, 1.2, 0.12), C, M_HULL)

# ── 甲板室兩舷的小艇與艇架 ──
BOAT_X, BOAT_Y = 6.4, -30.5
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    bx = s * BOAT_X
    mk('LST_Boat_' + tag, *box(bx, BOAT_Y, 10.6, 2.2, 6.0, 1.4), C, M_HULL)
    for k, dy in enumerate((-2.3, 2.3)):
        mk('LST_Davit_%s%d' % (tag, k), *box(s * 5.5, BOAT_Y + dy, 12.2, 0.22, 0.22, 3.4), C, M_HULL)
        mk('LST_DavitArm_%s%d' % (tag, k), *box(s * 6.1, BOAT_Y + dy, 13.8, 1.4, 0.22, 0.22), C, M_HULL)

# ── 艉的探照燈塔：一根柱子 + 平台 + 燈筒 ──
mk('LST_LightPost', *cyl(0, -42.0, (Z_DECK + 13.2) / 2, 0.2, 13.2 - Z_DECK, axis='Z', seg=6), C, M_HULL)
mk('LST_LightDeck', *box(0, -42.0, 13.26, 1.8, 1.8, 0.12), C, M_HULL)
mk('LST_Light', *cyl(0, -42.0, 14.4, 0.6, 2.2, axis='Z', seg=6), C, M_HULL)

# ── 主甲板：升降機艙口、蘑菇通風口、舷側的救生筏 ──
mk('LST_Hatch', *box(0, -11.0, Z_DECK + 0.14, 5.2, 8.0, 0.28), C, M_HULL)
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    for k, y in enumerate((20.0, 25.5, 28.5)):
        zd = lerp_tab(EDGE, y)[1]
        mk('LST_Mushroom_%s%d' % (tag, k), *cyl(s * 5.2, y, zd + 0.5, 0.3, 1.0, axis='Z', seg=6), C, M_HULL)
        mk('LST_MushroomCap_%s%d' % (tag, k), *cyl(s * 5.2, y, zd + 1.1, 0.5, 0.2, axis='Z', seg=6), C, M_HULL)
    for k, y in enumerate((-15.0, -8.0, 6.0, 14.0)):
        mk('LST_Raft_%s%d' % (tag, k), *box(s * 7.25, y, Z_DECK + 0.55, 0.35, 2.0, 0.9), C, M_RAFT)

# ═══════════════════════════ 砲座與砲 ═══════════════════════════
# (名字, x, y, 半徑, 底 z, 牆頂 z, 砲種, 砲口朝向（度，由 +Y 往 +X 量）)
TUBS = [
    ('Stern',  0.0, -47.3, 2.3, Z_DECK, 11.4, '40', 180),
    ('Bow40L', -4.8, 38.8, 1.7, 9.4,  11.6, '40', -30),
    ('Bow40R',  5.4, 36.4, 1.7, 9.1,  11.6, '40', 30),
    ('Hood',    0.0, 46.8, 1.7, 10.4, 12.4, '40', 0),
    ('Bow20L', -5.8, 26.5, 1.0, 8.1,  9.3,  '20', -60),
    ('Bow20R',  5.8, 26.5, 1.0, 8.1,  9.3,  '20', 60),
    ('FwdL',   -3.0, 43.4, 1.0, 10.0, 11.0, '20', -20),
    ('FwdR',    3.0, 43.4, 1.0, 10.0, 11.0, '20', 20),
]
EL_40, EL_20 = 20.0, 30.0
# 防空砲位：(層, 口徑 mm, 砲口 x, y, z, 管數)，**艦體座標**（z 由水線起算）。
# `export_ship_aa.py` 讀它產生 `src/world/shipAA.ts`
EMPL = []
for (name, x, y, r, z0, z1, kind, yaw) in TUBS:
    depth = min(1.0, z1 - z0 - 0.1)
    mk('LST_Tub_' + name, *hex_cup(x, y, z0, z1, r, depth=depth), C, M_HULL)
    zf = z1 - depth
    a = math.radians(yaw)
    fwd, side = Vector((math.sin(a), math.cos(a), 0)), Vector((math.cos(a), -math.sin(a), 0))
    if kind == '40':
        el = math.radians(EL_40)
        d = fwd * math.cos(el) + Vector((0, 0, math.sin(el)))
        piv = Vector((x, y, zf + 0.75))
        mk('LST_Gun40Mount_' + name, *box(x, y, zf + 0.4, 1.1, 1.1, 0.8), C, M_GUNS)
        for k, off in enumerate((-0.25, 0.25)):
            p = piv + side * off
            mk('LST_Gun40Barrel_%s%d' % (name, k), *rod(p, p + d * 2.6, 0.06, seg=5), C, M_GUNS)
        m = piv + d * 2.6
        EMPL.append(('autocannon', 40, round(m.x, 2), round(m.y, 2), round(m.z - WATERLINE, 2), 2))
    else:
        el = math.radians(EL_20)
        d = fwd * math.cos(el) + Vector((0, 0, math.sin(el)))
        piv = Vector((x, y, zf + 1.0))
        mk('LST_Gun20Post_' + name, *cyl(x, y, zf + 0.5, 0.1, 1.0, axis='Z', seg=5), C, M_GUNS)
        mk('LST_Gun20Barrel_' + name, *rod(piv - d * 0.4, piv + d * 1.6, 0.04, seg=5), C, M_GUNS)
        sh = piv + d * 0.1
        mk('LST_Gun20Shield_' + name, *slab([tuple(sh - side * 0.35 - Vector((0, 0, 0.3))), tuple(sh + side * 0.35 - Vector((0, 0, 0.3))),
                                             tuple(sh + side * 0.35 + Vector((0, 0, 0.3))), tuple(sh - side * 0.35 + Vector((0, 0, 0.3)))], 0.03), C, M_GUNS)
        m = piv + d * 1.6
        EMPL.append(('mg', 20, round(m.x, 2), round(m.y, 2), round(m.z - WATERLINE, 2), 1))

# ═══════════════════════════ 收尾與量測 ═══════════════════════════
LAYOUT_X_LST = 80.0
objs = list(C.objects)
for ob in objs:
    ob.data.validate()
    ob.location.x = 0.0
bpy.context.view_layer.update()
lo, hi = col_bounds(objs)
LOG_LST = {
    'parts': len(objs),
    'tris': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs),
    'size_xyz': [round(hi[i] - lo[i], 3) for i in range(3)],
    'min_z': round(lo.z, 3),
    # 艦體座標（原點在水線）的整艘包圍盒，遊戲的軸向 (x, z − WATERLINE, −y)
    'bounds': [[round(lo.x, 2), round(lo.z - WATERLINE, 2), round(-hi.y, 2)],
               [round(hi.x, 2), round(hi.z - WATERLINE, 2), round(-lo.y, 2)]],
    'empl': EMPL,
}
for ob in objs:
    ob.location.x = LAYOUT_X_LST


def bake_ref_lst(root_name, keep_prefix):
    """把匯入的參考模型（帶骨架）烘成靜態網格放進 REF_LST，轉成本檔座標，
    擺在低模旁邊 +20 m。`root_name` 是 LST 那艘的節點；其餘匯入物件由呼叫端清。
    參考模型的軸：+x 艦艏、−y 上、z 橫向。"""
    dg = bpy.context.evaluated_depsgraph_get()
    R = Matrix(((0, 0, -1, 0), (1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    col = get_col('REF_LST')
    made = []
    for o in bpy.data.objects[root_name].children_recursive:
        if o.type != 'MESH' or not o.name.startswith(keep_prefix):
            continue
        e = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(e, depsgraph=dg)
        me.transform(R @ e.matrix_world)
        ob = bpy.data.objects.new('REF_LST_' + o.name, me)
        col.objects.link(ob)
        made.append(ob)
    vs = [v.co for ob in made for v in ob.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    for ob in made:
        ob.location = (LAYOUT_X_LST + 20.0 - (lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
    return made


def export_lst():
    """匯出 lst.glb。排開看用的位移歸零、整艘下移 `WATERLINE` 再匯 ——
    `export_apply` 把世界變換烘進頂點，原點因此落在水線。"""
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    objs = list(bpy.data.collections['LP_LST'].objects)
    for o in objs:
        o.location = (0.0, 0.0, -WATERLINE)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    with bpy.context.temp_override(window=win, area=area, region=region):
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        path = os.path.join(OUT_DIR_LST, 'lst.glb')
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True,
            export_yup=True, export_extras=True, export_apply=True,
            export_normals=False, export_texcoords=False,
        )
    for o in objs:
        o.location = (LAYOUT_X_LST, 0.0, 0.0)
    return {'path': path, 'bytes': os.path.getsize(path)}


result = LOG_LST
