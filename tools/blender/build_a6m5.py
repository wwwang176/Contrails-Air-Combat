# -*- coding: utf-8 -*-
"""
A6M5 零戰：在 Blender 裡對著參考模型直接量、直接 loft（2026-09-03，Bf 109 / P-51 的「用 GLB 畫 GLB」）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_a6m5.py', encoding='utf-8').read())
沒有 Ref_* 物件時會先把 ref/a6m5_hei_war_thunder.glb 匯進來對齊（翼展 11.00、
翼根四分之一弦線在原點、整流罩軸在 y=0）；有就直接建。建完自己匯出：

    use_selection=True（只選 A6M5_*）、export_yup=True、export_extras=True、export_apply=True

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。
量測與建模的細節（哪些是量的、哪些是判斷）寫在 src/render/geometry/a6m5.model.ts 檔頭。
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\a6m5_hei_war_thunder.glb"

def import_and_align_ref():
    """匯入參考模型，烘 matrix_world，刪雜件，轉到機體座標。只留量測要用的 Ref_*。"""
    O = bpy.data.objects
    keep = {'Object_11': 'Ref_Body11', 'Object_12': 'Ref_Body12', 'Object_8': 'Ref_Cowl8', 'Object_7': 'Ref_Engine7',
            'Object_10': 'Ref_Ctrl10', 'Object_4': 'Ref_AilL', 'Object_6': 'Ref_AilR', 'Object_13': 'Ref_Flap13', 'Object_14': 'Ref_Glass'}
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()
    new = [o for o in O if o.name not in before]
    objs = {}
    for o in new:
        if o.type == 'MESH' and o.name in keep:
            me = o.data.copy(); me.transform(o.matrix_world.copy())
            n = bpy.data.objects.new(keep[o.name], me); bpy.context.scene.collection.objects.link(n)
            objs[keep[o.name]] = n
    for o in new: bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    body = objs['Ref_Body11']
    xs = [v.co.x for v in body.data.vertices]
    S = 11.00 / (max(xs) - min(xs))                       # 翼展縮放 ×1.0326
    R = Matrix.Rotation(math.pi, 4, 'Z')                   # 機首 −Y → +Y
    for o in objs.values(): o.data.transform(Matrix.Scale(S, 4) @ R)
    # 整流罩軸：機首最前 0.35 m 的頂點在 x,z 的中心
    py = max(v.co.y for v in body.data.vertices)
    nose = [v.co for v in body.data.vertices if v.co.y > py - 0.35]
    ax = (max(p.x for p in nose) + min(p.x for p in nose)) / 2; az = (max(p.z for p in nose) + min(p.z for p in nose)) / 2
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((-ax, 0, -az))))
    # 翼根四分之一弦：x 1.0 / 1.5 站射線量前後緣，線性外推到 x 0.35（頂點掃帶會混進尾翼，不能用）
    bm = bmesh.new()
    for n in ('Ref_Body11', 'Ref_Body12', 'Ref_Ctrl10', 'Ref_Flap13', 'Ref_AilR', 'Ref_AilL'): bm.from_mesh(objs[n].data)
    bmesh.ops.triangulate(bm, faces=bm.faces); T = BVHTree.FromBMesh(bm); bm.free()
    def chord(x):
        le = te = None
        for k in range(16):
            z = -0.45 + 0.05 * k
            h = T.ray_cast(Vector((x, 3.0, z)), Vector((0, -1, 0)), 6.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -4.0, z)), Vector((0, 1, 0)), 6.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(1.0), chord(1.5)
    ex = lambda a, b: a + (b - a) * (0.35 - 1.0) / 0.5
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((0, -qc, 0))))

if 'Ref_Body11' not in bpy.data.objects:
    import_and_align_ref()
O = bpy.data.objects

LOG = {}

# ───────────────────────── 材質 ─────────────────────────
def mat(name, rgb, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name); m.use_nodes = True
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
M_BODY = mat('A6M5_Body', srgb(0x5b6650))
M_ACC = mat('A6M5_Accent', srgb(0x262829))
M_GLASS = mat('A6M5_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('A6M5_Cockpit', srgb(0x191d1a))
M_FRAME = mat('A6M5_Frame', srgb(0x5b6650))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('A6M5_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('A6M5')
if COLL is None:
    COLL = bpy.data.collections.new('A6M5'); bpy.context.scene.collection.children.link(COLL)

def new_object(name, bm, mats, hide=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if hide:
        ob.display_type = 'WIRE'; ob.hide_render = True
    return ob

# ───────────────────────── 量尺 ─────────────────────────
def bvh_of(names):
    bm = bmesh.new()
    for n in names: bm.from_mesh(O[n].data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    t = BVHTree.FromBMesh(bm); bm.free(); return t
BODYG = bvh_of(['Ref_Body11', 'Ref_Body12', 'Ref_Cowl8', 'Ref_Glass'])
WING = bvh_of(['Ref_Body11', 'Ref_Body12', 'Ref_Ctrl10', 'Ref_Flap13', 'Ref_AilR', 'Ref_AilL'])
TAIL = bvh_of(['Ref_Body11', 'Ref_Body12', 'Ref_Ctrl10'])
def hit(T, o, d, L=8.0):
    return T.ray_cast(Vector(o), Vector(d), L)[0]
def zmax_at(T, x, y):
    h = hit(T, (x, y, 3.0), (0, 0, -1)); return h.z if h else None
def zmin_at(T, x, y):
    h = hit(T, (x, y, -3.0), (0, 0, 1)); return h.z if h else None
def halfw(T, y, z, x0):
    h = hit(T, (x0, y, z), (-1, 0, 0)); return h.x if h else None

# ───────────────────────── 通用 loft ─────────────────────────
def loft(bm, rings, close=True):
    """rings: list of list of Vector（每環點數相同、同向）。回傳每環的 BMVert 列。"""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        rng = range(n) if close else range(n - 1)
        for j in rng:
            k = (j + 1) % n
            q = [a[j], a[k], b[k], b[j]]
            if len(set(q)) < 4: continue
            try: bm.faces.new(q)
            except ValueError: pass
    return vs
def cap(bm, verts, reverse=False):
    vv = list(reversed(verts)) if reverse else verts
    try: bm.faces.new(vv)
    except ValueError: pass
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

# ═══════════════════════════ 1. 機身 ═══════════════════════════
# 站位（機首 → 機尾）。1.84 是整流罩底（r 0.25）、1.80 起是引擎罩唇。
FUS_Y = [1.84, 1.81, 1.76, 1.68, 1.56, 1.40, 1.20, 1.00, 0.80, 0.55, 0.30, 0.10, -0.05, -0.20, -0.38, -0.58,
         -0.80, -1.05, -1.30, -1.58, -1.85, -2.10, -2.42, -2.80, -3.25, -3.75, -4.30, -4.90, -5.50, -6.10, -6.45]
TAIL_POLE = Vector((0, -6.65, 0.0))   # 尾錐末端收成一點（方向舵下角 −6.66）
COWL_T, COWL_END = 0.02, 0.80         # 引擎罩殼厚 2 cm、後緣站；機身從這站往後才建（罩子裡面的不建）
LEVELS = 8           # 每側 8 級 + 頂底兩尖 = 18 點/環
WING_BAND = (-2.30, 0.75)   # 翼根整流罩：這段 z<-0.10 的寬度改用橢圓收斂
TP_BAND = (-6.05, -4.40)    # 水平尾翼：這段 z∈[0.09,0.27] 的寬度作廢內插
def belly_smooth(y):
    """下巴進氣口那一段（0.95…0.30）的腹線改用前後內插，進氣口另做。"""
    if 0.30 <= y <= 0.96:
        return -0.607 + (-0.620 + 0.607) * (0.96 - y) / (0.96 - 0.30)
    return None
def station(y):
    T = BODYG
    st = [v for v in [zmax_at(T, x, y) for x in (0.12, -0.12, 0.16, -0.16)] if v is not None]
    ctop = zmax_at(T, 0.0, y)
    side_top = max(st) if st else ctop
    top = side_top if (ctop is None or ctop > side_top + 0.10) else max(ctop, side_top)
    sb = [v for v in [zmin_at(T, x, y) for x in (0.10, -0.10, 0.14, -0.14)] if v is not None]
    cbot = zmin_at(T, 0.0, y)
    side_bot = min(sb) if sb else cbot
    bot = side_bot if (cbot is None or cbot < side_bot - 0.10) else min(cbot, side_bot)
    bs = belly_smooth(y)
    if bs is not None: bot = bs
    n = max(12, int((top - bot) / 0.012))
    zs, ws, raw = [], [], []
    for i in range(n + 1):
        z = bot + (top - bot) * i / n
        w1 = halfw(T, y, z, 3.0); w2 = halfw(T, y, z, 0.75)
        w = None
        if w2 is not None and w2 <= 0.72: w = w2
        elif w1 is not None and w1 <= 0.72: w = w1
        raw.append(w)
        if TP_BAND[0] <= y <= TP_BAND[1] and 0.09 <= z <= 0.27: w = None
        zs.append(z); ws.append(w)
    # 尾段：頂由「寬度 ≥ 門檻的最高 z」決定（去掉垂尾／背鰭薄片）；用未作廢的原始寬度判
    if y < -3.4:
        thr = 0.10 if y > -6.2 else 0.045
        zt = max(z for z, w in zip(zs, raw) if w is not None and abs(w) >= thr)
        top = min(top, zt + 0.012)
        keep = [i for i, z in enumerate(zs) if z <= top]
        zs = [zs[i] for i in keep]; ws = [ws[i] for i in keep]
    valid = [i for i, w in enumerate(ws) if w is not None]
    fixed = []
    for i, w in enumerate(ws):
        if w is not None: fixed.append(w); continue
        lo = max([j for j in valid if j < i], default=None); hi = min([j for j in valid if j > i], default=None)
        if lo is None and hi is None: fixed.append(0.0)
        elif lo is None: fixed.append(ws[hi])
        elif hi is None: fixed.append(ws[lo])
        else: fixed.append(ws[lo] + (ws[hi] - ws[lo]) * (zs[i] - zs[lo]) / (zs[hi] - zs[lo]))
    # 翼根段：z<-0.10 改橢圓收斂到腹線
    if WING_BAND[0] <= y <= WING_BAND[1]:
        zc = -0.10
        wc = None
        for z, w in zip(zs, fixed):
            if z >= zc: wc = w; break
        if wc is not None and bot < zc:
            for i, z in enumerate(zs):
                if z < zc:
                    u = (zc - z) / (zc - bot)
                    fixed[i] = wc * math.sqrt(max(0.0, 1 - u * u))
    fixed[0] = 0.0; fixed[-1] = 0.0
    return {'y': y, 'top': top, 'bot': bot, 'z': zs, 'w': fixed}
def resample(s, L=LEVELS):
    """把細掃的 (z, w) 重取樣成 L 級（餘弦分佈：頂底密）。回傳 [(w, z)] 由底到頂，不含頂底尖點。"""
    zs, ws = s['z'], s['w']; out = []
    for k in range(1, L + 1):
        t = k / (L + 1)
        zz = s['bot'] + (s['top'] - s['bot']) * (0.5 - 0.5 * math.cos(math.pi * t))
        # 線性內插 w
        for i in range(len(zs) - 1):
            if zs[i] <= zz <= zs[i + 1]:
                f = (zz - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0
                out.append((ws[i] + (ws[i + 1] - ws[i]) * f, zz)); break
        else:
            out.append((ws[-1], zz))
    return out
STA = []
for y in FUS_Y:
    s = station(y); s['lv'] = resample(s); STA.append(s)
# 站間平滑（y 不等距的拉普拉斯，λ0.5 × 2，門檻 0.06：整流罩唇、座艙那種真的階不抹）
def smooth_levels(sta, passes=2, lam=0.5, thr=0.06):
    for _ in range(passes):
        new = []
        for i, s in enumerate(sta):
            if i == 0 or i == len(sta) - 1: new.append((s['lv'], s['top'], s['bot'])); continue
            a, b = sta[i - 1], sta[i + 1]
            t = (s['y'] - a['y']) / (b['y'] - a['y'])
            lv = []
            for k in range(LEVELS):
                wa, za = a['lv'][k]; wb, zb = b['lv'][k]; w, z = s['lv'][k]
                wl = wa + (wb - wa) * t; zl = za + (zb - za) * t
                if abs(w - wl) < thr and abs(z - zl) < thr:
                    lv.append((w + (wl - w) * lam, z + (zl - z) * lam))
                else: lv.append((w, z))
            tl = a['top'] + (b['top'] - a['top']) * t; bl = a['bot'] + (b['bot'] - a['bot']) * t
            top = s['top'] + (tl - s['top']) * lam if abs(tl - s['top']) < thr else s['top']
            bot = s['bot'] + (bl - s['bot']) * lam if abs(bl - s['bot']) < thr else s['bot']
            new.append((lv, top, bot))
        for s, (lv, top, bot) in zip(sta, new): s['lv'], s['top'], s['bot'] = lv, top, bot
smooth_levels(STA)
def ring_of(s):
    y = s['y']; pts = [Vector((0, y, s['bot']))]
    for w, z in s['lv']: pts.append(Vector((w, y, z)))
    pts.append(Vector((0, y, s['top'])))
    for w, z in reversed(s['lv']): pts.append(Vector((-w, y, z)))
    return pts
rings = [ring_of(s) for s in STA if s['y'] <= COWL_END + 1e-6]   # 引擎罩裡的機身不建（負責人：跟玻璃一樣裁掉）
bm = bmesh.new()
vs = loft(bm, rings)
cap(bm, vs[0]); fan(bm, vs[-1], TAIL_POLE)    # 前封蓋在 y 0.80，藏在引擎罩裡
finish(bm)
fus = new_object('A6M5_Fuselage', bm, [M_BODY, M_ACC])
LOG['fus_tris'] = sum(len(p.vertices) - 2 for p in fus.data.polygons)
LOG['fus_stations'] = [[round(s['y'], 2), round(s['top'], 3), round(s['bot'], 3), round(max(w for w, z in s['lv']), 3)] for s in STA]

# ═══════════════════════════ 2. 座艙：盒切玻璃 + 黑色內槽 ═══════════════════════════
SILL = 0.585
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)
# 玻璃盒：後壁 y −2.19 垂直、底 z 0.585；風擋段（y −0.20…0.16）底面斜上到 0.70（風擋下緣）
gb = []
for x in (-1.2, 1.2):
    gb += [(x, -2.19, SILL), (x, -2.19, 2.0), (x, -0.20, SILL), (x, 0.16, 0.700), (x, 0.16, 2.0)]
cut_glass = hull_object('Cut_Glass', gb, M_COCK)
# 內槽盒：|x| ≤ 0.26、y −2.05…−0.12、z 0.30…0.65
tb = [(sx * 0.26, y, z) for sx in (-1, 1) for y in (-2.05, -0.12) for z in (0.30, 0.65)]
cut_tub = hull_object('Cut_Tub', tb, M_COCK)
def boolean_apply(ob, cutter, op):
    md = ob.modifiers.new('B', 'BOOLEAN'); md.operation = op; md.object = cutter; md.solver = 'EXACT'
    if hasattr(md, 'material_mode'): md.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me
    me.name = old.name + '_b'
    bpy.data.meshes.remove(old)
    me.name = ob.name
    return ob
# 玻璃 = 機身 ∩ 盒
glass = bpy.data.objects.new('A6M5_Glass', fus.data.copy()); COLL.objects.link(glass)
boolean_apply(glass, cut_glass, 'INTERSECT')
# 刪掉封蓋（落在盒面上的面），其餘全改玻璃材質
bm = bmesh.new(); bm.from_mesh(glass.data); bm.normal_update()
# 落在切割盒任何一個面的平面上、且法線平行的面都是封蓋（底、斜底、前壁、後壁）——
# 它們與機身那邊塗黑的切面完全共面，留著就是閃爍（負責人 2026-09-03 在遊戲裡看到）
cb = bmesh.new(); cb.from_mesh(cut_glass.data); cb.normal_update()
planes = [(f.calc_center_median().copy(), f.normal.copy()) for f in cb.faces]
cb.free()
kill = []
for f in bm.faces:
    c = f.calc_center_median(); n = f.normal
    for p, pn in planes:
        if abs((c - p).dot(pn)) < 0.002 and abs(n.dot(pn)) > 0.98:
            kill.append(f); break
bmesh.ops.delete(bm, geom=kill, context='FACES')
for f in bm.faces: f.material_index = 0
glass.data.materials.clear(); glass.data.materials.append(M_GLASS)
bm.to_mesh(glass.data); bm.free()
LOG['glass_tris'] = sum(len(p.vertices) - 2 for p in glass.data.polygons)
LOG['glass_caps_removed'] = len(kill)
# 機身 = 機身 − 玻璃盒 − 內槽盒（切面帶 Cockpit 材質）
fus.data.materials.append(M_COCK)
boolean_apply(fus, cut_glass, 'DIFFERENCE')
boolean_apply(fus, cut_tub, 'DIFFERENCE')
LOG['fus_tris_after_cut'] = sum(len(p.vertices) - 2 for p in fus.data.polygons)
LOG['fus_mats'] = [m.name for m in fus.data.materials]

# ═══════════════════════════ 3. 整流罩（鼻帽）、槳葉 ═══════════════════════════
SPIN = [(2.443, 0.0), (2.42, 0.064), (2.39, 0.098), (2.33, 0.138), (2.27, 0.167), (2.18, 0.197), (2.06, 0.225), (1.94, 0.243), (1.845, 0.25)]
bm = bmesh.new(); rings = []
for y, r in SPIN[1:]:
    rings.append([Vector((r * math.cos(2 * math.pi * j / 10), y, r * math.sin(2 * math.pi * j / 10))) for j in range(10)])
vs = loft(bm, rings)
fan(bm, list(reversed(vs[0])), Vector((0, SPIN[0][0], 0)))
cap(bm, vs[-1])
finish(bm)
spinner = new_object('A6M5_Spinner', bm, [M_BODY])
PROP_Y, PROP_R = 1.95, 1.525
bm = bmesh.new()
for i in range(3):
    ang = 2 * math.pi * i / 3 + math.pi / 2
    r0, r1, hw, ht = 0.18, PROP_R, 0.07, 0.012
    c, s = math.cos(ang), math.sin(ang)
    pts = []
    for r in (r0, r1):
        for u in (-hw, hw):
            for t in (-ht, ht):
                # 徑向 r、弦向 u（垂直於徑向、在槳盤面內）、厚度 t（沿 y）
                pts.append(Vector((r * c - u * s, PROP_Y + t, r * s + u * c)))
    vv = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vv)
finish(bm)
prop = new_object('A6M5_Prop', bm, [M_ACC])

# ═══════════════════════════ 4. 主翼（一整片，穿過機身） ═══════════════════════════
def chord_fine(T, x, zlo, zhi, yfront, yback, step=0.006):
    le = None; te = None; n = int((zhi - zlo) / step)
    for k in range(n + 1):
        z = zlo + step * k
        h = hit(T, (x, yfront, z), (0, -1, 0))
        if h is not None and (le is None or h.y > le): le = h.y
        h = hit(T, (x, yback, z), (0, 1, 0))
        if h is not None and (te is None or h.y < te): te = h.y
    return le, te
FR_W = [0.03, 0.09, 0.18, 0.30, 0.45, 0.62, 0.80, 0.94]
FR_T = [0.05, 0.20, 0.40, 0.65, 0.90]
FR = FR_W
def panel_station(T, x, zlo, zhi, yfront, yback, zsl, zsh):
    le, te = chord_fine(T, x, zlo, zhi, yfront, yback)
    up, dn = [], []
    for f in FR:
        y = le - (le - te) * f
        u = hit(T, (x, y, zsh), (0, 0, -1), zsh - zsl); d = hit(T, (x, y, zsl), (0, 0, 1), zsh - zsl)
        up.append(None if u is None else u.z); dn.append(None if d is None else d.z)
    return {'x': x, 'le': le, 'te': te, 'up': up, 'dn': dn}
def fill_none(st_list):
    """某站某分數量不到就用鄰站同分數值補。"""
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    near = min(vals, key=lambda v: abs(v[0] - s['x']))
                    s[key][k] = near[1]
WX = [0.8, 1.3, 2.0, 2.7, 3.4, 4.1, 4.7, 5.1, 5.35, 5.45]
wst = [panel_station(WING, x, -0.55, 0.30, 3.0, -4.0, -0.75, 0.6) for x in WX]
fill_none(wst)
# 中央段：x=0 與 0.5 用 0.8 站的剖面（下表面不再往下走 —— 腹線在 −0.62），LE/TE 由 0.8/1.3 線性外推
def extrap(a, b, x):
    t = (x - a['x']) / (b['x'] - a['x'])
    return {'x': x, 'le': a['le'] + (b['le'] - a['le']) * t, 'te': a['te'] + (b['te'] - a['te']) * t,
            'up': list(a['up']), 'dn': list(a['dn'])}
wst = [extrap(wst[0], wst[1], 0.0), extrap(wst[0], wst[1], 0.45)] + wst
def section_pts(s):
    """剖面點：LE → 上表面（前→後）→ TE → 下表面（後→前）；y 弦向、z 高。"""
    le, te = s['le'], s['te']
    ch = le - te
    pts = [(le, 0.5 * (s['up'][0] + s['dn'][0]))]
    for f, u in zip(FR, s['up']): pts.append((le - ch * f, u))
    pts.append((te, 0.5 * (s['up'][-1] + s['dn'][-1])))
    for f, d in zip(reversed(FR), reversed(s['dn'])): pts.append((le - ch * f, d))
    return pts
def build_panel(name, sts, tip_x, tip_y, tip_z, mirror=True):
    rings = []
    seq = list(sts)
    if mirror:
        seq = [dict(s, x=-s['x']) for s in reversed(sts[1:])] + sts
    for s in seq:
        rings.append([Vector((s['x'], y, z)) for y, z in section_pts(s)])
    bm = bmesh.new()
    vs = loft(bm, rings)
    fan(bm, vs[-1], Vector((tip_x, tip_y, tip_z)))
    if mirror: fan(bm, list(reversed(vs[0])), Vector((-tip_x, tip_y, tip_z)))
    else: cap(bm, list(reversed(vs[0])))
    finish(bm)
    return new_object(name, bm, [M_BODY])
tip = wst[-1]
wing = build_panel('A6M5_Wing', wst, 5.5, 0.5 * (tip['le'] + tip['te']) - 0.10, 0.5 * (tip['up'][3] + tip['dn'][3]))
wing['part'] = 'wing0'
LOG['wing_tris'] = sum(len(p.vertices) - 2 for p in wing.data.polygons)
LOG['wing_root'] = [round(wst[0]['le'], 3), round(wst[0]['te'], 3)]
# 翼面積（梯形逐段）
area = 0
for a, b in zip(wst, wst[1:]):
    area += 0.5 * ((a['le'] - a['te']) + (b['le'] - b['te'])) * (b['x'] - a['x'])
area += 0.5 * (tip['le'] - tip['te']) * (5.5 - tip['x'])
LOG['wing_area'] = round(2 * area, 2)

# ═══════════════════════════ 5. 水平尾翼、垂尾 ═══════════════════════════
FR = FR_T
TX = [0.45, 0.8, 1.2, 1.6, 2.0, 2.25, 2.36]
tst = [panel_station(TAIL, x, 0.05, 0.60, -3.5, -8.0, -0.2, 1.0) for x in TX]
fill_none(tst)
tst = [extrap(tst[0], tst[1], 0.0)] + tst
tt = tst[-1]
tailplane = build_panel('A6M5_Tailplane', tst, 2.40, 0.5 * (tt['le'] + tt['te']), 0.5 * (tt['up'][3] + tt['dn'][3]))
LOG['tail_tris'] = sum(len(p.vertices) - 2 for p in tailplane.data.polygons)
# 垂尾：z 站位；剖面 = 半厚 rows（f 0.05…0.95）
FIN_Z = [0.15, 0.65, 0.8, 1.0, 1.2, 1.4, 1.55, 1.65, 1.70, 1.725]
def fin_station(z):
    le = None; te = None
    for i in range(-8, 9):
        x = 0.004 * i
        h = hit(TAIL, (x, -3.0, z), (0, -1, 0))
        if h is not None and (le is None or h.y > le): le = h.y
        h = hit(TAIL, (x, -8.0, z), (0, 1, 0))
        if h is not None and (te is None or h.y < te): te = h.y
    hw = []
    for f in FR:
        y = le - (le - te) * f
        h = hit(TAIL, (0.5, y, z), (-1, 0, 0), 1.0)
        hw.append(None if h is None else max(0.004, h.x))
    return {'z': z, 'le': le, 'te': te, 'hw': hw}
fst = [fin_station(z) for z in FIN_Z[1:]]
for s in fst:
    for k in range(len(FR)):
        if s['hw'][k] is None or s['hw'][k] > 0.12: s['hw'][k] = 0.03
# 根站（埋在機身裡）：LE/TE 由 0.65/0.8 外推，厚度沿用 0.65
r0 = dict(fst[0]); r0['z'] = FIN_Z[0]
t = (FIN_Z[0] - fst[0]['z']) / (fst[1]['z'] - fst[0]['z'])
r0['le'] = fst[0]['le'] + (fst[1]['le'] - fst[0]['le']) * t; r0['te'] = fst[0]['te'] + (fst[1]['te'] - fst[0]['te']) * t
r0['hw'] = [w * 1.15 for w in fst[0]['hw']]
fst = [r0] + fst
rings = []
for s in fst:
    le, te, ch = s['le'], s['te'], s['le'] - s['te']
    pts = [Vector((0, le, s['z']))]
    for f, w in zip(FR, s['hw']): pts.append(Vector((w, le - ch * f, s['z'])))
    pts.append(Vector((0, te, s['z'])))
    for f, w in zip(reversed(FR), reversed(s['hw'])): pts.append(Vector((-w, le - ch * f, s['z'])))
    rings.append(pts)
bm = bmesh.new()
vs = loft(bm, rings)
cap(bm, list(reversed(vs[0])))
top_s = fst[-1]
fan(bm, vs[-1], Vector((0, 0.5 * (top_s['le'] + top_s['te']), 1.734)))
finish(bm)
fin = new_object('A6M5_Fin', bm, [M_BODY])
LOG['fin_tris'] = sum(len(p.vertices) - 2 for p in fin.data.polygons)
LOG['fin_stations'] = [[s['z'], round(s['le'], 3), round(s['te'], 3)] for s in fst]

# ═══════════════════════════ 6. 進氣口（黑色內碗） ═══════════════════════════
# (a) 下巴滑油冷卻器：半橢圓剖面的小整流體，嘴在 y 0.94，往後收進腹線
SC = [(0.94, 0.20, -0.784), (0.80, 0.20, -0.784), (0.65, 0.19, -0.770), (0.52, 0.17, -0.740), (0.40, 0.14, -0.680), (0.30, 0.10, -0.635)]
def belly_at(y):
    return -0.607 + (-0.620 + 0.607) * (0.96 - y) / (0.96 - 0.30)
bm = bmesh.new(); rings = []
for y, a, zb in SC:
    zc = belly_at(y) + 0.06     # 天花板埋進機身 6 cm
    b = zc - zb
    pts = []
    for j in range(10):
        th = math.pi * j / 9      # 0 → π：右→左，走下半橢圓
        pts.append(Vector((a * math.cos(th), y, zc - b * math.sin(th))))
    pts.append(Vector((-a, y, zc))); pts.append(Vector((a, y, zc)))
    rings.append(pts)
vs = loft(bm, rings)
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
finish(bm)
# 嘴：不裁切，前端那片封蓋直接塗黑就像進氣口了（負責人）
for f in bm.faces:
    f.material_index = 1 if f.calc_center_median().y > SC[0][0] - 0.005 else 0
scoop = new_object('A6M5_ChinScoop', bm, [M_BODY, M_COCK])
LOG['scoop_tris'] = sum(len(p.vertices) - 2 for p in scoop.data.polygons)
# (b) 化油器進氣口：引擎罩唇頂上挖一個 |x|≤0.15、z 0.36…0.62、深 0.10 的槽
cb = [(sx * 0.15, y, z) for sx in (-1, 1) for y in (1.72, 1.95) for z in (0.36, 0.62)]
cut_carb = hull_object('Cut_CarbMouth', cb, M_COCK)     # 只切引擎罩殼（機身在那裡沒有面）
LOG['fus_tris_final'] = sum(len(p.vertices) - 2 for p in fus.data.polygons)

# ═══════════════════════════ 6b. 引擎罩（負責人：機鼻多套一層薄殼，機身不動、不相連） ═══════════════════════════
# 零戰經典的黑色引擎罩：拿機身 1.84…0.80 那幾站的環往外推 COWL_T，前端收到整流罩底
# （r 0.25）、後端收回機身裡 1 cm —— 後緣因此有一道 2 cm 的階，就是罩子的邊。
COWL_T, COWL_END = 0.02, 0.80
def offset_ring(s, d, y=None):
    y = s['y'] if y is None else y; zc = 0.5 * (s['top'] + s['bot'])
    out = []
    for p in ring_of(s):
        v = Vector((p.x, 0, p.z - zc))
        n = v.normalized() if v.length > 1e-6 else Vector((0, 0, 1))
        out.append(Vector((p.x + n.x * d, y, p.z + n.z * d)))
    return out
cowl_sta = [s for s in STA if s['y'] >= COWL_END - 1e-6]
rings = [offset_ring(s, COWL_T) for s in cowl_sta]
# 前環用機身 1.84 站的環（它就是整流罩底 r 0.25 的圓），與其他環同點數
front = offset_ring(cowl_sta[0], 0.0)
# 後封環退到 y 0.78、r−1 cm：封環藏在機身裡，不與機身 0.80 的前封蓋共面
rings = [front] + rings + [offset_ring(cowl_sta[-1], -0.01, y=COWL_END - 0.02)]
bm = bmesh.new()
vs = loft(bm, rings)
cap(bm, vs[0]); cap(bm, vs[-1], reverse=True)
finish(bm)
cowl = new_object('A6M5_Cowl', bm, [M_ACC, M_COCK])
boolean_apply(cowl, cut_carb, 'DIFFERENCE')
LOG['cowl_tris'] = sum(len(p.vertices) - 2 for p in cowl.data.polygons)

# ═══════════════════════════ 7. 玻璃框條（He 111 式：貼在玻璃外的細條，機身色） ═══════════════════════════
GB = bvh_of(['A6M5_Glass'])
def strip_from_points(bm, pts, nrm, width, along):
    """pts 一串在玻璃面上的點、nrm 對應法線；沿 `along`（單位向量）方向給寬度。"""
    prev = None
    for p, n in zip(pts, nrm):
        q = p + n * 0.004
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            try: bm.faces.new([prev[0], prev[1], b, a])
            except ValueError: pass
        prev = (a, b)
def arch(bm, y0, width=0.028):
    pts, nrm = [], []
    for j in range(15):
        th = -math.pi / 2 + math.pi * j / 14          # −90°（右艙緣）→ +90°（左艙緣）
        d = Vector((-math.sin(th), 0, -math.cos(th)))    # 由外向內指向 (0, y0, 0.55)
        o = Vector((0, y0, 0.55)) - d * 1.5
        r = GB.ray_cast(o, d, 3.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))
def rail(bm, x0, y_from, y_to, width=0.028, n=8):
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = GB.ray_cast(Vector((x0, y, 3.0)), Vector((0, 0, -1)), 6.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((1, 0, 0)))
bm = bmesh.new()
for y0 in (-0.28, -0.77, -1.13, -1.54, -1.92): arch(bm, y0)
for x0 in (-0.17, 0.17): rail(bm, x0, -0.29, -1.12)
rail(bm, 0.0, -1.14, -2.10)
# 風擋：兩根斜柱（x ±0.20，y 0.15 → −0.27）
for x0 in (-0.20, 0.20): rail(bm, x0, 0.14, -0.27, n=4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
frames = new_object('A6M5_Frames', bm, [M_FRAME])
LOG['frame_tris'] = sum(len(p.vertices) - 2 for p in frames.data.polygons)

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('A6M5_'):
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total
result = LOG
