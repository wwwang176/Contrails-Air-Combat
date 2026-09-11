"""
停放的 B-17G 用的低模 —— **對出貨的 `b17g.glb` 量、直接 loft 一台新的**。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/build_b17g_lod.py

產物 `public/models/b17g_lod2.glb`。驗收走
`tools/blender/check_lod_silhouette.py` 與 `/lod.html`。

【為什麼是重建而不是減面】減面動的是既有的三角網：焊點、抽環、塌邊都會在
不該斷的地方斷開，機身於是碎成一塊一塊。重建走的是與 `build_b17.py` 同一條
路 —— 射線量剖面、以粗解析度重新 loft。每一件都是自己閉合的殼，破面在構造上
就不存在。

【量的是出貨的 GLB，不是參考模型】`b17g.glb` 是負責人後續美化調整過的那一份，
外型以它為準。

【材質只留三種】`buildAircraft.ts` 的 `b17g_lod2` 只掛 Body／Accent／Glass，
而 `parseGlbTemplate` 兩邊都要對得上：GLB 裡出現表上沒有的材質會被拒載，
表上有而 GLB 裡沒有的會丟「manifest 過期了」。

【槳葉節點名不能改】`glb.ts` 的 `isNamed` 認「B17_PropN + 可有可無的分隔符 +
數字」，四具各要找得到至少一片；`B17_SpinnerN` 因此不能叫 `B17_PropN`。

【停放的飛機只烘得到頂點色】`ground/parked.ts` 把材質色塗進頂點色、用同一顆
不透明材質畫，所以這裡的 Glass 只是一塊淺藍色，不會有透明穿透的問題。
"""
import bmesh
import bpy
import math
import os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'public', 'models')
SRC = os.path.join(MODELS, 'b17g.glb')
DST = os.path.join(MODELS, 'b17g_lod2.glb')


# ───────────────────────── 場景與材質 ─────────────────────────
def srgb(h):
    def c(u):
        u /= 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1.0)


def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = rgb
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
SRC_OBJS = [o for o in bpy.data.objects if o.type == 'MESH']
# 【來源先改名】新件與來源同名的話 Blender 會自動加 `.001` 尾碼，匯出的節點名
# 與材質名跟著變。`glb.ts` 靠節點名找螺旋槳、靠材質名對遊戲材質，名字漂掉
# 就是「找不到螺旋槳節點」與「沒有對應的遊戲材質」。
O = {}
for _o in SRC_OBJS:
    O[_o.name] = _o
    _o.name = 'Ref_' + _o.name
for _m in list(bpy.data.materials):
    _m.name = 'Ref_' + _m.name

M_BODY = mat('B17_Body', srgb(0x8d9299))
M_ACC = mat('B17_Accent', srgb(0x3c4147))
M_GLASS = mat('B17_Glass', srgb(0x9fd4e8))

OUT = bpy.data.collections.new('B17_LOD')
bpy.context.scene.collection.children.link(OUT)


def new_object(name, bm, mats):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    OUT.objects.link(ob)
    return ob


# ───────────────────────── 量尺 ─────────────────────────
def bvh(names):
    """把幾個來源物件併成一棵 BVH，座標是世界座標。"""
    acc = bmesh.new()
    for n in names:
        o = O[n]
        one = bmesh.new()
        one.from_mesh(o.data)
        one.transform(o.matrix_world)
        me = bpy.data.meshes.new('_tmp')
        one.to_mesh(me)
        one.free()
        acc.from_mesh(me)
        bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(acc, faces=acc.faces)
    t = BVHTree.FromBMesh(acc)
    acc.free()
    return t


def cast(T, origin, direction, length):
    return T.ray_cast(Vector(origin), Vector(direction).normalized(), length)[0]


