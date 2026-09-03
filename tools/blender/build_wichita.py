# -*- coding: utf-8 -*-
"""
USS Wichita CA-45：在 Blender 裡對著參考模型直接量、直接 loft（2026-09-03）。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_wichita.py', encoding='utf-8').read())
沒有 Ref_Wichita 時會先把 ref/uss_wichita_wows.glb 匯進來對齊；有就直接建。

座標與 Essex／Fletcher 同一套：Blender X 橫向（+X 右舷）、+Y 艦首、Z 上，原點
在水線 × 艦體中點 × 中線；export_yup 之後是遊戲的 X 橫向、Y 上、−Z 艦首。

【對齊怎麼實證的】參考模型原始朝向是艦首 −Y，四條獨立證據：
  刀口   該端水線半寬收到 0.31（y −87.8）再收成 0；另一端到 y +88.2 還有 6.04
         才戛然而止 —— 那是**方尾**（Wichita 是美國第一批方尾巡洋艦）
  舷弧   甲板由該端的 7.45 一路降到舯部的 5.26
  桅位   最高點（前桅 38.2）離該端 81 m，是全長的 44%；另一支桅只有 30.96
         而且更靠另一端 —— 前桅高、主桅矮，前桅在前
  砲塔數 該端有兩座砲塔（頂 9.35 / 11.99）、另一端只有一座（9.24）；重巡是
         艦首兩座、艦尾一座
繞 Z 轉 180° 之後艦首 +Y。「艦島在右舷」那條只對航艦成立，這裡用不上。

【尺寸：史實優先】以史實全長 185.42 m（608 ft 4 in）均勻縮放（×14.881）之後，
量到的最大半寬 9.15 對史實艦寬 18.82 m（61 ft 9 in）的一半小 2.8%，依
aircraft-from-reference 坑 21 把船體半寬整體乘 1.028 補回去。吃水量到 7.48
對史實滿載吃水 7.24 只差 3%：參考模型的水線就畫在 z 0，不動它。

【與 Fletcher 的差別】巡洋艦一樣是平甲板（甲板就是船體的頂，不做獨立的一片），
但多了三件驅逐艦沒有的：
  艦尾的薄鰭很長  y −78…−86 中線讀到 −7.42 而離軸只有 −3.3，落差 4 m。
                  Fletcher 的「中線比離軸低 0.9 以上才讓開」這條規則照用即可，
                  但這艘的鰭長 8 m，不是 4 m
  超射砲塔有砲座  二號砲塔頂 11.99 比一號的 9.35 高 2.64，而兩座砲塔一樣高
                  （砲管軸心都在頂下 1.32）⇒ 中間那 2.64 是砲座，要單獨做
  艦尾是方尾      不能像艦首那樣收成一點：最後一站的半寬還有 3 m 上下
"""
import bpy, bmesh, math, statistics
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\uss_wichita_wows.glb"
LOA = 185.42          # 史實全長 608 ft 4 in
BEAM = 18.82          # 史實艦寬 61 ft 9 in


def wire_names(objs, s0):
    """鋼索、天線、欄杆：三角形少、跨度大、又有高度落差的。

    這台是 111 個 mesh 的「半分件」模型：砲塔與船殼按材質合併在一起，小艇、
    砲座、吊車卻是獨立件。鋼索排不掉會毀掉量測 —— 中線在 z 20…32 有一整條
    天線索，桅間、桅到艦尾各一條。

    **門檻不能只看跨度**，兩條都是踩出來的：

      跨度 > 25 m 太鬆   y −27.9…−0.5 那塊 8.9 m 寬的舯部平台（Object_67，
                         170 個三角形，因為開了很多洞）被排掉，中線在
                         y −14…−25 整段量不到任何東西
      沒有排除水線以下   舯段的舷側鋼板（Object_25／Object_102，各只有 300
                         上下個三角形，因為是大片平板）被排掉，y −12…−24
                         的半寬整段回 None，舷弧因此讀成小艇甲板的 7.8
    鋼索永遠在水線之上，所以「碰得到水線以下」直接判為船殼。
    """
    out = set()
    for o in objs:
        mw = o.matrix_world
        pts = [mw @ v.co for v in o.data.vertices]
        if not pts:
            continue
        sp = [(max(p[i] for p in pts) - min(p[i] for p in pts)) * s0 for i in range(3)]
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        slim = max(sp[0], sp[1]) > 20.0 and min(sp[0], sp[1]) < 2.0
        wet = min(p.z for p in pts) * s0 < 0.5
        if t < 1100 and sp[2] > 1.5 and not wet and (max(sp) > 35.0 or slim):
            out.add(o.name)
    return out


