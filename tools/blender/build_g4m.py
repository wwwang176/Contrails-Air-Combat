# -*- coding: utf-8 -*-
"""
G4M2 一式陸攻二四型：在 Blender 裡對著參考模型直接量、直接 loft（2026-09-03，A6M5 v3 的定案流程）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_g4m.py', encoding='utf-8').read())
沒有 Ref_Body 物件時會先把 ref/mitsubishi_g4m.glb 匯進來對齊（翼展 24.89、翼根四分之一
弦線在原點、機身最寬線在 z=0）；有就直接建。建完自己匯出：

    use_selection=True（只選 G4M_*）、export_yup=True、export_extras=True、export_apply=True

參考模型只有 1,524 個面、沒有玻璃、沒有座艙分件，只拿它量主翼、尾翼、發動機艙的位置與平面形；
尺寸以史實為準（G4M2 二四型：翼展 24.89、全長 19.63、翼面積 78.13 m²、四葉槳直徑 3.40）。
機身是解析式的橢圓剖面圓筒（寬 2.0、高 2.3，頭尾圓潤），座艙凸起、玻璃、垂尾照側視／俯視線框圖定。
砲塔圓罩與腰部玻璃球是貼在機身上的半橢球。

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\mitsubishi_g4m.glb"
SPAN = 24.89
WING_AREA_TARGET = 78.13     # 史實翼面積；參考模型的弦長偏短（量出來約 74），弦長等比放大到這個值

def import_and_align_ref():
    """匯入參考模型，烘 matrix_world，刪炸彈，轉到機體座標。只留量測要用的 Ref_*。"""
    O = bpy.data.objects
    keep = {'Fuselage1_Base_0': 'Ref_Body', 'pCube15_H1_0': 'Ref_PropR', 'pCube16_H1_0': 'Ref_PropL',
            'polySurface15_GD_0': 'Ref_ElevR', 'polySurface17_GD_0': 'Ref_ElevL', 'pCube3_GD_0': 'Ref_Rudder'}
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
    body = objs['Ref_Body']
    xs = [v.co.x for v in body.data.vertices]
    S = SPAN / (max(xs) - min(xs))                        # 翼展縮放（模型是 5 cm 的小東西，×476.6）
    R = Matrix.Rotation(math.pi, 4, 'Z')                   # 機首 −Y → +Y
    for o in objs.values(): o.data.transform(Matrix.Scale(S, 4) @ R)
    bm = bmesh.new(); bm.from_mesh(body.data); bmesh.ops.triangulate(bm, faces=bm.faces)
    T = BVHTree.FromBMesh(bm); bm.free()
    # 機身最寬線的高度 → z = 0（機身中段掃水平射線，取最寬那一列）
    ys = [v.co.y for v in body.data.vertices]; ymid = 0.5 * (max(ys) + min(ys))
    best = None
    for k in range(120):
        z = 1.0 + 0.04 * k
        h = T.ray_cast(Vector((1.55, ymid, z)), Vector((-1, 0, 0)), 4.0)[0]
        if h is not None and h.x < 1.3 and (best is None or h.x > best[0]): best = (h.x, z)
    az = best[1]
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((0, 0, -az))))
    bm = bmesh.new(); bm.from_mesh(body.data); bmesh.ops.triangulate(bm, faces=bm.faces)
    T = BVHTree.FromBMesh(bm); bm.free()                   # 平移之後重建量尺
    # 翼根四分之一弦：x 5.5 / 7.0 兩站（發動機艙與尾翼都打不到）射線量前後緣，線性外推到翼根 x 1.2
    def chord(x):
        le = te = None
        for k in range(200):
            z = -1.2 + 0.012 * k
            h = T.ray_cast(Vector((x, 12.0, z)), Vector((0, -1, 0)), 25.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -4.0, z)), Vector((0, 1, 0)), 25.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(5.5), chord(7.0)
    ex = lambda a, b: a + (b - a) * (1.2 - 5.5) / 1.5
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for o in objs.values(): o.data.transform(Matrix.Translation(Vector((0, -qc, 0))))

if 'Ref_Body' not in bpy.data.objects:
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
M_BODY = mat('G4M_Body', srgb(0x4b5a44))
M_ACC = mat('G4M_Accent', srgb(0x262829))
M_GLASS = mat('G4M_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('G4M_Cockpit', srgb(0x191d1a))
M_FRAME = mat('G4M_Frame', srgb(0x4b5a44))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('G4M_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('G4M')
if COLL is None:
    COLL = bpy.data.collections.new('G4M'); bpy.context.scene.collection.children.link(COLL)

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
BODY = bvh_of(['Ref_Body'])          # 參考模型整架是一個 mesh（機身、翼、艙、尾翼都在裡面）
def hit(T, o, d, L=30.0):
    return T.ray_cast(Vector(o), Vector(d), L)[0]
def zmax_at(T, x, y):
    h = hit(T, (x, y, 8.0), (0, 0, -1)); return h.z if h else None
def zmin_at(T, x, y):
    h = hit(T, (x, y, -8.0), (0, 0, 1)); return h.z if h else None
def halfw(T, y, z, x0):
    h = hit(T, (x0, y, z), (-1, 0, 0), 4.0); return h.x if h else None

# ───────────────────────── 通用 loft ─────────────────────────
def loft(bm, rings, close=True):
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
def tris_of(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

# ═══════════════════════════ 1. 機身 ═══════════════════════════
# 解析式旋成體，剖面是上下長的橢圓（半寬 R_MAX、半高 R_MAX·VSCALE）：
#   圓頭   機首尖起 NOSE_L 的半橢球，r = R·√(1−((L−d)/L)²)
#   直筒   r = R_MAX，到離機尾尖 3.8 m
#   尾錐   半徑表 TAIL_PROFILE（離機尾尖的距離 → r），量自機尾側視圖：前 1.5 m 收得慢、最後 2 m
#          收得急，到尾砲座底直徑 0.92，再接一個短圓錐
# 軸線：機首中心到機尾中心一直線 z = ZC0。
R_MAX, NOSE_L, ZC0 = 1.00, 3.4, -0.10
VSCALE = 1.15                # 剖面垂直拉伸：寬 2.0、高 2.3；座艙凸起與玻璃一起拉
NOSE_TIP_Y, TAIL_TIP_Y = 6.10, -13.65
FUS_LEN = NOSE_TIP_Y - TAIL_TIP_Y                                  # 19.75
TAIL_PROFILE = [(3.8, 1.00), (3.0, 0.98), (2.2, 0.90), (1.5, 0.78), (1.0, 0.64), (0.6, 0.52), (0.45, 0.46), (0.25, 0.36), (0.10, 0.25)]
NRING = 18                                                         # 每環 18 點
D_STA = [0.10, 0.30, 0.60, 1.00, 1.50, 2.00, 2.50, 2.55, 2.70, 2.90, 3.05, 3.60, 4.60, 5.15, 5.90, 6.70, 7.60, 8.50, 9.20, 9.60, 10.50, 12.00, 13.50, 15.00] + \
        [FUS_LEN - dt for dt, r in TAIL_PROFILE]                    # 機首尖起算
def r_of(d):
    if d < NOSE_L: return R_MAX * math.sqrt(max(0.0, 1 - ((NOSE_L - d) / NOSE_L) ** 2))
    dt = FUS_LEN - d
    if dt >= TAIL_PROFILE[0][0]: return R_MAX
    for (a, ra), (b, rb) in zip(TAIL_PROFILE, TAIL_PROFILE[1:]):
        if b <= dt <= a: return rb + (ra - rb) * (dt - b) / (a - b)
    return TAIL_PROFILE[-1][1]
def zc_of(d):
    return ZC0          # 軸線一直線
STA = [{'y': NOSE_TIP_Y - d, 'd': d, 'r': r_of(d), 'zc': zc_of(d)} for d in D_STA]
# 駕駛座凸起：只動中軸線以上。凸起 BULGE(y) 加在環的上半（垂直方向），下半仍是正圓。
# 頂線：風擋 3.55 → 3.05 陡升到 0.25，艙頂 3.05 → 0.20 平，0.20 → −3.50 緩降回圓筒（玻璃在 0.95 結束，
# 後面到 0.20 那段是平的機背整流）
BULGE_TBL = [(3.55, 0.0), (3.40, 0.13), (3.20, 0.24), (3.05, 0.25), (0.20, 0.25),
             (-0.60, 0.21), (-1.50, 0.14), (-2.40, 0.07), (-3.10, 0.02), (-3.50, 0.0)]   # (y, 凸起)
def bulge_of(y):
    if y >= BULGE_TBL[0][0] or y <= BULGE_TBL[-1][0]: return 0.0
    for (ya, ba), (yb, bb) in zip(BULGE_TBL, BULGE_TBL[1:]):
        if yb <= y <= ya: return bb + (ba - bb) * (y - yb) / (ya - yb)
    return 0.0
for s in STA: s['b'] = bulge_of(s['y'])
# 溫室剖面（上窄下寬的 U 字）：上半的曲線 = 圓弧（側面到艙緣）→ 向內斜的側壁 → 圓角 → 平頂；
# 整流段照凸起比例從這條曲線漸變回正圓（w = 凸起 / 最大凸起）
BULGE_MAX = max(b for y, b in BULGE_TBL)
CAN_HALF, CAN_WALL_TOP, CAN_CORNER = 0.85, 0.64, 0.12      # 艙緣半寬、艙頂處的側壁半寬、圓角半徑
def canopy_curve(r, zc, zt):
    """右側 (r, zc) 起、經艙緣、側壁、圓角、平頂到 (0, zt) 的折線（x, z），之後鏡射。"""
    zs = zc + math.sqrt(max(0.0, r * r - CAN_HALF * CAN_HALF))
    pts = []
    for k in range(5):                                       # 圓弧：角 0 → 艙緣
        a = math.asin((zs - zc) / r) * k / 4
        pts.append((r * math.cos(a), zc + r * math.sin(a)))
    pts.append((CAN_WALL_TOP, zt - CAN_CORNER))               # 側壁頂
    for k in range(1, 4):                                    # 圓角
        a = math.pi / 2 * k / 3
        pts.append((CAN_WALL_TOP - CAN_CORNER + CAN_CORNER * math.cos(a), zt - CAN_CORNER + CAN_CORNER * math.sin(a)))
    pts.append((0.0, zt))
    return pts
def sample_polyline(pts, t):
    """折線依弧長取樣，t 0…1。"""
    L = [0.0]
    for (x0, z0), (x1, z1) in zip(pts, pts[1:]): L.append(L[-1] + math.hypot(x1 - x0, z1 - z0))
    d = t * L[-1]
    for i in range(len(pts) - 1):
        if L[i] <= d <= L[i + 1]:
            f = (d - L[i]) / (L[i + 1] - L[i]) if L[i + 1] > L[i] else 0
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f)
    return pts[-1]
def ring_of(s):
    out = []
    curve = canopy_curve(s['r'], s['zc'], s['zc'] + s['r'] + s['b']) if s['b'] > 0 else None
    w = s['b'] / BULGE_MAX if s['b'] > 0 else 0.0
    for j in range(NRING):
        th = -math.pi / 2 + 2 * math.pi * j / NRING
        x, z = s['r'] * math.cos(th), s['zc'] + s['r'] * math.sin(th)
        if curve is not None and math.sin(th) > 0:
            t = th / math.pi                                 # 0 → 1：右側到左側
            side = 1 if t <= 0.5 else -1
            bx, bz = sample_polyline(curve, min(t, 1 - t) * 2)
            x = x * (1 - w) + side * bx * w; z = z * (1 - w) + bz * w
        out.append(Vector((x, s['y'], s['zc'] + (z - s['zc']) * VSCALE)))     # 橢圓：垂直拉高
    return out
rings = [ring_of(s) for s in STA]
bm = bmesh.new()
vs = loft(bm, rings)
fan(bm, list(reversed(vs[0])), Vector((0, NOSE_TIP_Y, ZC0))); fan(bm, vs[-1], Vector((0, TAIL_TIP_Y, zc_of(FUS_LEN))))
finish(bm)
fus = new_object('G4M_Fuselage', bm, [M_BODY, M_COCK])
LOG['fus_tris'] = tris_of(fus)
LOG['fus_stations'] = [[round(s['y'], 2), round(s['zc'], 3), round(s['r'], 3)] for s in STA]

# ═══════════════════════════ 2. 玻璃：盒切 ═══════════════════════════
# 參考模型沒有玻璃件，四塊玻璃的範圍是照真機照片定的（不是量的）：
#   機首罩   機首尖往後 2.0 m 整個剖面都是玻璃（y ≥ 4.10），後面那片黑色切面就是前隔框
#   尾砲座   機尾尖往前 1.45 m 整個剖面是玻璃（y ≤ −12.20）
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)
def box_pts(x0, x1, y0, y1, z0, z1):
    return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
NOSE_Y, TAIL_Y = 5.335, -13.05     # 機首玻璃 = 機首尖往後 0.77 m、尾砲座玻璃 = 機尾尖往前 0.6 m
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
def glass_from(name, src_mesh, cutter):
    """玻璃 = 機身 ∩ 盒；落在盒子任一面平面上、法線平行的面（封蓋）全刪 —— 它們與機身塗黑的切面共面，留著就閃爍。"""
    g = bpy.data.objects.new(name, src_mesh.copy()); COLL.objects.link(g)
    boolean_apply(g, cutter, 'INTERSECT')
    bm = bmesh.new(); bm.from_mesh(g.data); bm.normal_update()
    cb = bmesh.new(); cb.from_mesh(cutter.data); cb.normal_update()
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
    g.data.materials.clear(); g.data.materials.append(M_GLASS)
    bm.to_mesh(g.data); bm.free()
    LOG['caps_' + name] = len(kill); LOG['tris_' + name] = tris_of(g)
    return g
# 座艙玻璃：盒切，玻璃 = 機身 ∩ 盒、機身 = 機身 − 盒，切面帶 Cockpit 暗色就是黑色的艙內。
# 盒 y 0.95 → 前壁；前壁斜切：艙緣端 3.375、頂端 3.725；底 = 艙緣（機身在半寬 0.85 處的高度，0.52）
CANOPY_Y0, CANOPY_Y1 = 0.95, 3.725
CANOPY_SILL = ZC0 + math.sqrt(1 - CAN_HALF ** 2) * R_MAX * VSCALE + 0.01
CANOPY_Y1_LOW = 3.375
cut_canopy = hull_object('Cut_Canopy', [(x, y, z) for x in (-1.5, 1.5) for (y, z) in
                         ((CANOPY_Y0, CANOPY_SILL), (CANOPY_Y0, 2.5), (CANOPY_Y1_LOW, CANOPY_SILL), (CANOPY_Y1, 2.5))], M_COCK)
canopy = glass_from('G4M_Canopy', fus.data, cut_canopy)
boolean_apply(fus, cut_canopy, 'DIFFERENCE')
# 機首罩、尾砲座：整個剖面的淺盒切；機身留下的黑色切面就是隔框
cut_nose = hull_object('Cut_Nose', box_pts(-2, 2, NOSE_Y, 7.0, -2, 2), M_COCK)
cut_tail = hull_object('Cut_Tail', box_pts(-2, 2, -15.0, TAIL_Y, -2, 2), M_COCK)
nose_glass = glass_from('G4M_NoseGlass', fus.data, cut_nose)
tail_glass = glass_from('G4M_TailGlass', fus.data, cut_tail)
for c in (cut_nose, cut_tail): boolean_apply(fus, c, 'DIFFERENCE')
# 機鼻中上段的側窗：y 4.07…5.07、z ≥ −0.35 的盒切，跟前罩之間隔 0.27 m 金屬
NOSE2_Y0, NOSE2_Y1, NOSE2_Z = 4.07, 5.07, -0.35
cut_nose2 = hull_object('Cut_Nose2', box_pts(-2, 2, NOSE2_Y0, NOSE2_Y1, NOSE2_Z, 2.5), M_COCK)
nose_glass2 = glass_from('G4M_NoseGlass2', fus.data, cut_nose2)
boolean_apply(fus, cut_nose2, 'DIFFERENCE')
LOG['fus_tris_after_cut'] = tris_of(fus)

# 機頂圓玻璃：半橢球，底貼在該站的機背上。背部砲塔圓罩在機首尖後 8.95 m（側視線框圖）
def fus_top(y0):
    s = min(STA, key=lambda s: abs(s['y'] - y0))
    return s['zc'] + (s['r'] + s['b']) * VSCALE
def dome(name, y0, r, h, n=12):
    z0 = fus_top(y0) - 0.03
    bm = bmesh.new(); rings = []
    for k in range(1, 4):
        th = math.pi / 2 * (1 - k / 4)
        rings.append([Vector((r * math.cos(th) * math.cos(2 * math.pi * j / n), y0 + r * math.cos(th) * math.sin(2 * math.pi * j / n), z0 + h * math.sin(th))) for j in range(n)])
    rings.append([Vector((r * math.cos(2 * math.pi * j / n), y0 + r * math.sin(2 * math.pi * j / n), z0)) for j in range(n)])
    vs = loft(bm, rings)
    fan(bm, list(reversed(vs[0])), Vector((0, y0, z0 + h)))
    finish(bm)
    ob = new_object(name, bm, [M_GLASS]); LOG['tris_' + name] = tris_of(ob); return ob
turret = dome('G4M_Turret', NOSE_TIP_Y - 8.95, 0.50, 0.42)

# 腰部玻璃球（主翼後方、機身兩側）：半橢球，底貼機身側面。位置量自側視線框圖：中心在機首尖後
# 11.35 m、軸線下 0.05；長 1.4、高 0.55、外凸 0.25
BLISTER_Y, BLISTER_Z, BLISTER_RY, BLISTER_RZ, BLISTER_H = NOSE_TIP_Y - 11.35, ZC0 - 0.05, 0.70, 0.28, 0.25
def side_dome(name, side, y0, z0, ry, rz, h, n=12):
    xs = side * (R_MAX * math.sqrt(max(0.0, 1 - ((z0 - ZC0) / (R_MAX * VSCALE)) ** 2)) - 0.03)   # 機身側面（埋 3 cm）
    bm = bmesh.new(); rings = []
    for k in range(1, 4):
        th = math.pi / 2 * (1 - k / 4)
        rings.append([Vector((xs + side * h * math.sin(th), y0 + ry * math.cos(th) * math.cos(2 * math.pi * j / n), z0 + rz * math.cos(th) * math.sin(2 * math.pi * j / n))) for j in range(n)])
    rings.append([Vector((xs, y0 + ry * math.cos(2 * math.pi * j / n), z0 + rz * math.sin(2 * math.pi * j / n))) for j in range(n)])
    vs = loft(bm, rings)
    fan(bm, list(reversed(vs[0])), Vector((xs + side * h, y0, z0)))
    finish(bm)
    bm.normal_update()
    if sum(f.normal.x for f in bm.faces) * side < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)   # 法線朝外
    ob = new_object(name, bm, [M_GLASS]); LOG['tris_' + name] = tris_of(ob); return ob
blister_r = side_dome('G4M_BlisterR', 1, BLISTER_Y, BLISTER_Z, BLISTER_RY, BLISTER_RZ, BLISTER_H)
blister_l = side_dome('G4M_BlisterL', -1, BLISTER_Y, BLISTER_Z, BLISTER_RY, BLISTER_RZ, BLISTER_H)

# ═══════════════════════════ 3. 主翼（一整片，穿過機身與發動機艙） ═══════════════════════════
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
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    near = min(vals, key=lambda v: abs(v[0] - s['x']))
                    s[key][k] = near[1]
def extrap(a, b, x):
    """由 a、b 兩站線性外推（LE、TE、上下表面全部線性 —— 參考模型的翼是平底直線錐）。"""
    t = (x - a['x']) / (b['x'] - a['x'])
    L = lambda p, q: p + (q - p) * t
    return {'x': x, 'le': L(a['le'], b['le']), 'te': L(a['te'], b['te']),
            'up': [L(p, q) for p, q in zip(a['up'], b['up'])], 'dn': [L(p, q) for p, q in zip(a['dn'], b['dn'])]}
# 乾淨的站：5.5 起（發動機艙 2.1…3.8 會擋前緣、x<5 的後緣射線會打到水平尾翼）
WX = [5.5, 7.0, 8.5, 10.0, 11.0, 11.8, 12.2]
wst = [panel_station(BODY, x, -1.6, 1.6, 12.0, -6.0, -2.0, 2.0) for x in WX]
fill_none(wst)
inner = [extrap(wst[0], wst[1], x) for x in (0.0, 1.0, 2.0, 4.0)]
wst = inner + wst
# 翼面積（梯形逐段，含機身蓋住的部分）→ 弦長等比放大到史實值，繞四分之一弦線縮放（對齊點不動）
def planform_area(sts, tip_x):
    a = 0
    for p, q in zip(sts, sts[1:]): a += 0.5 * ((p['le'] - p['te']) + (q['le'] - q['te'])) * (q['x'] - p['x'])
    a += 0.5 * (sts[-1]['le'] - sts[-1]['te']) * (tip_x - sts[-1]['x'])
    return 2 * a
TIP_X = SPAN / 2
area0 = planform_area(wst, TIP_X)
K = WING_AREA_TARGET / area0
for s in wst:
    c = s['le'] - s['te']; qc = s['le'] - 0.25 * c
    s['le'] = qc + 0.25 * c * K; s['te'] = qc - 0.75 * c * K
LOG['wing_area_measured'] = round(area0, 2); LOG['wing_chord_scale'] = round(K, 4)
LOG['wing_area'] = round(planform_area(wst, TIP_X), 2)
def section_pts(s):
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
wing = build_panel('G4M_Wing', wst, TIP_X, 0.5 * (tip['le'] + tip['te']) - 0.10, 0.5 * (tip['up'][4] + tip['dn'][4]))
wing['part'] = 'wing0'
LOG['wing_tris'] = tris_of(wing)
LOG['wing_root'] = [round(wst[0]['le'], 3), round(wst[0]['te'], 3), round(wst[0]['up'][4], 3), round(wst[0]['dn'][4], 3)]
LOG['wing_tip'] = [round(tip['le'], 3), round(tip['te'], 3), round(tip['up'][4], 3), round(tip['dn'][4], 3)]

# ═══════════════════════════ 4. 水平尾翼、垂尾 ═══════════════════════════
# 參考模型的尾翼是 10 cm 的薄板，只量平面形；厚度給 NACA 00xx 對稱翼型（水平尾翼 10%、垂尾 8%）
def naca_t(f, tc):
    return 5 * tc * (0.2969 * math.sqrt(max(f, 0)) - 0.1260 * f - 0.3516 * f ** 2 + 0.2843 * f ** 3 - 0.1015 * f ** 4)
FR = FR_T
TP_Z, TP_TE, TP_TC = 0.30, -12.60, 0.10      # 中線高、升降舵後緣（側視線框圖：翼根在 z 0.2…0.36、−10.3…−12.6）、厚弦比
TP_SHIFT = -0.20                              # 參考模型的前緣比線框圖前 0.2，整片往後挪
TX = [1.0, 2.0, 3.0, 3.6, 4.0, 4.3, 4.55, 4.75, 4.9, 5.0]   # 0.5 站的射線會從機身裡面打到機背，不用
TP_TIP_X, TP_ROUND_X0, TP_ROUND_K = 5.05, 3.7, 0.5   # 翼尖；從這裡起弦長收斂：c·(1−K + K·√(1−u²))，K=1 是完整橢圓
def tp_station(x):
    le, _ = chord_fine(BODY, x, 0.30, 0.80, -9.0, -14.0)
    return le
tle = [tp_station(x) for x in TX]
for i, v in enumerate(tle):
    if v is None: tle[i] = tle[i - 1]
tst = []
tle = [v + TP_SHIFT for v in tle]
le0 = tle[0] + (tle[0] - tle[1]) * 1.0     # x=0：由 1.0/2.0 外推
for x, le in zip([0.0] + TX, [le0] + tle):
    c = le - TP_TE; mid = le - 0.5 * c; te = TP_TE
    if x > TP_ROUND_X0:
        u = (x - TP_ROUND_X0) / (TP_TIP_X - TP_ROUND_X0)
        c = c * (1 - TP_ROUND_K + TP_ROUND_K * math.sqrt(max(0.0, 1 - u * u))); le = mid + 0.5 * c; te = mid - 0.5 * c
    tst.append({'x': x, 'le': le, 'te': te, 'up': [TP_Z + c * naca_t(f, TP_TC) for f in FR], 'dn': [TP_Z - c * naca_t(f, TP_TC) for f in FR]})
tt = tst[-1]
tailplane = build_panel('G4M_Tailplane', tst, TP_TIP_X, 0.5 * (tt['le'] + tt['te']), TP_Z)
LOG['tail_tris'] = tris_of(tailplane)
LOG['tail_le'] = [round(v, 3) for v in [le0] + tle]
# 垂尾：輪廓逐列量自整機側視線框圖（機首尖 → 尾砲座末端當 19.97 m 定比例，軸線列對 z −0.10）：
# 前緣 45° 後掠、方向舵後緣由根站 −13.32 往上前傾到 −12.47、頂圓；根站 z 0.50 埋進機身，
# 方向舵下緣在尾錐頂上方，露出的那一小段根封蓋就是舵的下緣
FIN_ROWS = [(0.50, -8.75, -13.35), (0.81, -8.97, -13.32), (1.10, -9.27, -13.29), (1.38, -9.53, -13.24), (1.67, -9.81, -13.16),
            (1.96, -10.08, -13.09), (2.25, -10.37, -13.02), (2.54, -10.64, -12.95), (2.82, -10.92, -12.88),
            (3.11, -11.20, -12.76), (3.26, -11.39, -12.66), (3.40, -11.65, -12.47)]
FIN_TC, FIN_TOP = 0.08, 3.48
rings = []
for z, le, te in FIN_ROWS:
    c = le - te
    pts = [Vector((0, le, z))]
    for f in FR: pts.append(Vector((c * naca_t(f, FIN_TC), le - c * f, z)))
    pts.append(Vector((0, te, z)))
    for f in reversed(FR): pts.append(Vector((-c * naca_t(f, FIN_TC), le - c * f, z)))
    rings.append(pts)
bm = bmesh.new()
vs = loft(bm, rings)
cap(bm, list(reversed(vs[0])))
fan(bm, vs[-1], Vector((0, 0.5 * (FIN_ROWS[-1][1] + FIN_ROWS[-1][2]), FIN_TOP)))
finish(bm)
fin = new_object('G4M_Fin', bm, [M_BODY])
LOG['fin_tris'] = tris_of(fin)

# ═══════════════════════════ 5. 發動機艙、鼻帽、槳 ═══════════════════════════
# 圓剖面，半徑逐站量參考模型（艙軸 (±2.95, −0.24) 的徑向射線，取正上/正下兩條的平均）；
# 前封蓋塗黑就是引擎面，艙尾收成一點
NAC_X, NAC_Z = 2.95, -0.24
NAC_Y = [2.98, 2.85, 2.55, 2.10, 1.60, 1.10, 0.75, 0.40, 0.0, -0.40, -0.80, -1.10, -1.40, -1.70, -1.95]   # 量測站（參考模型座標）
NAC_EXT = [(-2.35, 0.43), (-2.80, 0.33), (-3.15, 0.20)]    # 參考模型的艙尾之後補的三環（判斷值）
NAC_POLE_Y = -3.35
# 量測站到成品的縱向映射：y → 0.8·y + 0.69（前唇 3.07、艙尾 −1.99），半徑不變
NAC_Y_SCALE, NAC_Y_SHIFT = 0.8, 0.6901
def nac_y(y): return y * NAC_Y_SCALE + NAC_Y_SHIFT
def nac_r(y):
    rs = []
    for d in (Vector((0, 0, 1)), Vector((0, 0, -1)), Vector((-1, 0, 0))):
        o = Vector((NAC_X, y, NAC_Z)) + d * 1.6
        h = hit(BODY, o, -d, 1.6)
        if h is not None:
            r = (Vector((h.x, 0, h.z)) - Vector((NAC_X, 0, NAC_Z))).length
            if r < 1.0: rs.append(r)
    return min(rs) if rs else None     # 上方會打到主翼上表面，取最小的那條
NAC_R = [nac_r(y) for y in NAC_Y]
for i, r in enumerate(NAC_R):
    if r is None: NAC_R[i] = NAC_R[i - 1] * 0.9
LOG['nacelle_r'] = [[y, round(r, 3)] for y, r in zip(NAC_Y, NAC_R)]
NSEG = 14
def circle(cx, cz, y, r, n=NSEG):
    return [Vector((cx + r * math.cos(2 * math.pi * j / n), y, cz + r * math.sin(2 * math.pi * j / n))) for j in range(n)]
SPIN = [(3.76, 0.0), (3.72, 0.07), (3.62, 0.15), (3.45, 0.23), (3.25, 0.28), (3.05, 0.30)]
PROP_Y, PROP_R, PROP_BLADES = 3.37, 1.70, 4          # 二四型四葉槳直徑 3.40（參考模型與照片都是四葉）
for side, sx in (('R', 1), ('L', -1)):
    cx = sx * NAC_X
    bm = bmesh.new()
    rings = [circle(cx, NAC_Z, nac_y(y), r) for y, r in list(zip(NAC_Y, NAC_R)) + NAC_EXT]
    vs = loft(bm, rings)
    cap(bm, list(reversed(vs[0])))
    fan(bm, vs[-1], Vector((cx, nac_y(NAC_POLE_Y), NAC_Z)))
    finish(bm)
    for f in bm.faces:
        f.material_index = 1 if f.calc_center_median().y > nac_y(NAC_Y[0]) - 0.005 else 0      # 前封蓋 = 引擎面，塗黑
    nac = new_object(f'G4M_Nacelle{side}', bm, [M_BODY, M_COCK])
    LOG[f'nacelle_{side}_tris'] = tris_of(nac)
    bm = bmesh.new()
    rings = [circle(cx, NAC_Z, y, r, 10) for y, r in SPIN[1:]]
    vs = loft(bm, rings)
    fan(bm, list(reversed(vs[0])), Vector((cx, SPIN[0][0], NAC_Z)))
    cap(bm, vs[-1])
    finish(bm)
    new_object(f'G4M_Spinner{side}', bm, [M_BODY])
    bm = bmesh.new()
    for i in range(PROP_BLADES):
        ang = 2 * math.pi * i / PROP_BLADES + math.pi / 2
        r0, r1, hw, ht = 0.26, PROP_R, 0.11, 0.02
        c, s_ = math.cos(ang), math.sin(ang)
        pts = []
        for r in (r0, r1):
            for u in (-hw, hw):
                for t in (-ht, ht):
                    pts.append(Vector((cx + r * c - u * s_, PROP_Y + t, NAC_Z + r * s_ + u * c)))
        vv = [bm.verts.new(p) for p in pts]
        bmesh.ops.convex_hull(bm, input=vv)
    finish(bm)
    new_object(f'G4M_Prop{1 if sx > 0 else 2}', bm, [M_ACC])

# ═══════════════════════════ 7. 玻璃框條（He 111 式：貼在玻璃外的細條，機身色） ═══════════════════════════
FW = 0.035
def strip_from_points(bm, pts, nrm, width, along):
    prev = None
    for p, n in zip(pts, nrm):
        q = p + n * 0.005
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            try: bm.faces.new([prev[0], prev[1], b, a])
            except ValueError: pass
        prev = (a, b)
def ring_strip(bm, T, y0, zc, n=24, width=FW):
    """整圈：在 x-z 平面上由外向內打 n 條射線到玻璃件，沿 y 給寬度。"""
    pts, nrm = [], []
    for j in range(n + 1):
        th = 2 * math.pi * j / n
        d = Vector((-math.cos(th), 0, -math.sin(th)))
        o = Vector((0, y0, zc)) - d * 3.0
        r = T.ray_cast(o, d, 6.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))
def meridian(bm, T, th, y_from, y_to, zc, n=10, width=FW):
    """沿 y 的一條：固定角度 th（x-z 平面），由外向內打射線到玻璃件。"""
    d = Vector((-math.cos(th), 0, -math.sin(th)))
    along = Vector((math.sin(th), 0, -math.cos(th)))
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        o = Vector((0, y, zc)) - d * 3.0
        r = T.ray_cast(o, d, 6.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, along)
def arch(bm, T, y0, zc, width=FW):
    pts, nrm = [], []
    for j in range(17):
        th = -math.pi / 2 + math.pi * j / 16
        d = Vector((-math.sin(th), 0, -math.cos(th)))
        o = Vector((0, y0, zc)) - d * 3.0
        r = T.ray_cast(o, d, 6.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))
def rail(bm, T, x0, y_from, y_to, width=FW, n=8):
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = T.ray_cast(Vector((x0, y, 5.0)), Vector((0, 0, -1)), 8.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((1, 0, 0)))
bm = bmesh.new()
GC = bvh_of(['G4M_Canopy'])
for y0 in (1.25, 1.70, 2.15, 2.60, 3.05): arch(bm, GC, y0, 0.40)                # 五道拱（側視線框圖的框距約 0.45）
for x0 in (-0.48, 0.0, 0.48): rail(bm, GC, x0, CANOPY_Y0 + 0.05, CANOPY_Y1 - 0.05, n=12)   # 三根縱軌：外側兩根在平頂邊緣，跟中央軌同高（U 字）
GN = bvh_of(['G4M_NoseGlass'])
ring_strip(bm, GN, NOSE_Y + 0.45, ZC0)
for k in range(8): meridian(bm, GN, math.pi / 4 * k, NOSE_Y + 0.02, NOSE_TIP_Y - 0.12, ZC0, n=6)   # 八條經線
GN2 = bvh_of(['G4M_NoseGlass2'])
for y0 in (4.40, 4.74): arch(bm, GN2, y0, ZC0)                                  # 側窗：兩道拱
for x0 in (-0.72, 0.0, 0.72): rail(bm, GN2, x0, NOSE2_Y0 + 0.03, NOSE2_Y1 - 0.03, n=6)   # 三根縱軌（頂、兩肩）
GT = bvh_of(['G4M_TailGlass'])
ring_strip(bm, GT, TAIL_Y - 0.28, ZC0)
for th in (0.0, math.pi / 2, math.pi, 1.5 * math.pi): meridian(bm, GT, th, TAIL_Y - 0.02, TAIL_TIP_Y + 0.10, ZC0, n=5)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
frames = new_object('G4M_Frames', bm, [M_FRAME])
LOG['frame_tris'] = tris_of(frames)

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('G4M_'):
        n = tris_of(ob); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total
result = LOG
