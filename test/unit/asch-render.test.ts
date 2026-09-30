import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAschScenery, hutGeometry } from '../../src/render/aschScenery'
import { buildingGeometry } from '../../src/render/floraShapes'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createAsch, HUTS } from '../../src/world/asch'

/** 佈景裡的車用地面單位的 GLB 樣板 —— 瀏覽器開場載，這裡直接讀 `public/` */
async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('Y-29 的佈景', () => {
  const { field } = createAsch()
  const heightAt = (x: number, z: number): number => field.sample(x, z)
  beforeAll(() => preloadGroundModels(readPublic))

  it('營房、木箱與車都站在地上 —— 沒有一個頂點低於腳下的地面', () => {
    const g = buildAschScenery(heightAt)
    const pos = g.getAttribute('position')
    let below = 0
    for (let i = 0; i < pos.count; i += 7) {
      if (pos.getY(i) < heightAt(pos.getX(i), pos.getZ(i)) - 0.1) below++
    }
    expect(below).toBe(0)
    g.dispose()
  })

  it('營房壓低成一層：最高的頂點不超過 6 m', () => {
    const g = buildAschScenery(heightAt)
    const pos = g.getAttribute('position')
    let top = 0
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
    expect(top).toBeGreaterThan(4)
    expect(top).toBeLessThan(6)
    expect(HUTS.length).toBeGreaterThan(0)
    g.dispose()
  })

  it('營房的屋脊順著長邊：heading 0 沿 z、π/2 沿 x，長度就是 length', () => {
    const template = buildingGeometry(0x76593c, 0x4a4946)
    for (const [heading, along] of [[0, 'z'], [Math.PI / 2, 'x']] as const) {
      const g = hutGeometry(template, { x: 0, z: 0, heading, length: 20, width: 7 }, 0, 1)
      const pos = g.getAttribute('position')
      let top = 0
      for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
      let lo = Infinity
      let hi = -Infinity
      let across = 0
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < top - 1e-6) continue
        const a = along === 'z' ? pos.getZ(i) : pos.getX(i)
        const b = along === 'z' ? pos.getX(i) : pos.getZ(i)
        lo = Math.min(lo, a)
        hi = Math.max(hi, a)
        across = Math.max(across, Math.abs(b))
      }
      // 屋頂比牆多出簷口，所以屋脊比 length 長一點
      expect(hi - lo, `heading ${heading}`).toBeGreaterThan(20)
      expect(hi - lo, `heading ${heading}`).toBeLessThan(23)
      expect(across, `heading ${heading}`).toBeLessThan(1e-6)
      g.dispose()
    }
    template.dispose()
  })

  it('一顆網格、三角形數在預算內', () => {
    const g = buildAschScenery(heightAt)
    const tris = g.getAttribute('position').count / 3
    // 【上限是防爆量，不是畫質】一顆網格一個 draw call；擺位的迴圈寫錯時面數會
    // 暴增到這條擋得住的量級
    expect(tris).toBeGreaterThan(5_000)
    expect(tris).toBeLessThan(250_000)
    g.dispose()
  })
})
