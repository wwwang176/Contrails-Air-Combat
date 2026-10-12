import { describe, it, expect } from 'vitest'
import { createHudFrame, type HudLayout } from '../../src/hud/types'
import { contactBoxRadius, HUD_COLORS, NON_OBJECTIVE_ALPHA } from '../../src/hud/style'
import { drawContacts } from '../../src/hud/widgets/contacts'
import { drawMarkers } from '../../src/hud/widgets/markers'
import { drawGodMarkers } from '../../src/hud/widgets/godMarkers'
import { hudWidgets } from '../../src/hud/Hud'

const LAYOUT: HudLayout = { width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1 }

/** 記下每一筆畫的顏色與透明度（當下值；兩者都會被下一筆覆寫） */
function fakeCtx() {
  const ops: { op: string; color: string; alpha: number }[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0, globalAlpha: 1,
    save(): void {}, restore(): void {}, translate(): void {}, rotate(): void {}, setLineDash(): void {},
    beginPath(): void {}, moveTo(): void {}, lineTo(): void {}, closePath(): void {}, arc(): void {},
    stroke(): void { ops.push({ op: 'stroke', color: ctx.strokeStyle, alpha: ctx.globalAlpha }) },
    strokeRect(): void { ops.push({ op: 'rect', color: ctx.strokeStyle, alpha: ctx.globalAlpha }) },
    fill(): void { ops.push({ op: 'fill', color: ctx.fillStyle, alpha: ctx.globalAlpha }) },
    fillText(): void { ops.push({ op: 'text', color: ctx.fillStyle, alpha: ctx.globalAlpha }) },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, raw: ctx }
}

function contactFrame(objective: boolean, objectiveTargets: boolean) {
  const f = createHudFrame()
  f.objectiveTargets = objectiveTargets
  f.contactCount = 1
  const c = f.contacts[0]!
  Object.assign(c, { active: true, x: 0.2, y: 0.1, behind: false, radius: 0.02, hostile: true, range: 1500, objective })
  return f
}

describe('目標框：主要目標用括號、其餘敵機淡化', () => {
  it('主要目標用同色的四角括號，不畫整個方框、不淡化', () => {
    const { ctx, ops } = fakeCtx()
    drawContacts(ctx, LAYOUT, contactFrame(true, true))
    expect(ops.some(o => o.op === 'rect')).toBe(false)
    const strokes = ops.filter(o => o.op === 'stroke')
    expect(strokes.length).toBeGreaterThan(0)
    for (const o of ops) expect([o.color, o.alpha]).toEqual([HUD_COLORS.danger, 1])
  })

  it('有主要目標的關，其他敵機照舊紅框但淡化', () => {
    const { ctx, ops, raw } = fakeCtx()
    drawContacts(ctx, LAYOUT, contactFrame(false, true))
    expect(ops.find(o => o.op === 'rect')).toEqual({ op: 'rect', color: HUD_COLORS.danger, alpha: NON_OBJECTIVE_ALPHA })
    expect(raw.globalAlpha).toBe(1)
  })

  it('沒有主要目標的關（護航、撤離）照舊：紅框、不淡化', () => {
    const { ctx, ops } = fakeCtx()
    drawContacts(ctx, LAYOUT, contactFrame(false, false))
    expect(ops.find(o => o.op === 'rect')).toEqual({ op: 'rect', color: HUD_COLORS.danger, alpha: 1 })
  })
})

function markerFrame(objectiveTargets: boolean) {
  const f = createHudFrame()
  f.objectiveTargets = objectiveTargets
  return f
}

function putMarker(
  f: ReturnType<typeof createHudFrame>, x: number, y: number, behind: boolean, objective: boolean, range: number,
): void {
  Object.assign(f.markers[f.markerCount]!, {
    active: true, x, y, behind, hostile: true, objective, range,
  })
  f.markerCount++
}

describe('地面與船的標記', () => {
  it('主要目標只畫括號與距離、不畫三角形；其他敵方是淡化的三角形', () => {
    const f = markerFrame(true)
    putMarker(f, 0.1, 0, false, true, 900)
    putMarker(f, -0.1, 0, false, false, 0)
    const { ctx, ops } = fakeCtx()
    drawMarkers(ctx, LAYOUT, f)
    expect(ops).toEqual([
      { op: 'stroke', color: HUD_COLORS.danger, alpha: 1 },
      { op: 'text', color: HUD_COLORS.danger, alpha: 1 },
      { op: 'fill', color: HUD_COLORS.danger, alpha: NON_OBJECTIVE_ALPHA },
    ])
  })

  it('括號跟著物體在畫面上的大小，與目標框同一把尺', () => {
    const f = markerFrame(true)
    putMarker(f, 0, 0, false, true, 300)
    f.markers[0]!.radius = 0.1
    const xs: number[] = []
    const { ctx, raw } = fakeCtx()
    ;(raw as unknown as { lineTo: (x: number) => void }).lineTo = (x: number) => { xs.push(x) }
    drawMarkers(ctx, LAYOUT, f)
    const r = contactBoxRadius(0.1, LAYOUT.unit, LAYOUT.scale)
    expect(Math.max(...xs)).toBeCloseTo(LAYOUT.cx + r, 9)
    expect(Math.min(...xs)).toBeCloseTo(LAYOUT.cx - r, 9)
  })

  it('最近的主要目標在畫面外時畫一個邊緣箭頭；只畫最近那一個', () => {
    const f = markerFrame(true)
    putMarker(f, 3, 0, false, true, 5000)
    putMarker(f, 0, 0, true, true, 2000)
    putMarker(f, -3, 0, false, true, 8000)
    const { ctx, ops } = fakeCtx()
    drawMarkers(ctx, LAYOUT, f)
    expect(ops).toEqual([
      { op: 'fill', color: HUD_COLORS.danger, alpha: 1 },
      { op: 'stroke', color: HUD_COLORS.danger, alpha: 1 },
    ])
  })

  it('最近的主要目標在畫面內就不畫箭頭', () => {
    const f = markerFrame(true)
    putMarker(f, 0.1, 0, false, true, 1000)
    putMarker(f, 3, 0, false, true, 5000)
    const { ctx, ops } = fakeCtx()
    drawMarkers(ctx, LAYOUT, f)
    // 主要目標不畫三角形，填色只會是箭頭
    expect(ops.filter(o => o.op === 'fill').length).toBe(0)
  })
})

