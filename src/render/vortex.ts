import { Color, NormalBlending, type InstancedMesh } from 'three'
import { createParticles } from './particles'

/**
 * 翼尖凝結尾。
 *
 * 【物理依據】真機的翼尖渦凝結尾成因是翼尖低壓區把水氣凝出來，而低壓的
 * 強度跟著升力係數走 —— 也就是跟著 G 走。所以判準取 `|loadFactor|`。
 *
 * 【「大幅度轉彎更明顯」不必另外寫程式】大幅度轉彎就是高 G，`intensity`
 * 直接就是它。這是專案負責人的原始要求。
 *
 * 【為什麼尾跡會留在空中】粒子發射時速度是 0、`gravity` 是 0 —— 它們生在
 * 翼尖走過的地方就不動了，於是自動描出飛機剛剛走過的路徑。那就是凝結尾。
 */

/** 開始凝結的 G。平飛 1 g 與緩轉 2 g 完全乾淨。 */
export const VORTEX_G_ON = 3.0
/** 濃度拉滿的 G。兩機的持續轉彎大致落在 4–6 g。 */
export const VORTEX_G_FULL = 6.5
/** 剛過門檻時的補點間隔，m。大於粒子直徑 ⇒ 讀起來是斷續的淡痕。 */
export const VORTEX_SPACING_MAX = 4.0
/** 拉滿時的補點間隔，m。小於粒子直徑 ⇒ 彼此重疊、連成實心白帶。 */
export const VORTEX_SPACING_MIN = 1.5
/** 出生直徑，m。翼展約 11 m，尾跡粗細約 1/7 翼展。 */
export const VORTEX_SIZE_FROM = 1.6
/** 死亡直徑，m。渦會擴散。 */
export const VORTEX_SIZE_TO = 4.5
/** intensity = 0 時的尺寸倍率。 */
export const VORTEX_SIZE_MIN_SCALE = 0.45
/** 壽命，s。200 m/s × 1.4 = 280 m 的尾跡長度。 */
export const VORTEX_LIFE = 1.4
/** 壽命抖動。與 SMOKE_LIFE_JITTER 同一個理由：尾端不要切齊。 */
export const VORTEX_LIFE_JITTER = 0.15
/** 出生不透明度。 */
export const VORTEX_ALPHA = 0.42
/** 指數阻尼，s⁻¹。速度本來就發射為 0，這個只用來收掉數值殘留。 */
export const VORTEX_DRAG = 0.8

/**
 * 每個翼尖每幀最多補幾顆。**這是防爆閥，不是視覺參數。**
 *
 * 幀率崩到 7.5 fps 時（無頭 Chromium 就是這個數量級）單幀位移 27 m，以
 * 1.5 m 的間隔會想補 18 顆 —— 一架飛機就能把池子吃光。8 顆讓極慢的幀率下
 * 尾跡變疏，但不會拖垮其他人。
 */
export const VORTEX_MAX_PER_FRAME = 8

/**
 * 兩幀之間的位移上限，m。超過就只記錄、不發射。
 *
 * 擋的是換場、重生、接手、以及分頁切回來時的巨大 `dt` —— 否則會出現一條
 * 橫跨半個地圖的白線。與 `main.ts` 對 `prevPosition` 的處理同一個道理。
 * 200 m/s × 0.3 s = 60 m，比任何正常幀都寬得多。
 */
export const VORTEX_MAX_STEP = 60

/**
 * 粒子容量。與 `SMOKE_CAPACITY` 同級。
 *
 * 【滿了會截短尾跡，那是刻意選的退化方向】40 架同時 6.5 G、200 m/s 的極端
 * 情形每秒要 10,667 顆，1.4 s 壽命等於 14,933 顆存活，超過這個容量。環形
 * 緩衝會覆蓋最舊的 —— 也就是**尾跡的尾端先消失**，長度從 1.4 s 縮到約
 * 0.5 s。尾端本來就是最淡的一段，而「所有人的尾跡一起變短」遠好過「有些人
 * 完全沒有尾跡」。與 `sparks.ts` / `particles.ts` 的覆蓋策略一致。
 */
