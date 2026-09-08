# -*- coding: utf-8 -*-
"""
洛伊納合成油廠的佈景：3,000 × 1,500 m 的廠區，街廓、管廊、廠房、儲槽、
調車場、圍牆、煙囪。**純佈景** —— 十二座可炸的構件不在這裡（它們是地面
目標，仍由 `src/render/geometry/ground/plant.ts` 程序化生，有命中盒與殘骸）。

用法（Blender 5.x，MCP 或文字編輯器都可以）：
    exec(open(r'tools/blender/build_plant.py', encoding='utf-8').read())
    build_plant()      # 建整片，每個街廓一個 Collection
    export_plant()     # 匯出 public/models/leuna_plant.glb

【座標】Blender 系 X 橫向、+Y 前、Z 上，**原點就是廠區中心**（遊戲世界的
(0, −7000)）。遊戲端載入後平移過去。
    遊戲 (x, y, z) = Blender (x, z, −y)
所以這裡的 Blender y = −遊戲 dz、Blender z = 高度。

【顏色是遊戲的】材質只帶名字（LP_Plant*），對應表在
`src/render/geometry/ground/glb.ts`。名字對不上遊戲載入會丟 —— 與 T-34 那
四台同一條紀律。Blender 裡看到的顏色只是給人看的預覽。

【可以手改】建出來的每一個零件都是獨立物件，依街廓分進 Collection。搬、刪、
改尺寸都可以，改完直接 `export_plant()`。**不要改材質名**。

【避讓】十二座構件、八台卡車與廠內道路上不擺佈景 —— 佈景沒有命中盒，疊上去
會看到炸彈穿過管架在構件上爆。手動加東西時自己避開（`KEEPOUTS` 有座標）。
"""
import bpy, math, os
from mathutils import Vector

ROOT = r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\lenua-build"
OUT_DIR = os.path.join(ROOT, "public", "models")
LOG = {}

# ═══════════════════════════ 佈局資料 ═══════════════════════════
# 與 src/world/leuna.ts 同一份數字。那邊改了這邊要跟著改。

PAD_HALF_X, PAD_HALF_Z = 1500.0, 750.0
LANES_X = [-1100.0, -600.0, -100.0, 500.0, 1000.0]
LANES_Z = [-400.0, 0.0, 400.0]
LANE_WIDTH = 16.0

# 6 欄 × 4 列，欄由西到東、列由北到南
BLOCK_KINDS = [
    ['halls', 'process', 'utility', 'railyard'],
    ['process', 'process', 'halls', 'railyard'],
    ['utility', 'process', 'utility', 'open'],
    ['process', 'utility', 'utility', 'halls'],
    ['halls', 'tankFarm', 'tankFarm', 'railyard'],
    ['tankFarm', 'tankFarm', 'open', 'open'],
]

# 十二座可炸構件的腳印（相對廠區中心）：dx, dz, 寬, 深
PLANT_FOOTPRINTS = [
    (-1000, -250, 8, 8), (-920, -250, 8, 8), (-840, -250, 8, 8),
    (-650, -380, 8, 8), (-700, -120, 60, 30),
    (0, -320, 60, 30), (160, -470, 8, 8), (260, 220, 30, 30), (-360, 320, 40, 40),
    (800, 120, 25, 25), (900, 120, 25, 25), (850, 220, 25, 25),
]

# 卡車（相對廠區中心）
TRUCKS = [(-560, -40), (-540, -60), (120, 20), (540, 300), (560, 460),
          (1180, -20), (520, 1800), (-2400, 20)]

# 廠內道路（相對廠區中心）：兩端點。**避讓只看這三條** —— 連外的兩條在
# 墊面外，街廓的東西本來就碰不到
ROADS = [(-1500, 0, 1500, 0), (-600, -750, -600, 750), (500, -750, 500, 750)]
ROAD_HALF = 8.0

# 連外道路的折線（相對廠區中心）：南門到地圖南緣、西門到西緣。電線桿沿著它們立
OUT_ROADS = [
    [(500, 750), (500, 4000), (900, 9000), (900, 21500)],
    [(-1500, 0), (-6000, 0), (-7200, 800), (-14500, 800)],
]

# 預定砲位（相對廠區中心）。沙包圍一圈
FLAK_SITES = [(-2600, -1200), (2600, -1200), (-3000, 0), (3000, 0),
              (-2600, 1200), (2600, 1200), (0, -2700), (0, 2700)]

# 佈景煙囪（相對廠區中心）：dx, dz, 高
STACKS = [(-1440, -340, 62), (-1050, -690, 55), (-1050, -60, 68), (-560, -80, 58),
          (-60, -700, 64), (-1440, 60, 48), (-560, -700, 52), (-60, -60, 60)]

# ═══════════════════════════ 材質 ═══════════════════════════
# 髒舊色盤 5 色 × 4 明度階。**名字是與 glb.ts 的合約**

PALETTE = [(0x6e, 0x5a, 0x4a), (0x3c, 0x3a, 0x37), (0x6b, 0x6d, 0x68),
           (0x55, 0x4a, 0x3c), (0x8a, 0x5a, 0x3c)]
SHADES = [0.90, 0.97, 1.04, 1.10]

FIXED = {
    'LP_PlantBrick': (0x6b, 0x4a, 0x3c),
    'LP_PlantSteel': (0x33, 0x38, 0x3d),
    'LP_PlantGlass': (0x2c, 0x3a, 0x44),
    'LP_PlantCoal': (0x2b, 0x27, 0x23),
    'LP_PlantEarth': (0x6b, 0x5f, 0x4e),
    'LP_PlantWall': (0x9a, 0x94, 0x88),
    'LP_PlantSand': (0x8a, 0x7a, 0x58),
    'LP_PlantPole': (0x5a, 0x4a, 0x38),
    'LP_PlantRail': (0x4a, 0x4f, 0x55),
    'LP_PlantPlatform': (0x7d, 0x7a, 0x72),
}


