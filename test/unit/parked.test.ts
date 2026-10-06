import { beforeAll, describe, expect, it } from 'vitest'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { Matrix4 } from 'three'
import {
  bakeParkedAircraft, PARKED_OFFSET_KEY, PARKED_PROP_KEY, type ParkedProp,
} from '../../src/render/geometry/ground/parked'
import { PARKED_TAIL_DOWN } from '../../src/specs/ground'
import { glbTemplate } from '../../src/render/geometry/glb'

/**
 * 停放的飛機是從機種的 GLB 樣板烘出來的一顆幾何：同一批頂點、換成頂點色、
 * 機尾下沉、最低點貼地。守的是「烘的是同一架」與「地面單位的約定」。
 */
describe('bakeParkedAircraft', () => {
  beforeAll(loadGlbTemplatesForNode)

  it('最低點在 y = 0、前後左右都置中、頂點色不是全白', () => {
    const g = bakeParkedAircraft('b17g')
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.y).toBeCloseTo(0, 6)
    expect(Math.abs(bb.min.x + bb.max.x)).toBeLessThan(0.5)
    expect(Math.abs(bb.min.z + bb.max.z)).toBeLessThan(0.5)
    const col = g.getAttribute('color')
    expect(col.count).toBe(g.getAttribute('position').count)
    let dark = 0
    for (let i = 0; i < col.count; i++) if (col.getX(i) < 0.9) dark++
    expect(dark).toBeGreaterThan(0)
  })

  it('翼展與全長對得上 B-17G', () => {
    const g = bakeParkedAircraft('b17g')
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(31.6, 0)
    // 機尾下沉之後全長投影縮短 cos(10°)
    expect(bb.max.z - bb.min.z).toBeGreaterThan(22.66 * Math.cos(PARKED_TAIL_DOWN) - 1)
  })

  it('機首比機尾高 —— 尾輪機停著是抬頭的', () => {
    const g = bakeParkedAircraft('b17g')
    const pos = g.getAttribute('position')
    let noseBottom = Infinity
    let tailBottom = Infinity
    let noseCount = 0
    let tailCount = 0
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      if (z < -8) { noseBottom = Math.min(noseBottom, pos.getY(i)); noseCount++ }
      if (z > 8) { tailBottom = Math.min(tailBottom, pos.getY(i)); tailCount++ }
    }
    // 兩個取樣集合都要有東西，否則 Infinity 的比較是恆真的
    expect(noseCount).toBeGreaterThan(0)
    expect(tailCount).toBeGreaterThan(0)
    expect(noseBottom).toBeGreaterThan(tailBottom + 1)
  })

  it('不動樣板：烘兩次得到相同的頂點，而且是各自的幾何', () => {
    const a = bakeParkedAircraft('b17g')
    const b = bakeParkedAircraft('b17g')
    expect(a).not.toBe(b)
    expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array)
    a.getAttribute('position').setX(0, 999)
    expect(b.getAttribute('position').getX(0)).not.toBe(999)
  })

  it('拆槳：槳葉從機身拿掉、包圍盒不變，擺回轉軸上與不拆的那一份逐點相同', () => {
    const whole = bakeParkedAircraft('p51d')
    const body = bakeParkedAircraft('p51d', true)
    const prop = body.userData[PARKED_PROP_KEY] as ParkedProp
    expect(prop).toBeDefined()
    const nWhole = whole.getAttribute('position').count
    const nBody = body.getAttribute('position').count
    const nProp = prop.geometry.getAttribute('position').count
    expect(nProp).toBeGreaterThan(0)
    expect(nBody + nProp).toBe(nWhole)
    expect(body.userData[PARKED_OFFSET_KEY]).toEqual(whole.userData[PARKED_OFFSET_KEY])
    // 擺回去：機尾下沉 → 平移到轉軸。每一個槳葉頂點都要在不拆的那一份裡找得到
    const placed = prop.geometry.clone()
      .applyMatrix4(new Matrix4().makeRotationX(PARKED_TAIL_DOWN))
      .translate(prop.hub.x, prop.hub.y, prop.hub.z)
    const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    const pw = whole.getAttribute('position')
    const inWhole = new Set<string>()
    for (let i = 0; i < pw.count; i++) inWhole.add(key(pw.getX(i), pw.getY(i), pw.getZ(i)))
    const pp = placed.getAttribute('position')
    let missing = 0
    for (let i = 0; i < pp.count; i++) if (!inWhole.has(key(pp.getX(i), pp.getY(i), pp.getZ(i)))) missing++
    expect(missing).toBe(0)
    // 轉軸在機首：比機身任何一點都前面的附近
    body.computeBoundingBox()
    expect(prop.hub.z).toBeLessThan(body.boundingBox!.min.z + 1)
  })

  it('沒載樣板就丟', () => {
    expect(glbTemplate('nope')).toBeUndefined()
    expect(() => bakeParkedAircraft('nope')).toThrow(/GLB/)
  })
})
