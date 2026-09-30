# -*- coding: utf-8 -*-
"""
Ju 87 B-2 Stuka：在 Blender 裡對著參考模型直接量、直接 loft（F4F-4 那支的做法）。

用法（Blender 5.x）：
    blender -b --factory-startup -P tools/blender/build_ju87.py -- --export
MCP 或文字編輯器裡也可以 `exec(open(...).read())`；沒有 Ref_* 物件時會先把
ref/junkers_ju_87_stuka.glb 匯進來對齊，有就直接建。加 `--export` 會匯出
models-src/ju87.glb、存一份不含 Ref_* 的 tools/blender/ju87.blend。

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。

── 參考模型 ─────────────────────────────────────────────────
Sketchfab 的 Ju 87 B-2（機首下方大散熱器、後座單管 MG 15、翼下四枚小彈）。零件是
**按名稱分的**（Fuselage.005 機身、Wings 主翼、Fuselage.012 襟副翼、Canopy* 玻璃與框…），
所以不必拆連通塊，照名稱分組就好（見 GROUPS）。

── 對齊的驗收（2026-10-01 實測）─────────────────────────────
    姿態   每一個零件的 matrix_world 都是同一個 X 軸 −100° = −90°（Y 上轉 Z 上）＋ −10°
           （三點著地）；槳盤法線量到 10.00°。轉回 +10° 就是模型自己的水平基準。
    翼展   6.2227 → 縮放 ×2.21774（史實 13.8）
    翼根弦 由 x 1.2／2.0 兩站外推：LE 2.997 / TE −0.263 / 弦長 3.26，四分之一弦線移到原點
    全長   整流罩尖 3.618 到方向舵後緣 −7.711 = 11.33（史實 11.1，+2%，見 ju87.model.ts）
    槳徑   參考 3.76，史實 3.40（Junkers VS 5）；照史實（PROP_R）
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\junkers_ju_87_stuka.glb"
SPAN = 13.8           # Ju 87 B-2 翼展
_here = globals().get('__file__')
REPO = (os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(_here)))) if _here
        else os.getcwd())

# 參考模型的 mesh → 量尺分組。雜件（炸彈、機槍、天線、翼下彈架）與襟副翼只留著看，不量、不建。
GROUPS = {
    'Ref_Fus': ['Fuselage.005_0'],
    'Ref_CanopyFrame': ['Canopy.000_0', 'Canopy.001_0', 'Canopy.003_0',
                        'Canopy_OpenableFrame.001_0', 'CanopyFrontFrame.001_0'],
    'Ref_Glass': ['Canopy.002_0', 'Canopy.004_0', 'Canopy_Openable.001_0', 'CanopyFront.001_0'],
    'Ref_Wing': ['Wings_0'],
    'Ref_Flap': ['Fuselage.012_0', 'Fuselage.012_1'],
    'Ref_Fin': ['Fuselage.009_0', 'StukaMain.018_0', 'Fuselage.001_0', 'Fuselage.002_0'],
    'Ref_Tailplane': ['Fuselage.010_0', 'StukaMain.019_0'],
    'Ref_Strut': ['Fuselage.008_0'],
    'Ref_Gear': ['Wheel.000_0', 'Wheel.002_0', 'Wheel.003_0', 'Wheel.004_0', 'Gear.000_0', 'Gear.005_0'],
    'Ref_TailWheel': ['Gear.003_0', 'Gear.003_1', 'Gear.004_0'],
    'Ref_Spinner': ['Spinner.007_0', 'Spinner.007_1'],
    'Ref_Blade': ['Blade.002_0', 'Blade.002_1'],
    'Ref_Exhaust': ['Exhaust_0'],
    'Ref_Misc': ['Antenna_0', 'RearGun_0', 'MachineGun_0', 'Bomb_0', 'Bomb.001_0', 'Bomb.002_0',
                 'Bomb.003_0', 'Bomb.004_0', 'BombFork_0', 'BombForkHolder_0', 'Wheel.001_0'],
}


def import_and_align_ref():
    """匯入參考模型 → 依零件分組烘進頂點 → 轉正、縮放、平移到機體座標。"""
    O = bpy.data.objects
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()
    made = {}
    for g, names in GROUPS.items():
        bm = bmesh.new()
        for n in names:
            o = O[n]
            me = o.data.copy(); me.transform(o.matrix_world.copy())
            bm.from_mesh(me); bpy.data.meshes.remove(me)
        me = bpy.data.meshes.new(g); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(g, me); bpy.context.scene.collection.objects.link(ob)
        made[g] = ob
    # 只刪匯入時新長出來的（含 glTF 的 Empty）；條件是「不在 before 裡」
    for o in list(O):
        if o.name not in before and o.name not in made:
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    REF = list(made.values())
    # 轉回 +10°（三點著地 → 水平），再把機首由 −Y 轉到 +Y
    R = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Rotation(math.radians(10.0), 4, 'X')
    for o in REF: o.data.transform(R)
    wx = [v.co.x for v in made['Ref_Wing'].data.vertices]
    S = SPAN / (max(wx) - min(wx))
    for o in REF: o.data.transform(Matrix.Scale(S, 4))
    wx = [v.co.x for v in made['Ref_Wing'].data.vertices]
    cx = 0.5 * (max(wx) + min(wx))
    # 推力線：整流罩錐尖之後 0.05…0.35 那一段的上下中點
    sp = [v.co for v in made['Ref_Spinner'].data.vertices]
    ytip = max(p.y for p in sp)
    band = [p for p in sp if ytip - 0.35 < p.y < ytip - 0.05]
    cz = 0.5 * (max(p.z for p in band) + min(p.z for p in band))
    for o in REF: o.data.transform(Matrix.Translation(Vector((-cx, 0, -cz))))
    # 翼根四分之一弦：倒鷗翼的內段（x 1.2／2.0，都在機身半寬 0.47 之外、折點 1.5 兩側
    # 的前後緣都是直線）外推到中線
    bm = bmesh.new(); bm.from_mesh(made['Ref_Wing'].data)
    bmesh.ops.triangulate(bm, faces=bm.faces); T = BVHTree.FromBMesh(bm); bm.free()
    def chord(x):
        le = te = None
        for k in range(400):
            z = -2.0 + 0.006 * k
            h = T.ray_cast(Vector((x, 8.0, z)), Vector((0, -1, 0)), 16.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -8.0, z)), Vector((0, 1, 0)), 16.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(1.2), chord(2.0)
    ex = lambda a, b: a + (b - a) * (0.0 - 1.2) / 0.8
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for o in REF: o.data.transform(Matrix.Translation(Vector((0, -qc, 0))))
    for o in REF: o.hide_render = True
    return {'scale': round(S, 5), 'root_chord': [round(le_r, 3), round(te_r, 3), round(le_r - te_r, 3)],
            'qc': round(qc, 3)}


ALIGN = None
if 'Ref_Fus' not in bpy.data.objects:
    ALIGN = import_and_align_ref()
O = bpy.data.objects
LOG = {'align': ALIGN}

# ───────────────────────── 材質 ─────────────────────────
def mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m is None: m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    m.diffuse_color = (*rgb, alpha)
    bsdf.inputs['Roughness'].default_value = 0.6
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
    return m
def srgb(h):
    r, g, b = ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))
# RLM 70/71 上表面色，與同時期的 He 111（he111.model.ts）同一組
M_BODY = mat('JU87_Body', srgb(0x5a6350))
M_ACC = mat('JU87_Accent', srgb(0x2b3128))
M_GLASS = mat('JU87_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('JU87_Cockpit', srgb(0x171a1c))
M_FRAME = mat('JU87_Frame', srgb(0x5a6350))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('JU87_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('JU87')
if COLL is None:
    COLL = bpy.data.collections.new('JU87'); bpy.context.scene.collection.children.link(COLL)

def new_object(name, bm, mats, hide=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if hide: ob.display_type = 'WIRE'; ob.hide_render = True
    return ob

# ───────────────────────── 量尺 ─────────────────────────
def bvh_of(names):
    bm = bmesh.new()
    for n in names: bm.from_mesh(O[n].data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    t = BVHTree.FromBMesh(bm); bm.free(); return t
FUS = bvh_of(['Ref_Fus'])
FUSG = bvh_of(['Ref_Fus', 'Ref_Glass', 'Ref_CanopyFrame'])   # 罩子一起 loft 進去，之後盒切
WING = bvh_of(['Ref_Wing'])
TAILP = bvh_of(['Ref_Tailplane'])
FIN = bvh_of(['Ref_Fin'])
SPIN = bvh_of(['Ref_Spinner'])
def hit(T, o, d, L=9.0): return T.ray_cast(Vector(o), Vector(d), L)[0]
def zmax_at(T, x, y):
    h = hit(T, (x, y, 3.0), (0, 0, -1)); return h.z if h else None
def zmin_at(T, x, y):
    h = hit(T, (x, y, -3.0), (0, 0, 1)); return h.z if h else None

# ───────────────────────── 通用 loft ─────────────────────────
def loft(bm, rings, close=True):
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for j in (range(n) if close else range(n - 1)):
            k = (j + 1) % n
            q = [a[j], a[k], b[k], b[j]]
            if len(set(q)) < 4: continue
            try: bm.faces.new(q)
            except ValueError: pass
    return vs
def cap(bm, verts, reverse=False):
    vv = list(reversed(verts)) if reverse else verts
    try: return bm.faces.new(vv)
    except ValueError: return None
def fan(bm, verts, apex):
    a = bm.verts.new(apex); n = len(verts)
    for j in range(n):
        k = (j + 1) % n
        if verts[j] is verts[k]: continue
        try: bm.faces.new([verts[j], verts[k], a])
        except ValueError: pass
    return a
def finish(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)
def hull_into(bm, pts):
    """凸包加進一個既有的 bmesh（成對小零件各自一顆、各自正向建構）。"""
    vv = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vv)
def ellipse_ring(cx, y, cz, a, b, n, phase=0.0):
    return [Vector((cx + a * math.cos(2 * math.pi * j / n + phase), y,
                    cz + b * math.sin(2 * math.pi * j / n + phase))) for j in range(n)]

# ═══════════════════════════ 1. 機身 ═══════════════════════════
# 站位（機首 → 機尾）。2.88 是引擎罩唇（整流罩底 2.89、r 0.396 蓋住它）；0.235 與 −2.42
# 是玻璃盒的前後壁，兩側各補一站讓盒切的邊界落在環上；−7.07 是機身尾端（方向舵鉸鏈）。
FUS_Y = [2.88, 2.84, 2.78, 2.68, 2.55, 2.40, 2.25, 2.10, 1.95, 1.80, 1.60, 1.40, 1.20,
         1.00, 0.80, 0.60, 0.44, 0.30, 0.245, 0.225, 0.16, 0.08, 0.00, -0.08, -0.16, -0.26,
         -0.40, -0.55, -0.70, -0.85, -1.00, -1.15, -1.30, -1.45, -1.60, -1.75, -1.90, -2.05,
         -2.20, -2.32, -2.41, -2.43, -2.50, -2.62, -2.80, -3.05, -3.35, -3.70, -4.10, -4.50,
         -4.90, -5.30, -5.65, -5.95, -6.25, -6.50, -6.70, -6.85, -6.97]
TAIL_Y = -7.07
HALF = 10                     # 每側 10 級 + 頂底兩尖 = 22 點/環
W_CAP = 0.60                  # 半寬上限：機身實測最寬 0.54（座艙罩下緣），主翼的命中一律 > 0.6
# 機首下方的散熱器是獨立一件（第 3 節），它蓋住的那一段機身腹線改用兩端乾淨站內插：
# 參考模型在 y 2.10 是 −0.586、1.08 是 −0.590（整段機腹本來就是平的）。
RAD_BAND = (1.10, 2.08)
# 翼根的缺口：參考模型的機身在 y 1.1…−2.6、z −0.55…−0.10 整片沒有蒙皮（主翼插在那裡），
# 由外往內的射線讀到的是內部結構（0.11…0.15）。那一段的下半身一律換成「平底圓角箱」：
# 平底是實測的腹線（x 0.1／0.2／0.3／0.4 讀到 −0.59／−0.58／−0.57／−0.56），側壁接上
# ROOT_Z 那一級量到的半寬。整段都藏在主翼的翼根裡（翼根弦 3.16、下表面 −0.56）。
ROOT_BAND = (-2.45, 1.12)
ROOT_Z = -0.05

# ── 機身本體是一顆水滴，座艙罩是另外凸出來的一塊 ────────────────────────
#
# 本體的頂線不跟著罩子走，是一條設計的線：
#
#   機首  y ≥ 2.40   照量到的罩唇圓角（2.88 的 0.407 → 2.40 的 0.528）
#   引擎罩          一條直線：y 2.40…0.60 量到 0.528…0.746，逐站偏離 < 12 mm
#   罩後到機尾      一條直線：y −2.50…−4.50 量到 0.603…0.511，逐站偏離 < 6 mm，
#                  一路延伸到尾端（−6.97 是 0.397）
#   兩條直線交在 y 0.60（0.746），夾角 9.5°；前後各 0.6 m 用二次 Bézier 圓過去
#
# 參考模型的機身 mesh 在 y −4.6 以後還量得到一道一路長進垂尾的背鰭（x 0 的頂由 0.52
# 升到 0.675），那是垂尾的根部整流，歸到垂尾（第 8 節），本體照直線收到機尾。
TOP_FRONT = ((2.40, 0.528), (0.60, 0.746))
TOP_REAR = ((-2.50, 0.603), (-4.50, 0.511))
TOP_BLEND = 0.60
def _line(p, q, y): return p[1] + (q[1] - p[1]) * (y - p[0]) / (q[0] - p[0])
def _nose_top(y):
    tops = [v for v in (zmax_at(FUS, x, y) for x in (0.0, 0.04, 0.07)) if v is not None]
    return max(tops)
_sf = (TOP_FRONT[1][1] - TOP_FRONT[0][1]) / (TOP_FRONT[1][0] - TOP_FRONT[0][0])
_sr = (TOP_REAR[1][1] - TOP_REAR[0][1]) / (TOP_REAR[1][0] - TOP_REAR[0][0])
# 兩條直線的交點
Y_CROSS = ((TOP_FRONT[0][1] - _sf * TOP_FRONT[0][0]) - (TOP_REAR[0][1] - _sr * TOP_REAR[0][0])) / (_sr - _sf)
def body_top(y):
    if y >= TOP_FRONT[0][0]: return _nose_top(y)
    y0, y1 = Y_CROSS + TOP_BLEND, Y_CROSS - TOP_BLEND
    if y >= y0: return _line(*TOP_FRONT, y)
    if y <= y1: return _line(*TOP_REAR, y)
    # 二次 Bézier：P0 在前線、P2 在後線、控制點在兩線交點；由 y 反解參數 t（y 對 t 是線性的）
    p0 = (y0, _line(*TOP_FRONT, y0)); p1 = (Y_CROSS, _line(*TOP_FRONT, Y_CROSS)); p2 = (y1, _line(*TOP_REAR, y1))
    t = (y0 - y) / (y0 - y1)
    return (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]

# 座艙段（罩子底下）本體的側壁只量得到艙緣 0.45 附近，再往上是敞開的座艙：射線穿進
# 艙內打到的是座椅、儀表板。那一段由最後一個連續量到的點用四分之一橢圓收到頂線。
COCKPIT_BAND = (-2.45, 0.30)
COCKPIT_Z = 0.40

def station(y):
    # 腹線：中線與 x 0.04／0.07 的最低點
    bots = [v for v in (zmin_at(FUS, x, y) for x in (0.0, 0.04, -0.04, 0.07, -0.07)) if v is not None]
    if not bots: return None
    bot = min(bots)
    top = body_top(y)
    if RAD_BAND[0] <= y <= RAD_BAND[1]:
        (y0, z0), (y1, z1) = (2.10, -0.586), (1.08, -0.590)
        bot = z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    n = max(14, int((top - bot) / 0.012))
    zs, ws = [], []
    in_root = ROOT_BAND[0] <= y <= ROOT_BAND[1]
    in_pit = COCKPIT_BAND[0] <= y <= COCKPIT_BAND[1]
    stop = False
    for i in range(n + 1):
        z = bot + (top - bot) * i / n
        h = hit(FUS, (2.0, y, z), (-1, 0, 0), 3.0)
        w = h.x if (h is not None and 0.0 < h.x <= W_CAP) else None
        if in_root and z < ROOT_Z: w = None
        if in_pit and z >= COCKPIT_Z and (w is None or w < 0.30): stop = True
        if stop: w = None
        zs.append(z); ws.append(w)
    valid = [i for i, w in enumerate(ws) if w is not None]
    if not valid: return None
    if in_pit:
        iv = max(i for i in valid if not (in_root and zs[i] < ROOT_Z))
        zv, wv = zs[iv], ws[iv]
        for i in range(iv + 1, len(zs)):
            u = min(1.0, (zs[i] - zv) / (top - zv))
            ws[i] = wv * math.sqrt(max(0.0, 1.0 - u * u))
        valid = [i for i, w in enumerate(ws) if w is not None]
    if in_root:
        # 平底圓角箱：w(z) = W0 · (1 − t⁴)^¼，t 由 ROOT_Z（0）到腹線（1）
        i0 = min(i for i in valid if zs[i] >= ROOT_Z)
        W0 = ws[i0]
        for i, z in enumerate(zs):
            if z < ROOT_Z:
                t = min(1.0, (ROOT_Z - z) / (ROOT_Z - bot))
                ws[i] = W0 * max(0.0, 1.0 - t ** 4) ** 0.25
        valid = [i for i, w in enumerate(ws) if w is not None]
    fixed = []
    for i, w in enumerate(ws):
        if w is not None: fixed.append(w); continue
        lo = max([j for j in valid if j < i], default=None)
        hi = min([j for j in valid if j > i], default=None)
        if lo is None: fixed.append(ws[hi])
        elif hi is None: fixed.append(ws[lo])
        else: fixed.append(ws[lo] + (ws[hi] - ws[lo]) * (zs[i] - zs[lo]) / (zs[hi] - zs[lo]))
    fixed[0] = 0.0; fixed[-1] = 0.0
    return {'y': y, 'top': top, 'bot': bot, 'z': zs, 'w': fixed}

def arc_levels(s, L=HALF):
    """半剖面 (0,bot) → (w,z)… → (0,top) 依弧長等分成 L 級。

    級數照弧長放，不照 z 放：照 z 的比例放會把級線擠在上下兩端、肩部只分到兩三級
    （F4F 那一輪「平板夾硬稜」的成因）。弧長等分讓環上每一條邊差不多長（技能坑 56）。"""
    pts = [(w, z) for w, z in zip(s['w'], s['z'])]
    cum = [0.0]
    for (w0, z0), (w1, z1) in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(w1 - w0, z1 - z0))
    tot = cum[-1]; out = []
    for k in range(1, L + 1):
        t = tot * k / (L + 1)
        for i in range(len(cum) - 1):
            if cum[i] <= t <= cum[i + 1]:
                f = (t - cum[i]) / (cum[i + 1] - cum[i]) if cum[i + 1] > cum[i] else 0.0
                out.append((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                            pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)); break
    return out

STA = [s for s in (station(y) for y in FUS_Y) if s is not None]
for s in STA: s['lv'] = arc_levels(s)

def smooth_levels(sta, passes=2, lam=0.5, thr=0.06):
    """站間平滑（y 不等距的拉普拉斯）。門檻 0.06 = 「要保住的特徵相鄰兩站差多少」
    （技能坑 44）：風擋、罩尾那種真的階不抹。首尾兩站不動。"""
    for _ in range(passes):
        new = []
        for i, s in enumerate(sta):
            if i == 0 or i == len(sta) - 1:
                new.append((s['lv'], s['top'], s['bot'])); continue
            a, b = sta[i - 1], sta[i + 1]
            t = (s['y'] - a['y']) / (b['y'] - a['y'])
            lv = []
            for k in range(len(s['lv'])):
                wa, za = a['lv'][k]; wb, zb = b['lv'][k]; w, z = s['lv'][k]
                wl = wa + (wb - wa) * t; zl = za + (zb - za) * t
                if abs(w - wl) < thr and abs(z - zl) < thr:
                    lv.append((w + (wl - w) * lam, z + (zl - z) * lam))
                else: lv.append((w, z))
            tl = a['top'] + (b['top'] - a['top']) * t
            bl = a['bot'] + (b['bot'] - a['bot']) * t
            top = s['top'] + (tl - s['top']) * lam if abs(tl - s['top']) < thr else s['top']
            bot = s['bot'] + (bl - s['bot']) * lam if abs(bl - s['bot']) < thr else s['bot']
            new.append((lv, top, bot))
        for s, q in zip(sta, new): s['lv'], s['top'], s['bot'] = q
smooth_levels(STA)

def ring_of(s):
    y = s['y']; pts = [Vector((0, y, s['bot']))]
    for w, z in s['lv']: pts.append(Vector((w, y, z)))
    pts.append(Vector((0, y, s['top'])))
    for w, z in reversed(s['lv']): pts.append(Vector((-w, y, z)))
    return pts

bm = bmesh.new()
vs = loft(bm, [ring_of(s) for s in STA])
cap(bm, vs[0])
last = STA[-1]
fan(bm, vs[-1], Vector((0, TAIL_Y, 0.5 * (last['top'] + last['bot']))))
finish(bm)
for f in bm.faces:
    if f.calc_center_median().y > STA[0]['y'] - 0.005: f.material_index = 1   # 引擎罩唇的端面
fus = new_object('JU87_Fuselage', bm, [M_BODY, M_ACC])
LOG['fus_stations'] = [[round(s['y'], 2), round(s['top'], 3), round(s['bot'], 3),
                        round(max(w for w, z in s['lv']), 3)] for s in STA]

# ── 座艙罩的凸塊 ────────────────────────────────────────────────
# 由參考模型的機身＋玻璃＋罩框（FUSG）量：每站由 CANOPY_ZS 往上到罩頂，逐 12 mm 由外往內
# 取半寬。前端 1.00（罩頂高出本體頂線 6 mm，0.80 是 14 mm、0.60 是 25 mm，整流由零慢慢長
# 出來），後端 −2.41 是罩頂降回本體頂線的地方（0.608 對 0.607）；兩端各多一站往內縮進
# 本體，封口整片埋在本體裡。
# 底 CANOPY_ZS 0.44 在艙緣（0.45）之下：那裡罩子與本體側壁幾乎同寬，底圈縮成 0.85 倍
# 保證在本體裡面。兩件接著用布林聯集併成一件，沒有藏在裡面的面（拉遠才不會閃）。
CANOPY_Y = [1.00, 0.80, 0.60, 0.44, 0.30, 0.245, 0.225, 0.16, 0.08, 0.00, -0.08, -0.16, -0.26, -0.40,
            -0.55, -0.70, -0.85, -1.00, -1.15, -1.30, -1.45, -1.60, -1.75, -1.90, -2.05,
            -2.20, -2.32, -2.41]
CANOPY_ZS = 0.44
CHALF = 8
# 【罩子只留真的凸出本體的那一段】風擋前的整流與罩子下緣，罩子與本體的側面是同一張量到
# 的蒙皮，兩者只差 1…2 cm；聯集之後兩張面交錯出一條鋸齒帶，前端還多一片直立的階
# （負責人 2026-10-01 圈的正是 y 0…0.6）。所以罩子比本體凸不到 SEAM_GAP 的地方一律
# 收進本體裡 1.5 cm，中間線性過渡：接縫只剩罩子真正長出來的那一條線。
SEAM_GAP, SEAM_IN = 0.04, 0.015
BODY_PROFILE = {round(s['y'], 3): s for s in STA}
def body_w(y, z):
    s = BODY_PROFILE.get(round(y, 3))
    if s is None or z >= s['top'] or z <= s['bot']: return 0.0
    zs, ws = s['z'], s['w']
    for i in range(len(zs) - 1):
        if zs[i] <= z <= zs[i + 1]:
            f = (z - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0.0
            return ws[i] + (ws[i + 1] - ws[i]) * f
    return 0.0
def seam_w(w, wb):
    d = w - wb
    if wb <= 0.0 or d >= SEAM_GAP: return w
    lo = wb - SEAM_IN
    if d <= 0.0: return min(w, lo)
    return lo + (w - lo) * (d / SEAM_GAP)
CZ_STEP = 0.012
SIDE_TOP = 0.62          # 罩側直牆的頂：玻璃下緣（盒底 0.612）之上一點
def canopy_raw(y):
    """一站的半寬表：z 由 CANOPY_ZS 起每 CZ_STEP 一格（所有站共用同一組絕對高度，才能沿 y 平滑）。"""
    tops = [v for v in (zmax_at(FUSG, x, y) for x in (0.0, 0.04, -0.04)) if v is not None]
    if not tops: return None
    crown = max(tops)
    zs = [CANOPY_ZS + CZ_STEP * k for k in range(int((crown - CANOPY_ZS) / CZ_STEP) + 1)]
    ws = []
    for z in zs:
        h = hit(FUSG, (2.0, y, z), (-1, 0, 0), 3.0)
        ws.append(h.x if (h is not None and 0.0 < h.x <= W_CAP) else None)
    valid = [i for i, w in enumerate(ws) if w is not None]
    if not valid: return None
    fixed = []
    for i, w in enumerate(ws):
        if w is not None: fixed.append(w); continue
        lo = max([j for j in valid if j < i], default=None)
        hi = min([j for j in valid if j > i], default=None)
        fixed.append(ws[hi] if lo is None else ws[lo] if hi is None else
                     ws[lo] + (ws[hi] - ws[lo]) * (zs[i] - zs[lo]) / (zs[hi] - zs[lo]))
    # 【剖面只准往下變寬】參考的罩子下緣有一道滑軌槽：y −1.0 由艙緣往上 0.398（z 0.45）
    # → 0.353（0.56）→ 0.385（0.57），先收再外擴。照抄的話罩子下緣是一道暗色的凹摺加
    # 一圈唇。每一高度取「它以上最寬的那個值」，槽被填平。
    for i in range(len(fixed) - 2, -1, -1):
        fixed[i] = max(fixed[i], fixed[i + 1])
    return {'y': y, 'crown': crown, 'z': zs, 'w': fixed}
CRAW = [r for r in (canopy_raw(y) for y in CANOPY_Y) if r is not None]
# 【罩側是一道直牆】參考的滑動罩（y −0.2…−0.9）比前面的風擋、後面的後座罩都寬 4…5 cm
# （z 0.48：0.445 對 0.39），從外面疊上去，前後各是一道直立的階，罩框底下還有一條朝下的
# 簷。所以 SIDE_TOP 以下一律改成直線：由本體在 CANOPY_ZS 的半寬拉到 SIDE_TOP 的罩寬。
for r in CRAW:
    k1 = min(range(len(r['z'])), key=lambda k: abs(r['z'][k] - SIDE_TOP))
    w0 = body_w(r['y'], CANOPY_ZS) or r['w'][0]; w1 = r['w'][k1]
    for k in range(k1):
        t = (r['z'][k] - CANOPY_ZS) / (r['z'][k1] - CANOPY_ZS)
        r['w'][k] = w0 + (w1 - w0) * t
# 【沿 y 平滑】滑動罩的寬度要沿著機身慢慢長出來、慢慢收回去，不是一站跳 5 cm。同一個
# 絕對高度的半寬沿 y 做不等距拉普拉斯（λ0.5 × 6）；首尾兩站不動（那裡罩子正要長出／收回）。
for _ in range(6):
    new = []
    for i, r in enumerate(CRAW):
        if i == 0 or i == len(CRAW) - 1: new.append(r['w'][:]); continue
        a, b = CRAW[i - 1], CRAW[i + 1]
        t = (r['y'] - a['y']) / (b['y'] - a['y'])
        row = []
        for k, w in enumerate(r['w']):
            if k < len(a['w']) and k < len(b['w']):
                wl = a['w'][k] + (b['w'][k] - a['w'][k]) * t
                row.append(w + (wl - w) * 0.5)
            else: row.append(w)
        new.append(row)
    for r, row in zip(CRAW, new): r['w'] = row
def canopy_station(r):
    y, crown = r['y'], r['crown']
    zs = r['z'] + ([crown] if crown - r['z'][-1] > 1e-4 else [])
    ws = r['w'] + ([0.0] if len(zs) > len(r['w']) else [])
    fixed = [seam_w(w, body_w(y, z)) for w, z in zip(ws, zs)]
    fixed[0] *= 0.85; fixed[-1] = 0.0
    # 底中點：剖面由 (0, 底) 起
    return {'y': y, 'top': crown, 'bot': CANOPY_ZS, 'z': [CANOPY_ZS] + zs, 'w': [0.0] + fixed}
CST = [canopy_station(r) for r in CRAW]
for s in CST: s['lv'] = arc_levels(s, CHALF)
smooth_levels(CST)
def shrunk(s, dy):
    """端點外再一站：整圈往剖面中心縮一半、頂壓到本體頂線下 3 cm，封口埋進本體。"""
    y = s['y'] + dy; t = body_top(y) - 0.03
    zc = 0.5 * (s['bot'] + t)
    lv = [(0.5 * w, zc + (z - zc) * 0.5) for w, z in s['lv']]
    return {'y': y, 'top': min(t, zc + (s['top'] - zc) * 0.5), 'bot': zc - (zc - s['bot']) * 0.5, 'lv': lv}
CST = [shrunk(CST[0], +0.04)] + CST + [shrunk(CST[-1], -0.04)]
bm = bmesh.new()
vs = loft(bm, [ring_of(s) for s in CST])
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
finish(bm)
canopy_blk = new_object('JU87_CanopyBlock', bm, [M_BODY])
LOG['canopy_stations'] = [[round(s['y'], 2), round(s['top'], 3), round(body_top(s['y']), 3)] for s in CST]

def boolean_apply(ob, cutter, op):
    md = ob.modifiers.new('B', 'BOOLEAN'); md.operation = op; md.object = cutter; md.solver = 'EXACT'
    if hasattr(md, 'material_mode'): md.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me
    me.name = old.name + '_b'; bpy.data.meshes.remove(old); me.name = ob.name
    return ob
boolean_apply(fus, canopy_blk, 'UNION')
bpy.data.objects.remove(canopy_blk, do_unlink=True)

# ═══════════════════════════ 2. 座艙：盒切玻璃 + 黑色內槽 ═══════════════════════════
# 玻璃盒的底是量到的玻璃下緣（參考 Ref_Glass 由外往內的最低命中）：
#
#   y      0.20  0.15  0.10  0.05  0.00  −0.10  −0.25 … −2.35
#   下緣   0.85  0.80  0.76  0.73  0.69   0.68   0.61 …  0.61
#
# 風擋兩側的斜邊之後整段是平的 0.61。下緣以下到 0.45 是罩框（金屬），在這裡就是機身。
# 前壁 0.235（風擋最前 0.22），0.235 的機身頂 0.85 低於盒底 0.87，前壁切不到東西。
# 後壁 −2.435：罩頂在 −2.43 已經降到 0.609，低於盒底，後壁同樣切不到東西。
GLASS_Y0, GLASS_Y1 = 0.235, -2.435
SILL = [(0.235, 0.870), (0.00, 0.685), (-0.20, 0.612), (GLASS_Y1, 0.612)]
gb = []
for x in (-0.9, 0.9):
    for y, z in SILL: gb.append((x, y, z))
    gb += [(x, GLASS_Y0, 1.6), (x, GLASS_Y1, 1.6)]
cut_glass = hull_object('Cut_Glass', gb, M_COCK)
# 內槽要整個留在蒙皮裡面：罩尾那一段機身收得快（y −2.2 在 z 0.60 的半寬只剩 0.34、
# −2.3 是 0.31），等寬 ±0.34 一路切到 −2.30 會把兩側蒙皮切穿，由側面看得到天空。
# 前段 ±0.34 到 −1.80，後壁收到 −2.15 的 ±0.28。
tb = [(sx * w, y, z) for sx in (-1, 1) for y, w in ((0.05, 0.34), (-1.80, 0.34), (-2.15, 0.28))
      for z in (0.05, 0.95)]
cut_tub = hull_object('Cut_Tub', tb, M_COCK)

glass = bpy.data.objects.new('JU87_Glass', fus.data.copy()); COLL.objects.link(glass)
boolean_apply(glass, cut_glass, 'INTERSECT')
# 刪封蓋：**每一個頂點**都落在切割盒某一面的平面上、法線平行（判準用盒子自己的面，
# 斜底才刪得到）。只看面心不夠：罩尾在 −2.32…−2.43 收到 0.609，幾乎與盒底 0.612 齊平，
# 那一段貼著盒底的真玻璃面心也在 2 mm 內，會被當成封蓋刪掉，露出底下的黑色切面。
bm = bmesh.new(); bm.from_mesh(glass.data); bm.normal_update()
cb = bmesh.new(); cb.from_mesh(cut_glass.data); cb.normal_update()
planes = [(f.calc_center_median().copy(), f.normal.copy()) for f in cb.faces]; cb.free()
kill = []
for f in bm.faces:
    n = f.normal
    for p, pn in planes:
        if abs(n.dot(pn)) > 0.98 and all(abs((v.co - p).dot(pn)) < 0.002 for v in f.verts):
            kill.append(f); break
bmesh.ops.delete(bm, geom=kill, context='FACES')
for f in bm.faces: f.material_index = 0
glass.data.materials.clear(); glass.data.materials.append(M_GLASS)
bm.to_mesh(glass.data); bm.free()
LOG['glass_caps_removed'] = len(kill)
boolean_apply(fus, cut_glass, 'DIFFERENCE')
boolean_apply(fus, cut_tub, 'DIFFERENCE')

# ═══════════════════════════ 3. 機首下的散熱器 ═══════════════════════════
# 逐站由外往內量半寬、由下往上量底線（Ref_Fus 在腹線 −0.59 以下的部分就是它）。
# 頂端那一級收在 −0.52、半寬不大於 0.34：藏進機身的平底圓角裡，兩件的側面不共面。
# 前端那一片封蓋是進氣口（暗色）。第一站在 2.03：2.05 以前只量得到唇口的斜面（x0 底線
# −0.587，還在機腹上），封蓋放在那裡就不是一個面。
RAD_Y = [2.03, 1.98, 1.94, 1.80, 1.60, 1.40, 1.28, 1.21, 1.16]
RAD_Z = [-0.80, -0.75, -0.70, -0.64, -0.58]
rrings = []
for y in RAD_Y:
    b = zmin_at(FUS, 0.0, y)
    b2 = zmin_at(FUS, 0.25, y)
    pts_r = [(0.0, b)]
    bb = min(b2 if b2 is not None else b, -0.60)
    pts_r.append((None, bb))
    for z in RAD_Z:
        if z <= bb + 0.01: continue
        h = hit(FUS, (2.0, y, z), (-1, 0, 0), 3.0)
        pts_r.append((None if h is None else h.x, z))
    pts_r.append((0.34, -0.52))
    # 缺值（底角那一點）用上一級的半寬
    ws_ok = [w for w, z in pts_r[2:] if w is not None]
    w_first = ws_ok[0] if ws_ok else 0.30
    ring_h = [(0.0, b), (0.85 * w_first, bb)] + [(w if w is not None else w_first, z) for w, z in pts_r[2:]]
    ring_h = [(min(w, 0.34) if z > -0.56 else w, z) for w, z in ring_h]
    rrings.append((y, ring_h))
# 各站的級數不一樣多（底線不同）→ 以固定比例重取樣成 6 點
def resample_poly(ph, n):
    cum = [0.0]
    for (w0, z0), (w1, z1) in zip(ph, ph[1:]): cum.append(cum[-1] + math.hypot(w1 - w0, z1 - z0))
    out = []
    for k in range(n):
        t = cum[-1] * k / (n - 1)
        for i in range(len(cum) - 1):
            if cum[i] <= t <= cum[i + 1] + 1e-9:
                f = (t - cum[i]) / (cum[i + 1] - cum[i]) if cum[i + 1] > cum[i] else 0.0
                out.append((ph[i][0] + (ph[i + 1][0] - ph[i][0]) * f, ph[i][1] + (ph[i + 1][1] - ph[i][1]) * f)); break
    return out
rings = []
for y, ph in rrings:
    # 右半：底中點 → 頂端（藏在機身裡）；左半鏡像接回來，頂邊在機身裡閉合
    half = [Vector((w, y, z)) for w, z in resample_poly(ph, 7)]
    rings.append(half + [Vector((-p.x, p.y, p.z)) for p in reversed(half[1:])])
bm = bmesh.new()
vs = loft(bm, rings)
front = cap(bm, vs[0])
cap(bm, vs[-1])
finish(bm)
for f in bm.faces:
    if f.calc_center_median().y > RAD_Y[0] - 0.005 and abs(f.normal.y) > 0.9: f.material_index = 1
new_object('JU87_Radiator', bm, [M_BODY, M_COCK])
LOG['radiator'] = [[round(y, 2)] + [(round(w, 3), round(z, 3)) for w, z in ph] for y, ph in rrings]

# ═══════════════════════════ 4. 排氣管（左右各一條） ═══════════════════════════
# Ref_Exhaust：x 0.33…0.54、y 1.50…2.73、z −0.20…−0.10。做成貼在機身側面的暗色長條。
# 外緣取 0.50 而不是量到的最大值 0.542：那是個別排氣口的尖端，俯視剪影整段只比機身
# （該高度半寬 0.46）寬 0.03…0.05。內緣 0.40 埋進機身，不與機身側面共面。
ex = [v.co for v in O['Ref_Exhaust'].data.vertices if v.co.x > 0]
ey0, ey1 = min(p.y for p in ex), max(p.y for p in ex)
ez0, ez1 = min(p.z for p in ex), max(p.z for p in ex)
ex_out = 0.50
bm = bmesh.new()
for sx in (1, -1):
    pts = [(sx * x, y, z) for x in (0.40, ex_out) for y in (ey0 + 0.02, ey1 - 0.02)
           for z in (ez0 + 0.01, ez1 - 0.01)]
    hull_into(bm, [Vector(p) for p in pts])
finish(bm)
new_object('JU87_Exhaust', bm, [M_ACC])
LOG['exhaust'] = [round(v, 3) for v in (ey0, ey1, ez0, ez1, ex_out)]

# ═══════════════════════════ 5. 整流罩與槳葉 ═══════════════════════════
# 整流罩：逐 5 cm 由上往下、由外往內兩條射線取半徑（兩者差 < 15 mm，取平均）
SP_Y = [2.89, 2.93, 3.03, 3.13, 3.23, 3.33, 3.43, 3.53, 3.58]
SP_TIP = 3.618
sp_r = []
for y in SP_Y:
    a = zmax_at(SPIN, 0.0, y); b = hit(SPIN, (2.0, y, 0.0), (-1, 0, 0), 3.0)
    vals = [v for v in (a, None if b is None else b.x) if v is not None]
    sp_r.append((y, sum(vals) / len(vals) if vals else 0.39))
sp_r[0] = (SP_Y[0], sp_r[1][1])
bm = bmesh.new()
vs = loft(bm, [ellipse_ring(0, y, 0, r, r, 12) for y, r in sp_r])
cap(bm, list(reversed(vs[0])))
fan(bm, vs[-1], Vector((0, SP_TIP, 0)))
finish(bm)
new_object('JU87_Spinner', bm, [M_ACC])
LOG['spinner'] = [[round(y, 2), round(r, 3)] for y, r in sp_r]
# 槳葉：槳盤 y 取參考槳葉頂點縱向範圍的中點（3.018…3.275）；半徑照史實 1.70
# （Junkers VS 5 直徑 3.40 m；參考模型是 3.76）。每片是一個等寬的長方塊：寬 0.22、厚 0.032，
# 由槳轂內 0.20 伸到翼尖。
bl = [v.co for v in O['Ref_Blade'].data.vertices]
PROP_Y = 0.5 * (min(p.y for p in bl) + max(p.y for p in bl))
PROP_R, PROP_BLADES = 1.70, 3
bm = bmesh.new()
for i in range(PROP_BLADES):
    ang = 2 * math.pi * i / PROP_BLADES + math.pi / 2
    r0, r1, hw, ht = 0.20, PROP_R, 0.11, 0.016
    c, s_ = math.cos(ang), math.sin(ang)
    pts = [Vector((r * c - u * s_, PROP_Y + t, r * s_ + u * c))
           for r in (r0, r1) for u in (-hw, hw) for t in (-ht, ht)]
    hull_into(bm, pts)
finish(bm)
new_object('JU87_Prop', bm, [M_ACC])
LOG['prop_y'] = round(PROP_Y, 3)

# ═══════════════════════════ 6. 主翼（倒鷗翼，一整片穿過機身） ═══════════════════════════
def chord_fine(T, x, zlo, zhi, yfront, yback, step=0.006):
    le = te = None; n = int((zhi - zlo) / step)
    for k in range(n + 1):
        z = zlo + step * k
        h = hit(T, (x, yfront, z), (0, -1, 0), 12.0)
        if h is not None and (le is None or h.y > le): le = h.y
        h = hit(T, (x, yback, z), (0, 1, 0), 12.0)
        if h is not None and (te is None or h.y < te): te = h.y
    return le, te
FR_W = [0.03, 0.09, 0.18, 0.30, 0.45, 0.62, 0.80, 0.94]
FR_T = [0.05, 0.20, 0.40, 0.65, 0.90]
FR = FR_W
def panel_station(T, x, zlo, zhi, yfront, yback, zsl, zsh):
    le, te = chord_fine(T, x, zlo, zhi, yfront, yback)
    if le is None: return None
    up, dn = [], []
    for f in FR:
        y = le - (le - te) * f
        u = hit(T, (x, y, zsh), (0, 0, -1), zsh - zsl)
        d = hit(T, (x, y, zsl), (0, 0, 1), zsh - zsl)
        up.append(None if u is None else u.z); dn.append(None if d is None else d.z)
    return {'x': x, 'le': le, 'te': te, 'up': up, 'dn': dn}
def hull_line(fs, vals, upper):
    """上表面取上凸包、下表面取下凸包：射線打進去的洞（彈架、機槍口）被橋掉。"""
    sgn = 1 if upper else -1
    hull = []
    for f, v in zip(fs, vals):
        while len(hull) >= 2:
            (f1, v1), (f2, v2) = hull[-2], hull[-1]
            if sgn * ((f2 - f1) * (v - v1) - (v2 - v1) * (f - f1)) >= 0: hull.pop()
            else: break
        hull.append((f, v))
    out = []
    for f in fs:
        for k in range(len(hull) - 1):
            if hull[k][0] <= f <= hull[k + 1][0]:
                t = (f - hull[k][0]) / (hull[k + 1][0] - hull[k][0])
                out.append(hull[k][1] + (hull[k + 1][1] - hull[k][1]) * t); break
        else: out.append(vals[fs.index(f)])
    return out
def fill_none(st_list, smooth_edges=True):
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    s[key][k] = min(vals, key=lambda v: abs(v[0] - s['x']))[1]
    for s in st_list:
        s['up'] = hull_line(FR, s['up'], True); s['dn'] = hull_line(FR, s['dn'], False)
    if not smooth_edges: return
    # 前後緣展向平滑（x 不等距拉普拉斯 λ0.5 × 2）：對直線是恆等的，只削刀刃邊的取樣噪聲。
    # **上下表面不平滑**：倒鷗翼的折點（x 1.5）是真的，平滑會把它削圓。
    for _ in range(2):
        new = []
        for i, s in enumerate(st_list):
            if i == 0 or i == len(st_list) - 1:
                new.append((s['le'], s['te'])); continue
            a, b = st_list[i - 1], st_list[i + 1]
            t = (s['x'] - a['x']) / (b['x'] - a['x'])
            le = s['le'] + ((a['le'] + (b['le'] - a['le']) * t) - s['le']) * 0.5
            te = s['te'] + ((a['te'] + (b['te'] - a['te']) * t) - s['te']) * 0.5
            new.append((le, te))
        for s, (le, te) in zip(st_list, new): s['le'], s['te'] = le, te
def extrap(a, b, x):
    t = (x - a['x']) / (b['x'] - a['x'])
    return {'x': x, 'le': a['le'] + (b['le'] - a['le']) * t, 'te': a['te'] + (b['te'] - a['te']) * t,
            'up': list(a['up']), 'dn': list(a['dn'])}
def section_pts(s):
    le, te = s['le'], s['te']; ch = le - te
    pts = [(le, 0.5 * (s['up'][0] + s['dn'][0]))]
    for f, u in zip(FR, s['up']): pts.append((le - ch * f, u))
    pts.append((te, 0.5 * (s['up'][-1] + s['dn'][-1])))
    for f, d in zip(reversed(FR), reversed(s['dn'])): pts.append((le - ch * f, d))
    return pts
def panel_mesh(sts, tip, mirror=True, tip_cap=False, sx=1):
    """sts 由內往外；tip = 翼尖點（fan）或 None（直接封口）。mirror=True 時整片跨過中線。
    sx = −1 產生左半（不鏡射的零件左右各自正向建構，不靠頂點取負）。"""
    seq = [dict(s, x=-s['x']) for s in reversed(sts[1:])] + sts if mirror else list(sts)
    rings = [[Vector((sx * s['x'], y, z)) for y, z in section_pts(s)] for s in seq]
    bm = bmesh.new()
    vs = loft(bm, rings)
    if tip is not None:
        fan(bm, vs[-1], Vector((sx * tip[0], tip[1], tip[2])))
        if mirror: fan(bm, list(reversed(vs[0])), Vector((-tip[0], tip[1], tip[2])))
        else: cap(bm, list(reversed(vs[0])))
    else:
        cap(bm, vs[-1]); cap(bm, list(reversed(vs[0])))
    finish(bm)
    return bm

# 翼站：折點 1.5 兩側各加密；外翼後緣在 4.1 有一個轉折（內段每單位 x 往前 0.25、外段 0.40）
WX = [0.50, 0.70, 0.95, 1.20, 1.38, 1.50, 1.62, 1.80, 2.10, 2.50, 3.00, 3.50, 4.10,
      4.50, 5.00, 5.50, 6.00, 6.35, 6.60, 6.78]
wst = [panel_station(WING, x, -1.2, 0.6, 6.0, -8.0, -1.5, 1.2) for x in WX]
wst = [s for s in wst if s is not None]
fill_none(wst)
wst = [extrap(wst[0], wst[1], 0.0)] + wst
tip = wst[-1]
WING_TIP_X = SPAN / 2
tip_pt = (WING_TIP_X, 0.5 * (tip['le'] + tip['te']) + 0.04, 0.5 * (tip['up'][3] + tip['dn'][3]))
bm = panel_mesh(wst, tip_pt)
wing = new_object('JU87_Wing', bm, [M_BODY])
wing['part'] = 'wing0'
area = 0
for a, b in zip(wst, wst[1:]):
    area += 0.5 * ((a['le'] - a['te']) + (b['le'] - b['te'])) * (b['x'] - a['x'])
area += 0.5 * (tip['le'] - tip['te']) * (WING_TIP_X - tip['x'])
LOG['wing_area'] = round(2 * area, 2)
LOG['wing_tip'] = [round(v, 3) for v in tip_pt]
LOG['wing_stations'] = [[round(s['x'], 2), round(s['le'], 3), round(s['te'], 3),
                         round(s['up'][3], 3), round(s['dn'][3], 3)] for s in wst]

# ═══════════════════════════ 7. 水平尾翼與撐桿 ═══════════════════════════
# 矩形平面：x 0.1…2.35 每一站弦長 1.02（LE −5.98、TE −7.00）、z 0.57，逐站讀到的數字一樣。
# 翼尖直接封口（參考模型的翼尖是方的）。
FR = FR_T
TX = [0.30, 1.20, 2.10, 2.30]
tpst = [panel_station(TAILP, x, 0.3, 0.9, -5.0, -8.0, 0.2, 1.1) for x in TX]
tpst = [s for s in tpst if s is not None]
fill_none(tpst)
TP_TIP_X = max(v.co.x for v in O['Ref_Tailplane'].data.vertices)
tip_s = dict(tpst[-1], x=TP_TIP_X - 0.005,
             up=[0.5 * (u + d) + 0.6 * (u - d) / 2 for u, d in zip(tpst[-1]['up'], tpst[-1]['dn'])],
             dn=[0.5 * (u + d) - 0.6 * (u - d) / 2 for u, d in zip(tpst[-1]['up'], tpst[-1]['dn'])])
tpst = [extrap(tpst[0], tpst[1], 0.0)] + tpst + [tip_s]
bm = panel_mesh(tpst, None)
new_object('JU87_Tailplane', bm, [M_BODY])
# 翼尖的升降舵配重角：翼尖外側一片直立的小板（前視剪影在翼尖上下各伸出 0.1…0.15）。
# 範圍取 Ref_Tailplane 在 x > 翼尖 − 0.05、而且伸出翼型上下表面（z 0.51…0.64 之外）的
# 頂點；外緣比翼尖封口多 2.5 cm，不與它共面。
tp_tip = [v.co for v in O['Ref_Tailplane'].data.vertices
          if v.co.x > TP_TIP_X - 0.05 and not (0.51 < v.co.z < 0.64)]
py0, py1 = min(p.y for p in tp_tip), max(p.y for p in tp_tip)
pz0, pz1 = min(p.z for p in tp_tip), max(p.z for p in tp_tip)
bm = bmesh.new()
for sx in (1, -1):
    hull_into(bm, [Vector((sx * x, y, z)) for x in (TP_TIP_X - 0.03, TP_TIP_X + 0.02)
                   for y in (py0, py1) for z in (pz0, pz1)])
finish(bm)
new_object('JU87_TipPlate', bm, [M_BODY])
LOG['tip_plate'] = [round(v, 3) for v in (py0, py1, pz0, pz1)]
LOG['tailplane'] = [[round(s['x'], 3), round(s['le'], 3), round(s['te'], 3),
                     round(s['up'][2], 3), round(s['dn'][2], 3)] for s in tpst]
# 撐桿：由機身側下方斜撐到水平尾翼下表面。兩端點取 Ref_Strut 的最低／最高那一群頂點。
st = [v.co for v in O['Ref_Strut'].data.vertices if v.co.x > 0]
zlo, zhi = min(p.z for p in st), max(p.z for p in st)
lo = [p for p in st if p.z < zlo + 0.06]; hi_ = [p for p in st if p.z > zhi - 0.06]
P0 = sum(lo, Vector()) / len(lo); P1 = sum(hi_, Vector()) / len(hi_)
bm = bmesh.new()
for sx in (1, -1):
    a = Vector((sx * P0.x, P0.y, P0.z)); b = Vector((sx * P1.x, P1.y, P1.z))
    d = (b - a).normalized()
    ny = Vector((0, 1, 0)); side = d.cross(ny).normalized()
    pts = []
    for p in (a - d * 0.05, b + d * 0.03):
        for u, v in ((0.07, 0), (-0.07, 0), (0, 0.022), (0, -0.022)):
            pts.append(p + ny * u + side * v)
    hull_into(bm, pts)
finish(bm)
new_object('JU87_Strut', bm, [M_BODY])
LOG['strut'] = [[round(v, 3) for v in P0], [round(v, 3) for v in P1]]

# ═══════════════════════════ 8. 垂尾與方向舵 ═══════════════════════════
# 高處（z ≥ 0.7）照 Ref_Fin 逐站量；前緣是一條直線（0.7 → −5.752、1.8 → −6.284）。
# 低處的方向舵掛在機身尾端（−7.065）之後、一路垂到 z −0.17：
#
#   y      −7.1    −7.2    −7.3    −7.4    −7.5    −7.6    −7.7
#   下緣  −0.169  −0.144  −0.120  −0.095  −0.070  −0.042   0.057
#
# 所以低處站位的前緣坐在機身裡（尾端只有 ±0.06 寬的一片，機身頂在 −6.7 之後也只剩
# 0.15），後緣照量到的方向舵後緣。頂端是平的（−6.4…−7.0 都是 1.92），直接封口。
FIN_Z_HI = [0.70, 1.00, 1.30, 1.60, 1.80]
FIN_TOP = 1.925
def fin_station(z):
    le = te = None
    for i in range(-10, 11):
        x = 0.006 * i
        h = hit(FIN, (x, -4.0, z), (0, -1, 0))
        if h is not None and (le is None or h.y > le): le = h.y
        h = hit(FIN, (x, -9.0, z), (0, 1, 0))
        if h is not None and (te is None or h.y < te): te = h.y
    hw = []
    for f in FR_T:
        h = hit(FIN, (0.6, le - (le - te) * f, z), (-1, 0, 0), 1.2)
        hw.append(0.03 if (h is None or h.x <= 0.0 or h.x > 0.08) else h.x)
    return {'z': z, 'le': le, 'te': te, 'hw': hw}
hi_st = [fin_station(z) for z in FIN_Z_HI]
# 方向舵的後緣（z 0.0…0.6 讀到 −7.663／−7.706／−7.709／−7.700／−7.689／−7.678／−7.667）
te_lo = {}
for z in (-0.10, 0.00, 0.10, 0.30, 0.50):
    t = None
    for i in range(-10, 11):
        h = hit(FIN, (0.006 * i, -9.0, z), (0, 1, 0))
        if h is not None and (t is None or h.y < t): t = h.y
    te_lo[z] = t
hw_lo = [0.030, 0.034, 0.030, 0.020, 0.010]
le_line = lambda z: hi_st[0]['le'] + (hi_st[1]['le'] - hi_st[0]['le']) * (z - hi_st[0]['z']) / (hi_st[1]['z'] - hi_st[0]['z'])
# 背鰭（根部整流）：參考模型機身 mesh 的中線頂在 y −4.6 之後離開機身本體的直線、一路
# 長進垂尾前緣，而且 x 0.1 處也跟著抬（−5.3 是 0.521、−5.7 是 0.59），底寬約 ±0.10：
#
#   中線頂  y −4.90  −5.30  −5.65     垂尾前緣（量到）z 0.70 → −5.752
#           z 0.523  0.565  0.611
#
# 本體頂線照直線收到機尾（第 1 節），這一條歸垂尾：z 0.50…0.61 三站的前緣照中線頂，
# 厚度取到 ±0.12；z 0.40 那一站埋進本體（該處本體頂 0.44…0.51）。
fillet_hw = [0.03, 0.10, 0.12, 0.06, 0.02]
lo_st = [
    {'z': -0.15, 'le': -6.98, 'te': -7.10, 'hw': [0.02, 0.022, 0.02, 0.015, 0.008]},
    {'z': -0.10, 'le': -6.98, 'te': te_lo[-0.10], 'hw': hw_lo},
    {'z': 0.00, 'le': -6.95, 'te': te_lo[0.00], 'hw': hw_lo},
    {'z': 0.10, 'le': -6.85, 'te': te_lo[0.10], 'hw': hw_lo},
    {'z': 0.30, 'le': -4.40, 'te': te_lo[0.30], 'hw': hw_lo},
    {'z': 0.40, 'le': -4.50, 'te': te_lo[0.30] + 0.005, 'hw': fillet_hw},
    {'z': 0.50, 'le': -4.72, 'te': te_lo[0.50], 'hw': fillet_hw},
    {'z': 0.565, 'le': -5.30, 'te': te_lo[0.50] + 0.01, 'hw': [0.03, 0.07, 0.08, 0.04, 0.015]},
    {'z': 0.611, 'le': -5.65, 'te': te_lo[0.50] + 0.02, 'hw': [0.04, 0.06, 0.06, 0.03, 0.013]},
]
# 頂端圓角：1.80 的後緣 −7.483、1.90 是 −7.128
top_st = {'z': FIN_TOP - 0.005, 'le': le_line(FIN_TOP) - 0.06, 'te': -7.05,
          'hw': [w * 0.6 for w in hi_st[-1]['hw']]}
mid_st = {'z': 1.88, 'le': le_line(1.88) - 0.02, 'te': -7.28, 'hw': [w * 0.85 for w in hi_st[-1]['hw']]}
fins = lo_st + hi_st + [mid_st, top_st]
rings = []
for s in fins:
    le, te, ch = s['le'], s['te'], s['le'] - s['te']
    pts = [Vector((0, le, s['z']))]
    for f, w in zip(FR_T, s['hw']): pts.append(Vector((w, le - ch * f, s['z'])))
    pts.append(Vector((0, te, s['z'])))
    for f, w in zip(reversed(FR_T), reversed(s['hw'])): pts.append(Vector((-w, le - ch * f, s['z'])))
    rings.append(pts)
bm = bmesh.new()
vs = loft(bm, rings)
cap(bm, list(reversed(vs[0]))); cap(bm, vs[-1])
finish(bm)
new_object('JU87_Fin', bm, [M_BODY])
LOG['fin'] = [[round(s['z'], 2), round(s['le'], 3), round(s['te'], 3)] for s in fins]

# ═══════════════════════════ 9. 主起落架（固定式，整流罩＋腳柱＋輪胎） ═══════════════════════════
# Ref_Gear 右側射線表（整流罩中心 x 1.486；腳柱在 z −1.4 以上、輪胎在 −2.17 以下，兩者排除）：
#
#   y      1.06   0.94   0.86   0.74   0.58   0.42   0.26   0.14   0.02  −0.10  −0.22  −0.34  −0.46
#   頂    −1.73  −1.52  −1.47  −1.42  −1.37  −1.33  −1.35  −1.35  −1.40  −1.48  −1.53  −1.57  −1.62
#   底    −1.98  −2.10  −2.17  −2.15  −2.15  −2.15  −2.09  −1.99  −1.94  −1.89  −1.84  −1.78  −1.71
#   半寬   0.07   0.18   0.20   0.22   0.23   0.23   0.21   0.20   0.18   0.15   0.12   0.085  0.06
#
# 前端圓鈍、後端收成一根錐（y −0.52、z −1.67）。這張表由 m_misc 的逐站射線讀出，腳柱與
# 輪胎的 z 帶人工排除（兩者與整流罩在同一個 mesh 群裡）。
GEAR_X = 1.486
SPAT = [(1.06, -1.73, -1.98, 0.07), (0.94, -1.52, -2.10, 0.18), (0.86, -1.47, -2.17, 0.20),
        (0.74, -1.42, -2.15, 0.22), (0.58, -1.37, -2.15, 0.23), (0.42, -1.33, -2.15, 0.23),
        (0.26, -1.35, -2.09, 0.21), (0.14, -1.35, -1.99, 0.20), (0.02, -1.40, -1.94, 0.18),
        (-0.10, -1.48, -1.89, 0.15), (-0.22, -1.53, -1.84, 0.12), (-0.34, -1.57, -1.78, 0.085),
        (-0.46, -1.62, -1.71, 0.06)]
SPAT_NOSE = (1.10, -1.86); SPAT_TAIL = (-0.53, -1.67)
# 輪胎：底 −2.315 在 y 0.60；y 0.26／0.94 讀到 −2.093／−2.095 → 半徑 0.372、圓心 z −1.943
TIRE = (0.60, -1.943, 0.372, 0.10)
# 腳柱：流線型整流罩，前後 0.48、左右 0.15；由整流罩頂一路插進主翼下表面（折點附近 −0.65）
LEG = (0.27, 0.24, 0.075, -1.45, -0.45)
def spat_ring(y, top, bot, hw, sx, n=10):
    zc = 0.5 * (top + bot); b = 0.5 * (top - bot)
    return [Vector((sx * GEAR_X + hw * math.cos(2 * math.pi * j / n), y, zc + b * math.sin(2 * math.pi * j / n)))
            for j in range(n)]
bm = bmesh.new()
for sx in (1, -1):
    part = bmesh.new()
    vs = loft(part, [spat_ring(y, t, b, w, sx) for y, t, b, w in SPAT])
    fan(part, vs[0], Vector((sx * GEAR_X, SPAT_NOSE[0], SPAT_NOSE[1])))
    fan(part, vs[-1], Vector((sx * GEAR_X, SPAT_TAIL[0], SPAT_TAIL[1])))
    finish(part)
    # 腳柱
    ly, lhy, lhx, lz0, lz1 = LEG
    r0 = [Vector((sx * GEAR_X + lhx * math.cos(2 * math.pi * j / 8), ly + lhy * math.sin(2 * math.pi * j / 8), lz0)) for j in range(8)]
    r1 = [Vector((sx * GEAR_X + 0.85 * lhx * math.cos(2 * math.pi * j / 8), ly + 0.85 * lhy * math.sin(2 * math.pi * j / 8), lz1)) for j in range(8)]
    vs = loft(part, [r0, r1]); cap(part, list(reversed(vs[0]))); cap(part, vs[-1])
    finish(part)
    me = bpy.data.meshes.new('tmp'); part.to_mesh(me); part.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
finish(bm)
new_object('JU87_Gear', bm, [M_BODY])
bm = bmesh.new()
for sx in (1, -1):
    ty, tz, tr, tw = TIRE
    rings = []
    for x in (sx * GEAR_X - tw, sx * GEAR_X + tw):
        rings.append([Vector((x, ty + tr * math.cos(2 * math.pi * j / 12), tz + tr * math.sin(2 * math.pi * j / 12))) for j in range(12)])
    part = bmesh.new()
    vs = loft(part, rings); cap(part, vs[0]); cap(part, list(reversed(vs[1])))
    finish(part)
    me = bpy.data.meshes.new('tmp'); part.to_mesh(me); part.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
finish(bm)
new_object('JU87_Tire', bm, [M_ACC])

# 尾輪：輪子取 Ref_TailWheel 在 z −0.45 以下的頂點（圓心與半徑），叉架由機身腹線斜到輪軸
tw_ = [v.co for v in O['Ref_TailWheel'].data.vertices]
wl = [p for p in tw_ if p.z < -0.45]
twy = 0.5 * (min(p.y for p in wl) + max(p.y for p in wl)); twz = 0.5 * (min(p.z for p in wl) + max(p.z for p in wl))
twr = 0.5 * (max(p.z for p in wl) - min(p.z for p in wl))
top_p = [p for p in tw_ if p.z > max(q.z for q in tw_) - 0.05]
tty = sum(p.y for p in top_p) / len(top_p)
bm = bmesh.new()
rings = [[Vector((x, twy + twr * math.cos(2 * math.pi * j / 10), twz + twr * math.sin(2 * math.pi * j / 10))) for j in range(10)]
         for x in (-0.045, 0.045)]
vs = loft(bm, rings); cap(bm, vs[0]); cap(bm, list(reversed(vs[1])))
finish(bm)
new_object('JU87_TailWheel', bm, [M_ACC])
# 叉架比輪子窄 2 cm：同寬的話叉架側面與輪子端面平行相距 5 mm，重疊的那一塊會閃
bm = bmesh.new()
a = Vector((0, tty, max(q.z for q in tw_) + 0.08)); b = Vector((0, twy, twz))
pts = [p + Vector((dx, dy, 0)) for p in (a, b) for dx in (-0.025, 0.025) for dy in (-0.04, 0.04)]
hull_into(bm, pts)
finish(bm)
new_object('JU87_TailStrut', bm, [M_BODY])
LOG['tailwheel'] = [round(twy, 3), round(twz, 3), round(twr, 3), round(tty, 3)]

# ═══════════════════════════ 10. 玻璃框條 ═══════════════════════════
# 拱的 y 位置是量的：x 0／0.2／0.3 三條由上往下的射線，罩框比玻璃高（或沒有玻璃）的那幾格。
#   0.21 風擋前緣、−0.02 風擋後框、−0.20 滑動罩前框、−0.48、−0.78、−1.12、−1.28、
#   −1.60、−2.05（後座罩前框，寬 0.11）、−2.36（罩尾）
# 側面另有一條水平縱軌在 z 0.97（y −0.2…−0.9 的「最外層」掃描在那個高度讀到框）。
GB = bvh_of(['JU87_Glass'])
def strip_from_points(bm, pts, nrm, width, along):
    prev = None
    for p, n in zip(pts, nrm):
        q = p + n * 0.004
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            try: bm.faces.new([prev[0], prev[1], b, a])
            except ValueError: pass
        prev = (a, b)
def arch(bm, y0, width=0.035, zc=0.62):
    pts, nrm = [], []
    for j in range(17):
        th = -math.pi / 2 * 0.96 + math.pi * 0.96 * j / 16
        d = Vector((-math.sin(th), 0, -math.cos(th)))
        o = Vector((0, y0, zc)) - d * 1.5
        r = GB.ray_cast(o, d, 3.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))
def side_rail(bm, sx, z0, y_from, y_to, width=0.030, n=16):
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = GB.ray_cast(Vector((sx * 2.0, y, z0)), Vector((-sx, 0, 0)), 3.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 0, 1)))
bm = bmesh.new()
# 罩尾框（−2.36）不做：那裡的玻璃只剩罩尾尖端一小片，拱打到的只有兩三點，是一截浮著的短條
for y0 in (-0.02, -0.20, -0.48, -0.78, -1.12, -1.28, -1.60, -2.05): arch(bm, y0)
for sx in (1, -1): side_rail(bm, sx, 0.97, -0.02, -1.70)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
new_object('JU87_Frames', bm, [M_FRAME])

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('JU87_'):
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total

def export():
    """匯出 GLB（只選 JU87_*），存一份不含 Ref_* 的 .blend 進版控。"""
    for o in O: o.select_set(False)
    for o in COLL.objects:
        if o.name.startswith('JU87_'):
            o.hide_set(False); o.select_set(True)
    glb = os.path.join(REPO, 'models-src', 'ju87.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True,
                              export_yup=True, export_extras=True, export_apply=True)
    # 版控裡的 .blend 只留 JU87_* 與切割盒：參考模型（含匯入時打包進來的五張 1024² 貼圖）
    # 與預設場景的方塊、相機、燈一律清掉
    for o in list(O):
        if not (o.name.startswith('JU87_') or o.name.startswith('Cut_')):
            bpy.data.objects.remove(o, do_unlink=True)
    for im in list(bpy.data.images):
        bpy.data.images.remove(im)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, 'tools', 'blender', 'ju87.blend'))
    return glb

_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if '--work' in _argv:
    bpy.ops.wm.save_as_mainfile(filepath=_argv[_argv.index('--work') + 1])
if '--export' in _argv:
    LOG['glb'] = export()
result = LOG
if bpy.app.background:
    import json
    print('JSON' + json.dumps(LOG))
