# -*- coding: utf-8 -*-
"""
地面單位四台：T-34-76、ZIS-150、8.8 cm Flak 18、2 cm Flakvierling 38。
盒子與圓柱組出來的低多邊形，數字量自四支參考模型（見各段註解）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_ground.py', encoding='utf-8').read())
建完呼叫 `export_all()` 匯出四支 GLB 到 models-src/，`LOG` 裡有三角形數、
尺寸與遊戲座標的命中盒。

座標：Blender 系 X 橫向、**+Y 車頭／砲口**、Z 上、底面 z = 0、中線 x = 0。
export_yup 之後是遊戲的 X 橫向、Y 上、−Z 車頭 —— 與飛機、船同一套。
    遊戲 (x, y, z) = Blender (x, z, −y)

材質只帶名字（LP_*），顏色是 `src/render/geometry/ground/glb.ts` 的事 ——
GLB 裡的顏色只給 Blender 看，遊戲照名字重貼。名字對不上載入會丟。

── 參考模型的量法與換算 ──────────────────────────────────────
  T-34      參考模型就是公尺（履帶跨距 6.10 = 史實車體長）。寬 3.29 對史實 3.00，
            長與高都對、只有寬不對，所以 X 乘 0.913 收回去，其餘照抄。
  ZIS-150   縮放 6.72 / 695.257。前軸 y 2.56、後軸 −1.50 → 軸距 4.06（史實 4.0）。
            引擎蓋上緣 1.70 平到 y 2.85 才收；水箱護罩比引擎蓋**低**（實體標尺量的，
            頂點分位數在這支帶 armature 的模型上會讀錯軸）。
  Flak 18   1:1 公尺（砲身 4.94 對 L/56 的 4.93）。十字臂外段 0.31…0.37 寬、
            0.07…0.14 厚，臂端有一根到 z 0.73 的千斤頂柱。護盾在上砲架上，
            只隨方位轉，砲管從中央 0.26…0.31 的縫穿過去。
  Flak 38   1:1 公尺。砲管抬 30°；護盾也在迴旋座上不隨仰角動（它的前緣越高越
            往後、砲身組越高越往前，兩者不是同一個剛體），本身後傾約 15°。
"""
import bpy, math, os
from mathutils import Vector

ROOT = r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\model-building-2"
OUT_DIR = os.path.join(ROOT, "models-src")
LOG = {}

# ═══════════════════════════ 工具 ═══════════════════════════

