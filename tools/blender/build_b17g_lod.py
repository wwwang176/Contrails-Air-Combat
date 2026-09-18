"""
停放與遠處的 B-17G 用的低模 —— **對出貨的 `b17g.glb` 量、直接 loft 一台新的**。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/build_b17g_lod.py

產物 `models-src/b17g_lod2.glb`。驗收走
`tools/blender/check_lod_silhouette.py` 與 `/lod.html`。共用的工具在 `lodlib.py`。

【為什麼是重建而不是減面】減面動的是既有的三角網：焊點、抽環、塌邊都會在
不該斷的地方斷開，機身於是碎成一塊一塊。重建走的是與 `build_b17.py` 同一條
路 —— 射線量剖面、以粗解析度重新 loft。每一件都是自己閉合的殼，破面在構造上
就不存在。

【量的是出貨的 GLB，不是參考模型】`b17g.glb` 是後續美化調整過的那一份。

【材質只留三種】`buildAircraft.ts` 的 `b17g_lod2` 只掛 Body／Accent／Glass，
而 `parseGlbTemplate` 兩邊都要對得上：GLB 裡出現表上沒有的材質會被拒載，
表上有而 GLB 裡沒有的會丟「manifest 過期了」。

【槳葉節點名不能改】`glb.ts` 的 `isNamed` 認「B17_PropN + 可有可無的分隔符 +
數字」，四具各要找得到至少一片；`B17_SpinnerN` 因此不能叫 `B17_PropN`。

【停放的飛機只烘得到頂點色】`ground/parked.ts` 把材質色塗進頂點色、用同一顆
不透明材質畫，所以這裡的 Glass 只是一塊淺藍色，不會有透明穿透的問題。
"""
import bmesh
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lodlib as L                                                  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'models-src')

O, SRC = L.prepare_source(os.path.join(MODELS, 'b17g.glb'))
BEFORE = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SRC)

M_BODY = L.mat('B17_Body', L.srgb(0x8d9299))
M_ACC = L.mat('B17_Accent', L.srgb(0x3c4147))
M_GLASS = L.mat('B17_Glass', L.srgb(0x9fd4e8))
OUT = L.new_collection('B17_LOD')


def tree(*names):
    return L.bvh([O[n] for n in names])


def box(*names):
    return L.bounds([O[n] for n in names])


PANES = sorted(n for n in O if n.startswith('B17_Pane'))


# ═══════════════════════ 1. 機身 ═══════════════════════
#
# 機身蒙皮與機首罩合成一件 loft。
#
# 【趴在機身上的東西一律分開做】機背甲板、三座砲塔、天文觀測罩、尾艙罩，
# 它們與機身之間都有**折線**：甲板的側緣落在仰角 66° —— 正好卡在 60° 與 90°
# 兩個取樣角中間。剖面中心沿機身抖個幾公分，60° 那一發就在「打到甲板側壁」與
# 「打到機身肩線」之間來回跳，側視於是長出一條鋸齒。凸起也一樣：0.8 m 長的
# 觀測罩被 12 個等角取樣吃進去之後不是一顆圓頂，是橫跨整個機背的一片楔形
# 折面；尾艙罩更嚴重，它把尾段的剖面中心整個往上拉 0.27，整條尾錐跟著摺起來。
#
# 【窗片一定要一起量】蒙皮上每一片平面窗都是布林挖出來的**洞**，而窗片是獨立
# 的物件。只量蒙皮的話射線會從窗口穿進機艙、打到裡面的東西，那一站的半寬直接
# 塌掉 —— 左舷領航窗（y 4.11…4.54）讀到的是 0.71 與 0.12，前後兩站是 1.06 與
# 0.90。窗片本來就貼齊蒙皮（角點在外 3…25 mm），補進來洞就堵住了。
#
# 【機首罩最後 0.3 m 收得很急】那一段站位要密，不然機首變成一個鈍頭。
FUS_Y = [6.29, 6.15, 5.90, 5.50, 4.90, 4.20, 3.60, 3.00, 2.30, 1.60, 0.80, 0.00,
         -1.00, -2.10, -3.20, -4.40, -5.60, -7.00, -8.80, -10.80, -12.60,
         -14.20, -15.30, -16.26]
FUS_ANG = L.ring_angles(12)       # 每環 12 點：0/90/180/270 都落在點上
NOSE_GLASS_Y = 5.30               # 投彈手罩子整圈都是玻璃

