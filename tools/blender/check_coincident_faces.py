# -*- coding: utf-8 -*-
"""
共面檢查：A6M5_* 每對物件之間，面心 4 mm 內且法線平行的面（會在遊戲裡閃爍）。
建完在 Blender 裡 exec 這支，結果在 COINCIDENT，必須是空 dict。
2026-09-03 它指出玻璃件還剩前壁與斜底兩片封蓋、跟機身塗黑的切面完全共面。
把 'A6M5_' 換成別台的前綴就能用。
"""
import bpy, bmesh
from mathutils.kdtree import KDTree
objs = [o for o in bpy.data.objects if o.name.startswith('A6M5_')]
data = {}
for o in objs:
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
    data[o.name] = [(f.calc_center_median().copy(), f.normal.copy(), f.calc_area()) for f in bm.faces]
    bm.free()
pairs = {}
names = sorted(data)
for i, a in enumerate(names):
    kd = KDTree(len(data[a]))
    for idx, (c, n, ar) in enumerate(data[a]): kd.insert(c, idx)
    kd.balance()
    for b in names[i + 1:]:
        hits = []
        for (c, n, ar) in data[b]:
            for (co, idx, dist) in kd.find_range(c, 0.004):
                if abs(n.dot(data[a][idx][1])) > 0.98:
                    hits.append((round(c.x, 3), round(c.y, 3), round(c.z, 3)))
        if hits: pairs[f'{a} ~ {b}'] = hits[:8] + ([f'... {len(hits)}'] if len(hits) > 8 else [])
COINCIDENT = pairs
