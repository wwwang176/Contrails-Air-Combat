import { describe, it, expect } from 'vitest'
import {
  createVortex, vortexEmitCount, vortexIntensity, vortexSizeScale, vortexSpacing,
  VORTEX_G_FULL, VORTEX_G_ON, VORTEX_MAX_PER_FRAME, VORTEX_MAX_STEP,
  VORTEX_SEATS, VORTEX_SIZE_MIN_SCALE, VORTEX_SPACING_MAX, VORTEX_SPACING_MIN,
} from '../../src/render/vortex'
import { MAX_COMBATANTS } from '../../src/battle/skirmish'

describe('vortexIntensity', () => {
  it('平飛 1 g 什麼都沒有', () => {
    expect(vortexIntensity(1)).toBe(0)
  })

  it('門檻上恰好是 0', () => {
    expect(vortexIntensity(VORTEX_G_ON)).toBe(0)
  })

  it('拉滿是 1，超過也夾在 1', () => {
    expect(vortexIntensity(VORTEX_G_FULL)).toBe(1)
    expect(vortexIntensity(10)).toBe(1)
  })

  /**
   * 【為什麼取絕對值】負 G（推桿）時機翼一樣被載重，只是方向相反，翼尖
   * 一樣會凝。這條防的是有人把 Math.abs 拿掉。
   */
  it('負 G 與同大小的正 G 相同', () => {
    expect(vortexIntensity(-5)).toBe(vortexIntensity(5))
  })

  it('門檻與拉滿之間是連續遞增的', () => {
    const mid = (VORTEX_G_ON + VORTEX_G_FULL) / 2
    expect(vortexIntensity(mid)).toBeGreaterThan(0)
    expect(vortexIntensity(mid)).toBeLessThan(1)
  })
})

describe('vortexSpacing', () => {
  it('剛過門檻是最寬的間隔（＝斷續的淡痕）', () => {
    expect(vortexSpacing(0)).toBe(VORTEX_SPACING_MAX)
  })

  it('拉滿是最窄的間隔（＝連成實心白帶）', () => {
    expect(vortexSpacing(1)).toBe(VORTEX_SPACING_MIN)
  })

  it('隨 intensity 遞減', () => {
    expect(vortexSpacing(0.7)).toBeLessThan(vortexSpacing(0.3))
  })
})

describe('vortexSizeScale', () => {
  it('剛過門檻粒子最小', () => {
    expect(vortexSizeScale(0)).toBe(VORTEX_SIZE_MIN_SCALE)
  })

  it('拉滿是原尺寸', () => {
    // 【用 toBeCloseTo 不用 toBe】0.45 + 0.55 在 IEEE754 下剛好落回 1.0，
    // 但那是巧合不是保證 —— 換一組常數就會差一個 ulp，而這條守的是「拉滿
    // 等於原尺寸」這個意思，不是浮點數的位元。
    expect(vortexSizeScale(1)).toBeCloseTo(1, 12)
  })
})

describe('vortexEmitCount', () => {
  it('距離不足一個間隔就不發射', () => {
    expect(vortexEmitCount(1.4, 1.5)).toBe(0)
  })

  it('剛好三個間隔發三顆', () => {
    expect(vortexEmitCount(4.5, 1.5)).toBe(3)
  })

  it('被每幀上限夾住', () => {
    expect(vortexEmitCount(1000, 1.5)).toBe(VORTEX_MAX_PER_FRAME)
  })
})

/** `emit` 的六個座標：兩個翼尖，世界座標。整架沿 +X 移到 `x`。 */
function tips(x: number): [number, number, number, number, number, number] {
  return [x, 1000, 0, x, 1000, 10]
}

