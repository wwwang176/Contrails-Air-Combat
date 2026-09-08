import { Vector3 } from 'three'
import type { WeaponSpec } from './types'

/**
 * 一座自衛砲塔。與 `Battery` 平行而不是它的一部分 —— `Battery` 由玩家的
 * 扳機驅動（`Combatant.command.firing`），砲塔自己找目標、自己決定開火。
 *
 * 設計理由見 `docs/superpowers/specs/2026-08-20-bomber-turrets-design.md` §3.1。
 */
export interface Turret {
  id: string
  weapon: WeaponSpec
  /**
   * **靜止時**的槍口位置，機體座標，m。「靜止」= `aim` 還等於 `axis`。
   *
   * 【它不是彈丸的生成點】砲塔轉起來之後槍口會跟著掃出去，真正的生成點由
   * `turretMuzzle(t, aim, out)` 算。**釘住不動的是樞軸**（`turretPivot`），
   * 不是這個點 —— 人工回報 2026-08-21：「B17 機腹底的機槍，旋轉點好像不對」，
   * 根因就是三處都把這個點當成固定的管口，於是砲塔瞄右邊時整根槍往左邊擺
   * （實測 80° 時後膛甩到 x = −0.886，而管口一動也不動）。
   *
   * 【是槍口不是樞軸】真機的槍管本來就會伸出蒙皮之外，所以這個點**可以在
   * 命中盒外面**（B-17G 的尾砲塔就是：槍口 z ≈ 16.4，而尾部命中盒只到
   * 15.30）。護欄因此不是「槍口在盒內」而是「沿 −axis 回走
   * `TURRET_MOUNT_REACH` 會碰到機體」，見 `test/unit/turret-mount.test.ts`。
   *
   * 【雙聯砲塔填兩根管口的中點】兩根實際的管口在它左右各 `BARREL_SPACING`
   * （`world/turrets.ts` 匯出），彈丸在兩根之間輪替。
   */
  position: Vector3
  /**
   * 射界錐的中心方向，機體座標單位向量。
   *
   * 【為什麼是錐不是多邊形】真機的射界不規則（腰部機槍被機身擋、球形砲塔
   * 打不到正上方），但**照片讀不出精確邊界**，而這個專案已經為「從照片讀來
   * 的前提」付過一整輪的代價（見 `.claude/skills/aircraft-from-reference`
   * 坑 22）。一個中心方向 + 一個半角是**可以被試飛推翻的形式**，多邊形不是。
   */
  axis: Vector3
  /** 射界半角，rad。**設計值，不是量測值。** */
  halfAngle: number
  /** 旋轉速率上限，rad/s。這是「不能久留」的來源。 */
  rotationRate: number
  /**
   * 幾管。雙聯砲塔填 2。
   *
   * 【乘的是傷害不是射速】雙聯照實模擬要吐兩倍彈丸，而彈丸池只有 4,000 格。
   * 乘傷害的話 DPS 一樣、彈流看起來是一道而不是兩道 —— 1,000 m 外分不出來，
   * 但省一半的池子。**這是被預算逼出來的簡化，不是物理**；日後擴容池子時
   * 這裡可以改回去。視覺上仍然畫 `guns` 根槍管，彈丸在管口之間輪替。
   */
  guns: number
}

/**
 * 一台飛機最多幾座砲塔。**容量上界不是描述** —— 與 `MAX_MOUNTS` 同一個
 * 理由：砲塔的槍焰與槍管用「架數 × MAX_TURRETS」預配實例，超出的那一座會
 * **靜靜地畫不出來**。目前最多的是 B-17G 的 8 座。
 */
export const MAX_TURRETS = 8

/**
 * 槍管長度，m。**畫出來的那根管子有多長。** `render/turretBarrels.ts`
 * import 這一個，不自己再寫一份。
 */
export const BARREL_LENGTH = 0.9

