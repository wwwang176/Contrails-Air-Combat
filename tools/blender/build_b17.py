# -*- coding: utf-8 -*-
"""
B-17G-60-VE Flying Fortress：在 Blender 裡對著參考模型直接量、直接 loft。
與 A6M5 v3／Ki-84／F4F-4／F6F-5 同一條路，機身走 F4F-4 的**子彈本體 + 機背整流**分件。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_b17.py', encoding='utf-8').read())
沒有 Ref_* 時會先把 ref/1943_boeing_b-17g-60-ve_flying_fortress.glb 匯進來對齊。
匯出：use_selection=True（只選 B17_*）、export_yup=True、export_extras=True、export_apply=True

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。
本檔一律用 y（+ 為機首）；機體座標的 z 是 −y。

── 這台與四台戰鬥機不同的地方 ────────────────────────────────
1. **剖面是橢圓不是水滴。** 逐站量最寬處落在腹線→冠線的高度比例：z 機體 −3.0／
   4.5／7.0／10.0／13.0 五站全部是 **0.500**，只有機首那一站 0.625（下巴砲塔把
   腹線拉低）。所以機身環照量到的走就好，不要照戰鬥機的直覺往水滴推。
2. **機背隆起在這台是兩段**：座艙頂到無線電艙那一段是「圓剖面 + 0.33 m 的抬高
   甲板」，機體 z 5.4 之後換成背鰭整流罩一路併進垂尾。前段歸機背件、後段歸垂尾。
3. **天線是量測陷阱，而且會騙過所有平滑檢查。** 見 DROP。

── 對齊的驗收（2026-09-07 實測）────────────────────────────
    翼展   31.2589 → 縮放 ×1.011554（史實 31.62）
    翼根弦 由乾淨段 x 4.6／8.0 外推到 x = 0：LE 0.040、TE −5.984、弦長 **6.024**
           （`b17g.hull.ts` 記的是 6.018，+0.1%）
    姿態   pitch −1.03°，沿用 `src/tools/hangar.ts` 的 REFS.b17g
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\f4f\ref\1943_boeing_b-17g-60-ve_flying_fortress.glb"
SPAN = 31.62          # B-17G 翼展 103 ft 9 in
PITCH = -1.03         # 轉正的俯仰角，deg


def import_and_align_ref():
    """匯入參考模型 → 丟掉天線 → 分成不透明（Ref_Body）與透明（Ref_Glass）→ 對齊。

    【天線一定要先丟掉，它是這台最貴的量測陷阱】`Object_36` 只有 **32 個三角形**，
    是從垂尾頂拉到機身前段的兩條鋼索（做成薄片）。由上往下打中線射線時它會被讀成
    背鰭整流罩，而且讀出來是一條**斜率剛好 0.4167 的完美直線**（機體 z 6.6→12.2
    的高度 2.474→4.745）—— 平滑、單調、逐站連續，任何曲率檢查都過得了，比真值高
    0.5…1.5 m。`b17g.ts` 的垂尾註解記過同一個坑（第一版整片垂尾是照它造的）。

    分辨方法是**多打幾發看它底下有沒有東西**：機體 z 9.0、x 0.05 由上往下的交點是
    3.475（片頂）、2.245（片底）、1.618（機身冠線）—— 中間 0.63 m 是空氣。結構
    整流罩不可能懸空。另外 `Object_6` 是同一組鋼索的圓管（半徑 13 mm）、
    `Object_24`／`Object_26` 是拉到左右翼尖的兩條。

    【透明件只有一個 mesh】`Object_50`（5,806 三角形）是照材質合併的全部玻璃：
    機首罩、風擋、座艙側窗、腰窗、尾錐窗都在裡面。機身 loft 要含它（機首罩是機身
    的一部分），之後再盒切分出玻璃。
    """
    DROP = {'Object_36', 'Object_6', 'Object_24', 'Object_26'}
    GLASS = 'Object_50'
    O = bpy.data.objects
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()

    def gather(pick):
        bm = bmesh.new()
        for o in [q for q in O if q.type == 'MESH' and q.name.startswith('Object_') and pick(q.name)]:
            me = o.data.copy(); me.transform(o.matrix_world.copy())
            bm.from_mesh(me); bpy.data.meshes.remove(me)
        return bm
    body = gather(lambda n: n not in DROP and n != GLASS)
    glass = gather(lambda n: n == GLASS)

    # 匯入後的軸向：X 翼展、+Y 機尾、+Z 上。繞 Z 轉 180° 讓 +Y 變機首。
    R = Matrix(((-1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
    xs = [v.co.x for v in body.verts]
    S = SPAN / (max(xs) - min(xs))
    M0 = Matrix.Rotation(math.radians(PITCH), 4, 'X') @ Matrix.Scale(S, 4) @ R
    for b in (body, glass):
        bmesh.ops.transform(b, matrix=M0, verts=b.verts)

    tmp = body.copy(); bmesh.ops.triangulate(tmp, faces=tmp.faces)
    T = BVHTree.FromBMesh(tmp); tmp.free()

    def chord(x):
        """翼根弦。**外推的兩站要避開發動機艙，而且不能用 `b17g.hull.ts` 記的
        x 2.2…4.0** —— 那是它自己那套 uWindow 底下的乾淨段；在這裡由 y +2.5 往後
        打，x 2.2／2.6／3.0／4.0 讀到的前緣是 1.98／1.99／2.28／1.98，那是內側
        發動機艙（x 2.36…3.75）的前緣，真值在 −0.16 附近。乾淨的是 x 4.6 與 8.0，
        兩站外推回 x = 0 得弦長 6.024，對 `b17g.hull.ts` 的 6.018 差 0.1%。"""
        le = te = None
        for k in range(120):
            z = -0.45 + 1.10 * k / 119
            h = T.ray_cast(Vector((x, 2.5, z)), Vector((0, -1, 0)), 20.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -8.0, z)), Vector((0, 1, 0)), 20.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(4.6), chord(8.0)
    ex = lambda a, b: a + (b - a) * (0.0 - 4.6) / 3.4
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for b in (body, glass):
        bmesh.ops.translate(b, vec=Vector((0, -qc, 0)), verts=b.verts)

    for nm, b in (('Ref_Body', body), ('Ref_Glass', glass)):
        me = bpy.data.meshes.new(nm); b.to_mesh(me); b.free()
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(nm, me))
    for o in list(O):
        if o.name not in before and o.name not in ('Ref_Body', 'Ref_Glass'):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    return {'scale': round(S, 6), 'root_chord': [round(le_r, 3), round(te_r, 3), round(le_r - te_r, 3)],
            'qc': round(qc, 4)}


ALIGN = None
if 'Ref_Body' not in bpy.data.objects:
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
# 材質名是 `src/render/geometry/b17g.model.ts` 的 materials 對照表，不能改。
M_BODY = mat('B17_Body', srgb(0x8d9299))     # 裸鋁
M_ACC = mat('B17_Accent', srgb(0x3c4147))
M_GLASS = mat('B17_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('B17_Cockpit', srgb(0x171a1c))
M_FRAME = mat('B17_Frame', srgb(0x8d9299))
M_INNER = mat('B17_Inner', srgb(0x2a2e33))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('B17_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('B17')
if COLL is None:
    COLL = bpy.data.collections.new('B17'); bpy.context.scene.collection.children.link(COLL)

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
BODYG = bvh_of(['Ref_Body', 'Ref_Glass'])    # 機身＋玻璃：機首罩一起 loft，之後盒切
WING = bvh_of(['Ref_Body'])
def hit(T, o, d, L=24.0): return T.ray_cast(Vector(o), Vector(d), L)[0]
def zmax_at(T, x, y):
    h = hit(T, (x, y, 9.0), (0, 0, -1)); return h.z if h else None
def zmin_at(T, x, y):
    h = hit(T, (x, y, -6.0), (0, 0, 1)); return h.z if h else None
def halfw(T, y, z, x0):
    h = hit(T, (x0, y, z), (-1, 0, 0) if x0 > 0 else (1, 0, 0)); return abs(h.x) if h else None

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

# ═══════════════════════════ 1. 機身 ═══════════════════════════
# 站位由機首（y +6.28）到尾錐（−16.25）。機首那一段是玻璃罩，先一起 loft。
FUS_Y = [6.28, 6.15, 6.00, 5.80, 5.60, 5.40, 5.20, 5.00, 4.80, 4.60, 4.40, 4.20,
         4.00, 3.80, 3.60, 3.40, 3.20, 3.00, 2.80, 2.60, 2.40, 2.10, 1.80, 1.50,
         1.20, 0.90, 0.60, 0.30, 0.00, -0.40, -0.80, -1.20, -1.60, -2.00, -2.40,
         -2.80, -3.20, -3.60, -4.00, -4.40, -4.80, -5.20, -5.60, -6.00, -6.50,
         -7.00, -7.50, -8.00, -8.50, -9.00, -9.50, -10.00, -10.50, -11.00, -11.50,
         -12.00, -12.60, -13.20, -13.80, -14.40, -15.00, -15.60, -16.10,
         -16.20, -16.26]
NOSE_POLE = Vector((0, 6.33, 0.44))
# 尾錐末端。**要收成鈍圓，不是一根錐尖。** 參考模型的剖面是
#
# ```
#   機體 z    高度範圍        半寬
#   16.0     0.527…1.972    0.470
#   16.1     0.553…1.390    0.385
#   16.2     0.636…1.307    0.308
#   16.3     0.784…1.169    0.166
#   16.35    結束（之後只剩半徑 0.09…0.14 的尾砲槍管）
# ```
#
# 參考模型在 16.35 就結束，而且結束時剖面還有 0.33 × 0.385 —— 那是一個**鈍口**，
# 不是收斂到一點。
#
# 【不能用 fan 收尾】fan 是「整圈接到一個極點」，做出來是一根錐尖，由後方看是
# 一個點而不是一圈。改成再補一環（把最後一站的環照中心縮 0.55）然後**封蓋**，
# 尾端就是由左繞過後方到右的一圈。
#
# 【站位要挑量得到的】−16.32 的 `station()` 回傳 None（射線在那裡打不到），
# 那一站會被無聲丟掉，尾端於是又變回「16.20 那個 0.55 寬的環直接扇到點」。
# 16.26 量得到（頂 1.157、腹 0.801、半寬 0.181）。
#
# **末端往後挪要跟著改命中盒**：`src/specs/b17g.ts` 的「補漏 6（tail）」原本蓋到
# 機體 z 16.27，`hitbox.test.ts` 要求每一個頂點都落在至少一個盒內。
TAIL_END_Y = -16.34
TAIL_END_K = 0.55
LEVELS = 8                    # 每側 8 級 + 頂底兩尖 = 18 點/環
DLEVELS = 4                   # 機背每側的級數
W_CAP = 1.25                  # 機身實測最寬 1.172；主翼／尾翼／螺旋槳的命中一律 ≥ 1.3
W_MIN = 0.04

# ── 量不到的帶（機體 z；本檔的 y = −z）──────────────────────────
#
# 這幾塊都**另外當零件貼上去**，留在機身這一層等於同一個東西畫兩次。
#
#   下巴砲塔  機體 z −5.60…−3.00  中線腹線由 −0.381 一刀掉到 −0.984（0.2 m 內掉
#             0.60），而 x 0.55 的同一段是 −0.088 → −0.655 平滑單調。砲塔的半寬
#             只有 0.45，所以中線讀得到、x 0.55 讀不到。往後拖到 −3.00 是因為
#             砲塔的後整流一路收到那裡：x 0.03 與 x 0.30 的差由 −3.8 的 0.16
#             收到 −3.0 的 0.04。
#   球形砲塔  機體 z 4.55…5.75   中線 −0.655 → −1.263 → −0.613
#   尾輪艙    機體 z 10.15…11.10 艙是開的，向上的射線讀到艙頂 +0.36（比蒙皮還高）
#   導航員圓頂 機體 z −4.55…−4.00 中線比 x 0.30 高 0.22（鄰站只高 0.035）
#   上部砲塔  機體 z −1.50…−0.45 中線 2.369，而冠線在 1.98
BELLY_MASK = [(-5.60, -3.00), (4.55, 5.75), (10.15, 11.70)]
CROWN_MASK = [(-4.55, -4.00), (-1.50, -0.45)]
# 無線電艙頂的開放槍位。**只有中線讀得到**，所以不能用「兩端內插」那一招 ——
# 洞兩側的冠線本來就在下降，內插會把真正的斜率抹平：
#
# ```
#   機體 z   3.8    4.0    4.2    4.4    4.6    4.8
#   x 0.03  1.884  1.841  1.715  1.624  1.686  1.689   ← 掉進洞裡又爬回來
#   x 0.20  1.862  1.820  1.754  1.672  1.668  1.671   ← 平滑單調
#   x 0.55  1.552  1.535  1.540  1.547  1.552  1.554
# ```
#
# 改讀洞外的 x 0.22，再加上洞兩側量到的「中線 − 離軸」落差（3.8 是 0.022、
# 4.8 是 0.018）。負責人 2026-09-07 在算圖上圈出這個凹陷。
RADIO_HATCH = (3.90, 4.70)
HATCH_X, HATCH_D = 0.22, 0.020

# ── 翼根：主翼穿過機身那一段沒有獨立的機身蒙皮 ────────────────────────
#
# 由外往內的射線讀到的是**主翼**、由內往外讀到的是輪艙／彈艙的內壁。兩者都通得過
# 上下限檢查，所以 `ok` 是 True，`fill_bands` 不會補 —— 症狀是下半身的級線在那一段
# 整組亂掉（負責人 2026-09-07 在算圖上圈出來）：
#
# ```
#   機體 z   −1.5   −1.2   −0.9   −0.6   −0.3    0.0    0.4    0.8    1.2    1.6
#   L1 半寬  0.732  0.780  0.921  1.151  0.041  1.096  0.041  0.278  0.262  0.866
#   L4 半寬  1.165  1.176  1.198  0.936  1.146  1.146  1.136  1.082  0.975  1.174
# ```
#
# 0.041 就是 W_MIN 的下限值。**不能靠調上下限救** —— 1.15 與真值 1.16 只差 1 cm。
# 做法與 F4F 相同：把主翼厚度帶內的取樣直接判為「量不到」，交給 `fill_bands`
# 沿 **y** 補。翼根前（機體 z −2.1）與翼根後（5.2）兩站的同一級是
# L1 0.727／0.746、L2 0.972／1.008、L3 1.122／1.141、L4 1.163／1.158 ——
# 機身在那一段本來就幾乎等剖面，線性內插就是真值。
WING_BAND_ZB = (-1.75, 4.75)
WING_BAND_Z = (-0.80, 0.70)


def _masked(zb, bands):
    return any(a <= zb <= b for a, b in bands)

def _band_interp(zb, bands, f):
    """遮罩帶內用兩端的實測值線性內插。"""
    for a, b in bands:
        if a <= zb <= b:
            va, vb = f(a - 0.02), f(b + 0.02)
            if va is None or vb is None: return None
            return va + (vb - va) * (zb - a) / (b - a)
    return None


# 背鰭整流罩併進垂尾的那一點：機體 z 5.20 之後中線的射線讀到的是**背鰭**不是機身。
FIN_START_Y = -5.20


CROWN_X = 0.35        # 離軸量冠線的位置
def _wmax_at(y, ztop, zbot):
    """剖面中段（高度 25%…65%）的最大半寬。取中段是為了避開水平尾翼 —— 它在
    尾錐段的高度落在 1.05…1.45，正好是剖面的上四分之一。"""
    best = 0.0
    for k in range(19):
        z = zbot + (ztop - zbot) * (0.25 + 0.40 * k / 18)
        w = halfw(BODYG, y, z, 2.0)
        if w is not None and W_MIN < w <= W_CAP: best = max(best, w)
    return best


def crown_raw(y):
    """冠線。機體 z 5.20 之後**不能打中線**，改用 x 0.35 加一個由剖面寬度算出來的補正。

    【為什麼不能用中線】背鰭整流罩由機體 z 5.4 起長在機身上，半厚只有 0.15…0.20，
    中線的射線一路讀到它（機體 z 9.0 讀 2.279，而機身冠線在 1.68 附近），再往後
    直接讀成垂尾（z 13.8 讀 **5.631** —— 那是垂尾頂）。整流罩與垂尾都是另外的零件，
    留在機身這一層等於同一個東西畫兩次，而且尾錐會被拉成一片牆。

    【補正怎麼來】剖面頂端接近橢圓，z(x) ≈ zc − (h / 2w²)·x²，機身這一段 h ≈ w，
    所以補正 = x² / 2w = 0.1225 / (2 · wmax)。這條式子在**還沒有整流罩**的機體
    z 4.5 可以直接對答案：wmax 1.171 → 補正 0.052，1.636 + 0.052 = **1.688** 對
    中線實測 **1.684**，差 4 mm。往尾錐走剖面變窄（wmax 0.55），補正自己長到 0.11。

    【不要用「兩個離軸點外推」】試過 x 0.35 與 0.70：**x 0.70 在機體 z 11.5…12.0
    讀到的是水平尾翼的上表面**（1.439／1.437，而 z 11.0 是 1.355），外推出來的
    冠線在那兩站往上跳。中段寬度那一條沒有這個失敗模式。"""
    zb = -y
    if RADIO_HATCH[0] <= zb <= RADIO_HATCH[1]:
        v = zmax_at(BODYG, HATCH_X, y)
        if v is not None: return v + HATCH_D
    if y > FIN_START_Y:
        return zmax_at(BODYG, 0.03, y)
    za = zmax_at(BODYG, CROWN_X, y)
    if za is None: return zmax_at(BODYG, 0.03, y)
    zb0 = zmin_at(BODYG, CROWN_X, y)
    if zb0 is None: zb0 = za - 2.0
    w = _wmax_at(y, za, zb0)
    return za + (CROWN_X * CROWN_X) / (2 * w) if w > 0.05 else za


def belly_raw(y):
    return zmin_at(BODYG, 0.03, y)


def _despike(zs, ws):
    """水平尾翼穿過尾錐，射線在它的前後緣附近會讀到翼面而不是機身（機體 z 12.0
    高度 1.10 讀 1.192，鄰樣本是 0.843）。**不能整條高度帶作廢** —— 那一帶在尾錐
    就是剖面的上四分之一，整段丟掉之後 fill_bands 會沿 y 從前面的站位照抄，尾錐
    的收斂整個被凍住（實測 y −11.5 到 −16.1 最大半寬全部卡在 0.933）。
    改成只挑單點：比左右最近的有效樣本都大 25% 以上就丟。"""
    n = len(ws)
    out = list(ws)
    for i in range(n):
        if ws[i] is None: continue
        lo = next((ws[j] for j in range(i - 1, -1, -1) if ws[j] is not None), None)
        hi = next((ws[j] for j in range(i + 1, n) if ws[j] is not None), None)
        nb = [v for v in (lo, hi) if v is not None]
        if nb and ws[i] > 1.25 * max(nb): out[i] = None
    return out

# 【機首兩側的砲位是**錯開的**：一側凸出、另一側是平的】剖面一律由右側量
# （`halfw` 的 x0 = +2），機體 z −4.04…−4.82 那一段右側是**凸出來的砲位泡罩**，
# 量到的半寬會被抬 6…9 cm；照樣鏡射到左邊，左舷就多出一條又長又淺的稜線 ——
# 側視的明暗帶在機體 z −4.0 附近折一下，正是「不平順」的來源。
#
# 逐點對照（高度 0.80，[右, 左]）：
#
# ```
#   機體 z   −3.9    −4.2    −4.5    −4.8
#   右       1.008   0.997   1.014   0.838
#   左       1.010   0.963   0.906   0.835
# ```
#
# 右側從 −4.0 起不再收，到 −4.5 反而長回 1.014，−4.8 一刀掉到 0.838；左側
# 0.996 → 0.835 是一條直線。**左側才是蒙皮**。機體 z −4.91…−5.32 換成左側凸出，
# 但那一段預設就量右側，不必處理。
#
# 不能用「整條高度帶作廢再內插」：那一段是剖面的整個中腰，作廢之後由 0.33 與
# 1.00 兩點拉直線，機體 z −4.4 高度 0.70 會從 0.967 掉到 0.914，比泡罩的誤差還大。
# 錯開的好處就是**另一側一定是乾淨的**，直接換邊量。
BLISTER_SWAP = [(-4.85, -3.98, 0.33, 1.00)]


def _in_swap(zb, z):
    return any(a <= zb <= b and c <= z <= d for a, b, c, d in BLISTER_SWAP)


def station(y):
    T = BODYG
    zb = -y
    top = _band_interp(zb, CROWN_MASK, lambda q: crown_raw(-q)) if _masked(zb, CROWN_MASK) else crown_raw(y)
    bot = _band_interp(zb, BELLY_MASK, lambda q: belly_raw(-q)) if _masked(zb, BELLY_MASK) else belly_raw(y)
    if top is None: top = crown_raw(y)
    if bot is None: bot = belly_raw(y)
    if top is None or bot is None or top <= bot: return None
    n = max(14, int((top - bot) / 0.02))
    zs, ws, ok = [], [], []
    for i in range(n + 1):
        z = bot + (top - bot) * i / n
        # 由外往內優先：第一個交點必然是最外層的蒙皮。打不到機身時讀到的是主翼
        # 或槳葉（≥ 1.3），上限一擋就掉。
        sg = -1.0 if _in_swap(zb, z) else 1.0        # 砲位泡罩那一段改量另一側
        w1 = halfw(T, y, z, 2.0 * sg)
        w2 = hit(T, (0.0, y, z), (sg, 0, 0), 2.0)
        w2 = abs(w2.x) if w2 else None
        w = None
        for c in (w1, w2):
            if c is not None and W_MIN < c <= W_CAP: w = c; break
        if (WING_BAND_ZB[0] <= zb <= WING_BAND_ZB[1]
                and WING_BAND_Z[0] <= z <= WING_BAND_Z[1]): w = None
        zs.append(z); ws.append(w)
    ws = _despike(zs, ws)
    ok = [v is not None for v in ws]
    valid = [i for i, v in enumerate(ws) if v is not None]
    if not valid: return None
    fixed = []
    for i, w in enumerate(ws):
        if w is not None: fixed.append(w); continue
        lo = max([j for j in valid if j < i], default=None)
        hi = min([j for j in valid if j > i], default=None)
        if lo is None: fixed.append(ws[hi])
        elif hi is None: fixed.append(ws[lo])
        else: fixed.append(ws[lo] + (ws[hi] - ws[lo]) * (zs[i] - zs[lo]) / (zs[hi] - zs[lo]))
    fixed[0] = 0.0; fixed[-1] = 0.0
    ok[0] = ok[-1] = True
    return {'y': y, 'top': top, 'bot': bot, 'z': zs, 'w': fixed, 'ok': ok}


def resample(s, L=LEVELS):
    zs, ws, oks = s['z'], s['w'], s['ok']; out = []
    for k in range(1, L + 1):
        t = k / (L + 1)
        zz = s['bot'] + (s['top'] - s['bot']) * (0.5 - 0.5 * math.cos(math.pi * t))
        for i in range(len(zs) - 1):
            if zs[i] <= zz <= zs[i + 1]:
                f = (zz - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0
                out.append((ws[i] + (ws[i + 1] - ws[i]) * f, zz, oks[i] and oks[i + 1])); break
        else:
            out.append((ws[-1], zz, oks[-1]))
    return out


def w_at(s, z):
    zs, ws = s['z'], s['w']
    if z <= zs[0]: return ws[0], s['ok'][0]
    if z >= zs[-1]: return ws[-1], s['ok'][-1]
    for i in range(len(zs) - 1):
        if zs[i] <= z <= zs[i + 1]:
            f = (z - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0.0
            return ws[i] + (ws[i + 1] - ws[i]) * f, (s['ok'][i] and s['ok'][i + 1])
    return ws[-1], s['ok'][-1]


def span_levels(s, z0, z1, L):
    out = []
    for k in range(1, L + 1):
        t = k / (L + 1)
        zz = z0 + (z1 - z0) * (0.5 - 0.5 * math.cos(math.pi * t))
        out.append((w_at(s, zz)[0], zz))
    return out


STA = []
for y in FUS_Y:
    s = station(y)
    if s is not None: STA.append(s)
# 尾段的冠線必須單調收斂：外推公式在尾錐末端（半寬只剩 0.28）會回抖幾十 mm。
for a, b in zip(STA, STA[1:]):
    if b['y'] <= FIN_START_Y and b['top'] > a['top']: b['top'] = a['top']
LOG['n_sta'] = len(STA)

# ── 機背（抬高甲板）是獨立的一件 ────────────────────────────────
#
# 【這台的機背與 F4F 不同：不是龜背，是「圓剖面 + 抬高的甲板」】機體 z 0.0 那站
# 最寬 1.172 落在高度 0.50，圓的頂端因此在 1.67，而冠線量到 2.00 —— 高出 0.33。
# 那 0.33 就是座艙頂到無線電艙的抬高甲板，也就是機背件。到機體 z 4.5 之後
# （最寬 1.171 在 0.519、冠線 1.636）差只剩 −0.05，甲板收完，機背件在那裡收尾。
#
# 前端收在風擋（機體 z −3.0）：再往前是機首玻璃罩，那一段沒有甲板。
#
# 【後端收在 3.60，不要拖到 4.6 以後】甲板高度（冠線 − 剖面圓的頂端）逐站量：
#
# ```
#   機體 z    4.8     5.2     5.6     6.0     6.5     7.0
#   甲板高  −0.014  −0.008  −0.011  −0.011  −0.012  −0.014
# ```
#
# 也就是**那一段的剖面就是一個圓、冠線正好是圓頂，根本沒有甲板**。第一版把
# 機背拖到 6.0 才收完，負責人 2026-09-07 在算圖上圈出來：「這段是不是沒必要?」
# —— 對的，那一段屬於機身。現在後端 3.60、再兩站（4.0／4.4）收到零。
DORSAL_ZB = (-3.00, 3.60)     # [前, 後]，機體 z
DORSAL_Y = (-DORSAL_ZB[1], -DORSAL_ZB[0])


def circle_top(s):
    """剖面「圓的頂端」＝ 最大半寬那一點的高度 + 半寬。

    【折線要放在這裡，不是放在曲率膝點】膝點量到的是艙緣，由風擋的 1.518 一路
    掉到 1.296，比真正的甲板底低 0.26；而級數是腹線到折線的固定比例，八條腰線
    因此整組跟著下沉（實測第 6 級由 1.207 降到 1.057 再回升，中間凹 15 cm）——
    負責人 2026-09-08 圈出來的就是這個。折線是構造線、抬高不動外皮，所以直接
    放在量到的圓頂上：機背件於是正好等於「抬高的甲板」那一塊。

    主翼穿過機身那一段整個下半身是補出來的（見 WING_BAND_ZB），最寬的有效取樣
    落在補值區的下緣，算出來的圓頂會虛高 0.27。那幾站回傳 None，交給沿 y 內插。
    """
    # **首尾兩個極點要跳過** —— `station()` 把它們強制標成 ok，不跳的話主翼段的
    # 「最寬有效取樣」就不落在補值區下緣，下面那個 None 判斷會失效，圓頂虛高
    # 0.25（實測機體 z 0 讀成 1.846，真值由兩端內插是 1.598）。
    zs, ws, oks = s['z'][1:-1], s['w'][1:-1], s['ok'][1:-1]
    lo = next((z for z, ok in zip(zs, oks) if ok), None)
    if lo is None: return None
    best = None
    for z, w, ok in zip(zs, ws, oks):
        if ok and (best is None or w > best[0]): best = (w, z)
    if best is None or best[1] <= lo + 1e-6: return None
    return best[1] + best[0]


CT = [circle_top(s) for s in STA]
_ci = [i for i, v in enumerate(CT) if v is not None]
for i, v in enumerate(CT):                     # 量不到的沿 y 內插
    if v is not None: continue
    lo = max([j for j in _ci if j < i], default=None)
    hi = min([j for j in _ci if j > i], default=None)
    if lo is None: CT[i] = CT[hi]
    elif hi is None: CT[i] = CT[lo]
    else:
        t = (STA[i]['y'] - STA[lo]['y']) / (STA[hi]['y'] - STA[lo]['y'])
        CT[i] = CT[lo] + (CT[hi] - CT[lo]) * t
for _ in range(4):                             # 沿 y 平滑
    new = CT[:]
    for i in range(1, len(CT) - 1):
        a2, b2 = STA[i - 1], STA[i + 1]
        t = (STA[i]['y'] - a2['y']) / (b2['y'] - a2['y'])
        new[i] = CT[i] + ((CT[i - 1] + (CT[i + 1] - CT[i - 1]) * t) - CT[i]) * 0.5
    CT = new


def fold_of(s):
    i = STA.index(s)
    if not (DORSAL_Y[0] <= s['y'] <= DORSAL_Y[1]): return None
    return min(CT[i], s['top'] - 0.02)


for s in STA: s['fold'] = fold_of(s)
_fi = [i for i, s in enumerate(STA) if s['fold'] is not None]
# 沿 y 平滑兩輪（兩端固定）
for _ in range(3):
    _new = {}
    for k in range(1, len(_fi) - 1):
        i = _fi[k]; a, b = STA[_fi[k - 1]], STA[_fi[k + 1]]
        t = (STA[i]['y'] - a['y']) / (b['y'] - a['y'])
        _new[i] = STA[i]['fold'] + (a['fold'] + (b['fold'] - a['fold']) * t - STA[i]['fold']) * 0.5
    for i, v in _new.items(): STA[i]['fold'] = min(v, STA[i]['top'])


def _taper(i0, step, K):
    """兩端把機背高度沿 K 站線性收到零 —— 級數的意義不能一站跳掉，否則機身與機背
    各自從那一點張出一片錐面互相穿插（F4F 那一輪的教訓）。"""
    if not (0 <= i0 < len(STA)): return
    h0 = STA[i0]['top'] - STA[i0]['fold']
    for j in range(1, K + 1):
        i = i0 + step * j
        if not (0 <= i < len(STA)) or STA[i]['fold'] is not None: return
        h = h0 * max(0.0, 1.0 - j / K)
        STA[i]['fold'] = STA[i]['top'] - h
        STA[i]['taper_h'] = h            # 平滑之後要照這個高度釘回去
        STA[i]['taper'] = (j == K)
if _fi:
    _taper(_fi[0], -1, 2)      # 前端：風擋。那裡本來就是一刀，兩站就夠
    _taper(_fi[-1], +1, 2)     # 後端：機體 z 4.0／4.4 兩站收到零
_fj = [i for i, s in enumerate(STA) if s['fold'] is not None]
# 【不要壓單調】F4F 的折線是一條水滴線，由風擋往後只能降；這台的折線是剖面
# 圓的頂端，而圓心隨著腹線一路上抬 —— 量到的是機體 z −1.8 的 1.562 升到
# 4.8 的 1.695。壓單調會把它全部拉到最前面那一站的高度，腰線又會沉回去。
for _ in range(6):
    _new = {}
    for k in range(1, len(_fj) - 1):
        i = _fj[k]; a, b = STA[_fj[k - 1]], STA[_fj[k + 1]]
        t = (STA[i]['y'] - a['y']) / (b['y'] - a['y'])
        _new[i] = STA[i]['fold'] + (a['fold'] + (b['fold'] - a['fold']) * t - STA[i]['fold']) * 0.5
    for i, v in _new.items(): STA[i]['fold'] = min(v, STA[i]['top'])

for s in STA:
    s['crown'] = s['top']; s['wfold'] = 0.0; s['lvd'] = None
    if s['fold'] is None: continue
    s['lvd'] = span_levels(s, s['fold'], s['crown'], DLEVELS)
    s['wfold'] = w_at(s, s['fold'])[0]
    s['top'] = s['fold']
for s in STA:
    s['lv'] = resample(s)


def smooth_level_z(sta, passes=6, lam=0.5, room=0.30):
    """級線的絕對 z 沿 y 平滑，再回細掃剖面重新查半寬 —— 線順了，而每一點仍落在
    量到的剖面上，外皮不會漂。要在 fill_bands 之前做。"""
    base = [[z for _, z, _ in s['lv']] for s in sta]
    cur = [row[:] for row in base]
    for _ in range(passes):
        new = [row[:] for row in cur]
        for i in range(1, len(sta) - 1):
            a, b = sta[i - 1], sta[i + 1]
            t = (sta[i]['y'] - a['y']) / (b['y'] - a['y'])
            for k in range(LEVELS):
                zl = cur[i - 1][k] + (cur[i + 1][k] - cur[i - 1][k]) * t
                new[i][k] = cur[i][k] + (zl - cur[i][k]) * lam
        cur = new
    for s, row, ref in zip(sta, cur, base):
        rng = s['top'] - s['bot']
        z = [min(max(v, r - room * rng), r + room * rng) for v, r in zip(row, ref)]
        z = [min(max(v, s['bot'] + 1e-4), s['top'] - 1e-4) for v in z]
        z.sort()
        s['lv'] = [(w_at(s, v)[0], v, w_at(s, v)[1]) for v in z]


def fill_bands(sta):
    """量不到的級沿 **y** 補，不要沿 z 補（沿 z 補會把主翼那一段的下半身夾成一條縫）。"""
    for k in range(LEVELS):
        idx = [i for i, s in enumerate(sta) if s['lv'][k][2]]
        if not idx: continue
        for i, s in enumerate(sta):
            if s['lv'][k][2]: continue
            lo = max([j for j in idx if j < i], default=None)
            hi = min([j for j in idx if j > i], default=None)
            if lo is None: w = sta[hi]['lv'][k][0]
            elif hi is None: w = sta[lo]['lv'][k][0]
            else:
                a, b = sta[lo], sta[hi]
                t = (s['y'] - a['y']) / (b['y'] - a['y'])
                w = a['lv'][k][0] + (b['lv'][k][0] - a['lv'][k][0]) * t
            s['lv'][k] = (w, s['lv'][k][1], True)


smooth_level_z(STA)
fill_bands(STA)


def smooth_levels(sta, passes=2, lam=0.5, thr=0.10):
    for _ in range(passes):
        new = []
        for i, s in enumerate(sta):
            if i == 0 or i == len(sta) - 1:
                new.append((s['lv'], s['top'], s['bot'], s['crown'])); continue
            a, b = sta[i - 1], sta[i + 1]
            t = (s['y'] - a['y']) / (b['y'] - a['y'])
            lv = []
            for k in range(LEVELS):
                wa, za, _ = a['lv'][k]; wb, zb2, _ = b['lv'][k]; w, z, _ = s['lv'][k]
                wl = wa + (wb - wa) * t; zl = za + (zb2 - za) * t
                if abs(w - wl) < thr and abs(z - zl) < thr:
                    lv.append((w + (wl - w) * lam, z + (zl - z) * lam, True))
                else: lv.append((w, z, True))
            tl = a['top'] + (b['top'] - a['top']) * t
            bl = a['bot'] + (b['bot'] - a['bot']) * t
            cl = a['crown'] + (b['crown'] - a['crown']) * t
            top = s['top'] + (tl - s['top']) * lam if abs(tl - s['top']) < thr else s['top']
            bot = s['bot'] + (bl - s['bot']) * lam if abs(bl - s['bot']) < thr else s['bot']
            cr = s['crown'] + (cl - s['crown']) * lam if abs(cl - s['crown']) < thr else s['crown']
            new.append((lv, top, bot, cr))
        for s, q in zip(sta, new): s['lv'], s['top'], s['bot'], s['crown'] = q


smooth_levels(STA)
for s in STA:
    if s['fold'] is None: continue
    # 【收尾站要照著計畫的高度釘回去】smooth_levels 把折線與冠線分開平滑，收尾段的
    # 高度因此不再是線性收斂 —— 實測機體 z 4.8 的機背高度反而由 0.65 漲到 0.79，
    # 下一站才歸零，側視上緣在那裡是一道 0.1 m 的階梯。
    if 'taper_h' in s: s['top'] = s['crown'] - s['taper_h']
    s['lvd'] = span_levels(s, s['top'], s['crown'], DLEVELS)
    s['wfold'] = w_at(s, s['top'])[0]


def ring_of(s):
    """機身的一圈。頂端是折線上的**兩點**，機背從那兩點往上長；沒有機背的站位
    wfold = 0，兩點重合，finish() 的 remove_doubles 收回成極點。"""
    y = s['y']; wf = s.get('wfold', 0.0); pts = [Vector((0, y, s['bot']))]
    for w, z, _ in s['lv']: pts.append(Vector((w, y, z)))
    pts.append(Vector((wf, y, s['top'])))
    pts.append(Vector((-wf, y, s['top'])))
    for w, z, _ in reversed(s['lv']): pts.append(Vector((-w, y, z)))
    return pts


def full_ring(s):
    """機身 + 機背合起來的完整外環。給座艙內殼用 —— 縮小之後保證包在外皮裡面。"""
    y = s['y']; pts = [Vector((0, y, s['bot']))]
    for w, z, _ in s['lv']: pts.append(Vector((w, y, z)))
    if s['fold'] is not None:
        pts.append(Vector((s['wfold'], y, s['top'])))
        for w, z in s['lvd']: pts.append(Vector((w, y, z)))
    pts.append(Vector((0, y, s['crown'])))
    if s['fold'] is not None:
        for w, z in reversed(s['lvd']): pts.append(Vector((-w, y, z)))
        pts.append(Vector((-s['wfold'], y, s['top'])))
    for w, z, _ in reversed(s['lv']): pts.append(Vector((-w, y, z)))
    return pts


_rings_f = [ring_of(s) for s in STA]
_lz = 0.5 * (STA[-1]['bot'] + STA[-1]['crown'])
_rings_f.append([Vector((p.x * TAIL_END_K, TAIL_END_Y, _lz + (p.z - _lz) * TAIL_END_K))
                 for p in _rings_f[-1]])
bm = bmesh.new()
vs = loft(bm, _rings_f)
fan(bm, list(reversed(vs[0])), NOSE_POLE); cap(bm, vs[-1])
finish(bm)
fus = new_object('B17_Fuselage', bm, [M_BODY])
LOG['fus'] = [[round(s['y'], 2), round(s['crown'], 3), round(s['bot'], 3),
               round(max(w for w, z, _ in s['lv']), 3)] for s in STA]

# ── 機背：與機身共用折線那一圈邊，做成封閉實體（玻璃要從它 INTERSECT）───────
DST = [s for s in STA if s['fold'] is not None]
bm = bmesh.new()
rings = []
for s in DST:
    y, wf = s['y'], s['wfold']
    pts = [Vector((wf, y, s['top']))]
    for w, z in s['lvd']: pts.append(Vector((w, y, z)))
    pts.append(Vector((0, y, s['crown'])))
    for w, z in reversed(s['lvd']): pts.append(Vector((-w, y, z)))
    pts.append(Vector((-wf, y, s['top'])))
    rings.append(pts)
vs = loft(bm, rings)
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
finish(bm)
new_object('B17_Dorsal', bm, [M_BODY])
LOG['dorsal'] = [[round(s['y'], 2), round(s['top'], 3), round(s['crown'], 3), round(s['wfold'], 3)] for s in DST]

# ═══════════════════════════ 2. 玻璃：盒切 ═══════════════════════════
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)


def boolean_apply(ob, cutter, op):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op; m.object = cutter; m.solver = 'EXACT'
    if hasattr(m, 'material_mode'): m.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.remove(m)
    old = ob.data; ob.data = me
    if old.users == 0: bpy.data.meshes.remove(old)


def box(name, x, y0, y1, z0, z1):
    pts = [Vector((sx * x, yy, zz)) for sx in (1, -1) for yy in (y0, y1) for zz in (z0, z1)]
    return hull_object(name, pts, M_GLASS)


# 【機首罩】`b17g.ts` 量到機體 −6.16…−5.66 整圈是玻璃（GLASS_SPLIT_Z = −5.66）。
# 盒切：機身 ∩ 盒 = 玻璃、機身 − 盒 = 機身，接縫落差因此恰好是零。
CUT_NOSE = box('Cut_Nose', 2.0, 5.60, 7.00, -1.20, 2.20)

# ── 座艙玻璃：**逐片照參考模型的透明件量，全部是平面** ──────────────
#
# 【`b17g.ts` 說「座艙那一段連凹進去的玻璃都沒有」是錯的】把 `Object_50` 拆連通塊
# 之後，座艙那一段有六片，每一片的 PCA 殘差都 ≤ 0.009（＝平面）：
#
# ```
#   片      x           機體 z         高度         法線
#   風擋    0.03…0.66   −3.21…−2.59   1.48…1.81   (0.52, 0.64, 0.57)
#   側窗前  0.60…0.69   −2.76…−1.92   1.45…1.81   (0.97, 0.01, 0.26)
#   側窗後  0.60…0.69   −1.85…−1.42   1.48…1.82   (0.97, 0.00, 0.25)
#   頂窗    0.21…0.52   −2.76…−2.22   1.89…1.96   (0.17, 0.05, 0.98)
#   頰窗    1.04…1.13   −3.92…−3.55   0.42…0.71   (0.98, 0.11, 0.16)
# ```
#
# **風擋的中線邊比外緣往前 0.42**（中線 −3.04…−3.21、外緣 −2.59…−2.80）——
# 那個往前戳的 V 就是 B-17 的特徵。上一版只給 0.12，做出來是一片平貼的斜窗。
#
# 【為什麼不能盒切】盒切拿到的是蒙皮那一片面，而蒙皮在那裡是圓的。這幾片都是
# 平的，所以走「玻璃先做成設計面」那條路（見 b17-body-lid-architecture）：
# 四個角先投影到最佳平面壓平 → 沿法線往外推 2.5 cm → 往內擠 0.25 取凸包當實體 →
# 朝外那一面塗玻璃、其餘塗機身色 → 同一個實體拿去 DIFFERENCE 掉蒙皮。
# 開口與玻璃因此完全對齊，而相鄰兩片各自往自己的法線推，中間自然留下一條
# 蒙皮 —— 那就是框柱。
#
# 角點是右半，左半鏡像。(x, y, z)，y = −機體 z。
# 角點量自參考模型（右半，左半鏡像）。第二欄是做在哪一側 —— **腰窗左右錯開**，
# 右邊在機體 z 5.88…6.65、左邊在 7.36…8.32，B-17G 後期型本來就這樣（兩個腰部
# 射手不會撞在一起）；右後那一片也只有單邊。四片的角點全部落在自家蒙皮外
# 0.003…0.025，正好就是 PANE_OUT，不必另外對位。
GLASS_PANES = [
    ('Wind',  'RL', [(0.664, 2.797, 1.478), (0.560, 2.591, 1.806),
                     (0.028, 3.044, 1.787), (0.046, 3.210, 1.580)]),
    ('SideF', 'RL', [(0.600, 2.558, 1.782), (0.687, 2.759, 1.453),
                     (0.682, 1.920, 1.483), (0.597, 1.936, 1.809)]),
    ('SideA', 'RL', [(0.597, 1.848, 1.811), (0.685, 1.842, 1.475),
                     (0.680, 1.422, 1.495), (0.596, 1.438, 1.819)]),
    ('Cheek', 'RL', [(1.044, 3.919, 0.702), (1.091, 3.914, 0.417),
                     (1.131, 3.549, 0.424), (1.083, 3.554, 0.709)]),
    # 錯開的那兩片導航員／砲位窗：左舷在機體 z −4.11…−4.54、右舷在 −4.96…−5.40。
    # 兩片的 PCA 殘差都是 0.004，是平的；對面那一側同一段是凸出來的泡罩（殘差
    # 0.025／0.033，不是平面），所以只做這兩片，泡罩不做。
    ('NavF',   'L', [(1.001, 4.538, 0.392), (0.945, 4.524, 0.721),
                     (1.016, 4.113, 0.714), (1.073, 4.128, 0.386)]),
    ('NavA',   'R', [(0.857, 4.961, 0.657), (0.905, 4.987, 0.365),
                     (0.764, 5.400, 0.378), (0.716, 5.374, 0.671)]),
    ('Radio', 'RL', [(0.834, -2.807, 1.314), (1.029, -2.821, 1.054),
                     (1.029, -3.150, 1.060), (0.833, -3.154, 1.322)]),
    ('WaistF', 'R', [(0.868, -5.882, 1.316), (1.160, -5.895, 0.609),
                     (1.136, -6.648, 0.623), (0.847, -6.635, 1.329)]),
    ('WaistA', 'L', [(0.862, -7.363, 1.296), (1.116, -7.375, 0.636),
                     (1.073, -8.317, 0.653), (0.823, -8.305, 1.313)]),
    ('Aft',    'R', [(1.001, -9.370, 0.877), (1.020, -9.388, 0.599),
                     (1.003, -9.676, 0.618), (0.983, -9.654, 0.900)]),
]
PANE_OUT, PANE_DEPTH = 0.025, 0.06
def apex_z(y):
    """切刀角錐的頂點高度＝該站剖面的中心。尾段的剖面中心一路上抬
    （腹線由 −0.78 升到 +0.5），固定 0.55 會讓腰窗以後的投影歪掉。"""
    best = min(STA, key=lambda q: abs(q['y'] - y))
    return 0.5 * (best['bot'] + best['crown'])


def _hull(name, pts, mats, hide=False):
    bm = bmesh.new()
    for q in pts: bm.verts.new(q)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, mats, hide=hide)


def pane_solid(name, quad, sgn):
    """一片平的玻璃 + 它自己的框，外加一把把蒙皮開洞的刀。

    【切刀是**由機身軸心射出的角錐**，不是沿法線平推的柱體】平推的話開口的
    邊界是「玻璃輪廓沿法線的投影」，而法線與蒙皮常常是斜的 —— 風擋的法線
    (0.52, 0.64, 0.57) 與機身側面夾角 58°，往內擠 0.45 就把開口在斜切方向
    拖長 0.45 × tan58° ≈ 0.7 m。症狀是蒙皮的切邊掉到 z 1.35 而玻璃下緣在
    1.458，外下角裂開 10 cm（負責人 2026-09-07 圈出來）。

    角錐的頂點放在同一站的機身軸心上，開口因此是「玻璃輪廓由軸心的中心投影」。
    玻璃離蒙皮只有 2…3 cm、頂點在 1 m 外，投影誤差不到 5 mm，邊就貼上了。
    """
    pts = [Vector((q[0] * sgn, q[1], q[2])) for q in quad]
    ctr = sum(pts, Vector()) / 4
    n = (pts[2] - pts[0]).cross(pts[3] - pts[1]).normalized()
    if n.x * sgn < 0: n = -n
    front = [q - n * (q - ctr).dot(n) + n * PANE_OUT for q in pts]
    ob = _hull(name, front + [q - n * PANE_DEPTH for q in front], [M_BODY, M_GLASS])
    for f in ob.data.polygons:
        if f.normal.dot(n) > 0.95: f.material_index = 1
    apex = Vector((0.0, ctr.y, apex_z(ctr.y)))
    cut = _hull('Cut_' + name[4:],
                [apex + (q - apex) * 1.18 for q in front] + [apex], [M_GLASS], hide=True)
    return ob, cut


_panes = [pane_solid('B17_Pane%s%s' % (nm, sd), q, sg)
          for nm, sides, q in GLASS_PANES
          for sd, sg in (('R', 1), ('L', -1)) if sd in sides]
WS = [c for _, c in _panes]
PANES = [o for o, _ in _panes]
# 頂窗留給盒切：它趴在圓的頂棚上，四個角量到的是一條窄邊，壓成平面會變成一根刺。
# ── 機背上的兩片：無線電艙頂窗與它後面的開放槍位 ──────────────────
#
# 量到的是機體 z 2.43…2.83（±0.42，高 1.91…1.98，殘差 0.021）與
# 3.23…4.40（±0.45，高 1.69…1.94，殘差 0.041）。殘差 0.04 代表它們**跟著圓的
# 頂棚走**，不是平板，所以走盒切而不是平面片。後面那一片就是 B-17G 無線電艙
# 那個大開口 —— 也正是 RADIO_HATCH 那個「中線凹陷」的來源，兩邊指的是同一個洞。
#
# 兩片後面靠 `B17_Inner` 擋著：它在機體 z 3.6 的頂端是 1.532，開口由 1.70 起，
# 由上往下看得到內殼，不會直接看穿到天空（坑 24）。
CUT_DECK = [
    box('Cut_RoofRadio', 0.44, -2.85, -2.42, 1.88, 2.30),
    box('Cut_RoofHatch', 0.44, -4.40, -3.22, 1.70, 2.30),
]
CUT_ROOF = [hull_object('Cut_Roof%d' % i, [
    Vector((sx * xx, yy, zz)) for sx in (s,) for xx in (0.19, 0.56)
    for yy in (2.20, 2.79) for zz in (1.86, 2.20)], M_GLASS)
    for i, s in enumerate((1, -1))]
CUT_GLASS = [CUT_NOSE] + CUT_ROOF + CUT_DECK          # 這幾把是「玻璃 = 蒙皮 ∩ 切刀」
CUTS = CUT_GLASS + WS                      # 蒙皮要減掉全部（每一片玻璃自己就是切刀）

dorsal = O['B17_Dorsal']
glass_bm = bmesh.new()
for cut in CUT_GLASS:
    for src in (fus, dorsal):
        tmp = src.data.copy()
        ob = bpy.data.objects.new('Cut_Tmp', tmp); COLL.objects.link(ob)
        boolean_apply(ob, cut, 'INTERSECT')
        if len(ob.data.polygons): glass_bm.from_mesh(ob.data)
        bpy.data.objects.remove(ob, do_unlink=True)
finish(glass_bm)
new_object('B17_Glass', glass_bm, [M_GLASS])
for src in (fus, dorsal):
    for cut in CUTS:
        boolean_apply(src, cut, 'DIFFERENCE')
    src.data.materials.clear(); src.data.materials.append(M_BODY)

# 座艙內槽：45% 的玻璃後面沒有東西擋的話，從一側看穿到另一側就是天空（坑 24）。
#
# **不能用凸包方盒。** 窗戶是開在斜面與側面上的，而座艙那一段的剖面沿 y 收得很快
# （y 3.0 的 z 1.5 半寬只有 0.41、y 2.6 是 0.68），任何等寬或分段線性的盒子都會
# 在某一站由窗口戳出去 —— 第一版算圖上是幾片黑刺插在風擋外面。
# 改成把**機身＋機背的環照各自中心縮 0.86 倍**，形狀跟著剖面收，保證包在裡面。
_cst = [q for q in STA if 1.80 <= q['y'] <= 3.45]
bm = bmesh.new()
_rings = []
for q in _cst:
    cz = 0.5 * (q['bot'] + q['crown'])
    _rings.append([Vector((pt.x * 0.86, pt.y, cz + (pt.z - cz) * 0.86)) for pt in full_ring(q)])
vs = loft(bm, _rings)
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
# 【機身側面那幾片窗後面也要有東西擋】無線電艙側窗、左右腰窗、右後小窗都開在
# 機身側面，後面沒有內殼的話從一側直接看穿到另一側的天空（坑 24）。這一段用
# **機身環**（不含機背）就夠 —— 那幾片窗的上緣最高 1.33，都在折線 1.57 以下。
# 隔一站取一個，1,000 面以內。
def _shrunk(q, k=0.88):
    cz = 0.5 * (q['bot'] + q['top'])
    return [Vector((pt.x * k, pt.y, cz + (pt.z - cz) * k)) for pt in ring_of(q)]
_ast = [q for q in STA if -10.30 <= q['y'] <= 1.85][::2]
_bm2 = bmesh.new()
_v2 = loft(_bm2, [_shrunk(q) for q in _ast])
cap(_bm2, _v2[0]); cap(_bm2, list(reversed(_v2[-1])))
finish(_bm2)
new_object('B17_Inner', _bm2, [M_INNER])
finish(bm)
new_object('B17_Cockpit', bm, [M_COCK])
# 機首罩內槽。**不能用方盒** —— 機首是一個半寬由 0.64（y 5.60）收到 0.13（y 6.15）
# 的錐體，方盒不管開多小都會在某一站戳出去（第一版 x ±0.52 從機鼻整片穿出來，
# 算圖上是一個黑方塊插在機首前面）。改成把機首那幾環**照各自的中心縮 0.78 倍**，
# 形狀跟著錐體收，保證包在裡面。
_nst = [s for s in STA if s['y'] >= 5.55]
bm = bmesh.new()
_rings = []
for s in _nst:
    cz = 0.5 * (s['bot'] + s['crown'])
    _rings.append([Vector((p.x * 0.78, p.y, cz + (p.z - cz) * 0.78)) for p in ring_of(s)])
vs = loft(bm, _rings)
cap(bm, vs[0]); cap(bm, list(reversed(vs[-1])))
finish(bm)
new_object('B17_NoseInner', bm, [M_INNER])

# ═══════════════════════════ 3. 翼面（主翼、水平尾翼）═══════════════════════════
def chord_fine(T, x, zlo, zhi, yfront, yback, step=0.010):
    le = te = None; n = int((zhi - zlo) / step)
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


def panel_station(T, x, zlo, zhi, yfront, yback, zsl, zsh, le=None, te=None):
    if le is None or te is None:
        le, te = chord_fine(T, x, zlo, zhi, yfront, yback)
    up, dn = [], []
    for f in FR:
        y = le - (le - te) * f
        u = hit(T, (x, y, zsh), (0, 0, -1), zsh - zsl)
        d = hit(T, (x, y, zsl), (0, 0, 1), zsh - zsl)
        up.append(None if u is None else u.z); dn.append(None if d is None else d.z)
    return {'x': x, 'le': le, 'te': te, 'up': up, 'dn': dn}


def hull_line(fs, vals, upper):
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


def fill_none(st_list, passes=2):
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    s[key][k] = min(vals, key=lambda v: abs(v[0] - s['x']))[1]
    for s in st_list:
        s['up'] = hull_line(FR, s['up'], True); s['dn'] = hull_line(FR, s['dn'], False)
    # 展向平滑（拉普拉斯對直線是恆等的，所以只削噪聲不動形狀）
    for _ in range(passes):
        new = []
        for i, s in enumerate(st_list):
            if i == 0 or i == len(st_list) - 1:
                new.append((s['up'], s['dn'])); continue
            a, b = st_list[i - 1], st_list[i + 1]
            t = (s['x'] - a['x']) / (b['x'] - a['x'])
            up = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['up'], a['up'], b['up'])]
            dn = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['dn'], a['dn'], b['dn'])]
            new.append((up, dn))
        for s, (up, dn) in zip(st_list, new): s['up'], s['dn'] = up, dn


def section_pts(s):
    le, te = s['le'], s['te']; ch = le - te
    pts = [(le, 0.5 * (s['up'][0] + s['dn'][0]))]
    for f, u in zip(FR, s['up']): pts.append((le - ch * f, u))
    pts.append((te, 0.5 * (s['up'][-1] + s['dn'][-1])))
    for f, d in zip(reversed(FR), reversed(s['dn'])): pts.append((le - ch * f, d))
    return pts


def _tip_sec(s, tip_x, ty, tz, k=0.14):
    """翼尖那一小圈。**不要收成一個點** —— `geometry.test.ts` 的「宣告的 wingTip
    真的落在建出來的翼尖上」取的是 |x| ≥ 0.99 × 半翼展 那一段的 y／z 範圍，收成
    一點的話那個範圍退化成單一個值，宣告值必須與 float32 逐位元相等才過得了。
    留一圈 14% 的小翼尖，範圍就有 0.03（高度）與 0.34（弦向）的餘裕，
    順帶讓翼尖是圓的而不是一根尖刺。"""
    my = 0.5 * (s['le'] + s['te'])
    mu = [0.5 * (u + d) for u, d in zip(s['up'], s['dn'])]
    return {'x': tip_x,
            'le': ty + (s['le'] - my) * k, 'te': ty + (s['te'] - my) * k,
            'up': [tz + (u - m) * k for u, m in zip(s['up'], mu)],
            'dn': [tz + (d - m) * k for d, m in zip(s['dn'], mu)]}


def build_panel(name, sts, tip_x, tip_y, tip_z, mats=None):
    full = list(sts) + [_tip_sec(sts[-1], tip_x, tip_y, tip_z)]
    seq = [dict(s, x=-s['x']) for s in reversed(full[1:])] + full
    bm = bmesh.new()
    vs = loft(bm, [[Vector((s['x'], y, z)) for y, z in section_pts(s)] for s in seq])
    cap(bm, vs[-1]); cap(bm, list(reversed(vs[0])))
    finish(bm)
    return new_object(name, bm, mats or [M_BODY])


def fit_line(pts):
    n = len(pts); mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    sl = sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx
    return my - sl * mx, sl


# ── 主翼 ────────────────────────────────────────────────────────
# 【前後緣一律用擬合的直線，不用逐站量到的值】主翼是單一梯形（`b17g.ts` 量過
# 斜率沿翼展只在 0.12～0.14 之間變），而**發動機艙會把逐站的前緣讀壞**：由
# y +2.5 往後打，x 2.2／2.6／3.0／4.0 讀到 1.98／1.99／2.28／1.98 —— 那是內側
# 艙的唇口（x 2.36…3.75），真值在 −0.16 附近。外側艙 x 5.87…7.36 同理。
# 乾淨的站位只有 x 1.6、4.6、5.2、8.0、10.0、12.0，用它們擬合。
WX_CLEAN = [1.60, 4.60, 5.20, 8.00, 10.00, 12.00]
_le_pts, _te_pts = [], []
for x in WX_CLEAN:
    le, te = chord_fine(WING, x, -0.45, 0.65, 2.5, -8.0)
    if le is not None and te is not None:
        _le_pts.append((x, le)); _te_pts.append((x, te))
LE0, LES = fit_line(_le_pts)
TE0, TES = fit_line(_te_pts)
# 【翼根四分之一弦線必須**恰好**壓在原點】原點是物理模型的重心，
# `geometry.test.ts` 的「機翼四分之一弦線落在原點」對 B-17G 這一台是
# `toBeCloseTo(0, 6)` —— 量測公差過不了（四台戰鬥機不在那個 spec 迴圈裡，
# 所以只有這台會踩到）。對齊時用的是兩站外推（x 4.6／8.0），這裡用的是六站
# 最小平方，兩種算法差 **13.5 mm**；把差值整條移掉，翼面積與後掠不受影響。
_qc0 = LE0 - 0.25 * (LE0 - TE0)
LE0 -= _qc0; TE0 -= _qc0
LOG['wing_le'] = [round(LE0, 3), round(LES, 4)]
LOG['wing_te'] = [round(TE0, 3), round(TES, 4)]
LOG['wing_qc_shift'] = round(_qc0, 4)
WX = [0.0, 1.60, 4.60, 5.20, 8.00, 10.00, 12.00, 13.50, 14.60, 15.30]
FR = FR_W
wst = [panel_station(WING, max(x, 1.60), -0.55, 0.75, 2.5, -8.0, -1.10, 1.20,
                     le=LE0 + LES * x, te=TE0 + TES * x) for x in WX]
for s, x in zip(wst, WX): s['x'] = x
fill_none(wst)
WING_TIP_X = 15.81
tip = wst[-1]
# `part='wingN'` 是**契約**，不是註記：`glb.ts` 靠它把翼板單獨併一組，
# `geometry.test.ts` 靠它認出主翼、`multi-engine-glb.test.ts` 檢查這台正好
# 有 wing0（主翼）與 wing1（水平尾翼）兩片。少標的話翼板被併進機身那一塊，
# 「四分之一弦線」那條就再也找不到主翼（實測回傳空陣列）。
build_panel('B17_Wing', wst, WING_TIP_X, 0.5 * (tip['le'] + tip['te']) - 0.10,
            0.5 * (tip['up'][3] + tip['dn'][3]))['part'] = 'wing0'
_area = 0.0
for a, b in zip(wst, wst[1:]):
    _area += 0.5 * ((a['le'] - a['te']) + (b['le'] - b['te'])) * (b['x'] - a['x'])
_area += 0.5 * (tip['le'] - tip['te']) * (WING_TIP_X - tip['x'])
LOG['wing_area'] = round(2 * _area, 2)

# ── 水平尾翼 ────────────────────────────────────────────────────
# x < 1.5 讀到的是尾錐與垂尾（x 0.6 的「前緣」8.335、厚度 1.27），一律外推。
FR = FR_T
TX_CLEAN = [1.50, 2.50, 3.50, 4.50, 5.50, 6.00]
_le_pts, _te_pts = [], []
for x in TX_CLEAN:
    le, te = chord_fine(WING, x, 1.00, 1.55, -8.0, -20.0)
    if le is not None and te is not None:
        _le_pts.append((x, le)); _te_pts.append((x, te))
TLE0, TLES = fit_line(_le_pts)
TTE0, TTES = fit_line(_te_pts)
LOG['tp_le'] = [round(TLE0, 3), round(TLES, 4)]
TX = [0.0, 1.50, 2.50, 3.50, 4.50, 5.50, 6.00, 6.35]
tst = [panel_station(WING, max(x, 1.50), 0.95, 1.60, -8.0, -20.0, 0.60, 2.00,
                     le=TLE0 + TLES * x, te=TTE0 + TTES * x) for x in TX]
for s, x in zip(tst, TX): s['x'] = x
fill_none(tst)
TP_TIP_X = 6.55
ttip = tst[-1]
build_panel('B17_Tailplane', tst, TP_TIP_X, 0.5 * (ttip['le'] + ttip['te']) - 0.04,
            0.5 * (ttip['up'][2] + ttip['dn'][2]))['part'] = 'wing1'

# ═══════════════════════════ 4. 垂尾 + 背鰭整流罩 ═══════════════════════════
#
# 【這一件就是負責人說的「機背另外凸起」的後半段】背鰭整流罩由機體 z 5.2 起
# 長在機身冠線上，半厚只有 0.15…0.20，一路併進垂尾 —— 前緣是同一條連續曲線，
# 所以整流罩與垂尾**做成一件**，與現況模型（`b17g.ts` 的 DORSAL + FIN）同一個
# 分法，也與機背件（B17_Dorsal）在機體 z 5.2 完成交班。
#
# 【前緣由「中線頂線」反解，不要用水平射線】水平射線在低處會先打到上部砲塔與
# 機身；中線頂線（x 0.03 由上往下）在機體 z 5.4…13.5 是一條乾淨單調的線，把它
# 反解成「高度 → 機體 z」就是前緣。兩者在能對照的高度互相印證：
#   高度 2.3 水平射線 9.040 / 反解 9.13；3.1 → 11.358 / 11.40；5.1 → 12.651 / 12.68
RIDGE = []
_zb = 5.20
while _zb <= 13.55:
    _h = zmax_at(WING, 0.03, -_zb)
    if _h is not None: RIDGE.append((_zb, _h))
    _zb += 0.10
for a, b in zip(RIDGE, RIDGE[1:]):          # 壓單調，反解才有唯一解
    if b[1] <= a[1]: RIDGE[RIDGE.index(b)] = (b[0], a[1] + 1e-4)
FIN_TOP_Z = max(h for _, h in RIDGE)
LOG['ridge'] = [[round(a, 2), round(b, 3)] for a, b in RIDGE[::8]]


def fin_le(z):
    """高度 z 的前緣（回傳 build y）。低於整流罩起點就釘在起點，讓下緣埋進機身。"""
    if z <= RIDGE[0][1]: return -RIDGE[0][0]
    if z >= RIDGE[-1][1]: return -RIDGE[-1][0]
    for (z0, h0), (z1, h1) in zip(RIDGE, RIDGE[1:]):
        if h0 <= z <= h1:
            return -(z0 + (z1 - z0) * (z - h0) / (h1 - h0))
    return -RIDGE[-1][0]


# 後緣（方向舵）。高度 2.1 以下讀到的是水平尾翼與尾錐（13.9x），用 2.1…3.5 的
# 實測擬合直線往下延伸。
_te_pts = []
_z = 2.10
while _z <= 5.45:
    h = hit(WING, (0.02, -22.0, _z), (0, 1, 0), 30.0)
    if h is not None: _te_pts.append((_z, h.y))
    _z += 0.10
RTE0, RTES = fit_line([p for p in _te_pts if p[0] <= 3.6])


def fin_te(z):
    if z >= _te_pts[0][0]:
        for (z0, y0), (z1, y1) in zip(_te_pts, _te_pts[1:]):
            if z0 <= z <= z1: return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
        return _te_pts[-1][1]
    return RTE0 + RTES * z


# 頂端要多給兩站：垂尾的翼尖是圓的，5.45 直接扇到 5.63 的話那 0.18 m 收成一片
# 平的錐面，側視剪影在最上緣少掉一塊。
FIN_Z = [1.36, 1.60, 1.85, 2.10, 2.35, 2.60, 2.90, 3.20, 3.50, 3.80, 4.10,
         4.40, 4.70, 5.00, 5.20, 5.35, 5.47, 5.56]
FIN_FR = [0.06, 0.18, 0.34, 0.52, 0.72, 0.90]


def fin_station(z):
    le, te = fin_le(z), fin_te(z)
    ts = []
    for f in FIN_FR:
        y = le - (le - te) * f
        h = hit(WING, (1.2, y, z), (-1, 0, 0), 2.4)
        ts.append(None if (h is None or h.x <= 0 or h.x > 0.45) else h.x)
    return {'z': z, 'le': le, 'te': te, 't': ts}


fsts = [fin_station(z) for z in FIN_Z]
# 低處量不到（那裡是機身），沿高度往上找最近的有效值補；再沿高度平滑兩輪。
for k in range(len(FIN_FR)):
    vals = [(s['z'], s['t'][k]) for s in fsts if s['t'][k] is not None]
    for s in fsts:
        if s['t'][k] is None:
            s['t'][k] = min(vals, key=lambda v: abs(v[0] - s['z']))[1] if vals else 0.15
for _ in range(2):
    new = []
    for i, s in enumerate(fsts):
        if i == 0 or i == len(fsts) - 1: new.append(s['t']); continue
        a, b = fsts[i - 1], fsts[i + 1]
        t = (s['z'] - a['z']) / (b['z'] - a['z'])
        new.append([v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['t'], a['t'], b['t'])])
    for s, q in zip(fsts, new): s['t'] = q

bm = bmesh.new()
rings = []
for s in fsts:
    le, te, ch = s['le'], s['te'], s['le'] - s['te']
    pts = [Vector((0.0, le, s['z']))]
    for f, t in zip(FIN_FR, s['t']): pts.append(Vector((t, le - ch * f, s['z'])))
    pts.append(Vector((0.0, te, s['z'])))
    for f, t in zip(reversed(FIN_FR), reversed(s['t'])): pts.append(Vector((-t, le - ch * f, s['z'])))
    rings.append(pts)
vs = loft(bm, rings)
cap(bm, vs[0])
_tl, _tt = fin_le(FIN_TOP_Z), fin_te(FIN_TOP_Z)
fan(bm, vs[-1], Vector((0.0, 0.5 * (_tl + _tt), FIN_TOP_Z)))
finish(bm)
new_object('B17_Fin', bm, [M_BODY])

# ═══════════════════════════ 5. 發動機艙與螺旋槳 ═══════════════════════════
#
# 【這四段剖面表直接沿用 `b17g.ts` 的 NACELLE_INNER／NACELLE_OUTER】它們量的是
# **同一支參考模型、同一個座標原點**（主翼翼根四分之一弦），而且已經處理過兩個
# 這裡一樣會踩的坑：起落架是放下的（機體 z −1.78…−0.78 的腹線被輪艙拉低，改用
# 兩端趨勢值）、外艙前端被槳葉蓋住（唇口那一環按內艙的比例 0.84 補）。
# 欄位是 (機體 z, 半寬, 半高, 中心高度)。
NAC_X_INNER, NAC_X_OUTER = 3.050, 6.571
NAC_INNER = [
    (-3.18, 0.648, 0.643, +0.002), (-2.98, 0.760, 0.760, -0.021), (-2.78, 0.765, 0.765, -0.018),
    (-2.58, 0.767, 0.766, -0.016), (-2.38, 0.769, 0.770, -0.008), (-2.18, 0.784, 0.792, -0.007),
    (-1.98, 0.782, 0.798, -0.006), (-1.78, 0.775, 0.795, -0.000), (-1.58, 0.766, 0.791, +0.003),
    (-1.38, 0.750, 0.786, +0.007), (-1.18, 0.714, 0.780, +0.009), (-0.98, 0.678, 0.774, +0.011),
    (-0.78, 0.642, 0.766, +0.011), (-0.58, 0.636, 0.757, +0.010), (-0.38, 0.630, 0.747, +0.008),
    (-0.18, 0.617, 0.731, +0.006), (0.02, 0.603, 0.714, -0.001), (0.22, 0.593, 0.702, -0.017),
    (0.42, 0.563, 0.664, -0.013), (0.62, 0.537, 0.632, -0.010), (0.82, 0.528, 0.620, -0.017),
    (1.02, 0.509, 0.598, -0.012), (1.22, 0.483, 0.565, -0.005), (1.42, 0.457, 0.533, -0.003),
    (1.62, 0.418, 0.484, +0.016), (1.82, 0.382, 0.441, +0.029), (2.02, 0.360, 0.412, +0.023),
    (2.22, 0.338, 0.386, +0.009), (2.42, 0.321, 0.364, -0.013), (2.62, 0.300, 0.339, -0.032)]
NAC_OUTER = [
    (-2.78, 0.643, 0.549, +0.257), (-2.58, 0.678, 0.654, +0.253), (-2.38, 0.735, 0.735, +0.246),
    (-2.18, 0.764, 0.764, +0.244), (-1.98, 0.766, 0.768, +0.247), (-1.78, 0.771, 0.777, +0.248),
    (-1.58, 0.781, 0.790, +0.248), (-1.38, 0.784, 0.790, +0.253), (-1.18, 0.777, 0.781, +0.259),
    (-0.98, 0.769, 0.773, +0.261), (-0.78, 0.754, 0.758, +0.266), (-0.58, 0.739, 0.743, +0.268),
    (-0.38, 0.737, 0.740, +0.252), (-0.18, 0.732, 0.735, +0.231), (0.02, 0.699, 0.701, +0.231),
    (0.22, 0.635, 0.634, +0.256), (0.42, 0.574, 0.571, +0.272), (0.62, 0.527, 0.522, +0.272),
    (0.82, 0.482, 0.475, +0.278), (1.02, 0.441, 0.433, +0.285), (1.22, 0.414, 0.405, +0.288),
    (1.42, 0.401, 0.391, +0.292), (1.62, 0.383, 0.373, +0.289), (1.82, 0.360, 0.348, +0.279),
    (2.02, 0.340, 0.327, +0.267), (2.22, 0.324, 0.311, +0.252), (2.42, 0.307, 0.293, +0.230),
    (2.62, 0.280, 0.265, +0.202)]
NAC_SEG, NAC_ROUND = 16, 2.3


def smooth_nac(tab, passes=3, lam=0.5, thr=0.04):
    """發動機艙的剖面表沿 z 平滑。

    【為什麼要平滑】`b17g.ts` 那兩張表是逐站量出來的，帶著量測噪聲：**中心高度
    抖 ±0.03**（+0.011 → −0.001 → −0.017 → −0.013 → −0.010 → −0.017 → −0.012），
    半寬的二階差也不規則（0.593 → 0.563 → 0.537 → 0.528）。絕對值都很小，但艙身
    只有 0.78 半徑，平面著色下每一環的法線跟著交替，看起來就是一條一條的。

    **保邊**：門檻 0.04 —— 唇口那一階（半寬 0.648 → 0.760，離線性內插 0.053）
    不會被抹掉，那是形狀不是噪聲（坑 44）。
    """
    out = [list(r) for r in tab]
    for _ in range(passes):
        new_t = [list(r) for r in out]
        for i in range(1, len(out) - 1):
            a, b, c = out[i - 1], out[i], out[i + 1]
            t = (b[0] - a[0]) / (c[0] - a[0])
            for k in (1, 2, 3):
                lin = a[k] + (c[k] - a[k]) * t
                if abs(b[k] - lin) < thr: new_t[i][k] = b[k] + (lin - b[k]) * lam
        out = new_t
    return [tuple(r) for r in out]


NAC_INNER = smooth_nac(NAC_INNER)
NAC_OUTER = smooth_nac(NAC_OUTER)


def se_ring(zb, hw, hh, cy, cx, n=NAC_SEG, r=NAC_ROUND):
    pts = []
    e = 2.0 / r
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        px = math.copysign(abs(ca) ** e, ca) * hw
        pz = math.copysign(abs(sa) ** e, sa) * hh
        pts.append(Vector((cx + px, -zb, cy + pz)))
    return pts


def build_nacelle(name, table, cx):
    bm = bmesh.new()
    vs = loft(bm, [se_ring(zb, hw, hh, cy, cx) for zb, hw, hh, cy in table])
    cap(bm, list(reversed(vs[0])), reverse=True)      # 前封蓋 = 引擎面
    cap(bm, list(reversed(vs[-1])))
    finish(bm)
    ob = new_object(name, bm, [M_BODY, M_ACC])
    y0 = -table[0][0]
    for p in ob.data.polygons:
        c = sum((ob.data.vertices[i].co for i in p.vertices), Vector()) / len(p.vertices)
        if c.y > y0 - 0.02: p.material_index = 1
    return ob


for i, (nm, tab, cx) in enumerate((('B17_NacIL', NAC_INNER, -NAC_X_INNER),
                                   ('B17_NacIR', NAC_INNER, NAC_X_INNER),
                                   ('B17_NacOL', NAC_OUTER, -NAC_X_OUTER),
                                   ('B17_NacOR', NAC_OUTER, NAC_X_OUTER))):
    build_nacelle(nm, tab, cx)

# 螺旋槳。轉軸與半徑照 `b17g.model.ts` 的 props（那一份是遊戲端的契約，不能改）。
PROP_R = 1.765
PROPS = [('B17_Prop1', NAC_X_INNER, 0.002, 3.36), ('B17_Prop2', NAC_X_OUTER, 0.257, 2.96),
         ('B17_Prop3', -NAC_X_INNER, 0.002, 3.36), ('B17_Prop4', -NAC_X_OUTER, 0.257, 2.96)]
# 【三片槳葉必須是**三個各自的 mesh**】`multi-engine-glb.test.ts` 檢查每一具轉軸
# 底下正好是「三個非 CircleGeometry 的 spinning mesh + 一個槳盤」。併成一個物件
# 的話那一格讀到 1，而且槳盤是載入時另外做的，所以不會補回來。
# 名字的尾碼交給 Blender（`B17_Prop1.001`），`glb.ts` 的 isNamed 認「分隔符＋數字」。
for nm, hx, hy, hz in PROPS:
    for b in range(3):
        a = 2 * math.pi * b / 3
        ca, sa = math.cos(a), math.sin(a)
        bm = bmesh.new()
        # 槳葉是一片薄板：沿半徑拉長、沿弦向給寬度、厚度 0.036
        for r0, r1, w in ((0.16, 0.95, 0.115), (0.95, PROP_R, 0.085)):
            pts = []
            for rr, ww in ((r0, w), (r1, w * 0.7)):
                px, pz = hx + ca * rr, hy + sa * rr
                for dy in (0.018, -0.018):
                    pts.append(Vector((px - sa * ww, hz + dy, pz + ca * ww)))
                    pts.append(Vector((px + sa * ww, hz + dy, pz - ca * ww)))
            tmp = bmesh.new()
            for p in pts: tmp.verts.new(p)
            bmesh.ops.convex_hull(tmp, input=tmp.verts)
            me = bpy.data.meshes.new('t'); tmp.to_mesh(me); tmp.free()
            bm.from_mesh(me); bpy.data.meshes.remove(me)
        finish(bm)
        new_object(nm if b == 0 else '%s.%03d' % (nm, b), bm, [M_ACC])

# 槳轂的鼻子。參考模型量到的是：由槳葉平面往前 0.14 起、半徑 0.15，到 +0.46
# 收成一點（y 3.5 半徑 0.082…0.151、3.6 是 0.079…0.151、3.7 是 0.008…0.151、
# 3.8 只剩一個 0.038 的點）。
#
# 【**軸桿要一路接回整流罩**】只做「槳葉平面往前」那一段的話，鼻子與整流罩之間
# 空著 0.18 —— 槳葉根部又剛好是空心的（葉片由 x 半徑 0.15 起算），從側面看就是
# 一顆浮在空中的錐體。參考模型在外側發動機（軸心 x −6.57、高度 0.257）量到的是
# 連續的：整流罩收在 y 2.57（半徑 0.66），**接著 2.60…3.17 一段半徑 0.10…0.147
# 的軸桿**，槳葉平面 2.75 就在那一段中間。所以起點放在整流罩鼻端再往內 0.04
# （dz −0.22，內外側都一樣，因為兩具的槳轂距鼻端都是 0.18），基環埋在罩子裡。
#
# **不能取名 `B17_PropN`**：`glb.ts` 的 isNamed 認「名字 + 可有可無的分隔符 + 數字」，
# 取那個名字就會被歸進轉軸底下，`multi-engine-glb.test.ts` 檢查「每一具正好三片
# 槳葉」那一格會讀到 4。鼻子是旋轉對稱的，不轉也看不出來。
SPIN = [(-0.22, 0.150), (-0.02, 0.170), (0.14, 0.155), (0.29, 0.115), (0.39, 0.062)]
for i, (nm, hx, hy, hz) in enumerate(PROPS):
    bm = bmesh.new()
    rings = []
    for dz, rr in SPIN:
        rings.append([Vector((hx + rr * math.cos(2 * math.pi * k / 12), hz + dz,
                              hy + rr * math.sin(2 * math.pi * k / 12))) for k in range(12)])
    vs = loft(bm, rings)
    cap(bm, list(reversed(vs[0])))
    fan(bm, vs[-1], Vector((hx, hz + 0.46, hy)))
    finish(bm)
    new_object('B17_Spinner%d' % (i + 1), bm, [M_ACC])

# ═══════════════════════════ 6. 砲塔與尾艙罩 ═══════════════════════════
#
# 位置與尺寸沿用 `b17g.ts` 的 TURRETS —— 那一組是量到的（機體 z、腹線／背線的
# 讀數都寫在該檔）：下巴 −5.48…−4.48 腹線 −1.056、上部 −1.68…−0.88 背線 2.372、
# 球形 4.52…5.72 腹線 −1.263、導航員圓頂 −5.00…−4.20 高出蒙皮 0.36。
BLISTERS = [
    ('B17_Astro', 0.0, 1.30, -4.60, 0.52, 0.56, 0.85, M_BODY),
    ('B17_ChinTurret', 0.0, -0.55, -4.98, 0.95, 1.00, 1.05, M_ACC),
    ('B17_TopTurret', 0.0, 1.95, -1.28, 0.90, 0.85, 0.90, M_ACC),
    ('B17_BallTurret', 0.0, -0.68, 5.12, 1.10, 1.15, 1.10, M_ACC),
]
for nm, cx, cy, cz, w, h, ln, mm in BLISTERS:
    bm = bmesh.new()
    NU, NV = 14, 8
    grid = []
    for j in range(NV + 1):
        phi = math.pi * j / NV
        ring = []
        for i in range(NU):
            th = 2 * math.pi * i / NU
            ring.append(Vector((cx + 0.5 * w * math.sin(phi) * math.cos(th),
                                -cz + 0.5 * ln * math.sin(phi) * math.sin(th),
                                cy + 0.5 * h * math.cos(phi))))
        grid.append(ring)
    loft(bm, grid[1:-1])
    fan(bm, [bm.verts.new(p) for p in grid[1]], Vector((cx, -cz, cy + 0.5 * h)))
    fan(bm, [bm.verts.new(p) for p in grid[-2]], Vector((cx, -cz, cy - 0.5 * h)))
    finish(bm)
    new_object(nm, bm, [mm])

# ── 尾艙罩：一件，**玻璃只是側面那一圈帶** ────────────────────────
#
# 【玻璃是一條**水平的帶**，由左側繞過屁股到右側；頂與底都是蒙皮】
#
# 判準不能用「離頂的角度」—— 那只切得出左右兩片，切不出繞過後端的環。改用
# **面心的高度**：機體 z ≥ 14.95、1.45 ≤ z ≤ 1.88。後端封蓋的面心在 1.65，
# 自然落在帶內，環就接起來了。
#
# 高度帶是量出來的。參考模型的透明件在這一段拆成三片：
#
# ```
#   側窗（前）  機體 z 14.83…15.13   高度 1.55…1.88
#   側窗（後）  機體 z 15.20…15.73   高度 1.40…1.91
#   後窗        機體 z 15.79…16.07   高度 1.39…1.92   x ±0.348
# ```
#
# 【頂部確定是蒙皮】把透明件與不透明件分開打（只比「哪一件比較外面」會判錯）：
#
# ```
#   機體 z   x=0.20［不透明, 透明］   x=0.00［不透明, 透明］
#   15.0      [1.940, 無]              [2.882, 無]
#   15.6      [1.965, 無]              [0.568, 1.965]
#   15.8      [1.969, 無]              [1.351, 1.969]
# ```
#
# x 0.20 的頂面全段沒有任何透明交點；中線那條 |x| ≤ 0.15 的細縫才有，那是尾砲的
# 槍口開孔，寬度不到罩子半寬的一半，這個解析度做不出來，就不做。
#
# 【後端要鈍，但**不是切平**】後窗量到 x ±0.348、一路到機體 z 16.07，收成
# ±0.17 的尖尾就沒有那面窗可言；可是照整個剖面平切一刀，玻璃帶會被一片豎直的
# 平板封住，由上往下看是「兩條側窗 + 一道橫牆」。參考模型是**由左繞過屁股到右
# 的 U 形收口**：頂棚（z 1.97、|x| ≤ 0.20 的平面）與底緣維持水平，半寬在最後
# 0.2 m 內收乾淨。逐站極座標量到的最大半寬與中線頂高：
#
# ```
#   機體 z   15.70   15.85   15.95   16.00   16.05
#   半寬      0.354   0.343   0.270   0.222   收完
#   頂高      1.967   1.970   1.972   1.742   1.506
# ```
#
# 半寬 15.85 之後三站就掉光，頂高則是最後兩站才塌 —— 所以尾端是**先收窄再壓
# 低**的圓穹，不是一刀切。末端那一環的封蓋落在高度帶外（面心 1.36），要靠
# 「機體 z ≥ 16.0 一律算玻璃」把 U 的底部接起來。
HOOD = [(13.80, 0.16, 0.10, 1.44), (14.35, 0.30, 0.16, 1.47), (14.80, 0.33, 0.26, 1.55),
        (14.92, 0.33, 0.31, 1.60), (15.10, 0.33, 0.34, 1.61), (15.30, 0.33, 0.36, 1.61),
        (15.70, 0.33, 0.36, 1.61), (15.85, 0.31, 0.36, 1.61), (15.95, 0.24, 0.35, 1.60),
        (16.01, 0.15, 0.26, 1.48), (16.06, 0.06, 0.16, 1.36)]
HOOD_GLASS_Z = (1.45, 1.88)
HOOD_GLASS_ZB = 16.00
bm = bmesh.new()
vs = loft(bm, [se_ring(zb, hw, hh, cy, 0.0, n=16, r=3.0) for zb, hw, hh, cy in HOOD])
cap(bm, list(reversed(vs[0])), reverse=True); cap(bm, list(reversed(vs[-1])))
finish(bm)
_hood = new_object('B17_Hood', bm, [M_BODY, M_GLASS])
for f in _hood.data.polygons:
    c = sum((_hood.data.vertices[i].co for i in f.vertices), Vector()) / len(f.vertices)
    if -c.y >= 14.95 and c.z <= HOOD_GLASS_Z[1] and (c.z >= HOOD_GLASS_Z[0] or -c.y >= HOOD_GLASS_ZB):
        f.material_index = 1


def hood_sec(zb):
    """把 HOOD 表線性內插到任一站，讓暗艙照罩子的外型縮，不要另外手調一張表。"""
    for a, b in zip(HOOD, HOOD[1:]):
        if a[0] <= zb <= b[0]:
            t = (zb - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    raise ValueError(zb)


# 玻璃後面的暗艙。**不能省** —— 45% 的玻璃後面沒有東西擋的話，從一側看穿到
# 另一側就是天空（坑 24）。前後各縮進去一節，讓罩子的金屬把它擋住；半徑照罩子
# 縮 0.80，收口那一段才不會戳出去。
HOOD_DARK = [(zb, hw * 0.80, hh * 0.80, cy)
             for zb, (hw, hh, cy) in ((q, hood_sec(q)) for q in
                                      (14.96, 15.30, 15.70, 15.88, 15.98, 16.03))]
bm = bmesh.new()
vs = loft(bm, [se_ring(zb, hw, hh, cy, 0.0, n=16, r=3.0) for zb, hw, hh, cy in HOOD_DARK])
cap(bm, list(reversed(vs[0])), reverse=True); cap(bm, list(reversed(vs[-1])))
finish(bm)
new_object('B17_HoodDark', bm, [M_INNER])

# ═══════════════════════════ 7. 玻璃框條 ═══════════════════════════
#
# **不是裝飾，是契約**：`b17g.model.ts` 的 materials 對照表列了 `B17_Frame`，
# 而 `parseGlbTemplate` 會檢查每一個列出的材質都真的在 GLB 裡。少了就直接
# 拋「manifest 過期了」，七支單元測試一起紅。
#
# 框條貼在玻璃表面外 4 mm，走向由射線打到的法線決定，所以它自然貼合罩子。
GB = bvh_of(['B17_Glass'])
GW = bvh_of([o.name for o in PANES if 'Wind' in o.name])


def strip_from_points(bm, pts, nrm, width, along):
    """把一串貼面的點拉成帶狀。**None 代表射線落空，要斷開**，不然缺口的兩端會被
    一個四邊形接起來，算圖上就是一片飛在外面的白楔子。"""
    prev = None
    for p, n in zip(pts, nrm):
        if p is None:
            prev = None; continue
        q = p + n * 0.006
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            # 【法線要跟著蒙皮朝外】面的繞向取決於掃描方向，整圈的框掃反了就整條
            # 朝內：算圖上被背面剔除整條看不見，`geometry.test.ts` 的「每一個網格
            # 都是法線朝外」也會紅。拿射線打到的蒙皮法線當基準逐面校正。
            try:
                f = bm.faces.new([prev[0], prev[1], b, a])
                f.normal_update()
                if f.normal.dot(n) < 0: f.normal_flip()
            except ValueError: pass
        prev = (a, b)


def arch(bm, y_top, y_sill=None, width=0.045, span=1.4, z0=0.7, T=None):
    """繞著罩子橫向掃一圈的隔框。"""
    if y_sill is None: y_sill = y_top
    pts, nrm = [], []
    for j in range(17):
        th = -math.pi / 2 + math.pi * j / 16
        y0 = y_sill + (y_top - y_sill) * math.cos(th)
        d = Vector((-math.sin(th), 0, -math.cos(th)))
        o = Vector((0, y0, z0)) - d * span * 2.5
        r = (T or GB).ray_cast(o, d, span * 5.0)
        pts.append(r[0]); nrm.append(r[1] if r[0] is not None else None)
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))


def ring(bm, y, width=0.045, z0=0.45, n=64, T=None):
    """繞著機首軸線整整一圈的框。等 y 的剖面線，由正前方看就是一個圓；
    幾道併排就是同心圓。射線由外往內打，落空的角度留 None 讓帶子斷開。"""
    pts, nrm = [], []
    for j in range(n + 1):
        a = 2 * math.pi * (j % n) / n
        d = Vector((math.sin(a), 0.0, math.cos(a)))
        r = (T or GB).ray_cast(Vector((0, y, z0)) + d * 3.0, -d, 6.0)
        pts.append(r[0]); nrm.append(r[1] if r[0] is not None else None)
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))


def meridian(bm, a, y_from, y_to, width=0.04, z0=0.45, n=16, T=None):
    """同一個方位角、沿著機首方向的輻射條。條帶的寬度方向是該方位的切線
    （不是 x 也不是 y），不然斜著擺的那幾條會變窄。"""
    d = Vector((math.sin(a), 0.0, math.cos(a)))
    along = Vector((math.cos(a), 0.0, -math.sin(a)))
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = (T or GB).ray_cast(Vector((0, y, z0)) + d * 3.0, -d, 6.0)
        pts.append(r[0]); nrm.append(r[1] if r[0] is not None else None)
    strip_from_points(bm, pts, nrm, width, along)


def rail(bm, x0, y_from, y_to, width=0.045, n=14, T=None):
    """沿著機首方向的縱樑。"""
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = (T or GB).ray_cast(Vector((x0, y, 4.0)), Vector((0, 0, -1)), 8.0)
        pts.append(r[0]); nrm.append(r[1] if r[0] is not None else None)
    strip_from_points(bm, pts, nrm, width, Vector((1, 0, 0)))


bm = bmesh.new()
# 風擋的直框（中柱 + 兩根分格柱）與側窗的前後框。`arch` 打的是玻璃的 BVH，
# 所以射線只在有窗戶的地方命中 —— 金屬那一段自然不會長出框。
# 座艙那幾片各自帶了自己的框（實體的側面就是），所以這裡只補風擋的分格柱。
# **不要再對座艙打 arch** —— `B17_Glass` 現在只剩機首罩與頂窗，那兩發會落在
# 頂窗與機首上，算圖上是幾片飛出來的白色楔子。
for _x in (-0.30, 0.30):
    rail(bm, _x, 2.62, 3.20, n=8, T=GW)
# 【機首罩是同心圓，不是半圓拱】投彈手機首罩整顆都是玻璃：由 (0, y, 0.45) 打
# 72 個方向，y 5.60…6.32 每一站都是 72/72 命中，半徑 0.794 一路收到 0.034。既然
# 剖面是完整的一圈，隔框就該是完整的一圈 —— 等 y 的剖面線由正前方看就是圓，
# 幾道併排就是同心圓。之前那三道 `arch` 只掃左→頂→右的半圈，底下半圈是空的。
NOSE_RINGS = (5.62, 5.92, 6.16)                         # 半徑約 0.78／0.53／0.28
NOSE_RIBS = 8                                           # 輻射條，45° 一條
for _y in NOSE_RINGS:
    ring(bm, _y)
for _k in range(NOSE_RIBS):
    meridian(bm, 2 * math.pi * _k / NOSE_RIBS, 5.62, 6.24)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
new_object('B17_Frames', bm, [M_FRAME])

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('B17_'):
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total
result = LOG
