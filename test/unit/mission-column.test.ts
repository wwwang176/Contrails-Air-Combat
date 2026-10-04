import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { columnGround } from '../../src/battle/missions'
import type { ColumnDeploy, MissionGroundColumn } from '../../src/battle/missions/types'
import { motionPose } from '../../src/world/groundMotion'

/**
 * 地面縱隊的展開：行進時前後車左右交錯（`stagger`），走到終點前展開成寬楔形（`deploy`）。
 * 用合成的直路線測，不依賴任何一張任務卡。世界座標：航向 0 = 朝 −Z（北），右手邊是 +X。
 */
const pose = { position: new Vector3(), velocity: new Vector3(), orientation: new Quaternion(), angularVelocity: new Vector3() }
const fwd = new Vector3()

function col(over: Partial<MissionGroundColumn> = {}): MissionGroundColumn {
  return {
    team: 'red', route: [{ x: 0, z: 2000 }, { x: 0, z: 800 }, { x: 0, z: 0 }], speed: 4, turnRadius: 30, gap: 40,
    units: Array<'tank'>(10).fill('tank'), depart: undefined as never, ...over,
  }
}

/** 出發後第 t 秒每輛的位置與航向（出發時刻 0） */
function at(c: MissionGroundColumn, t: number): { x: number; z: number; heading: number }[] {
  return columnGround(c).map((e) => {
    motionPose(e.motion!, 0, t, pose)
    fwd.set(0, 0, -1).applyQuaternion(pose.orientation)
    return { x: pose.position.x, z: pose.position.z, heading: Math.atan2(-fwd.x, -fwd.z) }
  })
}
const STOPPED = 1e6
const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

describe('縱隊行進時前後車交錯', () => {
  /** 【沒填就跟以前一樣】既有的縱隊（沒有 stagger）一輛都不能動 */
  it('沒有 stagger：全部在路線上，停住時第 i 輛在終點前 i × gap', () => {
    const s = at(col(), STOPPED)
    s.forEach((p, i) => {
      expect(p.x, `${i}`).toBeCloseTo(0, 6)
      expect(p.z, `${i}`).toBeCloseTo(i * 40, 6)
    })
  })

  /** 【偶數輛在路線左、奇數輛在右】前後車不在同一條直線上；每輛各走自己那條平行線 */
  it('有 stagger：偶數輛在左、奇數輛在右，相鄰兩輛橫向差 2 × stagger，車距不變', () => {
    const s = at(col({ stagger: 9 }), STOPPED)
    s.forEach((p, i) => {
      expect(p.x, `${i}`).toBeCloseTo(i % 2 === 0 ? -9 : 9, 6)
      expect(p.z, `${i}`).toBeCloseTo(i * 40, 6)
    })
    for (let i = 1; i < s.length; i++) expect(Math.abs(s[i]!.x - s[i - 1]!.x)).toBeCloseTo(18, 6)
  })

  it('行進途中（直線段）也是交錯的，不是只在停住時', () => {
    const s = at(col({ stagger: 9 }), 60)
    for (let i = 0; i < s.length; i++) expect(Math.abs(s[i]!.x), `${i}`).toBeCloseTo(9, 6)
    expect(s[0]!.x).toBeLessThan(0)
    expect(s[1]!.x).toBeGreaterThan(0)
  })

  /** 【轉彎也跟得上】路線有轉角時，偏移後的路線仍然平滑、車與車保持距離 */
  it('路線有轉角：每一輛離路線的橫向偏移約 stagger，任何時刻兩兩相距不到 15 m 的不存在', () => {
    const route = [{ x: 600, z: 2000 }, { x: 600, z: 900 }, { x: 100, z: 400 }, { x: 0, z: 0 }]
    const c = col({ route, stagger: 9 })
    for (let t = 0; t <= 700; t += 5) {
      const s = at(c, t)
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        expect(dist(s[i]!, s[j]!), `t=${t} ${i}-${j}`).toBeGreaterThan(15)
      }
    }
  })
})

describe('縱隊展開成寬楔形', () => {
  const deploy: ColumnDeploy = { facing: 0, spacing: 40, wingBack: 0.35, lead: 80, keep: 2 }
  const c = col({ deploy })

  /**
   * 【楔尖是路線的終點】第一輛停在終點；後面的輛交替往右、往左展開，每橫向 1 m 往後退 `wingBack` m。
   * 世界座標朝北：右 = +X、後 = +Z
   */
  it('第 0 輛在楔尖，其餘交替展開：右 1、左 1、右 2、左 2 ……，兩翼往後退', () => {
    const s = at(c, STOPPED)
    const want = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5]
    s.forEach((p, i) => {
      expect(p.x, `${i}`).toBeCloseTo(want[i]! * 40, 5)
      expect(p.z, `${i}`).toBeCloseTo(Math.abs(want[i]!) * 40 * 0.35, 5)
    })
  })

  it('停妥時每一輛的車頭都朝 facing', () => {
    for (const p of at(c, STOPPED)) expect(Math.abs(Math.atan2(Math.sin(p.heading), Math.cos(p.heading)))).toBeLessThan(1e-6)
    const east = at(col({ deploy: { ...deploy, facing: -Math.PI / 2 } }), STOPPED)
    for (const p of east) expect(Math.abs(p.heading + Math.PI / 2)).toBeLessThan(1e-6)
  })

  it('停妥後兩兩相距不到 38 m 的不存在（間距是 40 m，錯落的後退只會更遠）', () => {
    const s = at(c, STOPPED)
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      expect(dist(s[i]!, s[j]!), `${i}-${j}`).toBeGreaterThanOrEqual(38)
    }
  })

  /** 【展開的過程不能疊車】各輛從共用路線分頭開向自己的楔位，路徑會交錯；抽樣整個行進過程 */
  it('整個行進與展開的過程，任何時刻兩兩相距不到 12 m 的不存在', () => {
    for (let t = 0; t <= 800; t += 2.5) {
      const s = at(c, t)
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        expect(dist(s[i]!, s[j]!), `t=${t} ${i}-${j}`).toBeGreaterThan(12)
      }
    }
  })

  it('stagger 與 deploy 可以一起用：停妥的位置只由楔形決定，不受 stagger 影響', () => {
    const a = at(c, STOPPED), b = at({ ...c, stagger: 9 }, STOPPED)
    a.forEach((p, i) => {
      expect(p.x, `${i}`).toBeCloseTo(b[i]!.x, 5)
      expect(p.z, `${i}`).toBeCloseTo(b[i]!.z, 5)
    })
  })

  /** 【停在車位上，不是停在路線上】抵達之後不動：下一刻位置一樣 */
  it('停妥後不再移動', () => {
    const a = at(c, STOPPED), b = at(c, STOPPED + 100)
    a.forEach((p, i) => { expect(dist(p, b[i]!), `${i}`).toBeLessThan(1e-6) })
  })
})
