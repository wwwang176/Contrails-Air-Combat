import { describe, it, expect } from 'vitest'
import { createTerrain } from '../../src/render/terrain'
import { FAR_SEA_Y, gerstnerHeight } from '../../src/render/ocean'

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

  it('object 底下有遠海、細浪面與參照物', () => {
    const t = createTerrain('sea')
    // 【2 → 3】海從此是兩層：以鏡頭為中心 10 km 的細浪面，加上墊在底下、
    // 跟著鏡頭走的 500 km 平海（`ocean.farMesh`）—— 沒有它的話上帝視角
    // 爬高就會看到海是一塊浮在天上的板子。
    expect(t.object.children.length).toBe(3)
    t.dispose()
  })

  it('dispose 真的釋放 geometry 與 material', () => {
    // 【為什麼不是「呼叫了不會爆」就算過】洩漏的症狀是「玩久了愈來愈慢」，
    // 離成因非常遠。這裡掛 three.js 的 dispose 事件直接數。
    const t = createTerrain('sea')
    // 【要數「不同的物件」，不是數次數】細浪面現在是一組 clipmap 的層
    // （見 `OCEAN_BASE_CELL`），十層各有自己的 geometry 但**共用同一份
    // material**。照物件數的話材質會被登記十次、一次 dispose 觸發十個回呼，
    // 而那個數字會隨層數漂移 —— 測到的就變成「有幾層」而不是「有沒有洩漏」。
    const pending = new Set<object>()
    const disposed = new Set<object>()
    const watch = (r?: { addEventListener(e: string, f: () => void): void }): void => {
      if (r === undefined || pending.has(r)) return
      pending.add(r)
      r.addEventListener('dispose', () => { disposed.add(r) })
    }
    t.object.traverse((o) => {
      const m = o as unknown as {
        geometry?: { addEventListener(e: string, f: () => void): void }
        material?: { addEventListener(e: string, f: () => void): void }
      }
      watch(m.geometry)
      watch(m.material)
    })
    t.dispose()
    // **每一個被掛上的資源都要被釋放**，數量由場景自己決定
    expect(pending.size).toBeGreaterThan(0)
    expect(disposed.size).toBe(pending.size)
  })

  it('update 之後海面跟著中心捲動', () => {
    const t = createTerrain('sea')
    // 【索引要自我驗證】group 裡現在有三個東西，順序是遠海、細浪面、參照物。
    // 原本寫死 children[0] 當「海面」—— 遠海插進來之後那一條會靜靜地改測
    // 遠海，而且**照樣綠**（遠海也跟著中心走）。先用高度確認抓對了人：
    // 遠海在 FAR_SEA_Y，細浪面在 0。
    const far = t.object.children[0]!
    const sea = t.object.children[1]!
    t.update(0, 5000, -3000)
    expect(far.position.y).toBe(FAR_SEA_Y)
    expect(sea.position.y).toBe(0)

    expect(sea.position.x).toBeGreaterThan(4000)
    expect(sea.position.z).toBeLessThan(-2000)
    t.dispose()
  })

  it('建立與釋放十次不會拋錯 —— 每場重建要能一直做下去', () => {
    for (let i = 0; i < 10; i++) createTerrain('sea').dispose()
  })
})
