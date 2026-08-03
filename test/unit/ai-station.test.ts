import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  DEFAULT_STATION, STATION_OFFSETS, stationCommand, stationPoint,
} from '../../src/ai/station'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { createCommand } from '../../src/control/Controller'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { WEP_THROTTLE } from '../../src/physics/propulsion'

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

describe('stationCommand（M6 spec §6.4）', () => {
  const OFFSET = { along: -60, across: 200, up: 0 }

  /** 把 self 擺到剛好在站位上、且與參考機共速。 */
  function onStation(lead: Aircraft): Aircraft {
    const p = new Vector3()
    stationPoint(lead, OFFSET, 0, p)
    return craft(p, lead.state.velocity.clone())
  }

  it('在站位上且共速時，瞄準方向等於參考機的航跡方向（不是站位點方向）', () => {
    // 【這是近距離平行飛的核心斷言】若前置補償用的是參考機的絕對速度
    // 而不是相對速度，這一條會紅 —— 外推點會在前方 200 m，混合權重
    // 永遠是 1，「平行飛」那一段從來不會生效。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = onStation(lead)
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.aimWorld.y).toBeCloseTo(0, 6)
    expect(out.aimWorld.z).toBeCloseTo(-1, 6)
  })

  it('瞄準方向恆為單位向量', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const out = createCommand()
    for (const d of [0, 5, 50, 300, 5000]) {
      const wing = craft(new Vector3(d, 4000, 900), new Vector3(0, 0, -200))
      stationCommand(wing, lead, OFFSET, 0, out)
      expect(out.aimWorld.length()).toBeCloseTo(1, 9)
    }
  })

  it('離站位很遠時瞄向站位點', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const station = new Vector3()
    stationPoint(lead, OFFSET, 0, station)
    // 擺在站位正下方 2 km、與參考機共速（相對速度為 0，前置項消失）
    const wing = craft(
      station.clone().add(new Vector3(0, -2000, 0)), lead.state.velocity.clone(),
    )
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.aimWorld.y).toBeGreaterThan(0.9)
  })

  it('落後時加油門，追過頭時踩減速板', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const station = new Vector3()
    stationPoint(lead, OFFSET, 0, station)
    const out = createCommand()

    // 落在站位後方 500 m（航跡是 −Z，所以後方是 +Z）且同速
    const behind = craft(station.clone().add(new Vector3(0, 0, 500)), new Vector3(0, 0, -200))
    stationCommand(behind, lead, OFFSET, 0, out)
    expect(out.throttle).toBe(WEP_THROTTLE)
    expect(out.brake).toBe(0)

    // 衝到站位前方 500 m 且比長機快 60 m/s
    const ahead = craft(station.clone().add(new Vector3(0, 0, -500)), new Vector3(0, 0, -260))
    stationCommand(ahead, lead, OFFSET, 0, out)
    expect(out.brake).toBeGreaterThan(0)
  })

  it('在站位上且共速時油門落在巡航附近，不是滿檔也不是關車', () => {
    // 【為什麼要測這一條】bang-bang 的油門會在目標速度附近來回，畫面上
    // 就是僚機一頓一頓。連續的油門才維持得住一個狀態。
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = onStation(lead)
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.throttle).toBeGreaterThan(THROTTLE_FLOOR)
    expect(out.throttle).toBeLessThan(WEP_THROTTLE)
    expect(out.brake).toBe(0)
  })

  it('永遠不開火 —— 開火紀律是獨立的一層', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = craft(new Vector3(500, 4000, 500), new Vector3(0, 0, -200))
    const out = createCommand()
    out.firing = true
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(out.firing).toBe(false)
  })

  it('參考機靜止時不產生 NaN', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, 0))
    const wing = craft(new Vector3(100, 4000, 100), new Vector3(0, 0, -200))
    const out = createCommand()
    stationCommand(wing, lead, OFFSET, 0, out)
    expect(Number.isFinite(out.aimWorld.length())).toBe(true)
    expect(Number.isFinite(out.throttle)).toBe(true)
    expect(Number.isFinite(out.brake)).toBe(true)
  })

  it('與參考機完全重疊時不產生 NaN', () => {
    const lead = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const wing = craft(new Vector3(0, 4000, 0), new Vector3(0, 0, -200))
    const out = createCommand()
    stationCommand(wing, lead, { along: 0, across: 0, up: 0 }, 0, out)
    expect(Number.isFinite(out.aimWorld.length())).toBe(true)
  })

  it('DEFAULT_STATION 的四個值都是正數', () => {
    expect(DEFAULT_STATION.blendRange).toBeGreaterThan(0)
    expect(DEFAULT_STATION.leadTime).toBeGreaterThan(0)
    expect(DEFAULT_STATION.speedGain).toBeGreaterThan(0)
    expect(DEFAULT_STATION.speedBand).toBeGreaterThan(0)
  })
})