FUS = tree('B17_Fuselage', 'B17_Glass', *PANES)
FUS_SKIN = tree('B17_Fuselage')

_rings = []
_zc0 = None
for _y in FUS_Y:
    _zc = L.centre_z(FUS, _y)
    if _zc is None:
        raise SystemExit('機身站位 y=%.2f 量不到剖面' % _y)
    _r = L.star_ring(FUS, _y, _zc, FUS_ANG)
    if _r is None:
        raise SystemExit('機身站位 y=%.2f 整圈都打空' % _y)
    _rings.append(_r)
    if _zc0 is None:
        _zc0 = _zc

# 【尾端要補到真正的末端】末站再往後量就落空，而少掉的那 8 cm 過不了
# `ground-units.test.ts` 的「命中盒沒有伸出幾何的包圍盒」—— 命中盒是照出貨版
# 的長度定的。尾錐是鈍口不是尖點，所以補的是一個縮小的環再封蓋，不是扇形收尖。
_rings.append(L.offset(L.shrink(_rings[-1], 0.55),
                       (0, box('B17_Fuselage')[0].y - FUS_Y[-1], 0)))

_bm = bmesh.new()
_vs, _faces = L.loft(_bm, _rings)
# 機首收成一點：罩子的尖端就是蒙皮的最前緣
_faces += L.fan(_bm, _vs[0], (0.0, box('B17_Glass')[1].y, _zc0))
_faces += L.cap(_bm, list(reversed(_vs[-1])))
for _f in _faces:
    if _f.calc_center_median().y >= NOSE_GLASS_Y:
        _f.material_index = 1
L.new_object(OUT, 'B17_Fuselage', _bm, [M_BODY, M_GLASS])


# ═══════════════════════ 2. 機背甲板 ═══════════════════════
#
# 座艙頂到無線電艙的那一塊抬高的甲板，是一片蓋在圓機身上的蓋子。低模做成
# 一根斷面像倒 U 的短管：頂面照量測的橫斷面走，兩側壁往下**埋進機身裡**
# —— 兩件重疊的部分都是機身色，看不出來。
DOR_Y = [3.30, 3.10, 2.60, 1.80, 0.60, -0.80, -2.20, -3.30, -4.00]
DOR_FX = (-0.99, -0.60, 0.0, 0.60, 0.99)
DOR_BURY = 0.15                   # 側壁底緣比機身冠線再低這麼多
# 甲板上的無線電艙頂窗與開放槍位也是挖出來的洞，同樣要把玻璃補回來
DORSAL = tree('B17_Dorsal', 'B17_Glass')


def dorsal_ring(y):
    """【半寬由上往下掃一排取樣點定】蓋子的側緣是掠射面，橫著打一發常常擦過去
    讀不到；而且它中線上有艙口開孔，由中線往外掃會提早斷掉。整排打、取最外面
    打得到的那個 x 兩者都躲得開。"""
    crown = L.cast(FUS_SKIN, (0, y, 9), (0, 0, -1), 18)
    if crown is None:
        return None
    xs, zs = [], []
    for i in range(-60, 61):
        x = i * 0.02
        h = L.cast(DORSAL, (x, y, 9), (0, 0, -1), 18)
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
# 【兩端各補一個收口環】甲板前後都收成一個尖，最外那一站量不到寬度（掃過去
# 只剩幾個取樣點）就會被丟掉，前緣於是短掉 0.3 m —— 座艙頂的前沿整個往後退。
_dlo, _dhi = box('B17_Dorsal')
_rings = ([L.offset(L.shrink(_rings[0], 0.30), (0, _dhi.y - DOR_Y[0], 0))] + _rings
          + [L.offset(L.shrink(_rings[-1], 0.30), (0, _dlo.y - DOR_Y[-1], 0))])
L.closed_loft(OUT, 'B17_Dorsal', _rings, [M_BODY])


# ═══════════════════════ 3. 砲塔與觀測罩 ═══════════════════════
for _n in ('B17_TopTurret', 'B17_ChinTurret', 'B17_BallTurret'):
    L.ellipsoid(OUT, _n, *box(_n), [M_ACC])
L.ellipsoid(OUT, 'B17_Astro', *box('B17_Astro'), [M_BODY])


# —— 尾艙罩：趴在尾錐上的一個方塊 ——
#
# 【為什麼不照剖面 loft】它本來就是方的（見出貨版）。分四站是為了留住斜的
# 前緣與收下去的尾端；一顆外接盒方塊會把前緣切平、頂線整段抬到 1.97。
#
# 【底面要埋進尾錐】量到的罩底 1.20…1.32 本來就在機身冠線 1.30…1.59 之下。
HOOD_Y = (-13.85, -14.60, -15.30, -15.95)
HOOD_BURY = 0.06
HOOD = tree('B17_Hood')


