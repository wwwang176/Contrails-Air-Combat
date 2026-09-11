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

# 逐面塗玻璃的三段。機首整顆是玻璃；座艙罩只有頂上那一段；腹艙只有底下那一段
NOSE_GLASS_Y = 1.62
CANOPY = ((-4.30, -0.40), (55, 125))
GONDOLA = ((-5.40, -2.60), (235, 305))

FUS = tree('Mesh_30', 'Mesh_0', 'Mesh_32', 'Mesh_1', 'Mesh_17', 'Mesh_18')

_rings = []
_zc = []
for _y in FUS_Y:
    _z = L.centre_z(FUS, _y)
    if _z is None:
        raise SystemExit('機身站位 y=%.2f 量不到剖面' % _y)
    _r = L.star_ring(FUS, _y, _z, FUS_ANG)
    if _r is None:
        raise SystemExit('機身站位 y=%.2f 整圈都打空' % _y)
    _rings.append(_r)
    _zc.append(_z)

# 尾錐收成一個小環再封蓋（末站半徑已經只剩 0.03，再往後量就落空）
_rings.append(L.offset(L.shrink(_rings[-1], 0.5),
                       (0, box('Mesh_30')[0].y - FUS_Y[-1], 0)))

_bm = bmesh.new()
_vs, _faces = L.loft(_bm, _rings)
_faces += L.fan(_bm, _vs[0], (0.0, box('Mesh_0')[1].y, _zc[0]))
_faces += L.cap(_bm, list(reversed(_vs[-1])))


def _band(y):
    """這一站的剖面中心，逐面塗材質時要拿它算方位角。"""
    lo = 0
    for i, v in enumerate(FUS_Y):
        if v >= y:
            lo = i
    return _zc[min(lo, len(_zc) - 1)]


for _f in _faces:
    c = _f.calc_center_median()
    if c.y >= NOSE_GLASS_Y:
        _f.material_index = 1
        continue
    a = math.degrees(math.atan2(c.z - _band(c.y), c.x)) % 360
    for (y0, y1), (a0, a1) in (CANOPY, GONDOLA):
        if y0 <= c.y <= y1 and a0 <= a <= a1:
            _f.material_index = 1
            break
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
KEEP = [
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