def get_col(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def mat(name, rgb):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = 0.85
    m.diffuse_color = (*rgb, 1)
    return m


def mk(name, verts, faces, col, material):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    me.from_pydata(list(verts), [], list(faces))
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(material)
    col.objects.link(ob)
    return ob


def box(cx, cy, cz, sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(cx-hx, cy-hy, cz-hz), (cx+hx, cy-hy, cz-hz), (cx+hx, cy+hy, cz-hz), (cx-hx, cy+hy, cz-hz),
         (cx-hx, cy-hy, cz+hz), (cx+hx, cy-hy, cz+hz), (cx+hx, cy+hy, cz+hz), (cx-hx, cy+hy, cz+hz)]
    f = [(0,3,2,1), (4,5,6,7), (0,1,5,4), (2,3,7,6), (1,2,6,5), (3,0,4,7)]
    return v, f


def cyl(cx, cy, cz, r, length, axis='Z', seg=12, r2=None):
    """圓柱，`axis` 是軸向，`length` 沿該軸，中心在 (cx,cy,cz)。"""
    r2 = r if r2 is None else r2
    v, f = [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c, s = math.cos(a), math.sin(a)
        if axis == 'Z':
            v.append((cx+r*c, cy+r*s, cz-length/2)); v.append((cx+r2*c, cy+r2*s, cz+length/2))
        elif axis == 'Y':
            v.append((cx+r*c, cy-length/2, cz+r*s)); v.append((cx+r2*c, cy+length/2, cz+r2*s))
        else:
            v.append((cx-length/2, cy+r*c, cz+r*s)); v.append((cx+length/2, cy+r2*c, cz+r2*s))
    for i in range(seg):
        a, b = 2*i, 2*((i+1) % seg)
        f.append((a, b, b+1, a+1))
    f.append(tuple(range(0, 2*seg, 2))[::-1])
    f.append(tuple(range(1, 2*seg, 2)))
    return v, f


def loft(stations):
    """stations = [(y, [(x,z), …]), …]，各站點數相同，回傳封閉實體。"""
    k = len(stations[0][1])
    v, f = [], []
    for y, prof in stations:
        for (x, z) in prof:
            v.append((x, y, z))
    for s in range(len(stations) - 1):
        a, b = s*k, (s+1)*k
        for i in range(k):
            j = (i+1) % k
            f.append((a+i, a+j, b+j, b+i))
    f.append(tuple(range(k))[::-1])
    f.append(tuple(range((len(stations)-1)*k, len(stations)*k)))
    return v, f


def band(pairs, x0, x1):
    """環帶：一圈 (外點, 內點) 的 (y,z) 沿 X 擠出成中空的帶子。
    履帶非這樣不可 —— 做成實心板時側視剪影裡負重輪與底盤糊成一塊。"""
    n = len(pairs)
    v = []
    for x in (x0, x1):
        for (o, i) in pairs:
            v.append((x, o[0], o[1]))
        for (o, i) in pairs:
            v.append((x, i[0], i[1]))
    O0, I0, O1, I1 = 0, n, 2*n, 3*n
    f = []
    for i in range(n):
        j = (i+1) % n
        f.append((O0+i, O0+j, I0+j, I0+i))
        f.append((O1+j, O1+i, I1+i, I1+j))
        f.append((O0+j, O0+i, O1+i, O1+j))
        f.append((I0+i, I0+j, I1+j, I1+i))
    return v, f


def rotx(vf, deg, py, pz):
    """把 (verts, faces) 繞通過 (py, pz) 的 X 軸轉 deg 度。砲管仰角用。"""
    v, f = vf
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(x, py + (y-py)*c - (z-pz)*s, pz + (y-py)*s + (z-pz)*c) for (x, y, z) in v], f


def slab(corners_front, thickness):
    """一片板：四個角點 (x,y,z) 順著繞一圈，再沿法線往後加厚。護盾用。"""
    a, b, c, d = [Vector(p) for p in corners_front]
    n = (b - a).cross(d - a).normalized() * thickness
    v = [tuple(a), tuple(b), tuple(c), tuple(d), tuple(a-n), tuple(b-n), tuple(c-n), tuple(d-n)]
    f = [(0,1,2,3), (7,6,5,4), (0,4,5,1), (1,5,6,2), (2,6,7,3), (3,7,4,0)]
    return v, f


def col_bounds(objs):
    lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
    for o in objs:
        for cn in o.bound_box:
            w = o.matrix_world @ Vector(cn)
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
    return lo, hi


def game_box(objs):
    """一群物件的包圍盒，換成遊戲座標 (x, z, −y) 的 [min, max]。"""
    lo, hi = col_bounds(objs)
    return [[round(lo.x, 2), round(lo.z, 2), round(-hi.y, 2)],
            [round(hi.x, 2), round(hi.z, 2), round(-lo.y, 2)]]


# ═══════════════════════════ 材質 ═══════════════════════════
# 名字是合約（glb.ts 照名字貼遊戲材質），顏色只給 Blender 看。
M_ARMOR  = mat('LP_ArmorGreen', (0.115, 0.145, 0.062))
M_TRACK  = mat('LP_Track',      (0.030, 0.033, 0.038))
M_STEEL  = mat('LP_Steel',      (0.075, 0.082, 0.092))
M_TRUCK  = mat('LP_TruckGreen', (0.095, 0.115, 0.055))
M_CANVAS = mat('LP_Canvas',     (0.175, 0.155, 0.095))
M_TIRE   = mat('LP_Tire',       (0.022, 0.024, 0.028))
M_GLASS  = mat('LP_Glass',      (0.045, 0.075, 0.100))
M_GUN    = mat('LP_GunGrey',    (0.135, 0.120, 0.078))

ROOT_COL = get_col('Ground_LowPoly')


def fresh(tag):
    c = get_col('LP_' + tag, ROOT_COL)
    for o in list(c.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    return c


# ═══════════════════════════ 1. T-34-76 ═══════════════════════════
C = fresh('T34')
XS = 0.913             # 車寬從參考模型的 3.29 收到史實 3.00
WB = 1.044             # 兩條履帶之間的車體半寬（履帶內緣）
WL = 1.430 * XS        # 砲座（sponson）外緣，蓋在履帶上方
WT = 0.880 * XS        # 車頂半寬
ZS, ZK = 0.97, 1.12    # 履帶頂＝砲座底；砲座頂＝上部斜側板的下折線
TRACK_OUT, TRACK_W = 1.643 * XS, 0.50 * XS


def t34_prof(zb, zt):
    """車體橫剖面。下半縮進履帶內緣，否則側視看不到履帶與負重輪。"""
    zs = min(ZS, zt); zk = min(ZK, zt)
    t = max(0.0, min(1.0, (zt - ZK) / (1.65 - ZK)))
    wt = WL + (WT - WL) * t
    return [(0, zb), (WB, zb), (WB, zs), (WL, zs), (WL, zk), (wt, zt), (0, zt),
            (-wt, zt), (-WL, zk), (-WL, zs), (-WB, zs), (-WB, zb)]


# 車底離地 0.60：參考模型的剪影裡負重輪從地面露到這個高度
mk('T34_Hull', *loft([
    (-3.45, t34_prof(0.72, 0.78)),
    (-3.28, t34_prof(0.62, 1.18)),
    (-2.78, t34_prof(0.60, 1.65)),
    ( 1.20, t34_prof(0.60, 1.65)),
    ( 2.45, t34_prof(0.60, 0.92)),   # 首上裝甲 60°（參考模型 y 1.14→2.39、z 0.26→−0.45）
    ( 2.56, t34_prof(0.74, 0.86)),
]), C, M_ARMOR)

T34_RING = [
    ((-3.54, 0.97), (-3.36, 0.80)), ((-3.54, 0.42), (-3.36, 0.52)),
    ((-3.10, 0.10), (-3.00, 0.26)), ((-2.50, 0.00), (-2.50, 0.16)),
    (( 1.70, 0.00), ( 1.70, 0.16)), (( 2.20, 0.12), ( 2.10, 0.28)),
    (( 2.56, 0.45), ( 2.40, 0.53)), (( 2.56, 0.97), ( 2.40, 0.80)),
]
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    c = s * (TRACK_OUT - TRACK_W / 2)
    x0, x1 = sorted((c - TRACK_W/2, c + TRACK_W/2))
    mk('T34_Track_' + tag, *band(T34_RING, x0, x1), C, M_TRACK)
    for i, y in enumerate((-2.10, -1.15, -0.20, 0.75, 1.55)):
        mk('T34_Wheel_%s%d' % (tag, i), *cyl(c, y, 0.42, 0.42, TRACK_W*0.8, axis='X', seg=12), C, M_TRACK)
    mk('T34_Idler_' + tag, *cyl(c, 2.28, 0.55, 0.33, TRACK_W*0.8, axis='X', seg=12), C, M_TRACK)
    mk('T34_Sprocket_' + tag, *cyl(c, -3.18, 0.52, 0.35, TRACK_W*0.8, axis='X', seg=12), C, M_TRACK)
    mk('T34_Fender_' + tag, *box(s*(WL + TRACK_OUT)/2, -0.49, ZK + 0.04, TRACK_OUT - WL, 6.10, 0.08), C, M_ARMOR)

# 砲塔：M1943 六角砲塔，上窄下寬；砲塔頂 2.50、指揮塔頂 2.62（參考模型全高）
TC_Y = -0.18
HEX = [(0.60, 0.94), (0.867, 0.38), (0.867, -0.42), (0.45, -0.94),
       (-0.45, -0.94), (-0.867, -0.42), (-0.867, 0.38), (-0.60, 0.94)]
k = len(HEX)
tv, tf = [], []
for z, sc in ((1.65, 1.00), (2.50, 0.82)):
    for (x, y) in HEX:
        tv.append((x*sc*XS, TC_Y + y*sc, z))
for i in range(k):
    j = (i+1) % k
    tf.append((i, j, j+k, i+k))
tf.append(tuple(range(k))[::-1]); tf.append(tuple(range(k, 2*k)))
mk('T34_Turret', tv, tf, C, M_ARMOR)
mk('T34_Cupola', *cyl(0, TC_Y - 0.30, 2.56, 0.31, 0.14, axis='Z', seg=10), C, M_ARMOR)
mk('T34_Mantlet', *cyl(0, 0.98, 2.10, 0.22, 0.50, axis='Y', seg=10), C, M_ARMOR)
mk('T34_Gun', *cyl(0, 2.14, 2.10, 0.055, 2.10, axis='Y', seg=10), C, M_STEEL)
mk('T34_HullMG', *cyl(0.52*XS, 2.05, 1.22, 0.13, 0.26, axis='Y', seg=8), C, M_STEEL)

# ═══════════════════════════ 2. ZIS-150 ═══════════════════════════
C = fresh('ZIS150')
HW = 1.19    # 貨斗半寬（史實全寬 2.385）
CW = 1.00    # 駕駛室半寬 —— 比貨斗窄，俯視的辨識點

mk('ZIS_Frame', *box(0, 0.00, 0.80, 0.84, 6.20, 0.16), C, M_STEEL)
mk('ZIS_Bumper', *box(0, 3.34, 0.80, 1.86, 0.12, 0.20), C, M_STEEL)
# 引擎蓋上緣 1.70 一路平到 y 2.85；水箱護罩比它低
mk('ZIS_Hood', *loft([
    (1.90, [(-0.62, 0.98), (0.62, 0.98), (0.62, 1.62), (0.30, 1.70), (-0.30, 1.70), (-0.62, 1.62)]),
    (2.85, [(-0.62, 0.98), (0.62, 0.98), (0.62, 1.62), (0.30, 1.70), (-0.30, 1.70), (-0.62, 1.62)]),
    (3.10, [(-0.58, 0.98), (0.58, 0.98), (0.58, 1.50), (0.28, 1.58), (-0.28, 1.58), (-0.58, 1.50)]),
]), C, M_TRUCK)
mk('ZIS_Radiator', *loft([
    (3.10, [(-0.58, 0.94), (0.58, 0.94), (0.58, 1.50), (0.28, 1.58), (-0.28, 1.58), (-0.58, 1.50)]),
    (3.30, [(-0.52, 0.94), (0.52, 0.94), (0.52, 1.42), (0.24, 1.50), (-0.24, 1.50), (-0.52, 1.42)]),
]), C, M_TRUCK)
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    mk('ZIS_Fender_' + tag, *box(s*0.86, 2.56, 1.16, 0.56, 1.44, 0.18), C, M_TRUCK)
    mk('ZIS_Step_' + tag, *box(s*0.94, 1.60, 0.92, 0.32, 0.60, 0.08), C, M_STEEL)
mk('ZIS_Cab', *box(0, 1.16, 1.58, 2*CW, 1.48, 1.20), C, M_TRUCK)
mk('ZIS_CabRoof', *box(0, 1.16, 2.19, 2*CW + 0.06, 1.54, 0.08), C, M_TRUCK)
mk('ZIS_Windscreen', *box(0, 1.89, 1.90, 1.52, 0.06, 0.50), C, M_GLASS)
for s in (-1, 1):
    mk('ZIS_SideWindow_%s' % ('R' if s > 0 else 'L'), *box(s*(CW + 0.02), 1.22, 1.88, 0.06, 0.82, 0.46), C, M_GLASS)
mk('ZIS_BedFloor', *box(0, -1.44, 1.06, 2*HW, 3.72, 0.12), C, M_STEEL)
for s in (-1, 1):
    mk('ZIS_BedSide_%s' % ('R' if s > 0 else 'L'), *box(s*(HW - 0.05), -1.44, 1.34, 0.10, 3.72, 0.44), C, M_TRUCK)
mk('ZIS_BedTail', *box(0, -3.27, 1.34, 2*HW, 0.10, 0.44), C, M_TRUCK)
mk('ZIS_BedHead', *box(0, 0.36, 1.48, 2*HW, 0.10, 0.72), C, M_TRUCK)
mk('ZIS_Tilt', *loft([
    ( 0.40, [(-HW, 1.52), (HW, 1.52), (HW, 2.40), (0.74, 2.70), (-0.74, 2.70), (-HW, 2.40)]),
    (-3.24, [(-HW, 1.52), (HW, 1.52), (HW, 2.40), (0.74, 2.70), (-0.74, 2.70), (-HW, 2.40)]),
]), C, M_CANVAS)
for s in (-1, 1):
    tag = 'R' if s > 0 else 'L'
    mk('ZIS_WheelF_' + tag, *cyl(s*0.84, 2.56, 0.58, 0.58, 0.26, axis='X', seg=12), C, M_TIRE)
    mk('ZIS_WheelR_' + tag, *cyl(s*0.88, -1.50, 0.58, 0.58, 0.50, axis='X', seg=12), C, M_TIRE)
    mk('ZIS_RearFender_' + tag, *box(s*0.90, -1.50, 1.24, 0.62, 1.60, 0.12), C, M_TRUCK)

# ═══════════════════════════ 3. 8.8 cm Flak 18 ═══════════════════════════
C = fresh('FLAK18')
ARM, ARM_W, ARM_T, ARM_Z = 2.63, 0.35, 0.10, 0.35
TRUN_Z = 1.865         # 砲耳高度
BARREL_L = 4.94

mk('F18_ArmY', *box(0, 0, ARM_Z, ARM_W, 2*ARM, ARM_T), C, M_GUN)
mk('F18_ArmX', *box(0, 0, ARM_Z, 2*ARM, ARM_W, ARM_T), C, M_GUN)
for (dx, dy) in ((0, ARM-0.18), (0, -(ARM-0.18)), (ARM-0.18, 0), (-(ARM-0.18), 0)):
    mk('F18_Jack_%d_%d' % (round(dx*10), round(dy*10)), *box(dx, dy, 0.365, 0.34, 0.34, 0.73), C, M_GUN)
mk('F18_Pedestal', *loft([
    (-0.86, [(-0.86, 0.28), (0.86, 0.28), (0.86, 0.90), (-0.86, 0.90)]),
    ( 0.86, [(-0.86, 0.28), (0.86, 0.28), (0.86, 0.90), (-0.86, 0.90)]),
]), C, M_GUN)
mk('F18_Turntable', *cyl(0, 0, 1.20, 0.72, 0.36, axis='Z', seg=10), C, M_GUN)
for s in (-1, 1):
    mk('F18_Trunnion_%s' % ('R' if s > 0 else 'L'), *box(s*0.52, -0.10, 1.62, 0.24, 0.90, 0.84), C, M_GUN)
mk('F18_Cradle', *box(0, -0.15, TRUN_Z, 0.62, 2.05, 0.46), C, M_GUN)
mk('F18_Recuperator', *cyl(0, 0.15, TRUN_Z + 0.30, 0.13, 2.30, axis='Y', seg=8), C, M_STEEL)
# 砲身相對砲耳 −1.09…3.85（參考模型），仰角 0 照它建
mk('F18_Barrel', *cyl(0, 1.38, TRUN_Z, 0.115, BARREL_L, axis='Y', seg=10), C, M_STEEL)
# 護盾兩片，中間留 0.34 的縫給砲管俯仰
for s in (-1, 1):
    xin, xout = s*0.17, s*1.25
    mk('F18_Shield_%s' % ('R' if s > 0 else 'L'),
       *slab([(xin, 0.34, 0.55), (xout, 0.34, 0.55), (s*0.95, 0.34, 2.50), (xin, 0.34, 2.50)], 0.08 * s), C, M_GUN)

# ═══════════════════════════ 4. 2 cm Flakvierling 38 ═══════════════════════════
C = fresh('FLAK38')
# 仰角由砲口反推：參考模型砲口在 (y 1.31, z 1.87)、砲耳在 (0.05, 1.12) → 25°。
# 目測像 30°，但 30° 會把全高抬到 2.06（參考模型 1.92）。
ELEV = 25.0
TY, TZ = 0.05, 1.12    # 砲耳

mk('F38_BasePlate', *box(0, -0.05, 0.07, 1.30, 1.34, 0.14), C, M_GUN)
mk('F38_Base', *loft([
    (-0.58, [(-0.50, 0.14), (0.50, 0.14), (0.44, 0.62), (-0.44, 0.62)]),
    ( 0.52, [(-0.50, 0.14), (0.50, 0.14), (0.44, 0.62), (-0.44, 0.62)]),
]), C, M_GUN)
mk('F38_Turntable', *loft([
    (-0.48, [(-0.44, 0.62), (0.44, 0.62), (0.40, 1.12), (-0.40, 1.12)]),
    ( 0.46, [(-0.44, 0.62), (0.44, 0.62), (0.40, 1.12), (-0.40, 1.12)]),
]), C, M_GUN)
for s in (-1, 1):
    mk('F38_Trunnion_%s' % ('R' if s > 0 else 'L'), *box(s*0.36, TY, TZ, 0.14, 0.46, 0.46), C, M_GUN)
mk('F38_Cradle', *rotx(box(0, TY + 0.34, TZ, 0.60, 0.72, 0.34), ELEV, TY, TZ), C, M_GUN)
for sx in (-1, 1):
    for sz in (-1, 1):
        # 砲身 1.28：砲口落在參考模型的 y 1.31
        mk('F38_Barrel_%d%d' % (sx, sz),
           *rotx(cyl(sx*0.155, TY + 0.82, TZ + sz*0.15, 0.042, 1.28, axis='Y', seg=8), ELEV, TY, TZ), C, M_STEEL)
        mk('F38_Mag_%d%d' % (sx, sz),
           *rotx(box(sx*0.34, TY + 0.18, TZ + sz*0.15 + 0.06, 0.13, 0.22, 0.34), ELEV, TY, TZ), C, M_STEEL)
for s in (-1, 1):
    mk('F38_Seat_%s' % ('R' if s > 0 else 'L'), *box(s*0.50, -0.72, 0.96, 0.34, 0.30, 0.06), C, M_GUN)
# 護盾：後傾的前板（下緣 y 0.69 → 上緣 y 0.36）加兩片往後包的側翼
SW = 0.95
# 板厚一律往**內**長：前板往 −y、側翼往中線。往外長會把全寬撐過參考模型的 1.91。
mk('F38_Shield', *slab([(-SW, 0.69, 0.25), (SW, 0.69, 0.25), (SW, 0.36, 1.48), (-SW, 0.36, 1.48)], -0.06), C, M_GUN)
for s in (-1, 1):
    mk('F38_Wing_%s' % ('R' if s > 0 else 'L'),
       *slab([(s*SW, 0.62, 0.25), (s*SW, -1.06, 0.25), (s*SW, -1.06, 0.94), (s*SW, 0.40, 1.30)], -0.06 * s), C, M_GUN)

# ═══════════════════════════ 收尾與量測 ═══════════════════════════
TAGS = ('T34', 'ZIS150', 'FLAK18', 'FLAK38')
for tag in TAGS:
    objs = list(bpy.data.collections['LP_' + tag].objects)
    for ob in objs:
        ob.data.validate()
    lo, hi = col_bounds(objs)
    LOG[tag] = {
        'tris': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs),
        'size_xyz': [round(hi[i] - lo[i], 3) for i in range(3)],
        'min_z': round(lo.z, 3),
    }


def objs_of(tag, pick):
    return [o for o in bpy.data.collections['LP_' + tag].objects if pick(o.name)]


# 砲管的節點名前綴。砲管會轉，所以不進命中盒；之後接旋轉動畫也靠這個認節點。
# **與 src/render/geometry/ground/index.ts 的 barrelNodes 是同一份合約。**
BARREL_NODES = {'T34': ('T34_Gun',), 'ZIS150': (), 'FLAK18': ('F18_Barrel',), 'FLAK38': ('F38_Barrel_',)}

# 命中盒：一台一個大盒 —— 砲管以外整台的包圍盒換成遊戲座標。地面目標不需要
# 逐部位傷害。抄進 index.ts 的 hull。
for tag in TAGS:
    LOG[tag]['hitbox'] = game_box(objs_of(tag, lambda n, t=tag: not n.startswith(BARREL_NODES[t])))

GLB_NAMES = {'T34': 't34.glb', 'ZIS150': 'zis150.glb', 'FLAK18': 'flak18.glb', 'FLAK38': 'flak38.glb'}
# 在 Blender 裡排開看用的 X 位移。幾何本身全在原點，位移只放在物件的 location。
LAYOUT_X = {'T34': 0.0, 'ZIS150': 9.0, 'FLAK18': 18.0, 'FLAK38': 26.0}


def layout(on=True):
    for tag in TAGS:
        for o in bpy.data.collections['LP_' + tag].objects:
            o.location.x = LAYOUT_X[tag] if on else 0.0
    bpy.context.view_layer.update()


def export_all():
    """四支各匯一個 GLB。匯出時把位移歸零 —— `export_apply` 會把世界變換烘進
    頂點，排開看用的 location 一起烘進去就是整台偏了 9 m 而且看不出來。

    【temp_override】MCP 沒有 3D 視圖的 context，`export_scene.gltf` 直接呼叫會
    `Context has no attribute active_object`。"""
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    os.makedirs(OUT_DIR, exist_ok=True)
    layout(False)
    out = {}
    for tag in TAGS:
        objs = list(bpy.data.collections['LP_' + tag].objects)
        with bpy.context.temp_override(window=win, area=area, region=region):
            bpy.ops.object.select_all(action='DESELECT')
            for o in objs:
                o.select_set(True)
            bpy.context.view_layer.objects.active = objs[0]
            path = os.path.join(OUT_DIR, GLB_NAMES[tag])
            bpy.ops.export_scene.gltf(
                filepath=path, export_format='GLB', use_selection=True,
                export_yup=True, export_extras=True, export_apply=True,
                export_normals=False, export_texcoords=False,
            )
        out[tag] = {'path': path, 'bytes': os.path.getsize(path)}
    layout(True)
    return out


layout(True)
result = LOG