def hood_ring(y):
    top = L.cast(HOOD, (0, y, 9), (0, 0, -1), 18)
    bot = L.cast(HOOD, (0, y, -9), (0, 0, 1), 18)
    crown = L.cast(FUS_SKIN, (0, y, 9), (0, 0, -1), 18)
    if top is None or bot is None or crown is None:
        return None
    side = L.cast(HOOD, (4, y, (top.z + bot.z) * 0.5), (-1, 0, 0), 8)
    if side is None:
        return None
    hw = abs(side.x)
    zb = min(bot.z, crown.z) - HOOD_BURY
    return [(-hw, y, zb), (hw, y, zb), (hw, y, top.z), (-hw, y, top.z)]


_rings = [r for r in (hood_ring(_y) for _y in HOOD_Y) if r is not None]
if len(_rings) < 3:
    raise SystemExit('尾艙罩量不到足夠的剖面')
_bm = bmesh.new()
_vs, _hf = L.loft(_bm, _rings)
_hf += L.cap(_bm, list(reversed(_vs[0]))) + L.cap(_bm, _vs[-1])
# 玻璃由左繞過屁股到右，頂面是蒙皮；底面埋著，塗哪一種都看不到。
# 【法線要先自己算】`BMFace.normal` 在 `recalc_face_normals` 之前是零向量，
# 直接讀會把整顆罩子判成玻璃
for _f in _hf:
    _f.normal_update()
    _f.material_index = 0 if abs(_f.normal.z) > 0.7 else 1
L.new_object(OUT, 'B17_Hood', _bm, [M_BODY, M_GLASS])


# ═══════════════════════ 4. 翼面 ═══════════════════════
L.build_panel(
    OUT, 'B17_Wing', L.plate_probe(tree('B17_Wing')), L.plate_mk,
    [-15.55, -14.7, -13.6, -11.0, -8.0, -5.0, -2.0, 0.0, 2.0, 5.0, 8.0, 11.0,
     13.6, 14.7, 15.55],
    -5.2, 2.2, [0.10, 0.32, 0.65],
    ((0.25, (-0.26, 0, 0)), (0.25, (0.26, 0, 0))), [M_BODY])

L.build_panel(
    OUT, 'B17_Tailplane', L.plate_probe(tree('B17_Tailplane')), L.plate_mk,
    [-6.35, -5.6, -4.6, -2.6, 0.0, 2.6, 4.6, 5.6, 6.35],
    -14.6, -10.2, [0.28, 0.62],
    ((0.25, (-0.20, 0, 0)), (0.25, (0.20, 0, 0))), [M_BODY])

# 垂尾連著從機背長出來的背鰭整流罩（一路往前到 y −5.2），所以最底下那一站的
# 弦長有 10 m。底部站位要密，整流罩才不會變成一條直斜線。
L.build_panel(
    OUT, 'B17_Fin', L.fin_probe(tree('B17_Fin')), L.fin_mk,
    [1.40, 1.75, 2.20, 2.80, 3.50, 4.25, 4.90, 5.40],
    -15.8, -4.8, [0.30, 0.66],
    ((None, None), (0.25, (0, 0, 0.23))), [M_BODY])


# ═══════════════════════ 5. 發動機艙 ═══════════════════════
#
# 四具各占 900 多個三角形，是原模型最大的一塊。艙身是沿 y 的短管，跟機身
# 一樣用星狀射線量，只是環細一點（8 點）。
NAC_ANG = L.ring_angles(8)
# 由艙首往後的比例。前段密：整流罩的唇口是圓的，後段是一路收的整流尾。
#
# 【第一站要貼著艙首】出貨版的整流罩開口就落在艙首那一站（內艙 y 3.18、
# 外艙 2.78），而槳轂的底環在它後面 0.04 —— 第一站退太多，槳轂會浮在罩子
# 前面。又不能取 0：射線在 y 正好等於封蓋平面時是掠射，讀不到。
NAC_F = (0.005, 0.10, 0.24, 0.45, 0.72, 0.98)


