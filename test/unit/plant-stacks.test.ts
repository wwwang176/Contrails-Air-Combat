import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BufferAttribute } from 'three'
import {
  buildPlantScenery, PLANT_GLB_URL, preloadPlantScenery,
} from '../../src/render/geometry/ground/plantScenery'
import {
  PLANT_BLOCKS, PLANT_CENTER, PLANT_LAYOUT, PLANT_STACKS, worldToPlant,
} from '../../src/world/leuna'
import {
  STEAM_CAPACITY, STEAM_DRAG, STEAM_LIFE, STEAM_PLUME_HEIGHT, STEAM_PLUME_SPEED,
} from '../../src/render/smoke'

/**
 * 煙柱的高度。**它是廠區唯一在遠處就標定得出自己的東西** —— 進場時先看到
 * 煙柱、再看到廠區。柱子矮下去不會有任何錯誤，只是那個功能靜靜地沒了。
 */
describe('蒸汽的柱高', () => {
  /**
   * 【逐格積分驗證】把粒子系統的積分式在這裡重跑一遍
   * （`v ← v·exp(−drag·dt)`、`y ← y + v·dt`），確認 `plumeSpeed` 給的初速
   * 真的會在壽命結束時爬到目標高度。與 `ship-fires.test.ts` 同一套。
   */
  it('跑完壽命剛好爬到 STEAM_PLUME_HEIGHT', () => {
    const dt = 1 / 60
    let v = STEAM_PLUME_SPEED
    let y = 0
    const damp = Math.exp(-STEAM_DRAG * dt)
    for (let t = 0; t < STEAM_LIFE; t += dt) {
      v *= damp
      y += v * dt
    }
    expect(y).toBeGreaterThan(STEAM_PLUME_HEIGHT * 0.99)
    expect(y).toBeLessThan(STEAM_PLUME_HEIGHT * 1.01)
  })

  /**
   * 【出口速度要像煙囪不像噴嘴】柱高固定時阻尼越大、`plumeSpeed` 解出來的
   * 初速越高：`STEAM_DRAG = 0.6` 解出來是 72 m/s，從煙囪口噴出去、半程就
   * 停住。真的煙囪出口是 10–20 m/s，船火的黑煙是 12.1。
   *
   * **柱高那一條抓不到這件事** —— 兩者是自洽的，柱高一樣但爬法完全不同。
   */
  it('出口速度在 8 到 20 m/s 之間 —— 與船火的黑煙同一個量級', () => {
    expect(STEAM_PLUME_SPEED, `出口 ${STEAM_PLUME_SPEED.toFixed(1)} m/s`).toBeGreaterThan(8)
    expect(STEAM_PLUME_SPEED, `出口 ${STEAM_PLUME_SPEED.toFixed(1)} m/s`).toBeLessThan(20)
  })

  it('柱子比最高的煙囪高一半以上 —— 不然只是頂上一坨白色', () => {
    const tallest = Math.max(...PLANT_STACKS.map((s) => s.y))
    expect(STEAM_PLUME_HEIGHT, `最高的煙囪 ${tallest} m`).toBeGreaterThan(tallest * 1.5)
  })

  /**
   * 【容量要照上界配】滿了會覆寫最舊的，而最舊的正是**柱子的頂端** ——
   * 症狀是煙柱莫名其妙變矮，不是任何錯誤。
   */
  it('容量吃得下同時活著的蒸汽', () => {
    const src = new TextDecoder().decode(readFileSync('src/main.ts'))
    const per = Number(/const STEAM_PER_SECOND = (\d+)/.exec(src)?.[1])
    expect(per, '在 main.ts 找不到 STEAM_PER_SECOND').toBeGreaterThan(0)
    const smoking = PLANT_LAYOUT.filter(
      (p) => p.kind === 'chimney' || p.kind === 'coolingTower').length
    const live = (PLANT_STACKS.length + smoking) * per * STEAM_LIFE
    expect(STEAM_CAPACITY, `同時要活 ${live} 顆`).toBeGreaterThanOrEqual(live)
  })
})

/**
 * 佈景煙囪：打不掉，但會冒煙。從進場方向看過去，煙柱是廠區唯一在遠處就
 * 標定得出自己的東西 —— 只靠十二座可炸構件的話，炸完六座就幾乎不冒了。
 */
