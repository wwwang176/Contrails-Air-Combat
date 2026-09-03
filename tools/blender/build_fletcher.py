# -*- coding: utf-8 -*-
"""
USS Fletcher DD-445：在 Blender 裡對著參考模型直接量、直接 loft（2026-09-03）。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_fletcher.py', encoding='utf-8').read())
沒有 Ref_Fletcher 時會先把 ref/uss_fletcher.glb 匯進來對齊；有就直接建。

座標與 Essex 同一套：Blender X 橫向（+X 右舷）、+Y 艦首、Z 上，原點在水線 ×
艦體中點 × 中線；export_yup 之後是遊戲的 X 橫向、Y 上、−Z 艦首。

【對齊怎麼實證的】參考模型原始朝向是艦首 −Y，三條獨立證據：
  刀口   y −54 那一站的水線半寬只有 0.21，y +54 那一端還有 3.29（方尾）
  桅位   中線最高點 25.59 在 y −14，離該端 42 m（全長的 37%）——前桅在艦橋後，
         驅逐艦不會把桅杆放在艦體後三分之一
  舷弧   甲板由該端的 5.83 一路降到另一端的 2.69；平甲板艦的舷弧往艦首升
繞 Z 轉 180° 之後艦首 +Y。艦島那條證據對驅逐艦不成立（左右對稱），所以改用
這三條。

【尺寸：史實優先】以史實全長 114.75 m（376 ft 5 in）均勻縮放（×1.0203）之後，
量到的最大半寬 6.16 對史實艦寬 12.065 m（39 ft 7 in）的一半大 2.2%，依
aircraft-from-reference 坑 21 把船體半寬整體乘 0.979 收回去。吃水量到 3.97
對史實平均吃水 4.19 少 5%：參考模型的水線就畫在 z 0，不動它（船浮在海面上，
差的那 22 cm 在水線下）。

【與 Essex 的差別】這是平甲板驅逐艦：**甲板就是船體的頂**，不是懸在走廊上的
另一片。所以不做獨立的甲板物件，直接把 loft 頂面那一圈的材質換成甲板色 ——
Essex 那條「甲板／走廊／船體三片互相搶深度」的問題鏈在這裡整條不存在。
"""
import bpy, bmesh, math, statistics
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\uss_fletcher.glb"
LOA = 114.75          # 史實全長 376 ft 5 in
BEAM = 12.065         # 史實艦寬 39 ft 7 in
# 鋼索天線：三角形 < 200 而縱向跨度 > 全長 30% 的三件。**排掉它們還不夠** ——
# 這個模型是按材質合併的（60 個 mesh 全叫 Object_NN、材質名是 UUID），主桅到
# 艦尾的天線索跟船殼鋼板同屬 Object_108，排不掉。判讀量測結果時要自己認出來：
# 中線縱剖在 y −13.5…−4 是一條斜率固定 1.09/m 的直線，而 |x| 只有幾公分。
WIRES = {'Object_100', 'Object_102', 'Object_114'}


def import_and_align_ref():
    """匯入參考模型，烘 matrix_world，排掉鋼索，縮放、轉正、平移到艦體座標。"""
    O = bpy.data.objects
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()
    new = [o for o in O if o.name not in before]
    bm = bmesh.new()
    for o in new:
        if o.type == 'MESH' and o.name not in WIRES:
            me = o.data.copy(); me.transform(o.matrix_world.copy())
            bm.from_mesh(me); bpy.data.meshes.remove(me)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new('Ref_Fletcher')
    bm.to_mesh(me); bm.free()
    ref = bpy.data.objects.new('Ref_Fletcher', me)
    bpy.context.scene.collection.objects.link(ref)
    ys = [v.co.y for v in me.vertices]
    S = LOA / (max(ys) - min(ys))                      # ×1.0203
    me.transform(Matrix.Scale(S, 4) @ Matrix.Rotation(math.pi, 4, 'Z'))
    ys = [v.co.y for v in me.vertices]
    me.transform(Matrix.Translation(Vector((0, -(max(ys) + min(ys)) / 2, 0))))
    return ref


if 'Ref_Fletcher' not in bpy.data.objects:
    import_and_align_ref()
O = bpy.data.objects
LOG = {}


# ───────────────────────── 材質 ─────────────────────────
def srgb(h):
    r, g, b = ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


def mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.75
    m.diffuse_color = (*rgb, 1.0)      # Workbench 算圖看的是這個
    return m


M_BODY = mat('FLETCHER_Body', srgb(0x565f66))    # 舷側灰（Measure 21 海軍灰）
M_DECK = mat('FLETCHER_Deck', srgb(0x3b3b39))    # 鋼甲板
M_ACC = mat('FLETCHER_Accent', srgb(0x2b2e30))   # 砲、魚雷、桅、射控