def build_nacelle(name):
    T = tree(name)
    lo, hi = box(name)
    cx = (lo.x + hi.x) * 0.5
    ys = [hi.y - (hi.y - lo.y) * f for f in NAC_F]
    rings = L.tube(T, ys, NAC_ANG, cx=cx, reach=6.0,
                   zc_of=lambda y: _nac_zc(T, cx, y))
    if len(rings) < 3:
        raise SystemExit('%s 量不到足夠的剖面' % name)
    bm = bmesh.new()
    vs, _ = L.loft(bm, rings)
    # 整流罩的進氣開口是暗色的。出貨版在這一件上塗 Accent 的就只有艙首那一片
    for f in L.cap(bm, list(reversed(vs[0]))):
        f.material_index = 1
    L.cap(bm, vs[-1])
    return L.new_object(OUT, name, bm, [M_BODY, M_ACC])


def _nac_zc(T, cx, y):
    top = L.cast(T, (cx, y, 8), (0, 0, -1), 16)
    bot = L.cast(T, (cx, y, -8), (0, 0, 1), 16)
    return None if (top is None or bot is None) else (top.z + bot.z) * 0.5


for _n in ('B17_NacIL', 'B17_NacIR', 'B17_NacOL', 'B17_NacOR'):
    build_nacelle(_n)


# ═══════════════════════ 6. 槳轂與槳葉 ═══════════════════════
#
# 槳轂是六角錐、槳葉是薄長方體 —— 兩者的尺寸與位置都由來源件量出來，
# `b17g.model.ts` 的四具轉軸座標一個都沒動。
SPIN_SEG = 6
HUB = {1: (3.050, 0.002), 2: (6.571, 0.257), 3: (-3.050, 0.002), 4: (-6.571, 0.257)}


def build_spinner(name):
    lo, hi = box(name)
    cx, cz = (lo.x + hi.x) * 0.5, (lo.z + hi.z) * 0.5
    r = max(hi.x - lo.x, hi.z - lo.z) * 0.5
    bm = bmesh.new()
    vs = [bm.verts.new((cx + r * math.cos(2 * math.pi * i / SPIN_SEG), lo.y,
                        cz + r * math.sin(2 * math.pi * i / SPIN_SEG)))
          for i in range(SPIN_SEG)]
    L.fan(bm, vs, (cx, hi.y, cz))
    L.cap(bm, list(reversed(vs)))
    return L.new_object(OUT, name, bm, [M_ACC])


def build_blade(name, hub):
    """薄長方體：長度沿葉展、弦長沿旋轉方向、厚度沿轉軸。"""
    o = O[name]
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    hx, hz = hub
    # 葉展方向：轉軸指向葉片形心，在旋轉平面（x–z）上
    dx = sum(p.x for p in pts) / len(pts) - hx
    dz = sum(p.z for p in pts) / len(pts) - hz
    ln = math.hypot(dx, dz)
    ux, uz = dx / ln, dz / ln
    px, pz = -uz, ux
    rad = [(p.x - hx) * ux + (p.z - hz) * uz for p in pts]
    cho = [(p.x - hx) * px + (p.z - hz) * pz for p in pts]
    r0, r1 = min(rad), max(rad)
    c0, c1 = min(cho), max(cho)
    y0, y1 = min(p.y for p in pts), max(p.y for p in pts)

    def pt(r, c, y):
        return (hx + ux * r + px * c, y, hz + uz * r + pz * c)

    return L.closed_loft(
        OUT, name,
        [[pt(r0, c0, y0), pt(r0, c1, y0), pt(r0, c1, y1), pt(r0, c0, y1)],
         [pt(r1, c0, y0), pt(r1, c1, y0), pt(r1, c1, y1), pt(r1, c0, y1)]],
        [M_ACC])[0]


for _i in range(1, 5):
    build_spinner('B17_Spinner%d' % _i)
    for _suf in ('', '.001', '.002'):
        build_blade('B17_Prop%d%s' % (_i, _suf), HUB[_i])


# ═══════════════════════ 7. 窗片 ═══════════════════════
#
# 15 片平面窗**原封不動搬過來**，一片 12 個三角形。它們本來就是「四角壓平的
# 平板沿法線外推 2.5 cm」，沒有剖面可以簡化，而少了它們整台的側面就是一片
# 空白的鐵皮。
REMAP = {'B17_Body': M_BODY, 'B17_Accent': M_ACC, 'B17_Glass': M_GLASS}
for _n in PANES:
    L.copy_part(OUT, O[_n], _n, REMAP, M_BODY)


L.report(OUT, BEFORE)
L.export(os.path.join(MODELS, 'b17g_lod2.glb'), SRC)
