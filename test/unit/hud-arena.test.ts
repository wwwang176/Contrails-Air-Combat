import { describe, it, expect } from 'vitest'
import { drawArena } from '../../src/hud/widgets/arena'
import { drawMinimap, MINIMAP_OBJECTIVE_DOT } from '../../src/hud/widgets/minimap'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import { hudWidgets, WIDGET_DRAW } from '../../src/hud/Hud'
import { SKIRMISH_ARENA } from '../../src/world/arena'

const ARENA_RADIUS = SKIRMISH_ARENA.radius
import { t } from '../../src/i18n'

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

/**
 * 【與 `hud.test.ts` 的 `fakeCtx` 同一個手法】canvas 在 node 沒有實作，
 * 但這兩個 widget 只碰幾個成員。多記了 `arc` —— 小地圖的界是一個圓。
 */
function fakeCtx(): {
  ctx: CanvasRenderingContext2D
  texts: { text: string; x: number; y: number; color: string }[]
  arcs: { x: number; y: number; r: number; color: string; fill: string; alpha: number }[]
} {
  const texts: { text: string; x: number; y: number; color: string }[] = []
  const arcs: { x: number; y: number; r: number; color: string; fill: string; alpha: number }[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, globalAlpha: 1,
    fillText(text: string, x: number, y: number): void {
      texts.push({ text, x, y, color: String(ctx.fillStyle) })
    },
    arc(x: number, y: number, r: number): void {
      arcs.push({ x, y, r, color: String(ctx.strokeStyle), fill: String(ctx.fillStyle), alpha: ctx.globalAlpha })
    },
    save(): void {}, restore(): void {},
    beginPath(): void {}, stroke(): void {}, fill(): void {},
    moveTo(): void {}, lineTo(): void {}, closePath(): void {},
    rect(): void {}, fillRect(): void {}, strokeRect(): void {}, clip(): void {},
    translate(): void {}, rotate(): void {}, scale(): void {},
    measureText(): { width: number } { return { width: 10 } },
  } as unknown as CanvasRenderingContext2D & { strokeStyle: string; fillStyle: string }
  return { ctx, texts, arcs }
}

describe('返回戰場的警告', () => {
  it('界內不畫任何東西', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.arenaOutside = false
    const c = fakeCtx()
    drawArena(c.ctx, LAYOUT, f)
    expect(c.texts).toHaveLength(0)
  })

  it('界外畫警告與秒數', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.arenaOutside = true
    f.arenaRemaining = 8.4
    const c = fakeCtx()
    drawArena(c.ctx, LAYOUT, f)
    const texts = c.texts.map((x) => x.text)
    expect(texts).toContain(t('hud.returnToArena'))
    // 【進位】剩 0.2 秒顯示 0 會讓玩家以為已經沒救了
    expect(texts).toContain('9')
  })

  it('這一場沒有界就完全不畫', () => {
    const f = createHudFrame()
    f.arenaShow = false
    f.arenaOutside = true
    f.arenaRemaining = 3
    const c = fakeCtx()
    drawArena(c.ctx, LAYOUT, f)
    expect(c.texts).toHaveLength(0)
  })

  it('createHudFrame 的初值是界內、而且沒有界；界的位置是遭遇戰的', () => {
    const f = createHudFrame()
    expect(f.arenaOutside).toBe(false)
    expect(f.arenaShow).toBe(false)
    expect([f.arenaX, f.arenaZ, f.arenaRadius]).toEqual([0, 0, ARENA_RADIUS])
  })
})

/**
 * 【這一組才是承重的】只呼叫 `drawArena` 的話，**widget 根本沒註冊也會
 * 全綠** —— 畫面上什麼都不會出現而測試不知道。
 */
describe('警告真的被排進繪製清單', () => {
  it('座艙視角畫得到', () => {
    expect(hudWidgets(false)).toContain('arena')
  })

  /**
   * 【上帝視角也要有】界在上帝視角下照樣會殺玩家（`main.ts` 的 crashPolicy
   * 不看視角）。只加進 FULL 的話，上帝視角裡飛機會無預警爆炸。
   */
  it('上帝視角也畫得到', () => {
    expect(hudWidgets(true)).toContain('arena')
  })

  it('WIDGET_DRAW 有這一格', () => {
    expect(typeof WIDGET_DRAW.arena).toBe('function')
  })

  /** 【排在 objective 之前】objective 是這一場的規則，壓最上層 */
  it('排在 objective 之前', () => {
    const full = hudWidgets(false)
    expect(full.indexOf('arena')).toBeLessThan(full.indexOf('objective'))
  })
})

