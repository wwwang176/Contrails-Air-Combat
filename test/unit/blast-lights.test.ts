import { describe, it, expect } from 'vitest'
import { Vector3, type PointLight } from 'three'
import {
  BLAST_LIGHT_COUNT, BLAST_LIGHT_CULL, BLAST_LIGHT_INTENSITY, BLAST_LIGHT_SECONDS_MAX,
  BLAST_LIGHT_SECONDS_MIN, blastLightFalloff, blastLightSeconds, createBlastLights,
  type BlastLights,
} from '../../src/render/blastLights'
import { ordnanceShakeScale } from '../../src/camera/cameraShake'

/** 【用 import.meta.glob 而不是 fs】與 `camera-shake.test.ts` 讀 main.ts 接線同一個做法 */
const MAIN_SRC = Object.values(import.meta.glob('../../src/main.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>)[0]!

const CAM = new Vector3(0, 300, 0)
const lightsOf = (b: BlastLights): PointLight[] => b.object.children as PointLight[]
const lit = (b: BlastLights): PointLight[] => lightsOf(b).filter((l) => l.intensity > 0)

/**
 * 炸彈與魚雷爆炸的閃光。
 *
 * 【它在防什麼】燈數一變每個受光材質就重編著色器（幾百毫秒的卡頓），所以
 * 燈是固定幾盞、沒在用的強度 0；很多顆同時爆也只借那幾盞。
 */
describe('blastLightSeconds：閃光持續時間', () => {
  it('落在 0.1–0.3 秒，當量越大越久', () => {
    expect(blastLightSeconds(0.11)).toBeGreaterThanOrEqual(BLAST_LIGHT_SECONDS_MIN)
    expect(blastLightSeconds(0.11)).toBeLessThan(blastLightSeconds(0.5))
    expect(blastLightSeconds(0.5)).toBeLessThan(blastLightSeconds(1))
    expect(blastLightSeconds(1)).toBe(BLAST_LIGHT_SECONDS_MAX)
    expect(blastLightSeconds(3)).toBe(BLAST_LIGHT_SECONDS_MAX)
    expect(BLAST_LIGHT_SECONDS_MIN).toBeCloseTo(0.1, 9)
    expect(BLAST_LIGHT_SECONDS_MAX).toBeCloseTo(0.3, 9)
  })
})

describe('blastLightFalloff：閃光的衰減', () => {
  it('一開始最亮、到時間歸零、中間單調變暗', () => {
    expect(blastLightFalloff(0, 0.2)).toBe(1)
    expect(blastLightFalloff(0.2, 0.2)).toBe(0)
    expect(blastLightFalloff(0.5, 0.2)).toBe(0)
    const a = blastLightFalloff(0.05, 0.2)
    const b = blastLightFalloff(0.1, 0.2)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(0)
  })
})

describe('createBlastLights：固定幾盞的燈池', () => {
  it('開場就是固定盞數、全部圖層都亮、強度 0', () => {
    const b = createBlastLights()
    expect(lightsOf(b)).toHaveLength(BLAST_LIGHT_COUNT)
    for (const l of lightsOf(b)) {
      expect(l.isPointLight).toBe(true)
      expect(l.intensity).toBe(0)
      expect(l.layers.isEnabled(0)).toBe(true)
      expect(l.layers.isEnabled(1)).toBe(true)
    }
  })

  it('一次爆炸點亮一盞，放在爆心附近', () => {
    const b = createBlastLights()
    b.flash(100, 0, -200, 1, CAM)
    expect(lit(b)).toHaveLength(1)
    const p = lit(b)[0]!.position
    expect(p.x).toBeCloseTo(100, 6)
    expect(p.z).toBeCloseTo(-200, 6)
    expect(p.y).toBeGreaterThanOrEqual(0)
  })

  it('時間到就熄', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 1, CAM)
    b.step(BLAST_LIGHT_SECONDS_MAX + 0.01)
    expect(lit(b)).toHaveLength(0)
  })

  it('小當量的閃光比大當量暗', () => {
    const small = createBlastLights()
    const big = createBlastLights()
    small.flash(0, 0, 0, 0.11, CAM)
    big.flash(0, 0, 0, 1, CAM)
    expect(lit(small)[0]!.intensity).toBeLessThan(lit(big)[0]!.intensity)
  })

  /** 【小彈也要看得出亮】與鏡頭震動同一條放大曲線，60 kg 彈不是基準彈的一成 */
  it('小當量的亮度照鏡頭震動的曲線放大', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 0.11, CAM)
    const l = lit(b)[0]!
    // 尺度存在 Float32Array 裡，比到個位數就夠分出兩條曲線
    expect(l.intensity).toBeCloseTo(BLAST_LIGHT_INTENSITY * ordnanceShakeScale(0.11), 0)
    expect(l.intensity).toBeGreaterThan(BLAST_LIGHT_INTENSITY * 0.5)
  })

  /** 【很多顆同時爆】燈不會變多；新的搶最暗的那一盞 */
  it('燈滿了之後，新的爆炸搶最暗的那一盞', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 1, CAM)
    b.step(0.2)
    b.flash(50, 0, 0, 1, CAM)
    b.flash(100, 0, 0, 1, CAM)
    b.flash(150, 0, 0, 1, CAM)
    expect(lit(b)).toHaveLength(BLAST_LIGHT_COUNT)
    const xs = lit(b).map((l) => Math.round(l.position.x)).sort((p, q) => p - q)
    expect(xs).toEqual([50, 100, 150])
  })

  /** 【高射砲不放大】火網下每秒好幾發，套小當量放大曲線的話整片一直大亮 */
  it('不放大時亮度照原始尺度', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 0.25, CAM, false)
    expect(lit(b)[0]!.intensity).toBeCloseTo(BLAST_LIGHT_INTENSITY * 0.25, 0)
  })

  /** 【小閃光不蓋掉大閃光】高射砲的一發不能把正在亮的炸彈閃光搶走 */
  it('燈滿了而新閃光比最暗的那盞還暗時，不搶', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 1, CAM)
    b.flash(50, 0, 0, 1, CAM)
    b.flash(100, 0, 0, 1, CAM)
    b.flash(150, 0, 0, 0.25, CAM, false)
    const xs = lit(b).map((l) => Math.round(l.position.x)).sort((p, q) => p - q)
    expect(xs).toEqual([0, 50, 100])
  })

  it('離鏡頭太遠的爆炸不點燈', () => {
    const b = createBlastLights()
    b.flash(BLAST_LIGHT_CULL + 500, 0, 0, 1, CAM)
    expect(lit(b)).toHaveLength(0)
  })

  it('reset 全部熄掉', () => {
    const b = createBlastLights()
    b.flash(0, 0, 0, 1, CAM)
    b.reset()
    expect(lit(b)).toHaveLength(0)
  })

  /**
   * 【六種爆炸都打燈】炸彈、魚雷、擊墜、地面目標、艦上砲位、高射砲。
   * 高射砲傳 `false` 不放大；船火與地面火的小爆炸不打（整場會一直閃）。
   */
  it('main.ts 的六種爆炸都打燈，高射砲不放大，火焰不打', () => {
    const main = MAIN_SRC
    const body = (from: string, to: string): string =>
      main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from)))
    for (const fn of ['function emitKillBlasts', 'function emitGroundKills',
      'function emitBombBlasts', 'function emitTorpedoBlasts']) {
      expect(body(fn, '\n}\n'), fn).toContain('blastLights.flash(')
    }
    const flak = body('function shakeFlakBursts', '\n}\n')
    expect(flak).toContain('blastLights.flash(')
    expect(flak).toContain(', false)')
    const gunLost = body('shipModels?.update(world.ships', '})')
    expect(gunLost).toContain('blastLights.flash(')
    expect(body('const emitFirePuff', '\n')).not.toContain('blastLights')
  })

  /** 【煙與地面是同一盞光】煙的著色器讀的就是這一份 */
  it('煙的 uniform 跟著燈走：亮時有顏色與位置，熄了歸零', () => {
    const b = createBlastLights()
    b.flash(30, 0, -40, 1, CAM)
    const colors = b.smokeUniforms.uBlastLightColor.value
    const positions = b.smokeUniforms.uBlastLightPos.value
    const k = colors.findIndex((c) => c.lengthSq() > 0)
    expect(k).toBeGreaterThanOrEqual(0)
    expect(positions[k]!.x).toBeCloseTo(30, 6)
    expect(b.smokeUniforms.uBlastLightRadius.value[k]).toBeGreaterThan(0)
    b.step(BLAST_LIGHT_SECONDS_MAX + 0.01)
    for (const c of colors) expect(c.lengthSq()).toBe(0)
  })
})
