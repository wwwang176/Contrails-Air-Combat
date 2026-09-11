"""
遠處的 He 111 用的低模 —— 對出貨的 `he111.glb` 量、直接 loft 一台新的。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/build_he111_lod.py

產物 `public/models/he111_lod2.glb`。驗收走
    ...check_lod_silhouette.py -- he111
共用的工具在 `lodlib.py`，做法與 `build_b17g_lod.py` 相同。

【這一台的件名是 `Mesh_N`】He 111 的 GLB 是程式版用 `GLTFExporter` 吐出來、
在 Blender 裡焊過重複頂點的，沒有人取過名字。低模這邊改成看得懂的名字；
**只有 `HE111_PropN` 不能動**，`glb.ts` 靠它找螺旋槳。

【外皮不只蒙皮那一件】`Mesh_30` 在 y −0.6…−2.6 沒有上半部 —— 那一段的外皮是
座艙玻璃 `Mesh_1`。只量蒙皮的話剖面中心會掉到腹板上（量到 −0.82，實際 0.35），
整段機身塌成一條。翼根整流 `Mesh_32`（x ±1.32，比蒙皮寬）與腹艙 `Mesh_17`／
`Mesh_18` 也一起收進來，那幾件才不會變成外面的孤島。

【材質只留三種】`buildAircraft.ts` 的 `he111_lod2` 只掛 Body／Accent／Glass。
`Cockpit`（內裝殼）、`Frame`（機首窗框）、`Inner`（進氣口內壁）三種連同它們的
2,272 個三角形一起不做 —— 由外面看不到。
"""
import bmesh
import math
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lodlib as L                                                  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'public', 'models')

O, SRC = L.prepare_source(os.path.join(MODELS, 'he111.glb'))
BEFORE = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SRC)

M_BODY = L.mat('HE111_Body', L.srgb(0x5a6350))
M_ACC = L.mat('HE111_Accent', L.srgb(0x2b3128))
M_GLASS = L.mat('HE111_Glass', L.srgb(0x9fd4e8))
OUT = L.new_collection('HE111_LOD')
REMAP = {'HE111_Body': M_BODY, 'HE111_Accent': M_ACC, 'HE111_Glass': M_GLASS}


def tree(*names):
    return L.bvh([O[n] for n in names])


def box(*names):
    return L.bounds([O[n] for n in names])


# ═══════════════════════ 1. 機身 ═══════════════════════
#
# 蒙皮、玻璃機首、座艙玻璃、翼根整流、腹艙合成一件 loft。
FUS_Y = [3.05, 2.80, 2.45, 2.05, 1.64, 1.10, 0.40, -0.40, -1.20, -2.00, -2.80,
         -3.60, -4.40, -5.40, -6.60, -8.00, -9.60, -11.00, -12.20, -12.80]
FUS_ANG = L.ring_angles(12)

# 【機首整顆塗玻璃，座艙罩與腹艙不塗】機首與蒙皮的接縫是一圈乾淨的等 y 環
# （蒙皮止於 1.64、玻璃由 1.64 起），照 y 切就對得上。座艙罩與腹艙的玻璃邊
# 是帶弧度的輪廓，用「y 範圍 × 仰角範圍」去塗只會切出直邊 —— 那兩件改成原樣
# 搬過來蓋上去（見第 3 節）。
NOSE_GLASS_Y = 1.62

# 【座艙罩與腹艙不能進量測】它們與蒙皮之間有折線：罩子的側緣落在兩個取樣角
# 中間時，60° 那一發打到蒙皮（在罩子外側）、90° 打到罩頂，兩點之間的直邊就
# 切進罩子的肩線 —— 搬過來的玻璃有兩成的頂點被蒙皮吃掉，最深 10 cm。
#
# 【但蒙皮在 y −0.6…−2.6 沒有上半部】那一段的外皮本來就是座艙玻璃。只量蒙皮
# 的話那幾站讀到的是腹板（中線上下都是 −0.86），整段機身塌成一條。做法是
# **認出那幾站、由前後兩站內插** —— 機身在那一段幾乎是等剖面（前後兩站的
# 半徑差不到 2 cm），內插的誤差比取樣本身還小。
FUS = tree('Mesh_30', 'Mesh_0', 'Mesh_32')


# 【缺口就是座艙罩的長度】座艙罩取代的是整個上殼，不是只有中線那一條 ——
# 實測肩線（x 0.8）在罩子底下整段掉 0.4…0.9 m，而中線的冠頂只斷在 −0.50…−3.00。
# 照中線量出來的範圍去補，罩子兩側的肩線就會留著一條又長又深的凹陷。
#
# 【為什麼不自動偵測】翼根整流 `Mesh_32` 在那一段正好擋在中線上，由上往下打
# 讀到的是它的頂面、法線朝上，看起來完全像一個正常的剖面 —— 只是矮了 1.5 m。
_CLO, _CHI = box('Mesh_1')
SKIN_GAP = (_CLO.y - 0.05, _CHI.y + 0.05)


