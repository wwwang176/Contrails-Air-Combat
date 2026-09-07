import { describe, it, expect } from 'vitest'
import { createHudFrame, type HudLayout } from '../../src/hud/types'
import { drawDials, releaseBandArc } from '../../src/hud/widgets/dials'
import { TORPEDO_ENVELOPE } from '../../src/weapons/releaseEnvelope'

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

const TAU = Math.PI * 2
/** 高度 h 在長針（一圈 1,000 m）上的角度，needle 慣例 */
const needleAngle = (h: number): number => ((h / 1000) % 1) * TAU

describe('releaseBandArc', () => {
  /**
   * 【海上是最常見的情形】地面高 0，所以弧就是包絡的 20…200 m。
   * 長針一圈 1,000 m —— 7.2° 到 72°，佔盤面 18%，讀得出來。
   */
  it('海上、在可投高度附近時給出 20…200 m 的弧', () => {
    const a = releaseBandArc(150, 150, TORPEDO_ENVELOPE)
    expect(a).not.toBeNull()
    expect(a!.from).toBeCloseTo(needleAngle(20), 12)
    expect(a!.to).toBeCloseTo(needleAngle(200), 12)
  })

  /**
   * 【長針每 1,000 m 繞一圈】1,020 m 時針也會落在弧裡 —— 玩家高了十倍而
   * 錶面在說可以投。不在同一圈就不畫。
   */
  it('高出一整圈時不畫 —— 否則錶面會說謊', () => {
    expect(releaseBandArc(1020, 1020, TORPEDO_ENVELOPE)).toBeNull()
  })

  /**
   * 【弧跨過整數邊界就不畫】畫一段繞回盤面另一頭的弧比不畫更難讀。
   * 地面高 900 m 時 lo = 920、hi = 1,100，跨過 1,000。
   */
  it('弧跨過 1,000 m 邊界時不畫', () => {
    expect(releaseBandArc(1050, 150, TORPEDO_ENVELOPE)).toBeNull()
  })

  /**
   * 【跟著地形走】錶讀的是海拔，包絡管的是離地。不補地面高的話，飛在
   * 300 m 高的島上空時弧會畫在錯的刻度上。
   */
  it('地面 300 m 時弧是 320…500 m，不是 20…200', () => {
    const a = releaseBandArc(400, 100, TORPEDO_ENVELOPE)
    expect(a).not.toBeNull()
    expect(a!.from).toBeCloseTo(needleAngle(320), 12)
    expect(a!.to).toBeCloseTo(needleAngle(500), 12)
  })

  /** 【門檻沒有寫死】換一組包絡，弧要跟著變 */
  it('換一組包絡，弧跟著變', () => {
    const env = { ...TORPEDO_ENVELOPE, minAgl: 30, maxAgl: 150 }
    const a = releaseBandArc(100, 100, env)
    expect(a).not.toBeNull()
    expect(a!.from).toBeCloseTo(needleAngle(30), 12)
    expect(a!.to).toBeCloseTo(needleAngle(150), 12)
  })

  it('上界是 Infinity 時不畫 —— 那不是一段弧', () => {
    const env = { ...TORPEDO_ENVELOPE, maxAgl: Infinity }
    expect(releaseBandArc(100, 100, env)).toBeNull()
  })
})

/**
 * 記錄 `arc` 呼叫的替身。
 *
 * 【為什麼一定要驗畫出來的角度】`releaseBandArc` 回的是 **needle 慣例**
 * （0 指 12 點），而 canvas 的 `arc()` 是 0 指 3 點。把前者直接餵給後者的話
 * 上面每一條都還是綠的，而弧會從 12–2 點整段轉到 3–5 點。
 */
function fakeCtx(): {
  ctx: CanvasRenderingContext2D
  arcs: { cx: number; cy: number; r: number; from: number; to: number }[]
} {
  const arcs: { cx: number; cy: number; r: number; from: number; to: number }[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '',
    beginPath(): void {}, closePath(): void {}, clip(): void {},
    moveTo(): void {}, lineTo(): void {}, stroke(): void {}, fill(): void {},
    fillRect(): void {}, strokeRect(): void {},
    fillText(): void {}, save(): void {}, restore(): void {},
    translate(): void {}, rotate(): void {}, setTransform(): void {},
    arc(cx: number, cy: number, r: number, from: number, to: number): void {
      arcs.push({ cx, cy, r, from, to })
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, arcs }
}

/** 盤面本身是整圈（0…2π），不是可投高度弧 */
const isBand = (a: { from: number; to: number }): boolean =>
  !(a.from === 0 && Math.abs(a.to - TAU) < 1e-12)

function torpedoFrame(): ReturnType<typeof createHudFrame> {
  const f = createHudFrame()
  f.ordnance = 'torpedo'
  f.releaseEnv = TORPEDO_ENVELOPE
  f.releaseAgl = 150
  f.altitude = 150
  return f
}

describe('drawDials 畫出來的可投高度弧', () => {
  it('canvas 的角度是 needle 角度減 90°', () => {
    const { ctx, arcs } = fakeCtx()
    drawDials(ctx, LAYOUT, torpedoFrame())
    const band = arcs.filter(isBand)
    expect(band.length).toBe(1)
    const want = releaseBandArc(150, 150, TORPEDO_ENVELOPE)!
    expect(band[0]!.from).toBeCloseTo(want.from - Math.PI / 2, 12)
    expect(band[0]!.to).toBeCloseTo(want.to - Math.PI / 2, 12)
  })

  it('掛炸彈時不畫弧', () => {
    const { ctx, arcs } = fakeCtx()
    const f = torpedoFrame()
    f.ordnance = 'bomb'
    drawDials(ctx, LAYOUT, f)
    expect(arcs.filter(isBand)).toEqual([])
  })

  it('沒有包絡時不畫弧', () => {
    const { ctx, arcs } = fakeCtx()
    const f = torpedoFrame()
    f.releaseEnv = null
    drawDials(ctx, LAYOUT, f)
    expect(arcs.filter(isBand)).toEqual([])
  })

  it('高出一整圈時不畫弧', () => {
    const { ctx, arcs } = fakeCtx()
    const f = torpedoFrame()
    f.altitude = 1020
    f.releaseAgl = 1020
    drawDials(ctx, LAYOUT, f)
    expect(arcs.filter(isBand)).toEqual([])
  })
})
