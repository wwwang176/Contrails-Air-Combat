import { describe, it, expect } from 'vitest'
import { Mesh } from 'three'
import { createOrderMarkers } from '../../src/render/orderMarkers'

/** 取出球的那些槽位（`object` 的子節點裡還有一個 `LineSegments`） */
function spheres(o: { object: { children: unknown[] } }): Mesh[] {
  return o.object.children.filter((c): c is Mesh => c instanceof Mesh)
}

/** 取出線段物件與它的 draw range */
function lineRange(o: { object: { children: unknown[] } }): { start: number, count: number } {
  const l = o.object.children.find((c) => !(c instanceof Mesh)) as
    { geometry: { drawRange: { start: number, count: number } } }
  return l.geometry.drawRange
}

describe('createOrderMarkers', () => {
  it('剛建好時一顆球都不顯示', () => {
    const m = createOrderMarkers()
    expect(spheres(m).every((s) => !s.visible)).toBe(true)
    m.dispose()
  })

  it('add 一筆之後只有第一個槽位顯示，而且線畫兩個頂點', () => {
    const m = createOrderMarkers()
    m.begin()
    m.add('blue', 100, 4000, -200, 300, 0, 4000, 0)
    m.end()
    const s = spheres(m)
    expect(s[0]!.visible).toBe(true)
    expect(s[1]!.visible).toBe(false)
    expect(lineRange(m).count).toBe(2)
    m.dispose()
  })

  /**
   * 【半徑吃 `order.radius` 而不是寫死 300】`arriveRadius` 改值時球要跟著
   * 改。一個寫死的 300 會在下次調參之後靜靜地說謊 —— 而這個球的**唯一
   * 用途**就是「長機有沒有進到判定半徑裡」。
   */
  it('球的尺度就是傳進去的半徑', () => {
    const m = createOrderMarkers()
    m.begin()
    m.add('red', 0, 0, 0, 450, 0, 0, 0)
    m.end()
    const s = spheres(m)[0]!
    expect(s.scale.x).toBe(450)
    expect(s.scale.y).toBe(450)
    expect(s.scale.z).toBe(450)
    m.dispose()
  })

  it('球心就是集合點', () => {
    const m = createOrderMarkers()
    m.begin()
    m.add('blue', 1200, 5300, -800, 300, 0, 0, 0)
    m.end()
    const s = spheres(m)[0]!
    expect([s.position.x, s.position.y, s.position.z]).toEqual([1200, 5300, -800])
    m.dispose()
  })

  it('藍紅用不同的材質', () => {
    const m = createOrderMarkers()
    m.begin()
    m.add('blue', 0, 0, 0, 300, 0, 0, 0)
    m.add('red', 0, 0, 0, 300, 0, 0, 0)
    m.end()
    const s = spheres(m)
    expect(s[0]!.material).not.toBe(s[1]!.material)
    m.dispose()
  })

  /**
   * 【這一條守著「上一幀的內容活不過一幀」】它不進 `POOLS`（換場歸零的
   * 清單），靠的就是每一幀 `begin` 重來。少了這個性質，換場之後上一場的
   * 球會留在畫面上，而那是一個查不出來的鬼影。
   */
  it('下一幀 begin 之後沒 add 的槽位會消失', () => {
    const m = createOrderMarkers()
    m.begin()
    m.add('blue', 0, 0, 0, 300, 0, 0, 0)
    m.add('blue', 0, 0, 0, 300, 0, 0, 0)
    m.end()
    expect(spheres(m).filter((s) => s.visible).length).toBe(2)
    m.begin()
    m.end()
    expect(spheres(m).filter((s) => s.visible).length).toBe(0)
    expect(lineRange(m).count).toBe(0)
    m.dispose()
  })

  /**
   * 【超過容量不能爆】20v20 是十個分隊，容量 20 有兩倍餘裕；但編制若被
   * 改大，寧可少畫幾顆也不要寫出陣列外。
   */
  it('超過容量時多的直接丟掉，不寫出界', () => {
    const m = createOrderMarkers()
    m.begin()
    for (let i = 0; i < 100; i++) m.add('blue', i, 0, 0, 300, 0, 0, 0)
    m.end()
    const n = spheres(m).length
    expect(spheres(m).filter((s) => s.visible).length).toBe(n)
    expect(lineRange(m).count).toBe(n * 2)
    m.dispose()
  })

  it('setVisible 關掉整組', () => {
    const m = createOrderMarkers()
    m.setVisible(false)
    expect(m.object.visible).toBe(false)
    m.setVisible(true)
    expect(m.object.visible).toBe(true)
    m.dispose()
  })
})