export const VORTEX_CAPACITY = 6144

/**
 * 上一幀翼尖位置的座位數。
 *
 * 【為什麼不 import MAX_COMBATANTS】它住在 `src/battle/skirmish.ts`，而這個
 * 檔不得相依 `src/battle/`。64 對 20v20 的 40 個座位有 1.6 倍餘裕，而一個
 * `Float32Array(384)` 的成本可以忽略。兩個常數不准漂開由
 * `test/unit/vortex.test.ts` 守著 —— 跨層相依在測試裡是允許的。
 */
export const VORTEX_SEATS = 64

/** 凝結尾的顏色。近白、略帶天空的藍。 */
const VORTEX_COLOR = new Color(0xeef4f8)

export function vortexIntensity(loadFactor: number): number {
  const g = Math.abs(loadFactor)
  if (g <= VORTEX_G_ON) return 0
  if (g >= VORTEX_G_FULL) return 1
  return (g - VORTEX_G_ON) / (VORTEX_G_FULL - VORTEX_G_ON)
}

export function vortexSpacing(intensity: number): number {
  return VORTEX_SPACING_MAX + (VORTEX_SPACING_MIN - VORTEX_SPACING_MAX) * intensity
}

export function vortexSizeScale(intensity: number): number {
  return VORTEX_SIZE_MIN_SCALE + (1 - VORTEX_SIZE_MIN_SCALE) * intensity
}

/**
 * 累積到現在這麼多距離，該補幾顆。
 *
 * 【`travelled` 是「上次補點後的餘數 + 這一幀的位移」，不是這一幀的位移】
 * 只吃這一幀位移的話，走不滿一個 `spacing` 的幀會被整幀丟掉 —— 實測那讓
 * 200 m/s @ 60 fps 的實際起效門檻變成 3.93 g（設計說 3.0）、120 m/s 變成
 * 5.80 g、而 120 fps 下 150 m/s **永遠不出現**。那與「虛線的疏密會隨幀率
 * 變化」是同一個病，只是搬到了「有／沒有」這個更嚴重的維度。
 */
export function vortexEmitCount(travelled: number, spacing: number): number {
  if (!(spacing > 0)) return 0
  return Math.min(Math.floor(travelled / spacing), VORTEX_MAX_PER_FRAME)
}

export interface Vortex {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /**
   * 一架飛機的一幀。`l*` / `r*` 是兩個翼尖的**世界座標**。
   *
   * 熱路徑：不配置。`index` 超出座位數直接 return（不丟例外）。
   */
  emit(
    index: number, loadFactor: number,
    lx: number, ly: number, lz: number,
    rx: number, ry: number, rz: number,
  ): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  /** 全部歸零，**含上一幀的翼尖位置與餘數**。換一場戰鬥時呼叫。 */
  reset(): void
  dispose(): void
}

