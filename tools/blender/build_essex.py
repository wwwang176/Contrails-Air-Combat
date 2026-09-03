# -*- coding: utf-8 -*-
"""
USS Essex CV-9：在 Blender 裡對著參考模型直接量、直接 loft（2026-09-03）。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_essex.py', encoding='utf-8').read())
沒有 Ref_Essex 時會先把 ref/uss_essex_cv-9.glb 匯進來對齊；有就直接建。

座標：Blender 系 X 橫向（+X 右舷）、+Y 艦首、Z 上，原點在水線 × 艦體中點 ×
中線；export_yup 之後是遊戲的 X 橫向、Y 上、−Z 艦首（與飛機同一套）。

【對齊怎麼實證的】參考模型原始朝向是艦首 −Y、艦島 −X，兩條獨立證據：
  艦首   y −124.66 那一站的水線半寬只有 0.25（刀口），y +130.50 那一端在
         z +6 以下整段沒有船體（艦尾懸伸）——細的那一端是艦首
  艦島   甲板以上 z 25…45 的結構全部落在 −X；真船的艦島在右舷
兩者同時成立 ⇒ 繞 Z 轉 180° 之後艦首 +Y、艦島 +X，兩條都對。

【尺寸：史實優先】以史實全長 265.79 m 均勻縮放之後，量到的水線寬 29.47 比
史實 28.35 大 4%，而飛行甲板寬 33.0 與史實 108 ft = 32.92 只差 0.3%。依
aircraft-from-reference 的坑 21（有史實值但對不上 → 史實值優先），**船體的
半寬整體乘 0.962 收回 28.35，甲板照量的用**。兩者各自對回自己的史實值。
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\uss_essex_cv-9.glb"
LOA = 265.79          # 史實全長（短艦體 Essex）
BEAM_WL = 28.35       # 史實水線寬
REF_DECK_Z = 18.06    # 參考模型的飛行甲板面（量到的，整段是平的）—— **量測一律用它**
DECK_Z = REF_DECK_Z + 0.24   # 我們的甲板頂：抬 24 cm
DECK_T = 0.60         # 甲板板厚（參考模型的甲板是零厚度的一片面，厚度是我們給的）
# 【為什麼要抬】甲板底面原本落在 17.46，而走廊分段的頂量化到 0.5 的格子上、最高
# 那一格是 17.5 —— 兩者差 4 cm，共面檢查（4 mm）過得了，遊戲裡遠看還是會閃。
# 抬 24 cm 之後甲板底面是 17.70：走廊頂 ≤17.6 在它下面 10 cm，船體頂 17.80 埋在
# 板子**裡面**（相交不會閃，共面才會）。代價是甲板絕對高度比量到的高 0.24 m。
# 船體／機庫側壁的頂：**埋進甲板板裡 0.26**，不要剛好等於甲板底面 —— 齊平的話
# 船體的頂蓋與甲板的底面完全共面，共面檢查會抓到，遊戲裡是閃爍（負責人 2026-09-03
# 的要求）。相交不會閃，共面才會。
HULL_TOP = DECK_Z - 0.45
# 坐在某個面上的東西一律往下埋這麼多。**齊平就是共面，共面就是閃爍** —— 而且
# repo 的共面檢查（面心 4 mm 內）抓不到「大小差很多」的那種：艦島底面 7×35 m 與
# 甲板頂面 35×261 m 的面心差了幾十公尺，檢查看不到，遊戲裡拉遠就在閃。
SINK = 0.10
WIRES = {'Object_118', 'Object_140', 'Object_166'}   # 鋼索天線（坑 37）


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
    me = bpy.data.meshes.new('Ref_Essex')
    bm.to_mesh(me); bm.free()
    ref = bpy.data.objects.new('Ref_Essex', me)
    bpy.context.scene.collection.objects.link(ref)
    ys = [v.co.y for v in me.vertices]
    S = LOA / (max(ys) - min(ys))                      # ×1499.4（原始檔是 1/1500 尺度）
    me.transform(Matrix.Scale(S, 4) @ Matrix.Rotation(math.pi, 4, 'Z'))
    ys = [v.co.y for v in me.vertices]
    me.transform(Matrix.Translation(Vector((0, -(max(ys) + min(ys)) / 2, 0))))
    return ref


if 'Ref_Essex' not in bpy.data.objects:
    import_and_align_ref()
O = bpy.data.objects
LOG = {}
PLANES = []          # 已經用掉的水平面高度（見 clear_base）

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


M_BODY = mat('ESSEX_Body', srgb(0x565f66))    # 舷側灰（Measure 21 海軍灰）
M_DECK = mat('ESSEX_Deck', srgb(0x3b3b39))    # 甲板深灰（塗裝過的木甲板）
M_ACC = mat('ESSEX_Accent', srgb(0x2b2e30))   # 砲、桅、俥葉

# ───────────────────────── 場景 ─────────────────────────
for o in list(O):
    if o.name.startswith('ESSEX_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('ESSEX')
if COLL is None:
    COLL = bpy.data.collections.new('ESSEX'); bpy.context.scene.collection.children.link(COLL)


def new_object(name, bm, mats, wire=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if wire:
        ob.display_type = 'WIRE'; ob.hide_render = True
    return ob


def boolean_apply(ob, cutter, op='DIFFERENCE'):
    """把布林**烘進 mesh**（切割盒留在檔裡，改範圍重跑就好）。"""
    md = ob.modifiers.new('B', 'BOOLEAN')
    md.operation = op; md.object = cutter; md.solver = 'EXACT'
    if hasattr(md, 'material_mode'):
        md.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me
    me.name = ob.name
    bpy.data.meshes.remove(old)
    return ob


# ───────────────────────── 量尺 ─────────────────────────
bm = bmesh.new()
bm.from_mesh(O['Ref_Essex'].data)
bmesh.ops.triangulate(bm, faces=bm.faces)
REF = BVHTree.FromBMesh(bm)
bm.free()


def hit(o_, d_, L=600.0):
    return REF.ray_cast(Vector(o_), Vector(d_).normalized(), L)[0]


def top_at(x, y):
    h = hit((x, y, 70.0), (0, 0, -1))
    return h.z if h else None


def top_below(x, y, z0=REF_DECK_Z - 0.66):
    """由 z0 往下打，回報打到的第一個面（預設由**參考模型**甲板底下 6 cm 起）。"""
    h = hit((x, y, z0), (0, 0, -1), 60.0)
    return h.z if h else None


def bottom_at(x, y):
    h = hit((x, y, -40.0), (0, 0, 1))
    return h.z if h else None


def halfw(y, z):
    """該站該高度的半寬：左右各打一條，取有值的較大者（船體本來就對稱）。"""
    w = []
    for sgn in (1, -1):
        h = hit((sgn * 60.0, y, z), (-sgn, 0, 0))
        if h is not None:
            w.append(abs(h.x))
    return max(w) if w else None


# ───────────────────────── 通用 loft ─────────────────────────
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
    """軸對齊方盒（回傳給 bmesh，法線由 finish 統一重算）。"""
    p = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    v = [bm.verts.new(q) for q in p]
    for f in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        try:
            bm.faces.new([v[i] for i in f])
        except ValueError:
            pass


def box_split_top(bm, x0, x1, y0, y1, z0, z1, xs):
    """方盒，但**頂面在 xs 切成兩塊**。

    走廊外凸到甲板邊之外：頂面跨過甲板邊，靠內那半被甲板蓋住（拉遠會跟甲板搶
    深度），靠外那半看得到。切成兩塊之後，只有靠內那塊會被 `under_deck_shadow`
    刪掉，外凸的地方不會破洞（負責人指出整片刪會破）。
    """
    xs = min(max(xs, x0 + 0.05), x1 - 0.05)
    lo = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    vb = [bm.verts.new((px, py, z0)) for px, py in lo]
    vt = [bm.verts.new((px, py, z1)) for px, py in lo]
    vs0 = bm.verts.new((xs, y0, z1)); vs1 = bm.verts.new((xs, y1, z1))
    for f in ([vb[3], vb[2], vb[1], vb[0]],
              [vb[0], vb[1], vt[1], vt[0]], [vb[1], vb[2], vt[2], vt[1]],
              [vb[2], vb[3], vt[3], vt[2]], [vb[3], vb[0], vt[0], vt[3]],
              [vt[0], vs0, vs1, vt[3]], [vs0, vt[1], vt[2], vs1]):
        try:
            bm.faces.new(f)
        except ValueError:
            pass


def tri_barrel(bm, x_c, z_c, y0, y1, r):
    """砲管：沿 +Y 的細長三角柱（負責人指定的形狀）。三角剖面比方盒少一片側面，
    低多邊形下讀起來更像砲管。"""
    ang = (0.0, math.pi * 2 / 3, math.pi * 4 / 3)   # 轉 30°：沒有水平面
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


def taper(bm, x0, x1, y0, y1, z0, z1, shrink):
    """上小下大的錐台（桅、煙囪用）。shrink 是頂面相對底面的比例。"""
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    lo = [(cx - hx, cy - hy), (cx + hx, cy - hy), (cx + hx, cy + hy), (cx - hx, cy + hy)]
    hi = [(cx + (px - cx) * shrink, cy + (py - cy) * shrink) for px, py in lo]
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


def finish(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ═══════════════════════ 1. 船體 ═══════════════════════
# 站位：艦首與艦尾加密（線型變化快），舯段放疏。
HULL_Y = ([132.8, 132.0, 130.5, 128.5, 126.0, 123.0, 119.0, 114.0, 108.0, 101.0, 93.0, 84.0]
          + [74.0, 62.0, 50.0, 38.0, 26.0, 14.0, 2.0, -10.0, -22.0, -34.0, -46.0]
          + [-58.0, -70.0, -80.0, -89.0, -97.0, -104.0, -110.0, -115.0, -119.0, -122.5]
          + [-125.5, -128.0, -130.0, -131.5])
# 剖面的高度分級（由龍骨到船體頂的比例）；底部密（舭部轉圜），上半疏（舷側幾乎垂直）
LEV = [0.0, 0.05, 0.11, 0.19, 0.29, 0.42, 0.58, 0.78, 1.0]
W_FIX = BEAM_WL / 2 / 14.735   # 半寬修正 ×0.962：量到的舯半寬 14.735 → 史實 14.175
Z_MEASURE_TOP = 12.0           # 這高度以上量到的是舷側平台與甲板懸伸，不是船體
W_MAX = 14.74                  # 舯半寬 14.735 是全船最大值；超過的一定是舷側平台（z 11.9 就開始有）


def keel_z(y):
    """該站的船底。

    **艦尾不能只打中線**：中線下面是尾鰭（一片薄鰭，一路帶到俥葉與舵），量到的
    龍骨線因此在 y −89 是 −6.53、−104 又掉回 −9.45，側視上是一道階。離軸 1.5 m
    的兩條射線打不到鰭，取三條裡最高的就自動排掉它。

    **艦首反過來只能打中線**：那裡的斷面是刀口（水線半寬 0.25），離軸 1.5 m 的
    射線打到的是上面外飄的舷側，回報的「船底」在 z +5.47 —— 側視疊圖上艦首整條
    少了一塊。尾鰭只在艦尾，所以照 y 分段就好。
    """
    z_mid = bottom_at(0.0, y)
    if y > 0.0:
        return z_mid
    zs = [z for z in (z_mid, bottom_at(1.5, y), bottom_at(-1.5, y)) if z is not None]
    return max(zs) if zs else None


def hull_section(y):
    """回傳 (龍骨 z, 船體頂 z, [半寬 …] 由下往上)；量不到就回 None。

    船體一律封到甲板底下（`HULL_TOP`）。艦尾那個凹陷不在這裡做 —— 它是一顆
    切割盒（見第 1b 節，負責人裁決：船體維持原本，用裁切盒處理）。
    """
    z0 = keel_z(y)
    if z0 is None or z0 > HULL_TOP - 1.0:
        return None
    z_top = HULL_TOP
    pts = []
    for t in LEV:
        z = z0 + (z_top - z0) * t
        zq = min(z, Z_MEASURE_TOP)              # 12 m 以上維持 12 m 量到的寬度
        w = halfw(y, zq + 0.02)
        if w is not None and w > W_MAX:
            w = W_MAX
        pts.append([w, z])
    # 量不到的用上下有效值內插／外推；最底一定收到接近中線
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
    pts[0][0] = min(pts[0][0], 0.35)            # 龍骨線
    for i in range(1, len(pts)):                 # 由下往上不得變窄（舭部到舷側）
        pts[i][0] = max(pts[i][0], pts[i - 1][0])
    return z0, z_top, [w * W_FIX for w, _ in pts]


def smooth(vals, passes=2, lam=0.5):
    """站間拉普拉斯平滑（站距不等距，照 y 加權；坑 19）。兩端不動。"""
    out = list(vals)
    for _ in range(passes):
        new = list(out)
        for i in range(1, len(out) - 1):
            y0, y1, y2 = HULL_Y[i - 1], HULL_Y[i], HULL_Y[i + 1]
            f = (y1 - y0) / (y2 - y0)
            new[i] = out[i] + lam * (out[i - 1] + (out[i + 1] - out[i - 1]) * f - out[i])
        out = new
    return out


# 逐站量 → 逐級平滑 → 再組環。先平滑再組環，才不會把量測雜訊烘成波浪的舷側。
sections = [hull_section(y) for y in HULL_Y]
idx = [i for i, s in enumerate(sections) if s is not None]
HULL_Y = [HULL_Y[i] for i in idx]
sections = [sections[i] for i in idx]
keels = smooth([s[0] for s in sections])
tops = smooth([s[1] for s in sections])
levels = [smooth([s[2][k] for s in sections], passes=3) for k in range(len(LEV))]

bmh = bmesh.new()
rings = []
for i, y in enumerate(HULL_Y):
    z0 = keels[i]
    ws = [levels[k][i] for k in range(len(LEV))]
    zs = [z0 + (tops[i] - z0) * t for t in LEV]
    right = list(zip(ws[1:], zs[1:]))
    ring = [Vector((0.0, y, z0))]
    ring += [Vector((w, y, z)) for w, z in right]
    ring += [Vector((-w, y, z)) for w, z in reversed(right)]
    rings.append(ring)
vs = loft(bmh, rings)
cap(bmh, vs[0])                      # 艦首端
cap(bmh, vs[-1], reverse=True)       # 艦尾（方尾）
finish(bmh)
PLANES.append(HULL_TOP)
HULL = new_object('ESSEX_Hull', bmh, [M_BODY, M_ACC])

# ── 1b. 艦尾裁切盒 ──
# 側視上艦尾是**一刀切**（負責人指定）：飛行甲板照舊懸在外面，底下由這一站起
# 整段橫向挖掉。位置量得出來 —— 逐高度取參考模型的最後端點：
#
#     z      17    16    15    14    13    12    11    10     9
#     參考  -130  -130  -124  -124  -131  -133  -133  -133  -133
#
# z 14…15 往前縮 5.6 m，切口就在 y −124.4；切口底取那底下量到的尾樓甲板高度
# （−126／−128／−130 三站量到 9.16…9.62）。盒子留在檔裡（線框、不算圖），
# 要改範圍就改這兩個數字或直接在 Blender 裡拉盒子重跑。
NOTCH_Y = -124.40
_nz = sorted(z for z in (top_below(x, y, 13.90) for y in (-126.0, -128.0, -130.0) for x in (0.0, 4.0))
             if z is not None and z > 6.0)
NOTCH_Z = round(_nz[len(_nz) // 2], 2) if _nz else 9.20
bmc = bmesh.new()
box(bmc, -40.0, 40.0, -140.0, NOTCH_Y, NOTCH_Z, 18.50)
finish(bmc)
CUT_STERN = new_object('Cut_SternNotch', bmc, [M_ACC], wire=True)
boolean_apply(HULL, CUT_STERN)
LOG['notch'] = (NOTCH_Y, NOTCH_Z)
LOG['hull_stations'] = len(rings)
LOG['hull_beam'] = max(abs(v.co.x) for v in HULL.data.vertices) * 2
LOG['hull_draft'] = min(v.co.z for v in HULL.data.vertices)

# ═══════════════════════ 2. 飛行甲板 ═══════════════════════
# 甲板前後端量到 +131.5 / −129.5（中線上頂面還是 18.06 的最遠站），全長 261.0，
# 史實飛行甲板 862 ft = 262.7 —— 差 0.6%。
DECK_Y = ([131.5, 130.0, 128.0, 125.5, 122.5, 119.0, 114.0, 108.0, 100.0, 91.0]
          + [80.0, 68.0, 56.0, 44.0, 32.0, 20.0, 8.0, -4.0, -16.0, -28.0, -40.0, -52.0]
          + [-64.0, -76.0, -88.0, -98.0, -106.0, -113.0, -119.0, -124.0, -127.0, -129.5])


def deck_edge(y, sgn):
    """該站甲板邊：**由甲板底下往上打**，第一個打到甲板面的 x。

    往下打會被兩件事擋掉：艦島坐在甲板上（右舷 x 9…16 整段讀不到甲板），
    舷側平台頂 17.76 離甲板只有 0.30。從 17.9 往上打兩者都不存在 —— 那個
    高度在所有平台之上、在甲板之下（參考模型的甲板是零厚度的一片面）。
    掃描由 ±19.5 起：量到的甲板邊最外是左舷 −19.25，再外面的是舷側升降機
    （−25，另外做成一塊板，見第 2b 節）。
    """
    x = sgn * 19.5
    while abs(x) > 1.0:
        h = hit((x, y, 17.90), (0, 0, 1), 3.0)
        if h is not None and abs(h.z - REF_DECK_Z) < 0.15:   # 比對的是參考模型的甲板面
            return x
        x -= sgn * 0.25
    return None


bmd = bmesh.new()
edges = []
for y in DECK_Y:
    s, p = deck_edge(y, 1), deck_edge(y, -1)
    if s is not None and p is not None:
        edges.append([y, s, p])
# 中位數濾波：舷側的小平台偶爾剛好穿過 17.9…18.06 那一層，讀成單站外擴 2～3 m
# （y 114 的 −18.25 兩側都是 −15.5）。真的甲板邊是一條圓順曲線，孤立的一站不是。
for col in (1, 2):
    src = [e[col] for e in edges]
    for i in range(1, len(edges) - 1):
        edges[i][col] = sorted(src[i - 1:i + 2])[1]
# 前後端的圓角：參考模型是齊頭切平的（y +132.0 與 −130.0 量到的還是全寬），
# 真船的甲板四個角是圓的。最後兩站各收 28% / 12% —— **這是人工定的，不是量的**
# （坑 34：量不到的就要說自己在猜）。
for i, f in ((0, 0.72), (1, 0.88), (len(edges) - 1, 0.72), (len(edges) - 2, 0.88)):
    edges[i][1] *= f; edges[i][2] *= f
drings = [[Vector((s, y, DECK_Z)), Vector((s, y, DECK_Z - DECK_T)),
           Vector((p, y, DECK_Z - DECK_T)), Vector((p, y, DECK_Z))] for y, s, p in edges]
vs = loft(bmd, drings)
cap(bmd, vs[0])
cap(bmd, vs[-1], reverse=True)
finish(bmd)
PLANES += [DECK_Z, DECK_Z - DECK_T]
DECK = new_object('ESSEX_Deck', bmd, [M_DECK])


def deck_x(y, sgn):
    """該站的甲板邊（在量到的外形上線性內插）。砲位要貼著它放，不能寫死。"""
    col = 1 if sgn > 0 else 2
    if y >= edges[0][0]:
        return edges[0][col]
    for a, b in zip(edges, edges[1:]):
        if b[0] <= y <= a[0]:
            f = (a[0] - y) / (a[0] - b[0])
            return a[col] + (b[col] - a[col]) * f
    return edges[-1][col]
LOG['deck_stations'] = len(drings)
LOG['deck_width'] = max(v.co.x for v in DECK.data.vertices) - min(v.co.x for v in DECK.data.vertices)
LOG['deck_len'] = max(v.co.y for v in DECK.data.vertices) - min(v.co.y for v in DECK.data.vertices)

# ── 2a. 舷側走廊 ──
# 船體側面（半寬 14.17）與甲板邊（左舷 −19.25、右舷 +14…16）之間那一條。量到的
# 頂面是 16.8（左舷 x −18…−22）與 16.8…17.8（右舷 x +15…+17）。剪影疊圖上不做
# 它就是甲板底下左右各一片紅翼（艦首視角的 17.7% 幾乎都是它）。
GAL_Z0, GAL_Z1 = 15.40, 17.60      # 頂埋進甲板板裡，避免與甲板底面共面


def hull_top_w(y):
    """該站船體頂緣的半寬（在烘好的站位上內插）。"""
    if y >= HULL_Y[0]:
        return levels[-1][0]
    for i in range(len(HULL_Y) - 1):
        a, b = HULL_Y[i], HULL_Y[i + 1]
        if b <= y <= a:
            f = (a - y) / (a - b)
            return levels[-1][i] + (levels[-1][i + 1] - levels[-1][i]) * f
    return levels[-1][-1]


def gal_outer(y, sgn):
    """走廊外緣：由外往內打四個高度，取最外側的那一個。

    走廊**比甲板邊還往外**（左舷量到 20.7…22.2 而甲板邊 −19.25，右舷 14.7…16.3
    對 14.25）—— 俯視疊圖上甲板外圍那一圈紅點就是它。只做到甲板邊的話那一圈
    永遠補不起來。
    """
    vals = [v for v in (halfw_side(y, z, sgn) for z in (15.0, 15.8, 16.6, 17.3))
            if v is not None and v < 26.0]
    return sgn * max(vals) if vals else None


def halfw_side(y, z, sgn):
    h = hit((sgn * 34.0, y, z), (-sgn, 0, 0), 300.0)
    return abs(h.x) if h else None


# 走廊是**一段一段的矩形平台**（負責人指出：參考模型是多個矩形、90 度轉角），
# 不是一條連續變寬的帶。做法是量完之後**量化成階**再一段一格方塊，不做平滑：
#   外緣量化到 0.5 m、平台頂量化到 0.5 m → 連續同值的站位併成一段 → 一個方塊
# 短於 4 m 的段併進前一段，免得變成一排碎塊。
GAL_STEP_X, GAL_STEP_Z, GAL_MIN_RUN = 0.5, 0.5, 4.0
GAL_DEPTH = 2.33                   # 平台厚度（頂往下這麼多）
GAL_RUNS = {1: [], -1: []}         # 建好的每一段 (y0, y1, 外緣, 頂)：砲要坐在上面
GAL_BOXES = []                     # 同上，但存成 (x0,x1,y0,y1,z0,z1)：砲要拿它做碰撞檢查
bmga = bmesh.new()
for sgn in (1, -1):
    cols = []
    y = 130.0
    while y >= -130.0:
        outer = deck_x(y, sgn)
        g = gal_outer(y, sgn)
        if g is not None and abs(g) > abs(outer):
            outer = g
        # 平台**逐站高度不同**（量到 9.8／12.9／14.4／16.1／16.8 好幾層）：單一
        # 高度做出來只蓋到最上面那一層。取外緣往內 1 m 處的頂面。
        t = top_below(outer - sgn * 1.0, y)
        if t is None or t < 8.0:
            t = GAL_Z1
        qo = sgn * round(abs(outer) / GAL_STEP_X) * GAL_STEP_X
        qt = min(round(t / GAL_STEP_Z) * GAL_STEP_Z, GAL_Z1) - 0.07   # 錯開格線
        cols.append((y, qo, qt))
        y -= 2.0
    runs = []
    for y, qo, qt in cols:
        if runs and runs[-1][2] == qo and runs[-1][3] == qt:
            runs[-1][1] = y
        else:
            runs.append([y, y, qo, qt])
    merged = []
    for r in runs:
        if merged and (merged[-1][0] - merged[-1][1]) < GAL_MIN_RUN:
            merged[-1][1] = r[1]               # 太短的段併進前一段（保留前一段的尺寸）
        else:
            merged.append(r)
    for y0, y1, qo, qt in merged:
        # 艦尾裁切線後面沒有走廊。**在這裡切，不要事後布林**：走廊是一堆互相
        # 重疊的方塊，EXACT solver 遇到自交幾何會把整段清掉（實測 y −5…−35 與
        # −81…−93 兩段整個消失，坐在上面的砲因此懸空）。
        y0, y1 = min(y0, 130.0), max(y1, NOTCH_Y + 1.0)
        if y0 - y1 < GAL_MIN_RUN:
            continue
        inner = sgn * max(min(hull_top_w(y0), hull_top_w(y1)) - 1.2, 1.0)
        if abs(qo) - abs(inner) < 0.8:         # 船體自己就頂到外緣，這一段沒有走廊
            continue
        # 頂面切在該段**最內側**的甲板邊上（整段都要在甲板底下才算被蓋住）
        ys_ = [y1 - 1.0 + i * 2.0 for i in range(int((y0 - y1 + 2.0) / 2.0) + 1)] + [y0 + 1.0]
        xs = sgn * min(abs(deck_x(q, sgn)) for q in ys_)   # 整段取最內側，不能只看兩端
        box_split_top(bmga, min(inner, qo), max(inner, qo), y1 - 1.0, y0 + 1.0,
                      qt - GAL_DEPTH, qt, xs)
        GAL_RUNS[sgn].append((y0 + 1.0, y1 - 1.0, qo, qt))
        GAL_BOXES.append((min(inner, qo), max(inner, qo), y1 - 1.0, y0 + 1.0, qt - GAL_DEPTH, qt))
        PLANES += [qt, qt - GAL_DEPTH]
finish(bmga)


def gal_seat(y, sgn):
    """該站走廊那一段的 (外緣, 頂)；那裡沒有平台就 None。

    砲位一律坐在這上面。寫死高度的話走廊一改成逐段不同高（9.8…17.6），砲就
    會有的浮在空中、有的埋進平台裡。
    """
    if y <= NOTCH_Y:            # 裁切線後面的平台已經被切割盒切掉了，那裡沒有東西可以坐
        return None
    for y0, y1, qo, qt in GAL_RUNS[sgn]:
        if y1 - 0.5 <= y <= y0 + 0.5:
            return qo, qt
    return None


GALLERY = new_object('ESSEX_Gallery', bmga, [M_BODY])

# ── 2b. 左舷舷側升降機 ──
# 量到的：y +8…+24（16 m）由甲板邊 −19.25 伸到 −25.0（5.75 m）。Essex 級的
# 招牌，剪影上一眼認得出來，所以獨立一塊而不是讓它把甲板外形整段撐開。
bme = bmesh.new()
box(bme, -25.0, -19.0, 8.0, 24.0, DECK_Z - DECK_T - 0.45, DECK_Z + 0.12)
box(bme, -24.4, -19.6, 9.0, 23.0, DECK_Z - 3.2, DECK_Z - DECK_T - 0.45)   # 底下的支撐桁架（實心簡化）
finish(bme)
PLANES += [DECK_Z + 0.12, DECK_Z - DECK_T - 0.45]
ELEV = new_object('ESSEX_Elevator', bme, [M_DECK])

# ═══════════════════════ 3. 艦島 ═══════════════════════
# 量到的高度圖（轉正後座標，x 9…16、y −21…+47）簡化成四層方塊 + 煙囪 + 三腳桅。
#   z 25.0  下三層艙間（量到 25.0 一大片）      z 28.2  艦橋
#   z 33.6  射控台／方位儀                      z 45.2  桅頂（最高點量到 48.2 是天線）
bmi = bmesh.new()
box(bmi, 9.5, 16.5, -7.0, 28.0, DECK_Z - 0.25, 25.0)  # 主體（量到 25.0 一大片；底面埋進甲板）
box(bmi, 10.0, 16.0, 0.0, 26.0, 25.0, 28.2)          # 艦橋層（28.2 那一圈）
box(bmi, 10.5, 15.5, 4.0, 20.0, 28.2, 30.5)          # 上艦橋（29…30.5）
box(bmi, 11.0, 15.0, 7.0, 17.5, 30.5, 34.5)          # 羅經艦橋／射控（33.2…34.8）
taper(bmi, 11.0, 14.2, 3.0, 10.0, 30.5, 41.6, 0.72)  # 煙囪（峰值 41.6 在 y 5.5 / x 13）
taper(bmi, 11.8, 13.6, 8.0, 10.5, 34.5, 45.2, 0.35)  # 主桅（頂 45.2）
box(bmi, 10.4, 15.0, 11.0, 11.8, 38.0, 40.6)         # 對空搜索雷達（SK 天線板）
box(bmi, 11.4, 14.0, 15.5, 16.5, 34.5, 36.3)         # 前方位儀
finish(bmi)
PLANES.append(DECK_Z - 0.25)
ISLAND = new_object('ESSEX_Island', bmi, [M_BODY])

# ═══════════════════════ 4. 砲位 ═══════════════════════
# 【位置是量出來的，不是擺出來的】第一版八座砲全部照印象擺，四座在錯的站位、
# 整組還低了 4 m（放進甲板底下的托架），是坑 22 那個病。量法與結果：
#
#   右舷雙聯裝  掃「甲板以上 18.5…24 的頂面」（艦島本體 25 以上、甲板 18.06）
#               → 全部落在 x 11…16，y +36…+48（艦島前）與 y −22…−34（艦島後），
#               砲塔頂 20.3…23.4，也就是**坐在飛行甲板高度**、甲板在那裡挖缺口
#   左舷單裝    舷側走廊整條連續（頂 16.8、x −18…−22），向外突出到 −24 的只有
#               四處：y 96、60、−42、−78
STBD_TWIN = (46.5, 37.0, -25.0, -33.0)
PORT_SINGLE = (96.0, 60.0)     # −42／−78 那兩座改坐在量到的舷側砲座上（見 SPONSONS）
# 左舷單裝坐在**走廊外面**伸出去的小托架上（量到向外突出到 −24，而甲板邊 −19.25），
# 砲塔頂 18.0 ≈ 甲板高度 —— 真船的左舷 5 吋砲在飛行甲板之下，不會擋住甲板。
GUN_PLAT_Z = 15.40
# 兩個 bmesh：**砲座平台是船體凸出，用船體色**（負責人指定），只有砲本身是深色。
bmg = bmesh.new()      # 砲塔與砲管 → ESSEX_Guns（accent）
bmgp = bmesh.new()     # 托架與砲座平台 → ESSEX_Sponsons（body）


def clear_base(z, h, gap=0.09, step=0.03, tries=12):
    """把砲的底面往下挪到「底面與頂面都離所有已登記的水平面 ≥ gap」。

    **不要再手調常數了**：甲板、走廊、砲座平台、船體頂各自有一批水平面，砲一放
    上去就會有底面或頂面剛好落在其中一個上（齊平 = 共面 = 拉遠會閃）。這裡把用過
    的高度登記在 PLANES，放砲時自己讓開。
    """
    for _ in range(tries):
        if all(abs(z - q) >= gap and abs(z + h - q) >= gap for q in PLANES):
            return z
        z -= step
    return z


def seat_on(x0, x1, y0, y1, z_base):
    """砲要坐在**腳下所有東西**的最高面上。

    只用一條往下的射線驗不出「旁邊那一段走廊比較高、把砲埋進去」——射線打到的
    是砲正下方那一格，而砲塔有 3 m 寬，跨到隔壁那一段就沉進去了（負責人看到的）。
    這裡改成拿走廊每一塊方塊做 AABB 重疊檢查，重疊就抬到那一塊的頂。
    """
    z = z_base
    for bx0, bx1, by0, by1, _bz0, bz1 in GAL_BOXES:
        if x1 > bx0 and x0 < bx1 and y1 > by0 and y0 < by1 and bz1 > z:
            z = bz1
    return z


def mount(x_c, y_c, base_z, twin):
    """砲塔 + 砲管。尺寸照 5"/38 的實物（砲座直徑 4.4 m、砲管伸出 4.4 m）。"""
    w = 2.2 if twin else 1.4
    h = 3.3 if twin else 2.6
    base_z = clear_base(seat_on(x_c - w, x_c + w, y_c - w, y_c + w, base_z) - SINK, h)
    box(bmg, x_c - w, x_c + w, y_c - w, y_c + w, base_z, base_z + h)
    for i in range(2 if twin else 1):
        dx = (i - (0.5 if twin else 0)) * 1.1
        tri_barrel(bmg, x_c + dx, base_z + h - 1.2, y_c + w - 0.3, y_c + w + 4.4, 0.32)


