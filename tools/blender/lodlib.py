"""
低模建構的共用工具。**每一台機種一支 `build_<id>_lod.py`，量測與站位各自寫，
這裡只放與機種無關的那一半。**

【為什麼不做成一支通用腳本】九台的構造差太多：B-17 的機背甲板、He 111 的
全玻璃機首、艦載機的摺疊翼，各自要挑哪些件分開做、站位落在哪裡。做成吃參數
的通用腳本，參數表會比腳本本身還長，而且改一台要同時想另外八台。

【座標】全部是 Blender 世界座標：X 翼展、Y 前後（機首 +Y）、Z 上。

【匯入之後一定要 `prepare_source`】新件與來源同名的話 Blender 會自動加 `.001`
尾碼，匯出的節點名與材質名跟著變 —— `glb.ts` 靠節點名找螺旋槳、靠材質名對
遊戲材質，名字漂掉就是「找不到螺旋槳節點」與「沒有對應的遊戲材質」。
"""
import bmesh
import bpy
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


# ───────────────────────── 場景 ─────────────────────────
def srgb(h):
    """0xRRGGBB → Blender 的線性 RGBA。"""
    def c(u):
        u /= 255.0
        return u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255), 1.0)


def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = rgb
    return m


def prepare_source(path):
    """匯入來源 GLB，把物件與材質都改名成 `Ref_*`，回「原名 → 物件」。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    src = [o for o in bpy.data.objects if o.type == 'MESH']
    out = {}
    for o in src:
        out[o.name] = o
        o.name = 'Ref_' + o.name
    for m in list(bpy.data.materials):
        m.name = 'Ref_' + m.name
    return out, src


def new_collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def new_object(coll, name, bm, mats, recalc=True):
    """焊點、統一法線、平面著色，然後掛進集合。`bm` 在這裡被吃掉。

    【開口的片要 `recalc=False`】`recalc_face_normals` 對沒有內外之分的殼只能
    任選一邊，選錯就整片被背面剔除。呼叫端自己定好朝向的話別讓它再翻一次。"""
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    me.validate()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def push_out(ob, dist, axis_z=0.0):
    """把一件沿「離開機身中軸」的方向整體往外推 `dist`。

    【為什麼是整體推、不是只推沉下去的那幾個點】只推一部分會在交界處折出
    稜線。整體推的話埋在機身裡的那一半也往外同樣多 —— 形狀不變，該露出來的
    多露 `dist`，該埋著的少埋 `dist`。

    【呼叫端要先確認埋著的那一半還夠深】推太多會在邊緣掀起一圈唇。"""
    for v in ob.data.vertices:
        d = Vector((v.co.x, 0.0, v.co.z - axis_z))
        if d.length < 1e-6:
            continue
        d.normalize()
        v.co.x += d.x * dist
        v.co.z += d.z * dist


def copy_part(coll, src, name, remap, default):
    """把來源件原封不動搬過來，只重指材質、把變換烘進網格。

    平面窗這種「沒有剖面可以簡化」的小件走這條。`remap` 是「去掉 Ref_ 之後的
    材質名 → 低模的材質」。"""
    me = src.data.copy()
    me.name = name
    me.transform(src.matrix_world)
    for i, m in enumerate(me.materials):
        base = m.name[4:] if m is not None and m.name.startswith('Ref_') else ''
        me.materials[i] = remap.get(base, default)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


# ───────────────────────── 量尺 ─────────────────────────
def bvh(objs):
    """把幾個來源物件併成一棵 BVH，座標是世界座標。"""
    acc = bmesh.new()
    for o in objs:
        one = bmesh.new()
        one.from_mesh(o.data)
        one.transform(o.matrix_world)
        me = bpy.data.meshes.new('_tmp')
        one.to_mesh(me)
        one.free()
        acc.from_mesh(me)
        bpy.data.meshes.remove(me)
    bmesh.ops.triangulate(acc, faces=acc.faces)
    t = BVHTree.FromBMesh(acc)
    acc.free()
    return t


def cast(T, origin, direction, length):
    return T.ray_cast(Vector(origin), Vector(direction).normalized(), length)[0]


def cast_hit(T, origin, direction, length):
    """連法線一起回。**法線朝哪邊分得出「打到外皮」與「從開口穿進去打到背面」**
    —— 只看有沒有命中的話，蒙皮缺口那幾站會讀到對面的內壁，而那個數字看起來
    完全正常。"""
    r = T.ray_cast(Vector(origin), Vector(direction).normalized(), length)
    return r[0], r[1]


def bounds(objs):
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def fill_gaps(rad):
    """環狀的缺口用左右鄰居線性補。整圈皆空回 None。"""
    n = len(rad)
    if all(r is None for r in rad):
        return None
    for i in range(n):
        if rad[i] is not None:
            continue
        back = next(k for k in range(1, n) if rad[(i - k) % n] is not None)
        fwd = next(k for k in range(1, n) if rad[(i + k) % n] is not None)
        a, b = rad[(i - back) % n], rad[(i + fwd) % n]
        rad[i] = a + (b - a) * back / (back + fwd)
    return rad


def ring_angles(n):
    """n 等分的方位角。n 是 4 的倍數時 0/90/180/270 都落在點上。"""
    return [2 * math.pi * i / n for i in range(n)]


def centre_z(T, y, reach=12.0):
    """這一站剖面的中線高度：中軸由上往下、由下往上各一發的中點。"""
    top = cast(T, (0, y, reach), (0, 0, -1), reach * 2)
    bot = cast(T, (0, y, -reach), (0, 0, 1), reach * 2)
    if top is None or bot is None:
        return None
    return (top.z + bot.z) * 0.5


def star_ring(T, y, zc, angles, cx=0.0, reach=14.0):
    """由外往剖面中心打一圈，取最外面的交點。

    【只對星狀剖面成立】機身上趴著的東西（機背甲板、砲塔、艙罩）與蒙皮之間
    有折線，折線落在兩個取樣角中間時，剖面中心抖幾公分那一發就會在兩個面之間
    來回跳，側視長出一條鋸齒。那幾件要分開做。"""
    rad = []
    for a in angles:
        c, s = math.cos(a), math.sin(a)
        h = cast(T, (cx + reach * c, y, zc + reach * s), (-c, 0, -s), reach * 2)
        rad.append(None if h is None else math.hypot(h.x - cx, h.z - zc))
    rad = fill_gaps(rad)
    if rad is None:
        return None
    return [(cx + r * math.cos(a), y, zc + r * math.sin(a)) for r, a in zip(rad, angles)]


def tube(T, ys, angles, cx=0.0, reach=14.0, zc_of=None):
    """沿 y 一站一站量星狀剖面。量不到的站直接跳過。"""
    rings = []
    for y in ys:
        zc = centre_z(T, y) if zc_of is None else zc_of(y)
        if zc is None:
            continue
        r = star_ring(T, y, zc, angles, cx=cx, reach=reach)
        if r is not None:
            rings.append(r)
    return rings


# ───────────────────────── 造形 ─────────────────────────
def loft(bm, rings, closed=True):
    """一串等長的環接成管。`closed=False` 接成開口的片（艙罩、窗帶那種殼）。

    回傳每一環的頂點與新增的面。"""
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(vs, vs[1:]):
        for j in (range(n) if closed else range(n - 1)):
            k = (j + 1) % n
            q = [a[j], a[k], b[k], b[j]]
            if len(set(q)) < 4:
                continue
            try:
                faces.append(bm.faces.new(q))
            except ValueError:
                pass
    return vs, faces


def cap(bm, verts):
    try:
        return [bm.faces.new(verts)]
    except ValueError:
        return []


def fan(bm, verts, apex):
    a = bm.verts.new(apex)
    n = len(verts)
    out = []
    for j in range(n):
        k = (j + 1) % n
        if verts[j] is verts[k]:
            continue
        try:
            out.append(bm.faces.new([verts[j], verts[k], a]))
        except ValueError:
            pass
    return out


def shrink(ring, k):
    """把一環往它自己的形心縮 —— 翼尖與尾錐收口用。"""
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    cz = sum(p[2] for p in ring) / len(ring)
    return [(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, cz + (p[2] - cz) * k) for p in ring]


def offset(ring, d):
    return [(p[0] + d[0], p[1] + d[1], p[2] + d[2]) for p in ring]


def closed_loft(coll, name, rings, mats):
    """一串環接成管、兩端封蓋。回傳 (物件, 面串)。"""
    bm = bmesh.new()
    vs, faces = loft(bm, rings)
    faces = faces + cap(bm, list(reversed(vs[0]))) + cap(bm, vs[-1])
    return new_object(coll, name, bm, mats), faces


def ellipsoid(coll, name, lo, hi, mats, seg=8, rings=3, axis='y'):
    """由外接盒定出來的橢球。砲塔、觀測罩這種埋一半在機身裡的凸起用。"""
    c = (lo + hi) * 0.5
    a = (hi - lo) * 0.5
    idx = 'xyz'.index(axis)
    others = [i for i in range(3) if i != idx]
    bm = bmesh.new()
    seq = []
    for i in range(1, rings + 1):
        t = math.pi * i / (rings + 1)
        k = math.sin(t)
        ring = []
        for j in range(seg):
            u = 2 * math.pi * j / seg
            p = [0.0, 0.0, 0.0]
            p[idx] = c[idx] + a[idx] * math.cos(t)
            p[others[0]] = c[others[0]] + a[others[0]] * k * math.cos(u)
            p[others[1]] = c[others[1]] + a[others[1]] * k * math.sin(u)
            ring.append(tuple(p))
        seq.append(ring)
    vs, _ = loft(bm, seq)
    top = [0.0, 0.0, 0.0]
    bot = [0.0, 0.0, 0.0]
    for i in range(3):
        top[i] = c[i]
        bot[i] = c[i]
    top[idx] = hi[idx]
    bot[idx] = lo[idx]
    fan(bm, vs[0], tuple(top))
    fan(bm, list(reversed(vs[-1])), tuple(bot))
    return new_object(coll, name, bm, mats)


# ───────────────────────── 翼面 ─────────────────────────
#
# 主翼／水平尾翼／垂尾都是「沿展長一站一站量剖面、再 loft」。剖面點取在弦長
# 的固定比例上：前後緣各一點（上下面在那裡本來就合起來），中間幾成各取上下
# 兩點。
#
# 【前後緣要往內縮一點點】正好打在緣上是切線，射線常常擦過去；縮 1.5% 弦長
# 讀到的是同一個位置，而且一定命中。
EDGE_IN = 0.015


def plate_probe(T, lim=6.0):
    """厚度沿 z 的翼面（主翼、水平尾翼）：回 (上表面 z, 下表面 z)。"""
    def probe(x, y):
        a = cast(T, (x, y, lim), (0, 0, -1), lim * 2)
        b = cast(T, (x, y, -lim), (0, 0, 1), lim * 2)
        return None if (a is None or b is None) else (a.z, b.z)
    return probe


def fin_probe(T, lim=4.0):
    """厚度沿 x 的翼面（垂尾）：回 (右側 x, 左側 x)。"""
    def probe(z, y):
        a = cast(T, (lim, y, z), (-1, 0, 0), lim * 2)
        b = cast(T, (-lim, y, z), (1, 0, 0), lim * 2)
        return None if (a is None or b is None) else (a.x, b.x)
    return probe


def plate_mk(x, y, z):
    return (x, y, z)


def fin_mk(z, y, x):
    return (x, y, z)


def chord_ends(probe, sta, ylo, yhi, step=0.02):
    """這一站的前緣（+y）與後緣（−y）。量不到就回 None。"""
    hits = []
    n = int((yhi - ylo) / step) + 1
    for i in range(n):
        y = ylo + i * step
        if probe(sta, y) is not None:
            hits.append(y)
    if len(hits) < 2:
        return None
    return max(hits), min(hits)


def panel_ring(probe, mk, sta, ylo, yhi, fracs):
    """一站的剖面環：前緣 → 上表面 → 後緣 → 下表面。"""
    ends = chord_ends(probe, sta, ylo, yhi)
    if ends is None:
        return None
    le, te = ends
    chord = le - te
    if chord < 1e-3:
        return None

    def at(f):
        return probe(sta, le - chord * f)

    head, foot = at(EDGE_IN), at(1.0 - EDGE_IN)
    if head is None or foot is None:
        return None
    mid = []
    for f in fracs:
        h = at(f)
        if h is None:
            return None
        mid.append((le - chord * f, h))
    ring = [mk(sta, le, (head[0] + head[1]) * 0.5)]
    ring += [mk(sta, y, h[0]) for y, h in mid]
    ring.append(mk(sta, te, (foot[0] + foot[1]) * 0.5))
    ring += [mk(sta, y, h[1]) for y, h in reversed(mid)]
    return ring


def build_panel(coll, name, probe, mk, stations, ylo, yhi, fracs, ends, mats):
    """`ends` 是兩端收口環的 (縮放, 位移)；翼尖是圓的，切平會少一截。"""
    rings = []
    for s in stations:
        r = panel_ring(probe, mk, s, ylo, yhi, fracs)
        if r is None:
            raise SystemExit('%s 站位 %.2f 量不到剖面' % (name, s))
        rings.append(r)
    (k0, d0), (k1, d1) = ends
    seq = []
    if k0 is not None:
        seq.append(offset(shrink(rings[0], k0), d0))
    seq += rings
    if k1 is not None:
        seq.append(offset(shrink(rings[-1], k1), d1))
    return closed_loft(coll, name, seq, mats)[0]


# ───────────────────────── 收尾 ─────────────────────────
def report(coll, before):
    total = 0
    for o in sorted(coll.objects, key=lambda x: x.name):
        n = sum(len(p.vertices) - 2 for p in o.data.polygons)
        total += n
        print('%6d tri  %s' % (n, o.name))
    print('== 低模合計 %d 個三角形（出貨版 %d，%.1f%%）'
          % (total, before, 100.0 * total / max(1, before)))
    return total


def export(path, src_objs):
    """丟掉來源件、寫出 GLB。"""
    for o in src_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_yup=True,
    )
    print('== 寫出 ' + path)