def bounds(names):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for n in names:
        o = O[n]
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def fill_gaps(rad):
    """環狀的缺口用左右鄰居線性補。整圈皆空回 None。"""
    n = len(rad)
    if all(r is None for r in rad):
        return None
    for i in range(n):
        if rad[i] is not None:
            continue
        back = next(k for k in range(1, n) if rad[(i - k) % n] is not None)
        fwd = next(k for k in range(1, n) if rad[(i + k) % n] is not None)
        a, b = rad[(i - back) % n], rad[(i + fwd) % n]
        rad[i] = a + (b - a) * back / (back + fwd)
    return rad


# ───────────────────────── 通用 loft ─────────────────────────
def loft(bm, rings):
    """一串等長的環接成管。回傳每一環的頂點與新增的面。"""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(vs, vs[1:]):
        for j in range(n):
            k = (j + 1) % n
            q = [a[j], a[k], b[k], b[j]]
            if len(set(q)) < 4:
                continue
            try:
                faces.append(bm.faces.new(q))
            except ValueError:
                pass
    return vs, faces


def cap(bm, verts):
    try:
        return [bm.faces.new(verts)]
    except ValueError:
        return []


def fan(bm, verts, apex):
    a = bm.verts.new(apex)
    n = len(verts)
    out = []
    for j in range(n):
        k = (j + 1) % n
        if verts[j] is verts[k]:
            continue
        try:
            out.append(bm.faces.new([verts[j], verts[k], a]))
        except ValueError:
            pass
    return out


def shrink(ring, k):
    """把一環往它自己的形心縮 —— 翼尖與尾錐收口用。"""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    cz = sum(p[2] for p in ring) / len(ring)
    return [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, cz + (p[2] - cz) * k) for p in ring]


def offset(ring, d):
    return [(p[0] + d[0], p[1] + d[1], p[2] + d[2]) for p in ring]


# ═══════════════════════ 1. 機身 ═══════════════════════
#
# 機身蒙皮、機首罩、尾艙罩與天文觀測罩**合成一件 loft**。星狀射線（由外朝
# 剖面中心打，取最外面那個交點）讀到的是這一堆的聯集輪廓，而聯集對中心是
# 星狀的，所以等角取樣不會自交。
#
# 【機背甲板與砲塔不能併進來】它們與機身之間有**折線**：甲板的側緣落在
# 仰角 66° —— 正好卡在 60° 與 90° 兩個取樣角中間。剖面中心沿機身抖個幾公分，
# 60° 那一發就在「打到甲板側壁」與「打到機身肩線」之間來回跳，側視於是長出
# 一條鋸齒。折線要嘛取樣點壓在它上面，要嘛把那一件分開做；分開做才與來源
# 的構造一致。
#
# 【機首罩最後 0.3 m 收得很急】那一段站位要密，不然機首變成一個鈍頭。
FUS_SHELL = ['B17_Fuselage', 'B17_Glass', 'B17_Hood', 'B17_Astro']
FUS_Y = [6.29, 6.15, 5.90, 5.50, 4.90, 4.20, 3.60, 3.00, 2.30, 1.60, 0.80, 0.00,
         -1.00, -2.10, -3.20, -4.40, -5.60, -7.00, -8.80, -10.80, -12.60,
         -14.20, -15.30, -16.26]
FUS_SEG = 12                      # 每環 12 點：0/90/180/270 都落在點上
FUS_ANG = [2 * math.pi * i / FUS_SEG for i in range(FUS_SEG)]

# 機首罩整圈是玻璃（投彈手罩子整顆都是）
NOSE_GLASS_Y = 5.30

FUS = bvh(FUS_SHELL)
FUS_SKIN = bvh(['B17_Fuselage'])


def centre_z(T, y):
    top = cast(T, (0, y, 12), (0, 0, -1), 24)
    bot = cast(T, (0, y, -12), (0, 0, 1), 24)
    if top is None or bot is None:
        return None
    return (top.z + bot.z) * 0.5


