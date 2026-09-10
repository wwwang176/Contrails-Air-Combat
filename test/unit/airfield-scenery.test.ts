import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import {
  AIRFIELD_GLB_URL, buildAirfieldScenery, preloadAirfieldScenery,
} from '../../src/render/geometry/ground/airfieldScenery'
import {
  DUMPS, FIELD_BOUNDS, FIELD_CENTER, HEAVY_FLAK_SITES, LIGHT_FLAK_SITES, PARKED_ROWS, PAVED,
  SEARCHLIGHT_SITES, worldToField,
} from '../../src/world/poltava'

async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('波爾塔瓦機場的佈景', () => {
  beforeAll(() => preloadAirfieldScenery(readPublic))

  it('載得到、已經平移到機場中心、不超過 8 MB', () => {
    expect(AIRFIELD_GLB_URL).toBe('/models/poltava_airfield.glb')
    const g = buildAirfieldScenery()
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    g.computeBoundingBox()
    const bb = g.boundingBox!
    // 【包住機場中心，而且沒有遠到別的地方去】電線桿沿連外道路往北走 2.5 km，
    // 所以不比包圍盒的中心，比「中心在盒內、盒不超過幾公里」
    expect(bb.containsPoint(new Vector3(FIELD_CENTER.x, 1, FIELD_CENTER.z))).toBe(true)
    expect(bb.max.x - bb.min.x).toBeLessThan(FIELD_BOUNDS.x1 - FIELD_BOUNDS.x0 + 400)
    expect(bb.max.z - bb.min.z).toBeLessThan(4000)
    expect(readFileSync(`public${AIRFIELD_GLB_URL}`).byteLength).toBeLessThan(8 * 1048576)
  })

  it('沒有任何頂點落在鋪面（跑道、滑行道、停機位）或目標的腳印上', () => {
    const g = buildAirfieldScenery()
    const pos = g.getAttribute('position')
    const L = { x: 0, z: 0 }
    let bad = 0
    for (let i = 0; i < pos.count; i++) {
      worldToField(pos.getX(i), pos.getZ(i), L)
      for (const r of PAVED) {
        if (L.x >= r.x0 && L.x <= r.x1 && L.z >= r.z0 && L.z <= r.z1) { bad++; break }
      }
    }
    expect(bad).toBe(0)
    // 【每一種避讓都驗】腳本的 KEEPOUTS 漏了哪一組，就是那一組的頂點會冒出來。
    // 單趟掃頂點、不配置：幾萬個頂點 × 五十幾個腳印，逐點建 Vector3 會跑很久
    const boxes: { x: number; z: number; hx: number; hz: number }[] = [
      ...PARKED_ROWS.map((p) => ({ x: p.x, z: p.z, hx: 17, hz: 13 })),
      ...DUMPS.map((d) => ({ x: d.x, z: d.z, hx: 16, hz: 11 })),
      ...[...LIGHT_FLAK_SITES, ...HEAVY_FLAK_SITES, ...SEARCHLIGHT_SITES]
        .map((s) => ({ x: s.x, z: s.z, hx: 8, hz: 8 })),
    ]
    let onKeepout = 0
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      for (const b of boxes) {
        if (Math.abs(x - b.x) <= b.hx && Math.abs(z - b.z) <= b.hz) { onKeepout++; break }
      }
    }
    expect(onKeepout).toBe(0)
  })

  it('每次拿到的是複本，改一份不動另一份', () => {
    const a = buildAirfieldScenery()
    const b = buildAirfieldScenery()
    expect(a).not.toBe(b)
    a.getAttribute('position').setX(0, 12345)
    expect(b.getAttribute('position').getX(0)).not.toBe(12345)
  })
})
