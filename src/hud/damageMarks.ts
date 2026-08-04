import { DEG } from '../core/math'

/**
 * 受擊方向痕跡 —— **純邏輯，不碰 Canvas**。繪製在 `widgets/damageEdge.ts`。
 *
 * 【為什麼拆開】Canvas 在 node 環境測不了，而「兩發要不要併成一團」、
 * 「正後方是不是整圈」都是有實際行為的規則。拆開之後它們就是普通的單元
 * 測試 —— 與 `advanceGEffect` 當初從 `drawGEffect` 拆出來同一個做法。
 */

/** 角度窗的半寬，rad。原型上調出來的（spec §7） */
export const DAMAGE_HALF_WIDTH = 70 * DEG

/** 同時記得住幾個方向。同時有六個不同方向的攻擊者已經是極端情形（spec §7） */
export const DAMAGE_MARK_CAPACITY = 6

/**
 * 一筆痕跡從最亮淡到消失要多久，s。
 *
 * 【為什麼比命中標記的 0.15 s 長】那個是「我打中了」的瞬間回饋，這個是
 * 「有人在打我」的處境資訊 —— 要撐得夠久讓人反應得過來（spec §7）。
 */
export const DAMAGE_MARK_SECONDS = 0.5

/** 方向夾角小於 30° 就併進既有那一格。連射的方向抖動遠小於它 */
export const DAMAGE_MERGE_DOT = Math.cos(30 * DEG)

export interface DamageMark {
  /** 中彈當下的**視角座標**來彈方向，單位向量。x=右 y=上 z=後 */
  x: number
  y: number
  z: number
  /** 剩餘強度 0..1。0 = 空格 */
  intensity: number
}

/** 螢幕上的角度。0 = 正右、π/2 = 正上 */
export function markAngle(m: DamageMark): number {
  return Math.atan2(m.y, m.x)
}

/**
 * 這一發偏離視線多少：1 = 正側面、0 = 正前或正後（畫面上沒有角度）。
 *
 * 方向是單位向量，所以這就是它與視線夾角的正弦。
 */
export function markOffAxis(m: DamageMark): number {
  return Math.hypot(m.x, m.y)
}

/** 兩個角度的最短夾角，−π..π */
export function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * 角度窗：中心最亮，往兩側以升餘弦落到 0，並依 `offAxis` 混合到均勻一圈。
 *
 * 【為什麼要與「均勻一圈」混合】偏離視線越小，方向越不可信 —— 極限是正後方
 * 的整圈。用 `offAxis` 當混合比例，兩端都對而且中間是連續的：側面來彈是
 * 一團、斜後方是一團加一圈微亮的底、正後方就是整圈。沒有門檻、沒有跳變。
 *
 * 【為什麼是升餘弦而不是線性】升餘弦（Hann）兩端的**斜率都是 0**，所以光
 * 消失的地方切線平滑接上背景。線性衰減會在那個角度留下一道看得見的折痕。
 */
export function damageWindow(delta: number, half: number, offAxis: number): number {
  const d = Math.abs(delta)
  const lobe = d >= half ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / half))
  return offAxis * lobe + (1 - offAxis)
}

export function createDamageMarks(): DamageMark[] {
  return Array.from(
    { length: DAMAGE_MARK_CAPACITY },
    () => ({ x: 0, y: 0, z: 1, intensity: 0 }),
  )
}

/**
 * 記一次中彈。
 *
 * 【為什麼用 3D 方向判斷合併而不是螢幕角度】正後方來的兩發**沒有螢幕角度
 * 可以比**（它們都投影在畫面中心），但 3D 方向幾乎平行 —— 用點積判斷，
 * 那個退化情形自然就對了。
 *
 * 【合併時不動方向】動了的話連射會讓那團光左右抖。
 */
export function pushDamageMark(
  marks: DamageMark[], x: number, y: number, z: number,
): void {
  let weakest = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    if (m.intensity > 0 && m.x * x + m.y * y + m.z * z > DAMAGE_MERGE_DOT) {
      m.intensity = 1
      return
    }
    if (m.intensity < marks[weakest]!.intensity) weakest = i
  }
  const m = marks[weakest]!
  m.x = x
  m.y = y
  m.z = z
  m.intensity = 1
}

/** 線性淡出。一幀呼叫一次，不是一個物理子步一次。 */
export function stepDamageMarks(marks: DamageMark[], dt: number): void {
  const drop = dt / DAMAGE_MARK_SECONDS
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!
    const v = m.intensity - drop
    m.intensity = v > 0 ? v : 0
  }
}

/**
 * 全部清空。
 *
 * 【與 `resetGEffect` 成對出現】兩者的觸發條件完全相同：玩家的處境發生了
 * 不連續的改變（重生、接手僚機、死亡鏡頭開始）。不清的話上一場的紅邊會
 * 留到新的一場（spec §6.2）。
 */
export function resetDamageMarks(marks: DamageMark[]): void {
  for (let i = 0; i < marks.length; i++) marks[i]!.intensity = 0
}
