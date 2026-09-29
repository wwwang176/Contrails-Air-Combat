import { afterEach, describe, expect, it } from 'vitest'
import { Frustum, InstancedMesh, Matrix4, PerspectiveCamera, Points, Vector3, type InterleavedBufferAttribute } from 'three'
import { createVegetation, RUN_CAP } from '../../src/render/vegetation'
import { pushFlora, FloraKind, type FloraSource } from '../../src/render/flora'
import { CULL } from '../../src/render/cullRuns'

/**
 * 每一格二十四株：闊葉、針葉、灌木、建築各三株，散在格裡不同位置。
 * 密度要讓大池過 `RUN_SPLIT_MIN`，否則那些池只畫一段、測不到分段
 */
const SPREAD: FloraSource = (x0, z0, _x1, _z1, heightAt, out) => {
  for (let n = 0; n < 24; n++) {
    const k = n % 8
    const x = x0 + 10 + ((n * 37) % 230)
    const z = z0 + 10 + ((n * 53) % 230)
    pushFlora(out, x, heightAt(x, z), z, n * 0.7, 1, 0.5, k as FloraKind)
  }
}

function camera(yawDeg: number, pitchDeg: number, x = 0, y = 300, z = 0): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 1, 60000)
  c.position.set(x, y, z)
  c.rotation.order = 'YXZ'
  c.rotation.set((pitchDeg * Math.PI) / 180, ((yawDeg - 90) * Math.PI) / 180, 0)
  c.updateMatrixWorld(true)
  return c
}

/** 一池此刻畫出去的實例區間（第 0 段是池本身，其餘是它的孩子） */
function drawnRanges(pool: InstancedMesh | Points): [number, number][] {
  const out: [number, number][] = []
  for (const o of [pool, ...pool.children] as (InstancedMesh | Points)[]) {
    if (!o.visible) continue
    if (o instanceof InstancedMesh) {
      if (o.count === 0) continue
      const start = (o.instanceMatrix as unknown as InterleavedBufferAttribute).offset / 16
      out.push([start, start + o.count])
    } else {
      const r = o.geometry.drawRange
      if (r.count > 0) out.push([r.start, r.start + r.count])
    }
  }
  return out
}

/** 第 i 株的位置：實例池讀矩陣的平移，點池讀位置 */
function positionOf(pool: InstancedMesh | Points, i: number, out: Vector3): Vector3 {
  if (pool instanceof InstancedMesh) {
    const a = pool.instanceMatrix.array as Float32Array
    return out.set(a[i * 16 + 12]!, a[i * 16 + 13]!, a[i * 16 + 14]!)
  }
  return out.fromBufferAttribute(pool.geometry.getAttribute('position'), i)
}

function total(pool: InstancedMesh | Points): number {
  return pool instanceof InstancedMesh ? pool.count : pool.geometry.drawRange.count
}

afterEach(() => { CULL.enabled = true })

describe('植被逐段剔除', () => {
  const VIEWS: [string, PerspectiveCamera][] = [
    ['平視朝東', camera(0, -5)],
    ['平視朝西北', camera(135, -8)],
    ['俯視 60°', camera(30, -60, 800, 1500, -400)],
    ['朝天', camera(200, 70)],
    // 眼睛離地 2 m、仰 40°、樹就在 10 m 前：看得到樹冠、看不到樹根
    ['貼地仰看', camera(0, 40, 0, 2, 10)],
  ]

  /**
   * 【一株都不能漏】位置在視錐內的每一株都要落在某一段裡 —— 漏了就是畫面上少一棵樹。
   * 實例池取樹根與九成樹高兩點（這裡的縮放、面寬、樓高都是 1，樹高就是幾何的上緣）；
   * 盒子若沒包住整株，貼地仰看時只有樹冠在畫面裡的那幾株會被剔掉
   */
  it('看得到的每一株都在某一段裡', () => {
    const v = createVegetation([SPREAD], () => 0)
    v.settle()
    const totals = v.object.children.map((p) => total(p as InstancedMesh | Points))
    const f = new Frustum()
    const pos = new Vector3()
    for (const [label, cam] of VIEWS) {
      v.cull(cam)
      f.setFromProjectionMatrix(new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
      v.object.children.forEach((child, k) => {
        const pool = child as InstancedMesh | Points
        const ranges = drawnRanges(pool)
        expect(ranges.length).toBeLessThanOrEqual(RUN_CAP)
        let top = 0
        if (pool instanceof InstancedMesh) {
          pool.geometry.computeBoundingBox()
          top = pool.geometry.boundingBox!.max.y * 0.9
        }
        for (let i = 0; i < totals[k]!; i++) {
          positionOf(pool, i, pos)
          const seen = f.containsPoint(pos) || f.containsPoint(pos.clone().setY(pos.y + top))
          if (!seen) continue
          const inside = ranges.some(([a, b]) => i >= a && i < b)
          expect([label, k, i, inside]).toEqual([label, k, i, true])
        }
      })
    }
    v.dispose()
  })

  /**
   * 【飛過一段之後表仍然對】只有髒的池會重建、重建分幀做，所以各池掛著的是不同時刻
   * 打包的內容。表必須跟著各池掛著的那一份 —— 讀到另一份的表，整格會不見
   */
  it('飛過一段、各池分別重建過之後，看得到的仍一株不漏', () => {
    const v = createVegetation([SPREAD], () => 0, { rebuildBudget: 3000 })
    v.settle()
    for (let k = 1; k <= 400; k++) v.update(k * 6, k * 2)
    expect(v.stats.rebuilds).toBeGreaterThan(3)
    const cam = camera(0, -10, 2400, 400, 800)
    v.cull(cam)
    const f = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    const pos = new Vector3()
    const used = Object.values(v.counts)
    let checked = 0
    for (const [k, child] of v.object.children.entries()) {
      const pool = child as InstancedMesh | Points
      const ranges = drawnRanges(pool)
      // 【讀掛著的那一份】`positionOf` 讀的是第 0 段此刻指到的緩衝
      for (let i = 0; i < used[k]!; i++) {
        positionOf(pool, i, pos)
        if (!f.containsPoint(pos)) continue
        checked++
        expect([k, i, ranges.some(([a, b]) => i >= a && i < b)]).toEqual([k, i, true])
      }
    }
    expect(checked).toBeGreaterThan(100)
    v.dispose()
  }, 60000)

  /** 【背後的真的不畫】平視時水平視野 97°，大池畫出去的應該遠少於全部 */
  it('平視時大池只畫一小部分', () => {
    const v = createVegetation([SPREAD], () => 0)
    v.settle()
    const pools = v.object.children as (InstancedMesh | Points)[]
    const totals = pools.map(total)
    v.cull(camera(0, -5))
    let all = 0
    let drawn = 0
    pools.forEach((pool, k) => {
      if (totals[k]! < 2000) return
      all += totals[k]!
      for (const [a, b] of drawnRanges(pool)) drawn += b - a
    })
    expect(all).toBeGreaterThan(0)
    expect(drawn / all).toBeLessThan(0.5)
    v.dispose()
  })

  it('總開關關掉時每一池畫整條', () => {
    const v = createVegetation([SPREAD], () => 0)
    v.settle()
    const pools = v.object.children as (InstancedMesh | Points)[]
    const totals = pools.map(total)
    CULL.enabled = false
    v.cull(camera(0, -5))
    pools.forEach((pool, k) => {
      expect(drawnRanges(pool)).toEqual(totals[k]! > 0 ? [[0, totals[k]!]] : [])
    })
    v.dispose()
  })
})
