"""
從 GLB 拍出九台的**側面剪影**，給選單的機種徽章用。

    "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P tools/blender/render_silhouettes.py

輸出 `.shots/sil/raw/<id>.png`（全白物件、透明背景、正交側視），再交給
`tools/compose_silhouettes.py` 裁切、縮放、排進固定畫布。

【為什麼用正交投影】徽章要的是輪廓的比例，透視會讓近端的翼根脹大，同一台
飛機換個相機距離就變一個形狀。

【為什麼用 Workbench 單色平光】要的是覆蓋範圍，明暗到最後都會被丟掉 ——
合成那一步只讀 alpha。

【機鼻朝左】相機擺在 -X 往 +X 看、上方對 +Z，機頭就落在畫面左邊 ——
識別卡的慣例。要改成朝右就把 `VIEW_DIR` 反號。

【螺旋槳不入鏡】槳葉側視是機鼻前一條細線，縮到 64 px 只剩一根雜訊。整流罩
（Spinner）留著，機鼻的尖端是認機型的線索。
"""
import bpy
import os
import sys
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(REPO, 'models-src')
OUT = os.path.join(REPO, '.shots', 'sil', 'raw')

AIRCRAFT = ('p51d', 'f4f4', 'f6f5', 'b17g', 'bf109k4', 'he111', 'a6m5', 'ki84', 'g4m')

# 【一台一張 1024】合成後只有 256 寬，多出來的餘裕是留給裁切與縮小的 ——
# 先大後小，邊緣才不會有階梯
PIXELS = 1024

VIEW_DIR = (-1.0, 0.0, 0.0)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(ident: str):
    path = os.path.join(MODELS, ident + '.glb')
    if not os.path.exists(path):
        raise SystemExit('找不到 ' + path)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in [x for x in bpy.data.objects if 'Prop' in x.name]:
        bpy.data.objects.remove(o, do_unlink=True)
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


def setup_render():
    s = bpy.context.scene
    s.render.engine = 'BLENDER_WORKBENCH'
    s.display.shading.light = 'FLAT'
    s.display.shading.color_type = 'SINGLE'
    s.display.shading.single_color = (1.0, 1.0, 1.0)
    s.render.film_transparent = True
    s.render.resolution_x = PIXELS
    s.render.resolution_y = PIXELS
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'


def shoot(centre, span, path):
    cam_data = bpy.data.cameras.new('SilCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new('SilCam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = Vector(VIEW_DIR)
    cam.location = centre + d * (span * 3.0)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (-d).to_track_quat('-Z', 'Y')
    bpy.context.scene.camera = cam
    setup_render()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    idents = argv if argv else list(AIRCRAFT)
    os.makedirs(OUT, exist_ok=True)
    for ident in idents:
        clear()
        lo, hi = bounds(load(ident))
        centre = (lo + hi) * 0.5
        # 側視畫幅是前後（Y）與上下（Z）；取大的那一邊當畫幅，圖才不會被切掉
        span = max(hi[1] - lo[1], hi[2] - lo[2]) * 1.04
        shoot(centre, span, os.path.join(OUT, ident + '.png'))
        print('SIL %s 機身長 %.2f m 畫幅 %.2f m' % (ident, hi[1] - lo[1], span))


main()
