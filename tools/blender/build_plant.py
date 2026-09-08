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

【可以手改】一個街廓一顆網格（材質走多材質槽），全部掛在 `Plant` 之下。整顆
搬、刪、進 Edit Mode 改細節都可以，改完直接 `export_plant()`。要換一組隨機
用 `rebuild_block(seed)`。**不要改材質名**。

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
# 【廠內那三條道路一定要落在巷道上】道路的避讓把佈景推開 20 m，一條穿過
# 街廓中間的路等於在那一格裡挖一條空溝
LANES_X = [-1100.0, -600.0, -180.0, 150.0, 500.0, 1000.0]
LANES_Z = [-420.0, 0.0, 380.0]
LANE_WIDTH = 16.0

# 7 欄 × 4 列，欄由西到東、列由北到南。
#
# 【同機能不相鄰】相鄰同機能會被 merge_plan 併成一塊 —— 舊表的儲槽區併出
# 一個 987 × 387 m 的方塊，從投彈高度看下去整個東半邊就是一區油槽。現在
# 除了調車場那一對，任兩格的鄰居都是別的機能，所以最大的街廓就是一格。
#
# 【調車場例外，而且靠南緣】它得接得到外面的鐵路，擺在廠區中間不合理。
BLOCK_KINDS = [
    ['halls', 'process', 'utility', 'railyard'],
    ['process', 'tankFarm', 'process', 'railyard'],
    ['utility', 'process', 'halls', 'process'],
    ['tankFarm', 'utility', 'process', 'halls'],
    ['process', 'tankFarm', 'utility', 'open'],
    ['halls', 'process', 'tankFarm', 'railyard'],
    ['tankFarm', 'utility', 'process', 'open'],
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

# 牆外的衛星設施（相對廠區中心）：dx, dz, 寬, 深, 種類
# **與 src/world/leuna.ts 的 PLANT_SATELLITES 同一份數字**。地面的鋪面由
# `LEUNA_SITE.outposts` 上色，這裡只建上面的東西。
# 【位置是手挑的】砲位與連外道路都不在 KEEPOUTS 裡，挪動前先自己對照
SATELLITES = [
    (-1900, -250, 220, 160, 'substation'),
    (720, 1080, 190, 150, 'pump'),
    (-1240, 1090, 260, 150, 'warehouse'),
    (1780, 470, 320, 130, 'siding'),
    (1700, -980, 210, 190, 'stockpile'),
    (-2060, 360, 180, 150, 'motorpool'),
]

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
    'LP_PlantSlab': (0x86, 0x82, 0x79),
    'LP_PlantStain': (0x33, 0x30, 0x2c),
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


class RectIndex:
    """矩形的格點索引。

    【不能線性掃】散佈器一個街廓要問上千次「這裡空著嗎」，而一個密的街廓有
    上千個已佔矩形 —— 線性掃是幾百萬次比較，整片廠區會跑到分鐘等級。
    """

    CELL = 24.0

    def __init__(self):
        self.cells = {}

    def _keys(self, x0, z0, x1, z1):
        for i in range(int(math.floor(x0 / self.CELL)), int(math.floor(x1 / self.CELL)) + 1):
            for j in range(int(math.floor(z0 / self.CELL)), int(math.floor(z1 / self.CELL)) + 1):
                yield i, j

    def add(self, dx, dz, hw, hd, height=0.0):
        r = (dx - hw, dz - hd, dx + hw, dz + hd, height)
        for k in self._keys(r[0], r[1], r[2], r[3]):
            self.cells.setdefault(k, []).append(r)

    def hit(self, dx, dz, hw, hd, taller_than=-1.0):
        """有沒有比 `taller_than` 高的矩形蓋到這一塊"""
        for k in self._keys(dx - hw, dz - hd, dx + hw, dz + hd):
            for x0, z0, x1, z1, hgt in self.cells.get(k, ()):
                if hgt <= taller_than:
                    continue
                if dx + hw > x0 and dx - hw < x1 and dz + hd > z0 and dz - hd < z1:
                    return True
        return False


# 全廠的高聳物件。高空管廊在所有街廓建完之後才鋪，靠這一份繞開廠房屋頂與
# 儲槽頂 —— 少了它，一條 2.5 km 的管廊會從十幾座廠房的屋頂穿過去。
TALL = RectIndex()


class Builder:
    """一個街廓的頂點與面。**零件不各自建物件** —— 一萬五千個物件會讓
    Blender 在 join 與匯出時吃爆記憶體，而且 GLB 光是 node 的 JSON 就佔掉
    一半體積。

    材質走多材質槽：每一面記自己的 `material_index`，所以一顆網格裡仍然有
    幾十種顏色。要改個別零件就進 Edit Mode。

    零件自己登記三件事，後處理的兩個填充器靠它們工作：
    `taken` 已佔的地（散佈器避開）、`anchors` 設備的落點與半徑（地面管線
    從這裡接出去）、`racks` 這個街廓的管廊中線（地面管線接到最近的一條）。
    """

    def __init__(self):
        self.verts = []
        self.faces = []
        self.face_mat = []
        self.mats = []
        self._mat_index = {}
        self.taken = RectIndex()
        self.anchors = []
        self.racks = []

    def claim(self, dx, dz, hw, hd, height=0.0):
        self.taken.add(dx, dz, hw, hd, height)
        if height >= 5.0:
            TALL.add(dx, dz, hw, hd, height)

    def anchor(self, dx, dz, r):
        self.anchors.append((dx, dz, r))

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


SNAP_STEP = 45.0
SNAP_JITTER = 10.0


def snap_rz(h):
    """雜物的朝向：貼齊 0 / 45 / 90 / 135 度，再抖 ±10 度。

    【不用自由角度】東西各自轉一個亂數角，從投彈高度看下去是一地碎屑；
    真的廠區裡所有東西都照建物與管線的方向擺，只有搬動過的才會歪一點。
    """
    return ((h >> 2) & 0x3) * SNAP_STEP + (((h >> 6) & 0xFF) / 255 - 0.5) * 2 * SNAP_JITTER


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
    col.claim(dx, dz, h, h, top)
    col.anchor(dx, dz, h)
    return n + 3


# 筒身一律六邊。八邊在投彈高度分不出來，而儲槽區的筒是全廠數量最多的東西：
# 一顆立式槽從 56 個三角形降到 40 個。
TANK_SEG = 6


def upright_tank(col, dx, dz, r, h, seed):
    """立式槽：六邊筒加淺錐頂。外廓正好是 2r × h"""
    m = grime_mat(seed)
    add_cyl(col, 'tank', m, dx, -dz, 0.0, r, r, h * 0.92, TANK_SEG)
    add_cyl(col, 'tank_top', m, dx, -dz, h * 0.92, r, r * 0.25, h * 0.08, TANK_SEG)
    col.claim(dx, dz, r, r, h)
    col.anchor(dx, dz, r)
    return 2


def horiz_tank(col, dx, dz, r, length, rz, seed):
    """臥式槽：躺著的六邊筒加兩座鞍座。未轉時長軸沿遊戲的 Z"""
    m = grime_mat(seed)
    frame = fixed_mat('LP_PlantSteel')
    saddle = 0.6
    add_cyl(col, 'htank', m, dx, -dz, saddle + r, r, r, length, TANK_SEG, rz, 90.0, True)
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    off = length * 0.3
    for sgn in (-1, 1):
        add_box(col, 'htank_saddle', frame, dx + sgn * off * s, -(dz + sgn * off * c),
                saddle / 2, r * 1.6, r * 0.8, saddle, rz)
    hw = max(r, abs(length / 2 * s)) + r
    hd = max(r, abs(length / 2 * c)) + r
    col.claim(dx, dz, hw, hd, saddle + 2 * r)
    col.anchor(dx, dz, max(hw, hd))
    return 3


def sphere_tank(col, dx, dz, r, seed):
    """球罐：兩個對扣的截錐。真球在投彈高度看不出來，這樣省五倍三角形"""
    m = grime_mat(seed)
    add_cyl(col, 'sphere', m, dx, -dz, 0.0, r * 0.5, r, r, TANK_SEG)
    add_cyl(col, 'sphere', m, dx, -dz, r, r, r * 0.5, r, TANK_SEG)
    col.claim(dx, dz, r, r, 2 * r)
    col.anchor(dx, dz, r)
    return 2


def fan_stack(col, dx, dz, r, h, seed):
    """冷卻風扇筒：六邊筒加頂上一片十字扇葉"""
    add_cyl(col, 'fan', grime_mat(seed), dx, -dz, 0.0, r, r, h, TANK_SEG)
    add_box(col, 'fan_blade', fixed_mat('LP_PlantSteel'), dx, -dz, h + 0.15,
            r * 1.8, r * 0.4, 0.3, 45.0)
    col.claim(dx, dz, r, r, h)
    col.anchor(dx, dz, r)
    return 2


def bund_run(col, ax, az, bx, bz, h):
    """儲槽區的環形土堤，一段。四邊各自呼叫，中間可以斷開留出入口"""
    length = math.hypot(bx - ax, bz - az)
    if length < 1:
        return 0
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    add_box(col, 'bund', fixed_mat('LP_PlantEarth'), (ax + bx) / 2, -(az + bz) / 2, h / 2,
            2.5, length, h, rz)
    col.claim((ax + bx) / 2, (az + bz) / 2,
              abs(bx - ax) / 2 + 2, abs(bz - az) / 2 + 2, h)
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
    hw = (abs(w * c) + abs(d * s)) / 2
    hd = (abs(w * s) + abs(d * c)) / 2
    col.claim(dx, dz, hw, hd, h + 2.3)
    return 1 + teeth * 2


def rail_track(col, ax, az, bx, bz):
    """一股軌道：一整條薄板。枕木不做 —— 俯視看不見，只吃三角形"""
    length = math.hypot(bx - ax, bz - az)
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    add_box(col, 'rail', fixed_mat('LP_PlantRail'), (ax + bx) / 2, -(az + bz) / 2, 0.2,
            3.0, length, 0.4, rz)
    col.claim((ax + bx) / 2, (az + bz) / 2,
              abs(bx - ax) / 2 + 2, abs(bz - az) / 2 + 2, 0.4)
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
    c, s = abs(math.cos(math.radians(rz))), abs(math.sin(math.radians(rz)))
    col.claim(dx, dz, (3.0 * c + 12.0 * s) / 2, (3.0 * s + 12.0 * c) / 2, 4.0)
    return 3


RACK_LEG_STEP = 46.0
RACK_DECK = 0.6


def pipe_bridge(col, ax, az, bx, bz, h, pipes, seed):
    """架高的管廊：兩片扁長條加稀疏的立柱。

    【不逐管建圓柱、不每 12 m 一副門架】投彈高度看下去，一條管廊就是地上的
    兩條平行線 —— 舊版一條 400 m 的管廊要一千兩百多個三角形，換來的細節在
    這一關的視距上分不出來。現在同樣一條是兩百出頭。

    複雜度改由**高度分層交錯**提供：省下來的預算拿去鋪四層彼此穿越的管廊網
    （`build_skyways`），那才是煉油廠從空中最好認的樣子。
    """
    length = math.hypot(bx - ax, bz - az)
    if length < 1:
        return 0
    n = 0
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    side = math.cos(math.radians(rz))
    fwd = math.sin(math.radians(rz))
    width = pipes * 1.4 + 1
    strip = width * 0.4
    mx, mz = (ax + bx) / 2, (az + bz) / 2
    for k, sgn in enumerate((-1, 1)):
        off = sgn * (width - strip) / 2
        add_box(col, 'rack_deck', grime_mat(seed + k * 5), mx + off * side,
                -(mz - off * fwd), h + RACK_DECK / 2, strip, length, RACK_DECK, rz)
        n += 1
    frame = fixed_mat('LP_PlantSteel')
    gates = max(2, int(length // RACK_LEG_STEP) + 1)
    for k in range(gates):
        t = k / (gates - 1)
        px = ax + (bx - ax) * t
        pz = az + (bz - az) * t
        for sgn in (-1, 1):
            add_box(col, 'rack_leg', frame, px + sgn * width / 2 * side,
                    -(pz - sgn * width / 2 * fwd), h / 2, 0.45, 0.45, h)
            n += 1
    col.racks.append((ax, az, bx, bz))
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


def ground_pipe(col, ax, az, bx, bz, seed):
    """貼地的管線：一條扁長條，高 0.9 m。**不做圓柱、不做枕木**

    理由同 `pipe_bridge` —— 俯視只是一條線。兩端各伸出半個寬度，L 形轉角
    才不會缺一塊。
    """
    length = math.hypot(bx - ax, bz - az)
    if length < 2:
        return 0
    rz = math.degrees(math.atan2(bx - ax, bz - az))
    add_box(col, 'gpipe', grime_mat(seed), (ax + bx) / 2, -(az + bz) / 2, 0.45,
            1.1, length + 1.1, 0.9, rz)
    return 1


def apron(col, dx, dz, w, d, rz, key):
    """裝卸坪／基座：一片 0.35 m 的低板。

    【不做零厚度的貼片】相機遠平面 5,000 km，投彈高度的深度精度只剩公尺級 ——
    貼在地面上幾公分的四邊形會整片閃爍，而那在畫面上像是顯示卡壞了。厚度做
    出來就是一塊真的水泥坪，多花十個三角形。
    """
    add_box(col, 'apron', fixed_mat(key), dx, -dz, 0.175, w, d, 0.35, rz)
    col.claim(dx, dz, w / 2, d / 2, 0.35)
    return 1


def gantry(col, dx, dz, span, h, rz, seed):
    """龍門吊：兩對腿、頂上一對主樑、中間一台吊車。調車場的地標"""
    frame = fixed_mat('LP_PlantSteel')
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    for su in (-1, 1):
        for sv in (-1, 1):
            lx = dx + (su * span / 2) * c + (sv * 5.0) * s
            lz = dz - (su * span / 2) * s + (sv * 5.0) * c
            add_box(col, 'gantry_leg', frame, lx, -lz, h / 2, 1.0, 1.0, h)
    for sv in (-1, 1):
        bx = dx + (sv * 5.0) * s
        bz = dz + (sv * 5.0) * c
        add_box(col, 'gantry_beam', frame, bx, -bz, h + 0.7, span + 2, 1.2, 1.4, rz)
    add_box(col, 'gantry_trolley', grime_mat(seed), dx, -dz, h + 1.9,
            5.0, 4.0, 2.2, rz)
    col.claim(dx, dz, abs(span / 2 * c) + 6, abs(span / 2 * s) + 6, h + 3)
    return 7


CLUTTER_KINDS = 9


def clutter(col, dx, dz, kind, seed):
    """地面雜物：油桶、木箱、閥箱、小泵房、料堆、燈桿、撬裝設備、小棚、油漬坪。

    投彈高度只是「這塊地有人在用」；俯衝拉起的那兩秒才看得出是什麼。撐住
    近距離細節的是它，而它是全廠三角形花得最多的一項 —— 密度調在
    `CLUTTER_FILL`。
    """
    m = grime_mat(seed)
    steel = fixed_mat('LP_PlantSteel')
    h = cell_hash(int(dx), int(dz), seed)
    rz = snap_rz(h)
    c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))

    def at(lx, lz):
        """零件的局部偏移轉成相對座標。整件跟著 `rz` 轉，內部不各自歪"""
        return dx + lx * c + lz * s, dz - lx * s + lz * c

    if kind == 0:
        for k in range(3):
            a = 2.1 * k
            add_cyl(col, 'drum', grime_mat(seed + k), dx + math.cos(a) * 0.8,
                    -(dz + math.sin(a) * 0.8), 0.0, 0.55, 0.55, 1.3, 6)
        return 3
    if kind == 1:
        add_box(col, 'crate', m, dx, -dz, 0.7, 3.2, 2.4, 1.4, rz)
        px, pz = at(0.5, -0.4)
        # 疊上去的那一箱橫著擺 —— 仍然在格上，只是差 90 度
        add_box(col, 'crate', grime_mat(seed + 1), px, -pz, 1.85, 2.0, 1.6, 1.5, rz + 90)
        qx, qz = at(-2.4, 0.6)
        add_box(col, 'crate', grime_mat(seed + 2), qx, -qz, 0.55, 1.8, 1.8, 1.1, rz)
        return 3
    if kind == 2:
        add_box(col, 'valvebox', steel, dx, -dz, 0.6, 1.6, 1.2, 1.2, rz)
        return 1
    if kind == 3:
        add_box(col, 'pumphouse', m, dx, -dz, 1.5, 6.0, 4.5, 3.0, rz)
        add_box(col, 'pumphouse_roof', grime_mat(seed + 1), dx, -dz, 3.15,
                6.4, 4.9, 0.3, rz)
        return 2
    if kind == 4:
        add_cyl(col, 'pile', fixed_mat('LP_PlantCoal'), dx, -dz, 0.0, 3.2, 0.9, 2.4, 5)
        return 1
    if kind == 5:
        add_box(col, 'lamp', fixed_mat('LP_PlantPole'), dx, -dz, 4.0, 0.25, 0.25, 8.0)
        px, pz = at(0.6, 0.0)
        add_box(col, 'lamp_head', steel, px, -pz, 7.9, 1.6, 0.4, 0.3, rz)
        return 2
    if kind == 6:
        add_box(col, 'skid', steel, dx, -dz, 0.3, 5.0, 2.6, 0.6, rz)
        px, pz = at(0.8, 0.0)
        add_cyl(col, 'skid_drum', m, px, -pz, 0.6, 1.0, 1.0, 2.6, 6)
        return 2
    if kind == 7:
        add_box(col, 'shack', m, dx, -dz, 1.3, 4.0, 3.2, 2.6, rz)
        add_box(col, 'shack_roof', fixed_mat('LP_PlantRail'), dx, -dz, 2.75,
                4.6, 3.8, 0.3, rz)
        return 2
    # 【尺寸要塞得進散佈器的淨空】`scatter_clutter` 只問了半徑 6 m 的空地，
    # 而這一片是斜的 —— 9 × 7 轉 35° 的包圍盒半徑是 5.7 m。放大就會壓到
    # 卡車與可炸構件上，而俯視看起來只是「地上有塊油漬」
    return apron(col, dx, dz, 6 + (h & 0x3), 4 + ((h >> 4) & 0x3), rz, 'LP_PlantStain')


# ═══════════════════════════ 後處理填充器 ═══════════════════════════

GROUND_PIPE_REACH = 130.0


def _closest_on(dx, dz, ax, az, bx, bz):
    vx, vz = bx - ax, bz - az
    l2 = vx * vx + vz * vz
    t = 0.0 if l2 <= 0 else max(0.0, min(1.0, ((dx - ax) * vx + (dz - az) * vz) / l2))
    return ax + vx * t, az + vz * t


def weave_ground_pipes(col, seed):
    """把每一件設備接到最近的管廊 —— L 形，兩段。

    【這才是「管線複雜」的本體】散落的槽與塔各自站著、彼此沒有連結，那是
    模型的樣子；真的煉油廠每一顆槽都有管子接出去。順帶把格點打散：管線
    繞出來的線不照格子走。
    """
    if not col.racks:
        return 0
    n = 0
    for idx, (dx, dz, r) in enumerate(col.anchors):
        best, bd = None, 1e9
        for ax, az, bx, bz in col.racks:
            px, pz = _closest_on(dx, dz, ax, az, bx, bz)
            d = math.hypot(px - dx, pz - dz)
            if d < bd:
                bd, best = d, (px, pz)
        if best is None or bd > GROUND_PIPE_REACH or bd < r + 4:
            continue
        px, pz = best
        h = cell_hash(idx, 3, seed)
        # 兩種 L 形轉角，先試雜湊挑的那一種。第一段要長過設備半徑，否則管子
        # 會從槽的內部長出來
        options = [(px, dz), (dx, pz)] if (h & 1) == 0 else [(dx, pz), (px, dz)]
        for cx, cz in options:
            lead = math.hypot(cx - dx, cz - dz)
            if lead < r + 4:
                continue
            sx = dx + (cx - dx) / lead * r
            sz = dz + (cz - dz) / lead * r
            if not free_rect((sx + cx) / 2, (sz + cz) / 2,
                             abs(cx - sx) / 2 + 1, abs(cz - sz) / 2 + 1):
                continue
            if not free_rect((cx + px) / 2, (cz + pz) / 2,
                             abs(px - cx) / 2 + 1, abs(pz - cz) / 2 + 1):
                continue
            n += ground_pipe(col, sx, sz, cx, cz, seed + idx)
            n += ground_pipe(col, cx, cz, px, pz, seed + idx + 1)
            break
    return n


EQUIP_STEP = 25.0

# 每種街廓抽多少格。製程與公用區是「管廊之間全是設備」的地方
EQUIP_FILL = {
    'process': 0.52, 'utility': 0.52, 'halls': 0.24,
    'railyard': 0.16, 'tankFarm': 0.12, 'open': 0.0,
}


def place_equipment(col, dx, dz, h, seed):
    """一格中型設備。放不下就回 0 —— 尺寸是抽出來的，得先問空間夠不夠。

    【缺的一直是中型件】只有管廊與零星大件的話，街廓中間從投彈高度看下去
    是一片灰底加幾條線；真的製程區是管廊之間塞滿塔、槽、換熱器與加熱爐。
    地面的小雜物補不了這一層 —— 那個尺度在一公里外就消失了。
    """
    kind = (h >> 24) % 8

    def room(hw, hd):
        return free_rect(dx, dz, hw + 2, hd + 2) and not col.taken.hit(dx, dz, hw + 2, hd + 2)

    if kind == 0:
        r = 2.6 + ((h >> 4) & 0x7) * 0.5
        return upright_tank(col, dx, dz, r, 14 + ((h >> 7) & 0x7) * 2.6, seed) \
            if room(r, r) else 0
    if kind == 1:
        length = 13 + ((h >> 5) & 0x7) * 2.0
        return horiz_tank(col, dx, dz, 2.0 + ((h >> 9) & 0x3) * 0.6, length, snap_rz(h),
                          seed) if room(length / 2, length / 2) else 0
    if kind == 2:
        r = 3.6 + ((h >> 6) & 0x3) * 0.8
        return fan_stack(col, dx, dz, r, 6 + ((h >> 8) & 0x7), seed) if room(r, r) else 0
    if kind == 3:
        size = 10 + ((h >> 5) & 0x3) * 2.5
        return truss_tower(col, dx, dz, size, 2 + ((h >> 9) & 0x3), seed) \
            if room(size / 2, size / 2) else 0
    if kind == 4:
        rz = snap_rz(h)
        length = 12 + ((h >> 5) & 0x3) * 3
        if not room(length / 2, length / 2):
            return 0
        c, s = math.cos(math.radians(rz)), math.sin(math.radians(rz))
        n = 0
        for k in (-1, 0, 1):
            n += horiz_tank(col, dx + k * 4.0 * c, dz - k * 4.0 * s, 1.5, length, rz,
                            seed + k)
        return n
    if kind == 5:
        if not room(7.0, 5.5):
            return 0
        add_box(col, 'furnace', grime_mat(seed), dx, -dz, 4.0, 13.0, 10.0, 8.0)
        add_cyl(col, 'furnace_stack', grime_mat(seed + 1), dx + 4.5, -(dz + 3.0), 8.0,
                1.4, 1.1, 12.0, 6)
        col.claim(dx, dz, 7.0, 5.5, 8.0)
        col.anchor(dx, dz, 7.0)
        return 2
    if kind == 6:
        w = 22 + ((h >> 5) & 0x3) * 4
        d = 13 + ((h >> 9) & 0x3) * 2
        rz = 0.0 if (h & 0x100) == 0 else 90.0
        hw, hd = (w / 2, d / 2) if rz == 0.0 else (d / 2, w / 2)
        return sawtooth_hall(col, dx, dz, w, d, 6 + ((h >> 11) & 0x3), 2, rz, seed) \
            if room(hw, hd) else 0
    r = 5 + ((h >> 6) & 0x3) * 1.0
    return sphere_tank(col, dx, dz, r, seed) if room(r, r) else 0


def scatter_equipment(col, blk, seed):
    """中型設備的散佈：25 m 格點，避開已佔的地與禁區"""
    x0, z0, x1, z1 = inner(blk)
    n = 0
    ni = max(1, int((x1 - x0) // EQUIP_STEP))
    nj = max(1, int((z1 - z0) // EQUIP_STEP))
    ox = x0 + ((x1 - x0) - ni * EQUIP_STEP) / 2 + EQUIP_STEP / 2
    oz = z0 + ((z1 - z0) - nj * EQUIP_STEP) / 2 + EQUIP_STEP / 2
    gate = int(EQUIP_FILL[blk[4]] * 255)
    for j in range(nj):
        for i in range(ni):
            h = cell_hash(i, j, seed + 0x2c1)
            if (h & 0xFF) >= gate:
                continue
            dx = ox + i * EQUIP_STEP + (((h >> 8) & 0xFF) / 255 - 0.5) * EQUIP_STEP * 0.5
            dz = oz + j * EQUIP_STEP + (((h >> 16) & 0xFF) / 255 - 0.5) * EQUIP_STEP * 0.5
            n += place_equipment(col, dx, dz, h, seed * 13 + i * 5 + j)
    return n


CLUTTER_STEP = 16.0

# 每種街廓抽多少格。**留白街廓要低** —— 它的空是刻意的，護欄壓在 12% 覆蓋率
CLUTTER_FILL = {
    'process': 0.46, 'utility': 0.46, 'halls': 0.44,
    'railyard': 0.34, 'tankFarm': 0.28, 'open': 0.03,
}


def scatter_clutter(col, blk, seed):
    """地面雜物的散佈：16 m 格點，避開已佔的地與禁區。

    【要避開已佔的地】少了 `Builder.taken`，油桶會長在儲槽裡面、木箱會穿過
    廠房的牆 —— 那在俯視完全看不出來，貼地飛過去才會發現。
    """
    x0, z0, x1, z1 = inner(blk)
    n = 0
    ni = max(1, int((x1 - x0) // CLUTTER_STEP))
    nj = max(1, int((z1 - z0) // CLUTTER_STEP))
    ox = x0 + ((x1 - x0) - ni * CLUTTER_STEP) / 2 + CLUTTER_STEP / 2
    oz = z0 + ((z1 - z0) - nj * CLUTTER_STEP) / 2 + CLUTTER_STEP / 2
    gate = int(CLUTTER_FILL[blk[4]] * 255)
    for j in range(nj):
        for i in range(ni):
            h = cell_hash(i, j, seed + 0x5b)
            if (h & 0xFF) >= gate:
                continue
            dx = ox + i * CLUTTER_STEP + (((h >> 8) & 0xFF) / 255 - 0.5) * CLUTTER_STEP * 0.7
            dz = oz + j * CLUTTER_STEP + (((h >> 16) & 0xFF) / 255 - 0.5) * CLUTTER_STEP * 0.7
            # 【淨空要蓋得住最大的那一件】斜擺的油漬坪包圍盒半徑 5.7 m
            if not free(dx, dz, 6) or col.taken.hit(dx, dz, 5.5, 5.5):
                continue
            kind = (h >> 24) % CLUTTER_KINDS
            n += clutter(col, dx, dz, kind, seed * 17 + i * 7 + j)
            col.claim(dx, dz, 4.0, 4.0, 2.0)
    return n


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


# 街廓內管廊的三個高度層。同一個街廓裡的管廊分層走，俯視才看得到交錯
BLOCK_TIERS = [6.0, 10.0, 14.5]


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
                n += pipe_bridge(col, s[0], s[1], s[2], s[3],
                                 BLOCK_TIERS[j % len(BLOCK_TIERS)] + rnd(), 3,
                                 b[5] * 31 + seq)
                seq += 1
    crosses = 1 + int(rnd() * 2)
    for k in range(crosses):
        u = f.along * ((k + 0.5) / crosses + (rnd() - 0.5) * 0.14)
        p0, p1 = f.at(u, 2), f.at(u, f.across - 2)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], BLOCK_TIERS[-1] + 3 + rnd() * 2,
                             4, b[5] * 31 + seq)
            seq += 1
    return n


def fill_process(col, b):
    """氫化製程區：層層平行的管廊，中間插桁架塔與成排的細高塔柱"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    lanes = 6 + int(rnd() * 4)
    for k in range(lanes):
        v = f.across * ((k + 0.5) / lanes + (rnd() - 0.5) * 0.07)
        pipes = 3 + int(rnd() * 3)
        p0, p1 = f.at(0, v), f.at(f.along, v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], pipes):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3],
                             BLOCK_TIERS[k % len(BLOCK_TIERS)] + rnd() * 1.4, pipes,
                             b[5] * 31 + seq)
            seq += 1
    # 橫過主軸的短管廊。同一個方向的平行線再多也只是一組百葉窗 —— 交錯才有
    # 立體的層次，而扁平化之後這幾條幾乎不花錢
    crosses = 2 + int(rnd() * 3)
    for k in range(crosses):
        u = f.along * ((k + 0.5) / crosses + (rnd() - 0.5) * 0.12)
        p0, p1 = f.at(u, 0), f.at(u, f.across)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 3):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], BLOCK_TIERS[-1] + 2 + rnd() * 2,
                             3, b[5] * 31 + seq)
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
        # 廠房邊的裝卸坪：廠房區的地最空，而一排廠房中間本來就是進出貨的地方
        av = v + span * 0.5 + gap * 0.3
        px, pz = f.at(u, av)
        aw = length * 0.85 if f.along_x else gap * 0.5
        ad = gap * 0.5 if f.along_x else length * 0.85
        if free_rect(px, pz, aw / 2, ad / 2) and not col.taken.hit(px, pz, aw / 2, ad / 2):
            n += apron(col, px, pz, aw, ad, 0.0, 'LP_PlantSlab')
    for t in range(2):
        v = span + gap / 2 + t * (span + gap)
        p0, p1 = f.at(0, v), f.at(f.along, v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], 12 + t * 4 + rnd() * 3, 3,
                             b[5] * 31 + seq)
            seq += 1
    return n


def fill_railyard(col, b):
    """調車場：兩組平行股道、成串的車廂、龍門吊、堆料與卸料月台。

    【股道要多】三條軌道與十條軌道在投彈高度是兩種東西 —— 平行線是調車場
    唯一的識別特徵，而一條軌道只要 12 個三角形，多鋪幾條幾乎不花錢。
    """
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, rnd() < 0.5)
    n, seq = 0, 0
    groups = []
    base = 0.06 + rnd() * 0.08
    for g in range(2):
        tracks = 4 + int(rnd() * 5)
        pitch = 7 + rnd() * 2.5
        v0 = f.across * (base + g * (0.42 + rnd() * 0.12))
        if v0 + pitch * (tracks - 1) > f.across - 20:
            continue
        groups.append((v0, tracks, pitch))
        for k in range(tracks):
            v = v0 + k * pitch
            p0 = f.at(f.along * rnd() * 0.1, v)
            p1 = f.at(f.along * (1 - rnd() * 0.14), v)
            for s in spans(p0[0], p0[1], p1[0], p1[1], 3):
                n += rail_track(col, s[0], s[1], s[2], s[3])
                length = math.hypot(s[2] - s[0], s[3] - s[1])
                step = 14 + rnd() * 4
                cars = int(length / step)
                for c in range(cars):
                    h = cell_hash(c, k * 7 + g, b[5] + 5)
                    if (h & 0xFF) < 40:
                        continue
                    t = (c + 0.5) / cars
                    dx = s[0] + (s[2] - s[0]) * t
                    dz = s[1] + (s[3] - s[1]) * t
                    if not free(dx, dz, 8):
                        continue
                    n += rail_car(col, dx, dz, f.rz, ((h >> 8) & 1) == 0, b[5] * 31 + seq)
                    seq += 1
    # 龍門吊跨在其中一組股道上
    if groups:
        v0, tracks, pitch = groups[int(rnd() * len(groups)) % len(groups)]
        span = pitch * (tracks - 1) + 12
        gx, gz = f.at(f.along * (0.25 + rnd() * 0.5), v0 + pitch * (tracks - 1) / 2)
        if free_rect(gx, gz, span / 2, span / 2):
            n += gantry(col, gx, gz, span, 14 + rnd() * 4, f.hall_rz, b[5] * 31 + seq)
            seq += 1
    # 卸料月台：兩條，各自貼著一組股道的外側
    for g, (v0, tracks, pitch) in enumerate(groups):
        pv = v0 - 9 if g == 0 else v0 + pitch * (tracks - 1) + 9
        q0, q1 = f.at(f.along * 0.08, pv), f.at(f.along * 0.92, pv)
        for s in spans(q0[0], q0[1], q1[0], q1[1], 6):
            length = math.hypot(s[2] - s[0], s[3] - s[1])
            add_box(col, 'platform', fixed_mat('LP_PlantPlatform'), (s[0] + s[2]) / 2,
                    -(s[1] + s[3]) / 2, 0.6, length, 9.0, 1.2, f.hall_rz)
            col.claim((s[0] + s[2]) / 2, (s[1] + s[3]) / 2,
                      abs(s[2] - s[0]) / 2 + 5, abs(s[3] - s[1]) / 2 + 5, 1.2)
            n += 1
    # 卸料棚
    for k in range(1 + int(rnd() * 2)):
        dx, dz = f.at(f.along * (0.1 + rnd() * 0.7), f.across * (0.86 + rnd() * 0.08))
        hu = f.along * (0.08 + rnd() * 0.06)
        hv = f.across * 0.055
        hw = hu if f.along_x else hv
        hd = hv if f.along_x else hu
        if not free_rect(dx, dz, hw, hd):
            continue
        n += sawtooth_hall(col, dx, dz, hu * 2, hv * 2, 8, 3, f.hall_rz, b[5] * 31 + seq)
        seq += 1
    # 堆料場：長條的煤堆與礦堆，填掉股道以外的空地
    for k in range(3 + int(rnd() * 3)):
        length = f.along * (0.1 + rnd() * 0.1)
        pu = f.along * (0.08 + rnd() * 0.8)
        pv = f.across * (0.78 + rnd() * 0.16)
        dx, dz = f.at(pu, pv)
        hu, hv = length / 2, 9.0
        hw = hu if f.along_x else hv
        hd = hv if f.along_x else hu
        if not free_rect(dx, dz, hw, hd) or col.taken.hit(dx, dz, hw, hd):
            continue
        ph = 3 + rnd() * 2.5
        add_box(col, 'stockpile', fixed_mat('LP_PlantCoal'), dx, -dz, ph / 2,
                hw * 2, hd * 2, ph, 0.0)
        col.claim(dx, dz, hw, hd, ph)
        n += 1
    # 跨過整片股道的高架管廊 —— 煉油廠的調車場上頭一定有管線經過
    for k in range(1 + int(rnd() * 2)):
        u = f.along * (0.2 + rnd() * 0.6)
        p0, p1 = f.at(u, 0), f.at(u, f.across)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 3):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], 17 + rnd() * 3, 3,
                             b[5] * 31 + seq)
            seq += 1
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
        col.claim(sx, sz, 19, 19, 9.0)
    for k in range(1 + int(rnd() * 2)):
        length = f.along * (0.14 + rnd() * 0.1)
        dx, dz = f.at(f.along * (0.12 + rnd() * 0.7), f.across * lanes[3])
        hu, hv = length / 2, 11.0
        if not free_rect(dx, dz, hu if f.along_x else hv, hv if f.along_x else hu):
            continue
        ph = 3 + rnd() * 2
        add_box(col, 'coal', fixed_mat('LP_PlantCoal'), dx, -dz, ph / 2, length, 22.0, ph,
                f.hall_rz)
        col.claim(dx, dz, hu if f.along_x else hv, hv if f.along_x else hu, ph)
        n += 1
    bridges = 5 + int(rnd() * 3)
    for k in range(bridges):
        v = f.across * ((k + 0.5) / bridges + (rnd() - 0.5) * 0.08)
        p0, p1 = f.at(0, v), f.at(f.along, v)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 4):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3],
                             BLOCK_TIERS[k % len(BLOCK_TIERS)] + rnd() * 1.4, 3,
                             b[5] * 31 + seq)
            seq += 1
    crosses = 2 + int(rnd() * 2)
    for k in range(crosses):
        u = f.along * ((k + 0.5) / crosses + (rnd() - 0.5) * 0.12)
        p0, p1 = f.at(u, 0), f.at(u, f.across)
        for s in spans(p0[0], p0[1], p1[0], p1[1], 3):
            n += pipe_bridge(col, s[0], s[1], s[2], s[3], BLOCK_TIERS[-1] + 2 + rnd() * 2,
                             3, b[5] * 31 + seq)
            seq += 1
    return n


def fill_open(col, b):
    """留白：堆料場與零星的小屋。**這是刻意的空**，不是還沒做完"""
    x0, z0, x1, z1 = inner(b)
    rnd = Rand(b[5])
    f = Frame(x0, z0, x1, z1, True)
    n, seq = 0, 0
    # 【高空管廊不穿過留白】頭上壓著四層管廊的地，從投彈高度看就不是留白了 ——
    # 俯視覆蓋率量得到這件事，而站在地上看不出來
    TALL.add((b[0] + b[2]) / 2, (b[1] + b[3]) / 2,
             (b[2] - b[0]) / 2, (b[3] - b[1]) / 2, 60.0)
    for k in range(3):
        dx, dz = f.at(f.along * (0.18 + 0.3 * k), f.across * (0.3 if k % 2 == 0 else 0.7))
        if not free(dx, dz, 16):
            continue
        if k == 1:
            add_box(col, 'shed', grime_mat(b[5] + k), dx, -dz, 1.6, 14.0, 9.0, 3.2)
            n += 1
        else:
            n += horiz_tank(col, dx, dz, 3, 16, k * SNAP_STEP, b[5] * 31 + seq)
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
            for s in sky_spans(xs[i], zs[j], xs[ni], zs[nj], pipes, h):
                n += pipe_bridge(b, s[0], s[1], s[2], s[3], h, pipes, 900 + t * 10 + k)
            i, j = ni, nj
            if rnd() < 0.62:
                horizontal = not horizontal
    return n


SKY_TIERS = [8.0, 12.5, 17.0, 21.5]
SKY_MIN_RUN = 70.0


def sky_spans(ax, az, bx, bz, hw, h):
    """一條高空管廊扣掉禁區、以及比它高的東西之後剩下的子段。

    【一定要扣掉高的東西】一條 2.5 km 的管廊會從十幾座廠房的屋頂與儲槽頂
    穿過去 —— 那在投彈高度就是一條線壓過一片屋頂，看起來像模型破圖。
    """
    out = []
    length = math.hypot(bx - ax, bz - az)
    steps = max(2, int(math.ceil(length / 6)))
    start = -1.0
    for i in range(steps + 1):
        t = i / steps
        x = ax + (bx - ax) * t
        z = az + (bz - az) * t
        ok = free(x, z, hw) and not TALL.hit(x, z, hw, hw, h - 1.5)
        if ok and start < 0:
            start = t
        if (not ok or i == steps) and start >= 0:
            end = t if ok else (i - 1) / steps
            if (end - start) * length >= SKY_MIN_RUN:
                out.append((ax + (bx - ax) * start, az + (bz - az) * start,
                            ax + (bx - ax) * end, az + (bz - az) * end))
            start = -1.0
    return out


def build_skyways(b):
    """高空管廊網：四個高度層長跑全廠，彼此穿越，也穿越街廓的邊界。

    【要在所有街廓建完之後才鋪】它靠 `TALL` 繞開廠房屋頂與儲槽頂，而那一份
    是街廓建的時候登記的。

    【交錯是重點】同一層都是平行線，那只是一組百葉窗；四層各自轉向、高度差
    四公尺，從投彈高度看下去才是一張立體的網 —— 煉油廠俯視最好認的特徵。
    扁平化之後一公尺只要 0.6 個三角形，所以可以鋪到幾十公里。
    """
    n = 0
    rnd = Rand(0x2f6a1b93)
    for t, base in enumerate(SKY_TIERS):
        horizontal = t % 2 == 0
        count = 6 + int(rnd() * 3) if horizontal else 8 + int(rnd() * 4)
        for k in range(count):
            pipes = 3 + int(rnd() * 4)
            hw = (pipes * 1.4 + 1) / 2 + 1
            h = base + (rnd() - 0.5) * 2.0
            if horizontal:
                z = -PAD_HALF_Z + 50 + (PAD_HALF_Z * 2 - 100) * (
                    (k + 0.5) / count + (rnd() - 0.5) * 0.07)
                seg = (-PAD_HALF_X + 25 + rnd() * 420, z, PAD_HALF_X - 25 - rnd() * 420, z)
            else:
                x = -PAD_HALF_X + 50 + (PAD_HALF_X * 2 - 100) * (
                    (k + 0.5) / count + (rnd() - 0.5) * 0.05)
                seg = (x, -PAD_HALF_Z + 25 + rnd() * 210, x, PAD_HALF_Z - 25 - rnd() * 210)
            for s in sky_spans(seg[0], seg[1], seg[2], seg[3], hw, h):
                n += pipe_bridge(b, s[0], s[1], s[2], s[3], h, pipes,
                                 1200 + t * 40 + k)
    return n


WALL_SEG = 60.0
WALL_RUN = 3
WALL_PUSH = 140.0
WALL_DROP = 0.34
WALL_CORNER = 460.0


def _wall_run(i, salt):
    """一段牆在不在、往外推多少。**每 `WALL_RUN` 段共用一組值** —— 逐段各抽
    一個是雜訊，成組才會是折來折去的階梯線。

    【只往外推不往內縮】往內會切過街廓裡的設備，而避讓表只認可炸構件、卡車
    與道路 —— 牆穿過一排儲槽不會有任何一條護欄變紅。
    """
    h = cell_hash(i // WALL_RUN, salt, 0x5715)
    return (h & 0xFF) >= int(WALL_DROP * 255), (((h >> 8) & 0xFF) / 255) * WALL_PUSH


def build_wall(b):
    """圍牆：沿墊面四周，道路穿過的地方留門，四個角不接起來。

    【一條 3 km 的直線是畫面上最刺眼的東西】牆只有 2.5 m 高，但在投彈高度
    它是唯一一條貫穿全圖的直線，把廠區框回一個矩形。所以成組往外推、丟掉
    三分之一、四個角各留一段不建。

    【每一段都走避讓，不是只避連外的門】廠內那三條道路的端點也在墊面邊上 ——
    只避連外門的話，牆會橫在廠內道路的出口上，而那一段在畫面上只是「圍牆」，
    要靠護欄才看得出它壓在路上。
    """
    n = 0
    m = fixed_mat('LP_PlantWall')
    gate = 34.0
    # 連外的兩座門：南門在 z = +750 的 x = 500、西門在 x = −1500 的 z = 0。
    # 【只比沿邊的那一個座標】牆會往外推，拿兩點距離比會讓門被推出去的那一段補上
    h_gates = {1: (500.0,)}
    v_gates = {-1: (0.0,)}
    half = (WALL_SEG - 0.5) / 2

    def corner_skip(along, span, salt):
        """離兩端多近就不建。四個角的長度不一樣，否則切完仍然是對稱的"""
        for end in (-span, span):
            cut = WALL_CORNER * (0.55 + ((cell_hash(int(end), salt, 0x3f1) >> 11) & 0xF) / 15)
            if abs(along - end) < cut:
                return True
        return False

    i = 0
    x = -PAD_HALF_X + WALL_SEG / 2
    while x < PAD_HALF_X:
        for sz in (-1, 1):
            keep, push = _wall_run(i, 17 + sz)
            if not keep or corner_skip(x, PAD_HALF_X, 5 + sz):
                continue
            if any(abs(gx - x) < gate for gx in h_gates.get(sz, ())):
                continue
            z = sz * (PAD_HALF_Z + push)
            if not free_rect(x, z, half, 0.4):
                continue
            add_box(b, 'wall', m, x, -z, 1.25, WALL_SEG - 0.5, 0.4, 2.5)
            n += 1
        i += 1
        x += WALL_SEG
    j = 0
    z = -PAD_HALF_Z + WALL_SEG / 2
    while z < PAD_HALF_Z:
        for sx in (-1, 1):
            keep, push = _wall_run(j, 41 + sx)
            if not keep or corner_skip(z, PAD_HALF_Z, 29 + sx):
                continue
            if any(abs(gz - z) < gate for gz in v_gates.get(sx, ())):
                continue
            x = sx * (PAD_HALF_X + push)
            if not free_rect(x, z, 0.4, half):
                continue
            add_box(b, 'wall', m, x, -z, 1.25, 0.4, WALL_SEG - 0.5, 2.5)
            n += 1
        j += 1
        z += WALL_SEG
    return n


def build_satellites(b):
    """牆外的衛星設施：變電所、加壓站、倉庫、鐵路側線、堆料場、卡車場。

    【廠區不能只有一個盒子】主廠區是一塊被牆圍起來的方塊，牆外一片田 ——
    從投彈高度看下去那條界線是整幅畫面最刺眼的東西。真的合成油廠周邊本來
    就散著這些附屬設施，它們讓「人造的地」不只有一塊。

    地面的鋪面由著色器畫（`LEUNA_SITE.outposts`），這裡只建上面的東西。
    """
    n = 0
    steel = fixed_mat('LP_PlantSteel')
    for k, (dx, dz, w, d, kind) in enumerate(SATELLITES):
        rnd = Rand(0x9e3d51 + k * 7919)
        hw, hd = w / 2 - 12, d / 2 - 12
        if kind == 'substation':
            for i in range(5):
                for j in range(3):
                    add_box(b, 'switch_post', steel, dx - hw + 10 + i * 22,
                            -(dz - hd + 12 + j * 22), 4.5, 0.6, 0.6, 9.0)
                    n += 1
            for j in range(3):
                add_box(b, 'switch_beam', steel, dx, -(dz - hd + 12 + j * 22), 8.6,
                        hw * 1.8, 0.5, 0.5)
                n += 1
            n += sawtooth_hall(b, dx + hw * 0.55, dz + hd * 0.55, 34, 18, 7, 2, 0.0, k)
        elif kind == 'pump':
            for i in range(3):
                n += upright_tank(b, dx - hw + 18 + i * 26, dz - hd + 20,
                                  7 + rnd() * 2, 12 + rnd() * 6, k * 31 + i)
            n += clutter(b, dx, dz + hd * 0.5, 3, k * 17)
            n += pipe_bridge(b, dx - hw, dz + hd * 0.5, dx + hw, dz + hd * 0.5, 7, 3, k)
        elif kind == 'warehouse':
            for i in range(3):
                n += sawtooth_hall(b, dx - hw + 24 + i * 46, dz, 38, d * 0.66,
                                   8 + rnd() * 3, 3, 0.0, k * 31 + i)
        elif kind == 'siding':
            for j in range(2):
                z = dz - hd * 0.5 + j * hd
                n += rail_track(b, dx - hw, z, dx + hw, z)
                for i in range(6):
                    if (cell_hash(i, j, k) & 0xFF) < 70:
                        continue
                    n += rail_car(b, dx - hw + 16 + i * 26, z, 90.0,
                                  (cell_hash(i, j, k + 3) & 1) == 0, k * 31 + i)
            add_box(b, 'platform', fixed_mat('LP_PlantPlatform'), dx, -dz, 0.6,
                    hw * 1.9, 8.0, 1.2)
            n += 1
        elif kind == 'stockpile':
            for i in range(3):
                ph = 3.5 + rnd() * 2
                add_box(b, 'stockpile', fixed_mat('LP_PlantCoal'),
                        dx - hw + 26 + i * 32, -dz, ph / 2, 24.0, hd * 1.6, ph)
                n += 1
            n += clutter(b, dx + hw * 0.8, dz - hd * 0.7, 7, k * 17)
        else:
            for j in range(3):
                for i in range(6):
                    if (cell_hash(i, j, k + 11) & 0xFF) < 60:
                        continue
                    add_box(b, 'truck', grime_mat(k * 31 + i * 3 + j),
                            dx - hw + 8 + i * 17, -(dz - hd + 14 + j * 26), 1.6,
                            3.0, 7.0, 3.2)
                    n += 1
            n += sawtooth_hall(b, dx, dz + hd * 0.8, w * 0.5, 16, 6, 2, 0.0, k)
        for i in range(3):
            cx = dx + (rnd() - 0.5) * w * 0.8
            cz = dz + (rnd() - 0.5) * d * 0.8
            n += clutter(b, cx, cz, int(rnd() * CLUTTER_KINDS), k * 97 + i)
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
    TALL.cells.clear()
    root = get_col('Plant')
    total = 0
    for blk in BLOCKS:
        b = Builder()
        total += FILLERS[blk[4]](b, blk)
        total += scatter_equipment(b, blk, blk[5])
        total += weave_ground_pipes(b, blk[5])
        total += scatter_clutter(b, blk, blk[5])
        b.to_object('Plant_%s_%d' % (blk[4], blk[5]), root)

    tb = Builder()
    total += build_trunks(tb)
    tb.to_object('Plant_trunks', root)

    # 高空管廊網要在所有街廓之後 —— 它靠街廓登記的 `TALL` 繞開屋頂與槽頂
    yb = Builder()
    total += build_skyways(yb)
    yb.to_object('Plant_skyways', root)

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

    stb = Builder()
    total += build_satellites(stb)
    stb.to_object('Plant_satellites', root)

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
    n += scatter_equipment(b, blk, blk[5])
    n += weave_ground_pipes(b, blk[5])
    n += scatter_clutter(b, blk, blk[5])
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

