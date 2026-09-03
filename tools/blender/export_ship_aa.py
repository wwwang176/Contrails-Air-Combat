# -*- coding: utf-8 -*-
"""
把三艘船的防空砲位吐成遊戲用的座標表（`src/world/shipAA.ts`）。

用法（Blender 5.x，背景）：
    blender -b -P tools/blender/export_ship_aa.py

跑的是 `build_*.py` 本身，所以座標永遠與 GLB 同一份來源 —— 手抄一份的話，
改了建模腳本而忘了改表，砲口就會離開砲塔而**沒有任何測試會紅**。

【座標系轉換】建模腳本用 Blender 系（X 橫向、+Y 艦首、Z 上）；GLB 是用
`export_yup=True` 匯出的，所以遊戲裡是 X 橫向、**Y 上、−Z 艦首**。
    遊戲 (x, y, z) = Blender (x, z, −y)
這一行就是整支腳本唯一的轉換，錯了整批砲位會繞著艦體翻 90°。

【這裡只給位置】射界（`axis` / `halfAngle`）、轉速、血量**不在這裡** ——
`weapons/turret.ts` 已經寫明射界是「設計值，不是量測值」，理由是這個專案
為「從照片讀來的前提」付過一整輪的代價。從外型模型硬讀一個射界出來，正好
是那條規則要擋的事。
"""
import bpy, json, os

ROOT = r"C:\projects\grok-aircraft2\.claude\worktrees\bf109-v2"
OUT = os.path.join(ROOT, "src", "world", "shipAA.ts")
SHIPS = (('essex', 'ESSEX', 'USS Essex CV-9'),
         ('fletcher', 'FLETCHER', 'USS Fletcher DD-445'),
         ('wichita', 'WICHITA', 'USS Wichita CA-45'))
TIER_ORDER = {'flak': 0, 'autocannon': 1, 'mg': 2}


def run(ship):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)
    g = {}
    exec(open(os.path.join(ROOT, "tools", "blender", "build_%s.py" % ship),
              encoding='utf-8').read(), g)
    return g['LOG']['empl']


def side(x):
    return 'c' if abs(x) < 0.6 else ('s' if x > 0 else 'p')


lines = []
data = {}
for ship, const, title in SHIPS:
    empl = run(ship)
    empl.sort(key=lambda e: (TIER_ORDER[e[0]], -e[3], e[2]))
    seen = {}
    rows = []
    for tier, cal, x, y, z, guns in empl:
        key = (tier, side(x))
        seen[key] = seen.get(key, 0) + 1
        rows.append((f"{tier}_{side(x)}{seen[key]}", tier, cal, x, y, z, guns))
    data[ship] = (const, title, rows)

with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('''import { Vector3 } from 'three'

/**
 * # 軍艦的防空砲位 —— **位置是量出來的，射界與血量不是**
 *
 * 這一份由 `tools/blender/export_ship_aa.py` 從 `build_*.py` 直接產生，
 * 不要手改：座標與 `public/models/*.glb` 是同一份來源，手抄一份的話，改了
 * 建模腳本而忘了改表，砲口就會離開砲塔而**沒有任何測試會紅**。
 *
 * ## 三層，行為不一樣
 *
 * | tier | 口徑 | 交戰 | 視覺 | 有效射程 |
 * | --- | --- | --- | --- | --- |
 * | `flak` | 5"/38 兩用砲 | **空中引爆**（定時／VT 引信）| 黑色煙團 | 8–10 km |
 * | `autocannon` | 40 mm Bofors | 直射命中 | 曳光彈流 | 2.7–3.5 km |
 * | `mg` | 20 mm Oerlikon | 直射命中 | 曳光彈流 | 0.9–1.5 km |
 *
 * 20 mm 與 40 mm 雖然叫「砲」，但它們是機關砲、打的是直射曳光彈 —— 行為與
 * 轟炸機的自衛機槍同一類。**會做出黑霧的只有 5 吋兩用砲。**
 *
 * ## 座標系
 *
 * 與 GLB 一致：X 橫向（+X 右舷）、**Y 上**、**−Z 艦首**，原點在水線 × 艦體
 * 中點 × 中線。`position` 是**砲口**（與 `weapons/turret.ts` 的 `Turret.position`
 * 同一個約定），不是樞軸。
 *
 * ## 這裡刻意沒有的東西
 *
 * `axis`／`halfAngle`／`rotationRate`／`hp` **不在這裡**。`weapons/turret.ts`
 * 已經寫明射界是「設計值，不是量測值」，理由是這個專案為「從照片讀來的前提」
 * 付過一整輪的代價（見 `.claude/skills/aircraft-from-reference` 坑 22）。
 * 從外型模型硬讀一個射界出來，正好是那條規則要擋的事 —— 那幾個值由試飛裁定。
 *
 * ## 接進遊戲之前要先解決的一件事
 *
 * `weapons/turret.ts` 的 `MAX_TURRETS = 8`（一台飛機最多八座），而 Essex 這裡
 * 有 46 個砲位。**超出的那一座會靜靜地畫不出來。** 要嘛擴容，要嘛把同一段
 * 走廊的一整排併成一個「砲組」—— 併組在玩法上也更合理：打掉的是「左舷前段
 * 的 20 mm 砲廊」，不是第 37 號那一門。
 */
export type ShipAATier = 'flak' | 'autocannon' | 'mg'

export interface ShipEmplacement {
  /** 穩定 id：`<tier>_<舷><序號>`，舷是 p 左／s 右／c 中線。 */
  id: string
  tier: ShipAATier
  /** 口徑，mm。127 = 5 吋。 */
  calibreMm: number
  /** 砲口，艦體座標，m。 */
  position: Vector3
  /** 幾管。四聯裝 40 mm 填 4 —— 注意 `render/turretBarrels.ts` 只畫得出 2 根。 */
  guns: number
}

''')
    for ship, (const, title, rows) in data.items():
        n = {}
        for r in rows:
            n[r[1]] = n.get(r[1], 0) + 1
        f.write("/** %s —— 兩用砲 %d、40 mm %d、20 mm %d。 */\n"
                % (title, n.get('flak', 0), n.get('autocannon', 0), n.get('mg', 0)))
        f.write("export const %s_AA: readonly ShipEmplacement[] = [\n" % const)
        for gid, tier, cal, x, y, z, guns in rows:
            f.write("  { id: '%s', tier: '%s', calibreMm: %d, guns: %d,\n"
                    "    position: new Vector3(%.2f, %.2f, %.2f) },\n"
                    % (gid, tier, cal, guns, x, z, -y))
        f.write("]\n\n")
    f.write("export const SHIP_AA: Readonly<Record<string, readonly ShipEmplacement[]>> = {\n")
    for ship, (const, _t, _r) in data.items():
        f.write("  %s: %s_AA,\n" % (ship, const))
    f.write("}\n")

print("RESULT_AA_WRITTEN %s  %s" % (OUT, {s: len(d[2]) for s, d in data.items()}))