def _srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def mat(name, rgb):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    lin = tuple(_srgb_to_linear(v) for v in rgb)
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*lin, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = (*lin, 1)
    return m


def grime_mat(seed):
    """序號進、材質出。與 TS 的 `grime()` 同一個意思：同一排的東西深淺不一"""
    s = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
    i = (s >> 27) % len(PALETTE)
    j = (s >> 20) & 0x3
    name = 'LP_Plant_%d%d' % (i, j)
    r, g, b = PALETTE[i]
    f = SHADES[j]
    return mat(name, (min(255, r * f), min(255, g * f), min(255, b * f)))


def fixed_mat(key):
    return mat(key, FIXED[key])


# ═══════════════════════════ 幾何工具 ═══════════════════════════

def get_col(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


class Builder:
    """一個街廓的頂點與面。**零件不各自建物件** —— 一萬五千個物件會讓
    Blender 在 join 與匯出時吃爆記憶體，而且 GLB 光是 node 的 JSON 就佔掉
    一半體積。

    材質走多材質槽：每一面記自己的 `material_index`，所以一顆網格裡仍然有
    幾十種顏色。要改個別零件就進 Edit Mode。
    """

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
        """把一組頂點先繞 X、再繞 Z 轉，平移到 `loc`，累積進來"""
        base = len(self.verts)
        mi = self._mat(material)
        cz, sz = math.cos(math.radians(rz_deg)), math.sin(math.radians(rz_deg))
        cx, sx = math.cos(math.radians(rx_deg)), math.sin(math.radians(rx_deg))
        lx, ly, lz = loc
        for x, y, z in verts:
            y2 = y * cx - z * sx
            z2 = y * sx + z * cx
            self.verts.append((x * cz - y2 * sz + lx, x * sz + y2 * cz + ly, z2 + lz))
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
    """中心在原點的長方體。`sy` 是 Blender 的 Y（遊戲的 −Z）"""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    return v, f


def cyl_mesh(r_bottom, r_top, h, seg):
    """軸沿 Z、底面在 z = 0 的柱／截錐。側面是 quad，頂底各一個 n-gon"""
    v = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        v.append((math.cos(a) * r_bottom, math.sin(a) * r_bottom, 0.0))
    for k in range(seg):
        a = 2 * math.pi * k / seg
        v.append((math.cos(a) * r_top, math.sin(a) * r_top, h))
    f = []
    for k in range(seg):
        n = (k + 1) % seg
        f.append((k, n, seg + n, seg + k))
    f.append(tuple(range(seg - 1, -1, -1)))
    f.append(tuple(range(seg, seg * 2)))
    return v, f


def add_box(b, name, mtl, cx, cy, cz, sx, sy, sz, rz=0.0, rx=0.0):
    v, f = box_mesh(sx, sy, sz)
    b.add(v, f, mtl, (cx, cy, cz), rz, rx)


def add_cyl(b, name, mtl, cx, cy, cz, r_bottom, r_top, h, seg, rz=0.0, rx=0.0,
            centered=False):
    """`centered` 把柱體的原點由底面移到中心。

    【躺著的柱體一定要 centered】`cyl_mesh` 的底面在 z = 0；`rx = 90` 之後
    那個底面轉到一端去，柱子會整根偏移半個長度 —— 而畫面上只像是「這根管子
    接歪了」。
    """
    v, f = cyl_mesh(r_bottom, r_top, h, seg)
    if centered:
        v = [(x, y, z - h / 2) for x, y, z in v]
    b.add(v, f, mtl, (cx, cy, cz), rz, rx)


# ═══════════════════════════ 亂數（決定性） ═══════════════════════════

class Rand:
    """種子進、序列出。**不得用 random 模組** —— 每次建出來要一樣"""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def __call__(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s / 4294967296.0


def cell_hash(i, j, salt):
    h = ((i * 0x27d4eb2d) ^ (j * 0x85ebca6b) ^ (salt * 0x165667b1)) & 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 0x2545f491) & 0xFFFFFFFF
    return (h ^ (h >> 13)) & 0xFFFFFFFF


# ═══════════════════════════ 避讓 ═══════════════════════════
# 不能擺佈景的矩形（相對廠區中心）：構件腳印 +6 m、卡車 +7 m、道路半寬 +2 m

def _build_keepouts():
    out = []
    for dx, dz, w, d in PLANT_FOOTPRINTS:
        out.append((dx - w / 2 - 6, dz - d / 2 - 6, dx + w / 2 + 6, dz + d / 2 + 6))
    for tx, tz in TRUCKS:
        out.append((tx - 7, tz - 7, tx + 7, tz + 7))
    for ax, az, bx, bz in ROADS:
        pad = ROAD_HALF + 2
        out.append((min(ax, bx) - pad, min(az, bz) - pad, max(ax, bx) + pad, max(az, bz) + pad))
    return out


KEEPOUTS = _build_keepouts()


def free_rect(dx, dz, hw, hd):
    for x0, z0, x1, z1 in KEEPOUTS:
        if dx + hw > x0 and dx - hw < x1 and dz + hd > z0 and dz - hd < z1:
            return False
    return True


def free(dx, dz, r):
    return free_rect(dx, dz, r, r)


def spans(ax, az, bx, bz, r):
    """一條線段扣掉禁區之後剩下的子段。太短的丟掉"""
    out = []
    length = math.hypot(bx - ax, bz - az)
    steps = max(2, int(math.ceil(length / 5)))
    start = -1.0
    for i in range(steps + 1):
        t = i / steps
        ok = free(ax + (bx - ax) * t, az + (bz - az) * t, r)
        if ok and start < 0:
            start = t
        if (not ok or i == steps) and start >= 0:
            end = t if ok else (i - 1) / steps
            if (end - start) * length >= 24:
                out.append((ax + (bx - ax) * start, az + (bz - az) * start,
                            ax + (bx - ax) * end, az + (bz - az) * end))
            start = -1.0
    return out


# ═══════════════════════════ 零件 ═══════════════════════════
# 每一支的**底面在 z = 0**、`dx`／`dz` 是它的中心（遊戲的相對座標）。
# 圓管一律三角柱：一根管子從投彈高度看只是一條線。

FLOOR_H = 5.0


def truss_tower(col, dx, dz, size, layers, seed):
    """開放式桁架塔：四根角柱、每層平台與欄杆、層間斜梯、頂上排氣管"""
    n = 0
    h = size / 2
    top = layers * FLOOR_H
    steel = grime_mat(seed)
    frame = fixed_mat('LP_PlantSteel')
    for sx in (-1, 1):
        for sz in (-1, 1):
            add_box(col, 'truss_leg', frame, dx + sx * (h - 0.35), -(dz + sz * (h - 0.35)),
                    top / 2, 0.7, 0.7, top)
            n += 1
    for f in range(1, layers + 1):
        y = f * FLOOR_H
        add_box(col, 'truss_deck', steel, dx, -dz, y, size, size, 0.3)
        add_box(col, 'truss_rail', frame, dx, -(dz - h), y + 0.65, size, 0.15, 1.0)
        add_box(col, 'truss_rail', frame, dx, -(dz + h), y + 0.65, size, 0.15, 1.0)
        d = 1 if f % 2 == 0 else -1
        # 斜梯的下角抬 0.3 m —— 少了它整片廠區的最低點會是負的
        add_box(col, 'truss_stair', frame, dx + d * (h - 1), -dz,
                y - FLOOR_H / 2 + 0.3, 1.2, FLOOR_H * 1.4, 0.2, 0.0, d * 45)
        n += 4
    add_box(col, 'truss_top', steel, dx, -dz, top + 0.2, size * 0.8, size * 0.8, 0.4)
    add_cyl(col, 'truss_vent', grime_mat(seed + 1), dx + h * 0.5, -dz, top, 0.5, 0.5,
            top * 0.25, 3)
    add_cyl(col, 'truss_vent', grime_mat(seed + 2), dx - h * 0.5, -(dz + h * 0.4), top,
            0.4, 0.4, top * 0.18, 3)
    return n + 3


def upright_tank(col, dx, dz, r, h, seed):
    """立式槽：八邊筒加淺錐頂。外廓正好是 2r × h"""
    m = grime_mat(seed)
    add_cyl(col, 'tank', m, dx, -dz, 0.0, r, r, h * 0.92, 8)
    add_cyl(col, 'tank_top', m, dx, -dz, h * 0.92, r, r * 0.25, h * 0.08, 8)
    return 2


def horiz_tank(col, dx, dz, r, length, rz, seed):
    """臥式槽：躺著的八邊筒加兩座鞍座。未轉時長軸沿遊戲的 Z"""
    m = grime_mat(seed)
    frame = fixed_mat('LP_PlantSteel')
    saddle = 0.6
    add_cyl(col, 'htank', m, dx, -dz, saddle + r, r, r, length, 8, rz, 90.0, True)
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    off = length * 0.3
    for sgn in (-1, 1):
        add_box(col, 'htank_saddle', frame, dx + sgn * off * s, -(dz + sgn * off * c),
                saddle / 2, r * 1.6, r * 0.8, saddle, rz)
    return 3


def sphere_tank(col, dx, dz, r, seed):
    """球罐：兩個對扣的截錐。真球在投彈高度看不出來，這樣省五倍三角形"""
    m = grime_mat(seed)
    add_cyl(col, 'sphere', m, dx, -dz, 0.0, r * 0.5, r, r, 8)
    add_cyl(col, 'sphere', m, dx, -dz, r, r, r * 0.5, r, 8)
    return 2


def fan_stack(col, dx, dz, r, h, seed):
    """冷卻風扇筒：八邊筒加頂上一片十字扇葉"""
    add_cyl(col, 'fan', grime_mat(seed), dx, -dz, 0.0, r, r, h, 8)
    add_box(col, 'fan_blade', fixed_mat('LP_PlantSteel'), dx, -dz, h + 0.15,
            r * 1.8, r * 0.4, 0.3, 30.0)
    return 2


def bund_run(col, ax, az, bx, bz, h):
    """儲槽區的環形土堤，一段。四邊各自呼叫，中間可以斷開留出入口"""
    length = math.hypot(bx - ax, bz - az)
    if length < 1:
        return 0
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    add_box(col, 'bund', fixed_mat('LP_PlantEarth'), (ax + bx) / 2, -(az + bz) / 2, h / 2,
            2.5, length, h, rz)
    return 1


def sawtooth_hall(col, dx, dz, w, d, h, teeth, rz, seed):
    """鋸齒天窗的長條廠房。未轉時 `w` 沿 X、`d` 沿遊戲的 Z，鋸齒沿 d 排"""
    wall = grime_mat(seed)
    roof = grime_mat(seed + 1)
    glass = fixed_mat('LP_PlantGlass')
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))

    def at(lx, lz):
        return dx + lx * c + lz * s, dz - lx * s + lz * c

    add_box(col, 'hall', wall, dx, -dz, h / 2, w, d, h, rz)
    pitch = d / teeth
    slab = pitch * 0.94
    for k in range(teeth):
        lz = -d / 2 + pitch * (k + 0.5)
        px, pz = at(0.0, lz)
        add_box(col, 'hall_roof', roof, px, -pz, h + 0.9, w * 0.98, slab, 0.3, rz, 20.0)
        qx, qz = at(0.0, lz - pitch * 0.4)
        add_box(col, 'hall_light', glass, qx, -qz, h + 1.5, w * 0.98, 0.25, 1.6, rz)
    return 1 + teeth * 2


