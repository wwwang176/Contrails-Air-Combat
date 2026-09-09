import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Color, type BufferAttribute } from 'three'
import {
  buildPlantScenery, PLANT_GLB_URL, preloadPlantScenery,
} from '../../src/render/geometry/ground/plantScenery'
import {
  PLANT_BLOCKS, PLANT_LAYOUT, PLANT_PAD, ROADS, worldToPlant,
} from '../../src/world/leuna'
import { PLANT_SIZE } from '../../src/render/geometry/ground/plant'
import { PLANT_MATERIALS } from '../../src/render/geometry/ground/glb'

/**
 * 廠區佈景的護欄。幾何來自 `tools/blender/build_plant.py` 匯出的 GLB，所以
 * 這裡驗的是**真正進遊戲的那一份** —— 不是某支生成函式的輸出。
 *
 * 【這一組同時守住兩份街廓表沒分岔】佈局在 Blender 那支腳本裡，而地面著色器
 * 的鋪面（碴石、裸土）讀的是 `world/leuna.ts` 的 `PLANT_BLOCKS`。兩邊漂掉的
 * 症狀是「調車場的碴石地上長滿了儲槽」，而畫面上只像是配色怪。
 */
const CELL = 10

function readGlb(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync('public' + url)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return Promise.resolve(ab)
}

/**
 * 三角形的 XZ 包圍盒塗進 10 m 格。**高估法** —— 斜的長條會塗滿整個包圍盒。
 * 吃的是廠區局部座標（`loc`），因為街廓與墊面都活在那個系裡。
 */
function paint(
  loc: Float32Array, x0: number, z0: number, nx: number, nz: number,
): Uint8Array {
  const grid = new Uint8Array(nx * nz)
  for (let t = 0; t < loc.length / 2; t += 3) {
    let ax = Infinity
    let az = Infinity
    let bx = -Infinity
    let bz = -Infinity
    for (let k = 0; k < 3; k++) {
      const X = loc[(t + k) * 2]!
      const Z = loc[(t + k) * 2 + 1]!
      ax = Math.min(ax, X); bx = Math.max(bx, X)
      az = Math.min(az, Z); bz = Math.max(bz, Z)
    }
    const i0 = Math.max(0, Math.floor((ax - x0) / CELL))
    const i1 = Math.min(nx - 1, Math.floor((bx - x0) / CELL))
    const j0 = Math.max(0, Math.floor((az - z0) / CELL))
    const j1 = Math.min(nz - 1, Math.floor((bz - z0) / CELL))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
  }
  return grid
}

function ratio(grid: Uint8Array): number {
  let on = 0
  for (const v of grid) on += v
  return on / grid.length
}