def star_ring(T, y, zc, angles, cx=0.0, reach=14.0):
    """由外往剖面中心打一圈，取最外面的交點。"""
    rad = []
    for a in angles:
        c, s = math.cos(a), math.sin(a)
        h = cast(T, (cx + reach * c, y, zc + reach * s), (-c, 0, -s), reach * 2)
        rad.append(None if h is None else math.hypot(h.x - cx, h.z - zc))
    rad = fill_gaps(rad)
    if rad is None:
        return None
    return [(cx + r * math.cos(a), y, zc + r * math.sin(a)) for r, a in zip(rad, angles)]


fus_rings = []
fus_zc = []
for _y in FUS_Y:
    _zc = centre_z(FUS, _y)
    if _zc is None:
        raise SystemExit('機身站位 y=%.2f 量不到剖面' % _y)
    _r = star_ring(FUS, _y, _zc, FUS_ANG)
    if _r is None:
        raise SystemExit('機身站位 y=%.2f 整圈都打空' % _y)
    fus_rings.append(_r)
    fus_zc.append(_zc)

# 【尾端要補到真正的末端】末站再往後量就落空，而少掉的那 8 cm 過不了
# `ground-units.test.ts` 的「命中盒沒有伸出幾何的包圍盒」—— 命中盒是照出貨版
# 的長度定的。尾錐是鈍口不是尖點，所以補的是一個縮小的環再封蓋，不是扇形收尖。
fus_rings.append(offset(shrink(fus_rings[-1], 0.55),
                        (0, bounds(['B17_Fuselage'])[0].y - FUS_Y[-1], 0)))

_bm = bmesh.new()
_vs, _faces = loft(_bm, fus_rings)
# 機首收成一點：罩子的尖端就是蒙皮的最前緣
_nose = fan(_bm, _vs[0], (0.0, bounds(['B17_Glass'])[1].y, fus_zc[0]))
_tail = cap(_bm, list(reversed(_vs[-1])))

for _f in _faces + _nose + _tail:
    if _f.calc_center_median().y >= NOSE_GLASS_Y:
        _f.material_index = 1
new_object('B17_Fuselage', _bm, [M_BODY, M_GLASS])


# ═══════════════════════ 2. 機背甲板 ═══════════════════════
#
# 座艙頂到無線電艙的那一塊抬高的甲板，是一片蓋在圓機身上的蓋子。低模做成
# 一根斷面像倒 U 的短管：頂面照量測的橫斷面走，兩側壁往下**埋進機身裡**
# —— 兩件重疊的部分都是機身色，看不出來，而分開做就沒有折線取樣的問題。
DOR_Y = [3.38, 3.10, 2.60, 1.80, 0.60, -0.80, -2.20, -3.30, -4.05]
DOR_FX = (-0.99, -0.60, 0.0, 0.60, 0.99)
DOR_BURY = 0.15                   # 側壁底緣比機身冠線再低這麼多
DORSAL = bvh(['B17_Dorsal'])


def dorsal_ring(y):
    """【半寬由上往下掃一排取樣點定】蓋子的側緣是掠射面，橫著打一發常常擦過去
    讀不到；而且它中線上有艙口開孔，由中線往外掃會提早斷掉。整排打、取最外面
    打得到的那個 x 兩者都躲得開。"""
    crown = cast(FUS_SKIN, (0, y, 9), (0, 0, -1), 18)
    if crown is None:
        return None
    xs, zs = [], []
    for i in range(-60, 61):
        x = i * 0.02
        h = cast(DORSAL, (x, y, 9), (0, 0, -1), 18)
        if h is not None:
            xs.append(x)
            zs.append(h.z)
    if len(xs) < 5:
        return None
    hw = max(abs(xs[0]), abs(xs[-1]))
    top = []
    for f in DOR_FX:
        x = hw * f
        j = min(range(len(xs)), key=lambda k: abs(xs[k] - x))
        top.append((x, y, zs[j]))
    zb = crown.z - DOR_BURY
    return [(-hw, y, zb)] + top + [(hw, y, zb)]


