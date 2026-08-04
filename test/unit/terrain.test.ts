import { describe, it, expect } from 'vitest'
import { createTerrain } from '../../src/render/terrain'
import { gerstnerHeight } from '../../src/render/ocean'

describe('createTerrain（M10 spec §5.2）', () => {
  it('高度場與 gerstnerHeight 逐點一致', () => {
    // 【為什麼這條非有不可】畫面上的浪由 shader 算、撞得到的浪由 CPU 算，
    // 兩份公式必須是同一份。包一層之後最容易發生的錯就是「包錯了那一份」。
    const t = createTerrain('sea')
    for (const [x, z, time] of [
      [0, 0, 0], [123, -456, 7.5], [-9000, 9000, 61.25], [37, 37, 0.001],
    ] as const) {
      expect(t.heightAt(x, z, time)).toBe(gerstnerHeight(x, z, time))
    }
    t.dispose()
  })

  it('object 底下同時有海面與參照物', () => {
    const t = createTerrain('sea')
    expect(t.object.children.length).toBe(2)
    t.dispose()
  })

  it('dispose 真的釋放 geometry 與 material', () => {
    // 【為什麼不是「呼叫了不會爆」就算過】洩漏的症狀是「玩久了愈來愈慢」，
    // 離成因非常遠。這裡掛 three.js 的 dispose 事件直接數。
    const t = createTerrain('sea')
    let disposed = 0
    t.object.traverse((o) => {
      const m = o as unknown as {
        geometry?: { addEventListener(e: string, f: () => void): void }
        material?: { addEventListener(e: string, f: () => void): void }
      }
      m.geometry?.addEventListener('dispose', () => { disposed++ })
      m.material?.addEventListener('dispose', () => { disposed++ })
    })
    t.dispose()
    // 海面一組、參照物一組
    expect(disposed).toBe(4)
  })

  it('update 之後海面跟著中心捲動', () => {
    const t = createTerrain('sea')
    const sea = t.object.children[0]!
    t.update(0, 5000, -3000)
    expect(sea.position.x).toBeGreaterThan(4000)
    expect(sea.position.z).toBeLessThan(-2000)
    t.dispose()
  })

  it('建立與釋放十次不會拋錯 —— 每場重建要能一直做下去', () => {
    for (let i = 0; i < 10; i++) createTerrain('sea').dispose()
  })
})