def import_and_align_ref():
    """匯入參考模型，烘 matrix_world，排掉鋼索，縮放、轉正、平移到艦體座標。"""
    O = bpy.data.objects
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()
    new = [o for o in O if o.name not in before and o.type == 'MESH']
    ys = [(o.matrix_world @ v.co).y for o in new for v in o.data.vertices]
    s0 = LOA / (max(ys) - min(ys))
    wires = wire_names(new, s0)
    bm = bmesh.new()
    for o in new:
        if o.name not in wires:
            me = o.data.copy(); me.transform(o.matrix_world.copy())
            bm.from_mesh(me); bpy.data.meshes.remove(me)
    for o in [x for x in O if x.name not in before]:
        bpy.data.objects.remove(o, do_unlink=True)
    me = bpy.data.meshes.new('Ref_Wichita')
    bm.to_mesh(me); bm.free()
    ref = bpy.data.objects.new('Ref_Wichita', me)
    bpy.context.scene.collection.objects.link(ref)
    ys = [v.co.y for v in me.vertices]
    S = LOA / (max(ys) - min(ys))
    me.transform(Matrix.Scale(S, 4) @ Matrix.Rotation(math.pi, 4, 'Z'))
    ys = [v.co.y for v in me.vertices]
    me.transform(Matrix.Translation(Vector((0, -(max(ys) + min(ys)) / 2, 0))))
    ref['wires'] = sorted(wires)
    return ref


if 'Ref_Wichita' not in bpy.data.objects:
    import_and_align_ref()
O = bpy.data.objects
LOG = {'wires': len(O['Ref_Wichita'].get('wires', []))}


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


M_BODY = mat('WICHITA_Body', srgb(0x565f66))    # 舷側灰（Measure 21 海軍灰）
M_DECK = mat('WICHITA_Deck', srgb(0x3b3b39))    # 鋼甲板
M_ACC = mat('WICHITA_Accent', srgb(0x2b2e30))   # 砲、桅、射控、彈射器