describe('上帝視角的分隊框比照座艙', () => {
  function godFrame(objective: boolean, objectiveTargets: boolean) {
    const f = contactFrame(objective, objectiveTargets)
    Object.assign(f.contacts[0]!, { flightLeader: true, flightAlive: 2, flightSize: 4 })
    return f
  }

  it('主要目標的分隊用括號，不畫方框', () => {
    const { ctx, ops } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, godFrame(true, true))
    expect(ops.some(o => o.op === 'rect')).toBe(false)
    expect(ops.filter(o => o.op === 'stroke').length).toBe(1)
    for (const o of ops) expect(o.alpha).toBe(1)
  })

  it('有主要目標的關，其他敵方分隊淡化；沒有時照舊', () => {
    const dim = fakeCtx()
    drawGodMarkers(dim.ctx, LAYOUT, godFrame(false, true))
    expect(dim.ops.find(o => o.op === 'rect')!.alpha).toBe(NON_OBJECTIVE_ALPHA)
    expect(dim.raw.globalAlpha).toBe(1)
    const plain = fakeCtx()
    drawGodMarkers(plain.ctx, LAYOUT, godFrame(false, false))
    expect(plain.ops.find(o => o.op === 'rect')!.alpha).toBe(1)
  })
})

describe('任務目標的邊緣箭頭外面多一圈框', () => {
  function offscreen(objective: boolean) {
    const f = contactFrame(objective, true)
    f.contacts[0]!.x = 5
    return f
  }

  it('任務目標的飛機：實心三角加一圈框，同色', () => {
    const { ctx, ops } = fakeCtx()
    drawContacts(ctx, LAYOUT, offscreen(true))
    expect(ops.filter(o => o.op !== 'text')).toEqual([
      { op: 'fill', color: HUD_COLORS.danger, alpha: 1 },
      { op: 'stroke', color: HUD_COLORS.danger, alpha: 1 },
    ])
  })

  it('其他飛機只有實心三角', () => {
    const { ctx, ops } = fakeCtx()
    drawContacts(ctx, LAYOUT, offscreen(false))
    expect(ops.map(o => o.op)).toEqual(['fill'])
  })

  it('地面任務目標的箭頭也加框', () => {
    const f = markerFrame(true)
    putMarker(f, 5, 0, false, true, 3000)
    const { ctx, ops } = fakeCtx()
    drawMarkers(ctx, LAYOUT, f)
    expect(ops.map(o => o.op)).toEqual(['fill', 'stroke'])
  })
})

describe('開場導覽的 HUD', () => {
  it('只畫標記、目標框與任務列（橫幅）', () => {
    expect(hudWidgets(false, false, true)).toEqual(['markers', 'contacts', 'objective'])
    expect(hudWidgets(true, true, true)).toEqual(['markers', 'contacts', 'objective'])
  })

  it('目標框只畫任務目標；一般目標框、邊緣箭頭不畫', () => {
    const plain = contactFrame(false, true)
    plain.intro = true
    const a = fakeCtx()
    drawContacts(a.ctx, LAYOUT, plain)
    expect(a.ops).toEqual([])
    const off = contactFrame(true, true)
    off.intro = true
    off.contacts[0]!.x = 5
    const b = fakeCtx()
    drawContacts(b.ctx, LAYOUT, off)
    expect(b.ops).toEqual([])
    const on = contactFrame(true, true)
    on.intro = true
    const c = fakeCtx()
    drawContacts(c.ctx, LAYOUT, on)
    expect(c.ops.some(o => o.op === 'stroke')).toBe(true)
  })

  it('標記只畫任務目標框；三角形與邊緣箭頭不畫', () => {
    const f = markerFrame(true)
    f.intro = true
    putMarker(f, 0.1, 0, false, true, 900)
    putMarker(f, -0.1, 0, false, false, 0)
    putMarker(f, 5, 0, false, true, 100)
    const { ctx, ops } = fakeCtx()
    drawMarkers(ctx, LAYOUT, f)
    // 導覽中不標距離：只剩括號
    expect(ops.map(o => o.op)).toEqual(['stroke'])
  })
})
