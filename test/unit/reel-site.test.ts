import { describe, expect, it } from 'vitest'
import { markShotSeen, pickFirstShot, reelSiteLayout } from '../../src/app/menuReel'

describe('pickFirstShot／markShotSeen：重新整理時先挑這一輪還沒播過的', () => {
  const ids = ['fleet', 'stream', 'dogfight', 'strike', 'raid', 'stuka']

  /** 整個亂數範圍挑得到哪幾段 */
  const reachable = (seen: readonly string[]): Set<string> => {
    const out = new Set<string>()
    for (let i = 0; i < 1000; i++) out.add(ids[pickFirstShot(ids, seen, i / 1000)]!)
    return out
  }

  it('播過的挑不到，沒播過的每一段都挑得到', () => {
    expect(reachable(['stream', 'raid'])).toEqual(new Set(['fleet', 'dogfight', 'strike', 'stuka']))
  })

  it('一直重新整理：前六次各不相同，之後任何一段都至少隔三段才再出現（沒有 A → B → A）', () => {
    let seen: string[] = []
    const order: string[] = []
    for (let k = 0; k < 200; k++) {
      const id = ids[pickFirstShot(ids, seen, ((k * 7919) % 1000) / 1000)]!
      order.push(id)
      seen = markShotSeen(ids, seen, id)
    }
    expect(new Set(order.slice(0, ids.length)).size).toBe(ids.length)
    for (let k = 0; k < order.length; k++) {
      for (let j = k + 1; j <= Math.min(k + 3, order.length - 1); j++) {
        expect(order[j], `第 ${k} 與第 ${j} 次都是 ${order[k]}`).not.toBe(order[k])
      }
    }
  })

  it('全部播過就重新一輪，只留最近播過的一半；清單裡沒有的段落丟掉', () => {
    expect(markShotSeen(ids, ['fleet', 'stream', 'dogfight', 'strike', 'raid'], 'stuka'))
      .toEqual(['strike', 'raid', 'stuka'])
    expect(markShotSeen(ids, ['gone', 'fleet'], 'raid')).toEqual(['fleet', 'raid'])
  })

  it('沒有記錄就是單純隨機', () => {
    expect(pickFirstShot(ids, [], 0)).toBe(0)
    expect(pickFirstShot(ids, [], 0.99)).toBe(5)
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