def section(y):
    """這一站的 (剖面中心, 12 個半徑)。落在蒙皮缺口裡就回 None。"""
    if SKIN_GAP[0] <= y <= SKIN_GAP[1]:
        return None
    top = L.cast(FUS, (0, y, 12), (0, 0, -1), 24)
    bot = L.cast(FUS, (0, y, -12), (0, 0, 1), 24)
    if top is None or bot is None or top.z <= bot.z:
        return None
    zc = (top.z + bot.z) * 0.5
    rad = []
    for a in FUS_ANG:
        c, s = math.cos(a), math.sin(a)
        h = L.cast(FUS, (14 * c, y, zc + 14 * s), (-c, 0, -s), 28)
        rad.append(None if h is None else math.hypot(h.x, h.z - zc))
    if sum(1 for r in rad if r is None) > 1:
        return None
    return zc, L.fill_gaps(rad)


_sec = [section(y) for y in FUS_Y]
if _sec[0] is None or _sec[-1] is None:
    raise SystemExit('機身頭尾站量不到剖面，內插沒有依據')
_filled = []
for _i, _s in enumerate(_sec):
    if _s is not None:
        continue
    _a = max(k for k in range(_i) if _sec[k] is not None)
    _b = min(k for k in range(_i + 1, len(_sec)) if _sec[k] is not None)
    _t = (FUS_Y[_i] - FUS_Y[_a]) / (FUS_Y[_b] - FUS_Y[_a])
    _za, _ra = _sec[_a]
    _zb, _rb = _sec[_b]
    _sec[_i] = (_za + (_zb - _za) * _t,
                [p + (q - p) * _t for p, q in zip(_ra, _rb)])
    _filled.append(FUS_Y[_i])
if _filled:
    print('== 蒙皮有缺口、由前後站內插的站位：'
          + '、'.join('%.2f' % v for v in _filled))

_rings = []
_zc = []
for _y, (_z, _rad) in zip(FUS_Y, _sec):
    _rings.append([(r * math.cos(a), _y, _z + r * math.sin(a))
                   for r, a in zip(_rad, FUS_ANG)])
    _zc.append(_z)

# 尾錐收成一個小環再封蓋（末站半徑已經只剩 0.03，再往後量就落空）
_rings.append(L.offset(L.shrink(_rings[-1], 0.5),
                       (0, box('Mesh_30')[0].y - FUS_Y[-1], 0)))

_bm = bmesh.new()
_vs, _faces = L.loft(_bm, _rings)
_faces += L.fan(_bm, _vs[0], (0.0, box('Mesh_0')[1].y, _zc[0]))
_faces += L.cap(_bm, list(reversed(_vs[-1])))


for _f in _faces:
    if _f.calc_center_median().y >= NOSE_GLASS_Y:
        _f.material_index = 1
L.new_object(OUT, 'HE111_Fuselage', _bm, [M_BODY, M_GLASS])


# ═══════════════════════ 2. 發動機艙 ═══════════════════════
#
# 兩具各 940 個三角形。艙身是沿 y 的短管，跟機身一樣用星狀射線量，環細一點。
# 艙首那一片塗暗色 —— 出貨版的進氣開口內壁（`Inner`）不做，開口本身要有底。
NAC_ANG = L.ring_angles(8)
# 站位是**絕對 y**，不是比例：要壓在散熱器浴盆（y 0.46…1.27）與滑油進氣
# （1.14…2.18）的前後緣上，那兩塊才描得出來。
NAC_Y = (2.565, 2.25, 2.15, 1.85, 1.50, 1.20, 1.05, 0.75, 0.50, 0.42,
         -0.30, -1.20, -2.05)


def build_nacelle(src, name):
    T = L.bvh([O[n] for n in src])
    lo, hi = L.bounds([O[n] for n in src])
    cx = (lo.x + hi.x) * 0.5

    def zc_of(y):
        a = L.cast(T, (cx, y, 8), (0, 0, -1), 16)
        b = L.cast(T, (cx, y, -8), (0, 0, 1), 16)
        return None if (a is None or b is None) else (a.z + b.z) * 0.5

    rings = L.tube(T, NAC_Y, NAC_ANG, cx=cx, reach=6.0, zc_of=zc_of)
    if len(rings) < 3:
        raise SystemExit('%s 量不到足夠的剖面' % name)
    bm = bmesh.new()
    vs, _ = L.loft(bm, rings)
    for f in L.cap(bm, list(reversed(vs[0]))):
        f.material_index = 1
    L.cap(bm, vs[-1])
    return L.new_object(OUT, name, bm, [M_BODY, M_ACC])


