"""
機種 GLB 的低模衍生檔。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/build_lod.py -- b17g

讀 `public/models/<id>.glb`，做三件事，另存 `public/models/<id>_lod2.glb`：

  一、刪掉在 LOD 距離上看不到的物件（機身內裝、窗框、玻璃分格）
  二、把 loft 出來的殼體**每隔一圈抽掉一圈腰線**
  三、把每一圈的剖面節點**抽稀到 `RING_POINTS` 個**

【出貨的 GLB 才是母本】機種的建構腳本產出之後還會手動美化，重跑它會把那些
調整丟掉 —— 實測重跑與出貨版的剪影差 5.5%。這裡一律從 `public/models/` 的
成品衍生，建構腳本一個字都不碰。

【為什麼是自己接面而不是套減面器】通用的減面器對所有頂點一視同仁，而定義
輪廓的頂點往往只有一兩個（翼尖、機首、剖面的最寬處），會最先被合併掉 ——
症狀是翼展縮水或翼弦塌成三角形，而面數的帳面很漂亮。這裡的做法是把殼拆回
它自己的剖面、抽稀、再接回去：留下來的剖面**逐點原封不動**。

【頭尾兩圈不能抽】機首與機尾那兩圈就是輪廓的端點。

驗收一律走 `check_lod_silhouette.py`，逐像素比對六個方位，不靠目測。
"""
import bpy
import bmesh
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'public', 'models')

# 機身裡面的東西。外皮不透明，從外面一個像素都看不到
INTERIOR = ('Inner', 'NoseInner', 'HoodDark', 'Cockpit')
# 窗框與玻璃分格
FRAMES = ('Frames',)
# 小於 1.2 m 的凸起。25 px 之下不到一個像素
BUMPS = ('Astro', 'TopTurret', 'ChinTurret', 'BallTurret')
DROP_EXACT = INTERIOR + FRAMES
DROP_PREFIX = ('Pane',)

"""
【不抽腰線的】三類：

  太小        槳葉／槳盤／玻璃。抽了省不到東西，卻最容易看出破綻
  就是輪廓    平板狀的翼面本來就沒有腰線可抽，而且側視、頂視的外緣就是它們
  貼著上緣    機背整流罩與座艙罩坐在機身頂上，側視與前視的**上緣**由它們決定

【第三類是量出來的】只抽機身與發動機艙時剪影差 0.5%；把機背與座艙罩一起抽
就跳到 5.6%，而**頂視仍然是 0** —— 差的全在垂直方向，正好是那兩顆的位置。
"""
SKIP_RINGS = ('Prop', 'Spinner', 'Glass', 'Blur', 'Disc', 'Wing', 'Tailplane', 'Fin',
              )

# 一圈至少要幾個頂點才算腰線。低於這個的是零件不是剖面
MIN_RING = 5
# 幾圈抽一圈。2 = 每隔一圈抽掉一圈
RING_STRIDE = 2
# 同一圈的座標容差，m
RING_TOL = 0.02
# 【剖面抽到幾個節點】原本機身一圈 18 個。25 px 的剖面上一個點不到一個像素
RING_POINTS = 10
# 焊接容差，m。GLB 的頂點是每面拆開的，位置完全相同，1e-4 綽綽有餘
WELD_DIST = 1e-4
# 【診斷用】只焊不抽。見 main 的 `weld-only`
WELD_ONLY = [False]


def short(name: str) -> str:
    """`B17_Fuselage` → `Fuselage`。匯入時 Blender 會加 `.001`，一併去掉"""
    base = name.split('.')[0]
    return base.split('_', 1)[1] if '_' in base else base


def drop(name: str) -> bool:
    s = short(name)
    return s in DROP_EXACT or any(s.startswith(p) for p in DROP_PREFIX)


def skip_rings(name: str) -> bool:
    s = short(name)
    return any(t in s for t in SKIP_RINGS)


def dominant_axis(me) -> int:
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for v in me.vertices:
        for k in range(3):
            lo[k] = min(lo[k], v.co[k])
            hi[k] = max(hi[k], v.co[k])
    span = [hi[k] - lo[k] for k in range(3)]
    return span.index(max(span))


