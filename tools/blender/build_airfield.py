# -*- coding: utf-8 -*-
"""
波爾塔瓦機場的佈景：營舍、塔台、散桶、電線桿、跑道頭的邊界板。
**純佈景** —— 停放的 B-17、油桶堆、彈藥堆、砲位、探照燈都是地面目標，
不在這裡（它們各自有命中盒與殘骸）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_airfield.py', encoding='utf-8').read())
    build_airfield()      # 建整片，每個區塊一個物件
    export_airfield()     # 匯出 models-src/poltava_airfield.glb

【座標】Blender 系 X 橫向、+Y 前、Z 上，**原點就是機場中心**（遊戲世界的
(0, −7000)）。遊戲端載入後平移過去。
    遊戲 (x, y, z) = Blender (x, z, −y)
所以這裡的 Blender y = −遊戲 dz、Blender z = 高度。

【材質名走廠區的那一套】`LP_Plant*`，對應表在
`src/render/geometry/ground/glb.ts`。名字對不上遊戲載入會丟。**不加新名字。**

【避讓】跑道、停機坪、每一架 B-17、三個堆、砲位與探照燈的腳印上不擺任何
東西 —— 佈景沒有命中盒，疊上去會看到炸彈穿過帳篷在 B-17 上爆。
`test/unit/airfield-scenery.test.ts` 逐頂點驗。
"""
import bpy, math, os

# 【ROOT 從 .blend 的位置推】檔存在 tools/blender/ 底下，往上兩層是 repo 根；
# 還沒存檔時退回這台機器的簽出
ROOT = (os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '..', '..'))
        if bpy.data.filepath else r'C:\projects\grok-aircraft2')
OUT_DIR = os.path.join(ROOT, 'models-src')

# ═══════════════════════════ 佈局資料 ═══════════════════════════
# **與 src/world/poltava.ts 同一份數字**（遊戲局部座標：x 橫向、z 往南為正）

# 主墊面：跑道加滑行道那一條帶子（x0, z0, x1, z1）；魚骨各自的附加墊面在 src/world/poltava.ts
PAD = (-1270.0, -50.0, 1270.0, 312.0)
# 鋪面：主跑道、平行滑行道、三條聯絡道、兩條分散支線（x0, z0, x1, z1）
RUNWAY = (-1250.0, -30.0, 1250.0, 30.0)
TAXIWAY = (-1250.0, 268.0, 1250.0, 292.0)
TAXI_LINKS = [(-1250, 30, -1226, 268), (-12, 30, 12, 268), (1226, 30, 1250, 268),
              (-900, -400, -876, -30), (700, 292, 724, 640), (1000, 292, 1024, 640)]
# 停機位：從路邊伸出一條窄巷（12 m），末端是 40 m 見方的停機坪。(dx, dz, axis, from)
STANDS = ([(-970, dz, 'x', -900) for dz in (-100, -170, -240, -310)]
          + [(-806, dz, 'x', -876) for dz in (-100, -170, -240, -310)]
          + [(630, dz, 'x', 700) for dz in (360, 430, 500, 570)]
          + [(794, dz, 'x', 724) for dz in (360, 430, 500, 570)]
          + [(930, dz, 'x', 1000) for dz in (360, 430, 500, 570)]
          + [(1094, dz, 'x', 1024) for dz in (360, 430, 500, 570)])
STAND_PADS = [(x - 20, z - 20, x + 20, z + 20) for x, z, _, _ in STANDS]
STAND_LANES = [((min(f, x), z - 6, max(f, x), z + 6) if a == 'x'
                else (x - 6, min(f, z), x + 6, max(f, z)))
               for x, z, a, f in STANDS]
PAVED = [RUNWAY, TAXIWAY] + TAXI_LINKS + STAND_LANES + STAND_PADS
PARKED = [(x, z) for x, z, _, _ in STANDS]
DUMPS = [(-1150, 150, 16, 11), (-1090, 150, 16, 11), (1160, 500, 12, 7)]   # dx, dz, 半寬, 半深
LIGHT_FLAK = [(-500, -450), (0, -480), (500, -450), (-700, -150), (-800, 200), (800, -200),
              (-450, 450), (150, 480), (1300, 0), (919, 919), (0, 1300), (-919, 919),
              (-1300, 0), (-919, -919), (0, -1300), (919, -919)]
HEAVY_FLAK = [(2300, 0), (1150, 1992), (-1150, 1992), (-2300, 0), (-1150, -1992), (1150, -1992)]
SEARCHLIGHTS = [(950, -150), (475, 823), (-475, 823), (-1100, 150), (-475, -823), (475, -823)]
# 連外道路：從墊面北緣往北出圖（遊戲 z 越負越北）
ROAD = [(-200, -50), (-200, -2500)]

# ═══════════════════════════ 材質 ═══════════════════════════