describe('凝結尾的發射', () => {
  /**
   * 【第一幀不發射】尾跡是「上一幀翼尖 → 這一幀翼尖」那條線段上的補點，
   * 第一幀沒有上一幀可以連。少了這道守衛，換場後第一幀會從一個未初始化的
   * 位置（0,0,0）拉一條線過來。
   */
  it('第一幀只記錄位置，不發射', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.dispose()
  })

  it('第二幀才開始發射', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })

  it('G 在門檻以下不發射', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(20))
    expect(v.live).toBe(0)
    v.dispose()
  })

  /**
   * 【門檻以下也要記錄位置】不記的話，從緩轉切進硬拉的第一幀會拿到很久
   * 以前的位置，拉出一條長線。這條測試是那個行為的唯一防線。
   */
  it('門檻以下仍然記錄位置，切進高 G 時不會拉長線', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(20))   // 低 G 走了 20 m
    v.emit(0, 6, ...tips(23))   // 切進高 G，只走了 3 m
    // intensity(6) = (6−3)/3.5 = 0.857 → spacing = 4.0 − 2.5×0.857 = 1.857
    // （**不是 1.5**；1.5 是 6.5 g 才有的）。floor(3 / 1.857) = 1，兩個翼尖
    // 共 2 顆。若拿到的是 0 m 那一幀的位置，距離會是 23 m →
    // floor(23/1.857) = 12 → 被每幀上限夾到 8，兩翼尖 16 顆。
    expect(v.live).toBeLessThanOrEqual(2 * 2)
    v.dispose()
  })

  /**
   * 【超過 MAX_STEP 不發射】擋的是換場、重生、接手、以及分頁切回來時的
   * 巨大 dt —— 否則會出現一條橫跨半個地圖的白線。
   */
  it('位移超過上限不發射，但位置有記錄下來', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(VORTEX_MAX_STEP * 10))
    expect(v.live).toBe(0)
    // 下一幀恢復正常：從剛剛記錄的位置起算，只走了 6 m
    v.emit(0, 6, ...tips(VORTEX_MAX_STEP * 10 + 6))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })

  it('單幀不超過每翼尖上限 × 2', () => {
    const v = createVortex()
    v.emit(0, 6.5, ...tips(0))
    v.emit(0, 6.5, ...tips(VORTEX_MAX_STEP - 1))
    expect(v.live).toBe(VORTEX_MAX_PER_FRAME * 2)
    v.dispose()
  })

  /**
   * 【reset 也要清上一幀的位置】只清粒子池的話，換場後第一幀會從上一場的
   * 位置拉一條線過來。MAX_STEP 是防線，但不能靠防線當設計。
   *
   * 【第三幀的位移必須落在 MAX_STEP 之內】否則那道防線會先擋掉，把
   * `seen` 的清除拿掉之後這條**照樣綠** —— 那正是假綠。20 m 的位移下，
   * 壞掉的實作會發出 floor(20/1.857)=10→夾 8，兩翼尖 16 顆。
   */
  it('reset 清掉粒子與上一幀的位置', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.reset()
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(40))
    expect(v.live).toBe(0)      // 又是第一幀
    v.dispose()
  })

  it('座位超出範圍不會爆，也不踩到別的座位', () => {
    const v = createVortex()
    v.emit(VORTEX_SEATS, 6, ...tips(0))
    v.emit(VORTEX_SEATS, 6, ...tips(20))
    v.emit(-1, 6, ...tips(0))
    expect(v.live).toBe(0)
    // 【只斷言 live === 0 是守不住「不踩別人」的】拿掉守衛之後：prev[384]
    // 讀回 undefined → undefined! 參與運算得 NaN → NaN > 60 為 false →
    // floor(NaN/s) 為 NaN → k <= NaN 不執行 → 0 顆；而 typed array 的越界
    // 寫入在 JS 是靜默 no-op。live 仍是 0，測試照樣綠。真正驗得到的是：
    // 座位 0 的第一次 emit 仍然必須是「第一幀」。
    v.emit(0, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })
})

/**
 * 【這一組是整份設計裡最該存在的兩條】初稿的 `vortexEmitCount` 吃的是
 * 「這一幀的位移」而不是「累積距離」，**沒有餘數累積** —— 一幀走不滿一個
 * spacing 就整幀丟掉。實測那讓功能在真人的幀率下幾乎不出現：
 *
 *   200 m/s @ 60 fps（每幀 3.33 m）→ 實際起效 3.93 g（設計說 3.0）
 *   120 m/s @ 60 fps（每幀 2.00 m）→ 實際起效 5.80 g  ← 低速纏鬥，正是拉最大 G 的地方
 *   150 m/s @ 120 fps（每幀 1.25 m）→ **永遠不出現**（< SPACING_MIN）
 *
 * 而原本沒有任何一條測試抓得到：所有有狀態的測試與 e2e 都在 7.5 fps 的
 * 量級（每幀 20 m 以上），那正好是唯一不會出問題的區間。
 */
describe('餘數跨幀累積（幀率不變性）', () => {
  it('連續幾幀各走不滿一個間隔，累積之後才發射', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))          // 第一幀只記錄
    // spacing = 1.857。每幀走 0.5 m：
    v.emit(0, 6, ...tips(0.5))        // 累積 0.5
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(1.0))        // 累積 1.0
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(1.5))        // 累積 1.5
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(2.0))        // 累積 2.0 > 1.857 → 兩個翼尖各 1 顆
    expect(v.live).toBe(2)
    v.dispose()
  })

  /**
   * 【幀率不變性的操作型定義】走同樣的總距離，一大步與多小步必須發出
   * 同樣多的粒子。沒有這一條，「同一個動作在不同機器上長得一樣」只是
   * 一個願望。
   */
  it('9 m 走一步與 1.5 m 走六步發出一樣多', () => {
    const big = createVortex()
    big.emit(0, 6, ...tips(0))
    big.emit(0, 6, ...tips(9))
    const one = big.live
    big.dispose()

    const small = createVortex()
    small.emit(0, 6, ...tips(0))
    for (let k = 1; k <= 6; k++) small.emit(0, 6, ...tips(k * 1.5))
    const many = small.live
    small.dispose()

    // floor(9 / 1.857) = 4；小步版本 0+1+1+1+1+0 = 4。各 × 兩個翼尖 = 8
    expect(one).toBe(8)
    expect(many).toBe(8)
  })
})

/**
 * 【跨層一致性，只有測試守得到】`vortex.ts` 依設計不得 import
 * `src/battle/`，所以 `VORTEX_SEATS` 與 `MAX_COMBATANTS` 這兩個常數在產品碼
 * 裡永遠碰不到面。這條是「有人把 20v20 改成 32v32 卻沒動 VORTEX_SEATS」的
 * 唯一防線 —— 症狀會是編號較大的那幾架完全沒有尾跡，而不是任何錯誤。
 */
describe('座位數容得下全部參戰者', () => {
  it('VORTEX_SEATS 不小於 MAX_COMBATANTS', () => {
    expect(VORTEX_SEATS).toBeGreaterThanOrEqual(MAX_COMBATANTS)
  })
})
