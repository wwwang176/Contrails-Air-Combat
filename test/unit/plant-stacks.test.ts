import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fillBlock, keepouts } from '../../src/render/geometry/ground/plantFill'
import { PLANT_BLOCKS, PLANT_STACKS } from '../../src/world/leuna'

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
   * 【幾何與座標表要同一份】分家的話煙會從空中冒出來，而畫面上只像是
   * 「這根煙囪比較矮」。
   */
  it('每一根煙囪在它那個街廓的佈景裡都有幾何，頂端就是發煙的高度', () => {
    const blocked = keepouts()
    for (const s of PLANT_STACKS) {
      const b = PLANT_BLOCKS.find((k) => s.x >= k.x0 && s.x < k.x1 && s.z >= k.z0 && s.z < k.z1)!
      let top = 0
      for (const p of fillBlock(b, blocked)) {
        const pos = p.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
          // 只看煙囪腳下那一小塊：其他佈景不會這麼高
          if (Math.abs(pos.getX(i) - s.x) > 6 || Math.abs(pos.getZ(i) - s.z) > 6) continue
          top = Math.max(top, pos.getY(i))
        }
      }
      expect(top, `煙囪 (${s.x},${s.z}) 的幾何頂端`).toBeGreaterThanOrEqual(s.y - 1)
    }
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
