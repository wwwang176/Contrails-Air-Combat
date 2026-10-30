import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { BoxGeometry, BufferGeometry, Mesh, MeshStandardMaterial, Object3D, Texture, Vector3 } from 'three'
import {
  GRIME_ATLAS_HEIGHT, GRIME_ATLAS_WIDTH, GRIME_CELL, GRIME_COLUMNS, GRIME_LAYOUT_KEY, GRIME_ROWS, GROUND_DUST_WEIGHT,
  applyGroundGrimeUv, groundGrimeLayout, type GrimeRect, type GroundGrimeLayout,
} from '../../src/render/geometry/ground/grime'
import { bakeGroundScene, groundGrimeLayouts, preloadGroundGlbs } from '../../src/render/geometry/ground/glb'
import { GUN_TURRET_KEY, restGeometry, type GunTurretParts } from '../../src/render/geometry/ground/turret'
import { GROUND_MODELS } from '../../src/render/geometry/ground'
import { GROUND_UNITS } from '../../src/specs/ground'
import {
  GROUND_DUST, GROUND_MUD_HEIGHT, applyGroundDust, groundDustMask, groundGrimeStamps, groundMudBands,
} from '../../src/render/groundGrime'

/**
 * # 車輛與地面砲的髒污
 *
 * 守的事：每一個三角形照它的朝向讀到圖集裡對的那一塊（讀錯了髒污會貼到別台車、或整面讀到空白），
 * 雨痕往下（v 朝下），砲塔拆開之後 UV 仍是整台模型座標算的（轉起來髒污跟著零件走）。
 */

function readPublic(url: string): Promise<ArrayBuffer> {
  const b = readFileSync(`public${url}`)
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
}

const inside = (px: number, py: number, r: GrimeRect, eps = 1e-6): boolean =>
  px >= r.x - eps && px <= r.x + r.w + eps && py >= r.y - eps && py <= r.y + r.h + eps

const cellRect = (cell: number): GrimeRect => ({
  x: (cell % GRIME_COLUMNS) * GRIME_CELL, y: Math.floor(cell / GRIME_COLUMNS) * GRIME_CELL, w: GRIME_CELL, h: GRIME_CELL,
})

const regions = (L: GroundGrimeLayout): GrimeRect[] => [L.right, L.left, L.front, L.back, L.top]

const overlap = (a: GrimeRect, b: GrimeRect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('版面', () => {
  it('五塊都在自己那一格裡、互不重疊；比例尺為正', () => {
    const L = groundGrimeLayout(new Vector3(-1.5, 0, -2.6), new Vector3(1.5, 2.35, 4.1), 5)
    expect(L.scale).toBeGreaterThan(0)
    const rs = regions(L)
    for (const r of rs) {
      expect(inside(r.x, r.y, cellRect(5))).toBe(true)
      expect(inside(r.x + r.w, r.y + r.h, cellRect(5))).toBe(true)
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) expect(overlap(rs[i]!, rs[j]!)).toBe(false)
    // 側面的寬是車長、高是車高；車頭的寬是車寬
    expect(L.right.w).toBeCloseTo(6.7 * L.scale, 6)
    expect(L.right.h).toBeCloseTo(2.35 * L.scale, 6)
    expect(L.front.w).toBeCloseTo(3 * L.scale, 6)
  })

  it('圖集排得下所有格；格號超出就丟錯', () => {
    expect(GRIME_ATLAS_WIDTH).toBe(GRIME_COLUMNS * GRIME_CELL)
    expect(GRIME_ATLAS_HEIGHT).toBe(GRIME_ROWS * GRIME_CELL)
    expect(() => groundGrimeLayout(new Vector3(0, 0, 0), new Vector3(1, 1, 1), GRIME_COLUMNS * GRIME_ROWS)).toThrow()
  })
})

describe('貼圖座標照朝向投影', () => {
  // 寬 3（x）、高 2（y）、長 6（z），底面貼地
  const box = (): BufferGeometry => new BoxGeometry(3, 2, 6).translate(0, 1, 0).toNonIndexed()
  const L = groundGrimeLayout(new Vector3(-1.5, 0, -3), new Vector3(1.5, 2, 3), 0)

  it('每一個三角形讀到它朝向的那一塊；側面越高 v 越小（雨痕往下）', () => {
    const g = box()
    applyGroundGrimeUv(g, L)
    const p = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    let seen = 0
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i)
      b.fromBufferAttribute(p, i + 1)
      c.fromBufferAttribute(p, i + 2)
      const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
      const want = Math.abs(n.x) > 0.9 ? (n.x > 0 ? L.right : L.left)
        : Math.abs(n.z) > 0.9 ? (n.z < 0 ? L.front : L.back) : L.top
      for (let k = i; k < i + 3; k++) {
        // UV 存成 Float32：落在邊上的頂點差到萬分之一 px
        expect(inside(uv.getX(k) * GRIME_ATLAS_WIDTH, uv.getY(k) * GRIME_ATLAS_HEIGHT, want, 0.01)).toBe(true)
      }
      if (Math.abs(n.y) < 0.1) {
        for (let k = i; k < i + 3; k++) {
          for (let m = i; m < i + 3; m++) {
            if (p.getY(k) > p.getY(m) + 1e-6) expect(uv.getY(k)).toBeLessThan(uv.getY(m))
          }
        }
      }
      seen++
    }
    expect(seen).toBe(12)
  })

  it('有索引的幾何丟錯 —— 共用頂點的面讀不到各自那一塊', () => {
    expect(() => applyGroundGrimeUv(new BoxGeometry(1, 1, 1), L)).toThrow()
  })
})