# ───────────────────────── 場景 ─────────────────────────
for o in list(O):
    if o.name.startswith('FLETCHER_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('FLETCHER')
if COLL is None:
    COLL = bpy.data.collections.new('FLETCHER'); bpy.context.scene.collection.children.link(COLL)


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    return ob


# ───────────────────────── 量尺 ─────────────────────────
bm = bmesh.new()
bm.from_mesh(O['Ref_Fletcher'].data)
bmesh.ops.triangulate(bm, faces=bm.faces)
REF = BVHTree.FromBMesh(bm)
bm.free()


def hit(o_, d_, L=300.0):
    return REF.ray_cast(Vector(o_), Vector(d_).normalized(), L)[0]


def top_at(x, y, z0=45.0):
    h = hit((x, y, z0), (0, 0, -1), z0 + 25.0)
    return h.z if h else None


def bottom_at(x, y):
    h = hit((x, y, -25.0), (0, 0, 1))
    return h.z if h else None


def halfw(y, z):
    """該站該高度的半寬：左右各打一條，取有值的較大者（船體本來就對稱）。"""
    w = []
    for sgn in (1, -1):
        h = hit((sgn * 30.0, y, z), (-sgn, 0, 0))
        if h is not None:
            w.append(abs(h.x))
    return max(w) if w else None


def top_in(y0, y1, xr, cap, floor=2.0, stat='median', xc=0.0):
    """窗口內、`cap` 以下的頂面高度。

    `cap` 是必要的：由 z 45 往下打，中線在 y −13.5…−4（原始座標）打到的是天線
    索、在煙囪那一段打到的是煙囪頂。給一個略高於目標的上限就跳得過去。

    **細長件要用 `stat='max'`**：砲管半徑只有 0.15，五分之三的取樣射線從旁邊
    穿過去打到甲板，中位數因此讀成甲板高度（實測五根砲管全部低了 2～3 m）。
    窗口裡只有那一根時取最大值才對。
    """
    zs = []
    n = max(2, int((y1 - y0) / 0.25))
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        for f in (-0.75, -0.35, 0.0, 0.35, 0.75):
            z = top_at(xc + xr * f, y, cap)
            if z is not None and floor < z < cap:
                zs.append(z)
    if not zs:
        return None
    if stat == 'max':
        return round(max(zs), 2)
    if stat == 'p85':          # 煙囪頂上還有蒸汽管，取最大值會被它拉高 0.8
        return round(sorted(zs)[int(0.85 * (len(zs) - 1))], 2)
    return round(statistics.median(zs), 2)


# ───────────────────────── 通用幾何 ─────────────────────────
def loft(bm, rings, close=True):
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for a, b in zip(vs, vs[1:]):
        for j in (range(n) if close else range(n - 1)):
            k = (j + 1) % n
            q = [a[j], a[k], b[k], b[j]]
            if len(set(q)) < 4:
                continue
            try:
                bm.faces.new(q)
            except ValueError:
                pass
    return vs


def cap(bm, verts, reverse=False):
    vv = list(reversed(verts)) if reverse else list(verts)
    seen, uniq = set(), []
    for v in vv:
        if v not in seen:
            seen.add(v); uniq.append(v)
    if len(uniq) < 3:
        return
    try:
        bm.faces.new(uniq)
    except ValueError:
        pass


def box(bm, x0, x1, y0, y1, z0, z1):
    p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    v = [bm.verts.new(q) for q in p]
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        try:
            bm.faces.new([v[i] for i in f])
        except ValueError:
            pass


def hex_ring(bm, cx, cy, r, t, z0, z1):
    """六邊形的環 = 開口的圓形砲座護牆（低多邊形下六邊就夠圓）。"""
    ang = [math.pi / 6 + i * math.pi / 3 for i in range(6)]
    out = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in ang]
    inn = [(cx + (r - t) * math.cos(a), cy + (r - t) * math.sin(a)) for a in ang]
    vo0 = [bm.verts.new((px, py, z0)) for px, py in out]
    vo1 = [bm.verts.new((px, py, z1)) for px, py in out]
    vi0 = [bm.verts.new((px, py, z0)) for px, py in inn]
    vi1 = [bm.verts.new((px, py, z1)) for px, py in inn]
    for i in range(6):
        j = (i + 1) % 6
        for f in ([vo0[i], vo0[j], vo1[j], vo1[i]], [vi0[j], vi0[i], vi1[i], vi1[j]],
                  [vo1[i], vo1[j], vi1[j], vi1[i]], [vi0[i], vi0[j], vo0[j], vo0[i]]):
            try:
                bm.faces.new(f)
            except ValueError:
                pass


def hex_prism(bm, cx, cy, r, z0, z1):
    """六邊柱（圓形砲座的托座本體）。"""
    ang = [math.pi / 6 + i * math.pi / 3 for i in range(6)]
    p = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in ang]
    v0 = [bm.verts.new((px, py, z0)) for px, py in p]
    v1 = [bm.verts.new((px, py, z1)) for px, py in p]
    for i in range(6):
        j = (i + 1) % 6
        try:
            bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
        except ValueError:
            pass
    for f in (v0, list(reversed(v1))):
        try:
            bm.faces.new(list(f))
        except ValueError:
            pass