def rail_track(col, ax, az, bx, bz):
    """一股軌道：一整條薄板。枕木不做 —— 俯視看不見，只吃三角形"""
    length = math.hypot(bx - ax, bz - az)
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    add_box(col, 'rail', fixed_mat('LP_PlantRail'), (ax + bx) / 2, -(az + bz) / 2, 0.2,
            3.0, length, 0.4, rz)
    return 1


def rail_car(col, dx, dz, rz, tank, seed):
    """車廂：底架、車身（罐車是六邊臥筒、敞車是盒子）、一條轉向架"""
    m = grime_mat(seed)
    frame = fixed_mat('LP_PlantSteel')
    add_box(col, 'car_frame', frame, dx, -dz, 1.05, 3.0, 12.0, 0.5, rz)
    add_box(col, 'car_bogie', fixed_mat('LP_PlantCoal'), dx, -dz, 0.35, 2.2, 10.0, 0.7, rz)
    if tank:
        add_cyl(col, 'car_tank', m, dx, -dz, 2.8, 1.5, 1.5, 10.5, 6, rz, 90.0, True)
    else:
        add_box(col, 'car_body', m, dx, -dz, 2.5, 3.0, 11.0, 2.4, rz)
    return 3


RACK_BAY = 12.0
PIPE_DIAMETERS = [1.2, 0.8, 1.0, 0.6, 0.9]


