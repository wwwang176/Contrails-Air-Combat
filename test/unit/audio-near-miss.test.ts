import { describe, it, expect } from 'vitest'
import { Projectiles } from '../../src/world/Projectiles'
import { nearMiss } from '../../src/audio/nearMiss'

/** 在 i 格放一發：位置、速度、隊伍 */
function shot(p: Projectiles, i: number, team: number, pos: [number, number, number], vel: [number, number, number]): void {
  p.owner[i] = 3
  p.team[i] = team
  p.x[i] = pos[0]; p.y[i] = pos[1]; p.z[i] = pos[2]
  p.vx[i] = vel[0]; p.vy[i] = vel[1]; p.vz[i] = vel[2]
}

describe('敵彈擦過', () => {
  /** 【回索引不回布林】要拿那一發的位置去做左右定位 —— 聽得出敵人從哪邊打來 */
  it('敵彈在 20 m 內、正在遠離 → 回它的索引', () => {
    const p = new Projectiles(8)
    shot(p, 3, 1, [8, 10, 0], [800, 0, 0])
    expect(nearMiss(p, 0, 0, 0, 0, 20)).toBe(3)
  })

  /** 【一幀有好幾個子步】最後一段可能早就過了自己；只看「現在在旁邊、正在遠離」 */
  it('這一幀的前幾個子步就已經擦過、現在正在遠離 → 照樣算', () => {
    const p = new Projectiles(8)
    p.sx[0] = 5; p.sy[0] = 10; p.sz[0] = 0
    shot(p, 0, 1, [15, 10, 0], [800, 0, 0])
    expect(nearMiss(p, 0, 0, 0, 0, 20)).toBe(0)
  })

  it('還在逼近、尚未經過的不算', () => {
    const p = new Projectiles(8)
    shot(p, 0, 1, [-8, 10, 0], [800, 0, 0])
    expect(nearMiss(p, 0, 0, 0, 0, 20)).toBe(-1)
  })

  it('自己人的子彈不算', () => {
    const p = new Projectiles(8)
    shot(p, 0, 0, [8, 10, 0], [800, 0, 0])
    expect(nearMiss(p, 0, 0, 0, 0, 20)).toBe(-1)
  })

  it('太遠不算；空格不算', () => {
    const p = new Projectiles(8)
    shot(p, 0, 1, [8, 40, 0], [800, 0, 0])
    expect(nearMiss(p, 0, 0, 0, 0, 20)).toBe(-1)
    expect(nearMiss(new Projectiles(8), 0, 0, 0, 0, 20)).toBe(-1)
  })
})
