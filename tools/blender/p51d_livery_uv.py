# -*- coding: utf-8 -*-
"""
P-51D 的塗裝 UV：機身色的每一個面依法線歸到上／下／左／右其中一個視圖，
照 `tools/livery/layout.py` 的版面做正投影。

用法（無頭）：
    blender -b tools/blender/p51d.blend --python tools/blender/p51d_livery_uv.py -- <faces.json>

做完會存回 p51d.blend、匯出 models-src/p51d.glb，並把每個面投影後的多邊形寫進
<faces.json>，畫貼圖時拿來當覆蓋範圍與對位底圖。

只有 `P51_Body` 的面需要 UV；其餘材質在遊戲裡不貼圖（`glb.ts` 會丟掉它們的 UV），
沒有機身色的物件直接拿掉 UV 層，GLB 少帶一份資料。
"""
import bpy, json, os, sys

ROOT = r"C:\projects\grok-aircraft2"
sys.path.insert(0, os.path.join(ROOT, 'tools', 'livery'))
import layout  # noqa: E402

BODY = 'P51_Body'
GLB = os.path.join(ROOT, 'models-src', 'p51d.glb')


def game(v):
    """Blender（X 翼展、+Y 機首、Z 上）→ 遊戲（X 翼展、Y 上、−Z 機首）"""
    return (v.x, v.z, -v.y)


def main(faces_out):
    faces = []
    for o in bpy.data.collections['Mine'].all_objects:
        if o.type != 'MESH':
            continue
        me = o.data
        slots = [s.material.name if s.material else None for s in o.material_slots]
        if BODY not in slots:
            while me.uv_layers:
                me.uv_layers.remove(me.uv_layers[0])
            continue
        uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        for p in me.polygons:
            n = (nm @ p.normal).normalized()
            nx, ny, _ = game(n)
            view = layout.classify(nx, ny)
            pts = []
            for li in p.loop_indices:
                x, y, z = game(mw @ me.vertices[me.loops[li].vertex_index].co)
                px, py = layout.project(view, x, y, z)
                uv.data[li].uv = (px / layout.WIDTH, 1.0 - py / layout.HEIGHT)
                pts.append((round(px, 2), round(py, 2)))
            if slots[p.material_index] == BODY:
                faces.append({'view': view, 'pts': pts})
    with open(faces_out, 'w', encoding='utf-8') as f:
        json.dump(faces, f)

    bpy.ops.wm.save_mainfile()
    for o in bpy.data.objects:
        o.select_set(False)
    for o in bpy.data.collections['Mine'].all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format='GLB', use_selection=True,
        export_yup=True, export_extras=True, export_apply=True,
    )
    print(f'body faces {len(faces)} → {faces_out}')


main(sys.argv[sys.argv.index('--') + 1])