def pipe_bridge(col, ax, az, bx, bz, h, pipes, seed):
    """架高的管廊：每 12 m 一個門型鋼架，樑上並排三角柱的管"""
    length = math.hypot(bx - ax, bz - az)
    if length < 1:
        return 0
    n = 0
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    side = math.cos(math.radians(rz))
    fwd = math.sin(math.radians(rz))
    width = pipes * 1.4 + 1
    frame = fixed_mat('LP_PlantSteel')
    bays = max(1, int(length // RACK_BAY))
    for k in range(bays + 1):
        t = k / bays
        px = ax + (bx - ax) * t
        pz = az + (bz - az) * t
        ox = width / 2 * side
        oz = -width / 2 * fwd
        add_box(col, 'rack_leg', frame, px + ox, -(pz + oz), h / 2, 0.4, 0.4, h)
        add_box(col, 'rack_leg', frame, px - ox, -(pz - oz), h / 2, 0.4, 0.4, h)
        add_box(col, 'rack_beam', frame, px, -pz, h - 0.2, width + 0.6, 0.4, 0.4, rz)
        n += 3
    mx, mz = (ax + bx) / 2, (az + bz) / 2
    for p in range(pipes):
        dia = PIPE_DIAMETERS[p % len(PIPE_DIAMETERS)]
        off = (p - (pipes - 1) / 2) * 1.4
        add_cyl(col, 'pipe', grime_mat(seed + p), mx + off * side, -(mz - off * fwd),
                h + dia / 2, dia / 2, dia / 2, length, 3, rz, 90.0, True)
        n += 1
    return n


def smoke_stack(col, dx, dz, h, seed):
    """佈景煙囪：錐形磚身加兩圈箍。頂端是遊戲發白煙的地方"""
    r = h * 0.045
    add_cyl(col, 'stack', fixed_mat('LP_PlantBrick'), dx, -dz, 0.0, r, r * 0.62, h, 6)
    frame = fixed_mat('LP_PlantSteel')
    add_cyl(col, 'stack_band', frame, dx, -dz, h * 0.42, r * 0.92, r * 0.92, 0.8, 6)
    add_cyl(col, 'stack_band', frame, dx, -dz, h * 0.78, r * 0.76, r * 0.76, 0.8, 6)
    add_cyl(col, 'stack_cap', grime_mat(seed), dx, -dz, h * 0.985, r * 0.6, r * 0.6,
            h * 0.03, 6)
    return 4


# ═══════════════════════════ 街廓 ═══════════════════════════

def merge_plan(cols, rows):
    """相鄰而且同機能的兩格合併。等大等距的格子從空中看是二十四塊拼圖"""
    owner = [-1] * (cols * rows)
    rnd = Rand(0x9e3779b9)
    for i in range(cols - 1):
        for j in range(rows):
            a, b = i * rows + j, (i + 1) * rows + j
            if owner[a] != -1 or owner[b] != -1:
                continue
            if BLOCK_KINDS[i][j] != BLOCK_KINDS[i + 1][j]:
                continue
            if rnd() > 0.85:
                continue
            owner[a] = owner[b] = a
    for i in range(cols):
        for j in range(rows - 1):
            a, b = i * rows + j, i * rows + j + 1
            if owner[a] != -1 or owner[b] != -1:
                continue
            if BLOCK_KINDS[i][j] != BLOCK_KINDS[i][j + 1]:
                continue
            if rnd() > 0.8:
                continue
            owner[a] = owner[b] = a
    for k in range(len(owner)):
        if owner[k] == -1:
            owner[k] = k
    return owner


def build_blocks():
    """街廓清單：(x0, z0, x1, z1, kind, seed)，相對廠區中心，已退掉巷道"""
    xs = [-PAD_HALF_X] + LANES_X + [PAD_HALF_X]
    zs = [-PAD_HALF_Z] + LANES_Z + [PAD_HALF_Z]
    cols, rows = len(xs) - 1, len(zs) - 1
    owner = merge_plan(cols, rows)
    out = []
    for i in range(cols):
        for j in range(rows):
            if owner[i * rows + j] != i * rows + j:
                continue
            i1, j1 = i, j
            for k in range(cols * rows):
                if owner[k] == i * rows + j:
                    i1 = max(i1, k // rows)
                    j1 = max(j1, k % rows)
            seed = 2000 + i * 10 + j
            # 巷寬因街廓而異：每一條都同寬的話白邊自己會排成一張格線
            half = LANE_WIDTH * (0.7 + ((seed * 37) % 7) / 10) / 2
            out.append((xs[i] + half, zs[j] + half, xs[i1 + 1] - half, zs[j1 + 1] - half,
                        BLOCK_KINDS[i][j], seed))
    return out


BLOCKS = build_blocks()

INSET = 8.0


class Frame:
    """街廓的主軸。填充器照 (沿主軸 u、沿次軸 v) 擺，由這一層翻成相對座標。

    主軸寫死的話，六個製程區的管廊全是同方向的平行線 —— 從投彈高度一眼
    看得出是同一個模板。
    """

    def __init__(self, x0, z0, x1, z1, along_x):
        self.x0, self.z0, self.x1, self.z1 = x0, z0, x1, z1
        self.along_x = along_x
        if along_x:
            self.along, self.across = x1 - x0, z1 - z0
            self.rz, self.hall_rz = 90.0, 0.0
        else:
            self.along, self.across = z1 - z0, x1 - x0
            self.rz, self.hall_rz = 0.0, 90.0

    def at(self, u, v):
        if self.along_x:
            return self.x0 + u, self.z0 + v
        return self.x0 + v, self.z0 + u


def inner(b):
    return b[0] + INSET, b[1] + INSET, b[2] - INSET, b[3] - INSET


# ═══════════════════════════ 填充器 ═══════════════════════════

def fill_tank_farm(col, b):
    """儲槽區：環形土堤圍一圈，裡面成排的立式槽，排間低矮的管廊"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n = 0
    bx0, bz0, bx1, bz1 = x0 + 4, z0 + 4, x1 - 4, z1 - 4
    for ax, az, cx, cz in ((bx0, bz0, bx1, bz0), (bx0, bz1, bx1, bz1),
                           (bx0, bz0, bx0, bz1), (bx1, bz0, bx1, bz1)):
        for s in spans(ax, az, cx, cz, 2):
            n += bund_run(col, s[0], s[1], s[2], s[3], 3 + rnd())
    big = 10 + int(rnd() * 4) * 1.8
    small = big * (0.5 + rnd() * 0.16)
    pitch = big * (2.2 + rnd() * 0.5)
    nu = max(1, int((f.along - 20) // pitch))
    nv = max(1, int((f.across - 20) // pitch))
    ou = 10 + (f.along - 20 - nu * pitch) / 2 + pitch / 2
    ov = 10 + (f.across - 20 - nv * pitch) / 2 + pitch / 2
    seq = 0
    for j in range(nv):
        for i in range(nu):
            h = cell_hash(i, j, b[5])
            if (h & 0xFF) < 26:
                continue
            r = small if ((h >> 8) % 3 == 0) else big
            jit = pitch * 0.07
            u = ou + i * pitch + (((h >> 12) & 0xFF) / 255 - 0.5) * jit
            v = ov + j * pitch + (((h >> 20) & 0xFF) / 255 - 0.5) * jit
            dx, dz = f.at(u, v)
            if not free(dx, dz, r + 2):
                continue
            n += upright_tank(col, dx, dz, r, 9 + ((h >> 4) & 0x3) * 4, b[5] * 31 + seq)
            seq += 1
        if j + 1 < nv and (cell_hash(j, 77, b[5]) & 1) == 0:
            v = ov + (j + 0.5) * pitch
            p0 = f.at(2, v)
            p1 = f.at(f.along - 2, v)
            for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
                n += pipe_bridge(col, s[0], s[1], s[2], s[3], 4 + rnd() * 2, 3, b[5] * 31 + seq)
                seq += 1
    return n


def fill_process(col, b):
    """氫化製程區：層層平行的管廊，中間插桁架塔與成排的細高塔柱"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    lanes = 4 + int(rnd() * 4)
    for k in range(lanes):
        v = f.across * ((k + 0.5) / lanes + (rnd() - 0.5) * 0.07)
        pipes = 3 + int(rnd() * 3)
        p0, p1 = f.at(0, v), f.at(f.along, v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], pipes):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], 5.5 + rnd() * 5, pipes,
                             b[5] * 31 + seq)
            seq += 1
    towers = 2 + int(rnd() * 3)
    tower_v = f.across * (0.16 + rnd() * 0.2)
    for k in range(towers):
        size = 16 + int(rnd() * 5) * 2.5
        dx, dz = f.at(f.along * ((k + 0.5) / towers + (rnd() - 0.5) * 0.08), tower_v)
        if not free(dx, dz, size):
            continue
        n += truss_tower(col, dx, dz, size, 3 + int(rnd() * 4), b[5] * 31 + seq)
        seq += 1
    bands = 1 + int(rnd() * 2)
    step = 8 + rnd() * 5
    for t in range(bands):
        v = f.across * (0.52 + t * 0.28 + (rnd() - 0.5) * 0.1)
        i, u = 0, 6.0
        while u < f.along - 6:
            h = cell_hash(i, t, b[5] + 13)
            i += 1
            u += step
            if (h & 0xFF) < 38:
                continue
            dx, dz = f.at(u, v)
            r = 3.2 + ((h >> 8) & 0x3) * 0.7
            if not free(dx, dz, r + 1.5):
                continue
            n += upright_tank(col, dx, dz, r, 18 + ((h >> 10) & 0x7) * 3, b[5] * 31 + seq)
            seq += 1
    fillers = 4 + int(rnd() * 4)
    fill_v = f.across * (0.32 + rnd() * 0.12)
    for k in range(fillers):
        dx, dz = f.at(f.along * ((k + 0.5) / fillers + (rnd() - 0.5) * 0.06), fill_v)
        if k % 2 == 0:
            length = 16 + rnd() * 12
            if not free_rect(dx, dz, length / 2 + 1, 6):
                continue
            n += horiz_tank(col, dx, dz, 3 + rnd(), length, f.rz, b[5] * 31 + seq)
        else:
            if not free(dx, dz, 6):
                continue
            n += fan_stack(col, dx, dz, 4 + rnd() * 2, 7 + rnd() * 4, b[5] * 31 + seq)
        seq += 1
    return n