_rings = [r for r in (dorsal_ring(_y) for _y in DOR_Y) if r is not None]
if len(_rings) < 3:
    raise SystemExit('機背甲板量不到足夠的剖面')
_bm = bmesh.new()
_vs, _ = loft(_bm, _rings)
cap(_bm, list(reversed(_vs[0])))
cap(_bm, _vs[-1])
new_object('B17_Dorsal', _bm, [M_BODY])


# ═══════════════════════ 3. 砲塔 ═══════════════════════
#
# 頂／下頷／球形三座。各做成一顆由來源件外接盒定出來的橢球，埋一半在機身裡。
TUR_SEG = 8
TUR_RINGS = 3


def build_turret(name):
    lo, hi = bounds([name])
    c = (lo + hi) * 0.5
    a = (hi - lo) * 0.5
    bm = bmesh.new()
    rings = []
    for i in range(1, TUR_RINGS + 1):
        t = math.pi * i / (TUR_RINGS + 1)
        y = c.y + a.y * math.cos(t)
        k = math.sin(t)
        rings.append([(c.x + a.x * k * math.cos(2 * math.pi * j / TUR_SEG), y,
                       c.z + a.z * k * math.sin(2 * math.pi * j / TUR_SEG))
                      for j in range(TUR_SEG)])
    vs, _ = loft(bm, rings)
    fan(bm, vs[0], (c.x, hi.y, c.z))
    fan(bm, list(reversed(vs[-1])), (c.x, lo.y, c.z))
    return new_object(name, bm, [M_ACC])


for _n in ('B17_TopTurret', 'B17_ChinTurret', 'B17_BallTurret'):
    build_turret(_n)


# ═══════════════════════ 4. 翼面 ═══════════════════════
#
# 主翼／水平尾翼／垂尾都是「沿展長一站一站量剖面、再 loft」。剖面點取在弦長
# 的固定比例上：前後緣各一點（上下面在那裡本來就合起來），中間幾成各取上下
# 兩點。
#
# 【前後緣要往內縮一點點】正好打在緣上是切線，射線常常擦過去；縮 1.5% 弦長
# 讀到的是同一個位置，而且一定命中。
EDGE_IN = 0.015


def chord_ends(probe, sta, ylo, yhi, step=0.02):
    """這一站的前緣（+y）與後緣（−y）。量不到就回 None。"""
    hits = []
    n = int((yhi - ylo) / step) + 1
    for i in range(n):
        y = ylo + i * step
        if probe(sta, y) is not None:
            hits.append(y)
    if len(hits) < 2:
        return None
    return max(hits), min(hits)


def panel_ring(probe, mk, sta, ylo, yhi, fracs):
    """一站的剖面環：前緣 → 上表面 → 後緣 → 下表面。"""
    ends = chord_ends(probe, sta, ylo, yhi)
    if ends is None:
        return None
    le, te = ends
    chord = le - te
    if chord < 1e-3:
        return None

    def at(f):
        return probe(sta, le - chord * f)

    head, foot = at(EDGE_IN), at(1.0 - EDGE_IN)
    if head is None or foot is None:
        return None
    mid = []
    for f in fracs:
        h = at(f)
        if h is None:
            return None
        mid.append((le - chord * f, h))
    ring = [mk(sta, le, (head[0] + head[1]) * 0.5)]
    ring += [mk(sta, y, h[0]) for y, h in mid]
    ring.append(mk(sta, te, (foot[0] + foot[1]) * 0.5))
    ring += [mk(sta, y, h[1]) for y, h in reversed(mid)]
    return ring


