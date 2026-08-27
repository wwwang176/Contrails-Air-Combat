import { DEFAULT_SAFETY, type SafetyConfig } from './safety'
import type { Aircraft } from '../aircraft/Aircraft'
import type { IslandDesc } from '../world/archipelago'

/**
 * AI 的地形感知。**圓弧 × 圓盤，不查高度場。**
 *
 * 【為什麼不沿航跡取樣高度】初稿是「射七條線、每 100 m 取一點」。三件事
 * 否決了它：
 *
 * ```
 *   取樣會漏      步長 100 m 而格距 40 m，射線跨得過一整座窄峰
 *   幾何錯了      射線是直線，飛機走弧線。射線說「右 45° 是空的」，但飛機
 *                 轉到 45° 要 498 m 弧長；障礙在 300 m 處時橫向只偏了 69 m
 *   不知道在繞誰  射線相對於**當下航向**，飛機一轉就換了一塊區域。
 *                 「那一側仍然通」因此不等於「原本那條走廊仍然通」
 * ```
 *
 * 島本來就是圓，用圓去判斷是解析的：沒有取樣就沒有 alias，成本是 O(島數)
 * 的加減乘，而且**知道自己在繞哪一座島** —— 解除條件因此寫得出來。
 *
 * 【沿航跡那八個點不是「取樣」】它們算的是島的**解析剖面**，而剖面是平滑
 * 單調的（`smoothstep`），不像高度場會有窄峰。八個點在這裡是數值積分，
 * 不是空間取樣。
 *
 * 熱路徑（20 Hz × 40 架），不配置。
 */

/**
 * 前視距離，m。
 *
 * 【怎麼量出來的】繞開一堵牆的成本是轉彎半徑 `V²/(g√(n²−1))` 乘上安全倍率
 * —— K-4 在 800 km/h 滿載過載時是 1,016 m。翻越一座 1,000 m 的山要
 * 2,747 m，但**AI 不需要翻山，只需要繞開**，兩者差 2.7 倍。取 1,200 m，
 * 對戰鬥機餘裕 18%。
 *
 * 【轟炸機不夠】He 111 在 600 km/h、3.5 G 的半徑是 845 m，乘 1.5 是
 * 1,267 m —— 超過這個值。飛行掃描要涵蓋機型維度，掃出撞山就從這裡加。
 */
export const SENSE_RANGE = 1200

/** 沿航跡檢查剖面的點數 */
const PROFILE_STEPS = 8

/** 機體膨脹的固定餘裕，m。半翼展之外再加這麼多 */
const BODY_MARGIN = 20

/** 轉向的上限，rad。超過這個角度飛機在感知週期內也轉不到 */
const MAX_TURN = (60 * Math.PI) / 180

/**
 * 連續這麼多次判定「已經過去了」才解除鎖存。
 *
 * 【設計時本來還有一條「最短鎖存 0.5 秒」，實作時拿掉了】那條的用意是避免
 * 「才轉 15°、山還在翼尖前方」就交還控制權。但解除的幾何條件已經涵蓋它了
 * —— 要**通過島心的橫斷面**、**而且離開膨脹圓**、**而且連續三次**，飛機
 * 轉一點點是滿足不了的。
 *
 * 加上時間下限反而有害：高速掠過一座 300 m 的小島只要兩三次感知就過去了，
 * 硬等滿 0.5 秒的話 AI 會對著一個早就沒有威脅的方向繼續轉。
 */
const CLEAR_SAMPLES = 3

/** AI 需要的地形資訊。**只有島，沒有高度場** */
export interface TerrainSource {
  readonly islands: readonly IslandDesc[]
}

/** 可變，由 `senseTerrain` 就地填寫 —— 熱路徑不得配置 */
export interface TerrainSense {
  /** 沿航跡的最高地形，m。餵給 `applySafety` 當地板高度 */
  floor: number
  /**
   * 承諾的航向偏移，rad。0 = 不需要規避，**或無處可去**（退回拉起）。
   *
   * 正負由 `senseTerrain` 內部的座標約定決定：它永遠指向遠離島心的那一側。
   */
  turn: number
  /**
   * 正在繞哪一座島的索引；−1 = 沒有。**這就是鎖存狀態。**
   *
   * 【為什麼綁島而不是綁方向】方向是相對於當下航向的，飛機一轉那個方向就
   * 變了；島的索引不會變。
   */
  island: number
  /** 連續判定無威脅的次數 */
  clearSamples: number
  /** 這次鎖存已經維持了幾次感知 */
  heldTicks: number
}