# 【浴盆與進氣口併進艙身一起量，不另外做件】它們是**貼著艙身的整流罩**：
# 出貨版的浴盆比艙身還窄（半寬 0.63 對 0.65），底面只低於艙底 3.5 cm。
# 另外做一顆外接盒橢球的話，最寬那一圈落在半高 —— 而艙身在那個高度已經收窄
# 到 0.55，側面就鼓出一塊瘤；把橢球往艙內埋又會讓兩端的極點從艙身戳出來。
# 併進星狀量測、站位壓在它們的前後緣上，形狀是描出來的，而且一個件都不用多。
build_nacelle(('Mesh_3', 'Mesh_4', 'Mesh_5'), 'HE111_NacR')
build_nacelle(('Mesh_10', 'Mesh_11', 'Mesh_12'), 'HE111_NacL')


# ═══════════════════════ 3. 原樣搬過來的件 ═══════════════════════
#
# 【這幾件已經夠便宜】整片主翼 192 個三角形、水平尾翼 152、垂尾 36 —— 程式版
# 的翼面本來就是低多邊形的平板，重建只會**變多**（照 B-17 的參數重做主翼是
# 268）。槳轂與槳葉也是，一片 12 個三角形已經到底。
# 【玻璃件原樣搬】座艙罩與腹艙的玻璃邊是帶弧度的輪廓，做不出來也不該做 ——
# 它們一共只有 392 個三角形。底下那層機身 loft 是實心的，玻璃蓋在外面，
# 兩件重疊的部分看不到。
KEEP = [
    ('Mesh_18', 'HE111_Gondola'),
    ('Mesh_17', 'HE111_VentWindow'),
    ('Mesh_31', 'HE111_Wing'),
    ('Mesh_33', 'HE111_Tailplane'),
    ('Mesh_19', 'HE111_Fin'),
    ('Mesh_20', 'HE111_FinTip'),
    ('Mesh_21', 'HE111_Spinner1'),
    ('Mesh_25', 'HE111_Spinner2'),
]
for _src, _name in KEEP:
    L.copy_part(OUT, O[_src], _name, REMAP, M_BODY)


# ═══════════════════════ 4. 座艙罩 ═══════════════════════
#
# `Mesh_1` 是一片規則的 loft：20 個等距站位（0.2 m 一站），前段是兩條側窗帶
# （z 0.33…0.69）、後段是抬高的罩子（z 1.09…1.65）。兩段都平滑，**抽站位**
# 就夠 —— 側窗帶的半寬與高度幾乎是直線，罩子的頂線是一個平滑的駝峰。
#
# 【為什麼不照搬】它是這台面數第三多的件（204），而抽完只剩 88。
#
# 【為什麼不併進機身】罩子取代的是整個上殼，與蒙皮之間是折線；併進去的話
# 12 邊形的弦會切過它的肩線（見第 1 節）。
#
# 【整體往外推 4.5 cm】罩子後段的側窗貼在機身最寬的那一圈上，而低模的 12 邊形
# 在兩個取樣角之間往外鼓 —— 不推的話那兩片窗會被蒙皮啃掉一角（實測最深 3.9 cm）。
CANOPY_SPLIT = 0.9                # z 以下是側窗帶，以上是罩子
CANOPY_SIDE_Y = (-4.211, -3.611, -3.011)
CANOPY_TOP_Y = (-3.011, -2.411, -1.811, -1.411, -1.011, -0.611, -0.411)
CANOPY_PUSH = 0.045

_cv = [O['Mesh_1'].matrix_world @ v.co for v in O['Mesh_1'].data.vertices]


def canopy_ring(y, pick, order):
    g = [p for p in _cv if abs(p.y - y) < 1e-3 and pick(p)]
    if len(g) < 2:
        raise SystemExit('座艙罩站位 y=%.3f 取不到剖面' % y)
    g.sort(key=order)
    return [(p.x, p.y, p.z) for p in g]


_bm = bmesh.new()
_faces = []
for _sgn in (-1.0, 1.0):
    _rings = [canopy_ring(_y, lambda p, s=_sgn: p.z < CANOPY_SPLIT and p.x * s > 0,
                          lambda p: p.z)
              for _y in CANOPY_SIDE_Y]
    _faces += L.loft(_bm, _rings, closed=False)[1]
_faces += L.loft(_bm, [canopy_ring(_y, lambda p: p.z > CANOPY_SPLIT, lambda p: p.x)
                       for _y in CANOPY_TOP_Y], closed=False)[1]
# 【法線要朝外】開口的片沒有內外之分，`recalc_face_normals` 只能任選一邊 ——
# 選錯的話整片被背面剔除，畫面上罩子整個不見
for _f in _faces:
    _f.normal_update()
    c = _f.calc_center_median()
    if _f.normal.dot(Vector((c.x, 0.0, c.z - 0.25))) < 0:
        _f.normal_flip()
_canopy = L.new_object(OUT, 'HE111_Canopy', _bm, [M_GLASS], recalc=False)
L.push_out(_canopy, CANOPY_PUSH, 0.25)
for _n in sorted(n for n in O if n.startswith('HE111_Prop')):
    L.copy_part(OUT, O[_n], _n, REMAP, M_ACC)


L.report(OUT, BEFORE)
L.export(os.path.join(MODELS, 'he111_lod2.glb'), SRC)
