# -*- coding: utf-8 -*-
"""
Ki-84 疾風（甲型）：在 Blender 裡對著參考模型直接量、直接 loft（A6M5 那支的做法）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_ki84.py', encoding='utf-8').read())
沒有 Ref_* 物件時會先把 ref/ki-84_ko_war_thunder.glb 匯進來對齊（翼展 11.24、
翼根四分之一弦線在原點、整流罩軸在 y=0）；有就直接建。建完自己匯出：

    use_selection=True（只選 KI84_*）、export_yup=True、export_extras=True、export_apply=True

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。
量測與建模的細節（哪些是量的、哪些是判斷）寫在 src/render/geometry/ki84.model.ts 檔頭。
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\ki-84_ko_war_thunder.glb"
SPAN = 11.24

def import_and_align_ref():
    """匯入參考模型，烘 matrix_world，刪雜件（天線桅），轉到機體座標。只留量測要用的 Ref_*。
    Object_5 主翼＋後機身＋尾翼、Object_6 前機身＋引擎罩（含罩內的引擎面）、Object_7 整流罩＋槳葉，
    Object_8 舵面（半透明）、Object_4 襟翼、Object_3 座艙玻璃（風擋中央的防彈玻璃不在裡面）。"""
    O = bpy.data.objects
    keep = {'Object_5': 'Ref_Body5', 'Object_6': 'Ref_Body6', 'Object_7': 'Ref_Prop7',
            'Object_8': 'Ref_Ctrl8', 'Object_4': 'Ref_Flap4', 'Object_3': 'Ref_Glass'}
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
    body = objs['Ref_Body5']
    xs = [v.co.x for v in body.data.vertices]
    S = SPAN / (max(xs) - min(xs))                        # 參考模型就是真實尺寸（×1.0008）
    R = Matrix.Rotation(math.pi, 4, 'Z')                   # 機首 −Y → +Y
    for o in objs.values(): o.data.transform(Matrix.Scale(S, 4) @ R)
    # 整流罩軸：引擎罩唇（前機身最前 0.15 m）的頂點在 x,z 的中心
    fb = objs['Ref_Body6']
    py = max(v.co.y for v in fb.data.vertices)
    lip = [v.co for v in fb.data.vertices if v.co.y > py - 0.15]
    ax = (max(p.x for p in lip) + min(p.x for p in lip)) / 2; az = (max(p.z for p in lip) + min(p.z for p in lip)) / 2
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((-ax, 0, -az))))
    # 翼根四分之一弦：x 1.3 / 2.5 站射線量前後緣（前緣是一直線；x 2.0 有砲管、x 1.0 有整流罩，
    # 都不用），線性外推到中線 x 0
    bm = bmesh.new()
    for n in ('Ref_Body5', 'Ref_Body6', 'Ref_Ctrl8', 'Ref_Flap4'): bm.from_mesh(objs[n].data)
    bmesh.ops.triangulate(bm, faces=bm.faces); T = BVHTree.FromBMesh(bm); bm.free()
    def chord(x):
        le = te = None
        for k in range(180):
            z = -0.70 + 0.006 * k
            h = T.ray_cast(Vector((x, 3.0, z)), Vector((0, -1, 0)), 6.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -4.5, z)), Vector((0, 1, 0)), 6.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(1.3), chord(2.5)
    ex = lambda a, b: a + (b - a) * (0.0 - 1.3) / 1.2
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((0, -qc, 0))))
    return {'S': round(S, 4), 'axis': [round(ax, 3), round(az, 3)], 'root_chord': [round(le_r, 3), round(te_r, 3)], 'qc': round(qc, 3)}

ALIGN = None
if 'Ref_Body5' not in bpy.data.objects:
    ALIGN = import_and_align_ref()
O = bpy.data.objects

LOG = {'align': ALIGN}

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
M_BODY = mat('KI84_Body', srgb(0x55603f))
M_ACC = mat('KI84_Accent', srgb(0x262829))
M_GLASS = mat('KI84_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('KI84_Cockpit', srgb(0x191d1a))
M_FRAME = mat('KI84_Frame', srgb(0x55603f))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('KI84_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('KI84')
if COLL is None:
    COLL = bpy.data.collections.new('KI84'); bpy.context.scene.collection.children.link(COLL)

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
BODYG = bvh_of(['Ref_Body5', 'Ref_Body6', 'Ref_Glass'])
WING = bvh_of(['Ref_Body5', 'Ref_Body6', 'Ref_Ctrl8', 'Ref_Flap4'])
TAIL = bvh_of(['Ref_Body5', 'Ref_Ctrl8'])
PROP = bvh_of(['Ref_Prop7'])
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

# ═══════════════════════════ 1. 機身 ═══════════════════════════
# 站位（機首 → 機尾）。2.19 是引擎罩唇（開口半徑 0.46，前封蓋塗黑就是引擎面）；
# −0.58…−0.90 風擋、−0.90…−1.55 艙頂平段、−2.72 玻璃末端；−5.3 起尾錐。
FUS_Y = [2.17, 2.14, 2.10, 2.04, 1.96, 1.86, 1.70, 1.50, 1.30, 1.10, 0.90, 0.70, 0.50, 0.30, 0.10,
         -0.10, -0.30, -0.50, -0.58, -0.66, -0.74, -0.82, -0.90, -1.00, -1.15, -1.30, -1.50, -1.70,
         -1.90, -2.05, -2.20, -2.40, -2.60, -2.72, -2.85, -3.05, -3.35, -3.70, -4.10, -4.50, -4.90,
         -5.30, -5.70, -6.05, -6.35]
TAIL_POLE = Vector((0, -6.98, 0.20))   # 尾錐末端收成一點（機身在方向舵下方結束）
STA_TOP_57 = 0.486                     # −5.7 站的機身頂（x ±0.12 的垂直射線量的）
LEVELS = 8           # 每側 8 級 + 頂底兩尖 = 18 點/環
WING_BAND = (-2.30, 0.80)   # 翼根整流罩：這段 z<-0.10 的寬度改用橢圓收斂
TP_BAND = (-6.25, -4.90)    # 水平尾翼：這段 z∈[0.33,0.48] 的寬度作廢內插
COWL_BAND_Y0 = 0.60         # 這站以前是引擎罩：剖面取上凸包（排氣管槽、整流片縫不進模型）
def belly_smooth(y):
    """滑油冷卻器進氣口（y 1.35…0.65）與主翼中央段（0.65…−0.15）的腹線：機身本體在這段是 −0.72 平的，
    進氣口另做、主翼穿過。"""
    if -0.15 <= y <= 1.35: return -0.72
    return None
def station(y):
    T = BODYG
    st = [v for v in [zmax_at(T, x, y) for x in (0.12, -0.12, 0.16, -0.16)] if v is not None]
    ctop = zmax_at(T, 0.03, y)
    side_top = max(st) if st else ctop
    top = side_top if (ctop is None or ctop > side_top + 0.25) else max(ctop, side_top)
    sb = [v for v in [zmin_at(T, x, y) for x in (0.10, -0.10, 0.14, -0.14)] if v is not None]
    cbot = zmin_at(T, 0.0, y)
    side_bot = min(sb) if sb else cbot
    bot = side_bot if (cbot is None or cbot < side_bot - 0.10) else min(cbot, side_bot)
    if y < -5.9:    # 尾輪艙是個洞，正下方的射線會打進艙頂；取所有射線的最低點才是蒙皮
        bot = min(v for v in sb + [cbot] + [zmin_at(T, x, y) for x in (0.05, -0.05)] if v is not None)
    bs = belly_smooth(y)
    if bs is not None: bot = bs
    n = max(12, int((top - bot) / 0.012))
    zs, ws, raw = [], [], []
    for i in range(n + 1):
        z = bot + (top - bot) * i / n
        # 從外（x 3.0）與從翼根裡（x 0.75）各打一次：兩者一致才是蒙皮；差超過 2 cm 的是排氣管
        # （外側打到管子、內側打到管子的內壁）之類的突出物，作廢、由上下鄰級內插
        w1 = halfw(T, y, z, 3.0); w2 = halfw(T, y, z, 0.75)
        if w1 is not None and w1 > 0.72: w1 = None
        if w2 is not None and w2 > 0.72: w2 = None
        if w1 is not None and w2 is not None: w = w2 if abs(w1 - w2) < 0.02 else None
        else: w = w2 if w2 is not None else w1
        raw.append(w)
        if TP_BAND[0] <= y <= TP_BAND[1] and 0.33 <= z <= 0.48: w = None
        zs.append(z); ws.append(w)
    # 尾段：頂由「寬度 ≥ 門檻的最高 z」決定（去掉垂尾薄片）；用未作廢的原始寬度判
    if y < -3.4:
        wmax = max(abs(w) for w in raw if w is not None)
        thr = 0.10 if y > -6.15 else 0.08     # 垂尾最厚半寬 0.066；尾錐 −6.35 站半寬 0.10
        zt = max(z for z, w in zip(zs, raw) if w is not None and abs(w) >= thr)
        top = min(top, zt + 0.012)
        if y < -6.0:    # 尾錐末段：垂尾根部整流罩蓋住了機身頂，頂線改用 −5.7 站到尾端點的直線
            top = min(top, STA_TOP_57 + (TAIL_POLE.z - STA_TOP_57) * (y + 5.7) / (TAIL_POLE.y + 5.7))
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
    # 引擎罩段：剖面是凸的，取 (z, w) 的上凸包 —— 排氣管槽、整流片縫那種凹進去的槽就被橋掉
    if y >= COWL_BAND_Y0:
        hull = []
        for i, (z, w) in enumerate(zip(zs, fixed)):
            while len(hull) >= 2:
                (z1, w1), (z2, w2) = hull[-2], hull[-1]
                if (z2 - z1) * (w - w1) - (w2 - w1) * (z - z1) >= 0: hull.pop()
                else: break
            hull.append((z, w))
        hz = [h[0] for h in hull]; hw = [h[1] for h in hull]
        for i, z in enumerate(zs):
            for k in range(len(hz) - 1):
                if hz[k] <= z <= hz[k + 1]:
                    f = (z - hz[k]) / (hz[k + 1] - hz[k]) if hz[k + 1] > hz[k] else 0
                    fixed[i] = hw[k] + (hw[k + 1] - hw[k]) * f; break
    fixed[0] = 0.0; fixed[-1] = 0.0
    return {'y': y, 'top': top, 'bot': bot, 'z': zs, 'w': fixed}
def resample(s, L=LEVELS):
    """把細掃的 (z, w) 重取樣成 L 級（餘弦分佈：頂底密）。回傳 [(w, z)] 由底到頂，不含頂底尖點。"""
    zs, ws = s['z'], s['w']; out = []
    for k in range(1, L + 1):
        t = k / (L + 1)
        zz = s['bot'] + (s['top'] - s['bot']) * (0.5 - 0.5 * math.cos(math.pi * t))
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
# 站間平滑（y 不等距的拉普拉斯，λ0.5 × 2，門檻 0.06：引擎罩唇、風擋那種真的階不抹）
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
rings = [ring_of(s) for s in STA]
bm = bmesh.new()
vs = loft(bm, rings)
front = cap(bm, vs[0]); fan(bm, vs[-1], TAIL_POLE)
finish(bm)
# 前封蓋 = 引擎罩開口裡的引擎面，塗黑
for f in bm.faces:
    if f.calc_center_median().y > FUS_Y[0] - 0.005: f.material_index = 1
fus = new_object('KI84_Fuselage', bm, [M_BODY, M_COCK])
LOG['fus_tris'] = sum(len(p.vertices) - 2 for p in fus.data.polygons)
LOG['fus_stations'] = [[round(s['y'], 2), round(s['top'], 3), round(s['bot'], 3), round(max(w for w, z in s['lv']), 3)] for s in STA]

# ═══════════════════════════ 2. 座艙：盒切玻璃 + 黑色內槽 ═══════════════════════════
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)
# 玻璃盒：前壁 y −0.56（風擋腳）、後壁 −2.72（玻璃末端）都垂直；底面是玻璃下緣那條斜線
# （前 z 0.795、後 0.715：艙前甲板 0.80、艙後甲板 0.72）
GLASS_Y0, GLASS_Y1 = -0.56, -2.72
SILL_F, SILL_R = 0.795, 0.715
gb = []
for x in (-1.2, 1.2):
    gb += [(x, GLASS_Y0, SILL_F), (x, GLASS_Y0, 2.0), (x, GLASS_Y1, SILL_R), (x, GLASS_Y1, 2.0)]
cut_glass = hull_object('Cut_Glass', gb, M_COCK)
# 內槽盒：|x| ≤ 0.20、y −2.55…−0.66、z 0.45…0.85
tb = [(sx * 0.20, y, z) for sx in (-1, 1) for y in (-2.55, -0.66) for z in (0.45, 0.85)]
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
glass = bpy.data.objects.new('KI84_Glass', fus.data.copy()); COLL.objects.link(glass)
boolean_apply(glass, cut_glass, 'INTERSECT')
# 刪掉封蓋（落在切割盒任何一個面的平面上、法線平行的面），其餘全改玻璃材質
bm = bmesh.new(); bm.from_mesh(glass.data); bm.normal_update()
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
boolean_apply(fus, cut_glass, 'DIFFERENCE')
boolean_apply(fus, cut_tub, 'DIFFERENCE')
LOG['fus_tris_after_cut'] = sum(len(p.vertices) - 2 for p in fus.data.polygons)

# ═══════════════════════════ 3. 整流罩、槳轂、槳葉 ═══════════════════════════
# 整流罩半徑逐站量參考模型（尖端 y 2.806、底 y 2.45 r 0.267）；底到引擎罩開口之間是 r 0.175 的槳轂
SPIN = [(2.806, 0.0), (2.75, 0.08), (2.72, 0.13), (2.70, 0.155), (2.66, 0.183), (2.62, 0.208), (2.58, 0.226),
        (2.54, 0.243), (2.50, 0.256), (2.45, 0.267)]
HUB_R, HUB_Y1 = 0.175, FUS_Y[0] - 0.02
bm = bmesh.new(); rings = []
for y, r in SPIN[1:]:
    rings.append([Vector((r * math.cos(2 * math.pi * j / 10), y, r * math.sin(2 * math.pi * j / 10))) for j in range(10)])
vs = loft(bm, rings)
fan(bm, list(reversed(vs[0])), Vector((0, SPIN[0][0], 0)))
cap(bm, vs[-1])
finish(bm)
spinner = new_object('KI84_Spinner', bm, [M_BODY])
bm = bmesh.new()
rings = [[Vector((HUB_R * math.cos(2 * math.pi * j / 10), y, HUB_R * math.sin(2 * math.pi * j / 10))) for j in range(10)] for y in (SPIN[-1][0] - 0.01, HUB_Y1)]   # 前封蓋藏進整流罩 1 cm，不與整流罩底共面
vs = loft(bm, rings); cap(bm, list(reversed(vs[0]))); cap(bm, vs[-1]); finish(bm)
hub = new_object('KI84_Hub', bm, [M_ACC])
PROP_Y, PROP_R, PROP_BLADES = 2.30, 1.52, 4
bm = bmesh.new()
for i in range(PROP_BLADES):
    ang = 2 * math.pi * i / PROP_BLADES + math.pi / 2
    r0, r1, hw, ht = HUB_R - 0.01, PROP_R, 0.075, 0.012
    c, s = math.cos(ang), math.sin(ang)
    pts = []
    for r in (r0, r1):
        for u in (-hw, hw):
            for t in (-ht, ht):
                pts.append(Vector((r * c - u * s, PROP_Y + t, r * s + u * c)))
    vv = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vv)
finish(bm)
prop = new_object('KI84_Prop', bm, [M_ACC])

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
def hull_line(fs, vals, upper):
    """(弦向分數, 高度) 的凸包：上表面取上凸包、下表面取下凸包。輪艙、砲管槽那種射線打進去的洞
    會被橋掉（翼剖面本來就是凸的）。"""
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
def fill_none(st_list):
    """某站某分數量不到就用鄰站同分數值補，再把上下表面各取凸包。"""
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    near = min(vals, key=lambda v: abs(v[0] - s['x']))
                    s[key][k] = near[1]
    for s in st_list:
        s['up'] = hull_line(FR, s['up'], True); s['dn'] = hull_line(FR, s['dn'], False)
    # 展向平滑（x 不等距的拉普拉斯，λ0.5 × 2）：翼是直線錐，每個弦向分數的高度沿展向該是直線；
    # 輪艙門邊之類的局部起伏（一站差 4 cm）就這樣抹掉
    for _ in range(2):
        new = []
        for i, s in enumerate(st_list):
            if i == 0 or i == len(st_list) - 1: new.append((s['up'], s['dn'])); continue
            a, b = st_list[i - 1], st_list[i + 1]
            t = (s['x'] - a['x']) / (b['x'] - a['x'])
            up = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['up'], a['up'], b['up'])]
            dn = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['dn'], a['dn'], b['dn'])]
            new.append((up, dn))
        for s, (up, dn) in zip(st_list, new): s['up'], s['dn'] = up, dn
# x 2.0 有砲管、0.8 是翼根整流罩，都跳過；翼尖 5.62
WX = [1.0, 1.3, 1.6, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.3, 5.5]
wst = [panel_station(WING, x, -0.70, 0.40, 3.0, -4.5, -0.85, 0.6) for x in WX]
fill_none(wst)
def extrap(a, b, x):
    t = (x - a['x']) / (b['x'] - a['x'])
    return {'x': x, 'le': a['le'] + (b['le'] - a['le']) * t, 'te': a['te'] + (b['te'] - a['te']) * t,
            'up': list(a['up']), 'dn': list(a['dn'])}
# 中央段：x 0 與 0.5 用 1.0 站的剖面，LE/TE 由 1.0/1.3 線性外推
wst = [extrap(wst[0], wst[1], 0.0), extrap(wst[0], wst[1], 0.5)] + wst
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
WING_TIP_X = 5.62
wing = build_panel('KI84_Wing', wst, WING_TIP_X, 0.5 * (tip['le'] + tip['te']) - 0.05, 0.5 * (tip['up'][3] + tip['dn'][3]))
wing['part'] = 'wing0'
LOG['wing_tris'] = sum(len(p.vertices) - 2 for p in wing.data.polygons)
LOG['wing_stations'] = [[s['x'], round(s['le'], 3), round(s['te'], 3), round(s['up'][3], 3), round(s['dn'][3], 3)] for s in wst]
area = 0
for a, b in zip(wst, wst[1:]):
    area += 0.5 * ((a['le'] - a['te']) + (b['le'] - b['te'])) * (b['x'] - a['x'])
area += 0.5 * (tip['le'] - tip['te']) * (WING_TIP_X - tip['x'])
LOG['wing_area'] = round(2 * area, 2)

# ═══════════════════════════ 5. 水平尾翼、垂尾 ═══════════════════════════
FR = FR_T
TX = [0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.15, 2.25]
tst = [panel_station(TAIL, x, 0.25, 0.60, -4.0, -8.0, 0.2, 0.7) for x in TX]
fill_none(tst)
tst = [extrap(tst[0], tst[1], 0.0)] + tst
tt = tst[-1]
tailplane = build_panel('KI84_Tailplane', tst, 2.28, 0.5 * (tt['le'] + tt['te']), 0.5 * (tt['up'][2] + tt['dn'][2]))
LOG['tail_tris'] = sum(len(p.vertices) - 2 for p in tailplane.data.polygons)
LOG['tail_stations'] = [[s['x'], round(s['le'], 3), round(s['te'], 3)] for s in tst]
# 垂尾：z 站位；剖面 = 半厚 rows（f 0.05…0.95）；根站 z 0.40 埋進尾錐，頂 1.61
FIN_Z = [0.40, 0.75, 0.90, 1.05, 1.20, 1.35, 1.50, 1.58]
FIN_TOP = 1.61
def fin_station(z):
    le = None; te = None
    for i in range(-8, 9):
        x = 0.004 * i
        h = hit(TAIL, (x, -4.8, z), (0, -1, 0))
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
r0 = dict(fst[0]); r0['z'] = FIN_Z[0]
t = (FIN_Z[0] - fst[0]['z']) / (fst[1]['z'] - fst[0]['z'])
r0['le'] = fst[0]['le'] + (fst[1]['le'] - fst[0]['le']) * t; r0['te'] = -7.10   # 方向舵下角
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
fan(bm, vs[-1], Vector((0, 0.5 * (top_s['le'] + top_s['te']), FIN_TOP)))
finish(bm)
fin = new_object('KI84_Fin', bm, [M_BODY])
LOG['fin_tris'] = sum(len(p.vertices) - 2 for p in fin.data.polygons)
LOG['fin_stations'] = [[s['z'], round(s['le'], 3), round(s['te'], 3)] for s in fst]

# ═══════════════════════════ 6. 滑油冷卻器進氣口（機腹小整流體，嘴塗黑） ═══════════════════════════
# 半橢圓剖面：(y, 半寬, 底)，量自參考模型；嘴在 y 1.34、尾在 0.64 收回腹線
SC = [(1.34, 0.18, -0.96), (1.30, 0.183, -0.97), (1.20, 0.195, -0.988), (1.10, 0.199, -0.995), (1.00, 0.198, -0.992),
      (0.90, 0.192, -0.984), (0.80, 0.179, -0.968), (0.70, 0.162, -0.948), (0.64, 0.12, -0.84)]
BELLY = -0.72
bm = bmesh.new(); rings = []
for y, a, zb in SC:
    zc = BELLY + 0.06     # 天花板埋進機身 6 cm
    b = zc - zb
    pts = []
    for j in range(10):
        th = math.pi * j / 9
        pts.append(Vector((a * math.cos(th), y, zc - b * math.sin(th))))
    pts.append(Vector((-a, y, zc))); pts.append(Vector((a, y, zc)))
    rings.append(pts)
vs = loft(bm, rings)
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
finish(bm)
for f in bm.faces:
    f.material_index = 1 if f.calc_center_median().y > SC[0][0] - 0.005 else 0
scoop = new_object('KI84_ChinScoop', bm, [M_BODY, M_COCK])
LOG['scoop_tris'] = sum(len(p.vertices) - 2 for p in scoop.data.polygons)

# ═══════════════════════════ 7. 玻璃框條（He 111 式：貼在玻璃外的細條，機身色） ═══════════════════════════
GB = bvh_of(['KI84_Glass'])
def strip_from_points(bm, pts, nrm, width, along):
    prev = None
    for p, n in zip(pts, nrm):
        q = p + n * 0.004
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            try: bm.faces.new([prev[0], prev[1], b, a])
            except ValueError: pass
        prev = (a, b)
def arch(bm, y_top, y_sill=None, width=0.028):
    """一道拱：頂在 y_top、艙緣在 y_sill（斜框）；射線在該斜面內由外向 (0, y, 0.62) 打。"""
    if y_sill is None: y_sill = y_top
    pts, nrm = [], []
    for j in range(15):
        th = -math.pi / 2 + math.pi * j / 14
        y0 = y_sill + (y_top - y_sill) * math.cos(th)
        d = Vector((-math.sin(th), 0, -math.cos(th)))
        o = Vector((0, y0, 0.62)) - d * 1.5
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
# 拱的位置量自參考玻璃板的縫（頂線、z 0.9 側線各掃一次）：風擋後框斜（頂 −0.875、艙緣 −0.695），
# 滑罩前框 −1.13、滑罩後框 −1.61、固定段框 −2.00、−2.36
bm = bmesh.new()
arch(bm, -0.875, -0.695)
for y0 in (-1.13, -1.61, -2.00, -2.36): arch(bm, y0)
for x0 in (-0.17, 0.17): rail(bm, x0, -0.90, -1.60)
# 風擋：兩根斜柱（x ±0.20，y −0.57 → −0.86）
for x0 in (-0.20, 0.20): rail(bm, x0, -0.57, -0.86, n=4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
frames = new_object('KI84_Frames', bm, [M_FRAME])
LOG['frame_tris'] = sum(len(p.vertices) - 2 for p in frames.data.polygons)

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('KI84_'):
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total
result = LOG
