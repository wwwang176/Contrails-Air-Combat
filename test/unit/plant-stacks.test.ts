import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BufferAttribute } from 'three'
import {
  buildPlantScenery, PLANT_GLB_URL, preloadPlantScenery,
} from '../../src/render/geometry/ground/plantScenery'
import { PLANT_BLOCKS, PLANT_CENTER, PLANT_STACKS } from '../../src/world/leuna'

/**
 * 佈景煙囪：打不掉，但會冒煙。從進場方向看過去，煙柱是廠區唯一在遠處就
 * 標定得出自己的東西 —— 只靠十二座可炸構件的話，炸完六座就幾乎不冒了。
 */
describe('佈景煙囪', () => {
  it('至少六根，全部落在非 open 的街廓內，高度 40 m 以上', () => {
    expect(PLANT_STACKS.length).toBeGreaterThanOrEqual(6)
    for (const s of PLANT_STACKS) {
      expect(s.y, `(${s.x},${s.z})`).toBeGreaterThanOrEqual(40)
      const b = PLANT_BLOCKS.find((k) => s.x >= k.x0 && s.x < k.x1 && s.z >= k.z0 && s.z < k.z1)
      expect(b, `煙囪 (${s.x},${s.z}) 不在任何街廓內`).toBeDefined()
      expect(b!.kind, `煙囪 (${s.x},${s.z})`).not.toBe('open')
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

    beforeAll(async () => {
      await preloadPlantScenery((url) => {
        const buf = readFileSync('public' + url)
        const ab = buf.buffer.slice(
          buf.byteOffset, buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer
        return Promise.resolve(ab)
      })
      pos = buildPlantScenery().getAttribute('position') as BufferAttribute
    })

    it('每一根的腳下都有幾何頂到發煙的高度', () => {
      const tops = PLANT_STACKS.map(() => 0)
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i)
        const z = pos.getZ(i)
        for (let k = 0; k < PLANT_STACKS.length; k++) {
          const s = PLANT_STACKS[k]!
          // 只看煙囪腳下那一小塊：其他佈景不會這麼高
          if (Math.abs(x - s.x) > 6 || Math.abs(z - s.z) > 6) continue
          tops[k] = Math.max(tops[k]!, pos.getY(i))
        }
      }
      for (let k = 0; k < PLANT_STACKS.length; k++) {
        const s = PLANT_STACKS[k]!
        expect(tops[k], `煙囪 (${s.x}, ${s.z}) 的幾何頂端只有 ${tops[k]!.toFixed(1)} m`)
          .toBeGreaterThanOrEqual(s.y - 1)
      }
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

    it('迴圈裡不配置記憶體 —— 每幀跑的路徑', () => {
      const loop = only('for (const p of PLANT_STACKS)')
      const body = SRC.slice(loop, loop + 10).join('\n')
      expect(body).not.toMatch(/\bnew\b/)
      expect(body).not.toMatch(/\.map\(|\.filter\(|\.slice\(/)
    })
  })
})
