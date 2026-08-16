import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createObjectiveRing } from '../../src/render/objectiveRing'

describe('objectiveRing', () => {
  it('update 之後圓心落在指定座標上', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    cam.position.set(0, 4000, 5000)
    ring.update(new Vector3(0, 4000, -20000), 1000, cam)
    expect(ring.object.position.x).toBe(0)
    expect(ring.object.position.y).toBe(4000)
    expect(ring.object.position.z).toBe(-20000)
    ring.dispose()
  })

  /**
   * ★ **看到的圈就是判定範圍。**
   *
   * billboard 圓環是那顆判定球的輪廓 —— 半徑必須逐字等於 `radius`，差一點都
   * 會讓「我明明穿過去了卻沒算到」變成可能，而那種 bug 沒有辦法從畫面上
   * 自我解釋（spec §6.3）。
   */
  it('縮放讓圓環的世界半徑逐字等於判定半徑', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    cam.position.set(0, 4000, 5000)
    for (const r of [500, 1000, 1500, 2000]) {
      ring.update(new Vector3(0, 4000, -20000), r, cam)
      expect(ring.object.scale.x, `r=${r}`).toBeCloseTo(r, 6)
      expect(ring.object.scale.y, `r=${r}`).toBeCloseTo(r, 6)
    }
    ring.dispose()
  })

  /**
   * 【為什麼要掃多個相機位置】billboard 的全部意義就是「從任何角度看都是
   * 正圓」。固定朝向的環面從側面看是一條線 —— 只驗一個角度的話，兩者
   * 分不出來。
   */
  it('環面法線指向相機 —— 從任何角度看都是正圓', () => {
    const ring = createObjectiveRing()
    const cam = new PerspectiveCamera()
    const centre = new Vector3(0, 4000, -20000)
    const normal = new Vector3()
    const toCam = new Vector3()
    for (const p of [
      new Vector3(0, 4000, 5000),
      new Vector3(9000, 1000, -20000),
      new Vector3(-3000, 12000, -25000),
      new Vector3(0, 4000, -25000),
    ]) {
      cam.position.copy(p)
      ring.update(centre, 1000, cam)
      normal.set(0, 0, 1).applyQuaternion(ring.object.quaternion)
      toCam.copy(p).sub(centre).normalize()
      expect(normal.dot(toCam), `相機在 ${p.toArray().join(',')}`).toBeCloseTo(1, 6)
    }
    ring.dispose()
  })

  it('setVisible(false) 之後不畫', () => {
    const ring = createObjectiveRing()
    expect(ring.object.visible).toBe(true)
    ring.setVisible(false)
    expect(ring.object.visible).toBe(false)
    ring.setVisible(true)
    expect(ring.object.visible).toBe(true)
    ring.dispose()
  })

  /**
   * 【為什麼要關掉視錐剔除】環的幾何是單位半徑、靠 scale 放大到 1 km。
   * three 的包圍球是照**原始幾何**算的，剔除因此會用一顆半徑 1 的球去判斷
   * 一個直徑 2 km 的東西 —— 症狀是環在畫面邊緣憑空消失。
   */
  it('不吃視錐剔除', () => {
    const ring = createObjectiveRing()
    expect(ring.object.frustumCulled).toBe(false)
    ring.dispose()
  })
})