def build_panel(name, probe, mk, stations, ylo, yhi, fracs, ends):
    """`ends` 是兩端收口環的 (縮放, 位移)；翼尖是圓的，切平會少一截。"""
    rings = []
    for s in stations:
        r = panel_ring(probe, mk, s, ylo, yhi, fracs)
        if r is None:
            raise SystemExit('%s 站位 %.2f 量不到剖面' % (name, s))
        rings.append(r)
    (k0, d0), (k1, d1) = ends
    seq = []
    if k0 is not None:
        seq.append(offset(shrink(rings[0], k0), d0))
    seq += rings
    if k1 is not None:
        seq.append(offset(shrink(rings[-1], k1), d1))
    bm = bmesh.new()
    vs, _ = loft(bm, seq)
    cap(bm, list(reversed(vs[0])))
    cap(bm, vs[-1])
    return new_object(name, bm, [M_BODY])


# —— 主翼：展長沿 x、弦長沿 y、厚度沿 z ——
WING = bvh(['B17_Wing'])


def plate_probe(T):
    def probe(x, y):
        a = cast(T, (x, y, 6), (0, 0, -1), 12)
        b = cast(T, (x, y, -6), (0, 0, 1), 12)
        return None if (a is None or b is None) else (a.z, b.z)
    return probe


def plate_mk(x, y, z):
    return (x, y, z)


build_panel('B17_Wing', plate_probe(WING), plate_mk,
            [-15.55, -14.7, -13.6, -11.0, -8.0, -5.0, -2.0, 0.0, 2.0, 5.0, 8.0, 11.0,
             13.6, 14.7, 15.55],
            -5.2, 2.2, [0.10, 0.32, 0.65],
            ((0.25, (-0.26, 0, 0)), (0.25, (0.26, 0, 0))))

# —— 水平尾翼 ——
build_panel('B17_Tailplane', plate_probe(bvh(['B17_Tailplane'])), plate_mk,
            [-6.35, -5.6, -4.6, -2.6, 0.0, 2.6, 4.6, 5.6, 6.35],
            -14.6, -10.2, [0.28, 0.62],
            ((0.25, (-0.20, 0, 0)), (0.25, (0.20, 0, 0))))

# —— 垂尾：展長沿 z、弦長沿 y、厚度沿 x ——
#
# 這一件連著從機背長出來的背鰭整流罩（一路往前到 y −5.2），所以最底下那一站
# 的弦長有 10 m。底部站位要密，整流罩才不會變成一條直斜線。
FIN = bvh(['B17_Fin'])


def fin_probe(z, y):
    a = cast(FIN, (4, y, z), (-1, 0, 0), 8)
    b = cast(FIN, (-4, y, z), (1, 0, 0), 8)
    return None if (a is None or b is None) else (a.x, b.x)


def fin_mk(z, y, x):
    return (x, y, z)


build_panel('B17_Fin', fin_probe, fin_mk,
            [1.40, 1.75, 2.20, 2.80, 3.50, 4.25, 4.90, 5.40],
            -15.8, -4.8, [0.30, 0.66],
            ((None, None), (0.25, (0, 0, 0.23))))


# ═══════════════════════ 5. 發動機艙 ═══════════════════════
#
# 四具各占 900 多個三角形，是原模型最大的一塊。艙身是沿 y 的短管，跟機身
# 一樣用星狀射線量，只是環細一點（8 點）。
NAC_SEG = 8
NAC_ANG = [2 * math.pi * i / NAC_SEG for i in range(NAC_SEG)]
# 由艙首往後的比例。前段密：整流罩的唇口是圓的，後段是一路收的整流尾
NAC_F = (0.02, 0.10, 0.24, 0.45, 0.72, 0.98)


def build_nacelle(name):
    T = bvh([name])
    lo, hi = bounds([name])
    cx = (lo.x + hi.x) * 0.5
    rings = []
    for f in NAC_F:
        y = hi.y - (hi.y - lo.y) * f
        top = cast(T, (cx, y, 8), (0, 0, -1), 16)
        bot = cast(T, (cx, y, -8), (0, 0, 1), 16)
        if top is None or bot is None:
            continue
        r = star_ring(T, y, (top.z + bot.z) * 0.5, NAC_ANG, cx=cx, reach=6.0)
        if r is not None:
            rings.append(r)
    if len(rings) < 3:
        raise SystemExit('%s 量不到足夠的剖面' % name)
    bm = bmesh.new()
    vs, _ = loft(bm, rings)
    cap(bm, list(reversed(vs[0])))
    cap(bm, vs[-1])
    return new_object(name, bm, [M_BODY])