def pick_victims(keys, groups, axis):
    """
    哪幾圈可以抽。每 `RING_STRIDE` 圈抽一圈，但**局部極值的圈一律保留**。

    【為什麼極值不能抽】側視的輪廓是各圈的上下緣、前視的輪廓是各圈的左右緣。
    抽掉「最寬的那一圈」，前視的機身就整個窄了一截 —— 實測只按次序隔一圈抽
    時，頂視差 0 而前視差 1,227 個像素，差的正是那幾圈。

    【四個方向各看一次】兩個非軸向各有正負兩側，任何一側是局部極大就保留。
    """
    if len(keys) < 5:
        return []
    others = [k for k in range(3) if k != axis]

    def edges(key):
        vs = groups[key]
        out = []
        for k in others:
            cs = [v.co[k] for v in vs]
            out.append(max(cs))
            out.append(-min(cs))       # 取負，四個都變成「越大越外面」
        return out

    prof = [edges(k) for k in keys]

    def is_peak(i):
        if i == 0 or i == len(keys) - 1:
            return True
        for j in range(4):
            if prof[i][j] >= prof[i - 1][j] and prof[i][j] >= prof[i + 1][j]:
                return True
        return False

    def on_hole(key):
        """
        這一圈有沒有碰到開口的邊緣。

        【為什麼要護】機身殼上有窗與艙門的開口，原本由內裝物件（已經刪掉）
        擋在後面。溶掉貼著開口的那一圈會把洞撐大，而背面剔除之後畫面上就是
        **空心的機身** —— 側視看得到一格格窗框的輪廓，剪影卻仍然「只差 5%」。
        """
        return any(v.is_boundary for v in groups[key])

    victims = []
    since = 0
    for i in range(1, len(keys) - 1):
        since += 1
        if is_peak(i) or on_hole(keys[i]):
            continue
        if since >= RING_STRIDE:
            victims.append(keys[i])
            since = 0
    return victims


def ordered_ring(verts, axis, others, points):
    """
    把一圈的頂點依繞軸的角度排序，**並抽稀到 `points` 個**，回座標串。

    【為什麼要重排】原本的頂點次序是匯入時的順序，跟繞圈的次序無關。要自己
    接面就得知道「這一圈的下一個是誰」，而剖面對自己的形心是星狀的，用角度
    排就是正確的繞圈次序。

    【為什麼連剖面的節點也要抽】只抽腰線的話，機身的**環向**解析度原封不動
    —— 一圈 18 個點畫一個 25 px 的剖面，一個點不到一個像素。抽到 10 個之後
    剖面仍然是凸的十邊形，而三角形少一半。

    【四個極值點一定要留】剖面的最寬、最窄、最高、最低就是側視與前視的輪廓。
    先把它們選進來，剩下的名額才按角度平分 —— 只按角度均分的話，最寬的那個
    點會被跳過，前視的機身就窄一圈。

    【抽稀後每一圈的點數相同】於是 `bridge` 退化成乾淨的四邊形帶，接不出
    自交的面。點數不齊正是先前機身破面的來源之一。
    """
    import math
    cu = sum(v.co[others[0]] for v in verts) / len(verts)
    cv = sum(v.co[others[1]] for v in verts) / len(verts)

    def ang(v):
        return math.atan2(v.co[others[1]] - cv, v.co[others[0]] - cu)

    ring = sorted(verts, key=ang)
    n = len(ring)
    if points <= 0 or n <= points:
        return [tuple(v.co) for v in ring]

    keep = set()
    for k in others:
        cs = [v.co[k] for v in ring]
        keep.add(cs.index(max(cs)))
        keep.add(cs.index(min(cs)))
    for i in range(points - len(keep)):
        idx = round(i * n / max(1, points - len(keep))) % n
        keep.add(idx)
    return [tuple(ring[i].co) for i in sorted(keep)]


def bridge(bm, a, b) -> None:
    """
    把兩圈接起來，**兩圈的頂點數可以不同**。

    【為什麼一定要容許不同】機身 69 圈的寬度不齊：18 佔 29 圈、19 佔 24 圈，
    另外還有 20／21／23／25 與幾個 5–7 —— 窗與艙門的布林運算在那些圈上加了
    頂點。要求等寬的話機身整顆被跳過，而它是單一最大的一塊。

    【怎麼接】兩圈都已經照繞軸的角度排好，各自把索引正規化成 0…1；兩個指標
    誰的下一個參數小就推進誰，每推進一次補一個三角形。這樣接出來的帶子不會
    自交，也不會漏。
    """
    na = len(a)
    nb = len(b)
    i = 0
    j = 0
    while i < na or j < nb:
        pa = (i + 1) / na
        pb = (j + 1) / nb
        if j >= nb or (i < na and pa <= pb):
            tri = (a[i % na], a[(i + 1) % na], b[j % nb])
            i += 1
        else:
            tri = (a[i % na], b[(j + 1) % nb], b[j % nb])
            j += 1
        try:
            bm.faces.new(tri)
        except ValueError:
            pass          # 重複面或退化：該處剖面收成一點


def build_loft(me, loops, axis) -> None:
    """
    由一串剖面重建殼：相鄰兩圈接成四邊形，頭尾各補一個扇形蓋。

    【拓樸自己決定，才不會有自交的面】在既有的三角網格上動刀時，一整圈頂點
    同時消失會讓相鄰的面併成自交的 n-gon，切出來有一半朝內 —— 背面剔除之後
    畫面上是**空心的機身**，而面數、包圍盒、甚至剪影的百分比都還在「看起來
    合理」的範圍。從剖面重接就沒有這條路。

    【繞向要對】`recalc_face_normals` 收尾。錯了的症狀是整顆被背面剔除掉，
    畫面上那架飛機直接不見。
    """
    import bmesh as _bm
    from mathutils import Vector as _V
    bm = _bm.new()
    rings = []
    for loop in loops:
        rings.append([bm.verts.new(_V(p)) for p in loop])
    bm.verts.ensure_lookup_table()
    for a, b in zip(rings, rings[1:]):
        bridge(bm, a, b)
    for ring, flip in ((rings[0], False), (rings[-1], True)):
        try:
            bm.faces.new(tuple(reversed(ring)) if flip else tuple(ring))
        except ValueError:
            pass
    _bm.ops.recalc_face_normals(bm, faces=bm.faces[:])
    _bm.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()


