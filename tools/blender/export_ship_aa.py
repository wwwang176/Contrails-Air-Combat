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


def zones_of(rows):
    """把砲位併成「一層 × 一舷」一區，每區推一門**真實存在的**砲當代表。

    代表取「離該區形心最近的那一門」，**不是形心本身** —— 形心會落在兩層甲板
    之間的空中（Essex 左舷那排 20 mm 沿著彎曲的走廊跨了 250 m，形心根本不在
    任何一層上）。取真實的一門，槍口就一定長在畫得出來的那根砲管上。
    """
    groups = {}
    for gid, tier, cal, x, y, z, guns in rows:
        groups.setdefault((tier, side(x)), []).append((gid, tier, cal, x, y, z, guns))
    out = []
    for (tier, sd), members in sorted(groups.items(), key=lambda kv: (TIER_ORDER[kv[0][0]], kv[0][1])):
        cx = sum(m[3] for m in members) / len(members)
        cy = sum(m[4] for m in members) / len(members)
        cz = sum(m[5] for m in members) / len(members)
        rep = min(members, key=lambda m: (m[3] - cx) ** 2 + (m[4] - cy) ** 2 + (m[5] - cz) ** 2)
        out.append(("%s_%s" % (tier, sd), tier, rep[2], rep[3], rep[4], rep[5],
                    rep[6], len(members), rep[0]))
    return out


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
    data[ship] = (const, title, rows, zones_of(rows))

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
 * ## 接進遊戲請用 `*_AA_ZONES`，不是這一份
 *
 * `weapons/turret.ts` 的 `MAX_TURRETS = 8`（一台單位最多八座），而 Essex 逐門
 * 列出來有 46 個。超過的話**三件事會同時靜靜地壞掉**：
 *
 * 1. 第 9 座起畫不出砲管與槍焰（那兩個迴圈跑的是 `MAX_TURRETS` 次），但開火
 *    邏輯跑的是「這艘有幾座」—— 子彈會從空氣裡冒出來
 * 2. 抖動相位與點放節奏的種子是 `單位編號 × MAX_TURRETS + 砲塔編號`，編號一旦
 *    超過 7 就與**下一個單位的第 0 座**撞號，好幾座砲完全同步地抖
 * 3. 不報錯、測試也不紅
 *
 * 所以下面每艘再給一份 `*_AA_ZONES`：**一層 × 一舷併成一區，一區推一門真實
 * 存在的砲當代表**（負責人 2026-09-04 裁決）。三艘都 ≤ 6 區，在上限之內。
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

/**
 * 併區之後的砲位 —— **接進遊戲用這一份**。
 *
 * 一層（`tier`）× 一舷併成一區，一區推**一門真實存在的砲**當代表：位置就是
 * 那一門量到的槍口，所以槍焰一定長在畫得出來的那根砲管上。取形心會落在兩層
 * 甲板之間的空中（Essex 左舷那排 20 mm 沿著彎曲的走廊跨了 250 m）。
 */
export interface ShipAAZone extends ShipEmplacement {
  /**
   * 這一區實際上有幾門砲。**只是記錄，不是倍率** —— 負責人 2026-09-04 裁決：
   * 一區一門代替就好、血量不加倍。要拿它去乘血量或傷害之前請先想清楚：
   * 玩家看到的就是一門砲，打起來卻像 27 門，那是兩回事。
   */
  mountsInZone: number
  /** 代表的是逐門清單裡的哪一門（對得回 `*_AA`）。 */
  representative: string
}

/**
 * 射界的**起始值**，一層一組 —— 與 `WOBBLE_AMPLITUDE` 同一個性質：
 * **設計值，由試飛裁定**，不是從模型量出來的。
 *
 * `elevationDeg` 是錐軸抬離水平的角度；錐軸的水平分量一律朝**舷外**（中線上的
 * 砲改成朝正上）。半角越大、涵蓋越廣但也越不像有死角。
 *
 * 起始值的想法：口徑越大打得越遠越高、指向越接近天頂；小口徑近迫防禦則壓低、
 * 涵蓋窄一點，玩家貼海面進場時才有「先穿過黑霧、再進彈幕」的層次。
 * 機庫（`hangar.html` 選船 → 射界）可以直接看這三層疊出來的樣子。
 */
export const SHIP_AA_ARC_DEFAULTS: Readonly<Record<ShipAATier,
  { elevationDeg: number; halfAngleDeg: number }>> = {
  flak: { elevationDeg: 55, halfAngleDeg: 75 },
  autocannon: { elevationDeg: 45, halfAngleDeg: 65 },
  mg: { elevationDeg: 40, halfAngleDeg: 55 },
}

''')
    for ship, (const, title, rows, zones) in data.items():
        n = {}
        for r in rows:
            n[r[1]] = n.get(r[1], 0) + 1
        f.write("/** %s 逐門 —— 兩用砲 %d、40 mm %d、20 mm %d。**量測來源，不是遊戲用的那一份。** */\n"
                % (title, n.get('flak', 0), n.get('autocannon', 0), n.get('mg', 0)))
        f.write("export const %s_AA: readonly ShipEmplacement[] = [\n" % const)
        for gid, tier, cal, x, y, z, guns in rows:
            f.write("  { id: '%s', tier: '%s', calibreMm: %d, guns: %d,\n"
                    "    position: new Vector3(%.2f, %.2f, %.2f) },\n"
                    % (gid, tier, cal, guns, x, z, -y))
        f.write("]\n\n")
        f.write("/** %s 併區（%d 區）。 */\n" % (title, len(zones)))
        f.write("export const %s_AA_ZONES: readonly ShipAAZone[] = [\n" % const)
        for zid, tier, cal, x, y, z, guns, cnt, rep in zones:
            f.write("  { id: '%s', tier: '%s', calibreMm: %d, guns: %d, mountsInZone: %d,\n"
                    "    representative: '%s', position: new Vector3(%.2f, %.2f, %.2f) },\n"
                    % (zid, tier, cal, guns, cnt, rep, x, z, -y))
        f.write("]\n\n")
    f.write("export const SHIP_AA: Readonly<Record<string, readonly ShipEmplacement[]>> = {\n")
    for ship, (const, _t, _r, _z) in data.items():
        f.write("  %s: %s_AA,\n" % (ship, const))
    f.write("}\n\n")
    f.write("/** 接進遊戲用這一份。 */\n")
    f.write("export const SHIP_AA_ZONES: Readonly<Record<string, readonly ShipAAZone[]>> = {\n")
    for ship, (const, _t, _r, _z) in data.items():
        f.write("  %s: %s_AA_ZONES,\n" % (ship, const))
    f.write("}\n")

print("RESULT_AA_WRITTEN %s  逐門 %s  併區 %s"
      % (OUT, {s: len(d[2]) for s, d in data.items()},
         {s: len(d[3]) for s, d in data.items()}))
