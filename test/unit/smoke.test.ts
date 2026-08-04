import { describe, it, expect } from 'vitest'
import { Color, InstancedMesh, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import {
  createSmoke, emitSmoke, smokeColor, smokePuffs, smokeTimer,
  DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL, SMOKE_ALPHA, SMOKE_DRAG,
  DEBRIS_SMOKE_SIZE, emitKillSmoke, KILL_SMOKE_COUNT, KILL_SMOKE_SIZE,
  SMOKE_GRAVITY, SMOKE_LIFE, SMOKE_RISE, SMOKE_SIZE_FROM,
  SMOKE_SIZE_TO, WRECK_SMOKE_INTERVAL,
} from '../../src/render/smoke'
import { FIREBALL_SIZE_TO } from '../../src/render/fireball'
import { DEBRIS_COUNT, DEBRIS_SIZE_MAX } from '../../src/render/debris'
import { createImpacts, pushImpact } from '../../src/world/events'
import { createKills, pushKill } from '../../src/world/kills'

function decompose(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const scale = new Vector3()
  m.decompose(position, new Quaternion(), scale)
  return { position, scale }
}

describe('smokePuffs / smokeTimer —— 發射器計時', () => {
  it('一幀不到一個間隔就不生', () => {
    expect(smokePuffs(0, 1 / 60, 0.08)).toBe(0)
    expect(smokeTimer(0, 1 / 60, 0.08)).toBeCloseTo(1 / 60, 9)
  })

  it('累積滿一個間隔就生一團，計時器留下餘數', () => {
    // 0.07 + 0.0167 = 0.0867 ≥ 0.08 → 生一團，餘 0.0067
    expect(smokePuffs(0.07, 1 / 60, 0.08)).toBe(1)
    expect(smokeTimer(0.07, 1 / 60, 0.08)).toBeCloseTo(0.07 + 1 / 60 - 0.08, 6)
  })

  it('低幀率時一次補足，不會漏掉整段煙', () => {
    // 【為什麼要補】0.5 s 的長幀若只生一團，煙帶會出現一段 75 m 的空隙。
    expect(smokePuffs(0, 0.5, 0.08)).toBe(6)
  })

  it('間隔為 0 或負值時不生，也不會除以零', () => {
    expect(smokePuffs(0, 1, 0)).toBe(0)
    expect(smokeTimer(0, 1, 0)).toBe(0)
    expect(Number.isFinite(smokePuffs(0, 1, -1))).toBe(true)
  })

  it('殘骸比零件冒得密 —— 主體才是煙的來源', () => {
    expect(WRECK_SMOKE_INTERVAL).toBeLessThan(DEBRIS_SMOKE_INTERVAL)
  })
})

describe('smokeColor', () => {
  it('全程是深灰 —— 黑煙不變色，變的是 alpha', () => {
    // 【在 sRGB 空間讀回】0x1a1a1a 是 sRGB 的寫法，而 Color 內部存線性值。
    // 讀 c.r 會讀到 0.0103，那個數字看不出「這是不是 0x1a1a1a」。
    const c = new Color()
    const v = { r: 0, g: 0, b: 0 }
    for (let i = 0; i <= 10; i++) {
      smokeColor(i / 10, c)
      c.getRGB(v, SRGBColorSpace)
      expect(v.r).toBeLessThan(0.2)
      expect(v.r).toBeCloseTo(v.g, 6)
      expect(v.g).toBeCloseTo(v.b, 6)
    }
  })

  it('確實比深藍海面暗 —— 「黑煙」必須是黑的', () => {
    // 【為什麼要有這條】初版用 setRGB 寫線性值，輸出變成約 0x5c 的中灰，
    // 比海面（0x1d3f5c）還亮 —— 在試驗場上看起來是白霧不是黑煙。這條把
    // 那個方向釘死：煙的亮度必須低於海面。
    const c = new Color()
    smokeColor(0, c)
    const sea = new Color(0x1d3f5c)
    expect(c.r + c.g + c.b).toBeLessThan(sea.r + sea.g + sea.b)
  })
})

describe('黑煙的參數（M8 spec §6）', () => {
  it('上浮寫成加速度，終端速度是 SMOKE_RISE', () => {
    // 【為什麼】積分器只有 gravity 這一個欄位（particles.ts），而終端速度是
    // gravity / drag。要 3 m/s 就得餵 3 × 1.5 = 4.5 m/s²。
    expect(SMOKE_GRAVITY).toBeCloseTo(SMOKE_RISE * SMOKE_DRAG, 9)
    expect(SMOKE_GRAVITY).toBeGreaterThan(0)
  })

  it('會膨脹不會縮小', () => {
    expect(SMOKE_SIZE_TO).toBeGreaterThan(SMOKE_SIZE_FROM)
  })

  it('半透明 —— 不透明的煙會把後面的空戰整個蓋掉', () => {
    expect(SMOKE_ALPHA).toBeGreaterThan(0)
    expect(SMOKE_ALPHA).toBeLessThan(1)
  })

  it('只有少數零件冒煙，不是全部', () => {
    // 【為什麼不寫死數字】這條要守的是「是少數」，不是「恰好是 8」——
    // 數量本來就會依人工驗收調整（4 → 8 已經調過一次）。全部都冒的話
    // 發射器會從 20×8 變成 20×36，穩態從 1,950 團爆到 5,700，而且畫面上
    // 會糊成一片，讀不出「零件在散開」（M8 spec §6.1）。
    expect(DEBRIS_SMOKE_COUNT).toBeGreaterThan(0)
    expect(DEBRIS_SMOKE_COUNT).toBeLessThan(DEBRIS_COUNT / 2)
  })

  it('零件的煙比殘骸的小 —— 0.4 m 的碎片不該掛一顆比它大二十倍的煙球', () => {
    expect(DEBRIS_SMOKE_SIZE).toBeGreaterThan(0)
    expect(DEBRIS_SMOKE_SIZE).toBeLessThan(1)
    // 縮完之後煙團仍然比碎片大（煙本來就該比來源大），但同一個量級
    const smallest = SMOKE_SIZE_FROM * DEBRIS_SMOKE_SIZE
    expect(smallest).toBeGreaterThan(DEBRIS_SIZE_MAX)
    expect(smallest).toBeLessThan(DEBRIS_SIZE_MAX * 4)
  })
})

describe('emitKillSmoke —— 火球褪去之後看得見的那團黑', () => {
  it('一筆擊墜生 KILL_SMOKE_COUNT 團', () => {
    const s = createSmoke(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitKillSmoke(s, e)
    s.step(0.01)
    expect(s.live).toBe(KILL_SMOKE_COUNT)
    s.dispose()
  })

  it('煙球蓋得住火球 —— 不然接不起來', () => {
    // 【為什麼這條是門檻】火球最大 8 m。煙球若比它小，火褪去時黑煙還縮在
    // 中間，讀起來是「火消失了，旁邊有點煙」而不是「火燒成了黑煙」。
    expect(SMOKE_SIZE_FROM * KILL_SMOKE_SIZE).toBeGreaterThan(FIREBALL_SIZE_TO * 0.5)
    expect(SMOKE_SIZE_TO * KILL_SMOKE_SIZE).toBeGreaterThan(FIREBALL_SIZE_TO * 2)
  })

  it('比殘骸拖的煙大得多 —— 那是一團爆炸的煙，不是拖曳', () => {
    expect(KILL_SMOKE_SIZE).toBeGreaterThan(1)
    expect(KILL_SMOKE_SIZE).toBeGreaterThan(DEBRIS_SMOKE_SIZE * 4)
  })

  it('活得比火球久 —— 火熄了煙還在', () => {
    const s = createSmoke(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    emitKillSmoke(s, e)
    // 火球壽命 0.5 s；煙球在那之後必須還活著
    s.step(0.6)
    expect(s.live).toBe(KILL_SMOKE_COUNT)
    s.dispose()
  })
})

describe('emitSmoke', () => {
  it('一筆事件生一團', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 1, 2, 3, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.01)
    expect(s.live).toBe(1)
    expect(decompose(s.object, 0).position.x).toBeCloseTo(1, 4)
    s.dispose()
  })

  it('初速為零 —— 煙生出來就與發射體脫鉤', () => {
    // 【為什麼不跟著跑】拖曳的觀感來自「發射體在動、每一團生在不同位置」。
    // 跟著跑的話整條煙會像一根黏在殘骸上的棍子（M8 spec §6）。
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.1)
    const p = decompose(s.object, 0).position
    expect(Math.abs(p.x)).toBeLessThan(0.01)
    expect(Math.abs(p.z)).toBeLessThan(0.01)
    // 只有上浮
    expect(p.y).toBeGreaterThan(0)
    s.dispose()
  })

  it('往上飄且愈飄愈大', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(0.5)
    const a = decompose(s.object, 0)
    const y0 = a.position.y
    const s0 = a.scale.x
    s.step(0.5)
    const b = decompose(s.object, 0)
    expect(b.position.y).toBeGreaterThan(y0)
    expect(b.scale.x).toBeGreaterThan(s0)
    s.dispose()
  })

  it('壽命結束就死光', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    s.step(SMOKE_LIFE + 0.01)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('連續十秒不產生 NaN', () => {
    const s = createSmoke(32)
    const e = createImpacts(8)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    emitSmoke(s, e)
    for (let i = 0; i < 600; i++) s.step(1 / 60)
    const d = decompose(s.object, 0)
    expect(Number.isFinite(d.position.length())).toBe(true)
    expect(Number.isFinite(d.scale.length())).toBe(true)
    s.dispose()
  })
})