# 砲位一律**貼著該站量到的甲板邊**放，不能寫死 x：甲板邊在艦首艦尾由 −19.25
# 收到 −15.5，寫死的話艦首那一座整組浮在船外（第一版就是這樣）。
for y_c in STBD_TWIN:
    e = deck_x(y_c, 1)
    box(bmgp, e - 3.6, e + 1.4, y_c - 4.6, y_c + 4.6, DECK_Z - 1.5, DECK_Z - 0.10)   # 砲座平台
    PLANES += [DECK_Z - 0.10, DECK_Z - 1.5]
    mount(e - 1.6, y_c, DECK_Z - 0.10, twin=True)   # 坐在砲座平台上
for y_c in PORT_SINGLE:
    seat = gal_seat(y_c, -1)
    if seat is None:                            # 那一段沒有走廊平台，自己補一塊托架
        e = deck_x(y_c, -1)
        box(bmgp, e - 3.8, e + 0.8, y_c - 4.0, y_c + 4.0, GUN_PLAT_Z - 1.2, GUN_PLAT_Z)
        mount(e - 1.7, y_c, GUN_PLAT_Z, twin=False)
    else:
        e, top = seat
        mount(e + 1.7, y_c, top, twin=False)    # e 是左舷（負值），往內 1.7

# ── 小口徑防空砲（40 mm 四聯裝）──
# 一律「方塊 + 砲管」（負責人指定）。位置取走廊外緣的**局部凸出**（外緣減去
# ±7 m 的中位數 > 1.2 m）：左舷 y 96／86.5／78／−99.5／−108，右舷 −126。
# 參考模型把走廊做成一條連續帶，砲位只以這種凸出呈現，沒有獨立的砲塔可以量。
# 艦首那一對（y 118）與艦尾那一對（y −121）**是人工補的** —— 那兩段的外緣是
# 平的（艦首 17.0／18.3 一路到底），但真船那裡有砲位，剪影上也缺一塊。
#   左舷 y 56／−13 —— 走廊外緣由 20.7 擴到 22.2 的那兩段，取段中點。
#   右舷 −126 不放：它在裁切線後面，平台已經被切割盒切掉。
# **掛在舷側往外突出的那幾塊砲座另外做**（見下面的 SPONSONS）。
AA_PORT = (118.0, 96.0, 86.5, 78.0, 56.0, -13.0, -99.5, -108.0, -118.0)
AA_STBD = (118.0, -118.0)