FIXED = {
    'LP_PlantSteel': (0x33, 0x38, 0x3d),
    'LP_PlantWall': (0x9a, 0x94, 0x88),
    'LP_PlantSand': (0x8a, 0x7a, 0x58),
    'LP_PlantPole': (0x5a, 0x4a, 0x38),
    'LP_PlantSlab': (0x86, 0x82, 0x79),
    'LP_PlantEarth': (0x6b, 0x5f, 0x4e),
}


def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    lin = tuple(_srgb_to_linear(v) for v in FIXED[name])
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*lin, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = (*lin, 1)
    return m


def get_col(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


# ═══════════════════════════ 幾何工具（與 build_plant.py 同一套） ═══════════════════════════

class Builder:
    """一個區塊的頂點與面，材質走多材質槽。零件不各自建物件。"""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.face_mat = []
        self.mats = []
        self._mat_index = {}

    def _mat(self, material):
        i = self._mat_index.get(material.name)
        if i is None:
            i = len(self.mats)
            self._mat_index[material.name] = i
            self.mats.append(material)
        return i

    def add(self, verts, faces, material, loc, rz_deg=0.0, rx_deg=0.0):
        base = len(self.verts)
        mi = self._mat(material)
        cz, sz = math.cos(math.radians(rz_deg)), math.sin(math.radians(rz_deg))
        cx, sx = math.cos(math.radians(rx_deg)), math.sin(math.radians(rx_deg))
        lx, ly, lz = loc
        for x, y, z in verts:
            y1 = y * cx - z * sx
            z1 = y * sx + z * cx
            self.verts.append((x * cz - y1 * sz + lx, x * sz + y1 * cz + ly, z1 + lz))
        for f in faces:
            self.faces.append(tuple(base + i for i in f))
            self.face_mat.append(mi)

    def to_object(self, name, col):
        if not self.faces:
            return None
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.validate()
        for m in self.mats:
            me.materials.append(m)
        for p, mi in zip(me.polygons, self.face_mat):
            p.material_index = mi
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        return ob


def box_mesh(sx, sy, sz):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    return v, f


def prism_mesh(sx, sy, h_wall, h_ridge):
    """人字頂的帳篷／木屋：四面牆到 `h_wall`，屋脊沿 Y 到 `h_ridge`"""
    hx, hy = sx / 2, sy / 2
    v = [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
         (-hx, -hy, h_wall), (hx, -hy, h_wall), (hx, hy, h_wall), (-hx, hy, h_wall),
         (0, -hy, h_ridge), (0, hy, h_ridge)]
    f = [(0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7),
         (4, 5, 8), (6, 7, 9), (4, 8, 9, 7), (5, 6, 9, 8)]
    return v, f


def cyl_mesh(r, h, seg):
    v = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        v.append((math.cos(a) * r, math.sin(a) * r, 0.0))
    for k in range(seg):
        a = 2 * math.pi * k / seg
        v.append((math.cos(a) * r, math.sin(a) * r, h))
    f = []
    for k in range(seg):
        n = (k + 1) % seg
        f.append((k, n, seg + n, seg + k))
    f.append(tuple(range(seg - 1, -1, -1)))
    f.append(tuple(range(seg, seg * 2)))
    return v, f


def add_box(b, mtl, dx, dz, z, sx, sd, sz, rz=0.0):
    """遊戲局部座標 (dx, dz)、底面高度 z。`sd` 是深（遊戲 Z 方向）"""
    v, f = box_mesh(sx, sd, sz)
    b.add(v, f, mtl, (dx, -dz, z + sz / 2), rz)


def add_prism(b, mtl, dx, dz, sx, sd, h_wall, h_ridge, rz=0.0):
    v, f = prism_mesh(sx, sd, h_wall, h_ridge)
    b.add(v, f, mtl, (dx, -dz, 0.0), rz)


def add_cyl(b, mtl, dx, dz, z, r, h, seg=6):
    v, f = cyl_mesh(r, h, seg)
    b.add(v, f, mtl, (dx, -dz, z))


class Rand:
    """種子進、序列出 —— 每次建出來要一樣"""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def __call__(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296.0


# ═══════════════════════════ 避讓 ═══════════════════════════

def _keepouts():
    """(dx, dz, 半寬, 半深) 的矩形。與 airfield-scenery.test.ts 的腳印一致，各外擴一點"""
    out = []
    for x0, z0, x1, z1 in PAVED:
        out.append(((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 20, (z1 - z0) / 2 + 20))
    for dx, dz in PARKED:
        out.append((dx, dz, 19, 15))
    for dx, dz, hw, hd in DUMPS:
        out.append((dx, dz, hw + 3, hd + 3))
    for dx, dz in LIGHT_FLAK + HEAVY_FLAK + SEARCHLIGHTS:
        out.append((dx, dz, 10, 10))
    return out


KEEPOUTS = _keepouts()


def free(dx, dz, hw, hd):
    """這一塊（半寬 hw、半深 hd）有沒有壓到任何避讓區"""
    for kx, kz, khw, khd in KEEPOUTS:
        if abs(dx - kx) < hw + khw and abs(dz - kz) < hd + khd:
            return False
    return True


# ═══════════════════════════ 區塊 ═══════════════════════════

def build_camp(b):
    """營舍區：主墊面南緣的西段、滑行道南邊。帳篷成排、木屋幾座、幾輛卡車"""
    n = 0
    tent = mat('LP_PlantSand')
    hut = mat('LP_PlantPole')
    truck = mat('LP_PlantSteel')
    rand = Rand(31)
    # 帳篷 4 排 × 6 座，斜頂，長軸南北
    for row in range(4):
        for k in range(6):
            dx = -1130 + k * 14
            dz = 340 + row * 12
            if not free(dx, dz, 4, 3):
                continue
            add_prism(b, tent, dx, dz, 6, 4, 1.4, 2.6, rz=(rand() - 0.5) * 6)
            n += 1
    # 木屋一列在帳篷北邊
    for k in range(4):
        dx = -1000 + k * 30
        dz = 350
        if free(dx, dz, 6, 4):
            add_prism(b, hut, dx, dz, 10, 6, 2.4, 3.6)
            n += 1
    # 卡車三輛停在木屋前
    for k in range(3):
        dx = -880 + k * 12
        dz = 400
        if free(dx, dz, 3, 2):
            add_box(b, truck, dx, dz, 0.0, 2.4, 6, 2.5, rz=(rand() - 0.5) * 20)
            n += 1
    return n


def build_tower(b):
    """塔台：兩層盒子疊起來，頂上一片平板"""
    wall = mat('LP_PlantWall')
    slab = mat('LP_PlantSlab')
    dx, dz = -100, -80
    add_box(b, wall, dx, dz, 0.0, 8, 8, 4)
    add_box(b, wall, dx, dz, 4.0, 6, 6, 3)
    add_box(b, slab, dx, dz, 7.0, 7, 7, 0.3)
    return 3


def build_drums(b):
    """散桶：油桶堆周圍散落的單桶。避開兩個堆本身"""
    n = 0
    steel = mat('LP_PlantSteel')
    rand = Rand(47)
    for _ in range(150):
        dx = -1180 + rand() * 120
        dz = 180 + rand() * 50
        if not free(dx, dz, 0.4, 0.4):
            continue
        add_cyl(b, steel, dx, dz, 0.0, 0.3, 0.9, 6)
        n += 1
    return n


def build_poles(b):
    """電線桿：沿連外道路，每 40 m 一根，離路 8 m"""
    n = 0
    pole = mat('LP_PlantPole')
    (ax, az), (bx, bz) = ROAD
    length = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / length, (bz - az) / length
    k = 0
    while k * 40 < length:
        dx = ax + ux * k * 40 + 8
        dz = az + uz * k * 40
        if free(dx, dz, 0.3, 0.3):
            add_cyl(b, pole, dx, dz, 0.0, 0.15, 8, 5)
            add_box(b, pole, dx, dz, 7.4, 2.0, 0.15, 0.15)
            n += 2
        k += 1
    return n


def build_runway_heads(b):
    """跑道兩端的邊界板：一片薄板標出跑道頭，離跑道 5 m"""
    slab = mat('LP_PlantSlab')
    x0, z0, x1, z1 = RUNWAY
    for x in (x0 - 5, x1 + 5):
        add_box(b, slab, x, 0, 0.0, 1.0, z1 - z0, 0.3)
    return 2


def clear_airfield():
    for name in list(bpy.data.collections.keys()):
        if name.startswith('Airfield'):
            c = bpy.data.collections[name]
            for ob in list(c.objects):
                bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.collections.remove(c)


def build_airfield():
    """整片機場的佈景。**一個區塊一顆網格**，全部掛在 `Airfield` 之下。"""
    clear_airfield()
    root = get_col('Airfield')
    total = 0
    for name, fn in (('camp', build_camp), ('tower', build_tower), ('drums', build_drums),
                     ('poles', build_poles), ('heads', build_runway_heads)):
        b = Builder()
        total += fn(b)
        b.to_object('Airfield_%s' % name, root)
    print('機場佈景：零件 %d 個、三角形 %d' % (total, count_triangles()))
    return total


def count_triangles():
    n = 0
    for ob in get_col('Airfield').objects:
        if ob.type != 'MESH':
            continue
        for p in ob.data.polygons:
            n += max(1, len(p.vertices) - 2)
    return n


def export_airfield():
    """匯出 models-src/poltava_airfield.glb。**只匯出 Airfield 底下的網格**"""
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, 'poltava_airfield.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in get_col('Airfield').objects:
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
    # 【法線不匯】遊戲端合併之後統一 computeVertexNormals
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_normals=False,
        export_texcoords=False, export_materials='EXPORT', export_cameras=False,
        export_lights=False,
    )
    size = os.path.getsize(path)
    print('匯出 %s（%.2f MB、三角形 %d）' % (path, size / 1048576, count_triangles()))
    return path