def tri_rod(bm, p0, p1, r):
    """任意方向的細長三角柱（斜著朝外上方的防空砲管）。

    `tri_barrel` 只做沿 Y 的，防空砲管朝外斜上，要這一支。**兩端都要埋進砲身
    裡** —— 軸心放在砲身頂之上就是一根浮在空中的棒子。
    """
    d = Vector(p1) - Vector(p0)
    if d.length < 1e-6:
        return
    d.normalize()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((0, 1, 0))
    a1 = d.cross(up).normalized()
    a2 = d.cross(a1).normalized()
    off = [a1 * (r * math.cos(math.pi / 2 + k * 2 * math.pi / 3))
           + a2 * (r * math.sin(math.pi / 2 + k * 2 * math.pi / 3)) for k in range(3)]
    v0 = [bm.verts.new(Vector(p0) + o) for o in off]
    v1 = [bm.verts.new(Vector(p1) + o) for o in off]
    for i in range(3):
        j = (i + 1) % 3
        try:
            bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
        except ValueError:
            pass
    for f in (v0, list(reversed(v1))):
        try:
            bm.faces.new(list(f))
        except ValueError:
            pass


def taper(bm, x0, x1, y0, y1, z0, z1, shrink, dy=0.0):
    """上小下大的錐台（甲板室、煙囪、桅、砲塔）。`dy` 是頂面往 +Y 的偏移：
    往艦尾傾的煙囪與桅要給**負值**。"""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    lo = [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]
    hi = [(cx + (px - cx) * shrink, cy + (py - cy) * shrink + dy) for px, py in lo]
    vl = [bm.verts.new((px, py, z0)) for px, py in lo]
    vh = [bm.verts.new((px, py, z1)) for px, py in hi]
    for i in range(4):
        j = (i + 1) % 4
        try:
            bm.faces.new([vl[i], vl[j], vh[j], vh[i]])
        except ValueError:
            pass
    for f in (vl, vh):
        try:
            bm.faces.new(list(f))
        except ValueError:
            pass


def tri_barrel(bm, x_c, z_c, y0, y1, r):
    """砲管：沿 Y 的細長三角柱（負責人指定的形狀）。轉 30° 之後沒有水平面。"""
    ang = (0.0, math.pi * 2 / 3, math.pi * 4 / 3)
    pts = [(x_c + r * math.cos(a), z_c + r * math.sin(a)) for a in ang]
    v0 = [bm.verts.new((px, y0, pz)) for px, pz in pts]
    v1 = [bm.verts.new((px, y1, pz)) for px, pz in pts]
    for i in range(3):
        j = (i + 1) % 3
        try:
            bm.faces.new([v0[i], v0[j], v1[j], v1[i]])
        except ValueError:
            pass
    for f in (v0, list(reversed(v1))):
        try:
            bm.faces.new(f)
        except ValueError:
            pass


