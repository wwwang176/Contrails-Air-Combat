# -*- coding: utf-8 -*-
"""
F4F-4 Wildcat：在 Blender 裡對著參考模型直接量、直接 loft（A6M5／Ki-84 那支的做法）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_f4f4.py', encoding='utf-8').read())
沒有 Ref_* 物件時會先把 ref/grumman_f4f_wildcat.glb 匯進來對齊；有就直接建。建完自己匯出：

    use_selection=True（只選 F4F_*）、export_yup=True、export_extras=True、export_apply=True

座標：Blender 系 X 翼展、+Y 機首、Z 上；export_yup 之後是遊戲的 X 翼展、Y 上、−Z 機首。

── 這一支與前兩台不同的地方 ──────────────────────────────────
1. **中翼。** A6M5／Ki-84 是低翼，翼根整流罩只擋腹線；F4F 的主翼接在機身**半高**，
   翼根那一段機身側面（z −0.10…+0.25）整條被擋住，而且參考模型在那裡**根本沒有
   機身蒙皮**（從機身內往外打射線會直接穿出去）。做法與低翼相同：主翼做成一整片
   穿過機身，機身在那一段用上下鄰級內插。
2. **參考模型的起落架是放下的**，而且輪艙是開的洞：機腹 y 0.15…0.75 向下打會打進
   艙頂（讀到 −0.08…−0.28，真值 −0.75）。那一段用兩端的實測值線性內插。
3. **機背有一條窄的背鰭整流脊**（dorsal fin fillet）：y −1.3 起中線 z 比 x 0.18 處
   高 0.26，一路連到垂尾。它是真的，靠 12 mm 的細掃寬度剖面自然抓得到（不要事後
   用超橢圓去配，會被撐平——坑 49）。

── 對齊的驗收（2026-09-06 實測）────────────────────────────
    翼展   11.5202 → 縮放 ×1.00519（史實 11.58）
    翼根弦 LE 2.451 / TE −0.215 / 弦長 2.665，四分之一弦線移到原點
    翼面積 由量到的站位積分 24.1（史實 24.15，+0.3%）
    姿態   三片槳葉的縱向範圍完全相同（槳盤不傾斜）→ 推力線水平，pitch = 0
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

REF_GLB = r"C:\projects\grok-aircraft2\ref\grumman_f4f_wildcat.glb"
SPAN = 11.58          # F4F-4 翼展 38 ft 0 in


def import_and_align_ref():
    """匯入參考模型 → 只留外皮與座艙玻璃 → 縮放、轉正、平移到機體座標。

    【為什麼要拆連通塊】這支模型是**照材質合併**的（坑 33）：整台飛機的不透明件
    全在 `Object_16`／`Object_17` 兩個 mesh 裡，起落架、輪子、螺旋槳、天線索跟蒙皮
    混在一起，用物件名挑不出來。拆成連通塊之後判準只要一條：**翼展方向的幅度
    > 3 m**——只有主體（含機身、主翼、垂尾）與水平尾翼過得了，其餘 39 塊全是雜件。

    【天線索差一點又騙過去】機背到垂尾頂有一條 24 頂點的索（Blender 匯入後
    x ±0.01、縱向跨 3.6 m）。不刪的話「垂尾側視上緣」量出來是 1.80 而不是真值
    1.66——一條平滑單調、看起來完全正常的線（坑 37）。
    """
    O = bpy.data.objects
    before = set(o.name for o in O)
    bpy.ops.import_scene.gltf(filepath=REF_GLB)
    bpy.context.view_layer.update()

    bm = bmesh.new()
    for n in ('Object_16', 'Object_17'):
        o = O[n]
        me = o.data.copy(); me.transform(o.matrix_world.copy())
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    seen = set(); kill = []; kept = []
    for v0 in bm.verts:
        if v0.index in seen: continue
        stack = [v0]; seen.add(v0.index); comp = []
        while stack:
            v = stack.pop(); comp.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen: seen.add(w.index); stack.append(w)
        ys = [v.co.y for v in comp]          # 匯入後 Blender Y 就是翼展軸
        (kept if max(ys) - min(ys) > 3.0 else kill).append(comp)
    bmesh.ops.delete(bm, geom=[v for c in kill for v in c], context='VERTS')
    me = bpy.data.meshes.new('Ref_Body'); bm.to_mesh(me); bm.free()
    body = bpy.data.objects.new('Ref_Body', me); bpy.context.scene.collection.objects.link(body)

    g = O['Object_25']                       # 座艙玻璃（外層；Object_21 是內面，不要）
    gme = g.data.copy(); gme.transform(g.matrix_world.copy()); gme.name = 'Ref_Glass'
    glass = bpy.data.objects.new('Ref_Glass', gme); bpy.context.scene.collection.objects.link(glass)

    # 只刪匯入時新長出來的（含 glTF 留下的 Empty）。**條件是「不在 before 裡」**——
    # 寫成「在 before 裡」會把場景原本的相機、燈、上一輪的 F4F_* 一起刪掉。
    for o in list(O):
        if o.name not in before and o.name not in ('Ref_Body', 'Ref_Glass'):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)

    REF = [body, glass]
    ys = [v.co.y for v in body.data.vertices]
    S = SPAN / (max(ys) - min(ys))
    R = Matrix.Rotation(-math.pi / 2, 4, 'Z')     # 機首 −X → +Y（實證過，不是算的）
    for o in REF: o.data.transform(Matrix.Scale(S, 4) @ R)
    # 整流罩軸：機首最前 0.15 m 的頂點在 x, z 的中心
    py = max(v.co.y for v in body.data.vertices)
    lip = [v.co for v in body.data.vertices if v.co.y > py - 0.15]
    ax = (max(p.x for p in lip) + min(p.x for p in lip)) / 2
    az = (max(p.z for p in lip) + min(p.z for p in lip)) / 2
    for o in REF: o.data.transform(Matrix.Translation(Vector((-ax, 0, -az))))
    # 翼根四分之一弦 → 原點。**站位要在水平尾翼半展（2.08）之外**：x 1.6 的後緣射線
    # 會先打到水平尾翼，讀出 −4.208（真值 0.18）。
    bm = bmesh.new(); bm.from_mesh(body.data)
    bmesh.ops.triangulate(bm, faces=bm.faces); T = BVHTree.FromBMesh(bm); bm.free()
    def chord(x):
        le = te = None
        for k in range(200):
            z = -0.60 + 0.006 * k
            h = T.ray_cast(Vector((x, 4.0, z)), Vector((0, -1, 0)), 8.0)[0]
            if h is not None and (le is None or h.y > le): le = h.y
            h = T.ray_cast(Vector((x, -5.0, z)), Vector((0, 1, 0)), 8.0)[0]
            if h is not None and (te is None or h.y < te): te = h.y
        return le, te
    (l1, t1), (l2, t2) = chord(2.6), chord(3.6)
    ex = lambda a, b: a + (b - a) * (0.0 - 2.6) / 1.0
    le_r, te_r = ex(l1, l2), ex(t1, t2)
    qc = le_r - 0.25 * (le_r - te_r)
    for o in REF: o.data.transform(Matrix.Translation(Vector((0, -qc, 0))))
    return {'islands_kept': [len(c) for c in kept], 'scale': round(S, 5),
            'root_chord': [round(le_r, 3), round(te_r, 3), round(le_r - te_r, 3)], 'qc': round(qc, 3)}


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
# Blue Gray（ANA 603）—— 1942–43 年美國海軍艦載機的上表面色。真機是上 Blue Gray／
# 下 Light Gray 的雙色，而 GlbAircraft 只有一個 bodyColor；先用上表面色，雙色要不要
# 支援是專案負責人的裁決。比 F6F-5 的 Glossy Sea Blue 亮，空中分得出兩台。
M_BODY = mat('F4F_Body', srgb(0x54626b))
M_ACC = mat('F4F_Accent', srgb(0x22282c))
M_GLASS = mat('F4F_Glass', srgb(0x9fd4e8), 0.45)
M_COCK = mat('F4F_Cockpit', srgb(0x171a1c))
M_FRAME = mat('F4F_Frame', srgb(0x54626b))

# ───────────────────────── 場景清理 ─────────────────────────
for o in list(O):
    if o.name.startswith('F4F_') or o.name.startswith('Cut_'):
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    if m.users == 0: bpy.data.meshes.remove(m)
COLL = bpy.data.collections.get('F4F')
if COLL is None:
    COLL = bpy.data.collections.new('F4F'); bpy.context.scene.collection.children.link(COLL)

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
BODYG = bvh_of(['Ref_Body', 'Ref_Glass'])     # 機身＋玻璃：罩子一起 loft 進去，之後盒切
WING = bvh_of(['Ref_Body'])
TAIL = bvh_of(['Ref_Body'])
def hit(T, o, d, L=9.0): return T.ray_cast(Vector(o), Vector(d), L)[0]
def zmax_at(T, x, y):
    h = hit(T, (x, y, 3.0), (0, 0, -1)); return h.z if h else None
def zmin_at(T, x, y):
    h = hit(T, (x, y, -3.0), (0, 0, 1)); return h.z if h else None
def halfw(T, y, z, x0):
    h = hit(T, (x0, y, z), (-1, 0, 0) if x0 > 0 else (1, 0, 0)); return h.x if h else None

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
# 站位（機首 → 機尾）。1.95 是引擎罩唇（前封蓋塗黑就是引擎面）；−0.02…−1.28 是玻璃
# 的前後端，兩端各補一站讓盒切的邊界落在環上；−5.80 之後收尾錐。
FUS_Y = [1.95, 1.92, 1.88, 1.82, 1.74, 1.64, 1.50, 1.35, 1.20, 1.05, 0.90, 0.75, 0.60,
         0.45, 0.30, 0.15, 0.02, -0.02, -0.14, -0.28, -0.42, -0.56, -0.70, -0.84, -0.98,
         -1.12, -1.24, -1.32, -1.46, -1.62, -1.80, -2.00, -2.25, -2.50, -2.80, -3.10,
         -3.45, -3.80, -4.10, -4.40, -4.60, -5.00, -5.40, -5.80]
# 尾錐末端。**量到的是 −5.92 而不是 −6.00**：參考模型在 y −5.90 的最低面還有
# −0.040，到 −5.95 就只剩中線上一片 0.159 的薄邊 —— 那已經是方向舵，不是機身。
TAIL_POLE = Vector((0, -5.93, 0.03))
LEVELS = 8                    # 每側 8 級 + 頂底兩尖 = 18 點/環（與 A6M5／Ki-84 同級）
W_CAP = 0.78                  # 半寬上限：機身實測最寬 0.716，主翼／尾翼的命中一律 ≥ 1.0
W_MIN = 0.10                  # 內側射線的下限：機腹中線的窄龍骨會讀回 0.02
BELLY_BAND = (-0.55, 0.85)    # 翼根段的腹線：改用兩端實測值內插
BELLY_ANCHOR = ((0.90, -0.758), (-0.60, -0.768))
TP_BAND_Y = -4.55             # 這站以後，z 落在水平尾翼帶的寬度作廢
TP_BAND_Z = (0.44, 0.62)
# 【門檻的起點 = 中線頂線觸底的那一站，不能更早】F4F-4 有一條窄的**背鰭**
# （dorsal fin），中線比離軸 0.12 處高出 0.06…0.16：
#
# ```
#   y        -3.0   -3.2   -3.4   -3.6   -3.8   -4.0   -4.2   -4.4
#   中線     0.771  0.719  0.668  0.618  0.590  0.586  0.615  0.673
#   x 0.12   0.709  0.652  0.601  0.541  0.488  0.432  0.372  0.315
#   差       0.062  0.067  0.067  0.077  0.102  0.154  0.243  0.358
# ```
#
# 「寬度 ≥ 0.13 才算」是用來濾掉垂尾那片薄板的，但背鰭在 y −4.0 的半寬只有
# 0.10 —— 門檻訂在 −3.45 會把整條背鰭一起砍掉，中線頂線因此低了 0.04…0.16。
#
# 【交班點就在中線頂線觸底的那一站，不要更後面】參考模型在這一段的剖面是
# **「機身 + 一片等寬的背鰭」**，中間有一道折：
#
# ```
#   y = -4.4   z 0.20   0.25   0.30   0.35   0.40   0.45   0.50
#   參考半寬   0.257  0.186  0.125  0.116  0.115  0.108  0.100
#                          ↑ 一刀折下去，之後是等寬 0.115 的鰭
# ```
#
# 折以下是機身、折以上是背鰭。門檻推到 −4.55 的話機身自己會長出一根尖刺
# （0.163／0.141／0.119…）去重複垂尾那片板，剖面不再是水滴狀的內收，
# 看起來就是「頂點被抬高了」。
#
# 台階不是靠這個門檻治好的，是靠**垂尾低處的前緣改成反解中線頂線**（見
# fin_le）—— 那一步之後垂尾在 −4.2／−4.4 已經有 0.61／0.70 高，機身被切掉
# 的那一段整個藏在裡面。
FIN_BAND_Y = -4.02
STA_TOP_CLEAN = (-4.02, 0.586)

# ── 機背（龜背）是獨立的一件 ────────────────────────────────────
#
# 【為什麼要拆】機身環是「腹線極點 → LEVELS 級 → 頂極點」，級距用餘弦分佈（頂底密）。
# 在 y −1.5 那一站腹線 −0.77、冠線 +1.06，1.83 m 分 8 級，而餘弦把點擠到**上下兩端**，
# 曲率最大的肩部（z −0.3…+0.3）只分到三級、間距 0.3 m。算圖上那一段就是兩片平板夾
# 一道硬稜，側視看是一條從座艙後方往上後掠的亮線 —— 負責人 2026-09-07：「機身線條
# 不應該往上走」。
#
# 【做法：純分件，外表面不變】機身環的頂端由一個極點改成折線上的**兩點**
# （±w_fold, z_fold），機背從同一圈邊往上長到冠線。兩件共用那圈邊，所以合起來的
# 外皮與單件 loft 完全一樣；差別是機身的 8 級現在只要撐 −0.77…0.50（間距 0.16），
# 機背再自己分 DLEVELS 級。折線之外的站位 w_fold = 0，兩點重合，`finish()` 的
# remove_doubles 會把它收回成極點 —— 環的點數因此全長一致，loft 不必分段。
#
# 【折線是量出來的】剖面在機身頂／機背底之間有一道折：半寬沿 z 往上的增量由每
# 0.05 約 0.05…0.08（機身在張開）掉到約 0.022（機背在收）。實測（Ref_Body）：
#
# ```
#   y        -1.3   -1.6   -2.0   -2.4   -2.8   -3.2   -3.6   -4.0
#   折 z     0.59   0.53   0.47   0.46   0.47   0.42   0.37   0.34
#   冠 z     1.089  1.034  0.974  0.912  0.822  0.719  0.618  0.586
# ```
#
# 【前端要蓋過整個座艙，不能停在座艙罩後緣】停在 −1.28 的話，機身頂在 −1.24 還是
# 冠線 1.08、到 −1.32 就掉成折線 0.53，中間是一片近乎垂直的牆，而機背的前封蓋又
# 剛好貼在那裡 —— 算圖上是一道裂縫。往前拉到 +0.30 之後，座艙那一段量到的「折」
# 自然就是**艙緣線**（參考模型在那裡的剖面本來就是「機身 + 座艙罩」兩段），機身
# 因此整條都是子彈狀，而機背件就是「座艙罩整流 + 龜背」一整條 —— 與參考模型
# f4f_wildcat 把 Object_9 從風擋一路做到垂尾是同一個分法。玻璃盒的布林要**兩件
# 都切**（見第 2 節），座艙開口才會同時穿過機身與機背。
#
# 後端接在 FIN_BAND_Y —— 那一站的冠線正好是 STA_TOP_CLEAN，也就是垂尾前緣反解
# 出來的交班點（見 fin_le），所以機背收尾整片藏在垂尾裡面。
#
# 【參考模型的分件方式】`ref/f4f_wildcat.glb`（Sketchfab, ScheeWheed, CC-BY-NC-4.0，
# 只當分件的範例看，尺寸不可信：翼展對齊後全長短了 8%）把座艙罩＋龜背＋垂尾做成
# 一件 `Object_9`（z 到 1.013）疊在子彈狀機身 `Object_10`（z 只到 0.428）上，底邊
# 沉進機身 0.05…0.10。本專案取它的分件想法，形狀仍照自家 ref 量。
DORSAL_Y = (FIN_BAND_Y, -0.02)     # [後, 前]；前端 = 風擋，見下
DLEVELS = 5                        # 機背每側的級數

def belly_fix(y):
    """翼根段的腹線。**不是平滑處理，是把量壞的一段換掉**，兩個原因疊在一起：

      y 0.15…0.75   主輪艙是開的，向下的射線打進艙裡讀到艙頂 −0.08…−0.28
      y 0.20…−0.35  中線有一條窄龍骨（輪艙隔板），x ±0.10 的射線掃到它的肩，
                    讀到 −0.837 而機腹在 x 0.12 處是平順的 −0.763

    **本專案不做輪胎凹槽**（負責人 2026-09-06），所以兩者一起換掉：兩端的實測值
    −0.758（y 0.90）與 −0.768（y −0.60）之間拉一條直線。機腹在那一段本來就幾乎是
    平的 —— x 0.12 的實測由 y 0.9 的 −0.746 走到 y −0.6 的 −0.756。"""
    (y0, z0), (y1, z1) = BELLY_ANCHOR
    if BELLY_BAND[0] <= y <= BELLY_BAND[1]:
        return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return None

def station(y):
    T = BODYG
    st = [v for v in [zmax_at(T, x, y) for x in (0.10, -0.10, 0.14, -0.14)] if v is not None]
    ctop = zmax_at(T, 0.03, y)
    side_top = max(st) if st else ctop
    top = side_top if (ctop is None or ctop > side_top + 0.30) else max(ctop, side_top)
    # 腹線：不取中線。中線在 y 0.25…−0.35 讀到一條 0.24 寬、0.15 深的窄龍骨（機腹在
    # x 0.12 處是平順的 −0.765），那是參考模型的細節，與 Ki-84 K7 的凹槽同一類。
    sb = [v for v in [zmin_at(T, x, y) for x in (0.10, -0.10, 0.14, -0.14)] if v is not None]
    bot = min(sb) if sb else zmin_at(T, 0.0, y)
    bf = belly_fix(y)
    if bf is not None: bot = bf
    if top is None or bot is None or top <= bot:
        return None
    # 下限只在機身還寬的那一段成立：尾錐末端（y −5.8）真的只有 0.087 寬。
    wmin = W_MIN if y > -3.0 else 0.0
    n = max(12, int((top - bot) / 0.012))
    zs, ws, raw = [], [], []
    for i in range(n + 1):
        z = bot + (top - bot) * i / n
        # 兩個原點都打，**外面那條優先**：由外往內的第一個交點必然是最外層的蒙皮，
        # 打不到機身時讀到的是主翼（≥ 1.0），上限一擋就掉。
        #
        # 【下限一樣重要，而且兩條射線都要擋】主輪艙那一段（y 0.15…0.75）參考模型的
        # 機身側面蒙皮**整片不存在**，由外往內的射線一路穿到中線上一片 |x| = 0.02 的
        # 薄壁 —— 那是輪艙的隔板，也就是專案不做的那個凹槽。0.02 通得過上限檢查，
        # 於是有三四級的半寬變成 0.02，下半身被夾成一條縫；算圖上是一塊看穿到機身
        # 內部的暗色方塊，而網格是封閉的、邊界邊一條都沒有，拓樸檢查抓不到。
        w1 = halfw(T, y, z, 3.0)
        w2 = hit(T, (0.0, y, z), (1, 0, 0), 3.0)
        w2 = w2.x if w2 else None
        w = None
        for c in (w1, w2):
            if c is not None and wmin < c <= W_CAP: w = c; break
        raw.append(w)
        if y <= TP_BAND_Y and TP_BAND_Z[0] <= z <= TP_BAND_Z[1]: w = None
        zs.append(z); ws.append(w)
    # 尾段：頂由「寬度 ≥ 門檻的最高 z」決定（垂尾是薄片，半厚 ≤ 0.11）
    if y <= FIN_BAND_Y:
        cand = [z for z, w in zip(zs, raw) if w is not None and abs(w) >= 0.13]
        if cand:
            top = min(top, max(cand) + 0.012)
        y0, t0 = STA_TOP_CLEAN
        lin = t0 + (TAIL_POLE.z - t0) * (y - y0) / (TAIL_POLE.y - y0)
        top = min(top, lin)
        keep = [i for i, z in enumerate(zs) if z <= top]
        if len(keep) >= 3:
            zs = [zs[i] for i in keep]; ws = [ws[i] for i in keep]
    valid = [i for i, w in enumerate(ws) if w is not None]
    if not valid: return None
    fixed = []; ok = []
    for i, w in enumerate(ws):
        ok.append(w is not None)
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
    """細掃的 (z, w) 重取樣成 L 級（餘弦分佈：頂底密）。第三個欄位記「這一級底下的
    兩個取樣點是不是真的量到的」——沿 z 內插只在缺口很短時可信，主輪艙與翼根整流罩
    那種一次吃掉大半個下半身的缺口要沿 y 補（見 fill_bands）。"""
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

def fold_of(s):
    """機身頂／機背底的那道折，由細掃剖面自己找出來。

    判準是**半寬對 z 的斜率**：機身那一側在張開（每 0.05 掉 0.05…0.08），機背那一側
    在收（約 0.022）。折就是斜率最不負的那個轉折 —— 取二階差最大的 z。搜尋範圍限在
    剖面上半（0.45 以上）到冠線下 0.06，免得把腹線的圓角或頂點當成折。
    """
    if not (DORSAL_Y[0] <= s['y'] <= DORSAL_Y[1]): return None
    zs, ws = s['z'], s['w']
    def w_at(z):
        if z <= zs[0]: return ws[0]
        if z >= zs[-1]: return ws[-1]
        for i in range(len(zs) - 1):
            if zs[i] <= z <= zs[i + 1]:
                f = (z - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0.0
                return ws[i] + (ws[i + 1] - ws[i]) * f
        return ws[-1]
    bot, top = s['bot'], s['top']
    h = 0.05
    lo = bot + 0.45 * (top - bot); hi = top - 0.06
    if hi - lo < 3 * h: return None
    best = None; bz = None
    z = lo + h
    while z <= hi - h:
        d2 = (w_at(z + h) - 2 * w_at(z) + w_at(z - h)) / (h * h)
        if best is None or d2 > best: best, bz = d2, z
        z += 0.01
    return bz

def fill_bands(sta):
    """量不到的級沿 **y** 補，不要沿 z 補。

    【第一版沿 z 補，下半身被夾扁】主輪艙是開的，翼根整流罩底下的機身蒙皮參考模型
    根本沒建，所以 y 0.15…0.85 由腹線一路到 z +0.18 一格都量不到。沿 z 內插時底端
    被釘成 0（那是腹線的極點），整個下半身於是收成一條縫 —— 算圖上是一塊看穿到
    機身內部的暗色方塊，而且**網格是封閉的、一條邊界邊都沒有**，靠拓樸檢查抓不到。

    沿 y 補則是拿翼根前（y 0.90）與翼根後（y −2.00）兩個乾淨的剖面去撐這一段，
    而那兩站的最大半寬是 0.696 與 0.701 —— 機身在那一段本來就幾乎等寬。"""
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

STA = []
for y in FUS_Y:
    s = station(y)
    if s is None: continue
    STA.append(s)
# 【尾段的頂線必須單調收斂】「寬度 ≥ 門檻」在最後幾站找不到候選（整段都比門檻窄），
# 那時只剩直線在管，於是 y −5.4 是 0.108 而 −5.8 回到 0.162 —— 尾錐末端反而變高。
for a, b in zip(STA, STA[1:]):
    if b['y'] <= FIN_BAND_Y and b['top'] > a['top']: b['top'] = a['top']
for s in STA: s['fold'] = fold_of(s)

# 【折線再往上抬到「機背只有這麼厚」】量到的膝點是剖面上真實的曲率轉折，照它做
# 出來的機背在 y −2.5 有 0.43 厚；`ref/f4f_wildcat.glb`（Sketchfab, ScheeWheed,
# CC-BY-NC-4.0）同一站只有 0.33。**負責人 2026-09-07 裁定照後者的厚度**。
#
# 那支的機身頂看起來更高（−2.5 是 0.611，我的膝點是 0.465），但**不能直接搬**：
# 它的機身件在頂端只有 0.155 半寬，而該處外皮實際是 0.26 —— 它的機身是一顆藏在
# 機背裡的內膽，兩件互相穿插，不是像本專案沿一圈邊對接。可以搬的是**機背的厚度**。
#
# 抬高折線不動外皮（折線只決定兩件在哪交班），代價只是機身的 8 級要撐高一點、
# 機背的 DLEVELS 級撐得更密。
H_DORSAL = [(-0.14, 0.162), (-0.28, 0.290), (-0.42, 0.385), (-0.70, 0.382),
            (-0.98, 0.379), (-1.24, 0.377), (-1.46, 0.378), (-1.80, 0.368),
            (-2.25, 0.353), (-2.50, 0.329), (-2.80, 0.289), (-3.10, 0.249),
            (-3.45, 0.203), (-3.80, 0.199)]
def dorsal_h(y):
    if y >= H_DORSAL[0][0]: return H_DORSAL[0][1]
    if y <= H_DORSAL[-1][0]: return H_DORSAL[-1][1]
    for (y0, h0), (y1, h1) in zip(H_DORSAL, H_DORSAL[1:]):
        if y1 <= y <= y0: return h0 + (h1 - h0) * (y - y0) / (y1 - y0)
    return H_DORSAL[-1][1]
for s in STA:
    if s['fold'] is None: continue
    s['fold'] = max(s['fold'], s['top'] - dorsal_h(s['y']))
# 沿 y 平滑一次（λ0.5）：折是一條連續的線，逐站找出來的極值會有 10…20 mm 的抖。
_fi = [i for i, s in enumerate(STA) if s['fold'] is not None]
for _ in range(2):
    _new = {}
    for k, i in enumerate(_fi):
        if k == 0 or k == len(_fi) - 1: continue
        a, b = STA[_fi[k - 1]], STA[_fi[k + 1]]
        t = (STA[i]['y'] - a['y']) / (b['y'] - a['y'])
        _new[i] = STA[i]['fold'] + (a['fold'] + (b['fold'] - a['fold']) * t - STA[i]['fold']) * 0.5
    for i, v in _new.items(): STA[i]['fold'] = v
# 【尾端要收成零高度，不能切一刀】機背若在 −3.80 就結束，那一片朝後的封蓋是露出來的：
# 再往後機身頂會跳回冠線（FIN_BAND_Y 之後由 STA_TOP_CLEAN 那條線管），中間差 0.2 m。
# 把最後一站的折線頂到冠線，機背在那裡厚度歸零、環退化成一點，remove_doubles 收掉，
# 機身的環頂也自動變回極點。交班處正好是垂尾前緣反解出來的 −4.0（見 fin_le），
# 也就是背鰭併進垂尾的那一點。
# 【尾端要收成零高度，不能切一刀】機背若在折線帶的最後一站就結束，那一片朝後的封蓋
# 是露出來的：再往後機身頂會跳回冠線（FIN_BAND_Y 之後由 STA_TOP_CLEAN 那條線管）。
# 所以在帶外**再補一站**、折線頂到該站自己的冠線：機背在那裡厚度歸零、環退化成一點，
# remove_doubles 收掉，機身的環頂也自動變回極點。交班處正好是垂尾前緣反解出來的
# −4.0（見 fin_le），也就是背鰭併進垂尾的那一點。
#
# **這一站不能參與上面的平滑**：它的折線是人為頂到冠線的，拉進拉普拉斯會把前兩站
# 的折線一起往下扯（實測 −3.80 由 0.364 掉到 0.224，機背基座反而變胖）。
# 【兩端要「漸進收掉」，不能一站切死】機背的環在折線帶外是退化的一點、帶內第一站就
# 是完整一圈，中間機身與機背各自從那一點張成一片錐面 —— 兩片不同的錐面佔同一塊
# 空間，算圖上是風擋前一團互相穿插的碎面。
#
# 根因是**級數的意義變了**：機身的 L 級在帶外撐 bot…冠線、在帶內只撐 bot…折線，
# 同一個 k 在相鄰兩站的高度差一大截，loft 把它們接起來就會扭。
#
# 做法：把機背的高度 h = 冠線 − 折線 在帶外沿 K 站線性收到 0，級數的意義因此
# 逐站慢慢改，不會一次跳掉。前端 4 站（約 0.6 m）、後端 2 站就夠。
def _taper(i0, step, K):
    if not (0 <= i0 < len(STA)): return
    h0 = STA[i0]['top'] - STA[i0]['fold']   # 此時 top 仍是冠線，crown 還沒存
    for j in range(1, K + 1):
        i = i0 + step * j
        if not (0 <= i < len(STA)) or STA[i]['fold'] is not None: return
        STA[i]['fold'] = STA[i]['top'] - h0 * max(0.0, 1.0 - j / K)
        STA[i]['taper'] = (j == K)      # 高度歸零的那一站，平滑之後要釘回冠線
# 【前端只收一站，就收在風擋上】風擋之前沒有機背整流，那一段本來就是機身甲板
# （負責人 2026-09-07 圈的正是 y −0.24…+0.90）。但完全不收會破洞：+0.02 的機身環
# 還收在冠線、−0.02 已經收在折線，中間那 40 mm 沒有任何面蓋得到（實測 y 0.00 的
# 剪影由 0.822 掉到 0.593）。補一站、把機背高度收到零，機背就從冠線上的一個點張
# 成 −0.02 的整圈，正好蓋住那一段；機身自己那片斜面藏在裡面。
_taper(_fi[0], -1, 1) if _fi else None      # 前端：風擋那一站
_taper(_fi[-1], +1, 2) if _fi else None     # 後端：往機尾方向
# 收尾站補進來之後再平滑一次（兩端固定）。**風擋那一站的折線偵測不可靠**：剖面在
# 那裡本來就含風擋，二階差找到的是風擋根而不是機身頂，實測 −0.02 讀到 0.377 而鄰站
# −0.14 是 0.595。不修的話機背在那一段要從一個點張開 0.45 m，算圖上是一片扇形。
_fj = [i for i, s in enumerate(STA) if s['fold'] is not None]
for _ in range(2):
    _new = {}
    for k in range(1, len(_fj) - 1):
        i = _fj[k]; a, b = STA[_fj[k - 1]], STA[_fj[k + 1]]
        t = (STA[i]['y'] - a['y']) / (b['y'] - a['y'])
        _new[i] = STA[i]['fold'] + (a['fold'] + (b['fold'] - a['fold']) * t - STA[i]['fold']) * 0.5
    for i, v in _new.items(): STA[i]['fold'] = min(v, STA[i]['top'])

# ── 折線本身要是一條水滴線 ──────────────────────────────────
#
# 【它是構造線，不是外皮】折線只決定兩件在哪裡交班與各自的級數怎麼分；只要它落在
# 腹線與冠線之間，合起來的外皮一個頂點都不會動。所以它不必照著逐站量到的「膝點」
# 走 —— 那個膝點在座艙段量到的其實是**艙緣**（剖面在那裡本來就是「機身 + 座艙罩」），
# 於是機身自己的線在 +0.02 一站掉 156 mm（0.809 → 0.657），−0.14 到 −0.42 還鼓一個
# 30 mm 的包（0.618 → 0.629 → 0.648）。機身應該是一條由機首拉到機尾的水滴。
#
# 做法兩步：**先壓單調**（由風擋往後只能降，把包削掉），**再多平滑幾輪**（把風擋
# 那一站的陡降攤到三四站上）。兩端固定：前端是收尾站（動了會破洞，見上），後端是
# 併進垂尾的那一點。
for k in range(1, len(_fj)):
    a, b = STA[_fj[k - 1]], STA[_fj[k]]
    if b['fold'] > a['fold']: b['fold'] = a['fold']
for _ in range(8):
    _new = {}
    for k in range(1, len(_fj) - 1):
        i = _fj[k]; a, b = STA[_fj[k - 1]], STA[_fj[k + 1]]
        t = (STA[i]['y'] - a['y']) / (b['y'] - a['y'])
        _new[i] = STA[i]['fold'] + (a['fold'] + (b['fold'] - a['fold']) * t - STA[i]['fold']) * 0.5
    for i, v in _new.items(): STA[i]['fold'] = min(v, STA[i]['top'])

# 【座艙段的折線要拉一條餘弦過渡，不能照著量到的膝點走】剖面在座艙段本來就是
# 「機身 + 座艙罩」兩段，量到的膝點是**艙緣**而不是機身該有的線；照著走的話折線
# 由風擋的 0.813 兩站之內掉到 0.714（每單位 y 掉 0.90），而級數是腹線到頂線的固定
# 比例 —— 八條級線在那裡整組跟著俯衝，算圖上每一條都折一下（負責人 2026-09-07）。
#
# 折線只要落在腹線與冠線之間就合法，所以直接由**風擋的冠線**拉到**座艙後方的膝點**
# 拉一條餘弦（兩端斜率為零，接得上前面的甲板也接得上後面的龜背）。過渡段的折線會
# 略高於艙緣，多出來的那一點由玻璃盒的布林切掉 —— 與單件時的行為相同。
BLEND_END_Y = -1.40
_b1 = next((i for i in _fj if STA[i]['y'] <= BLEND_END_Y), None)
if _fj and _b1 is not None:
    _y0, _z0 = STA[_fj[0]]['y'], STA[_fj[0]]['fold']
    _y1, _z1 = STA[_b1]['y'], STA[_b1]['fold']
    for i in _fj:
        if not (_y1 < STA[i]['y'] < _y0): continue
        u = (STA[i]['y'] - _y0) / (_y1 - _y0)
        STA[i]['fold'] = min(_z0 + (_z1 - _z0) * (0.5 - 0.5 * math.cos(math.pi * u)),
                             STA[i]['top'])

def span_levels(s, z0, z1, L):
    """細掃剖面在 [z0, z1] 之間取 L 級（餘弦分佈），回傳 [(w, z)]。"""
    zs, ws = s['z'], s['w']; out = []
    for k in range(1, L + 1):
        t = k / (L + 1)
        zz = z0 + (z1 - z0) * (0.5 - 0.5 * math.cos(math.pi * t))
        w = ws[-1]
        for i in range(len(zs) - 1):
            if zs[i] <= zz <= zs[i + 1]:
                f = (zz - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0.0
                w = ws[i] + (ws[i + 1] - ws[i]) * f; break
        out.append((w, zz))
    return out

# 機背的級數要在動 s['top'] 之前算完，之後機身的 top 就換成折線。
for s in STA:
    s['crown'] = s['top']; s['wfold'] = 0.0; s['lvd'] = None
    if s['fold'] is None: continue
    s['lvd'] = span_levels(s, s['fold'], s['crown'], DLEVELS)
    s['wfold'] = span_levels(s, s['fold'] - 0.001, s['fold'] + 0.001, 1)[0][0]
    s['top'] = s['fold']

for s in STA:
    s['lv'] = resample(s)

def w_at(s, z):
    zs, ws = s['z'], s['w']
    if z <= zs[0]: return ws[0], s['ok'][0]
    if z >= zs[-1]: return ws[-1], s['ok'][-1]
    for i in range(len(zs) - 1):
        if zs[i] <= z <= zs[i + 1]:
            f = (z - zs[i]) / (zs[i + 1] - zs[i]) if zs[i + 1] > zs[i] else 0.0
            return ws[i] + (ws[i + 1] - ws[i]) * f, (s['ok'][i] and s['ok'][i + 1])
    return ws[-1], s['ok'][-1]

def smooth_level_z(sta, passes=6, lam=0.5, room=0.30):
    """**級線的高度要沿 y 平滑，再回細掃剖面重新取半寬。**

    resample 把八級放在 bot…top 之間的固定比例上，所以 top 一動，八條級線整組跟著
    動。機身頂線在風擋是一段陡降（0.813 → 0.777 → 0.714 → 0.655，每單位 y 掉 0.90
    → 0.42），於是每一條級線在那裡都折一下 —— 負責人 2026-09-07 圈的正是這個。
    **表面本身是對的**（固定高度的水線與參考模型走勢一致，z 0.55 那條兩邊的峰都在
    y 0.0），錯的是取樣線。

    做法：把每一級的 **絕對 z** 沿 y 做拉普拉斯，再用平滑後的 z 回 `station()` 留下
    的細掃剖面重新查半寬 —— 線順了，而每一點仍然落在量到的剖面上，外皮不會漂。

    `room` 是每一級可以離開餘弦位置的上限（本站高度的比例）。不設的話尾錐那種很矮
    的站位會被前一站的大高度拉爆，八級全擠到頂或底。

    **要在 fill_bands 之前做**：重新查半寬會把主輪艙那一段的假值再讀回來，得讓
    fill_bands 在後面重補一次（它是沿 y 補的，見該函式）。
    """
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
smooth_level_z(STA)
fill_bands(STA)

def smooth_levels(sta, passes=2, lam=0.5, thr=0.06):
    """站間平滑（y 不等距的拉普拉斯）。門檻 0.06 = 「要保住的特徵相鄰兩站差多少」
    （坑 44）：引擎罩唇與風擋那種真的階不抹。"""
    for _ in range(passes):
        new = []
        for i, s in enumerate(sta):
            if i == 0 or i == len(sta) - 1:
                new.append((s['lv'], s['top'], s['bot'], s['crown'])); continue
            a, b = sta[i - 1], sta[i + 1]
            t = (s['y'] - a['y']) / (b['y'] - a['y'])
            lv = []
            for k in range(LEVELS):
                wa, za, _ = a['lv'][k]; wb, zb, _ = b['lv'][k]; w, z, _ = s['lv'][k]
                wl = wa + (wb - wa) * t; zl = za + (zb - za) * t
                if abs(w - wl) < thr and abs(z - zl) < thr:
                    lv.append((w + (wl - w) * lam, z + (zl - z) * lam, True))
                else: lv.append((w, z, True))
            tl = a['top'] + (b['top'] - a['top']) * t
            bl = a['bot'] + (b['bot'] - a['bot']) * t
            top = s['top'] + (tl - s['top']) * lam if abs(tl - s['top']) < thr else s['top']
            bot = s['bot'] + (bl - s['bot']) * lam if abs(bl - s['bot']) < thr else s['bot']
            # 【冠線也要平滑】機身的 top 現在是折線，冠線交給機背件用，兩條都是外皮的
            # 一部分。少平滑這一條的話座艙罩頂會由 1.082 變成 1.143 —— 玻璃是從機背
            # INTERSECT 出來的，冠線的抖會原封不動長在罩子上。
            cl = a['crown'] + (b['crown'] - a['crown']) * t
            cr = s['crown'] + (cl - s['crown']) * lam if abs(cl - s['crown']) < thr else s['crown']
            new.append((lv, top, bot, cr))
        for s, q in zip(sta, new): s['lv'], s['top'], s['bot'], s['crown'] = q
smooth_levels(STA)
# 【機背的基準要在平滑之後重算】smooth_levels 會把 s['top'] 動個幾 mm，而機身環的
# 頂端兩點用的就是 s['top'] 與 s['wfold'] —— 機背若還用平滑前的值，兩件之間會裂一條縫。
for s in STA:
    if s['fold'] is None: continue
    # 【收尾站要釘回冠線】smooth_levels 把折線與冠線分開平滑，收尾站的折線因此由
    # 0.813 掉到 0.789 —— 那 24 mm 機背不再覆蓋（機背在更前面的站位根本不存在），
    # 剪影在 y +0.05 就掉了 21 mm。這一站的機背高度必須**恰好**是零。
    if s.get('taper'): s['top'] = s['crown']
    s['lvd'] = span_levels(s, s['top'], s['crown'], DLEVELS)
    s['wfold'] = span_levels(s, s['top'] - 0.001, s['top'] + 0.001, 1)[0][0]

def ring_of(s):
    """機身的一圈剖面。**頂端是兩點不是一個極點**：機背件從這兩點往上長（見
    DORSAL_Y）。沒有機背的站位 wfold = 0，兩點重合，finish() 的 remove_doubles
    會把它收回成極點 —— 環的點數因此全長一致。"""
    y = s['y']; wf = s.get('wfold', 0.0); pts = [Vector((0, y, s['bot']))]
    for w, z, _ in s['lv']: pts.append(Vector((w, y, z)))
    pts.append(Vector((wf, y, s['top'])))
    pts.append(Vector((-wf, y, s['top'])))
    for w, z, _ in reversed(s['lv']): pts.append(Vector((-w, y, z)))
    return pts

bm = bmesh.new()
vs = loft(bm, [ring_of(s) for s in STA])
cap(bm, vs[0]); fan(bm, vs[-1], TAIL_POLE)
finish(bm)
for f in bm.faces:
    if f.calc_center_median().y > FUS_Y[0] - 0.005: f.material_index = 1   # 引擎面
fus = new_object('F4F_Fuselage', bm, [M_BODY, M_COCK])
LOG['fus_stations'] = [[round(s['y'], 2), round(s['top'], 3), round(s['bot'], 3),
                        round(max(w for w, z, _ in s['lv']), 3)] for s in STA]

# ── 機背（龜背）：與機身共用折線那一圈邊 ─────────────────────
# 環是 (wf, fold) → DLEVELS 級 → 冠線極點 → 鏡射 → (−wf, fold)，**封閉實體**：
# 底面與機身環頂端的那條平頂共面，但兩片都在合體的內部（外面看到的一律是側皮），
# 而且封閉才切得動布林 —— 座艙玻璃就是從這一件 INTERSECT 出來的。
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
new_object('F4F_Dorsal', bm, [M_BODY])
LOG['dorsal'] = [[round(s['y'], 2), round(s['top'], 3), round(s['crown'], 3),
                  round(s['wfold'], 3)] for s in DST]

# ═══════════════════════════ 2. 座艙：盒切玻璃 + 黑色內槽 ═══════════════════════════
def hull_object(name, pts, mat_, hide=True):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, [mat_], hide=hide)
# 玻璃盒：前後壁垂直，底面是量到的艙緣斜線（前 0.808、後 0.698；參考玻璃的最低 z
# 由 y −0.06 的 0.804 一路降到 y −1.20 的 0.701）
GLASS_Y0, GLASS_Y1 = 0.00, -1.28
SILL_F, SILL_R = 0.808, 0.698
gb = []
for x in (-1.2, 1.2):
    gb += [(x, GLASS_Y0, SILL_F), (x, GLASS_Y0, 2.2), (x, GLASS_Y1, SILL_R), (x, GLASS_Y1, 2.2)]
cut_glass = hull_object('Cut_Glass', gb, M_COCK)
tb = [(sx * 0.22, y, z) for sx in (-1, 1) for y in (-1.15, -0.15) for z in (0.40, 0.90)]
cut_tub = hull_object('Cut_Tub', tb, M_COCK)

def boolean_apply(ob, cutter, op):
    md = ob.modifiers.new('B', 'BOOLEAN'); md.operation = op; md.object = cutter; md.solver = 'EXACT'
    if hasattr(md, 'material_mode'): md.material_mode = 'TRANSFER'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data; ob.modifiers.clear(); ob.data = me
    me.name = old.name + '_b'; bpy.data.meshes.remove(old); me.name = ob.name
    return ob

# 【玻璃的來源是機背件，不是機身】艙緣線（前 0.808、後 0.698）在整個座艙段都**高於
# 折線**（−0.42 的折是 0.669、−1.24 是 0.538），所以罩子的外皮整片屬於機背；從機身
# 切會得到空的網格。
glass = bpy.data.objects.new('F4F_Glass', O['F4F_Dorsal'].data.copy()); COLL.objects.link(glass)
boolean_apply(glass, cut_glass, 'INTERSECT')
# 刪封蓋：面心落在切割盒任一個面的平面上、法線平行。**判準要用盒子自己的面**——
# 手寫條件會漏掉斜底，而那一片與機身塗黑的切面完全共面，遊戲裡會閃爍。
bm = bmesh.new(); bm.from_mesh(glass.data); bm.normal_update()
cb = bmesh.new(); cb.from_mesh(cut_glass.data); cb.normal_update()
planes = [(f.calc_center_median().copy(), f.normal.copy()) for f in cb.faces]; cb.free()
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
LOG['glass_caps_removed'] = len(kill)
boolean_apply(fus, cut_glass, 'DIFFERENCE')
boolean_apply(fus, cut_tub, 'DIFFERENCE')
# 機背是獨立的一件，座艙開口要同樣穿過它，否則罩子底下會被龜背的前段堵住。
boolean_apply(O['F4F_Dorsal'], cut_glass, 'DIFFERENCE')
boolean_apply(O['F4F_Dorsal'], cut_tub, 'DIFFERENCE')

# ═══════════════════════════ 3. 槳轂與槳葉 ═══════════════════════════
# F4F 沒有整流罩錐——Curtiss Electric 的槳轂直接露在外面。參考模型只給一根半徑 0.08、
# 由 y 1.66 伸到 2.61 的軸（真機的轂罩比那粗），所以這顆轂是**照真機照片訂的判斷值**，
# 錨在量到的軸位置與槳盤位置上。
HUB = [(1.94, 0.175), (2.06, 0.165), (2.16, 0.145), (2.26, 0.110), (2.33, 0.060)]
PROP_Y, PROP_R, PROP_BLADES = 2.20, 1.485, 3    # 槳盤 y 2.126…2.277；直徑 2.97（9 ft 9 in）
bm = bmesh.new(); rings = []
for y, r in HUB:
    rings.append([Vector((r * math.cos(2 * math.pi * j / 10), y, r * math.sin(2 * math.pi * j / 10))) for j in range(10)])
vs = loft(bm, rings)
cap(bm, list(reversed(vs[0])))
fan(bm, vs[-1], Vector((0, HUB[-1][0] + 0.05, 0)))
finish(bm)
new_object('F4F_Hub', bm, [M_ACC])
bm = bmesh.new()
for i in range(PROP_BLADES):
    ang = 2 * math.pi * i / PROP_BLADES + math.pi / 2
    r0, r1, hw, ht = 0.13, PROP_R, 0.085, 0.013
    c, s = math.cos(ang), math.sin(ang)
    pts = []
    for r in (r0, r1):
        for u in (-hw, hw):
            for t in (-ht, ht):
                pts.append(Vector((r * c - u * s, PROP_Y + t, r * s + u * c)))
    vv = [bm.verts.new(p) for p in pts]
    bmesh.ops.convex_hull(bm, input=vv)
finish(bm)
new_object('F4F_Prop', bm, [M_ACC])

# ═══════════════════════════ 4. 主翼（一整片，穿過機身） ═══════════════════════════
def chord_fine(T, x, zlo, zhi, yfront, yback, step=0.006):
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
def panel_station(T, x, zlo, zhi, yfront, yback, zsl, zsh):
    le, te = chord_fine(T, x, zlo, zhi, yfront, yback)
    up, dn = [], []
    for f in FR:
        y = le - (le - te) * f
        u = hit(T, (x, y, zsh), (0, 0, -1), zsh - zsl)
        d = hit(T, (x, y, zsl), (0, 0, 1), zsh - zsl)
        up.append(None if u is None else u.z); dn.append(None if d is None else d.z)
    return {'x': x, 'le': le, 'te': te, 'up': up, 'dn': dn}
def hull_line(fs, vals, upper):
    """上表面取上凸包、下表面取下凸包：輪艙開口、槍艙板那種射線打進去的洞會被橋掉
    （翼剖面本來就是凸的）。"""
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
    for key in ('up', 'dn'):
        for k in range(len(FR)):
            vals = [(s['x'], s[key][k]) for s in st_list if s[key][k] is not None]
            for s in st_list:
                if s[key][k] is None:
                    s[key][k] = min(vals, key=lambda v: abs(v[0] - s['x']))[1]
    for s in st_list:
        s['up'] = hull_line(FR, s['up'], True); s['dn'] = hull_line(FR, s['dn'], False)
    # 展向平滑（x 不等距的拉普拉斯，λ0.5 × 2）。**前後緣也要一起平滑。**
    #
    # 【只平滑表面、不平滑前後緣，做出來的尾翼是一條一條的】後緣是刀刃，射線在
    # z 方向掃的時候每一站抓到的極值會跳：實測水平尾翼在 x 0.40／0.50 讀到
    # −6.138／−6.138，而參考模型那一段是平的 −6.115／−6.109 —— 25 mm 的噪聲。
    # 鋪在只有 0.10 厚的尾翼上，固定 y 沿展向看上表面就是「峰─谷─峰」三次曲率
    # 變號（坑 19），平面著色下每一條的法線跟著交替。
    #
    # 拉普拉斯對**直線是恆等的**（線上一點正好等於前後兩點的內插），而參考模型
    # 的前緣是一條直線、後緣是分段直線 —— 所以它只削掉噪聲，不動真正的形狀。
    for _ in range(2):
        new = []
        for i, s in enumerate(st_list):
            if i == 0 or i == len(st_list) - 1:
                new.append((s['up'], s['dn'], s['le'], s['te'])); continue
            a, b = st_list[i - 1], st_list[i + 1]
            t = (s['x'] - a['x']) / (b['x'] - a['x'])
            up = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['up'], a['up'], b['up'])]
            dn = [v + ((va + (vb - va) * t) - v) * 0.5 for v, va, vb in zip(s['dn'], a['dn'], b['dn'])]
            le = s['le'] + ((a['le'] + (b['le'] - a['le']) * t) - s['le']) * 0.5
            te = s['te'] + ((a['te'] + (b['te'] - a['te']) * t) - s['te']) * 0.5
            new.append((up, dn, le, te))
        for s, (up, dn, le, te) in zip(st_list, new):
            s['up'], s['dn'], s['le'], s['te'] = up, dn, le, te
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
def build_panel(name, sts, tip_x, tip_y, tip_z, mirror=True):
    rings = []
    seq = [dict(s, x=-s['x']) for s in reversed(sts[1:])] + sts if mirror else list(sts)
    for s in seq:
        rings.append([Vector((s['x'], y, z)) for y, z in section_pts(s)])
    bm = bmesh.new()
    vs = loft(bm, rings)
    fan(bm, vs[-1], Vector((tip_x, tip_y, tip_z)))
    if mirror: fan(bm, list(reversed(vs[0])), Vector((-tip_x, tip_y, tip_z)))
    else: cap(bm, list(reversed(vs[0])))
    finish(bm)
    return new_object(name, bm, [M_BODY])
# 翼站：0.9 起（機身半寬 0.72），跳過 2.08 附近以免與水平尾翼混；翼尖 5.79
WX = [0.90, 1.20, 1.50, 1.85, 2.30, 2.75, 3.20, 3.65, 4.10, 4.55, 5.00, 5.35, 5.60]
# 【後緣射線的起點要在水平尾翼前緣（−4.6）之前】用 −5.0 的話 x 0.9／1.2 兩站的起點
# 就在水平尾翼裡面，後緣讀成 −4.99（真值 −1.83），翼面積因此變成 32.37 對 24.15。
# 與對齊時翼根四分之一弦踩到的是同一個坑。
wst = [panel_station(WING, x, -0.55, 0.60, 4.0, -4.20, -0.90, 0.90) for x in WX]
fill_none(wst)
wst = [extrap(wst[0], wst[1], 0.0), extrap(wst[0], wst[1], 0.45)] + wst
tip = wst[-1]
WING_TIP_X = 5.79
wing = build_panel('F4F_Wing', wst, WING_TIP_X, 0.5 * (tip['le'] + tip['te']) - 0.04,
                   0.5 * (tip['up'][3] + tip['dn'][3]))
wing['part'] = 'wing0'
area = 0
for a, b in zip(wst, wst[1:]):
    area += 0.5 * ((a['le'] - a['te']) + (b['le'] - b['te'])) * (b['x'] - a['x'])
area += 0.5 * (tip['le'] - tip['te']) * (WING_TIP_X - tip['x'])
LOG['wing_area'] = round(2 * area, 2)
LOG['wing_stations'] = [[round(s['x'], 2), round(s['le'], 3), round(s['te'], 3),
                         round(s['up'][3], 3), round(s['dn'][3], 3)] for s in wst]

# ═══════════════════════════ 5. 水平尾翼、垂尾 ═══════════════════════════
FR = FR_T
# 水平尾翼的站位。兩件事都要量到，少一個翼根就錯：
#
# **（一）後緣在 x < 0.75 是不後掠的**（−6.115／−6.109／−6.109／−6.109），
# 到 0.90 之後才往前收。由 0.62／0.90 外推到中線會把外側的後掠帶進來，翼根弦
# 做成 1.63 對真值 1.50，根部外擴得像加了整流罩 —— 而參考模型的厚度由 0.062
# 一路平順長到 0.123、一站都沒有鼓包：**真機那裡沒有導角，是直接插進機身的**。
#
# **（二）升降舵內側有讓方向舵的缺口，而且是一條直線**：
#
# ```
#   x      0.15    0.20    0.25    0.30    0.35    0.40 以外
#   後緣  -5.666  -5.788  -5.910  -6.031  -6.120  -6.109（平）
# ```
#
# 每 0.05 往後 0.122，斜率一致到第四位；外推到中線是 −5.30，比「把平的後緣
# 一路帶到中線」內收 **0.84 m**。只量 0.40 以外的話這個缺口會被整片填平。
#
# x 0.15 以內不能用：那裡的前緣射線起點已經在機身裡，讀到 −3.40。
TX = [0.20, 0.25, 0.30, 0.40, 0.50, 0.62, 0.90, 1.20, 1.50, 1.80, 2.00]
# 垂直射線由 z 0.34 起（不是 0.30）：x 0.20 那一站在前緣附近的機身頂已經到
# 0.27，起點壓太低會讀到機身而不是尾翼。
tst = [panel_station(TAIL, x, 0.44, 0.62, -3.4, -7.4, 0.34, 0.78) for x in TX]
fill_none(tst)
tst = [extrap(tst[0], tst[1], 0.0)] + tst
tt = tst[-1]
build_panel('F4F_Tailplane', tst, 2.08, 0.5 * (tt['le'] + tt['te']), 0.5 * (tt['up'][2] + tt['dn'][2]))
LOG['tail_stations'] = [[round(s['x'], 2), round(s['le'], 3), round(s['te'], 3)] for s in tst]
# 垂尾：z ≥ 0.80 才量得到（z 0.55 的射線起點還在機身裡，讀到的是機身頂線的交點）。
# 低於 0.80 的兩站是合成的：前緣照 0.80／1.05 的斜率外推，**後緣照量到的
# 方向舵下緣直線**。
#
# 【後緣不能一路平伸到 −6.13】那樣做出來是一片從機身尾錐伸出去的薄板。實測
# 方向舵的下緣是一條乾淨的直線（每 0.05 m 往後升 0.040）：
#
# ```
#   y      -5.95   -6.00   -6.05   -6.10   -6.15
#   最低z   0.159   0.199   0.239   0.278   0.318
# ```
#
# 它在 z 0.30 給 −6.127，而該站**實測**的後緣也是 −6.127 —— 兩條線自己對上了，
# 所以合成站與量測站之間沒有接縫。外推回 z 0.06 是 −5.826。
# 根站埋到 0.06：尾錐末端的頂線只到 0.12（TAIL_POLE），根站訂 0.20 的話由 y −5.0
# 起會有一片黑封蓋浮在機身外面（Ki-84 K「垂尾根站要埋到 z 0.15」同一條）。
# 低處要密：背鰭的前緣在那一段是凸的（z 0.50→0.80 前緣走 0.63，0.80→1.05 只走
# 0.23），站位太疏的話 loft 用直線切過凸的地方，y −4.0 那一站會低 0.05。
FIN_Z = [0.06, 0.30, 0.44, 0.54, 0.62, 0.71, 0.80, 1.05, 1.30, 1.50, 1.62, 1.72]
FIN_TOP = 1.79
RUDDER_FOOT = (-5.950, 0.159, -0.795)     # 方向舵下緣：(y0, z0, dz/dy)
def rudder_te(z):
    y0, z0, s = RUDDER_FOOT
    return y0 + (z - z0) / s

# 【低處的前緣要反解中線頂線，不能線性外推】背鰭往前掃的斜率是 **−2.92/單位 z**
# （參考：z 0.586 在 y −4.00、z 0.80 在 −4.625），而 0.80／1.05 兩站的斜率只有
# −0.90。用後者外推的話 z 0.586 會落在 −4.43，中線在 y −4.0…−4.4 整段缺一塊
# （實測差 0.12…0.27）。
#
# 做法：把中線頂線（機身頂 → 背鰭 → 垂尾前緣，側視的那一條上緣）掃出來，
# **在它觸底之後**逐站反解「回升到高度 z 的那個 y」。觸底點就是機身與垂尾的
# 交班處，不必另外猜。
DORSAL = []
_y = -3.20
while _y >= -5.30:
    _v = [z for z in (zmax_at(TAIL, 0.0, _y), zmax_at(TAIL, 0.04, _y)) if z is not None]
    if _v: DORSAL.append((_y, max(_v)))
    _y -= 0.05
_lo = min(range(len(DORSAL)), key=lambda i: DORSAL[i][1])
def fin_le(z):
    for (y0, z0), (y1, z1) in zip(DORSAL[_lo:], DORSAL[_lo + 1:]):
        if z0 <= z <= z1:
            return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
    return DORSAL[_lo][0] if z < DORSAL[_lo][1] else DORSAL[-1][0]
def skin_hw(T, y, z, half=0.045, step=0.015, tol=0.88):
    """垂尾的半寬 —— **一條射線會掉進抹縫，要用一窗去驗它。**

    【判準是「讀回來的值不隨高度變」】參考模型的方向舵鉸鏈在 y = −5.50 是一道
    凹槽，那條線上 z 1.44/1.48/1.52/1.60 讀回 0.0291/0.0291/0.0290/0.0290 ——
    一個**與 z 無關的定值**，而兩側 20 mm 外是 0.0500 與 0.0435。蒙皮沿高度是
    漸縮的，讀到定值就代表打到的是鉸鏈整流的內壁，不是外皮。0.40 弦長處在
    z 1.48…1.56 正好掃過這條線，第三欄於是由 .0502 塌到 .0199 再彈回 .0460：
    單調收斂的厚度分佈中間插一個 V 形凹陷，平面著色下就是一道折痕。

    【做法：只在偵測到時才介入，其餘原封不動】在目標 y 前後取一窗射線，對窗做
    一次穩健線性擬合（丟掉殘差最負的兩點再擬），得到該處蒙皮的局部趨勢；只有
    當中心那條射線低於趨勢的 tol 倍時才用趨勢值取代，否則回傳原始量測。

    **不可以改用中位數濾波**：試過「窗 ±0.10、低於中位數 95% 就丟」，抹縫是修好
    了（.0484 對驗收 .0486），但近前緣那一欄被往外撐了 9…22%（0.05 弦長處 z 1.72
    由 .0255 變 .0311）—— 前緣附近蒙皮沿弦向本來就變化快，中位數把較薄的前側樣本
    當成雜訊丟掉。線性擬合吃得下這個斜率，中位數吃不下。實測這一版在 11 站 × 5 欄
    共 55 個值裡**只動了一個**（z 1.50 第三欄 .0298 → .0488），其餘與原始射線相同。

    **也不可以事後平滑**：拉普拉斯的門檻要嘛低到把翼尖收攏那種真折一起抹掉
    （1.62→1.72 弦長斜率由 −0.69 變 −1.61，那是真的），要嘛高到蓋不住 20 mm 的
    凹陷。這是量測層的錯，要在量測層修。

    鉸鏈縫在真機上是有的，但這個面數（每圈 12 點）表現不了，與輪胎凹槽同一條
    裁決：不做。
    """
    ss = []
    n = int(round(half / step))
    for i in range(-n, n + 1):
        h = hit(T, (0.6, y + step * i, z), (-1, 0, 0), 1.2)
        ss.append((step * i, None if (h is None or h.x <= 0.0) else h.x))
    w0 = next((w for d, w in ss if d == 0.0 and w is not None), None)
    pts = [(d, w) for d, w in ss if w is not None]
    if w0 is None: return max(0.006, pts[len(pts) // 2][1]) if pts else None
    if len(pts) < 4: return max(0.006, w0)
    def fit(ps):
        mx = sum(d for d, _ in ps) / len(ps); my = sum(w for _, w in ps) / len(ps)
        sxx = sum((d - mx) ** 2 for d, _ in ps)
        sl = sum((d - mx) * (w - my) for d, w in ps) / sxx if sxx > 1e-12 else 0.0
        return my - sl * mx, sl
    a, sl = fit(pts)
    ranked = sorted(pts, key=lambda q: q[1] - (a + sl * q[0]))
    pred = fit(ranked[2:] if len(ranked) > 5 else ranked)[0]
    return max(0.006, pred if w0 < tol * pred else w0)


def fin_station(z):
    le = te = None
    for i in range(-10, 11):
        x = 0.006 * i
        h = hit(TAIL, (x, -3.0, z), (0, -1, 0))
        if h is not None and (le is None or h.y > le): le = h.y
        h = hit(TAIL, (x, -7.4, z), (0, 1, 0))
        if h is not None and (te is None or h.y < te): te = h.y
    hw = [skin_hw(TAIL, le - (le - te) * f, z) for f in FR]
    return {'z': z, 'le': le, 'te': te, 'hw': hw}
NLOW = 6                                    # 0.80 以下的六站是合成的（量不到，見上）
fst = [fin_station(z) for z in FIN_Z[NLOW:]]
for s in fst:
    for k in range(len(FR)):
        if s['hw'][k] is None or s['hw'][k] > 0.16: s['hw'][k] = 0.04
low = []
for z in FIN_Z[:NLOW]:
    s = dict(fst[0]); s['z'] = z
    s['le'] = fin_le(z)
    # 後緣取「比較前面」的那一個：低處是方向舵下緣的斜切，高一點就回到垂尾自己的
    # 後緣線（由 0.80／1.05 兩站往下外推）。兩條線在 z ≈ 0.33 交會。
    t = (z - fst[0]['z']) / (fst[1]['z'] - fst[0]['z'])
    te_lin = fst[0]['te'] + (fst[1]['te'] - fst[0]['te']) * t
    s['te'] = max(rudder_te(z), te_lin)
    s['hw'] = [w * (1.20 if z < 0.20 else 1.10) for w in fst[0]['hw']]
    low.append(s)
fst = low + fst
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
ts = fst[-1]
fan(bm, vs[-1], Vector((0, 0.5 * (ts['le'] + ts['te']), FIN_TOP)))
finish(bm)
new_object('F4F_Fin', bm, [M_BODY])
LOG['fin_stations'] = [[round(s['z'], 2), round(s['le'], 3), round(s['te'], 3)] for s in fst]

# ═══════════════════════════ 6. 玻璃框條 ═══════════════════════════
GB = bvh_of(['F4F_Glass'])
def strip_from_points(bm, pts, nrm, width, along):
    prev = None
    for p, n in zip(pts, nrm):
        q = p + n * 0.004
        a = bm.verts.new(q - along * width / 2); b = bm.verts.new(q + along * width / 2)
        if prev is not None:
            try: bm.faces.new([prev[0], prev[1], b, a])
            except ValueError: pass
        prev = (a, b)
def arch(bm, y_top, y_sill=None, width=0.030):
    if y_sill is None: y_sill = y_top
    pts, nrm = [], []
    for j in range(15):
        th = -math.pi / 2 + math.pi * j / 14
        y0 = y_sill + (y_top - y_sill) * math.cos(th)
        d = Vector((-math.sin(th), 0, -math.cos(th)))
        o = Vector((0, y0, 0.80)) - d * 1.5
        r = GB.ray_cast(o, d, 3.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((0, 1, 0)))
def rail(bm, x0, y_from, y_to, width=0.030, n=10):
    pts, nrm = [], []
    for j in range(n + 1):
        y = y_from + (y_to - y_from) * j / n
        r = GB.ray_cast(Vector((x0, y, 3.0)), Vector((0, 0, -1)), 6.0)
        if r[0] is None: continue
        pts.append(r[0]); nrm.append(r[1])
    strip_from_points(bm, pts, nrm, width, Vector((1, 0, 0)))
bm = bmesh.new()
for y0 in (-0.30, -0.58, -0.86, -1.14): arch(bm, y0)
for x0 in (-0.19, 0.19): rail(bm, x0, -0.30, -1.20)
for x0 in (-0.16, 0.16): rail(bm, x0, -0.02, -0.30, n=4)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
new_object('F4F_Frames', bm, [M_FRAME])

# ═══════════════════════════ 收尾 ═══════════════════════════
for ob in COLL.objects:
    if ob.type == 'MESH':
        ob.data.validate()
        for p in ob.data.polygons: p.use_smooth = False
total = 0
for ob in COLL.objects:
    if ob.name.startswith('F4F_'):
        n = sum(len(p.vertices) - 2 for p in ob.data.polygons); total += n
        LOG['tris_' + ob.name] = n
LOG['total_tris'] = total
result = LOG
