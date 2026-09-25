import { existsSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Box3, type Mesh, type Object3D } from 'three'
import { GLB_MODELS } from '../../src/render/geometry/buildAircraft'
import { glbTemplate } from '../../src/render/geometry/glb'
import { liveryView } from '../../src/render/geometry/livery'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

const WITH_LIVERY = Object.entries(GLB_MODELS).filter(([, d]) => d.livery !== undefined)

/**
 * 吃塗裝的面。槳盤（`CircleGeometry`）本來就帶 UV 與索引、不吃塗裝，
 * 靠 `spinning` 旗標排除。
 */
function liveried(o: Object3D): o is Mesh {
  const mesh = o as Mesh
  return mesh.isMesh === true && !mesh.userData['spinning'] && mesh.geometry.getAttribute('uv') !== undefined
}

beforeAll(loadGlbTemplatesForNode)

describe('塗裝版面', () => {
  it('九型都有塗裝，貼圖檔都在', () => {
    expect(WITH_LIVERY.length).toBe(Object.keys(GLB_MODELS).length)
    for (const [id, def] of WITH_LIVERY) {
      expect(existsSync(`public${def.livery!.url}`), id).toBe(true)
    }
  })

  /**
   * 【整架要裝得進自己那一格】上下視每格 1024×1024、側視 1024×512（px）。比例
   * 或中心設錯的話，翼尖、機尾會投到隔壁那一格 —— 那是另一個視圖的漆，
   * 畫面上只是「翼尖顏色怪怪的」，不會報錯。
   */
  it('帶 UV 的面在各視圖裡都不出格', () => {
    for (const [id, def] of WITH_LIVERY) {
      const L = def.livery!
      const box = new Box3()
      let n = 0
      glbTemplate(id)!.group.traverse((o: Object3D) => {
        if (!liveried(o)) return
        box.expandByObject(o)
        n++
      })
      expect(n, `${id} 沒有帶 UV 的面`).toBeGreaterThan(0)
      const planHalf = 512 / L.scale
      const sideHalf = 256 / L.scale
      expect(Math.max(-box.min.x, box.max.x), `${id} 翼展`).toBeLessThanOrEqual(planHalf)
      expect(L.planZ - box.min.z, `${id} 機首`).toBeLessThanOrEqual(planHalf)
      expect(box.max.z - L.planZ, `${id} 機尾`).toBeLessThanOrEqual(planHalf)
      expect(L.sideY - box.min.y, `${id} 腹線`).toBeLessThanOrEqual(sideHalf)
      expect(box.max.y - L.sideY, `${id} 垂尾頂`).toBeLessThanOrEqual(sideHalf)
    }
  })

  it('帶 UV 的面一律沒有索引（相鄰的面可能歸到不同視圖）', () => {
    for (const [id] of WITH_LIVERY) {
      glbTemplate(id)!.group.traverse((o: Object3D) => {
        if (liveried(o)) expect(o.geometry.index, id).toBeNull()
      })
    }
  })

  it('側視有偏好：斜 45° 的面歸側視，接近水平的才歸上下視', () => {
    expect(liveryView(1, 1)).toBe('right')
    expect(liveryView(-1, -1)).toBe('left')
    expect(liveryView(0.5, 1)).toBe('top')
    expect(liveryView(0.5, -1)).toBe('bottom')
  })
})