# ───────────────────────── 場景 ─────────────────────────
for o in list(O):
    if o.name.startswith('WICHITA_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('WICHITA')
if COLL is None:
    COLL = bpy.data.collections.new('WICHITA'); bpy.context.scene.collection.children.link(COLL)


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
bm.from_mesh(O['Ref_Wichita'].data)
bmesh.ops.triangulate(bm, faces=bm.faces)
REF = BVHTree.FromBMesh(bm)
bm.free()


def hit(o_, d_, L=400.0):
    return REF.ray_cast(Vector(o_), Vector(d_).normalized(), L)[0]


def top_at(x, y, z0=45.0):
    h = hit((x, y, z0), (0, 0, -1), z0 + 35.0)
    return h.z if h else None


def lowest_above(x, y, lo=2.0, hi=14.0, cap=45.0):
    """該條垂直線上、lo…hi 之間**最低**的那個面。

    甲板是水線以上最低的面，但「往下打取第一個交點」在有上層建築的站位讀到的
    是上層建築的頂 —— 巡洋艦的艦橋從 y 10 一路蓋到 y 23，那一段的舷弧因此讀成
    7.7…10.3（實際 5.3），而且平滑連續、看不出錯，連線性內插的凸起偵測都抓不到
    （整段一起抬高，沒有「比鄰居高」這回事）。**要穿過去把所有交點都收下來。**
    """
    p = Vector((x, y, cap))
    d = Vector((0, 0, -1))
    best = None
    for _ in range(24):
        h = REF.ray_cast(p, d, 90.0)[0]
        if h is None:
            break
        if lo < h.z < hi:
            best = h.z
        if h.z < lo:
            break
        p = h - Vector((0, 0, 1e-3))
    return best


def bottom_at(x, y):
    h = hit((x, y, -30.0), (0, 0, 1))
    return h.z if h else None


def halfw(y, z):
    """該站該高度的半寬：左右各打一條，取有值的較大者（船體本來就對稱）。"""
    w = []
    for sgn in (1, -1):
        h = hit((sgn * 40.0, y, z), (-sgn, 0, 0))
        if h is not None:
            w.append(abs(h.x))
    return max(w) if w else None


def top_in(y0, y1, xr, cap, floor=2.0, stat='median', xc=0.0):
    """窗口內、`cap` 以下的頂面高度。

    `cap` 是必要的：由 z 45 往下打，中線在 y −36…+25 打到的是天線索（排掉的
    那 20 幾件只是「整件都是索」的，跟船殼合併的那幾條排不掉）。

    **細長件要用 `stat='max'`**（砲管、桅）；**煙囪要用 `p85`**（頂上還有蒸汽管）。
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
    if stat == 'p85':
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
    """六邊柱（圓形砲座的托座、圓煙囪、砲塔的砲座）。"""
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


def hex_tube(bm, cx, cy, r0, r1, z0, z1):
    """上小下大的六邊錐台（煙囪）。"""
    ang = [math.pi / 6 + i * math.pi / 3 for i in range(6)]
    v0 = [bm.verts.new((cx + r0 * math.cos(a), cy + r0 * math.sin(a), z0)) for a in ang]
    v1 = [bm.verts.new((cx + r1 * math.cos(a), cy + r1 * math.sin(a), z1)) for a in ang]
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
    """任意方向的細長三角柱（斜著朝外上方的防空砲管、吊車的臂）。

    **兩端都要埋進砲身裡** —— 軸心放在砲身頂之上就是一根浮在空中的棒子。
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
    """上小下大的錐台（甲板室、砲塔、桅）。`dy` 是頂面往 +Y 的偏移：往艦尾傾的
    桅要給**負值**。"""
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
# 站位：艦首（刀口）與艦尾（方尾）加密，舯段放疏。
HULL_Y = ([91.9, 91.2, 90.6, 89.8, 88.8, 87.5, 85.5, 83.0, 80.0, 76.5, 72.5, 68.0, 63.0, 58.0]
          + [52.0, 46.0, 40.0, 34.0, 28.0, 22.0, 16.0, 10.0, 4.0, -2.0, -8.0, -14.0]
          + [-20.0, -26.0, -32.0, -38.0, -44.0, -50.0, -56.0, -61.5, -66.5, -71.0, -75.0]
          + [-78.5, -81.5, -84.0, -86.0, -87.8, -89.2, -90.2, -91.0])
LEV = [0.0, 0.04, 0.10, 0.18, 0.28, 0.40, 0.53, 0.68, 0.84, 1.0]   # 由龍骨到甲板的比例
_wm = max(w for w in (halfw(y, z) for y in (-25.0, -15.0, -5.0, 5.0, 15.0)
                      for z in (1.0, 2.0, 3.0, 4.0)) if w)
W_FIX = BEAM / 2 / _wm          # ×1.028：量到的最大半寬 9.15 → 史實 9.41
W_MAX = _wm                     # 超過舯半寬的一定不是船體（砲座托架、平台）
LOG['w_measured'] = round(_wm, 3)
LOG['w_fix'] = round(W_FIX, 4)


def keel_z(y):
    """該站的船底。中線為準，只在中線下面掛著**薄鰭**時才讓開。

    艦首（+Y）只能打中線：斷面是刀口，離軸的射線打到的是上面外飄的舷側，
    回報的「船底」會跑到 +5.4。

    艦尾的鰭比 Fletcher 長得多：y −78…−86 中線讀到 −7.42 而離軸 0.9 m 只有
    −3.3，落差 4 m。而 y −65…−77 兩者只差 0.25…0.55，那一段是真船殼。所以
    判準照 Fletcher 那條（差 0.9 以上才讓開），只是這艘會連續觸發 8 m。
    """
    z_mid = bottom_at(0.0, y)
    if y > 0.0 or z_mid is None:
        return z_mid
    off = [z for z in (bottom_at(0.9, y), bottom_at(-0.9, y)) if z is not None]
    if off and max(off) - z_mid > 0.9:
        return max(off)
    return z_mid


def sheer_z(y):
    """該站的甲板高度（舷弧線）：掃過整個半寬，每條射線取它自己**最低**的交點，
    再跨射線取 **30 百分位**。

    為什麼不是最小值：艦首段的船殼**內部另有一層平台**（y 70…80 讀得到 1.8…2.0），
    穿透式的射線一定會打到它，取最小值整段會塌 4 m。三成分位既擋得住那少數幾條，
    也還是貼在「最低的那層面」上（實測與乾淨站位的最小值只差 0.1）。

    上限收在最大半寬的 0.90 倍：再往外射線會擦過外飄的舷側，回報的切點比甲板低。
    """
    w = max([v for v in (halfw(y, z) for z in (1.0, 2.0, 3.0)) if v] or [0.0])
    zs = []
    if w < 0.6:
        # 艦首刀口：只有中線附近有甲板，而且**要用第一個交點**。穿透式的射線在
        # 這裡會一路穿到艏柱內側，讀出 3.3…4.4 —— 艦首最後 7 m 的甲板因此往下
        # 掉了 4 m，側視變成一顆圓球。
        for x in (0.0, 0.12, -0.12):
            z = top_at(x, y)
            if z is not None and 1.0 < z < 14.0:
                zs.append(z)
        return min(zs) if zs else None
    n = 10
    for i in range(n + 1):
        for sgn in (1, -1):
            z = lowest_above(sgn * w * 0.90 * i / n, y)
            if z is not None:
                zs.append(z)
    if not zs:
        return None
    return sorted(zs)[int(0.30 * (len(zs) - 1))]


def hull_section(y):
    """回傳 (龍骨 z, 甲板 z, [半寬 …] 由下往上)；量不到就回 None。"""
    z0 = keel_z(y)
    z1 = sheer_z(y)
    if z0 is None or z1 is None or z1 - z0 < 0.40:
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
    pts[0][0] = min(pts[0][0], 0.35)             # 龍骨線
    for i in range(1, len(pts)):                  # 由下往上不得變窄
        pts[i][0] = max(pts[i][0], pts[i - 1][0])
    if pts[-1][0] < 0.60:
        # 艦首刀口：整個斷面只有 20…50 cm 寬，九層各自一個寬度會做出九片**彼此
        # 相距幾公分、又幾乎平行**的板 —— 185 m 的物件在幾公里外，那就是 18 對
        # 共面互閃。刀口段直接壓成一片等寬的平板。
        for p in pts:
            p[0] = pts[-1][0]
    return z0, z1, [w * W_FIX for w, _ in pts]


def med3(vals):
    out = list(vals)
    for i in range(1, len(vals) - 1):
        out[i] = sorted(vals[i - 1:i + 2])[1]
    return out


def clip_bumps(vals, ys, tol=0.30, passes=8):
    """比前後兩站的連線高出 tol 的站位拉回連線上。

    巡洋艦的上層建築幾乎與船體同寬：y 10…23 那一段整條掃描帶都落在 01 甲板上，
    量到的「甲板」是 7.7…10.3 而不是 5.3。舷弧本來就是平滑單調的，一站突起就是
    量到了別的東西。這裡的凸起連續 6 站以上，所以 passes 要夠多（每一趟只從
    兩端各修一站進來）—— Fletcher 的 2 趟在這艘身上不夠。
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
LOG['stations'] = len(HULL_Y)
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
HULL = new_object('WICHITA_Hull', bmh, [M_BODY, M_DECK])
# 甲板不是另外一片（平甲板艦，見 skill S8）：loft 頂面那一圈就是甲板，只要把
# 朝上的面換成甲板材質。獨立一片平板會與船體頂共面。
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
# 每一塊的 y 範圍與半寬是從分層平面圖與中線縱剖讀出來的，頂高在這裡重量一次。
bms = bmesh.new()
SUPER = []


def block(name, y0, y1, hw, cap_z, base, shrink=1.0, dy=0.0, stat='median',
          plate=None, xc=0.0, mw=None, my=None):
    """量出頂高、往下建到 base 之下 0.6（埋進支撐面，不留共面）。

    `mw`／`my` 是量測用的窗口（預設同這塊的範圍）：寬平台要在**舷側乾淨處**量，
    用整個半寬去量會打到坐在上面的艦橋；長平台的兩端可能已經是別的甲板了。
    `plate` 給厚度 = 懸出的薄板。

    **底面基準比量到的頂面還高就是傳錯了**：那樣建出來的盒子上下顛倒，會往上
    長成一塊厚板，把坐在它上面的東西整個吞掉。這裡直接退回薄板模式並記進 LOG。
    """
    my0, my1 = my if my is not None else (y0, y1)
    z1 = top_in(my0, my1, hw if mw is None else mw, cap_z, stat=stat, xc=xc)
    if z1 is None:
        LOG.setdefault('missing', []).append(name)
        return None
    if plate is not None:
        z0 = z1 - plate
    else:
        z0 = (deck_z((y0 + y1) / 2) if base == 'deck' else base) - 0.6
        if z0 > z1 - 0.10:
            LOG.setdefault('base_above_top', []).append(name)
            z0 = z1 - 0.40
    if shrink >= 1.0:
        box(bms, -hw, hw, y0, y1, z0, z1)
    else:
        taper(bms, -hw, hw, y0, y1, z0, z1, shrink, dy)
    SUPER.append((name, round(y0, 1), round(y1, 1), round(z1, 2)))
    return z1


# 艦首：防浪板（只有 0.6 m 高的橫向牆，在一號砲塔之前）。**要用 max**：窗口
# 裡大部分射線落在它前後的甲板上，中位數會讀成甲板高度、盒子退化成零厚度。
Z_BRKW = block('breakwater', 53.6, 55.2, 6.10, 7.2, 'deck', stat='p85')
# 二號砲塔腳下的墊高甲板（護牆量在 |x| 6.3 的牆頂上，中線在牆內量到的是甲板）
Z_T2DK = block('turret2_deck', 33.4, 38.2, 6.85, 7.4, 'deck', mw=0.6, xc=6.3, stat='max')

# 01 甲板：艦首段幾乎與船體同寬（y 7…28.6），舯段窄（給小艇讓位），艦尾段中等。
# 頂高一律在**舷側乾淨處**量（xc 給偏移），在中線量會打到艦橋與煙囪。
Z_D01F = block('deck01_fwd', 7.0, 28.6, 7.85, 9.4, 'deck', mw=0.8, xc=6.6)
# 三塊 01 甲板**對接不重疊**：重疊 0.4 的話，兩塊高度只差 6 cm 的頂面會在那條
# 帶子上互相搶深度（4.6 m² 的共面）。對接的兩片端面是背對背、又被寬度差蓋住，
# 從外面看不到任何一片。
Z_D01M = block('deck01_mid', -27.0, 7.0, 5.70, 9.0, 'deck', mw=0.8, xc=4.6)
# 艦尾 01 甲板：量測窗口只取 y −40…−29（再往艦尾就是主甲板了，把它算進去
# 中位數會掉到 5.5，整塊甲板室連同坐在上面的 5 吋砲一起沉下去）
Z_D01A = block('deck01_aft', -42.5, -27.0, 5.90, 9.0, 'deck', mw=0.8, xc=4.6, my=(-34.0, -30.0))
# 艦橋前的甲板室（中線量到 10.29）
Z_HFWD = block('house_fwd', 23.5, 32.8, 4.30, 11.4, Z_D01F or 8.1)
# 艦橋本體 → 上層。舷側翼台（40 mm 砲座坐在上面）**懸出去，給厚度不給基準**。
Z_BR1 = block('bridge_1', 11.5, 23.4, 4.40, 16.4, Z_D01F or 8.1)
Z_BR2 = block('bridge_2', 12.2, 20.6, 2.90, 21.0, Z_BR1 or 15.4, mw=1.0, stat='max')
Z_WING = block('bridge_wing', 9.0, 15.5, 7.10, 10.9, None, plate=0.45, mw=0.6, xc=6.6)
# 舯段：兩座煙囪共用的一條機艙罩（中線在 y −8.6…7.6 量到 11.7…12.4）
Z_CASING = block('casing', -8.6, 7.6, 3.40, 13.0, Z_D01M or 7.7, stat='p85')
Z_MIDA = block('mid_house_aft', -25.0, -15.5, 3.60, 11.0, Z_D01M or 7.7, stat='max')
# 艦尾的甲板室。中線那一條有天窗，量到的是底下的 7.9 —— 要偏到 |x| 2.4 才讀得到
# 真正的屋頂 10.33。屋頂不是一個高度：y −26…−28 與 −33…−36 兩段是 12.9，中間
# y −29…−33 是 10.3 的凹槽，凹槽裡站著艦尾射控塔（17.4）。做成單一高度的話側視
# 剪影在這一段會缺一大塊（第一版就是這樣，艦尾整片紅）。
Z_AFTH = block('aft_house', -36.6, -25.6, 4.20, 11.0, Z_D01A or 7.9, mw=0.7, xc=2.4)
Z_AFTT = block('aft_house_top', -28.8, -25.6, 2.40, 13.6, Z_AFTH or 10.3, mw=0.8, xc=1.6)
Z_AFTT2 = block('aft_house_top_a', -36.5, -33.2, 2.40, 13.6, Z_AFTH or 10.3, mw=0.8, xc=1.6)
Z_AFTDIR = block('aft_dir_tower', -32.4, -29.6, 2.60, 18.0, Z_AFTH or 10.3, mw=0.9, xc=1.2)
Z_AFTT3 = block('aft_tower_2', -38.7, -35.9, 1.80, 16.5, Z_D01A or 7.9, mw=0.7, xc=0.8)
# 艦尾的水上機甲板（中線量到 6.55，比舷側的 6.0 高半公尺）
# 半寬收在 4.0、後緣收在 −84.8：再往外／往後就會與彈射器的底面和艦尾 5 吋砲的
# 前壁共面（面積重疊版的共面檢查抓得到，拉遠會互閃）
Z_AVDK = block('aviation_deck', -84.8, -75.5, 4.00, 7.1, 'deck')

# 兩座煙囪：圓的（六邊近似）。頂高取 p85 —— 頂上還有蒸汽管，取最大值會高 0.8。
for _nm, _y0, _y1 in (('funnel_fwd', 2.7, 7.3), ('funnel_aft', -8.3, -4.2)):
    _zt = top_in(_y0 + 0.5, _y1 - 0.5, 1.6, 24.0, stat='p85')
    if _zt is None:
        LOG.setdefault('missing', []).append(_nm)
        continue
    hex_tube(bms, 0.0, (_y0 + _y1) / 2, 2.30, 1.95, (Z_CASING or 12.0) - 0.6, _zt)
    SUPER.append((_nm, _y0, _y1, round(_zt, 2)))

# 小艇：兩舷各兩艘，掛在 01 甲板外側的主甲板上（量到的盒子 3.2 × 6.5 × 2.6）
for _y0, _y1 in ((-14.1, -7.6), (-26.4, -19.9)):
    for _s in (1, -1):
        box(bms, _s * 6.30, _s * 9.45, _y0, _y1, 5.35, 7.95)
SUPER.append(('boats', -26.4, -7.6, 7.95))
finish(bms)
SUPER_OBJ = new_object('WICHITA_Super', bms, [M_BODY])
LOG['super'] = SUPER

# ═══════════════════════ 3. 砲位、桅、航空設備 ═══════════════════════
# bmg = 深色件（砲、桅、射控、彈射器、吊車）
# bmx = 砲位裡屬於**船體凸出**的部分（砲座、護牆桶），最後併回 Super
bmg = bmesh.new()
bmx = bmesh.new()
GUNS = []

# ── 8"/55 三聯裝 × 3（一、二號在艦首超射，三號在艦尾）
# 砲管軸心都在砲塔頂之下 1.32，砲管間距 1.5 m（量出來的）。
Z_T1 = top_in(47.0, 52.0, 3.0, 10.6) or 9.35
Z_T2 = top_in(35.0, 40.0, 3.0, 13.2) or 11.99
Z_T3 = top_in(-51.5, -46.0, 3.0, 10.6) or 9.24


def barbette(cy, cap):
    """砲塔腳下那一圈**圓形砲座**：回傳 (頂高, 半徑)。

    量法是由砲塔中心往外一圈一圈打（每 15° 一條取中位數），頂高一路平到某個
    半徑才掉回甲板，那個半徑就是砲座的外緣。實測三座分別是 6.72/4.4、
    9.36/4.65、6.61/4.4，而**砲塔頂減砲座頂三座都是 2.63** —— 這是「三座砲塔
    一模一樣」最直接的證據，也說明中間那一段不是砲塔而是砲座。

    第一版沒做砲座，把砲塔由甲板一路建到頂，艦尾那座看起來就是光溜溜的一塊
    （負責人指出「船尾砲塔要有六邊形護欄」）。砲座是船體凸出 → 船體色。
    """
    def ring(r):
        zs = [top_at(r * math.cos(k * math.pi / 12), cy + r * math.sin(k * math.pi / 12), cap)
              for k in range(24)]
        zs = [z for z in zs if z is not None and 2.0 < z < cap]
        return statistics.median(zs) if zs else None

    zt = ring(2.5)
    if zt is None:
        return None, None
    r = 3.50
    while r < 5.60 and ring(r + 0.15) is not None and abs(ring(r + 0.15) - zt) < 0.25:
        r += 0.15
    return round(zt, 2), round(r, 2)


def turret(name, y0, y1, hw, z_top, cy, cap, bar_y0, bar_y1):
    """圓形砲座（六邊柱、船體色）＋砲塔（略收頂的方塊）＋三根沿 Y 的砲管。"""
    zb, rb = barbette(cy, cap)
    if zb is None:
        zb, rb = deck_z(cy) + 1.1, 4.40
        LOG.setdefault('missing', []).append(name + '_barbette')
    hex_prism(bmx, 0.0, cy, rb, deck_z(cy) - 0.5, zb)
    taper(bmg, -hw, hw, y0, y1, zb - 0.30, z_top, 0.88)
    for bx in (-1.5, 0.0, 1.5):
        tri_barrel(bmg, bx, z_top - 1.32, min(bar_y0, bar_y1), max(bar_y0, bar_y1), 0.30)
    GUNS.append((name, round(cy, 1), round(z_top, 2), round(zb, 2), rb))


turret('turret_1', 45.4, 53.6, 3.55, Z_T1, 49.5, 9.0, 53.6, 61.2)
turret('turret_2', 33.4, 41.8, 3.70, Z_T2, 37.6, 11.6, 41.8, 49.2)
turret('turret_3', -52.8, -44.8, 3.65, Z_T3, -48.8, 8.9, -52.8, -60.8)

# ── 5"/38 單裝 × 8（一舷四座）。砲管朝外斜前，尾端埋進砲身。
#   (y, |x|, 量頂高的上限, 腳下平台)
SEC = ((31.3, 6.10, 10.2, None), (19.2, 7.00, 12.2, Z_D01F),
       (-31.2, 5.30, 12.6, Z_AFTH), (-87.6, 5.25, 10.6, None))
for _y, _x, _cap, _plat in SEC:
    _zt = top_in(_y - 1.4, _y + 1.4, 0.9, _cap, xc=_x, stat='max')
    if _zt is None:
        LOG.setdefault('missing', []).append('sec_%.0f' % _y)
        continue
    _b = _zt - 3.1                      # 四對砲座量到的高度都是 3.1，統一用
    for _s in (1, -1):
        # 底面再往下埋 0.45：與腳下平台的頂面同高會共面（拉遠互閃）
        taper(bmg, _s * _x - 1.50, _s * _x + 1.50, _y - 1.65, _y + 1.65, _b - 0.45, _zt, 0.82)
        tri_rod(bmg, (_s * (_x + 0.55), _y + 0.30, _zt - 1.05),
                (_s * (_x + 3.00), _y + 2.35, _zt - 0.35), 0.13)
    GUNS.append(('sec5in_%.0f' % _y, _y, round(_zt, 2)))

# ── 四聯裝 40 mm：艦橋兩舷的翼台上（腳下量到 10.29）。桶壁是船體凸出 → bmx。
AA40 = ((12.2, 6.30, 13.2),)
for _y, _x, _cap in AA40:
    _zt = top_in(_y - 1.2, _y + 1.2, 0.8, _cap, xc=_x, stat='p85')
    if _zt is None:
        LOG.setdefault('missing', []).append('aa40_%.0f' % _y)
        continue
    # 桶底與砲身底都要**埋進翼台那片板裡**（板 0.45 厚）：貼著板底會與它共面。
    _pb = (Z_WING or (_zt - 2.0)) - 0.20
    for _s in (1, -1):
        hex_ring(bmx, _s * _x, _y, 2.10, 0.18, _pb, _zt - 1.15)
        # 砲身底再低 0.12：與桶的底緣同高的話兩者共面（都還在板裡，看不到）
        taper(bmg, _s * _x - 1.05, _s * _x + 1.05, _y - 1.25, _y + 1.25, _pb - 0.12, _zt - 0.35, 0.85)
        for _sx in (-0.35, 0.35):
            tri_rod(bmg, (_s * _x + _sx, _y - 0.30, _zt - 0.62),
                    (_s * _x + _sx, _y + 2.60, _zt - 0.10), 0.085)
    GUNS.append(('aa40_%.0f' % _y, _y, round(_zt, 2)))

# ── 20 mm Oerlikon × 10：舯部小艇甲板一舷四門（兩座煙囪之間那一排）、艏樓兩門。
# 位置是 0.25 m 細掃出來的：小艇甲板那一排在 x ±4.75，沿 y 每 2.3…2.9 一門，
# 砲頂 9.15、腳下 7.67；艏樓那一對在 y 85.2、x ±1.5，砲頂 8.65、腳下 7.09。
#
# **粗掃找不齊這一排**：四門的間距只有 2.4，±4 m 的局部基準會被隔壁那幾門墊高，
# 十門裡只跳出四門。要沿著那一排做 0.25 m 細掃，砲才會一個一個分開（同一張細掃
# 也看得出 x ±4.75 那條連續的 8.9…9.2 是**護牆**不是砲）。
# 艦尾 y −57.7 x ±5.3 與 y −35.5 x ±2.0 那兩對凸起**不是砲**：前者是蘑菇形通風口，
# 後者是艦尾 Mk 37 射控儀左右伸出來的測距儀臂 —— 都是近照才看得出來的。
#   (y, |x|, 桶半徑, 腳下平台, 量砲頂的上限)
AA20 = ((3.60, 4.75, 1.05, Z_D01M, 10.2), (1.25, 4.75, 1.05, Z_D01M, 10.2),
        (-1.10, 4.75, 1.05, Z_D01M, 10.2), (-4.00, 4.75, 1.05, Z_D01M, 10.2),
        (85.20, 1.50, 1.00, None, 9.6))
for _y, _x, _r, _plat, _cap in AA20:
    _b = _plat if _plat is not None else deck_z(_y)
    _zt = top_in(_y - 0.6, _y + 0.6, 0.45, _cap, xc=_x, stat='max') or (_b + 1.45)
    _pt = _zt - 0.30                       # 砲身頂
    for _s in (1, -1):
        hex_ring(bmx, _s * _x, _y, _r, 0.15, _b - 0.25, _b + 1.00)
        taper(bmg, _s * _x - 0.42, _s * _x + 0.42, _y - 0.42, _y + 0.42, _b - 0.25, _pt, 0.80)
        # 砲管尾端埋進砲身（軸心比砲身頂低 0.13）、朝外斜上，管徑照 20 mm
        tri_rod(bmg, (_s * (_x + 0.10), _y + 0.05, _pt - 0.13),
                (_s * (_x + _r + 0.55), _y + 0.40, _pt + 0.32), 0.065)
    GUNS.append(('aa20_%.0f' % _y, _y, round(_zt, 2)))

# ── 前桅：桅腳在艦橋頂，桅頂 38.2（Object_22），往艦尾傾 2.2。兩根桁：
#    下桁在 30.35 伸到 |x| 4.4、桅頂的十字桁在 35.5 伸到 |x| 2.2。
#    參考模型在 z 30.6…36.3 掛著一片 5.1 × 5.8 的 SK 對空雷達，**不做**：
#    低多邊形下那一片平板從側面看就是一塊浮在桅旁邊的矩形（負責人指出來的），
#    桅頂做成十字就夠了。
#    桅腳要一路建到 **01 甲板**，不能停在艦橋頂：艦橋上層只到 y 12.2，而桅在
#    y 10.4…12.8，站在 20.4 的話前面那 1.8 m 底下是空的 —— 整支桅看起來浮在
#    艦橋前方（負責人指出來的）。往下穿過艦橋那一段會被刪面刪掉，不會多算。
Z_FMAST = top_in(7.4, 8.4, 0.35, 39.0, stat='max') or 38.20
taper(bmg, -0.75, 0.75, 10.4, 12.8, (Z_D01F or 7.7) - 0.4, Z_FMAST, 0.35, dy=-2.2)
box(bmg, -4.40, 4.40, 9.90, 10.70, 30.10, 30.60)
box(bmg, -2.20, 2.20, 9.35, 10.05, 35.25, 35.75)
GUNS.append(('foremast', 11.0, round(Z_FMAST, 2)))
# 射控台（Mk34 主砲射控）坐在艦橋頂
Z_DIR = top_in(21.5, 23.0, 0.9, 17.6, stat='max') or 17.06
taper(bmg, -2.30, 2.30, 21.2, 23.4, (Z_BR1 or 15.4) - 0.4, Z_DIR, 0.80)
GUNS.append(('director_fwd', 22.3, round(Z_DIR, 2)))
# ── 主桅：矮得多（頂 30.96），坐在艦尾甲板室上
Z_MMAST = top_in(-29.0, -28.0, 0.35, 31.5, stat='max') or 30.96
# 主桅同理：桅腳 y −29.4…−27.6 只有後半坐在 11.35 那一小塊上，基準要取底下那
# 整塊甲板室（10.14）才不會有一截浮著。
taper(bmg, -0.70, 0.70, -29.4, -27.6, (Z_AFTH or 10.1) - 0.5, Z_MMAST, 0.32, dy=-1.2)
box(bmg, -3.60, 3.60, -28.9, -28.2, 24.6, 25.1)
GUNS.append(('mainmast', -28.7, round(Z_MMAST, 2)))

# ── 航空設備：兩具彈射器（量到 21.3 m 長、3.8 m 寬、頂 8.54）與艦尾吊車
for _s in (1, -1):
    box(bmg, _s * 4.11, _s * 7.90, -83.3, -62.0, 6.52, 8.54)
GUNS.append(('catapults', -72.6, 8.54))
# 艦尾吊車：圓形基座在 y −87.2（近艦尾端），立柱到 14.4，**吊臂朝艦首**伸到
# y −78.8，另有一根背拉桿由柱頂斜下到 y −91.6。
# 第一版把臂做成朝艦尾（負責人指出「應該是一個向前延伸的機械臂」）：中線縱剖
# 在 y −79…−91 是一條由 15.0 降到 9.8 的斜線，只看那條會以為柱在前、臂在後。
# 真正的順序要看側視近照 —— 柱在**後**、臂朝前伸出去吊水上機，背拉桿才是往後
# 那一根。這是 S13「近照確認是什麼」的又一例。
hex_prism(bmx, 0.0, -87.20, 1.70, deck_z(-87.2) - 0.4, 7.30)
taper(bmg, -0.55, 0.55, -88.2, -86.6, 7.00, 14.40, 0.55)
tri_rod(bmg, (0.0, -87.40, 14.10), (0.0, -78.80, 14.85), 0.30)
# 背拉桿的下端要**踩到甲板上**。照參考模型的 y −91.9 / z 8.4 放，末端會浮在
# 空中 2.3 m —— 那裡參考模型有艦尾的護牆與雜項，我們沒做。
tri_rod(bmg, (0.0, -87.40, 14.10), (0.0, -90.60, deck_z(-90.6) + 0.25), 0.26)
GUNS.append(('crane', -87.2, 14.40))
finish(bmg)
GUNS_OBJ = new_object('WICHITA_Guns', bmg, [M_ACC])
LOG['guns'] = GUNS

# 三座砲塔的砲座與 40 mm 的護牆桶都是**船體凸出**（船體色），併回 Super。
finish(bmx)
_me = bpy.data.meshes.new('tmp_bmx')
bmx.to_mesh(_me); bmx.free()
_bm = bmesh.new()
_bm.from_mesh(SUPER_OBJ.data)
_bm.from_mesh(_me)
finish(_bm)
_bm.to_mesh(SUPER_OBJ.data); _bm.free()
bpy.data.meshes.remove(_me)


# ═══════════════════════ 4. 刪掉看不到的面 ═══════════════════════
def strip_buried_faces(objs, margin=0.05, skip=()):
    """刪掉整片埋在別件體積內的面。

    拉遠之後兩片面互相閃爍**不是靠挪高度治得好的**：185 m 級的物件在幾公里外，
    深度緩衝的精度只剩幾公尺。唯一有效的是讓其中一片不存在。
    三方向投票（單一方向會被彼此相接的方塊騙倒）、逐頂點判（只看面心會把埋
    一半的面整片刪掉）。
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
            n, o_ = 0, p.copy()
            while n < 24:
                h = tree.ray_cast(o_ + d * 1e-4, d, 500.0)
                if h[0] is None:
                    break
                o_ = h[0] + d * 1e-4
                n += 1
            if n % 2 == 1:
                votes += 1
        return votes >= 2

    removed = {}
    for o in objs:
        if o.name in skip:
            continue
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
            removed[o.name] = len(kill)
        b.to_mesh(o.data); b.free()
    return removed


PARTS = list(COLL.objects)
# 船體自己**不刪面**（只當遮蔽體）：甲板頂是整片跨全寬的四邊形，小艇壓在它的
# 舷側那一段上，三方向投票偶爾把整片判成埋住的 —— 刪掉就是甲板破兩個洞。
# 該刪的是坐在甲板上那些方塊的底面，那些在 Super／Guns 這一邊。
LOG['buried_faces_removed'] = strip_buried_faces(PARTS, skip=('WICHITA_Hull',))
_bh = bmesh.new(); _bh.from_mesh(HULL.data)
LOG['hull_holes'] = [tuple(round(v, 1) for v in ((e.verts[0].co + e.verts[1].co) / 2))
                     for e in _bh.edges if len(e.link_faces) == 1]
_bh.free()
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
print('WICHITA LOG', LOG)
