import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'

/** 造一架擺在指定位置、以指定速度飛行的 P-51D。 */
function craft(pos: Vector3, vel: Vector3, orientation = new Quaternion()): Aircraft {
  const a = new Aircraft(P51D, Math.max(pos.y, 1), vel.length() || 1)
  a.state.position.copy(pos)
  a.state.velocity.copy(vel)
  a.state.orientation.copy(orientation)
  a.prevPosition.copy(pos)
  a.prevOrientation.copy(orientation)
  return a
}

const OUT = new Vector3()

describe('stationPoint —— 航跡的水平框（M6 spec §6.1）', () => {
  it('平飛朝 −Z 時，across 是 +X、along 的負值是 +Z（後方）', () => {
    // three 的座標系：+X 右、+Y 上、−Z 前。朝 −Z 飛時右手邊就是 +X。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: -60, across: 200, up: 0 }, 0, OUT)
    expect(OUT.x).toBeCloseTo(200, 6)
    expect(OUT.y).toBeCloseTo(4000, 6)
    expect(OUT.z).toBeCloseTo(60, 6)     // along 為負 = 後方 = +Z
  })

  it('朝 +X 平飛時，右手邊是 +Z', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(200, 0, 0))
    stationPoint(lead, { along: 0, across: 200, up: 0 }, 0, OUT)
    expect(OUT.x).toBeCloseTo(0, 6)
    expect(OUT.z).toBeCloseTo(200, 6)
  })

  it('up 是**世界**垂直，不隨姿態', () => {
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 3)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200), rolled)
    stationPoint(lead, { along: 0, across: 0, up: 50 }, 0, OUT)
    expect(OUT.y).toBeCloseTo(4050, 6)
  })
})

describe('滾轉不會移動站位點 —— 這是採用水平框的全部理由', () => {
  it('同一組位置與速度、只換滾轉姿態，站位點完全相同', () => {
    // 【這條測試有一個陷阱】水平航跡退化時的備援用的是**機首**的水平
    // 投影，而機首會隨滾轉改變。所以這條必須在**非退化**的態勢下寫
    // （長機有明確的水平速度），否則它會在備援路徑上失敗 —— 而那個
    // 失敗是對的（M6 spec §13.1）。
    const pos = new Vector3(100, 4000, -50)
    const vel = new Vector3(30, 0, -198)
    const offset = STATION_OFFSETS[1]!
    const level = craft(pos, vel, new Quaternion())
    const a = new Vector3()
    stationPoint(level, offset, 0, a)

    for (const angle of [0.5, 1.5, Math.PI, -2.2]) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), angle)
      const rolled = craft(pos, vel, q)
      const b = new Vector3()
      stationPoint(rolled, offset, 0, b)
      expect(b.x).toBe(a.x)
      expect(b.y).toBe(a.y)
      expect(b.z).toBe(a.z)
    }
  })

  it('轉彎時站位點才會移動', () => {
    const pos = new Vector3(0, 4000, 0)
    const a = new Vector3()
    const b = new Vector3()
    stationPoint(craft(pos, new Vector3(0, 0, -200)), STATION_OFFSETS[1]!, 0, a)
    stationPoint(craft(pos, new Vector3(200, 0, 0)), STATION_OFFSETS[1]!, 0, b)
    expect(a.distanceTo(b)).toBeGreaterThan(100)
  })
})

describe('退化與夾制', () => {
  it('垂直俯衝時改用機首的水平投影，不產生 NaN', () => {
    // 水平速度分量趨近 0 → 航跡方向沒有定義
    const nose = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, -200, 0), nose)
    stationPoint(lead, STATION_OFFSETS[1]!, 0, OUT)
    expect(Number.isFinite(OUT.x)).toBe(true)
    expect(Number.isFinite(OUT.y)).toBe(true)
    expect(Number.isFinite(OUT.z)).toBe(true)
  })

  it('速度與機首都垂直時仍然不產生 NaN', () => {
    const up = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 200, 0), up)
    stationPoint(lead, STATION_OFFSETS[1]!, 0, OUT)
    expect(Number.isFinite(OUT.x + OUT.y + OUT.z)).toBe(true)
  })

  it('站位點的高度夾在海面 + 安全層 clearance 之上（M6 spec §6.3）', () => {
    // 【為什麼要夾】不夾的話僚機會與自己的安全層打架：站位控制器命令
    // 下降、安全層命令拉起，每一格互相抵銷。
    const lead = craft(new Vector3(0, 30, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: 0, across: 0, up: -100 }, 0, OUT)
    expect(OUT.y).toBeCloseTo(DEFAULT_SAFETY.clearance, 6)
  })

  it('海面不是 0 時夾制跟著抬高', () => {
    const lead = craft(new Vector3(0, 100, 0), new Vector3(0, 0, -200))
    stationPoint(lead, { along: 0, across: 0, up: 0 }, 50, OUT)
    expect(OUT.y).toBeCloseTo(50 + DEFAULT_SAFETY.clearance, 6)
  })
})

describe('STATION_OFFSETS —— 四指隊形（M6 spec §6.2）', () => {
  it('長度等於 Schwarm 大小，position 0 是佔位（它永遠不會被讀）', () => {
    expect(STATION_OFFSETS.length).toBe(4)
    expect(STATION_OFFSETS[0]).toEqual({ along: 0, across: 0, up: 0 })
  })

  it('相對 members[0] 的橫向分布是 0 / +200 / −250 / −450，跨度 650 m', () => {
    // position 3 的參考機是 members[2]，所以要疊加
    const p1 = STATION_OFFSETS[1]!.across
    const p2 = STATION_OFFSETS[2]!.across
    const p3 = p2 + STATION_OFFSETS[3]!.across
    expect(p1).toBe(200)
    expect(p2).toBe(-250)
    expect(p3).toBe(-450)
    expect(Math.max(0, p1, p2, p3) - Math.min(0, p1, p2, p3)).toBe(650)
  })

  it('每一架都在參考機後方 —— 僚機在前面看不到長機', () => {
    for (let i = 1; i < STATION_OFFSETS.length; i++) {
      expect(STATION_OFFSETS[i]!.along).toBeLessThan(0)
    }
  })
})