def fill_halls(col, b):
    """廠房區：長條的鋸齒天窗屋頂成列。鋸齒是俯視最好認的東西"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    rows = 2 + int(rnd() * 3)
    gap = 12 + rnd() * 8
    span = (f.across - gap * (rows - 1)) / rows
    for k in range(rows):
        v = span / 2 + k * (span + gap)
        length = f.along * (0.5 + rnd() * 0.48)
        anchor = rnd()
        u = (length / 2 + 2 if anchor < 0.34
             else f.along / 2 if anchor < 0.67 else f.along - length / 2 - 2)
        dx, dz = f.at(u, v)
        hw = length / 2 if f.along_x else span * 0.46
        hd = span * 0.46 if f.along_x else length / 2
        h = 7 + rnd() * 7
        teeth = 3 + int(rnd() * 5)
        if not free_rect(dx, dz, hw, hd):
            half = length * 0.4
            for side in (-1, 1):
                qx, qz = f.at(u + side * length * 0.28, v)
                qw = half / 2 if f.along_x else span * 0.45
                qd = span * 0.45 if f.along_x else half / 2
                if not free_rect(qx, qz, qw, qd):
                    continue
                n += sawtooth_hall(col, qx, qz, half, span * 0.9, h, max(2, teeth - 1),
                                   f.hall_rz, b[5] * 31 + seq)
                seq += 1
            continue
        n += sawtooth_hall(col, dx, dz, length, span * 0.92, h, teeth, f.hall_rz,
                           b[5] * 31 + seq)
        seq += 1
    v = span + gap / 2
    p0, p1 = f.at(0, v), f.at(f.along, v)
    for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
        n += pipe_bridge(col, s[0], s[1], s[2], s[3], 12 + rnd() * 4, 3, b[5] * 31 + seq)
        seq += 1
    return n


def fill_railyard(col, b):
    """調車場：平行的股道、停著的車廂、一端的卸料棚"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    tracks = 3 + int(rnd() * 4)
    pitch = 8 + rnd() * 4
    v0 = (f.across - pitch * (tracks - 1)) * (0.25 + rnd() * 0.5)
    for k in range(tracks):
        v = v0 + k * pitch
        p0 = f.at(f.along * rnd() * 0.12, v)
        p1 = f.at(f.along * (1 - rnd() * 0.18), v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 3):
            n += rail_track(col, s[0], s[1], s[2], s[3])
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            gap = 15 + rnd() * 8
            cars = int(length / gap)
            for c in range(cars):
                h = cell_hash(c, k, b[5] + 5)
                if (h & 0xFF) < 64:
                    continue
                t = (c + 0.5) / cars
                dx = s[0] + (s[2] - s[0]) * t
                dz = s[1] + (s[3] - s[1]) * t
                if not free(dx, dz, 8):
                    continue
                n += rail_car(col, dx, dz, f.rz, ((h >> 8) & 1) == 0, b[5] * 31 + seq)
                seq += 1
    for k in range(1 + int(rnd() * 2)):
        dx, dz = f.at(f.along * (0.1 + rnd() * 0.8), f.across * (0.06 + rnd() * 0.1))
        hu = f.along * (0.08 + rnd() * 0.06)
        hv = f.across * 0.09
        hw = hu if f.along_x else hv
        hd = hv if f.along_x else hu
        if not free_rect(dx, dz, hw, hd):
            continue
        n += sawtooth_hall(col, dx, dz, hu * 2, hv * 2, 8, 3, f.hall_rz, b[5] * 31 + seq)
        seq += 1
    pv = f.across * (0.82 + rnd() * 0.12)
    q0, q1 = f.at(0, pv), f.at(f.along, pv)
    for s in spans(q0[0], q0[1], q1[0], q1[1], 6):
        length = math.hypot(s[2] - s[0], s[3] - s[1])
        add_box(col, 'platform', fixed_mat('LP_PlantPlatform'), (s[0] + s[2]) / 2,
                -(s[1] + s[3]) / 2, 0.6, length, 10.0, 1.2, f.hall_rz)
        n += 1
    return n


