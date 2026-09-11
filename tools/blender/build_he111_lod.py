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


# 蒙皮的上半部在這一段不存在（實測 `Mesh_30` 的中線冠頂由 −0.50 斷到 −3.00）。
# 【為什麼不自動偵測】翼根整流 `Mesh_32` 在那一段正好擋在中線上，由上往下打
# 讀到的是它的頂面、法線朝上，看起來完全像一個正常的剖面 —— 只是矮了 1.5 m。
SKIN_GAP = (-3.05, -0.45)


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
NAC_F = (0.005, 0.10, 0.24, 0.45, 0.72, 0.98)


def build_nacelle(src, name):
    T = tree(src)
    lo, hi = box(src)
    cx = (lo.x + hi.x) * 0.5

    def zc_of(y):
        a = L.cast(T, (cx, y, 8), (0, 0, -1), 16)
        b = L.cast(T, (cx, y, -8), (0, 0, 1), 16)
        return None if (a is None or b is None) else (a.z + b.z) * 0.5

    ys = [hi.y - (hi.y - lo.y) * f for f in NAC_F]
    rings = L.tube(T, ys, NAC_ANG, cx=cx, reach=6.0, zc_of=zc_of)
    if len(rings) < 3:
        raise SystemExit('%s 量不到足夠的剖面' % name)
    bm = bmesh.new()
    vs, _ = L.loft(bm, rings)
    for f in L.cap(bm, list(reversed(vs[0]))):
        f.material_index = 1
    L.cap(bm, vs[-1])
    return L.new_object(OUT, name, bm, [M_BODY, M_ACC])


build_nacelle('Mesh_3', 'HE111_NacR')
build_nacelle('Mesh_10', 'HE111_NacL')

# 散熱器浴盆（艙下）與滑油冷卻器進氣（艙上）：各做成外接盒定出來的橢球。
# 出貨版一共 1,456 個三角形，低模 192。
for _src, _name in (('Mesh_4', 'HE111_ScoopR'), ('Mesh_11', 'HE111_ScoopL'),
                    ('Mesh_5', 'HE111_IntakeR'), ('Mesh_12', 'HE111_IntakeL')):
    L.ellipsoid(OUT, _name, *box(_src), [M_BODY])


# ═══════════════════════ 3. 原樣搬過來的件 ═══════════════════════
#
# 【這幾件已經夠便宜】整片主翼 192 個三角形、水平尾翼 152、垂尾 36 —— 程式版
# 的翼面本來就是低多邊形的平板，重建只會**變多**（照 B-17 的參數重做主翼是
# 268）。槳轂與槳葉也是，一片 12 個三角形已經到底。
# 【玻璃件原樣搬】座艙罩與腹艙的玻璃邊是帶弧度的輪廓，做不出來也不該做 ——
# 它們一共只有 392 個三角形。底下那層機身 loft 是實心的，玻璃蓋在外面，
# 兩件重疊的部分看不到。
KEEP = [
    ('Mesh_1', 'HE111_Canopy'),
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
for _n in sorted(n for n in O if n.startswith('HE111_Prop')):
    L.copy_part(OUT, O[_n], _n, REMAP, M_ACC)


L.report(OUT, BEFORE)
L.export(os.path.join(MODELS, 'he111_lod2.glb'), SRC)
