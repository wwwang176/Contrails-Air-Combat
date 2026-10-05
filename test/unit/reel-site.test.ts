import { describe, expect, it } from 'vitest'
import { reelSiteLayout } from '../../src/app/menuReel'
import { markShotSeen, pickNextShot } from '../../src/app/reel/shotSelection'

describe('pickNextShot／markShotSeen：越近播過的越不容易再挑到', () => {
  const ids = ['fleet', 'stream', 'dogfight', 'strike', 'raid', 'stuka']
  const N = 10000

  /** 整個亂數範圍裡每一段被挑到的比例 */
  const share = (seen: readonly string[]): Map<string, number> => {
    const out = new Map<string, number>(ids.map((id) => [id, 0]))
    for (let i = 0; i < N; i++) {
      const id = ids[pickNextShot(ids, seen, i / N)]!
      out.set(id, out.get(id)! + 1 / N)
    }
    return out
  }

  it('上一段一定不挑；越早播的機率越高，沒播過的最高', () => {
    // 由舊到新：fleet 五段前、stream 四段前、dogfight 三段前、strike 兩段前、raid 上一段，stuka 沒播過
    const p = share(['fleet', 'stream', 'dogfight', 'strike', 'raid'])
    expect(p.get('raid')).toBe(0)
    const order = ['strike', 'dogfight', 'stream', 'fleet', 'stuka'].map((id) => p.get(id)!)
    for (let k = 1; k < order.length; k++) expect(order[k]!).toBeGreaterThan(order[k - 1]!)
  })

  it('A → B → C 之後再挑到 A 的機率不到一成', () => {
    const p = share(['fleet', 'stream', 'dogfight'])
    expect(p.get('fleet')!).toBeLessThan(0.1)
    expect(p.get('dogfight')).toBe(0)
  })

  it('一直換段：任何一段都不會連播兩次', () => {
    let seen: string[] = []
    let last = ''
    for (let k = 0; k < 300; k++) {
      const id = ids[pickNextShot(ids, seen, ((k * 7919) % 1000) / 1000)]!
      expect(id, `第 ${k} 次`).not.toBe(last)
      seen = markShotSeen(ids, seen, id)
      last = id
    }
  })

  it('開播的段落移到最後、不重複；清單裡沒有的段落丟掉', () => {
    expect(markShotSeen(ids, ['fleet', 'stream', 'raid'], 'fleet')).toEqual(['stream', 'raid', 'fleet'])
    expect(markShotSeen(ids, ['gone', 'fleet'], 'raid')).toEqual(['fleet', 'raid'])
  })

  it('沒有記錄就是單純隨機', () => {
    const p = share([])
    for (const id of ids) expect(p.get(id)!).toBeCloseTo(1 / ids.length, 3)
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