for _n in ('B17_NacIL', 'B17_NacIR', 'B17_NacOL', 'B17_NacOR'):
    build_nacelle(_n)


# ═══════════════════════ 6. 槳轂與槳葉 ═══════════════════════
#
# 槳轂是六角錐、槳葉是薄長方體 —— 兩者的尺寸與位置都由來源件量出來，
# `b17g.model.ts` 的四具轉軸座標一個都沒動。
SPIN_SEG = 6
HUB = {1: (3.050, 0.002), 2: (6.571, 0.257), 3: (-3.050, 0.002), 4: (-6.571, 0.257)}


def build_spinner(name):
    lo, hi = bounds([name])
    cx, cz = (lo.x + hi.x) * 0.5, (lo.z + hi.z) * 0.5
    r = max(hi.x - lo.x, hi.z - lo.z) * 0.5
    bm = bmesh.new()
    vs = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / SPIN_SEG), lo.y,
                        cz + r * math.sin(2 * math.pi * i / SPIN_SEG)))
          for i in range(SPIN_SEG)]
    fan(bm, vs, (cx, hi.y, cz))
    cap(bm, list(reversed(vs)))
    return new_object(name, bm, [M_ACC])


def build_blade(name, hub):
    """薄長方體：長度沿葉展、弦長沿旋轉方向、厚度沿轉軸。"""
    o = O[name]
    pts = [o.matrix_world @ Vector(v.co) for v in o.data.vertices]
    hx, hz = hub
    # 葉展方向：轉軸指向葉片形心，在旋轉平面（x–z）上
    dx = sum(p.x for p in pts) / len(pts) - hx
    dz = sum(p.z for p in pts) / len(pts) - hz
    L = math.hypot(dx, dz)
    ux, uz = dx / L, dz / L
    px, pz = -uz, ux
    rad = [(p.x - hx) * ux + (p.z - hz) * uz for p in pts]
    cho = [(p.x - hx) * px + (p.z - hz) * pz for p in pts]
    r0, r1 = min(rad), max(rad)
    c0, c1 = min(cho), max(cho)
    y0, y1 = min(p.y for p in pts), max(p.y for p in pts)

    def pt(r, c, y):
        return (hx + ux * r + px * c, y, hz + uz * r + pz * c)

    bm = bmesh.new()
    vs, _ = loft(bm, [[pt(r0, c0, y0), pt(r0, c1, y0), pt(r0, c1, y1), pt(r0, c0, y1)],
                      [pt(r1, c0, y0), pt(r1, c1, y0), pt(r1, c1, y1), pt(r1, c0, y1)]])
    cap(bm, list(reversed(vs[0])))
    cap(bm, vs[-1])
    return new_object(name, bm, [M_ACC])


for _i in range(1, 5):
    build_spinner('B17_Spinner%d' % _i)
    for _suf in ('', '.001', '.002'):
        build_blade('B17_Prop%d%s' % (_i, _suf), HUB[_i])


# ═══════════════════════ 收尾 ═══════════════════════
for _o in SRC_OBJS:
    bpy.data.objects.remove(_o, do_unlink=True)

_total = 0
for _o in sorted(OUT.objects, key=lambda x: x.name):
    _n = sum(len(p.vertices) - 2 for p in _o.data.polygons)
    _total += _n
    print('%6d tri  %s' % (_n, _o.name))
print('== 低模合計 %d 個三角形（出貨版 13,251）' % _total)

bpy.ops.export_scene.gltf(
    filepath=DST,
    export_format='GLB',
    export_apply=True,
    export_materials='EXPORT',
    export_normals=True,
    export_yup=True,
)
print('== 寫出 ' + DST)