def aa_mount(y_c, sgn):
    """坐在走廊那一段的頂上（見 `gal_seat`）。沒有平台的站位就不放。"""
    seat = gal_seat(y_c, sgn)
    if seat is None:
        return
    g, z = seat
    x_c = g - sgn * 1.9
    z = clear_base(seat_on(x_c - 1.35, x_c + 1.35, y_c - 1.35, y_c + 1.35, z) - SINK, 1.35)
    box(bmg, x_c - 1.35, x_c + 1.35, y_c - 1.35, y_c + 1.35, z, z + 1.35)         # 砲座
    tri_barrel(bmg, x_c, z + 1.02, y_c - 0.5, y_c + 3.6, 0.42)                # 四聯裝的砲管（一束）


for y_c in AA_PORT:
    aa_mount(y_c, -1)
for y_c in AA_STBD:
    aa_mount(y_c, 1)

# ── 舷側砲座 ──
# 掛在舷側、往外突出、砲坐在上面的那幾塊（負責人在參考模型上圈出來的）。它們在
# **z 9…14.5**，比走廊那條帶（15.0…17.3）低，第一版整批漏掉：量走廊時掃的高度
# 帶根本沒有涵蓋到它們。改掃 z 8…17.5 取最外側、再挑「減去 ±8 m 中位數 > 1.5」
# 的局部凸出，七塊全部現形。
#   (舷, y 中心, 外緣 |x|, 頂 z, 長度, 砲種)
SPONSONS = (
    (1, 27.5, 20.8, 13.00, 8.0, 'aa'),
    (1, 16.5, 20.8, 13.00, 8.0, 'aa'),
    (1, -7.0, 20.8, 13.00, 10.0, 'aa'),
    (1, -68.5, 19.9, 9.25, 8.0, 'aa'),
    (1, -100.0, 19.9, 9.00, 9.0, 'aa'),
    (-1, -42.5, 25.3, 14.50, 10.0, '5in'),
    (-1, -78.0, 25.3, 14.50, 9.0, '5in'),
)
# 艦尾平台上的兩門：裁切線後面的平台（頂 NOTCH_Z）上，參考模型在 y −129.5／−131
# 的 x ±5 讀到 9.83／11.19，比周圍的平台面（9.16）高 —— 那是兩座砲。我們的平台
# 在那一段半寬只有 5.8（船體收得比參考快），所以放在 x ±3.4 才整個踩在平台上。
for x_c in (-3.4, 3.4):
    _z = clear_base(NOTCH_Z - SINK, 1.35)
    box(bmg, x_c - 1.35, x_c + 1.35, -129.0, -126.0, _z, _z + 1.35)
    tri_barrel(bmg, x_c, _z + 1.02, -128.0, -124.0, 0.42)