def thin_rings(o) -> int:
    """
    沿最長軸把頂點分群成剖面，抽掉一部分之後重接。回抽掉幾圈。

    【一定要先焊接】平面著色的 GLB 每個三角形帶自己的頂點 —— 機身是 4,942 個
    頂點對 1,294 個實際位置（3.8 倍）。不焊的話「一圈」在拓樸上根本不相連，
    分群出來的是散亂的頂點集，接出來的殼會破成一條細片，而面數看起來很正常。
    焊接之後機身是 69 圈 x 18 個頂點，與 `build_b17.py` 的「每側 8 級 ＋
    頂底兩尖」逐項對得上。

    【焊完要壓回平面著色】焊接讓相鄰面共用頂點，法線會被平均掉，硬稜變圓滑。
    把每一面設成 flat，glTF 匯出時會自己再拆開頂點。

    【剖面的節點數不齊是正常的】窗與艙門的布林運算在某些圈上加了頂點：機身
    18 佔 29 圈、19 佔 24 圈，另外還有 20／21／23／25 與幾個 5–7。抽稀到
    `RING_POINTS` 之後就齊了，`bridge` 因此退化成乾淨的四邊形帶。
    """
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_DIST)

    lo = [1e9] * 3
    hi = [-1e9] * 3
    for v in bm.verts:
        for k in range(3):
            lo[k] = min(lo[k], v.co[k])
            hi[k] = max(hi[k], v.co[k])
    span = [hi[k] - lo[k] for k in range(3)]
    axis = span.index(max(span))

    groups = {}
    for v in bm.verts:
        groups.setdefault(round(v.co[axis] / RING_TOL), []).append(v)
    keys = sorted(k for k, vs in groups.items() if len(vs) >= MIN_RING)

    # 【每一圈的頂點數必須一致才敢重建】不一致表示這顆不是單純的 loft
    # （例如帶了凸起或開口），照角度重排會接錯。那種就整顆不動
    # 【寬度不必一致】`bridge` 接得起不同頂點數的兩圈
    if WELD_ONLY[0] or len(keys) < 5:
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        return 0

    victims = set(pick_victims(keys, groups, axis))
    kept = [k for k in keys if k not in victims]
    if len(kept) == len(keys):
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        return 0

    others = [i for i in range(3) if i != axis]
    loops = [ordered_ring(groups[k], axis, others, RING_POINTS) for k in kept]
    bm.free()
    build_loft(me, loops, axis)
    for p in me.polygons:
        p.use_smooth = False
    return len(keys) - len(kept)


def tri_count() -> int:
    n = 0
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


def main() -> None:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ident = argv[0] if argv else 'b17g'
    # 【只刪不抽】拿來分辨兩件事各值多少
    only_drop = 'drop-only' in argv
    # 【只焊不抽】焊接是抽腰線的前置。空心的機身若在這一步就出現，責任在焊接
    # 而不在溶解 —— 兩者分開驗才知道要修哪一個
    only_weld = "weld-only" in argv
    WELD_ONLY[0] = only_weld

    src = os.path.join(MODELS, ident + '.glb')
    dst = os.path.join(MODELS, ident + '_lod2.glb')
    if not os.path.exists(src):
        raise SystemExit('找不到 ' + src)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    before = tri_count()
    print('== %s：%d 個三角形' % (ident, before))

    for o in [x for x in bpy.data.objects if x.type == 'MESH']:
        if drop(o.name):
            bpy.data.objects.remove(o, do_unlink=True)
    dropped = before - tri_count()
    print('== 刪掉看不到的物件：%d 個三角形' % dropped)

    if not only_drop or only_weld:
        thinned = 0
        for o in [x for x in bpy.data.objects if x.type == 'MESH']:
            if skip_rings(o.name):
                continue
            n = thin_rings(o)
            if n > 0:
                thinned += 1
                print('   抽 %-18s %d 圈' % (short(o.name), n))
        print('== 抽腰線：%d 顆殼體' % thinned)

    after = tri_count()
    print('== 剩 %d 個三角形（%.0f%%）' % (after, 100.0 * after / max(1, before)))

    bpy.ops.export_scene.gltf(
        filepath=dst,
        export_format='GLB',
        export_apply=True,
        export_materials='EXPORT',
        export_normals=True,
        export_yup=True,
    )
    print('== 寫出 ' + dst)


main()