/**
 * 槍管露在蒙皮外的長度，m。**`muzzleAt` 用它把量到的蒙皮點推成槍口。**
 *
 * 【為什麼需要它 —— 實測】第一版把砲塔的 `position` 直接填成量到的蒙皮點，
 * 而槍管是**由槍口往機體方向長**的（`render/turretBarrels.ts`）。結果是
 * 整根管子埋在機身裡，畫面上只剩 0.15–0.20 m 的管口端面 —— 機庫近照
 * （`test/tools/turret-shots.probe.ts`）拍出來是**一個黑點，不是一根管子**。
 * 那與專案負責人要的「黑色管子（三角形柱子）」不是同一個東西。
 *
 * 【0.45 是怎麼來的】`BARREL_LENGTH` 的一半 —— 露一半、埋一半。真機的
 * B-17 尾砲與腰槍本來就明顯伸出蒙皮，所以往外推是**更接近史實**而不是
 * 為了好看而失真。
 *
 * 【它同時是彈丸的生成點】`Turret.position` 的語意是槍口，`stepTurrets`
 * 就從那裡生彈丸。推 0.45 m 對彈道沒有可量測的影響（初速 765–887 m/s），
 * 但保證「彈丸從畫出來的那根管子的**尖端**出來」。
 */
export const BARREL_PROTRUDE = 0.45

/**
 * 由**量到的蒙皮點**與射界中心方向算出槍口。
 *
 * 【為什麼要一個函數而不是把數字加好寫死】兩件事分開才看得懂：表格裡的
 * 座標全部是「量測值」，外伸是一個可以整批調的設計參數。寫死的話日後要
 * 調外伸量得把十三格逐一重算，而那正是會算錯一格的做法。
 */
export function muzzleAt(skin: Vector3, axis: Vector3): Vector3 {
  return skin.clone().addScaledVector(axis, BARREL_PROTRUDE)
}

/**
 * 砲塔的**旋轉點**，機體座標，寫進 `out` 並回傳。
 *
 * 【資料裡沒有這個量，這是推導出來的】`Turret` 只存槍口。旋轉點取
 * **畫出來那根槍管的後端** —— 也就是槍口沿 −axis 回走一整根 `BARREL_LENGTH`。
 *
 * 換算回蒙皮：槍口 = 蒙皮 + `BARREL_PROTRUDE`（0.45），所以旋轉點 =
 * 蒙皮 − 0.45，**在蒙皮內 0.45 m**。對一顆直徑約 0.9 m 的砲塔球來說那就是
 * 它的球心，對手持槍座來說就是槍架的樞軸 —— 兩種都說得通。
 *
 * 【它目前只有視覺在用】射界錐的頂點（`tools/hangar.ts` 的射界開關）。
 * 彈道仍然從**槍口**出發，那是 `Turret.position` 的語意，不要混用：
 * 從旋轉點射的話，彈丸會從機身內部生出來。
 */
export function turretPivot(t: Turret, out: Vector3): Vector3 {
  return out.copy(t.position).addScaledVector(t.axis, -BARREL_LENGTH)
}

/**
 * 砲塔指向 `aim` 時的**槍口**，機體座標，寫進 `out` 並回傳。
 *
 * ```
 *   槍口 = 樞軸 + BARREL_LENGTH × aim
 * ```
 *
 * 【這是「繞樞軸轉」與「繞管口轉」的分水嶺】`aim === axis` 時它恰好等於
 * `t.position`，所以所有量到的位置與 `test/unit/turret-mount.test.ts` 的
 * 護欄都不受影響；一轉起來才看得出差別。
 *
 * **彈丸、槍管、槍焰三處都要用它**，各自寫一份遲早會有一份沒改到 —— 上一版
 * 就是三處都直接用 `t.position`，於是三處一起錯。
 */
export function turretMuzzle(t: Turret, aim: Vector3, out: Vector3): Vector3 {
  return out.copy(t.position)
    .addScaledVector(t.axis, -BARREL_LENGTH)
    .addScaledVector(aim, BARREL_LENGTH)
}

/**
 * 「這挺槍接在飛機上」護欄的回走距離，m。**刻意比 `BARREL_LENGTH` 長。**
 *
 * 【為什麼不能共用同一個數字】`hitBoxes` 是**簡化的傷害體積，比實際機體
 * 小**。B-17G 的機身外殼收在 z = 16.34（`b17g.model.ts` 的尾錐），而
 * `tail` 那一列的主盒止於 **15.24** —— 差 1.1 m。尾砲塔的槍口在 16.4，
 * 回走 0.9 只到 15.504，落在主盒外；用槍管長度當護欄距離會讓它**必然假紅**。
 * （尾錐另有一個補漏盒開到 16.45，但護欄不該建立在補漏盒剛好夠長上。）
 *
 * 這個常數等於「槍管 + 砲塔本體埋在機內的深度 + 命中盒的簡化餘量」。
 * **已驗算的只有三座已填位置**（B-17G 的 chin 與 tail、He 111 的 nose），
 * 其餘十座要等位置量完才由測試保證。2.0 仍然遠小於任何一台的機身長度 ——
 * 一座位置打錯而飄在機外三公尺的砲塔照樣抓得到。
 */