describe('小地圖上的界', () => {
  /** 小地圖的半徑是 4 km（`minimap.ts` 的 RANGE），界是 12 km */
  const size = Math.min(LAYOUT.width, LAYOUT.height) * 0.19
  const px = size / (2 * 4000)

  it('圓心是世界原點相對於玩家', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.worldX = 3000
    f.worldZ = -1000
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    const hit = c.arcs.find((a) => Math.abs(a.r - ARENA_RADIUS * px) < 1e-6)
    expect(hit).toBeDefined()
    expect(hit!.x).toBeCloseTo(-3000 * px, 6)
    expect(hit!.y).toBeCloseTo(1000 * px, 6)
  })

  it('任務的界：圓心與半徑照這一場的界，不是世界原點', () => {
    const f = createHudFrame()
    f.arenaShow = true
    f.arenaX = 2000
    f.arenaZ = -4000
    f.arenaRadius = 13000
    f.worldX = 3000
    f.worldZ = -1000
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    const hit = c.arcs.find((a) => Math.abs(a.r - 13000 * px) < 1e-6)
    expect(hit).toBeDefined()
    expect(hit!.x).toBeCloseTo((2000 - 3000) * px, 6)
    expect(hit!.y).toBeCloseTo((-4000 + 1000) * px, 6)
  })

  it('沒有界就不畫那個圓', () => {
    const f = createHudFrame()
    f.arenaShow = false
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    for (const a of c.arcs) expect(Math.abs(a.r - ARENA_RADIUS * px)).toBeGreaterThan(1e-6)
  })
})

/**
 * 小地圖上的主要目標：頭上標距離的船與地面目標，畫成小圓點。
 * 只畫主要目標 —— 洛伊納一關有幾十個砲位，全畫的話小地圖會被點蓋滿。
 */
describe('小地圖上的主要目標', () => {
  const size = Math.min(LAYOUT.width, LAYOUT.height) * 0.19
  const px = size / (2 * 4000)
  const dots = (c: ReturnType<typeof fakeCtx>) => c.arcs.filter((a) => a.r === MINIMAP_OBJECTIVE_DOT * LAYOUT.scale)

  function frameWith(markers: { x: number; z: number; objective: boolean; hostile?: boolean }[]) {
    const f = createHudFrame()
    f.worldX = 1000
    f.worldZ = 2000
    markers.forEach((m, i) => {
      const k = f.markers[i]!
      k.active = true
      k.worldX = m.x
      k.worldZ = m.z
      k.objective = m.objective
      k.hostile = m.hostile ?? true
    })
    f.markerCount = markers.length
    return f
  }

  it('主要目標畫成小實心圓點，位置是相對自機的世界座標；不是主要目標的不畫', () => {
    const f = frameWith([{ x: 2000, z: 1500, objective: true }, { x: 1500, z: 2500, objective: false }])
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    const d = dots(c)
    expect(d).toHaveLength(1)
    expect(d[0]!.x).toBeCloseTo((2000 - 1000) * px, 6)
    expect(d[0]!.y).toBeCloseTo((1500 - 2000) * px, 6)
    expect(d[0]!.fill).toBe(HUD_COLORS.danger)
    expect(d[0]!.alpha).toBe(1)
  })

  it('顏色跟著敵我與警戒：友方藍、還沒警戒的敵方黃', () => {
    const f = frameWith([{ x: 1100, z: 2000, objective: true, hostile: false }, { x: 900, z: 2000, objective: true }])
    f.enemyUnaware = true
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    expect(dots(c).map((a) => a.fill)).toEqual([HUD_COLORS.friendly, HUD_COLORS.unaware])
  })

  /** 【超出範圍貼邊、半透明】與接觸點同一條規則：方位對、距離不對 */
  it('超出地圖範圍的貼在框邊、半透明', () => {
    const f = frameWith([{ x: 1000, z: 2000 - 20000, objective: true }])
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    const d = dots(c)
    expect(d).toHaveLength(1)
    expect(d[0]!.alpha).toBeLessThan(1)
    expect(Math.abs(d[0]!.y)).toBeLessThan(size / 2)
    expect(Math.abs(d[0]!.y)).toBeGreaterThan(size / 2 - 10)
  })

  it('沒有用到的格子不畫（markerCount 之後）', () => {
    const f = frameWith([{ x: 1100, z: 2000, objective: true }])
    f.markerCount = 0
    const c = fakeCtx()
    drawMinimap(c.ctx, LAYOUT, f)
    expect(dots(c)).toHaveLength(0)
  })
})