for sgn, y_c, outer, top, length, kind in SPONSONS:
    x_out = sgn * outer
    _ys = [y_c - length / 2 + i * 2.0 for i in range(int(length / 2.0) + 1)] + [y_c + length / 2]
    box_split_top(bmgp, min(sgn * 9.0, x_out), max(sgn * 9.0, x_out),   # 平台：內側埋進船體
                  y_c - length / 2, y_c + length / 2, top - 2.2, top - 0.17,
                  sgn * min(abs(deck_x(q, sgn)) for q in _ys))
    PLANES += [top - 0.17, top - 2.2]
    x_c = x_out - sgn * 2.4
    if kind == '5in':
        mount(x_c, y_c, top - 0.17, twin=False)
    else:
        z = clear_base(seat_on(x_c - 1.35, x_c + 1.35, y_c - 1.35, y_c + 1.35, top - 0.17) - SINK, 1.35)
        box(bmg, x_c - 1.35, x_c + 1.35, y_c - 1.35, y_c + 1.35, z, z + 1.35)
        tri_barrel(bmg, x_c, z + 1.02, y_c - 0.5, y_c + 3.6, 0.42)
finish(bmg)
finish(bmgp)
GUNS = new_object('ESSEX_Guns', bmg, [M_ACC])
SPONSON_OBJ = new_object('ESSEX_Sponsons', bmgp, [M_BODY])