export const TURRET_MOUNT_REACH = 2.0

/**
 * 砲塔傷害的倍率。**專案負責人的裁定，試飛中。**
 *
 * 【為什麼是一個倍率，不是去改 `WeaponSpec.damage`】B-17G 的砲塔與 P-51D
 * 的六挺翼槍用的是**同一份** `M2_BROWNING` 物件，改它會把野馬一起改掉；
 * 替砲塔複製一份則多一個「兩份要一起維護」的地方，而且 He 111 還要再複製
 * 一次。
 *
 * 【它只作用在砲塔】只在 `world/turrets.ts` 的 `stepTurrets` 生彈丸那一行。
 * 玩家扣扳機走 `World.fire`，那條路徑完全沒碰到 —— 任何機種的固定前射
 * 武器都不受影響。
 *
 * 【`guns` 仍然照乘】雙聯砲塔一發是 `damage × guns × 這個倍率`，所以球形
 * 腹部砲塔是 18 × 2 × 0.9375 = **33.75**。
 */
export const TURRET_DAMAGE_SCALE = 0.9375

/** 黃金比。搖晃的第二個頻率乘它，兩個頻率因此不整除。 */
export const GOLDEN = 1.618033988749895

/** 黃金角，rad。相位乘它才會在 [0, 2π) 上散得最開。 */
export const GOLDEN_ANGLE = 2.399963229728653

/**
 * 白銀比 1 + √2。**第二條低差異序列。**
 *
 * 【為什麼不能兩件事共用同一個乘子】`frac(k·Φ)` 拿去錯開兩件不同的事，
 * 兩件事就變成同一個數字的兩份複本 —— 搜尋得早的那一座必然也開火得早，
 * 錯開的其實只有一件。要兩件事互相獨立，乘子之間也必須是無理數比。
 *
 * √2 與 φ 之間沒有有理數關係，所以 `frac(k·Φ)` 與 `frac(k·(1+√2))` 這兩條
 * 序列在二維上一樣鋪得開。
 */
export const SILVER = 2.414213562373095

/**
 * √3。**第三條低差異序列**，理由同 `SILVER` —— 點放的「相位」與「週期」
 * 是兩件事，共用一條的話週期就會變成相位的函數。
 */
export const ROOT3 = 1.7320508075688772

/**
 * 搖晃基底的退化門檻。`|aim · up| > BASIS_PARALLEL` 時改用備援上方向。
 *
 * 【為什麼需要】`aim × (0,1,0)` 在 aim 指向正上方時是零向量，normalize
 * 之後整條彈流變成 NaN 而且不會有任何錯誤。Sperry 上部砲塔的中心方向
 * 就是正上方。
 */
export const BASIS_PARALLEL = 0.99

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const UP_FALLBACK = /* @__PURE__ */ new Vector3(0, 0, -1)
/** 模組私有暫存，熱路徑零配置。禁止跨模組共用。 */
const AXIS = /* @__PURE__ */ new Vector3()

/**
 * 射界錐 —— 一個中心方向加一個半角。
 *
 * 【為什麼從 `Turret` 抽出來】艦上的砲位也有射界錐，但它沒有 `weapon`、
 * `position`、`guns` 那些欄位。要求它造一個假的 `Turret` 才能問「在不在
 * 錐內」，等於為了型別複製一份資料。
 */
export interface Arc {
  /** 錐軸，區域座標的單位向量。 */
  axis: Vector3
  /** 半角，rad。 */
  halfAngle: number
}

/** 方向是否落在射界錐內。`dir` 與 `arc.axis` 都必須是同一組區域座標的單位向量。 */
export function inArc(arc: Arc, dir: Vector3): boolean {
  return arc.axis.dot(dir) >= Math.cos(arc.halfAngle)
}

/**
 * 由 `aim` **唯一決定**的一組與它垂直的正交基底，寫進 e1、e2。
 *
 * 【為什麼要唯一決定】搖晃的「確定性」建立在這組基底上。若基底依賴呼叫
 * 順序或上一幀的狀態，同一個 t 就會給出不同的方向，逐位元重播會紅，而且
 * 症狀是隨機的。
 */
export function wobbleBasis(aim: Vector3, e1: Vector3, e2: Vector3): void {
  const u = Math.abs(aim.dot(UP)) > BASIS_PARALLEL ? UP_FALLBACK : UP
  e1.copy(aim).cross(u).normalize()
  // aim ⟂ e1 且兩者皆單位長，所以外積已經是單位長，不必再 normalize
  e2.copy(aim).cross(e1)
}