def fill_utility(col, b):
    """動力雜項：鍋爐房、風扇筒成排、球罐、變電站的框架、堆煤"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    lanes = [0.12 + rnd() * 0.1, 0.34 + rnd() * 0.12, 0.58 + rnd() * 0.12, 0.8 + rnd() * 0.12]
    for k, teeth in ((0, 5), (3, 4)):
        length = f.along * (0.5 + rnd() * 0.28)
        dx, dz = f.at(f.along * (0.3 + rnd() * 0.4), f.across * lanes[k])
        hu = length / 2
        hv = f.across * (0.07 + rnd() * 0.04)
        if not free_rect(dx, dz, hu if f.along_x else hv, hv if f.along_x else hu):
            continue
        n += sawtooth_hall(col, dx, dz, hu * 2, hv * 2, 10 + rnd() * 4, teeth, f.hall_rz,
                           b[5] * 31 + seq)
        seq += 1
    fan_rows = 1 + int(rnd() * 2)
    fan_step = 13 + rnd() * 6
    for t in range(fan_rows):
        v = f.across * (lanes[1] + t * 0.1)
        i, u = 0, 12.0
        while u < f.along - 12:
            h = cell_hash(i, t, b[5] + 21)
            i += 1
            u += fan_step
            if (h & 0xFF) < 30:
                continue
            dx, dz = f.at(u, v)
            if not free(dx, dz, 6.5):
                continue
            n += fan_stack(col, dx, dz, 4.5 + ((h >> 8) & 0x3) * 0.6,
                           6 + ((h >> 10) & 0x7), b[5] * 31 + seq)
            seq += 1
    spheres = 3 + int(rnd() * 3)
    for k in range(spheres):
        dx, dz = f.at(f.along * ((k + 0.5) / spheres + (rnd() - 0.5) * 0.1),
                      f.across * lanes[2])
        r = 7 + rnd() * 4
        if not free(dx, dz, r + 1):
            continue
        n += sphere_tank(col, dx, dz, r, b[5] * 31 + seq)
        seq += 1
    su = f.along * (0.15 + rnd() * 0.7)
    sv = f.across * lanes[3]
    sx, sz = f.at(su, sv)
    if free_rect(sx, sz, 18, 18):
        frame = fixed_mat('LP_PlantSteel')
        for i in range(6):
            for j in range(3):
                dx, dz = f.at(su - 15 + i * 6, sv - 6 + j * 6)
                add_box(col, 'switch_post', frame, dx, -dz, 4.5, 0.6, 0.6, 9.0)
                n += 1
                if j == 0:
                    qx, qz = f.at(su - 15 + i * 6, sv)
                    add_box(col, 'switch_beam', frame, qx, -qz, 8.6, 0.5, 12.0, 0.5,
                            f.hall_rz)
                    n += 1
    for k in range(1 + int(rnd() * 2)):
        length = f.along * (0.14 + rnd() * 0.1)
        dx, dz = f.at(f.along * (0.12 + rnd() * 0.7), f.across * lanes[3])
        hu, hv = length / 2, 11.0
        if not free_rect(dx, dz, hu if f.along_x else hv, hv if f.along_x else hu):
            continue
        ph = 3 + rnd() * 2
        add_box(col, 'coal', fixed_mat('LP_PlantCoal'), dx, -dz, ph / 2, length, 22.0, ph,
                f.hall_rz)
        n += 1
    bridges = 3 + int(rnd() * 3)
    for k in range(bridges):
        v = f.across * ((k + 0.5) / bridges + (rnd() - 0.5) * 0.08)
        p0, p1 = f.at(0, v), f.at(f.along, v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], 6 + rnd() * 5, 3, b[5] * 31 + seq)
            seq += 1
    return n


def fill_open(col, b):
    """留白：堆料場與零星的小屋。**這是刻意的空**，不是還沒做完"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, True)
    n, seq = 0, 0
    for k in range(3):
        dx, dz = f.at(f.along * (0.18 + 0.3 * k), f.across * (0.3 if k % 2 == 0 else 0.7))
        if not free(dx, dz, 16):
            continue
        if k == 1:
            add_box(col, 'shed', grime_mat(b[5] + k), dx, -dz, 1.6, 14.0, 9.0, 3.2)
            n += 1
        else:
            n += horiz_tank(col, dx, dz, 3, 16, k * 30, b[5] * 31 + seq)
            seq += 1
    return n


