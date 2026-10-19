import { describe, expect, it } from 'vitest'
import { ShaderLib, type InstancedMesh, type Material, type Points } from 'three'
import { createVegetationPools } from '../../src/render/vegetationPools'
import { createVegetationRebuild } from '../../src/render/vegetationRebuild'
import { createVegetation } from '../../src/render/vegetation'
import { createViewShade } from '../../src/render/viewShade'
import { createDrawnTiles, DRAWN_TILES_N, type DrawnTiles } from '../../src/render/drawnTiles'
import { visibleRuns } from '../../src/render/cullRuns'
import { createFloraBuffer, pushFlora, FloraKind, type FloraSource } from '../../src/core/floraBuffer'
import {
  CROSSFADE_SECONDS, FLORA_RADIUS, LOD_HYSTERESIS, LOD_NONE, POOL_NAMES, REBUILD_EVERY, REBUILD_MOVE,
  TILE_SIZE, outerFor,
} from '../../src/render/vegetationPolicy'
import type { PoolName } from '../../src/render/floraShapes'

const FLAT = (): number => 0
const allDirty = (): Record<PoolName, boolean> =>
  Object.fromEntries(POOL_NAMES.map((n) => [n, true])) as Record<PoolName, boolean>

/** 一個位置一株 */
function oneAt(x: number, kind: FloraKind): ReturnType<typeof createFloraBuffer> {
  const b = createFloraBuffer(4)
  pushFlora(b, x, 0, 0, 0, 1, 0.5, kind)
  return b
}

/** 一池掛著那一份三組各幾株：[一般, 淡入, 淡出] */
function groups(pools: ReturnType<typeof createVegetationPools>, name: PoolName): [number, number, number] {
  const p = POOL_NAMES.indexOf(name)
  const sd = pools.side[name]!
  const n = pools.entN[p]![sd]!
  const sum = (a: number, b: number): number => {
    let s = 0
    for (let e = a; e < b; e++) s += pools.entEnd[p]![sd]![e]! - pools.entStart[p]![sd]![e]!
    return s
  }
  return [sum(0, pools.entFadeIn[p]![sd]!), sum(pools.entFadeIn[p]![sd]!, pools.entFadeOut[p]![sd]!),
    sum(pools.entFadeOut[p]![sd]!, n)]
}

/**
 * 兩格各一株闊葉：第 0 格畫面上是中級（2）、現在是點（3）；第 1 格兩者都是中級。
 * 另外第 2 格是新的一格（畫面上沒有）、一棟房子
 */
function twoTiles(capacity = 16) {
  const shade = createViewShade('summer')
  const cap = Object.fromEntries(POOL_NAMES.map((n) => [n, capacity])) as Record<PoolName, number>
  const pools = createVegetationPools(cap, 'summer', 3, shade)
  const tiles = {
    slotBuf: [oneAt(0, FloraKind.BroadTree), oneAt(300, FloraKind.BroadTree), oneAt(600, FloraKind.House)],
    slotUsed: Uint8Array.of(1, 1, 1),
    slotLod: Int8Array.of(3, 2, 2),
    slotBush: Int8Array.of(-1, -1, -1),
    slotShownLod: Int8Array.of(2, 2, LOD_NONE),
    slotShownBush: Int8Array.of(-1, -1, -1),
    slotKey: Float64Array.of(0, 1, 2),
  }
  const stats = { overflow: 0, rebuilds: 0 }
  const rebuild = createVegetationRebuild(cap, tiles, pools, stats)
  return { pools, rebuild, stats, done: () => { pools.dispose(); shade.dispose() } }
}

describe('重建分三組打包（vegetationRebuild）', () => {
  it('換級的株：新池的淡入組與舊池的淡出組；沒換級的在一般組', () => {
    const t = twoTiles()
    t.rebuild.start(allDirty(), true)
    t.rebuild.step(Infinity)
    expect(groups(t.pools, 'broadMid')).toEqual([1, 0, 1])
    expect(groups(t.pools, 'broadPoint')).toEqual([0, 1, 0])
    // 新的一格（畫面上沒有）的房子淡入
    expect(groups(t.pools, 'house')).toEqual([0, 1, 0])
    // 淡出組是舊的樣子：第 0 格那一株的位置
    const p = POOL_NAMES.indexOf('broadMid')
    const sd = t.pools.side.broadMid!
    const ghost = t.pools.entStart[p]![sd]![t.pools.entFadeOut[p]![sd]!]!
    expect(t.pools.altMat.broadMid![sd]!.array[ghost * 16 + 12]).toBe(0)
    expect(t.rebuild.fadePools[p]).toBe(1)
    expect(t.rebuild.fadePools[POOL_NAMES.indexOf('coneMid')]).toBe(0)
    t.done()
  })

  it('不淡的時候全部在一般組', () => {
    const t = twoTiles()
    t.rebuild.start(allDirty(), false)
    t.rebuild.step(Infinity)
    expect(groups(t.pools, 'broadMid')).toEqual([1, 0, 0])
    expect(groups(t.pools, 'broadPoint')).toEqual([1, 0, 0])
    expect(groups(t.pools, 'house')).toEqual([1, 0, 0])
    expect([...t.rebuild.fadePools].every((f) => f === 0)).toBe(true)
    t.done()
  })

  it('溢位時先丟淡出組：一般組照寫', () => {
    const t = twoTiles(1)
    t.rebuild.start(allDirty(), true)
    t.rebuild.step(Infinity)
    expect(groups(t.pools, 'broadMid')).toEqual([1, 0, 0])
    expect(t.stats.overflow).toBe(1)
    t.done()
  })

  it('分幀寫（預算小）與一次寫完的三組相同', () => {
    const a = twoTiles()
    a.rebuild.start(allDirty(), true)
    a.rebuild.step(Infinity)
    const b = twoTiles()
    b.rebuild.start(allDirty(), true)
    while (!b.rebuild.step(1)) { /* 一株一株 */ }
    for (const name of ['broadMid', 'broadPoint', 'house'] as const) {
      expect(groups(b.pools, name)).toEqual(groups(a.pools, name))
    }
    a.done()
    b.done()
  })
})