describe('廠區的佈景網格', () => {
  let pos: BufferAttribute
  let col: BufferAttribute
  /**
   * 每個頂點的廠區局部座標，[x, z] 交錯。
   *
   * 【為什麼要另存一份】GLB 的頂點是世界座標（廠區的朝向烘在節點變換裡），
   * 而墊面、街廓、構件的表全是廠區局部座標 —— 直接拿世界座標去比，整片
   * 廠區會被判成「在墊面外」。
   */
  let loc: Float32Array

  beforeAll(async () => {
    await preloadPlantScenery(readGlb)
    const g = buildPlantScenery()
    pos = g.getAttribute('position') as BufferAttribute
    col = g.getAttribute('color') as BufferAttribute
    loc = new Float32Array(pos.count * 2)
    const q = { x: 0, z: 0 }
    for (let i = 0; i < pos.count; i++) {
      worldToPlant(pos.getX(i), pos.getZ(i), q)
      loc[i * 2] = q.x
      loc[i * 2 + 1] = q.z
    }
  })

  it('一顆幾何、有頂點色與法線、沒有共用頂點', () => {
    const g = buildPlantScenery()
    expect(g.index).toBeNull()
    expect(g.getAttribute('color')).toBeDefined()
    expect(g.getAttribute('normal')).toBeDefined()
  })

  /**
   * 【下限與上限都要】只有上限的話，密度縮水沒有人會發現 —— 而縮水的樣子
   * 就是這一輪要治的那塊空水泥板。
   */
  it('三角形在 15 萬到 40 萬之間', () => {
    const tris = pos.count / 3
    expect(tris, `實際 ${tris}`).toBeGreaterThanOrEqual(150_000)
    expect(tris, `實際 ${tris}`).toBeLessThanOrEqual(400_000)
  })

  it('沒有任何頂點在地面以下', () => {
    let minY = Infinity
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i))
    expect(minY).toBeGreaterThanOrEqual(-0.01)
  })

  /**
   * 【墊面外只准有那兩樣】砲位的沙包與沿連外道路的電線桿。其餘全部要在
   * 墊面加圍牆之內 —— 一個街廓的座標算錯會把整區丟到田裡，而畫面上只是
   * 「這一區怎麼在廠外」。
   */
  it('墊面外的三角形只有沙包與電線桿那麼多，而且不出地圖', () => {
    let outside = 0
    let far = 0
    for (let t = 0; t < pos.count; t += 3) {
      const dx = Math.abs((loc[t * 2]! + loc[(t + 1) * 2]! + loc[(t + 2) * 2]!) / 3)
        - PLANT_PAD.halfX
      const dz = Math.abs((loc[t * 2 + 1]! + loc[(t + 1) * 2 + 1]! + loc[(t + 2) * 2 + 1]!) / 3)
        - PLANT_PAD.halfZ
      if (dx > 2 || dz > 2) {
        outside++
        const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3
        const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3
        far = Math.max(far, Math.hypot(x, z))
      }
    }
    const share = outside / (pos.count / 3)
    expect(share, `墊面外佔 ${(share * 100).toFixed(1)}%`).toBeLessThan(0.08)
    expect(far, `最遠的東西在 ${(far / 1000).toFixed(1)} km`).toBeLessThan(23_000)
  })

  /**
   * 【俯視覆蓋率】這一關的視距重心是投彈高度的俯視，而「填滿」是可以量的。
   * 十二座可炸構件的腳印也算進來：玩家看到的是整片廠區，不分佈景與目標。
   */
  it('墊面的俯視覆蓋率至少 35%', () => {
    const x0 = -PLANT_PAD.halfX
    const z0 = -PLANT_PAD.halfZ
    const nx = Math.round((PLANT_PAD.halfX * 2) / CELL)
    const nz = Math.round((PLANT_PAD.halfZ * 2) / CELL)
    const grid = paint(loc, x0, z0, nx, nz)
    for (const t of PLANT_LAYOUT) {
      const s = PLANT_SIZE[t.kind]
      const i0 = Math.max(0, Math.floor((t.dx - s.x / 2 - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.floor((t.dx + s.x / 2 - x0) / CELL))
      const j0 = Math.max(0, Math.floor((t.dz - s.z / 2 - z0) / CELL))
      const j1 = Math.min(nz - 1, Math.floor((t.dz + s.z / 2 - z0) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * nx + i] = 1
    }
    const r = ratio(grid)
    expect(r, `覆蓋率只有 ${(r * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.35)
  })

  /**
   * 【要逐街廓量，不能只量整片】只量整片的話，整區空掉會被別區補回來。
   * 這一條同時守住 Blender 的街廓表與 `PLANT_BLOCKS` 沒有分岔。
   */
  it('每一個非 open 街廓的覆蓋率至少 25%，open 街廓低於 12%', () => {
    for (const b of PLANT_BLOCKS) {
      const nx = Math.max(1, Math.round((b.x1 - b.x0) / CELL))
      const nz = Math.max(1, Math.round((b.z1 - b.z0) / CELL))
      const r = ratio(paint(loc, b.x0, b.z0, nx, nz))
      const where = `${b.kind} (${b.x0.toFixed(0)}, ${b.z0.toFixed(0)}) = ${(r * 100).toFixed(1)}%`
      if (b.kind === 'open') expect(r, where).toBeLessThan(0.12)
      else expect(r, where).toBeGreaterThanOrEqual(0.25)
    }
  })

  /**
   * 【佈景不能壓在禁區上】佈景沒有命中盒。疊上去會看到炸彈穿過管架在構件
   * 上爆，畫面上像是命中判定壞了。
   *
   * 【量三角形的包圍盒，不是頂點】一根橫貫的管子可以整段穿過命中盒而兩端的
   * 頂點都在盒外 —— 只驗頂點的話它是綠的。
   */
  it('沒有任何三角形與構件或道路的禁區相交', () => {
    // 【禁區與三角形都在廠區局部座標】構件的表本來就是局部的；廠內道路的
    // 折線是世界的，轉回來之後仍然是軸對齊矩形（它們就是照巷道擺的）
    const zones: { what: string; x0: number; z0: number; x1: number; z1: number }[] = []
    for (const t of PLANT_LAYOUT) {
      const s = PLANT_SIZE[t.kind]
      zones.push({
        what: `構件 ${t.kind}`,
        x0: t.dx - s.x / 2 - 6, x1: t.dx + s.x / 2 + 6,
        z0: t.dz - s.z / 2 - 6, z1: t.dz + s.z / 2 + 6,
      })
    }
    /**
     * 【只管廠內的三條】連外的兩條穿過田野，而西邊那個砲位本來就坐在西門
     * 那條路邊 —— 它周圍的沙包當然壓在路上。拿連外道路去檢查墊面外的佈景，
     * 量到的是關卡佈局，不是佈景擺錯。
     */
    const q = { x: 0, z: 0 }
    const toLocal = (p: { x: number; z: number }): { x: number; z: number } => {
      worldToPlant(p.x, p.z, q)
      return { x: q.x, z: q.z }
    }
    const inPad = (p: { x: number; z: number }): boolean =>
      Math.abs(p.x) <= PLANT_PAD.halfX + 1 && Math.abs(p.z) <= PLANT_PAD.halfZ + 1
    for (const road of ROADS) {
      for (let s = 0; s + 1 < road.length; s++) {
        const a = toLocal(road[s]!)
        const b = toLocal(road[s + 1]!)
        if (!inPad(a) || !inPad(b)) continue
        zones.push({
          what: `道路 (${a.x.toFixed(0)},${a.z.toFixed(0)})→(${b.x.toFixed(0)},${b.z.toFixed(0)})`,
          x0: Math.min(a.x, b.x) - 8, x1: Math.max(a.x, b.x) + 8,
          z0: Math.min(a.z, b.z) - 8, z1: Math.max(a.z, b.z) + 8,
        })
      }
    }
    let bad = ''
    for (let t = 0; t < pos.count && bad === ''; t += 3) {
      let ax = Infinity
      let az = Infinity
      let bx = -Infinity
      let bz = -Infinity
      for (let k = 0; k < 3; k++) {
        const X = loc[(t + k) * 2]!
        const Z = loc[(t + k) * 2 + 1]!
        ax = Math.min(ax, X); bx = Math.max(bx, X)
        az = Math.min(az, Z); bz = Math.max(bz, Z)
      }
      for (const z of zones) {
        if (bx > z.x0 + 0.01 && ax < z.x1 - 0.01 && bz > z.z0 + 0.01 && az < z.z1 - 0.01) {
          bad = `佈景壓在${z.what}上：(${ax.toFixed(1)}…${bx.toFixed(1)}, `
            + `${az.toFixed(1)}…${bz.toFixed(1)})`
          break
        }
      }
    }
    expect(bad).toBe('')
  })

  /**
   * 【平交道上不准有軌道】廠內廠外都一樣。地面著色器是先鋪碴石再鋪柏油，
   * 路面壓在碴石上；軌道的薄板連續鋪過去的話，軌枕會浮在路面上 —— 而那在
   * 畫面上只是「這段路的顏色怪怪的」。
   *
   * 只挑軌道色的三角形：連外道路旁邊本來就有電線桿與砲位的沙包。
   */
  it('沒有一塊軌道壓在道路上，連外的也算', () => {
    const rail = PLANT_MATERIALS['LP_PlantRail']!
    const same = Object.entries(PLANT_MATERIALS).filter(([, hex]) => hex === rail)
    expect(same.map(([n]) => n), '軌道色不是軌道專用的').toEqual(['LP_PlantRail'])
    const c = new Color(rail)
    /** 點到線段的距離 */
    const near = (x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number => {
      const vx = b.x - a.x
      const vz = b.z - a.z
      const L = vx * vx + vz * vz
      const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L))
      return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t))
    }
    let bad = ''
    for (let t = 0; t < pos.count && bad === ''; t += 3) {
      if (Math.abs(col.getX(t) - c.r) > 1e-3 || Math.abs(col.getZ(t) - c.b) > 1e-3) continue
      const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3
      const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3
      for (const road of ROADS) {
        for (let s = 0; s + 1 < road.length; s++) {
          if (near(x, z, road[s]!, road[s + 1]!) < 8) {
            bad = `軌道壓在道路 (${road[s]!.x},${road[s]!.z})→(${road[s + 1]!.x},`
              + `${road[s + 1]!.z}) 上：(${x.toFixed(0)}, ${z.toFixed(0)})`
            break
          }
        }
      }
    }
    expect(bad).toBe('')
  })

  it('GLB 的路徑是遊戲會去要的那一支', () => {
    expect(PLANT_GLB_URL).toBe('/models/leuna_plant.glb')
  })

  /**
   * 【manifest 不得過期】GLB 裡多一個材質、或表裡多一個沒人用的名字，都是
   * `build_plant.py` 與遊戲的合約漂掉了。少了這一條，Blender 那邊改個材質名
   * 會在載入時丟例外 —— 而那一關進不去，每一條單元測試還是綠的。
   */
  it('GLB 用到的材質全在 PLANT_MATERIALS 裡，表裡也沒有沒人用的名字', () => {
    const used = new Set(buildPlantScenery().userData['materials'] as string[])
    expect(used.size).toBeGreaterThan(0)
    for (const name of used) {
      expect(PLANT_MATERIALS[name], `GLB 的材質 ${name} 不在表裡`).toBeDefined()
    }
    for (const name of Object.keys(PLANT_MATERIALS)) {
      expect(used.has(name), `表裡的 ${name} 沒有人用`).toBe(true)
    }
  })
})