FILLERS = {
    'tankFarm': fill_tank_farm, 'process': fill_process, 'halls': fill_halls,
    'railyard': fill_railyard, 'utility': fill_utility, 'open': fill_open,
}


# ═══════════════════════════ 組裝 ═══════════════════════════

def clear_plant():
    for name in list(bpy.data.collections.keys()):
        if name.startswith('Plant'):
            c = bpy.data.collections[name]
            for ob in list(c.objects):
                bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.collections.remove(c)


def build_trunks(b):
    """骨幹：沿巷道蜿蜒的主幹。**不是貫穿全廠的十字** —— 每條巷道各一條直線
    從投彈高度看下去是一張規則的網，那是「程式鋪的」最明顯的破綻"""
    n = 0
    xs = [-PAD_HALF_X + 30] + LANES_X + [PAD_HALF_X - 30]
    zs = [-PAD_HALF_Z + 30] + LANES_Z + [PAD_HALF_Z - 30]
    rnd = Rand(0x51ed2701)
    for t in range(5):
        i = 0 if t % 2 == 0 else int(rnd() * len(xs))
        j = int(rnd() * len(zs)) if t % 2 == 0 else 0
        horizontal = t % 2 == 0
        h = 6 + rnd() * 6
        pipes = 3 + int(rnd() * 3)
        for k in range(3 + int(rnd() * 4)):
            ni = min(len(xs) - 1, i + 1 + int(rnd() * 2)) if horizontal else i
            nj = j if horizontal else min(len(zs) - 1, j + 1 + int(rnd() * 2))
            if ni == i and nj == j:
                break
            for s in spans(xs[i], zs[j], xs[ni], zs[nj], pipes):
                n += pipe_bridge(b, s[0], s[1], s[2], s[3], h, pipes, 900 + t * 10 + k)
            i, j = ni, nj
            if rnd() < 0.62:
                horizontal = not horizontal
    return n