/** 每一格格心一株闊葉 */
const everyTile: FloraSource = (x0, z0, _x1, _z1, _h, out) => {
  const i = Math.floor(x0 / TILE_SIZE)
  const j = Math.floor(z0 / TILE_SIZE)
  pushFlora(out, (i + 0.5) * TILE_SIZE, 0, (j + 0.5) * TILE_SIZE, 0, 1, 0.5, FloraKind.BroadTree)
}

/** 記下 `publish`、`setFade` 的呼叫 */
function spyDrawn(): { d: DrawnTiles, log: string[] } {
  const d = createDrawnTiles()
  const log: string[] = []
  const publish = d.publish.bind(d)
  const setFade = d.setFade.bind(d)
  d.publish = (f) => { log.push(`publish:${String(f ?? false)}`); publish(f) }
  d.setFade = (t) => { log.push(`fade:${t.toFixed(2)}`); setFade(t) }
  return { d, log }
}

describe('換上之後的淡化（vegetation）', () => {
  it('沒給時間：換上即完成，不淡', () => {
    const { d, log } = spyDrawn()
    const v = createVegetation([everyTile], FLAT, { radius: 1500, drawnTiles: d })
    for (let f = 0; f < 200 && v.stats.rebuilds === 0; f++) v.update(0, 0)
    expect(log).toContain('publish:false')
    expect(log.some((s) => s.startsWith('fade:'))).toBe(false)
    v.dispose()
    d.dispose()
  })

  it('給時間：換上之後半秒內淡完；淡化期間不開始下一次重建', () => {
    const { d, log } = spyDrawn()
    const v = createVegetation([everyTile], FLAT, { radius: 1500, drawnTiles: d })
    let t = 0
    const step = (): void => { t += 1 / 60; v.update(x, 0, t) }
    let x = 0
    while (v.stats.rebuilds === 0) step()
    const at = t
    expect(log).toContain('publish:true')
    // 鏡頭移動到該重建的距離，淡化期間照樣不開始
    x = REBUILD_MOVE * 3
    while (t < at + CROSSFADE_SECONDS - 0.05) {
      step()
      expect(v.stats.rebuilds).toBe(1)
    }
    while (t < at + CROSSFADE_SECONDS + (REBUILD_EVERY + 5) / 60 + 1) step()
    expect(log).toContain('fade:1.00')
    expect(v.stats.rebuilds).toBeGreaterThan(1)
    v.dispose()
    d.dispose()
  })

  it('settle 不淡：淡到一半的直接到終點', () => {
    const { d, log } = spyDrawn()
    const v = createVegetation([everyTile], FLAT, { radius: 1500, drawnTiles: d })
    let t = 0
    while (v.stats.rebuilds === 0) { t += 1 / 60; v.update(0, 0, t) }
    v.update(0, 0, t + 0.1)
    log.length = 0
    v.settle()
    // 淡到終點，之後 settle 自己那一次重建不淡
    expect(log).toContain('fade:1.00')
    expect(log[log.length - 1]).toBe('publish:false')
    log.length = 0
    v.update(0, 0, t + 0.2)
    expect(log.some((s) => s.startsWith('fade:0'))).toBe(false)
    v.dispose()
    d.dispose()
  })
})

