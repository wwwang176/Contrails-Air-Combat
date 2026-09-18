"""
比對低模與正式模型的**剪影**。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/check_lod_silhouette.py -- b17g

從六個方位各拍一張剪影（全白物件、黑背景、正交投影），逐像素比對 LOD0 與
LOD2 的覆蓋，印出差異像素數與比例。

【為什麼用正交投影而不是透視】要控制的是「這架飛機在畫面上佔幾個像素」，
而不是「相機擺多遠」。正交投影下畫幅寬度就是機體尺寸，解析度直接等於
「橫跨幾個像素」—— 32 px 那一列就是它在 1,900 m 外的樣子。

【為什麼用 Workbench 的單色平光】要比的是**覆蓋範圍**，不是明暗。有光照的話
減面造成的法線變化會讓亮度到處都差一點，比出來的數字就不是輪廓的差異。

【判準】差異像素數。0 表示逐像素相同；個位數表示只有邊緣抗鋸齒的差別。
"""
import bpy
import os
import sys
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'models-src')
OUT = os.path.join(REPO, '.shots', 'lod')

# 【橫跨幾個像素】25 px 是波爾塔瓦投彈高度實測的樣子；128 是遠比實際嚴格的
# 對照組 —— 那個尺度看得出來、25 px 看不出來的話，門檻就落在中間
SUFFIX = __import__('os').environ.get('LOD_SUFFIX', '_lod2')
SIZES = (25, 64, 128, 256)

# 六個方位：側、頂、前、後，加兩個四分之三
VIEWS = (
    ('側', (1.0, 0.0, 0.0)),
    ('頂', (0.0, 1.0, 0.0)),
    ('前', (0.0, 0.0, 1.0)),
    ('後', (0.0, 0.0, -1.0)),
    ('四三上', (0.7, 0.5, 0.5)),
    ('四三下', (0.7, -0.35, 0.6)),
)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(ident: str):
    path = os.path.join(MODELS, ident + '.glb')
    if not os.path.exists(path):
        raise SystemExit('找不到 ' + path)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o.type == 'MESH']


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for k in range(3):
                lo[k] = min(lo[k], w[k])
                hi[k] = max(hi[k], w[k])
    return lo, hi


def setup_render(px: int):
    s = bpy.context.scene
    s.render.engine = 'BLENDER_WORKBENCH'
    s.display.shading.light = 'FLAT'
    s.display.shading.color_type = 'SINGLE'
    s.display.shading.single_color = (1.0, 1.0, 1.0)
    s.render.film_transparent = True
    s.render.resolution_x = px
    s.render.resolution_y = px
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    # 【關掉抗鋸齒】要比的是覆蓋，不是邊緣的灰階。開著的話同一個輪廓在兩份
    # 之間也會因為三角形切法不同而在邊緣差幾階，那不是輪廓的差異
    s.display.render_aa = 'OFF'


def shoot(frame, direction, px: int, path: str):
    """
    `frame` 是 `(中心, 畫幅)`。

    【兩份一定要吃同一個框】各自算自己的包圍盒的話，減面後包圍盒差幾公分，
    相機的位置與 `ortho_scale` 就都不一樣 —— 量到的是「兩張不同縮放的圖有多
    不像」，實測會得到七成的差異，看起來像減面把飛機毀了。
    """
    centre, size = frame
    cam_data = bpy.data.cameras.new('LODCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = size
    cam = bpy.data.objects.new('LODCam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = Vector(direction).normalized()
    cam.location = centre + d * (size * 3.0)
    # 朝向物體中心
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (-d).to_track_quat('-Z', 'Y')
    bpy.context.scene.camera = cam
    setup_render(px)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def coverage(path: str):
    img = bpy.data.images.load(path)
    px = list(img.pixels)
    bpy.data.images.remove(img)
    # RGBA；alpha > 0.5 就算被蓋到（背景是透明的）
    return [1 if px[i + 3] > 0.5 else 0 for i in range(0, len(px), 4)]


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ident = argv[0] if argv else 'b17g'
    os.makedirs(OUT, exist_ok=True)

    # 【框由正式模型決定，兩份共用】見 `shoot` 的說明
    clear()
    lo, hi = bounds(load(ident))
    frame = ((lo + hi) * 0.5,
             max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.05)

    print('==== %s：LOD0 與 LOD2 的剪影比對 ====' % ident)
    print('  像素  ' + '  '.join('%6s' % n for n, _ in VIEWS) + '     合計')
    for px in SIZES:
        diffs = []
        total = 0
        for name, d in VIEWS:
            a = os.path.join(OUT, '%s-%s-%d-0.png' % (ident, name, px))
            b = os.path.join(OUT, '%s-%s-%d-2.png' % (ident, name, px))
            clear()
            load(ident)
            shoot(frame, d, px, a)
            clear()
            load(ident + SUFFIX)
            shoot(frame, d, px, b)
            ca = coverage(a)
            cb = coverage(b)
            n = sum(1 for i in range(len(ca)) if ca[i] != cb[i])
            diffs.append(n)
            total += sum(ca)
        print('  %4d  ' % px + '  '.join('%6d' % n for n in diffs)
              + '     %d 個差異 / %d 個覆蓋（%.2f%%）'
              % (sum(diffs), total, 100.0 * sum(diffs) / max(1, total)))


main()