/**
 * 第 `turretIndex` 座砲塔的搖晃相位。
 *
 * 【為什麼要把載機索引也算進去】只用砲塔索引的話，編隊裡每一架的第 0 座
 * 都同相位，二十架 B-17 的尾砲塔會整齊劃一地擺動 —— 那看起來像機械故障
 * 而不是二十個砲手。
 *
 * 【stride 一定要是 `MAX_TURRETS`，不能是「這台有幾座」】—— Codex 2026-08-21
 * 實測抓到：用各機種自己的砲塔數當 stride 時，砲塔數不同的兩個機種**編號區間
 * 會重疊**。20 架 B-17G（8 座）加 20 架 He 111（5 座）共 260 座，實際只有
 * **200 個唯一相位、60 對完全同步** —— 例如 B-17 的 `c=12, i=4`（12×8+4）
 * 與 He 111 的 `c=20, i=0`（20×5+0）都是編號 100。那正是這個函數存在要
 * 避免的機械式同步。
 *
 * 固定 stride 之後同一組配置是 260 個唯一相位、0 對重複。這與
 * `resetTurretStates` 裡 `searchCooldown` 的錯開用同一個 stride —— 那裡
 * 本來就寫對了，只有這裡漏掉。
 */
export function wobblePhase(combatantIndex: number, turretIndex: number): number {
  const n = combatantIndex * MAX_TURRETS + turretIndex
  const p = (n * GOLDEN_ANGLE) % (Math.PI * 2)
  return p < 0 ? p + Math.PI * 2 : p
}

/**
 * 把 `aim` 繞兩個垂直軸各偏一個小角，寫進 `out` 並回傳。
 *
 * ```
 *   θ₁ = A · sin(ω·t + φ)          沿 e₁
 *   θ₂ = A · sin(ω·t·Φ + φ)        沿 e₂
 * ```
 *
 * 兩個頻率比是無理數，所以疊出來是**李薩茹圖形**：不重複、會把整個錐面
 * 掃滿，但每一瞬間仍然是連續平滑的移動。單一正弦是一條來回掃的直線，
 * 目標只要離開那條線就永遠打不到。
 *
 * 【偏移量加在切平面上，用 tan】偏離角恰好是 `atan(√(tan²θ₁ + tan²θ₂))`，
 * 而 `atan(√2·tan A) ≤ √2·A` 對所有 `|A| < π/2` 都成立 —— **這是精確上界，
 * 不只是小角度近似**。
 */
export function applyWobble(
  aim: Vector3,
  amplitude: number,
  omega: number,
  phase: number,
  t: number,
  e1: Vector3,
  e2: Vector3,
  out: Vector3,
): Vector3 {
  wobbleBasis(aim, e1, e2)
  const a = amplitude * Math.sin(omega * t + phase)
  const b = amplitude * Math.sin(omega * t * GOLDEN + phase)
  return out.copy(aim)
    .addScaledVector(e1, Math.tan(a))
    .addScaledVector(e2, Math.tan(b))
    .normalize()
}

/**
 * `aim` 往 `want` 轉，一步最多 `maxAngle`。就地寫回 `aim`。
 *
 * 兩個退化情況都必須處理，否則轉軸 normalize 之後是 NaN：已經對準
 * （外積為零）、正好反向（外積也為零，而且砲塔在目標繞到正後方那一瞬間
 * 就會遇到）。**反向時仍然要轉滿 maxAngle** —— 原地不動的話砲塔會永遠卡住。
 *
 * `Vector3.applyAxisAngle` 在 three.js r180 使用模組級的 `_quaternion`，
 * 不會每次配置，符合熱路徑零配置。
 */
export function slew(aim: Vector3, want: Vector3, maxAngle: number): void {
  const angle = aim.angleTo(want)
  if (angle <= maxAngle) {
    aim.copy(want)
    return
  }
  AXIS.copy(aim).cross(want)
  const len = AXIS.length()
  if (len < 1e-9) {
    // 正好反向：任取一個與 aim 垂直的軸，往哪一邊繞都對
    AXIS.copy(aim).cross(Math.abs(aim.dot(UP)) > BASIS_PARALLEL ? UP_FALLBACK : UP)
    AXIS.normalize()
  } else {
    AXIS.divideScalar(len)
  }
  aim.applyAxisAngle(AXIS, maxAngle).normalize()
}
