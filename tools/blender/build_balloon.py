# -*- coding: utf-8 -*-
"""
低空防空氣球（英美通用的 LZ 型）：充氣的雪茄形氣囊、艉部三片充氣尾翼、腹部
一束吊索收到一點，再往下接繫留鋼索。

用法（Blender 5.x）：
    exec(open(r'tools/blender/build_balloon.py', encoding='utf-8').read())
工具函式、`mk` 與集合來自 `build_ground.py`，還沒載入的話這支自己先執行它。
建完 `LOG_BALLOON` 裡有三角形數與尺寸；`export_balloon()` 匯出
models-src/balloon.glb。

座標：Blender 系 X 橫向、**+Y 艇首**、Z 上。**原點在吊索的匯集點** —— 繫留
鋼索不在模型裡，遊戲每幀從錨點畫到這一點（`render/balloons.ts`），跟著飄晃變斜。

── 尺寸 ────────────────────────────────────────────────────────
沒有參考模型，照史實：氣囊長 19 m、最大直徑 7.6 m（62 × 25 ft）。外型照
負責人給的圖：艇首鈍圓、最粗處在前三分之一、往艉收細；三片尾翼相隔 120°，
一片朝上、兩片朝斜下；八條吊索由腹部前後兩排收到氣囊下方一點。

【顏色就是 GLB 的顏色】材質填真的顏色（`srgb`），與船同一個做法。
"""
import bpy, bmesh, math, os
from mathutils import Vector

REPO = globals().get('REPO_ROOT', r"C:\Users\weiwe\orca\workspaces\grok-aircraft2\jp-m2")
OUT_DIR_BALLOON = os.path.join(REPO, "models-src")
LOG_BALLOON = {}
if 'mk' not in globals():
    exec(open(os.path.join(REPO, 'tools', 'blender', 'build_ground.py'), encoding='utf-8').read(), globals())


def srgb(h):
    r, g, b = ((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))


def rod(p0, p1, r, seg=3):
    """兩點之間的細圓柱。鋼索用三邊就夠 —— 遠處只是一條線。"""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = d.normalized().to_track_quat('Z', 'Y')
    v, f = cyl(0, 0, d.length / 2, r, d.length, axis='Z', seg=seg)
    return [tuple(p0 + q @ Vector(p)) for p in v], f


M_SKIN = mat('BLN_Skin', srgb(0xc4c2b4))     # 塗鋁粉的氣囊布
M_WIRE = mat('BLN_Wire', srgb(0x5a5648))     # 鋼索

C = fresh('BALLOON')
for _m in [m for m in bpy.data.meshes if m.users == 0 and m.name.startswith('BLN_')]:
    bpy.data.meshes.remove(_m)

LENGTH = 19.0
RADIUS = 3.8
# 氣囊中心線的高度（在吊索匯集點之上）與前後位置：艇首 y +9.5、艇尾 −9.5
BODY_Z = 9.5
SEG = 12

# 縱剖面：(離艇首的比例, 半徑比例)。艇首鈍圓、前三分之一最粗、艇尾收成一個小圓
PROFILE = [
    (0.00, 0.28), (0.025, 0.60), (0.07, 0.82), (0.15, 0.95), (0.30, 1.00),
    (0.45, 0.98), (0.60, 0.88), (0.75, 0.70), (0.88, 0.47), (1.00, 0.20),
]


def body_y(t):
    return LENGTH / 2 - t * LENGTH


def radius_at(y):
    t = (LENGTH / 2 - y) / LENGTH
    for (t0, r0), (t1, r1) in zip(PROFILE, PROFILE[1:]):
        if t <= t1:
            return RADIUS * (r0 + (r1 - r0) * (t - t0) / (t1 - t0))
    return RADIUS * PROFILE[-1][1]


def ring(r):
    return [(r * math.cos(2 * math.pi * i / SEG), BODY_Z + r * math.sin(2 * math.pi * i / SEG)) for i in range(SEG)]


mk('BLN_Envelope', *loft([(body_y(t), ring(RADIUS * k)) for (t, k) in PROFILE]), C, M_SKIN)

# ── 尾翼：一片充氣的槳形，根部埋進氣囊。外形是俯視翼面上的凸多邊形
# (沿機身 y, 離中心線 u)，厚 FIN_T
FIN_T = 0.9
FIN_OUTLINE = [(-3.6, 2.4), (-6.2, 4.9), (-7.6, 5.9), (-9.3, 6.2), (-10.6, 5.6),
               (-11.0, 4.2), (-10.6, 1.0), (-7.0, 1.6)]


def fin(angle_deg):
    a = math.radians(angle_deg)
    d = Vector((math.cos(a), 0, math.sin(a)))       # 往外
    n = Vector((-math.sin(a), 0, math.cos(a)))      # 翼面法線
    c = Vector((0, 0, BODY_Z))
    v = []
    for s in (1, -1):
        for (y, u) in FIN_OUTLINE:
            p = c + Vector((0, y, 0)) + d * u + n * (s * FIN_T / 2)
            v.append(tuple(p))
    k = len(FIN_OUTLINE)
    f = [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))]
    for i in range(k):
        j = (i + 1) % k
        f.append((i, j, k + j, k + i))
    return v, f


for tag, ang in (('Top', 90.0), ('L', 210.0), ('R', 330.0)):
    mk('BLN_Fin_' + tag, *fin(ang), C, M_SKIN)

# ── 吊索：腹部前後兩排、每排左右各兩條，共八條，收到原點 ──
WIRE_R = 0.04
for k, y in enumerate((5.5, 2.0, -1.5, -5.0)):
    r = radius_at(y)
    for s, tag in ((-1, 'L'), (1, 'R')):
        a = math.radians(-90 + s * 28)
        p = (r * math.cos(a), y, BODY_Z + r * math.sin(a))
        mk('BLN_Rig_%s%d' % (tag, k), *rod((0, 0, 0), p, WIRE_R, seg=3), C, M_WIRE)

# ═══════════════════════════ 收尾與量測 ═══════════════════════════
LAYOUT_X_BALLOON = 125.0
objs = list(C.objects)
for ob in objs:
    ob.data.validate()
    ob.location.x = 0.0
bpy.context.view_layer.update()
lo, hi = col_bounds(objs)
LOG_BALLOON = {
    'parts': len(objs),
    'tris': sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs),
    'size_xyz': [round(hi[i] - lo[i], 3) for i in range(3)],
    'bounds': [[round(v, 2) for v in lo], [round(v, 2) for v in hi]],
}
for ob in objs:
    ob.location.x = LAYOUT_X_BALLOON


def export_balloon():
    """匯出 balloon.glb。排開看用的位移歸零再匯，理由與 `export_all` 相同。"""
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    objs = list(bpy.data.collections['LP_BALLOON'].objects)
    for o in objs:
        o.location.x = 0.0
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    with bpy.context.temp_override(window=win, area=area, region=region):
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        path = os.path.join(OUT_DIR_BALLOON, 'balloon.glb')
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True,
            export_yup=True, export_extras=True, export_apply=True,
            export_normals=False, export_texcoords=False,
        )
    for o in objs:
        o.location.x = LAYOUT_X_BALLOON
    return {'path': path, 'bytes': os.path.getsize(path)}


result = LOG_BALLOON
