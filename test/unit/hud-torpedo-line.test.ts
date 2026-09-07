import { describe, it, expect } from 'vitest'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import {
  drawTorpedoLine, runFrontCount, torpedoLineVisible,
} from '../../src/hud/widgets/torpedoLine'
import { TORPEDO_RANGE, TORPEDO_RUN_SAMPLES } from '../../src/world/torpedo'

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

/**
 * 記錄呼叫的 canvas 替身。
 *
 * 【為什麼要記顏色的當下值】`strokeStyle` 會被下一段路徑覆寫，最後讀一次
 * 的話每一段都會顯示成最後那一個顏色 —— 逐段的紅綠就沒有被測到。
 * 與 `hud.test.ts` 的 `fakeCtx` 同一條理由。
 */
function fakeCtx(): {
  ctx: CanvasRenderingContext2D
  paths: { pts: { x: number; y: number }[]; color: string; width: number }[]
  texts: { text: string; x: number; y: number; color: string }[]
} {
  const paths: { pts: { x: number; y: number }[]; color: string; width: number }[] = []
  const texts: { text: string; x: number; y: number; color: string }[] = []
  let pts: { x: number; y: number }[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0,
    beginPath(): void { pts = [] },
    moveTo(x: number, y: number): void { pts.push({ x, y }) },
    lineTo(x: number, y: number): void { pts.push({ x, y }) },
    stroke(): void {
      paths.push({ pts, color: String(ctx.strokeStyle), width: Number(ctx.lineWidth) })
    },
    fillText(text: string, x: number, y: number): void {
      texts.push({ text, x, y, color: String(ctx.fillStyle) })
    },
  } as unknown as CanvasRenderingContext2D & {
    strokeStyle: string; fillStyle: string; lineWidth: number
  }
  return { ctx, paths, texts }
}

/**
 * 一幀「正在投彈模式、掛魚雷、解得出落點、全部取樣點都在相機前面」的畫面。
 * 取樣點沿畫面往上排，NDC 由 −0.4 遞增到 0.4。
 */
function torpedoFrame(count = TORPEDO_RUN_SAMPLES): ReturnType<typeof createHudFrame> {
  const f = createHudFrame()
  f.bombing = true
  f.ordnance = 'torpedo'
  f.bombState = 'solved'
  f.releaseOk = true
  f.runCount = count
  for (let k = 0; k < TORPEDO_RUN_SAMPLES; k++) {
    f.runX[k] = 0
    f.runY[k] = -0.4 + (0.8 * k) / (TORPEDO_RUN_SAMPLES - 1)
  }
  return f
}

/**
 * 【為什麼要數「從 0 起連續」而不是總數】相機後面的點投影出來是**穿過中心
 * 鏡射**的：它不會跑到無限遠讓你發現，它落在畫面上、方向剛好相反，而
 * canvas 再乾乾淨淨地把它裁到畫面邊緣。
 *
 * 只數總數的話，畫出來是一條線條漂亮、方向錯 180° 的瞄準線 —— 不拋例外、
 * 不會有測試紅。
 */
describe('runFrontCount', () => {
  it('全部在前面就是全部', () => {
    const z = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5])
    expect(runFrontCount(z, 5)).toBe(5)
  })

  it('第一點就在後面 → 0，整條不畫', () => {
    const z = new Float64Array([1.5, 0.2, 0.3, 0.4, 0.5])
    expect(runFrontCount(z, 5)).toBe(0)
  })

  it('中間有一點在後面就停在它之前', () => {
    const z = new Float64Array([0.1, 0.2, 1.5, 0.4, 0.5])
    expect(runFrontCount(z, 5)).toBe(2)
  })

  /** 【後面又變回前面不得復活】這一條就是鏡射線的守門員 */
  it('斷掉之後再出現的前方點不算數', () => {
    const z = new Float64Array([0.1, 1.5, 0.3, 0.4, 0.5])
    expect(runFrontCount(z, 5)).toBe(1)
  })

  it('z 恰好等於 1 算在後面', () => {
    const z = new Float64Array([0.1, 1, 0.3, 0.4, 0.5])
    expect(runFrontCount(z, 5)).toBe(1)
  })

  it('只數到 n 為止 —— 陣列比 n 長時後面那幾格不看', () => {
    const z = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5])
    expect(runFrontCount(z, 3)).toBe(3)
  })
})

