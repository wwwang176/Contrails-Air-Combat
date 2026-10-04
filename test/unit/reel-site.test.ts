import { describe, expect, it } from 'vitest'
import { pickFirstShot, reelSiteLayout } from '../../src/app/menuReel'

describe('pickFirstShot：重新整理時不從上一次那段開始', () => {
  const ids = ['fleet', 'stream', 'dogfight', 'strike', 'raid']

  it('整個亂數範圍都挑不到上一次那段，其他每一段都挑得到', () => {
    for (const last of ids) {
      const seen = new Set<number>()
      for (let i = 0; i < 1000; i++) seen.add(pickFirstShot(ids, last, i / 1000))
      expect(seen.has(ids.indexOf(last)), last).toBe(false)
      expect(seen.size, last).toBe(ids.length - 1)
    }
  })

  it('沒有記錄、或記錄的那段已經不在清單裡，就是單純隨機', () => {
    expect(pickFirstShot(ids, null, 0)).toBe(0)
    expect(pickFirstShot(ids, 'gone', 0.99)).toBe(4)
  })
})

/** `fields.ts` 的著色器把世界座標轉進廠區局部座標的那一條（`siteGlsl`／`siteSurfaceColor`） */
function siteLocal(x: number, z: number, pivot: { x: number, z: number }, heading: number) {
  const rx = x - pivot.x
  const rz = z - pivot.z
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  return { x: rx * c + rz * s, z: -rx * s + rz * c }
}

/** 放映機的局部 → 世界（`menuReel.ts` 的 `toWorld`） */
function toWorld(x: number, z: number, ox: number, oz: number, yaw: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: ox + x * c + z * s, z: oz - x * s + z * c }
}

describe('reelSiteLayout：短片的廠區轉到地形著色器', () => {
  const ox = 1234
  const oz = -5678
  const yaw = 0.7
  const ground = {
    pad: { x0: -200, z0: -100, x1: 300, z1: 150 },
    roads: [[{ x: 0, z: 0 }, { x: 500, z: -800 }]],
  }
  const site = reelSiteLayout(ground, ox, oz, yaw)

  it('局部的一點轉到世界，再用著色器那一條轉回來是同一點', () => {
    for (const p of [{ x: 250, z: -80 }, { x: -150, z: 120 }, { x: 0, z: 0 }]) {
      const w = toWorld(p.x, p.z, ox, oz, yaw)
      const back = siteLocal(w.x, w.z, site.pivot!, site.heading!)
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.z).toBeCloseTo(p.z, 6)
    }
  })

  it('道路是世界座標，與飛機、鏡頭用同一個局部轉世界', () => {
    const w = toWorld(500, -800, ox, oz, yaw)
    expect(site.roads[0]![1]!.x).toBeCloseTo(w.x, 6)
    expect(site.roads[0]![1]!.z).toBeCloseTo(w.z, 6)
  })
})