def finish(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ═══════════════════════ 1. 船體 ═══════════════════════
# 站位：艦首艦尾加密（線型變化快），舯段放疏。
HULL_Y = ([57.4, 57.0, 56.5, 55.9, 55.0, 54.0, 52.6, 51.0, 49.0, 46.5, 44.0, 41.0, 38.0, 34.5, 31.0]
          + [27.0, 23.0, 19.0, 15.0, 11.0, 7.0, 3.0, -1.0, -5.0, -9.0, -13.0, -17.0, -21.0]
          + [-25.0, -29.0, -33.0, -37.0, -41.0, -44.5, -47.5, -50.0, -52.0, -53.8, -55.2, -56.3, -56.9])
LEV = [0.0, 0.05, 0.12, 0.21, 0.32, 0.45, 0.60, 0.78, 1.0]   # 由龍骨到甲板的比例
_wm = max(w for w in (halfw(y, z) for y in (-6.0, -2.0, 2.0, 6.0, 10.0)
                      for z in (1.0, 1.5, 2.0, 2.5)) if w)
W_FIX = BEAM / 2 / _wm          # ×0.979：量到的最大半寬 6.16 → 史實 6.03
W_MAX = _wm                     # 超過舯半寬的一定不是船體（砲座托架、平台）


def keel_z(y):
    """該站的船底。中線為準，只在中線下面掛著**薄鰭**時才讓開。

    艦首只能打中線：斷面是刀口（水線半寬 0.21），離軸的射線打到的是上面外飄的
    舷側，回報的「船底」會跑到 +4.4。

    艦尾**不可以**照 Essex 那樣「離軸取最高」。Essex 的尾鰭是一片從舯後一路
    帶到俥葉的長鰭，所以整個艦尾都要讓開；Fletcher 只有最後 4 m 有舵。照抄的
    結果是把艦尾的**斜升**當成船底，y −36 讀成 −2.44 而真值 −3.92 —— 剪影疊圖
    上整條船底少了一條 0.6 m 的紅帶。改成只在中線比離軸 0.6 m 低超過 0.9 m
    時才讓開：真船殼在 0.6 m 之內的橫向落差不到 0.15，只有薄鰭會這樣。
    """
    z_mid = bottom_at(0.0, y)
    if y > 0.0 or z_mid is None:
        return z_mid
    off = [z for z in (bottom_at(0.6, y), bottom_at(-0.6, y)) if z is not None]
    if off and max(off) - z_mid > 0.9:
        return max(off)
    return z_mid


def sheer_z(y):
    """該站的甲板高度（舷弧線）：由上往下掃過整個半寬，取**最小值**。

    甲板是水線以上最低的那個面 —— 甲板室、砲座、護牆都更高。上限收在最大半寬
    的 0.90 倍：再往外射線會擦過外飄的舷側，回報的切點**比甲板低**，取最小值
    就會被它綁架（實測 y −20 讀到 2.62，而真值 2.68 在 x 5.6 處）。

    另外兩種量法都失敗過：往下打只取最外側那一根，在艦尾整段量到上述切點；
    由下往上打在艦尾對（與往下打差 0.04），但艦首段船殼內部另有一層平台會被
    先打到 —— 量出來是一條 2.8→1.6 的假曲線，平滑、單調、逐站連續，看不出錯。
    """
    w = max([v for v in (halfw(y, z) for z in (1.0, 1.6, 2.2)) if v] or [0.0])
    zs = []
    if w < 0.5:                      # 艦首刀口：只有中線附近有甲板
        for x in (0.0, 0.1, -0.1):
            z = top_at(x, y)
            if z is not None and 1.0 < z < 9.5:
                zs.append(z)
        return min(zs) if zs else None
    n = 8
    for i in range(n + 1):
        for sgn in (1, -1):
            z = top_at(sgn * w * 0.90 * i / n, y)
            if z is not None and 1.0 < z < 9.5:
                zs.append(z)
    return min(zs) if zs else None


def hull_section(y):
    """回傳 (龍骨 z, 甲板 z, [半寬 …] 由下往上)；量不到就回 None。"""
    z0 = keel_z(y)
    z1 = sheer_z(y)
    if z0 is None or z1 is None or z1 - z0 < 0.30:   # 艦首最前兩站只剩 0.9 m 高
        return None
    pts = []
    for t in LEV:
        z = z0 + (z1 - z0) * t
        w = halfw(y, min(z + 0.02, z1 - 0.05))
        if w is not None and w > W_MAX:
            w = W_MAX
        pts.append([w, z])
    valid = [i for i, p in enumerate(pts) if p[0] is not None]
    if not valid:
        return None
    for i, p in enumerate(pts):
        if p[0] is None:
            lo = max([j for j in valid if j < i], default=None)
            hi = min([j for j in valid if j > i], default=None)
            if lo is not None and hi is not None:
                f = (i - lo) / (hi - lo)
                p[0] = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f
            else:
                p[0] = pts[lo if lo is not None else hi][0]
    pts[0][0] = min(pts[0][0], 0.30)             # 龍骨線
    for i in range(1, len(pts)):                  # 由下往上不得變窄
        pts[i][0] = max(pts[i][0], pts[i - 1][0])
    return z0, z1, [w * W_FIX for w, _ in pts]


def med3(vals):
    """三點中值濾波：外舷帶偶爾從甲板開口漏下去，會出現單站的凹陷。"""
    out = list(vals)
    for i in range(1, len(vals) - 1):
        out[i] = sorted(vals[i - 1:i + 2])[1]
    return out


def clip_bumps(vals, ys, tol=0.30, passes=2):
    """比前後兩站的連線高出 tol 的站位拉回連線上。

    艦橋前那一塊寬平台（半寬 4.69）幾乎與船體同寬，該站整條射線都落在平台上，
    量到的「甲板」是平台頂 6.78 而不是 4.35。舷弧本來就是平滑單調的，一站突起
    就是量到了別的東西。
    """
    out = list(vals)
    for _ in range(passes):
        for i in range(1, len(out) - 1):
            f = (ys[i] - ys[i - 1]) / (ys[i + 1] - ys[i - 1])
            lin = out[i - 1] + (out[i + 1] - out[i - 1]) * f
            if out[i] > lin + tol:
                out[i] = lin
    return out


def smooth(vals, ys, passes=2, lam=0.5):
    """站間拉普拉斯平滑（站距不等距，照 y 加權）。兩端不動。"""
    out = list(vals)
    for _ in range(passes):
        new = list(out)
        for i in range(1, len(out) - 1):
            y0, y1, y2 = ys[i - 1], ys[i], ys[i + 1]
            f = (y1 - y0) / (y2 - y0)
            new[i] = out[i] + lam * (out[i - 1] + (out[i + 1] - out[i - 1]) * f - out[i])
        out = new
    return out


sections = [hull_section(y) for y in HULL_Y]
idx = [i for i, s in enumerate(sections) if s is not None]
HULL_Y = [HULL_Y[i] for i in idx]
sections = [sections[i] for i in idx]
keels = smooth(med3([s[0] for s in sections]), HULL_Y)
decks = smooth(clip_bumps(med3([s[1] for s in sections]), HULL_Y), HULL_Y)
levels = [smooth([s[2][k] for s in sections], HULL_Y, passes=3) for k in range(len(LEV))]
LOG['sheer'] = [(round(y), round(z, 2)) for y, z in zip(HULL_Y, decks)]

bmh = bmesh.new()
rings = []
for i, y in enumerate(HULL_Y):
    z0, z1 = keels[i], decks[i]
    ws = [levels[k][i] for k in range(len(LEV))]
    zs = [z0 + (z1 - z0) * t for t in LEV]
    right = list(zip(ws[1:], zs[1:]))
    ring = [Vector((0.0, y, z0))]
    ring += [Vector((w, y, z)) for w, z in right]
    ring += [Vector((-w, y, z)) for w, z in reversed(right)]
    rings.append(ring)
loft(bmh, rings)
cap(bmh, [bmh.verts.new(p) for p in rings[0]])
cap(bmh, [bmh.verts.new(p) for p in reversed(rings[-1])])
finish(bmh)
HULL = new_object('FLETCHER_Hull', bmh, [M_BODY, M_DECK])
# 甲板不是另外一片：loft 的頂面那一圈（環由中線繞右舷、跨過甲板、回左舷）就是
# 甲板，只要把朝上的那些面換成甲板材質。獨立一片平板會與船體頂共面 —— 那正是
# Essex 那一輪拉遠閃爍的來源。
for f in HULL.data.polygons:
    if f.normal.z > 0.55 and f.center.z > 1.0:
        f.material_index = 1


def deck_z(y):
    """該站建好的甲板高度（線性內插建好的舷弧，不是重量一次）。"""
    if y >= HULL_Y[0]:
        return decks[0]
    for i in range(len(HULL_Y) - 1):
        if HULL_Y[i] >= y >= HULL_Y[i + 1]:
            f = (HULL_Y[i] - y) / (HULL_Y[i] - HULL_Y[i + 1])
            return decks[i] + (decks[i + 1] - decks[i]) * f
    return decks[-1]


# ═══════════════════════ 2. 上層建築 ═══════════════════════
# 每一塊的 y 範圍是從「甲板裝備層」量出來的（由 z 9.5 往下打，跳過天線索與
# 煙囪頂），頂高在這裡重量一次。半寬取自逐層平面外形的掃描。
#   (名稱, y0, y1, 半寬, 量頂高的上限, 底面基準)
#   底面基準 'deck' = 該站甲板；數字 = 直接給的高度（坐在下面那一塊上）
bms = bmesh.new()
SUPER = []


def block(name, y0, y1, hw, cap_z, base, shrink=1.0, dy=0.0, stat='median', plate=None):
    """量出頂高、往下建到 base 之下 0.6（埋進支撐面，不留共面）。

    `plate` 給厚度 = 懸出的薄板（艦橋舷側翼台那種底下沒有支撐的）。**底面基準
    比量到的頂面還高就是傳錯了**：那樣建出來的盒子上下顛倒，會往上長成一塊厚
    板，把坐在它上面的東西整個吞掉（實測翼台因此變成 1.5 m 厚，舷側那座 20 mm
    整座埋進去）。這裡直接退回薄板模式並記在 LOG 裡。
    """
    z1 = top_in(y0, y1, hw, cap_z, stat=stat)
    if z1 is None:
        LOG.setdefault('missing', []).append(name)
        return None
    if plate is not None:
        z0 = z1 - plate
    else:
        z0 = (deck_z((y0 + y1) / 2) if base == 'deck' else base) - 0.6
        if z0 > z1 - 0.10:
            LOG.setdefault('base_above_top', []).append(name)
            z0 = z1 - 0.35
    if shrink >= 1.0:
        box(bms, -hw, hw, y0, y1, z0, z1)
    else:
        taper(bms, -hw, hw, y0, y1, z0, z1, shrink, dy)
    SUPER.append((name, round(y0, 1), round(y1, 1), round(z1, 2)))
    return z1


# 艦首段：前甲板室（Mount 52 坐在上面）
Z_FWD_HOUSE = block('fwd_house', 27.0, 34.2, 3.57, 8.0, 'deck')
# 艦橋前的寬平台（20/40 mm 砲位）
Z_FWD_PLAT = block('fwd_platform', 23.4, 27.5, 4.80, 8.0, Z_FWD_HOUSE or 6.9)
# 艦橋本體 → 駕駛室 → 羅經艦橋
Z_BRIDGE = block('bridge', 16.8, 25.0, 2.55, 12.6, 'deck')
# 舷側翼台（薄板）。後緣要拉到 15.2：前桅就站在它的後半段上，只做到艦橋後壁
# 會讓桅杆整支懸空 2 m。
Z_WING = block('bridge_wing', 15.2, 24.0, 4.85, 9.9, None, plate=0.35)
Z_PILOT = block('pilot_house', 18.1, 22.9, 2.55, 14.4, Z_BRIDGE or 11.8, stat='max')
# 舯段甲板室（兩座煙囪與兩具魚雷發射管都坐在上面）。分前後兩段是因為它的頂
# 逐站在降：前段量到 5.95、後段只剩 5.3。做成一整塊會讓後魚雷發射管墊高 0.6，
# 而且剪影上艦舯憑空多一條。
Z_MID_HOUSE = block('mid_house', -8.0, 13.2, 2.65, 6.6, 'deck')
Z_MID_AFT = block('mid_house_aft', -17.4, -8.0, 2.60, 5.9, 'deck')
# 艦尾段
Z_M53_HOUSE = block('aft_house_53', -22.3, -17.2, 2.65, 6.0, 'deck')
Z_AFT_HOUSE = block('aft_house', -28.8, -22.0, 2.76, 7.9, 'deck')
# 防空砲座是**圓桶**，不是方塊：0.1 m 網格細掃看得到護牆的圓弧。桶心、半徑與
# 護牆高度都是這樣量出來的。桶壁是船體凸出 → 船體色（只有砲本身是深色）。
#   (桶心 y, 桶心 |x|, 半徑, 腳下平台, 量砲頂的上限)
AA_TUBS = ((25.40, 3.52, 1.55, 'plat', 9.2),      # 艦橋前平台，一舷一座 20 mm
           (18.60, 3.95, 0.85, 'wing', 11.9))     # 艦橋舷側翼台，一舷一座 20 mm
# 艦尾 40 mm 的桶：桶心 y −26.1、半徑 2.45、護牆高出桶底 1.10。桶底高度要在
# **沒有砲的那一段**量（y −28…−27），在砲底下量會量到砲架。
Z_AFT_TUB = top_in(-28.0, -27.0, 1.80, 10.0)
if Z_AFT_TUB:
    hex_prism(bms, 0.0, -26.10, 2.45, (Z_AFT_HOUSE or 7.2) - 0.6, Z_AFT_TUB)
    hex_ring(bms, 0.0, -26.10, 2.45, 0.18, Z_AFT_TUB - 0.25, Z_AFT_TUB + 1.10)
    SUPER.append(('aft_40mm_tub', -28.6, -23.7, round(Z_AFT_TUB + 1.10, 2)))
Z_M54_BASE = block('aft_house_54', -33.1, -28.9, 2.65, 6.0, 'deck')
for _y, _x, _r, _base, _cap in AA_TUBS:
    _b = (Z_FWD_PLAT or 6.8) if _base == 'plat' else (Z_WING or 9.5)
    for _s in (1, -1):
        hex_ring(bms, _s * _x, _y, _r, 0.16, _b - 0.25, _b + 1.05)
    SUPER.append(('aa20_tub_%.0f' % _y, _y - _r, _y + _r, round(_b + 1.05, 2)))
# 兩舷的小艇：吊在艇架上、懸在甲板外側，所以底下是空的 —— z 7 那一層在
# y 10…16 之間伸到 |x| 5.44，而同一段 z 6 只有 1.4。艏視剪影上它們佔的面積不小
# （兩舷合計約 4 m²），少了會看得出來。
for _sgn in (1, -1):
    box(bms, _sgn * 3.60, _sgn * 5.40, 10.4, 15.4, 6.30, 7.50)
SUPER.append(('boats', 10.4, 15.4, 7.50))
# 兩座煙囪：dy 為負 = 頂面往 −Y 偏 = **往艦尾傾**。給正值兩座都會往艦首倒。
Z_FUNNEL_F = block('funnel_fwd', 7.5, 11.0, 1.38, 15.5, Z_MID_HOUSE or 6.0, shrink=0.80, dy=-0.55, stat='p85')
Z_FUNNEL_A = block('funnel_aft', -6.8, -3.1, 1.38, 14.5, Z_MID_HOUSE or 6.0, shrink=0.80, dy=-0.55, stat='p85')
finish(bms)
SUPER_OBJ = new_object('FLETCHER_Super', bms, [M_BODY])
LOG['super'] = SUPER

# ═══════════════════════ 3. 砲位與魚雷 ═══════════════════════
# 五座 5"/38 單裝（51/52 在艦首超射、53 舯後、54/55 在艦尾超射）、兩具五聯裝
# 魚雷發射管、一座四聯裝 40 mm。位置全部是量到的：砲塔頂與砲管高度由參考模型
# 的裝備層讀出來，砲管方向照真船（51/52 朝前、53 朝前、54/55 朝後）。
bmg = bmesh.new()
GUNS = []
EMPL = []      # 防空砲位清單 → export_ship_aa.py 產生遊戲用的座標表


def mount(name, y0, y1, hw, cap_z, base, bar_y0, bar_y1, bar_z_cap):
    """砲塔（略收頂的方塊）＋砲管（細長三角柱）。兩者的高度都是量出來的。"""
    z1 = top_in(y0, y1, hw, cap_z)
    bz = top_in(min(bar_y0, bar_y1), max(bar_y0, bar_y1), 0.16, bar_z_cap, stat='max')
    if z1 is None or bz is None:
        LOG.setdefault('missing', []).append(name)
        return
    z0 = (deck_z((y0 + y1) / 2) if base == 'deck' else base) - 0.5
    taper(bmg, -hw, hw, y0, y1, z0, z1, 0.86)
    tri_barrel(bmg, 0.0, bz - 0.13, min(bar_y0, bar_y1), max(bar_y0, bar_y1), 0.26)
    GUNS.append((name, round((y0 + y1) / 2, 1), round(z1, 2), round(bz, 2)))
    EMPL.append(('flak', 127, 0.0, (y0 + y1) / 2, bz - 0.13, 1))


mount('mount_51', 36.2, 39.8, 1.53, 9.0, 'deck', 39.8, 43.4, 7.9)
mount('mount_52', 28.3, 32.8, 1.53, 11.0, Z_FWD_HOUSE or 6.9, 32.8, 35.9, 9.9)
mount('mount_53', -22.4, -17.7, 1.53, 9.0, Z_M53_HOUSE or 5.2, -17.7, -14.5, 8.0)
mount('mount_54', -33.1, -28.9, 1.53, 9.0, Z_M54_BASE or 5.1, -36.4, -33.1, 8.0)
mount('mount_55', -41.1, -37.1, 1.53, 6.6, 'deck', -44.1, -41.1, 5.6)

# 五聯裝魚雷發射管：中線上、前一具在前煙囪之後、後一具在後煙囪之後
for nm, y0, y1, base in (('tt_fwd', 2.0, 7.3, Z_MID_HOUSE), ('tt_aft', -14.3, -7.7, Z_MID_AFT)):
    zt = top_in(y0, y1, 1.68, 7.6)
    if zt is None:
        LOG.setdefault('missing', []).append(nm)
        continue
    box(bmg, -1.68, 1.68, y0, y1, (base or 5.5) - 0.5, zt)
    GUNS.append((nm, round((y0 + y1) / 2, 1), round(zt, 2), None))

# 20 mm Oerlikon：桶內一挺，砲身坐在桶底、砲管**尾端埋進砲身裡**朝外斜上。
# 砲管軸心放在砲身頂之上就是一根浮在空中的棒子；20 mm 的管徑只有 3 cm，照
# 5 吋砲的 r=0.26 抄下來從側面看是一片板。
# 掃舷側縱線找到的 y 9.8、x ±4.4 那一對**不是砲是吊艇架**：腳印只有 0.4 m，
# 而且比小艇頂高 1.3 m（砲座有 1 m 以上的腳印）。量腳印才分得出來。
for _y, _x, _r, _base, _cap in AA_TUBS:
    _b = (Z_FWD_PLAT or 6.8) if _base == 'plat' else (Z_WING or 9.5)
    _zt = top_in(_y - 0.6, _y + 0.6, 0.50, _cap, xc=_x, stat='max') or (_b + 1.65)
    _pt = _zt - 0.30                     # 砲身頂
    for _s in (1, -1):
        taper(bmg, _s * _x - 0.46, _s * _x + 0.46, _y - 0.46, _y + 0.46, _b - 0.25, _pt, 0.80)
        tri_rod(bmg, (_s * (_x + 0.10), _y + 0.05, _pt - 0.13),
                (_s * (_x + _r + 0.60), _y + 0.45, _pt + 0.34), 0.065)
        EMPL.append(('mg', 20, _s * _x, _y, _pt - 0.13, 1))
    GUNS.append(('aa20_%.0f' % _y, _y, round(_zt, 2), None))

# 雙聯裝 40 mm：兩根砲管朝前略上（細掃在 y −22.6 那一列量到兩個尖峰在 x ±0.3），
# 尾端埋進砲架裡。
_z40 = top_in(-26.6, -25.2, 1.00, 11.9, stat='max')
if _z40:
    taper(bmg, -0.85, 0.85, -26.90, -25.10, (Z_AFT_TUB or 9.3) - 0.30, _z40 - 0.45, 0.82)
    for _sx in (-0.30, 0.30):
        tri_rod(bmg, (_sx, -25.60, _z40 - 0.62), (_sx, -22.50, _z40 - 0.20), 0.085)
    GUNS.append(('aa_40mm', -26.0, round(_z40, 2), None))
    EMPL.append(('autocannon', 40, 0.0, -26.0, _z40 - 0.62, 2))

# 深水炸彈軌：艦尾甲板上兩條
for sgn in (1, -1):
    box(bmg, sgn * 1.2, sgn * 2.2, -56.2, -47.0, deck_z(-51.0) - 0.3, deck_z(-51.0) + 0.55)

# 前桅：近垂直的錐柱 + 一支桁（參考模型的桅頂 26.1，桁在 21.9、伸到 |x| 4.05）
# 前桅：**往艦尾傾**（參考模型的桅腳在 z 9 的 y 16.1、桅頂在 z 26 的 y 14.6，
# 逐 z 帶量出來的），桁在 21.9、伸到 |x| 4.05。
Z_MAST = top_in(13.4, 16.2, 0.4, 27.0, stat='max') or 26.1
taper(bmg, -0.45, 0.45, 15.3, 16.9, (Z_WING or 9.5) - 0.5, Z_MAST, 0.40, dy=-1.5)
box(bmg, -4.05, 4.05, 14.6, 15.2, 21.4, 21.9)
# 射控台（Mk37）與其上的雷達天線板
Z_DIR = top_in(18.7, 21.7, 1.48, 17.0)
if Z_DIR:
    taper(bmg, -1.48, 1.48, 18.7, 21.7, (Z_PILOT or 14.2) - 0.5, Z_DIR, 0.85)
    box(bmg, -1.02, 1.02, 19.8, 21.0, Z_DIR, top_in(19.8, 21.0, 0.9, 19.5, stat='max') or (Z_DIR + 2.1))
    GUNS.append(('director', 20.2, round(Z_DIR, 2), None))
finish(bmg)
GUNS_OBJ = new_object('FLETCHER_Guns', bmg, [M_ACC])
LOG['guns'] = GUNS


# ═══════════════════════ 4. 刪掉看不到的面 ═══════════════════════
def strip_buried_faces(objs, margin=0.05):
    """刪掉整片埋在別件體積內的面。

    拉遠之後兩片面互相閃爍**不是靠挪高度治得好的**：265 m 級的物件在幾公里外，
    深度緩衝的精度只剩幾公尺。唯一有效的是讓其中一片不存在。

    三個必須做對的地方（Essex 那一輪各踩過一次）：
      三方向投票   單一方向的奇偶測試會被彼此相接的方塊騙倒，實測在水線下的
                   舷側挖了兩個洞
      逐頂點判     只看面心會把埋一半的面整片刪掉，剪影會掉
      邊界先切開   跨過遮蔽邊界的面要先切成兩塊（這艘船沒有懸空甲板，用不到）
    """
    trees, boxes = {}, {}
    for o in objs:
        b = bmesh.new(); b.from_mesh(o.data)
        bmesh.ops.triangulate(b, faces=b.faces)
        trees[o.name] = BVHTree.FromBMesh(b)
        vs = [v.co for v in o.data.vertices]
        boxes[o.name] = (min(v.x for v in vs), max(v.x for v in vs),
                         min(v.y for v in vs), max(v.y for v in vs),
                         min(v.z for v in vs), max(v.z for v in vs))
        b.free()
    DIRS = (Vector((0.37, 0.21, 0.91)), Vector((-0.83, 0.44, 0.34)), Vector((0.29, -0.87, 0.40)))

    def in_bbox(name, p):
        x0, x1, y0, y1, z0, z1 = boxes[name]
        return x0 - 0.01 <= p.x <= x1 + 0.01 and y0 - 0.01 <= p.y <= y1 + 0.01 and z0 - 0.01 <= p.z <= z1 + 0.01

    def inside(tree, p):
        votes = 0
        for d in DIRS:
            n, o_, t = 0, p.copy(), 0.0
            while n < 24:
                h = tree.ray_cast(o_ + d * 1e-4, d, 400.0)
                if h[0] is None:
                    break
                o_ = h[0] + d * 1e-4
                n += 1
            if n % 2 == 1:
                votes += 1
        return votes >= 2

    removed = 0
    for o in objs:
        b = bmesh.new(); b.from_mesh(o.data)
        kill = []
        for f in b.faces:
            c = f.calc_center_median()
            pts = [c + f.normal * margin] + [c + (v.co - c) * 0.92 + f.normal * margin for v in f.verts]
            if any(all(in_bbox(n, q) and inside(t, q) for q in pts)
                   for n, t in trees.items() if n != o.name):
                kill.append(f)
        if kill:
            bmesh.ops.delete(b, geom=kill, context='FACES')
            removed += len(kill)
        b.to_mesh(o.data); b.free()
    return removed


PARTS = list(COLL.objects)
LOG['buried_faces_removed'] = strip_buried_faces(PARTS)
tris = 0
for ob in PARTS:
    ob.data.calc_loop_triangles()
    tris += len(ob.data.loop_triangles)
LOG['triangles'] = tris
LOG['size'] = tuple(round(v, 2) for v in (
    2 * max(max(abs(vv.co.x) for vv in ob.data.vertices) for ob in PARTS),
    max(max(vv.co.y for vv in ob.data.vertices) for ob in PARTS)
    - min(min(vv.co.y for vv in ob.data.vertices) for ob in PARTS),
    max(max(vv.co.z for vv in ob.data.vertices) for ob in PARTS)))
LOG['empl'] = [(t, c, round(x, 2), round(y, 2), round(z, 2), g) for t, c, x, y, z, g in EMPL]
print('FLETCHER LOG', LOG)