export function createSense(): TerrainSense {
  return { floor: 0, turn: 0, island: -1, clearSamples: 0, heldTicks: 0 }
}

/**
 * 清空。**`playerAi` 跨場重用，`resetBattle` 也會建新的控制器** —— 上一場
 * 的承諾不得帶進新的一場或新的座位。
 */
export function resetSense(s: TerrainSense): void {
  s.floor = 0
  s.turn = 0
  s.island = -1
  s.clearSamples = 0
  s.heldTicks = 0
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 島在距島心 `dist` 處的地形高度，m。
 *
 * 【用 `outerRadius` 當尺度是刻意的】真正的剖面以 `radius` 為尺、再乘上
 * 隨方位變化的 wobble。這裡用最大的那一個（`outerRadius = radius × 1.29`），
 * 等於假設每個方位都是最胖的那一個 —— **高估地形，偏保守**。
 */
function profileHeight(isl: IslandDesc, dist: number): number {
  const t = dist / isl.outerRadius
  return t >= 1 ? 0 : isl.peak * smoothstep(1, 0, t)
}

/** 一次 broad phase 的結果。模組級，避免在熱路徑配置 */
const hit = { index: -1, along: 0, perp: 0, centre: 0 }

/**
 * 沿 (dx, dz) 方向找最近的威脅島。找到寫進 `hit` 並回 true。
 *
 * `perp` 是**帶符號**的垂距：正值表示島心在航向的某一側，符號用來決定往
 * 哪邊繞。
 */
function findThreat(
  px: number, pz: number, dx: number, dz: number,
  islands: readonly IslandDesc[], margin: number, skip: number,
): boolean {
  hit.index = -1
  let nearest = Infinity
  for (let i = 0; i < islands.length; i++) {
    if (i === skip) continue
    const isl = islands[i]!
    const r = isl.outerRadius + margin
    const ox = isl.cx - px
    const oz = isl.cz - pz
    const along = ox * dx + oz * dz
    if (along < -r || along > SENSE_RANGE + r) continue
    const perp = dx * oz - dz * ox
    if (perp > r || perp < -r) continue
    if (along < nearest) {
      nearest = along
      hit.index = i
      hit.along = along
      hit.perp = perp
      hit.centre = Math.hypot(ox, oz)
    }
  }
  return hit.index >= 0
}

/**
 * 沿航跡爬得過這座島嗎？順便回報沿途最高的地形。
 *
 * 【爬升角用 `recoveryPitch` 的定值】不解實際能達到的爬升角。真值會比這個
 * 低（拉起要時間、俯衝中還要先改平），所以這個估**偏樂觀** —— 由飛行掃描
 * 護欄兜底。
 */
const climb = { ok: true, floor: 0 }
function checkClimb(
  y0: number, isl: IslandDesc, along: number, perp: number, cfg: SafetyConfig,
): void {
  const tanP = Math.tan(cfg.recoveryPitch)
  climb.ok = true
  climb.floor = 0
  for (let i = 1; i <= PROFILE_STEPS; i++) {
    const s = (SENSE_RANGE * i) / PROFILE_STEPS
    const d = Math.hypot(perp, s - along)
    const h = profileHeight(isl, d)
    if (h > climb.floor) climb.floor = h
    if (y0 + s * tanP < h + cfg.clearance) climb.ok = false
  }
}

export function senseTerrain(
  self: Aircraft, src: TerrainSource, out: TerrainSense,
  cfg: SafetyConfig = DEFAULT_SAFETY,
): void {
  const pos = self.state.position
  const vel = self.state.velocity
  let dx = vel.x
  let dz = vel.z
  const speed = Math.hypot(dx, dz)
  if (!(speed > 1e-3)) {
    // 水平速度為零時「前方」沒有定義。回「不介入」而不是回 NaN
    resetSense(out)
    return
  }
  dx /= speed
  dz /= speed

  const margin = self.spec.wing.span / 2 + BODY_MARGIN
  const islands = src.islands

  // ── 鎖存中：先問承諾的那一座還算不算威脅 ────────────────────────────
  if (out.island >= 0 && out.island < islands.length) {
    const isl = islands[out.island]!
    const r = isl.outerRadius + margin
    const ox = isl.cx - pos.x
    const oz = isl.cz - pos.z
    const along = ox * dx + oz * dz
    const centre = Math.hypot(ox, oz)
    out.heldTicks++

    // 通過島心的橫斷面、而且離開了膨脹圓 —— 這一座算過去了
    const passed = along < 0 && centre > r
    if (passed) {
      out.clearSamples++
      if (out.clearSamples >= CLEAR_SAMPLES) {
        resetSense(out)
        return
      }
    } else {
      out.clearSamples = 0
    }

    const perp = dx * oz - dz * ox
    checkClimb(pos.y, isl, along, perp, cfg)
    out.floor = climb.floor
    if (!passed && !climb.ok) {
      // 仍然要繞。**方向維持原符號** —— 單次讀值不得反轉，否則就是換一個
      // 觸發條件的乒乓
      const side = out.turn >= 0 ? 1 : -1
      out.turn = side * turnMagnitude(centre, perp, isl.outerRadius + margin)
    }
    return
  }

  // ── 沒有鎖存：找威脅 ────────────────────────────────────────────────
  if (!findThreat(pos.x, pos.z, dx, dz, islands, margin, -1)) {
    resetSense(out)
    return
  }

  const idx = hit.index
  const isl = islands[idx]!
  const along = hit.along
  const perp = hit.perp
  const centre = hit.centre
  checkClimb(pos.y, isl, along, perp, cfg)
  out.floor = climb.floor

  if (climb.ok) {
    // 爬得過 —— 不轉。地板已經抬高，交給既有的 'ground' 分支決定要不要拉
    out.turn = 0
    out.island = -1
    out.clearSamples = 0
    out.heldTicks = 0
    return
  }

  // 往島心的反側繞。perp 是帶符號的垂距，所以反側就是它的反號
  const side = perp >= 0 ? -1 : 1
  const mag = turnMagnitude(centre, perp, isl.outerRadius + margin)

  // 【驗算】轉過去之後會不會撞上**別座**島。會的話試另一側；兩側都不行就
  // 不轉、退回拉起（安全網）。這是負責人問的「死路峽谷」的答案
  let turn = side * mag
  if (blocked(pos.x, pos.z, dx, dz, turn, islands, margin, idx, pos.y, cfg)) {
    const other = -side * mag
    turn = blocked(pos.x, pos.z, dx, dz, other, islands, margin, idx, pos.y, cfg) ? 0 : other
  }

  out.turn = turn
  out.island = turn === 0 ? -1 : idx
  out.clearSamples = 0
  out.heldTicks = 0
}

/**
 * 要讓航跡離島心 `need` 公尺，航向得偏多少（rad）。
 *
 * 已經在圓內（`centre <= need`）時 `asin` 會飽和成 90°，再由 `MAX_TURN` 夾住
 * —— 那正是「全力轉開」該有的行為。
 */
function turnMagnitude(centre: number, perp: number, need: number): number {
  const c = Math.max(centre, 1)
  const want = Math.asin(Math.min(1, need / c))
  const have = Math.asin(Math.min(1, Math.abs(perp) / c))
  const t = want - have
  return t <= 0 ? 0 : t > MAX_TURN ? MAX_TURN : t
}

/** 把航向轉 `turn` 之後，還會不會撞上別座爬不過的島 */
function blocked(
  px: number, pz: number, dx: number, dz: number, turn: number,
  islands: readonly IslandDesc[], margin: number, skip: number,
  y0: number, cfg: SafetyConfig,
): boolean {
  if (turn === 0) return true
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const nx = dx * c - dz * s
  const nz = dx * s + dz * c
  if (!findThreat(px, pz, nx, nz, islands, margin, skip)) return false
  checkClimb(y0, islands[hit.index]!, hit.along, hit.perp, cfg)
  return !climb.ok
}