describe('出了圈還畫著的格', () => {
  /** 外圈離 `radius` 不到遲滯的那一格：格心出了圈之後它還畫著點 */
  function edgeTile(): { i: number, j: number, outer: number } {
    for (let i = 10; i < 400; i++) {
      const outer = outerFor(i, 0, FLORA_RADIUS)
      if (outer > FLORA_RADIUS - LOD_HYSTERESIS / 2) return { i, j: 0, outer }
    }
    throw new Error('找不到')
  }

  it('會淡化時留到某一次重建把它淡出才放', () => {
    const { i, outer } = edgeTile()
    const one: FloraSource = (x0, z0, _x1, _z1, _h, out) => {
      if (Math.floor(x0 / TILE_SIZE) !== i || Math.floor(z0 / TILE_SIZE) !== 0) return
      pushFlora(out, (i + 0.5) * TILE_SIZE, 0, TILE_SIZE / 2, 0, 1, 0.5, FloraKind.BroadTree)
    }
    const v = createVegetation([one], FLAT, {})
    const cx = (i + 0.5) * TILE_SIZE
    const at = (d: number): number => cx - d
    v.update(at(outer - 50), TILE_SIZE / 2)
    v.settle()
    expect(v.counts.broadPoint).toBe(1)
    // 格心出了圈，但還沒過外圈加遲滯：還畫著，留在快取
    let t = 0
    const go = (d: number, frames: number): void => {
      for (let f = 0; f < frames; f++) { t += 1 / 60; v.update(at(d), TILE_SIZE / 2, t) }
    }
    go(FLORA_RADIUS + Math.min(10, (outer + LOD_HYSTERESIS - FLORA_RADIUS) / 2), 30)
    expect(v.debugTiles().some((x) => x.i === i && x.j === 0)).toBe(true)
    // 過了外圈：重建把它淡出，之後才放
    go(outer + LOD_HYSTERESIS + 60, 400)
    expect(v.counts.broadPoint).toBe(0)
    expect(v.debugTiles().some((x) => x.i === i && x.j === 0)).toBe(false)
    v.dispose()
  })
})

describe('哪些格有畫樹：淡化', () => {
  it('publish(true) 畫面上那一份搬到新的原點、值不變，setFade 漸變到新的', () => {
    const d = createDrawnTiles()
    d.stage(0, 0)
    d.mark(3, 4)
    d.publish()
    // 原點移一格，舊的那一格不再畫、新的一格有畫
    d.stage(1, 0)
    d.mark(5, 4)
    d.publish(true)
    const o = d.uniforms.uTreesOrigin.value
    const tex = d.uniforms.uTreesDrawn.value.image.data as Uint8Array
    const at = (i: number, j: number): number => tex[(j - o.y) * DRAWN_TILES_N + (i - o.x)]!
    expect([at(3, 4), at(5, 4)]).toEqual([255, 0])
    d.setFade(0.5)
    expect([at(3, 4), at(5, 4)]).toEqual([128, 128])
    d.setFade(1)
    expect([at(3, 4), at(5, 4)]).toEqual([0, 255])
    // 測距工具看的是終點
    expect(d.drawnAt(5, 4)).toBe(true)
    d.dispose()
  })
})

describe('剔除的起點參數', () => {
  it('只接第 first 筆到第 n 筆之前', () => {
    const starts = Int32Array.of(0, 5, 10)
    const ends = Int32Array.of(5, 10, 15)
    const boxes = new Float32Array(18)
    // 平面恆在內側：盒子都看得到
    const planes = new Float64Array(24)
    for (let k = 0; k < 6; k++) planes[k * 4 + 3] = 1
    const s = new Int32Array(3)
    const e = new Int32Array(3)
    expect(visibleRuns(3, starts, ends, boxes, planes, 4, s, e, 1)).toBe(1)
    expect([s[0], e[0]]).toEqual([5, 15])
  })
})

describe('抖動交疊的材質', () => {
  function frag(m: Material, base: { fragmentShader: string, vertexShader: string }): string {
    const shader = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader }
    m.onBeforeCompile(shader as never, undefined as never)
    return shader.fragmentShader
  }

  it('淡入、淡出同一支門檻、比較相反；一般材質沒有丟棄', () => {
    const shade = createViewShade('summer')
    const cap = Object.fromEntries(POOL_NAMES.map((n) => [n, 16])) as Record<PoolName, number>
    const pools = createVegetationPools(cap, 'summer', 2, shade)
    pools.setFade(0.3)
    const mesh = (pools.group.children[POOL_NAMES.indexOf('broadMid')] as InstancedMesh)
    const fadeIn = (mesh.children[3] as InstancedMesh).material as Material
    const fadeOut = (mesh.children[7] as InstancedMesh).material as Material
    const a = frag(fadeIn, ShaderLib.standard)
    const b = frag(fadeOut, ShaderLib.standard)
    expect(a).toContain('if (floraFadeThreshold(gl_FragCoord.xy) >= uFade) discard;')
    expect(b).toContain('if (floraFadeThreshold(gl_FragCoord.xy) < uFade) discard;')
    expect(frag(mesh.material as Material, ShaderLib.standard)).not.toContain('discard')
    const pts = pools.group.children[POOL_NAMES.indexOf('broadPoint')] as Points
    const ptIn = frag((pts.children[3] as Points).material as Material, ShaderLib.points)
    expect(ptIn).toContain('if (floraFadeThreshold(gl_FragCoord.xy) >= uFade) discard;')
    // 淡完淡入組改回一般材質
    pools.setFade(null)
    expect((mesh.children[3] as InstancedMesh).material).toBe(mesh.material)
    pools.dispose()
    shade.dispose()
  })
})