export function createVortex(
  capacity: number = VORTEX_CAPACITY, seats: number = VORTEX_SEATS,
): Vortex {
  const pool = createParticles({
    capacity,
    blending: NormalBlending,
    life: VORTEX_LIFE,
    sizeFrom: VORTEX_SIZE_FROM,
    sizeTo: VORTEX_SIZE_TO,
    gravity: 0,
    drag: VORTEX_DRAG,
    alphaFrom: VORTEX_ALPHA,
    lifeJitter: VORTEX_LIFE_JITTER,
    color: (_t, out) => { out.copy(VORTEX_COLOR) },
  })

  /** 上一幀的兩個翼尖，世界座標。每個座位 6 個數（左 xyz、右 xyz）。 */
  const prev = new Float32Array(seats * 6)
  /**
   * 上次補點之後剩下的距離，m。每個座位兩個（左翼尖、右翼尖）。
   *
   * 【沒有它，功能在真人的幀率下幾乎不出現】見 `vortexEmitCount` 的註解。
   * 與 `smoke.ts` 的 `smokeTimer` 是同一招：把「不滿一格」的部分留到下一幀，
   * 而不是丟掉。
   */
  const carry = new Float32Array(seats * 2)
  /** 這個座位有沒有上一幀。第一幀不發射，見 emit。 */
  const seen = new Uint8Array(seats)

  /**
   * 在一條線段上補點。
   *
   * @param slot `carry` 的索引：座位 × 2 +（0 = 左翼尖、1 = 右翼尖）
   */
  const trail = (
    slot: number,
    px: number, py: number, pz: number,
    x: number, y: number, z: number,
    spacing: number, scale: number,
  ): void => {
    const dx = x - px
    const dy = y - py
    const dz = z - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > VORTEX_MAX_STEP) {
      // 換場／重生／分頁切回：這一段軌跡整段放棄，餘數也不該留
      carry[slot] = 0
      return
    }
    const start = carry[slot]!
    const travelled = start + dist
    let n = vortexEmitCount(travelled, spacing)
    if (n >= VORTEX_MAX_PER_FRAME) {
      // 【被防爆閥夾住就把餘數丟掉】不丟的話 carry 會逐幀累積、沒有上界
      n = VORTEX_MAX_PER_FRAME
      carry[slot] = 0
    } else {
      carry[slot] = travelled - n * spacing
    }
    for (let k = 1; k <= n; k++) {
      // 第 k 顆距離 prevTip 的弧長。start 是「已經走過但還沒補點」的那一段
      const along = k * spacing - start
      // 【t 要夾住】spacing 隨 intensity 逐幀變。從 4.0 掉到 1.5 的那一幀，
      // 上一幀留下的 start（最大 4.0）可能大於這一幀的 spacing，弧長於是是
      // 負的 —— 不夾的話粒子會生在線段**後面**。夾到 0 表示「就生在上一幀
      // 的翼尖位置」，最多兩顆重疊，看不出來。
      const t = along <= 0 ? 0 : (along >= dist ? 1 : along / dist)
      pool.emit(px + dx * t, py + dy * t, pz + dz * t, 0, 0, 0, scale)
    }
  }

  return {
    object: pool.object,
    get live() { return pool.live },

    emit(index, loadFactor, lx, ly, lz, rx, ry, rz): void {
      if (index < 0 || index >= seats) return
      const b = index * 6
      const s = index * 2
      const intensity = vortexIntensity(loadFactor)
      // 【門檻以下也要記錄位置（見下方的無條件寫入）】不記的話，從緩轉切進
      // 硬拉的第一幀會拿到很久以前的位置，拉出一條長線。
      if (intensity > 0 && seen[index] === 1) {
        const spacing = vortexSpacing(intensity)
        const scale = vortexSizeScale(intensity)
        trail(s, prev[b]!, prev[b + 1]!, prev[b + 2]!, lx, ly, lz, spacing, scale)
        trail(s + 1, prev[b + 3]!, prev[b + 4]!, prev[b + 5]!, rx, ry, rz, spacing, scale)
      } else {
        // 【沒在冒尾跡就把餘數歸零】飛機照樣在飛，但那一段軌跡沒有渦。
        // 留著的話，重新拉起來的第一顆會出現在錯的位置。
        carry[s] = 0
        carry[s + 1] = 0
      }
      prev[b] = lx
      prev[b + 1] = ly
      prev[b + 2] = lz
      prev[b + 3] = rx
      prev[b + 4] = ry
      prev[b + 5] = rz
      seen[index] = 1
    },

    step(dt: number): void {
      pool.step(dt)
    },

    reset(): void {
      pool.reset()
      // 【這兩行不能漏】只清粒子池的話，換場後第一幀會從上一場的位置拉一條
      // 線過來。VORTEX_MAX_STEP 擋得住，但不能靠防線當設計 —— 而且靠防線
      // 會讓驗證它的測試變成假綠（見 vortex.test.ts 那一條的註解）。
      seen.fill(0)
      carry.fill(0)
    },

    dispose(): void {
      pool.dispose()
    },
  }
}