describe('佈景煙囪', () => {
  it('至少六根，全部落在非 open 的街廓內，高度 40 m 以上', () => {
    expect(PLANT_STACKS.length).toBeGreaterThanOrEqual(6)
    // 煙囪的表匯出的是世界座標，街廓是廠區局部座標 —— 轉到同一個系再比
    const q = { x: 0, z: 0 }
    for (const s of PLANT_STACKS) {
      expect(s.y, `(${s.x},${s.z})`).toBeGreaterThanOrEqual(40)
      worldToPlant(s.x, s.z, q)
      const b = PLANT_BLOCKS.find((k) => q.x >= k.x0 && q.x < k.x1 && q.z >= k.z0 && q.z < k.z1)
      expect(b, `煙囪 (${s.x.toFixed(0)},${s.z.toFixed(0)}) 不在任何街廓內`).toBeDefined()
      expect(b!.kind, `煙囪 (${s.x.toFixed(0)},${s.z.toFixed(0)})`).not.toBe('open')
    }
  })

  /**
   * 【座標必須是世界座標】發煙的迴圈每幀跑，那裡不能有換算，更不能建物件。
   * 廠區中心在 z = −7,000，所以相對偏移那一版會全部落在 0 附近。
   */
  it('座標是世界座標，不是相對廠區中心的偏移', () => {
    for (const s of PLANT_STACKS) expect(s.z).toBeLessThan(-5000)
  })

  /**
   * 【幾何與座標表要同一份】幾何在 Blender 那支腳本裡，發煙的座標在
   * `world/leuna.ts`。分家的話煙會從空中冒出來，而畫面上只像是「這根煙囪
   * 比較矮」。
   */
  describe('GLB 裡真的有這幾根', () => {
    let pos: BufferAttribute
    /** 頂點的廠區局部座標，[x, z] 交錯。廠區是斜的，包圍盒只有在這個系裡才緊 */
    let loc: Float32Array
    /** 煙囪的廠區局部座標 */
    let stacks: { x: number; z: number; y: number }[]

    beforeAll(async () => {
      await preloadPlantScenery((url) => {
        const buf = readFileSync('public' + url)
        const ab = buf.buffer.slice(
          buf.byteOffset, buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer
        return Promise.resolve(ab)
      })
      pos = buildPlantScenery().getAttribute('position') as BufferAttribute
      loc = new Float32Array(pos.count * 2)
      const q = { x: 0, z: 0 }
      for (let i = 0; i < pos.count; i++) {
        worldToPlant(pos.getX(i), pos.getZ(i), q)
        loc[i * 2] = q.x
        loc[i * 2 + 1] = q.z
      }
      stacks = PLANT_STACKS.map((s) => {
        worldToPlant(s.x, s.z, q)
        return { x: q.x, z: q.z, y: s.y }
      })
    })

    it('每一根的腳下都有幾何頂到發煙的高度', () => {
      const tops = stacks.map(() => 0)
      for (let i = 0; i < pos.count; i++) {
        const x = loc[i * 2]!
        const z = loc[i * 2 + 1]!
        for (let k = 0; k < stacks.length; k++) {
          const s = stacks[k]!
          // 只看煙囪腳下那一小塊：其他佈景不會這麼高
          if (Math.abs(x - s.x) > 6 || Math.abs(z - s.z) > 6) continue
          tops[k] = Math.max(tops[k]!, pos.getY(i))
        }
      }
      for (let k = 0; k < stacks.length; k++) {
        const s = stacks[k]!
        expect(tops[k], `煙囪 (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`
          + ` 的幾何頂端只有 ${tops[k]!.toFixed(1)} m`).toBeGreaterThanOrEqual(s.y - 1)
      }
    })

    /**
     * 【煙囪不能被蓋住】填充器的避讓表只有十二座可炸構件與廠內道路 ——
     * 佈景煙囪不在裡面的話，儲槽與廠房會直接蓋在它身上。
     *
     * 【上面那一條抓不到這件事】它只取煙囪腳下的最高點，而蓋住它的廠房本身
     * 就很高 —— 煙囪整支埋掉它還是綠的。
     *
     * 【怎麼分辨是不是煙囪自己的三角形】煙囪是六邊錐，最寬處只有 2r ≈ 6 m。
     * XY 跨度超過 12 m 而且把整支煙囪包在裡面的，一定是別人的。
     */
    it('沒有別的佈景蓋在煙囪上', () => {
      const bad: string[] = []
      for (const s of stacks) {
        const r = s.y * 0.045
        for (let t = 0; t < pos.count; t += 3) {
          let ax = Infinity
          let az = Infinity
          let bx = -Infinity
          let bz = -Infinity
          let top = -Infinity
          for (let k = 0; k < 3; k++) {
            const X = loc[(t + k) * 2]!
            const Z = loc[(t + k) * 2 + 1]!
            ax = Math.min(ax, X); bx = Math.max(bx, X)
            az = Math.min(az, Z); bz = Math.max(bz, Z)
            top = Math.max(top, pos.getY(t + k))
          }
          if (bx - ax < 12 && bz - az < 12) continue
          if (top < 4 || top > s.y) continue
          if (ax > s.x - r || bx < s.x + r || az > s.z - r || bz < s.z + r) continue
          bad.push(`煙囪 (${s.x.toFixed(0)}, ${s.z.toFixed(0)})`
            + ` 被一個高 ${top.toFixed(0)} m 的東西蓋住`)
          break
        }
      }
      expect(bad.join('\n')).toBe('')
    })

    /**
     * 【平移要驗墊面內的部分】沿連外道路的電線桿一路排到地圖邊緣，整份幾何的
     * 包圍盒中心離廠區有十幾公里 —— 拿它比對等於量電線桿排到哪裡。
     */
    it('廠區的幾何以 PLANT_CENTER 為中心 —— GLB 的原點是廠區中心，載入時平移', () => {
      let minZ = Infinity
      let maxZ = -Infinity
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const z = pos.getZ(i)
        if (Math.abs(x - PLANT_CENTER.x) > 1500 || Math.abs(z - PLANT_CENTER.z) > 750) continue
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      expect((minZ + maxZ) / 2).toBeCloseTo(PLANT_CENTER.z, -2)
      expect(PLANT_GLB_URL).toContain('leuna_plant')
    })
  })

  /**
   * 【接線護欄】上面幾條驗的是資料。這一條讀 `main.ts` 的原始碼，守的是
   * 「真的有人拿 `PLANT_STACKS` 去發煙」—— 少了那一段，資料仍然正確，
   * 畫面上就是不冒煙。
   */
  describe('接到發煙迴圈', () => {
    const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).split('\n')
    const only = (needle: string): number => {
      const hits: number[] = []
      for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
      expect(hits, `main.ts 裡「${needle}」應該只出現一次，實際 ${hits.length} 次`).toHaveLength(1)
      return hits[0]!
    }

    it('`emitPlantSteam` 裡走過 PLANT_STACKS 並且呼叫 steam.emit', () => {
      const fn = only('function emitPlantSteam(')
      const loop = only('for (const p of PLANT_STACKS)')
      expect(loop).toBeGreaterThan(fn)
      // 迴圈與函式尾之間要有一次 emit
      const emits: number[] = []
      for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes('steam.emit(')) emits.push(i)
      expect(emits.length, 'steam.emit 應該有兩處：佈景煙囪與活著的構件').toBe(2)
      expect(emits[0]).toBeGreaterThan(loop)
    })

    /**
     * 【垂直初速不能是 0】靠浮力那一版的終端速度只有 2 m/s、8 秒爬 20 m ——
     * 疊在 60 m 的煙囪頂上，從投彈高度看是黏了一坨白色，不是一根煙柱。
     * 這一條讀原始碼，因為柱高由**呼叫端傳的初速**決定，粒子池只負責積分。
     */
    it('兩處 steam.emit 的垂直初速都是 STEAM_PLUME_SPEED', () => {
      let found = 0
      for (let i = 0; i < SRC.length; i++) {
        if (!SRC[i]!.includes('steam.emit(')) continue
        found++
        expect(SRC.slice(i, i + 3).join(' '), `第 ${i + 1} 行的 steam.emit`)
          .toContain('STEAM_PLUME_SPEED')
      }
      expect(found, 'steam.emit 應該有兩處').toBe(2)
    })

    /**
     * 【風向要固定】每一顆各抽一個方向的話，柱子是往四面散開的一叢 ——
     * 真的煙囪是整片往同一邊斜。
     */
    it('水平初速走固定風向加抖動，不是逐顆隨機的方位角', () => {
      const body = SRC.join('\n')
      expect(body).toContain('STEAM_WIND_X')
      expect(body).toContain('STEAM_GUST')
      const loop = only('for (const p of PLANT_STACKS)')
      expect(SRC.slice(loop, loop + 8).join('\n')).not.toMatch(/Math\.PI \* 2/)
    })

    it('迴圈裡不配置記憶體 —— 每幀跑的路徑', () => {
      const loop = only('for (const p of PLANT_STACKS)')
      const body = SRC.slice(loop, loop + 10).join('\n')
      expect(body).not.toMatch(/\bnew\b/)
      expect(body).not.toMatch(/\.map\(|\.filter\(|\.slice\(/)
    })
  })
})