# ═══════════════════════ 5. 水線下 ═══════════════════════
# **不做俥葉、軸與舵**（負責人 2026-09-03 裁決）。船浮在海面上，那幾件永遠在
# 水線下看不到，而且它們是全船最碎的零件（四個錐 + 四根軸 + 一片舵）。

# ───────────────────────── 收尾 ─────────────────────────
def strip_buried_faces(objs, margin=0.05):
    """刪掉**埋在別的實心件裡面**的面。

    這是閃爍的根治法（負責人裁決）：兩片共面的三角形都畫出來才會爭深度，其中一片
    根本看不到（砲的底面埋在砲座平台裡、艦島底面埋在甲板板裡、走廊頂埋在甲板下），
    刪掉就沒有東西可以閃。判準是「面心往法線外挪 5 cm 之後，是不是落在別件的體積
    內」——體積測試用射線穿越次數的奇偶（每一件都是封閉實體）。**面心不夠，四個角
    都要在裡面**：只用面心的話，一半被埋住的面也會被整片刪掉，露出破口（實測側視
    剪影因此掉 1.2%）。

    代價：被刪過的件不再是封閉殼，帶符號體積那條護欄對它們失效（改用共面檢查）。
    """
    trees, bounds = {}, {}
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        trees[o.name] = BVHTree.FromBMesh(bm); bm.free()
        co = [v.co for v in o.data.vertices]
        bounds[o.name] = (min(c.x for c in co), max(c.x for c in co), min(c.y for c in co),
                          max(c.y for c in co), min(c.z for c in co), max(c.z for c in co))
    # **三個方向投票**：單一方向的奇偶測試會被「彼此相接的方塊」騙倒 —— 射線正好
    # 穿過兩塊共用的邊界面時多算或少算一次，判成「在裡面」，水線下的舷側因此被
    # 挖了兩個洞（負責人發現）。
    DIRS = (Vector((0.5773, 0.5774, 0.5772)), Vector((-0.4472, 0.8944, 0.0)),
            Vector((0.2673, -0.5345, 0.8018)))

    def inside(tree, p):
        votes = 0
        for d in DIRS:
            n, o_ = 0, p.copy()
            for _ in range(64):
                h = tree.ray_cast(o_, d, 4000.0)[0]
                if h is None:
                    break
                n += 1; o_ = h + d * 1e-4
            votes += n % 2
        return votes >= 2

    def in_bbox(nm, p, pad=0.02):
        b = bounds[nm]
        return (b[0] - pad <= p.x <= b[1] + pad and b[2] - pad <= p.y <= b[3] + pad
                and b[4] - pad <= p.z <= b[5] + pad)

    def under_deck_shadow(f):
        """朝上、而且**整片落在飛行甲板的投影底下**：從上面看被甲板擋住、從下面看
        被自己那一塊的底面擋住，兩邊都看不到。

        拉遠之後深度精度只剩幾公尺，甲板底面（17.70）與走廊頂（16.9…17.5）差的
        0.2…0.8 m 在深度緩衝裡是同一個值 —— 兩片都畫就會閃（負責人拉遠一直看到
        走廊跟甲板重疊）。把被擋住的那一片刪掉，那裡就只剩甲板在畫。
        """
        if f.normal.z < 0.99:
            return False
        c = f.calc_center_median()
        if c.z > DECK_Z - DECK_T - 0.02:
            return False
        for v in list(f.verts) + [f]:
            q = v.co if hasattr(v, 'co') else c
            if not (DECK_Y[-1] <= q.y <= DECK_Y[0]):
                return False
            if not (deck_x(q.y, -1) - 0.03 <= q.x <= deck_x(q.y, 1) + 0.03):
                return False
        return True

    removed = 0
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
        kill = []
        for f in bm.faces:
            pts = [f.calc_center_median() + f.normal * margin]
            c = f.calc_center_median()
            pts += [c + (v.co - c) * 0.92 + f.normal * margin for v in f.verts]
            if o.name != 'ESSEX_Deck' and under_deck_shadow(f):
                kill.append(f); continue
            if any(all(in_bbox(n, q) and inside(t, q) for q in pts)
                   for n, t in trees.items() if n != o.name):
                kill.append(f)
        if kill:
            bmesh.ops.delete(bm, geom=kill, context='FACES')
            removed += len(kill)
        bm.to_mesh(o.data); bm.free()
    return removed


PARTS = [ob for ob in COLL.objects if not ob.name.startswith('Cut_')]   # 切割盒不算在產物裡
LOG['buried_faces_removed'] = strip_buried_faces(PARTS)
tris = 0
for ob in PARTS:
    ob.data.calc_loop_triangles()
    tris += len(ob.data.loop_triangles)
LOG['triangles'] = tris
LOG['bbox'] = tuple(round(v, 2) for v in (
    max(max(vv.co.x for vv in ob.data.vertices) for ob in PARTS),
    max(max(vv.co.y for vv in ob.data.vertices) for ob in PARTS),
    max(max(vv.co.z for vv in ob.data.vertices) for ob in PARTS)))
print('ESSEX LOG', LOG)