def build_wall(b):
    """圍牆：沿墊面四周，道路穿過的地方留門。

    【每一段都走避讓，不是只避連外的門】廠內那三條道路的端點也在墊面邊上 ——
    只避連外門的話，牆會橫在廠內道路的出口上，而那一段在畫面上只是「圍牆」，
    要靠護欄才看得出它壓在路上。
    """
    n = 0
    m = fixed_mat('LP_PlantWall')
    seg, gate = 60.0, 24.0
    gates = [(500, 750), (-1500, 0)]
    half = (seg - 0.5) / 2
    x = -PAD_HALF_X + seg / 2
    while x < PAD_HALF_X:
        for sz in (-1, 1):
            z = sz * PAD_HALF_Z
            if any(math.hypot(gx - x, gz - z) < gate for gx, gz in gates):
                continue
            if not free_rect(x, z, half, 0.4):
                continue
            add_box(b, 'wall', m, x, -z, 1.25, seg - 0.5, 0.4, 2.5)
            n += 1
        x += seg
    z = -PAD_HALF_Z + seg / 2
    while z < PAD_HALF_Z:
        for sx in (-1, 1):
            x = sx * PAD_HALF_X
            if any(math.hypot(gx - x, gz - z) < gate for gx, gz in gates):
                continue
            if not free_rect(x, z, 0.4, half):
                continue
            add_box(b, 'wall', m, x, -z, 1.25, 0.4, seg - 0.5, 2.5)
            n += 1
        z += seg
    return n


def build_outskirts(b):
    """墊面外的佈景：砲位的沙包、沿連外道路的電線桿。

    【它們讓包圍球變得很大】電線桿一路排到地圖邊緣，整顆網格的包圍球因此
    有二十幾公里 —— 視錐剔除等於失效。這是既有的取捨：少了它們，連外道路
    在空中看起來是兩條畫在地上的線。
    """
    n = 0
    sand = fixed_mat('LP_PlantSand')
    for fx, fz in FLAK_SITES:
        for k in range(12):
            a = 2 * math.pi * k / 12
            add_box(b, 'sandbag', sand, fx + math.cos(a) * 6, -(fz + math.sin(a) * 6),
                    0.3, 1.0, 0.5, 0.6, -math.degrees(a))
            n += 1
    pole = fixed_mat('LP_PlantPole')
    for road in OUT_ROADS:
        for s in range(len(road) - 1):
            ax, az = road[s]
            bx, bz = road[s + 1]
            length = math.hypot(bx - ax, bz - az)
            count = int(length / 40)
            nx = (bz - az) / length
            nz = -(bx - ax) / length
            for k in range(count):
                t = (k + 0.5) / count
                # 桿子立在路肩：路的右側 8 m
                x = ax + (bx - ax) * t + nx * 8
                z = az + (bz - az) * t + nz * 8
                add_box(b, 'pole', pole, x, -z, 4.0, 0.3, 0.3, 8.0)
                n += 1
    return n


def build_plant():
    """整片廠區。**一個街廓一顆網格** —— 搬整個街廓、進 Edit Mode 改細節、
    或呼叫 `rebuild_block()` 重生單一街廓都可以。

    零件不各自建物件：一萬五千個物件會讓 Blender 在匯出時吃爆記憶體。
    """
    clear_plant()
    root = get_col('Plant')
    total = 0
    for blk in BLOCKS:
        b = Builder()
        total += FILLERS[blk[4]](b, blk)
        b.to_object('Plant_%s_%d' % (blk[4], blk[5]), root)

    tb = Builder()
    total += build_trunks(tb)
    tb.to_object('Plant_trunks', root)

    sb = Builder()
    for k, (dx, dz, h) in enumerate(STACKS):
        total += smoke_stack(sb, dx, dz, h, 700 + k)
    sb.to_object('Plant_stacks', root)

    wb = Builder()
    total += build_wall(wb)
    wb.to_object('Plant_wall', root)

    ob = Builder()
    total += build_outskirts(ob)
    ob.to_object('Plant_outskirts', root)

    LOG['parts'] = total
    LOG['blocks'] = len(BLOCKS)
    LOG['objects'] = len(get_col('Plant').objects)
    LOG['triangles'] = count_triangles()
    print('街廓 %d 個、網格 %d 顆、零件 %d 個、三角形 %d'
          % (LOG['blocks'], LOG['objects'], LOG['parts'], LOG['triangles']))
    return LOG


def rebuild_block(seed):
    """重生單一街廓。手改壞了或想換一組隨機時用它"""
    blk = next(b for b in BLOCKS if b[5] == seed)
    name = 'Plant_%s_%d' % (blk[4], blk[5])
    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    b = Builder()
    n = FILLERS[blk[4]](b, blk)
    b.to_object(name, get_col('Plant'))
    print('%s 重生：零件 %d 個' % (name, n))


def count_triangles():
    n = 0
    for ob in get_col('Plant').objects:
        if ob.type != 'MESH':
            continue
        for p in ob.data.polygons:
            n += max(1, len(p.vertices) - 2)
    return n


def export_plant():
    """匯出 public/models/leuna_plant.glb。**只匯出 Plant 底下的網格**"""
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, 'leuna_plant.glb')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in get_col('Plant').objects:
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
    # 【法線不匯】遊戲端合併之後統一 `computeVertexNormals` —— 平面著色的
    # 硬稜線靠的是不共用頂點，不是這裡的法線。匯了就是白白多一份等量的資料
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True, export_normals=False,
        export_texcoords=False, export_materials='EXPORT', export_cameras=False,
        export_lights=False,
    )
    size = os.path.getsize(path)
    LOG['glb_bytes'] = size
    print('匯出 %s（%.2f MB、三角形 %d）' % (path, size / 1048576, count_triangles()))
    return path