const TURRET = { traverse: 'T_Traverse', elevate: 'T_Elevate' }

/** 一座小砲：底座固定、轉盤跟著水平轉、砲管跟著抬 */
function smallGun(): Object3D {
  const steel = new MeshStandardMaterial({ name: 'LP_Steel' })
  const root = new Object3D()
  root.add(new Mesh(new BoxGeometry(2, 0.4, 2).translate(0, 0.2, 0), steel))
  const trav = new Object3D()
  trav.name = TURRET.traverse
  trav.position.set(0, 0.4, 0.1)
  trav.add(new Mesh(new BoxGeometry(1, 0.3, 1).translate(0, 0.15, 0), steel))
  const elev = new Object3D()
  elev.name = TURRET.elevate
  elev.position.set(0, 0.6, -0.2)
  elev.add(new Mesh(new BoxGeometry(0.1, 0.1, 2).translate(0, 0, -1), steel))
  root.add(trav)
  trav.add(elev)
  return root
}

/** 頂點（位置＋UV）當成多重集合比 */
function posUv(g: BufferGeometry): string[] {
  const p = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  const out: string[] = []
  for (let i = 0; i < p.count; i++) {
    out.push([p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i)].map((v) => v.toFixed(5)).join(','))
  }
  return out.sort()
}

describe('烘 GLB', () => {
  it('砲塔拆開的兩塊也有 UV，而且是整台模型座標算的：放回轉軸與不拆的整支逐點相同', () => {
    const whole = bakeGroundScene(smallGun(), undefined, 3)
    const split = bakeGroundScene(smallGun(), TURRET, 3)
    const parts = split.userData[GUN_TURRET_KEY] as GunTurretParts
    for (const g of [split, parts.traverse, parts.elevate]) expect(g.getAttribute('uv')).toBeDefined()
    expect(posUv(restGeometry(split))).toEqual(posUv(whole))
    // 全部落在第 3 格
    const uv = whole.getAttribute('uv')
    for (let i = 0; i < uv.count; i++) {
      expect(inside(uv.getX(i) * GRIME_ATLAS_WIDTH, uv.getY(i) * GRIME_ATLAS_HEIGHT, cellRect(3), 0.01)).toBe(true)
    }
    expect((split.userData[GRIME_LAYOUT_KEY] as GroundGrimeLayout).cell).toBe(3)
  })

  /** 【履帶、輪胎不蒙灰土】深色的橡膠被土色一混就變淺褐，看起來不對（負責人看截圖指出） */
  it('每個頂點帶灰土權重：履帶、輪胎 0，烤漆與帆布 1，其他介於中間', () => {
    expect(GROUND_DUST_WEIGHT['LP_Track']).toBe(0)
    expect(GROUND_DUST_WEIGHT['LP_Tire']).toBe(0)
    for (const m of ['LP_ArmorGreen', 'LP_TruckGreen', 'LP_GunGrey', 'LP_Canvas']) expect(GROUND_DUST_WEIGHT[m]).toBe(1)
    const steel = new MeshStandardMaterial({ name: 'LP_Steel' })
    const track = new MeshStandardMaterial({ name: 'LP_Track' })
    const root = new Object3D()
    root.add(new Mesh(new BoxGeometry(1, 1, 1), steel))
    root.add(new Mesh(new BoxGeometry(1, 1, 1).translate(0, 0, 2), track))
    const g = bakeGroundScene(root)
    const w = g.getAttribute('dustWeight')
    const p = g.getAttribute('position')
    for (let i = 0; i < w.count; i++) {
      expect(w.getX(i)).toBeCloseTo(p.getZ(i) > 1 ? 0 : GROUND_DUST_WEIGHT['LP_Steel']!, 6)
    }
  })

  it('每一支 GLB 各佔一格，格數排得進圖集', async () => {
    const sources = GROUND_UNITS.flatMap((u) => {
      const m = GROUND_MODELS[u.id].model
      return 'glb' in m ? [m.turret === undefined ? { url: m.glb } : { url: m.glb, turret: m.turret }] : []
    })
    await preloadGroundGlbs(sources, readPublic)
    const cells = groundGrimeLayouts().map((L) => L.cell)
    expect(cells.length).toBe(new Set(sources.map((s) => s.url)).size)
    expect(new Set(cells).size).toBe(cells.length)
    for (const c of cells) expect(c).toBeLessThan(GRIME_COLUMNS * GRIME_ROWS)
  })
})