describe('torpedoLineVisible', () => {
  it('四條都成立才畫', () => {
    expect(torpedoLineVisible(torpedoFrame())).toBe(true)
  })

  it('一般飛行不畫 —— 負責人裁決', () => {
    const f = torpedoFrame()
    f.bombing = false
    expect(torpedoLineVisible(f)).toBe(false)
  })

  it('掛炸彈不畫', () => {
    const f = torpedoFrame()
    f.ordnance = 'bomb'
    expect(torpedoLineVisible(f)).toBe(false)
  })

  it('解不出落點不畫', () => {
    const f = torpedoFrame()
    f.bombState = 'none'
    expect(torpedoLineVisible(f)).toBe(false)
  })

  it('只剩一個點在相機前面時不畫 —— 一個點連不成線', () => {
    const f = torpedoFrame(1)
    expect(torpedoLineVisible(f)).toBe(false)
  })

  /**
   * 【`bombVisible` 不進判準】那一格額外要求**圈**落在畫面內，而線的起點
   * 滑出畫面時，線本身還有一大段在畫面裡。
   */
  it('落點圈滑出畫面時照樣畫線', () => {
    const f = torpedoFrame()
    f.bombVisible = false
    expect(torpedoLineVisible(f)).toBe(true)
  })
})

describe('drawTorpedoLine', () => {
  it('不該畫的時候一筆都不畫', () => {
    const { ctx, paths, texts } = fakeCtx()
    const f = torpedoFrame()
    f.bombing = false
    drawTorpedoLine(ctx, LAYOUT, f)
    expect(paths).toEqual([])
    expect(texts).toEqual([])
  })

  /**
   * 【線是一條，刻度各自一條】主線一筆，刻度每一個取樣點各一筆（入水點
   * 不畫刻度 —— 落點圈已經在那裡）。
   */
  it('主線走過每一個在相機前面的取樣點', () => {
    const { ctx, paths } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, torpedoFrame())
    const main = paths[0]!
    expect(main.pts.length).toBe(TORPEDO_RUN_SAMPLES)
    // NDC → px：與 bombsight 同一套換算
    expect(main.pts[0]!.x).toBeCloseTo(640, 6)
    expect(main.pts[0]!.y).toBeCloseTo(360 - (-0.4 * 720) / 2, 6)
  })

  it('斷在相機後面時，主線只走到最後一個前方點', () => {
    const { ctx, paths } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, torpedoFrame(3))
    expect(paths[0]!.pts.length).toBe(3)
  })

  it('入水點不畫刻度，其餘每一點各一個', () => {
    const { ctx, paths } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, torpedoFrame())
    // 主線 1 筆 + 刻度 (SAMPLES − 1) 筆
    expect(paths.length).toBe(TORPEDO_RUN_SAMPLES)
  })

  /**
   * 【顏色與落點圈同一個判定】兩者各判一次的話會出現「圈紅線綠」。
   */
  it('可投時綠、不可投時紅，主線與刻度一致', () => {
    for (const [releaseOk, want] of [
      [true, HUD_COLORS.primary], [false, HUD_COLORS.danger],
    ] as const) {
      const { ctx, paths } = fakeCtx()
      const f = torpedoFrame()
      f.releaseOk = releaseOk
      drawTorpedoLine(ctx, LAYOUT, f)
      for (const p of paths) expect(p.color, `releaseOk=${releaseOk}`).toBe(want)
    }
  })

  /**
   * 【末端要標出射程】玩家自己估提前量，就得知道一格是多少。給一個錨點
   * 就夠 —— 四個數字疊在低空畫面上是噪音。
   */
  it('走得到末端時標出射程，而且標的是 TORPEDO_RANGE', () => {
    const { ctx, texts } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, torpedoFrame())
    expect(texts.length).toBe(1)
    expect(texts[0]!.text).toBe(String(TORPEDO_RANGE))
  })

  it('沒走到末端就不標 —— 那個數字會是假的', () => {
    const { ctx, texts } = fakeCtx()
    drawTorpedoLine(ctx, LAYOUT, torpedoFrame(TORPEDO_RUN_SAMPLES - 1))
    expect(texts).toEqual([])
  })
})