describe('印子與泥巴帶', () => {
  const L = groundGrimeLayout(new Vector3(-1.5, 0, -2.6), new Vector3(1.5, 2.35, 4.1), 1)
  /** 固定序列的亂數 */
  const seq = (): (() => number) => {
    let s = 1
    return () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  }

  it('每一個印子落在它那一塊之內；雨痕只在側面、車頭車尾', () => {
    const stamps = groundGrimeStamps(L, seq())
    expect(stamps.length).toBeGreaterThan(20)
    for (const st of stamps) {
      expect(regions(L)).toContain(st.clip)
      expect(inside(st.x, st.y, st.clip)).toBe(true)
      if (st.kind === 'streak') expect(st.clip).not.toBe(L.top)
    }
  })

  it('印子數跟著面積走：長寬高都放大一倍，雨痕約四倍（泥巴帶是固定高度，不算）', () => {
    const big = groundGrimeLayout(new Vector3(-3, 0, -5.2), new Vector3(3, 4.7, 8.2), 1)
    const streaks = (S: GroundGrimeLayout) => groundGrimeStamps(S, seq()).filter((s) => s.kind === 'streak').length
    const ratio = streaks(big) / streaks(L)
    expect(ratio).toBeGreaterThan(3.5)
    expect(ratio).toBeLessThan(4.5)
  })

  it('泥巴帶在側面、車頭、車尾的下緣，高度是 GROUND_MUD_HEIGHT', () => {
    const bands = groundMudBands(L)
    expect(bands.map((b) => b.clip)).toEqual([L.right, L.left, L.front, L.back])
    for (const b of bands) {
      expect(b.y1).toBeCloseTo(b.clip.y + b.clip.h, 6)
      expect(b.y1 - b.y0).toBeCloseTo(Math.min(GROUND_MUD_HEIGHT * L.scale, b.clip.h), 6)
    }
  })
})

/**
 * 【灰土】整台蒙一層土色：圖集的 alpha 是混進土色的比例（乘法只能變暗，深綠色上加黑點看不出來）。
 * 側面、車頭、車尾越往下越濃，頂面（水平面積灰）一層均勻的，沒用到的地方 0
 */
describe('灰土', () => {
  const L = groundGrimeLayout(new Vector3(-1.5, 0, -2.6), new Vector3(1.5, 2.35, 4.1), 1)
  const mask = groundDustMask([L], () => 0.5)
  const at = (x: number, y: number): number => mask[Math.floor(y) * GRIME_ATLAS_WIDTH + Math.floor(x)]! / 255
  /** 一塊裡某一列的平均 */
  const row = (r: GrimeRect, t: number): number => {
    let s = 0
    const y = r.y + t * (r.h - 1)
    for (let x = r.x; x < r.x + r.w - 1; x++) s += at(x, y)
    return s / Math.floor(r.w - 1)
  }

  it('側面、車頭、車尾越往下越濃，下緣接近 bottom、上緣接近 top', () => {
    for (const r of [L.right, L.left, L.front, L.back]) {
      expect(row(r, 0.95)).toBeGreaterThan(row(r, 0.05) + 0.2)
      expect(row(r, 0.98)).toBeCloseTo(GROUND_DUST.bottom, 1)
      expect(row(r, 0.02)).toBeCloseTo(GROUND_DUST.top, 1)
    }
  })

  it('頂面一層均勻的；圖集沒用到的地方是 0', () => {
    expect(row(L.top, 0.5)).toBeCloseTo(GROUND_DUST.surface, 1)
    expect(at(0, 0)).toBe(0)
    expect(at(GRIME_ATLAS_WIDTH - 1, GRIME_ATLAS_HEIGHT - 1)).toBe(0)
  })

  /** 【土色在頂點色之後混】three 的頂點色在貼圖之後才乘上去；混在前面的話土色也被乘成深綠，變不淺 */
  it('著色器：貼圖的 RGB 照舊乘上去，alpha 在頂點色之後混進土色；字串裡沒有中文（i18n 護欄）', () => {
    const m = new MeshStandardMaterial()
    applyGroundDust(m)
    const shader = {
      vertexShader: 'a\n#include <begin_vertex>\nb',
      fragmentShader: 'a\n#include <map_fragment>\n#include <color_fragment>\nb',
      uniforms: {} as Record<string, { value: unknown }>,
    }
    m.onBeforeCompile(shader as never, undefined as never)
    const f = shader.fragmentShader
    expect(f).not.toContain('#include <map_fragment>')
    expect(f).toContain('diffuseColor.rgb *= sampledDiffuseColor.rgb')
    expect(f.indexOf('mix( diffuseColor.rgb, groundDust, groundDustMix )')).toBeGreaterThan(f.indexOf('#include <color_fragment>'))
    // 灰土乘上頂點的權重（履帶、輪胎 0）
    expect(f).toContain('groundDustMix = sampledDiffuseColor.a * vDustWeight')
    expect(shader.vertexShader).toContain('vDustWeight = dustWeight;')
    expect(shader.uniforms['groundDust']).toBeDefined()
    expect(shader.fragmentShader).not.toMatch(/[一-鿿]/)
    expect(shader.vertexShader).not.toMatch(/[一-鿿]/)
    expect(m.customProgramCacheKey()).toContain('groundDust')
  })
})

describe('材質', () => {
  it('車輛與地面砲讀髒污圖；步兵、火車不讀', async () => {
    vi.resetModules()
    const tex = new Texture()
    vi.doMock('../../src/render/groundGrime', async (orig) => ({
      ...(await orig<typeof import('../../src/render/groundGrime')>()),
      groundGrimeTexture: () => tex,
    }))
    const { createGroundModels } = await import('../../src/render/groundTargets')
    const { preloadGroundModels } = await import('../../src/render/geometry/ground')
    const { createGroundTarget } = await import('../../src/world/groundTargets')
    await preloadGroundModels(readPublic)
    const targets = (['tank', 'flakHeavy', 'infantry', 'locomotive'] as const)
      .map((id, i) => createGroundTarget(i, id, 'red', i * 20, 0, 0))
    const models = createGroundModels(targets)
    type Part = { material: MeshStandardMaterial; children: Part[] }
    const parts = models.object.children.slice(0, 4) as unknown as Part[]
    const maps = () => parts.map((m) => m.material.map)
    expect(maps()).toEqual([tex, tex, null, null])
    // 【每一幀照存活換材質】換回存活的那一份也要是讀髒污的 —— 換成 `live` 的話合批那一池
    // 對不上材質，整批車輛藏起來（遊戲與主選單短片的車輛整個消失）
    models.update(targets, new Vector3(), 0)
    expect(maps()).toEqual([tex, tex, null, null])
    const turret = parts[0]!.children.find((c) => (c as unknown as { name: string }).name !== '')!
    expect(turret.material.map).toBe(tex)
    expect(turret.children[0]!.material.map).toBe(tex)
    models.dispose()
    vi.doUnmock('../../src/render/groundGrime')
  })
})
