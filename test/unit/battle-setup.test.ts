import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, playerFlight, playerWingman, resetBattle, stepBattle, DEFAULT_BATTLE,
  OPENING_VNE_FRACTION,
} from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { A6M5 } from '../../src/specs/a6m5'
import { F4F4 } from '../../src/specs/f4f4'
import { F6F5 } from '../../src/specs/f6f5'
import { atmosphere } from '../../src/physics/atmosphere'
import type { AirData } from '../../src/physics/types'
import { ALLIED_NAMES, AXIS_NAMES } from '../../src/battle/names'
import { TAKEOVER_DELAY } from '../../src/battle/takeover'
import { DEFAULT_FIRE } from '../../src/ai/fire'
import { SCHWARM_SIZE, STATION_REFERENCE, stationReferenceOf } from '../../src/battle/flights'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Combatant } from '../../src/world/World'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast, sideCount } from '../../src/battle/order'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

describe('createBattle 的編制', () => {
  it('雙方各自的架數，玩家在藍隊', () => {
    const b = createBattle(new Idle())
    expect(b.blue).toHaveLength(sideCount(DEFAULT_BATTLE.units, 'blue'))
    expect(b.red).toHaveLength(sideCount(DEFAULT_BATTLE.units, 'red'))
    expect(b.world.combatants)
      .toHaveLength(sideCount(DEFAULT_BATTLE.units, 'blue') + sideCount(DEFAULT_BATTLE.units, 'red'))
    expect(b.blue).toContain(b.player)
    expect(b.player.team).toBe('blue')
  })

  it('玩家用傳進來的控制器，其餘都是 AI', () => {
    const pc = new Idle()
    const b = createBattle(pc)
    expect(b.player.controller).toBe(pc)
    const others = b.world.combatants.filter((c) => c !== b.player)
    expect(others.every((c) => c.controller !== pc)).toBe(true)
  })

  it('combatants 的 index 等於陣列位置——指派板的前提', () => {
    const b = createBattle(new Idle())
    b.world.combatants.forEach((c, i) => expect(c.index).toBe(i))
    expect(b.board.assignments)
      .toHaveLength(sideCount(DEFAULT_BATTLE.units, 'blue') + sideCount(DEFAULT_BATTLE.units, 'red'))
  })

  it('沒有人一出生就設定了固定目標', () => {
    const b = createBattle(new Idle())
    expect(Array.from(b.board.assignments).every((a) => a === -1)).toBe(true)
  })

  it('一律不重生——一方全滅要能被偵測到', () => {
    const b = createBattle(new Idle())
    expect(b.world.combatants.every((c) => !c.respawnOnDestroy)).toBe(true)
  })
})

describe('createBattle 的出生幾何', () => {
  const b = createBattle(new Idle())

  const centre = (cs: readonly Combatant[]): Vector3 => {
    const v = new Vector3()
    for (const c of cs) v.add(c.aircraft.state.position)
    return v.divideScalar(cs.length)
  }
  const fwd = (c: Combatant): Vector3 =>
    new Vector3(0, 0, -1).applyQuaternion(c.aircraft.state.orientation)

  it('兩隊在航線方向上相距 entryRange', () => {
    // 【M6 起量分隊原點而不是重心】站位偏置的 along 全是負的（僚機在
    // 參考機後方），平均 −90 m，而「後方」對兩隊是反向的 —— 重心因此
    // 被往兩邊各拉開 90 m。entryRange 控制的是分隊原點，與 lateralOffset
    // 同一個定義；同一隊的分隊原點共用一個 z，所以這一條是精確的。
    expect(Math.abs(b.blue[0]!.aircraft.state.position.z - b.red[0]!.aircraft.state.position.z))
      .toBeCloseTo(DEFAULT_BATTLE.entryRange, 3)
  })

  it('兩隊橫向錯開 lateralOffset，且對稱於原點', () => {
    // 【為什麼比長機而不是比重心】站位偏置的累積橫向量平均是 −125 m，
    // 會把重心拉走 —— 但那對兩隊是對稱的，所以「以原點為中心」仍然成立
    // （相機與小地圖吃的是這一條）。lateralOffset 控制的是分隊原點。
    const bx = b.blue[0]!.aircraft.state.position.x
    const rx = b.red[0]!.aircraft.state.position.x
    expect(rx - bx).toBeCloseTo(DEFAULT_BATTLE.lateralOffset, 3)
    expect(centre(b.blue).x + centre(b.red).x).toBeCloseTo(0, 6)
  })

  it('最接近的一對藍紅橫向隔開兩倍射擊錐——不然開局就是一場對頭槍戰', () => {
    // 【這一條抓過一次全滅】M5 的 lateralOffset 為 0 時，藍 slot k 與紅
    // slot k 在 Z 軸上完全共線，20 場精準對頭槍戰讓藍隊每 9 秒被零損失
    // 全滅一次。
    //
    // 【M6 為什麼要量真實位置而不是比設定值】站位的 across 在紅隊會鏡射
    // （stationPoint 讀的是速度方向），所以同編號的兩架不是差一個
    // lateralOffset，而是差 `offset − 2·a_k`。直接量位置就不必把那條
    // 代數複製到測試裡。
    const cone = DEFAULT_BATTLE.entryRange * Math.tan(DEFAULT_FIRE.trackingCone)
    for (let i = 0; i < b.blue.length; i++) {
      const dx = Math.abs(
        b.blue[i]!.aircraft.state.position.x - b.red[i]!.aircraft.state.position.x,
      )
      expect(dx).toBeGreaterThan(2 * cone)
    }
  })

  it('兩隊面對面：機首方向的點積為 −1', () => {
    expect(fwd(b.blue[0]!).dot(fwd(b.red[0]!))).toBeCloseTo(-1, 6)
  })

  it('兩隊機首都指著對方', () => {
    // 藍隊在 +Z、朝 −Z；紅隊在 −Z、朝 +Z
    //
    // 【門檻由 0.99 重新推導為 cos 15°】M5 的 0.99（8.1°）是在
    // 「錯開 300 m ÷ 距離 3,000 m」下量的。M6 的兩隊錯開 1,500 m、
    // 站位鏡射再加 250 m，10 km 下重心對重心偏軸 atan(1750/10180) = 9.8°
    // —— 舊門檻擋不住它，但那不是退化，是設計值。
    //
    // 15° 不是為了讓它通過而選的：它是 `schwarmSpacing` 註解裡已經寫死的
    // 上界（最外側的一架落在 ±2,675 m，10 km 下偏軸 15°）。這一條要守的
    // 是「大致對頭，不是側翼包抄」，用同一個設計上界當門檻才是一致的。
    const toRed = centre(b.red).sub(centre(b.blue)).normalize()
    expect(fwd(b.blue[0]!).dot(toRed)).toBeGreaterThan(Math.cos(15 * Math.PI / 180))
  })

  it('速度與機首同向，大小等於 tas', () => {
    for (const c of b.world.combatants) {
      const f = fwd(c)
      const v = c.aircraft.state.velocity.clone().normalize()
      expect(v.dot(f)).toBeCloseTo(1, 5)
      expect(c.aircraft.state.velocity.length()).toBeCloseTo(DEFAULT_BATTLE.tas, 3)
    }
  })

  it('高度散布在 ±altitudeSpread 之內，而且真的有散開', () => {
    // 【M6 起要加上站位的 up】分隊之間用鋸齒散開，分隊之內由站位偏置
    // 給高度差 —— 兩者相加才是一架飛機的實際高度。
    const maxUp = Math.max(...STATION_OFFSETS.map((o) => o.up))
    const ys = b.world.combatants.map((c) => c.aircraft.state.position.y)
    for (const y of ys) {
      expect(Math.abs(y - DEFAULT_BATTLE.altitude)).toBeLessThanOrEqual(
        DEFAULT_BATTLE.altitudeSpread + maxUp + 1e-6,
      )
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(DEFAULT_BATTLE.altitudeSpread)
  })

  it('沒有兩架出生在同一點', () => {
    const cs = b.world.combatants
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        expect(cs[i]!.aircraft.state.position.distanceTo(cs[j]!.aircraft.state.position))
          .toBeGreaterThan(1)
      }
    }
  })

  it('prevPosition 與 prevOrientation 同步——重生不會被內插成殘影', () => {
    for (const c of b.world.combatants) {
      expect(c.aircraft.prevPosition.distanceTo(c.aircraft.state.position)).toBe(0)
      expect(c.aircraft.prevOrientation.angleTo(c.aircraft.state.orientation)).toBe(0)
    }
  })
})

describe('Schwarm 的出生佈局（M6 spec §8.3）', () => {
  const b = createBattle(new Idle())

  it('每隊切成 blueCount / SCHWARM_SIZE 個分隊', () => {
    expect(b.blue.length % SCHWARM_SIZE).toBe(0)
    expect(b.blue.length / SCHWARM_SIZE).toBe(5)
  })

  it('出生位置就是站位 —— 不是另一份長得很像的幾何', () => {
    // 【這是本任務最重要的一條】生成與站位若各寫一份，兩者遲早會漂開，
    // 而症狀是「開局全隊先橫移一次才成隊」。生成直接呼叫 stationPoint，
    // 這一條就是它的證明。
    const p = new Vector3()
    for (const team of [b.blue, b.red]) {
      for (let base = 0; base < team.length; base += SCHWARM_SIZE) {
        for (let k = 1; k < SCHWARM_SIZE && base + k < team.length; k++) {
          const ref = team[base + STATION_REFERENCE[k]!]!
          stationPoint(ref.aircraft, STATION_OFFSETS[k]!, 0, p)
          expect(team[base + k]!.aircraft.state.position.distanceTo(p)).toBeLessThan(1e-6)
        }
      }
    }
  })

  it('紅隊的僚機在世界座標的另一側 —— 站位是相對機首定義的', () => {
    // 不鏡射的話紅隊的出生位置就不等於它自己的站位，一開局全隊會先橫移一次
    const dxBlue = b.blue[1]!.aircraft.state.position.x - b.blue[0]!.aircraft.state.position.x
    const dxRed = b.red[1]!.aircraft.state.position.x - b.red[0]!.aircraft.state.position.x
    expect(dxBlue).toBeCloseTo(STATION_OFFSETS[1]!.across, 3)
    expect(dxRed).toBeCloseTo(-STATION_OFFSETS[1]!.across, 3)
  })

  it('相鄰兩個分隊的長機相距 schwarmSpacing', () => {
    for (let f = 1; f * SCHWARM_SIZE < b.blue.length; f++) {
      const dx = b.blue[f * SCHWARM_SIZE]!.aircraft.state.position.x
        - b.blue[(f - 1) * SCHWARM_SIZE]!.aircraft.state.position.x
      expect(dx).toBeCloseTo(DEFAULT_BATTLE.schwarmSpacing, 3)
    }
  })

  it('玩家是自己分隊的長機', () => {
    expect(b.blue.indexOf(b.player) % SCHWARM_SIZE).toBe(0)
  })

  it('開局有足夠的編隊巡航時間 —— entryRange 撐得起 15 秒以上', () => {
    // 第一次扣扳機約在 1,500 m，對頭接近率是兩機速度相加
    const closure = DEFAULT_BATTLE.tas * 2
    const cruise = (DEFAULT_BATTLE.entryRange - 1500) / closure
    expect(cruise).toBeGreaterThan(15)
  })
})

describe('createBattle 的決策相位', () => {
  it('40 架的相位平均散開，不是全部擠在 0', () => {
    const b = createBattle(new Idle())
    // 跑滿一個決策週期（10 Hz、240 Hz 物理 → 24 步）
    const stepsPerPeriod = 24
    const perStep: number[] = []
    for (let s = 0; s < stepsPerPeriod; s++) {
      let n = 0
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (!(ai instanceof AiController)) continue
        const before = ai.decisionsMade
        ai.update(c.aircraft, 1 / 240, c.command)
        if (ai.decisionsMade > before) n++
      }
      perStep.push(n)
    }
    // 39 架 AI 攤在 24 步裡，任何一步都不該超過 4 架
    expect(Math.max(...perStep)).toBeLessThanOrEqual(4)
    expect(perStep.reduce((a, x) => a + x, 0)).toBe(39)
  })
})

describe('aliveCount', () => {
  it('數存活的', () => {
    const b = createBattle(new Idle())
    expect(aliveCount(b.blue)).toBe(sideCount(DEFAULT_BATTLE.units, 'blue'))
    b.blue[0]!.alive = false
    b.blue[1]!.alive = false
    expect(aliveCount(b.blue)).toBe(sideCount(DEFAULT_BATTLE.units, 'blue') - 2)
  })
})

const DT = 1 / 240

describe('勝負（M9 spec §8）', () => {
  it('雙方都還有人時仍在交戰', () => {
    const b = createBattle(new Idle())
    stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
  })

  it('紅隊全滅 = 勝利', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })

  it('藍隊全滅 = 落敗', () => {
    const b = createBattle(new Idle())
    for (const c of b.blue) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
  })

  it('分出勝負之後不會自己重置', () => {
    // 【為什麼要守這一條】M5 到 M8 的行為是 3 秒後自動回到滿編。主選單一
    // 進來那條路徑就必須消失，否則玩家永遠回不到結算畫面。
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    for (let i = 0; i < Math.ceil(10 / DT); i++) stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    expect(aliveCount(b.red)).toBe(0)
  })

  it('分出勝負之後結果不再翻轉', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    for (const c of b.blue) c.alive = false
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })
})

describe('重置', () => {
  it('重置把血量、位置、指派板一起清乾淨', () => {
    const b = createBattle(new Idle())
    const spawn = b.red[0]!.aircraft.state.position.clone()
    b.red[0]!.hp = 1
    b.red[0]!.aircraft.state.position.set(9999, 9999, 9999)
    b.board.assignments.fill(3)
    resetBattle(b)
    expect(b.red[0]!.hp).toBe(b.red[0]!.aircraft.spec.hp)
    expect(b.red[0]!.aircraft.state.position.distanceTo(spawn)).toBeLessThan(1e-6)
    expect(Array.from(b.board.assignments).every((a) => a === -1)).toBe(true)
  })

  it('重置後彈丸池是空的——上一場的流彈不會打到新的一場', () => {
    const b = createBattle(new Idle())
    b.world.projectiles.spawn(0, 4000, 0, 0, 0, -800, 6, 0, 0, PROJECTILE_LIFETIME, 12.7)
    expect(b.world.projectiles.live).toBeGreaterThan(0)
    resetBattle(b)
    expect(b.world.projectiles.live).toBe(0)
  })

  it('重置後方位與速度回到開局狀態', () => {
    const b = createBattle(new Idle())
    const before = b.red[0]!.aircraft.state.orientation.clone()
    const vBefore = b.red[0]!.aircraft.state.velocity.clone()
    b.red[0]!.aircraft.state.orientation.set(0.5, 0.5, 0.5, 0.5).normalize()
    b.red[0]!.aircraft.state.velocity.set(0, 0, 0)
    resetBattle(b)
    expect(b.red[0]!.aircraft.state.orientation.angleTo(before)).toBeLessThan(1e-6)
    expect(b.red[0]!.aircraft.state.velocity.distanceTo(vBefore)).toBeLessThan(1e-3)
  })
})

describe('決定性（M5 spec §3.1 條件 7）', () => {
  it('同一組設定跑兩次，逐架位置與血量一致', () => {
    const run = (): number[] => {
      const b = createBattle(new Idle())
      for (let i = 0; i < 240 * 5; i++) stepBattle(b, DT)
      return b.world.combatants.flatMap((c) => [
        c.aircraft.state.position.x, c.aircraft.state.position.y, c.aircraft.state.position.z,
        c.hp,
      ])
    }
    expect(run()).toEqual(run())
  })
})

describe('編制接線（M6 spec §5）', () => {
  /** 取出第 i 架的 AiController；不是 AI 就丟例外（測試裡這代表寫錯了）。 */
  function ai(b: ReturnType<typeof createBattle>, index: number): AiController {
    const c = b.world.combatants[index]!.controller
    if (!(c instanceof AiController)) throw new Error(`第 ${index} 架不是 AI`)
    return c
  }

  it('分隊長機沒有站位，其餘三架有', () => {
    const b = createBattle(new Idle())
    expect(stationReferenceOf(b.flights, 0)).toBe(-1)
    expect(stationReferenceOf(b.flights, 1)).toBe(0)
    expect(stationReferenceOf(b.flights, 2)).toBe(0)
    expect(stationReferenceOf(b.flights, 3)).toBe(2)
    expect(ai(b, 0).stationReference).toBeNull()
    expect(ai(b, 1).stationReference).toBe(b.world.combatants[0]!.aircraft)
    expect(ai(b, 3).stationReference).toBe(b.world.combatants[2]!.aircraft)
  })

  it('玩家沒有站位 —— 他是自己分隊的長機', () => {
    const b = createBattle(new Idle())
    expect(stationReferenceOf(b.flights, b.player.index)).toBe(-1)
  })

  it('members[1] 陣亡後，下一步 members[2] 就遞補成新的僚機', () => {
    // 【這是玩家看得到的行為】你的僚機被打掉，同分隊另一個 Rotte 有人
    // 滑過來補位。
    const b = createBattle(new Idle())
    const before = ai(b, 2).stationOffset
    b.world.destroy(b.world.combatants[1]!)
    stepBattle(b, DT)
    expect(ai(b, 2).stationOffset).toBe(STATION_OFFSETS[1]!)
    expect(ai(b, 2).stationOffset).not.toBe(before)
    expect(ai(b, 3).stationReference).toBe(b.world.combatants[0]!.aircraft)
  })

  it('長機陣亡後，僚機升為長機並失去站位', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[0]!)
    stepBattle(b, DT)
    expect(ai(b, 1).stationReference).toBeNull()
    expect(ai(b, 1).stationReferenceIndex).toBe(-1)
  })

  it('分隊只剩一架時它沒有站位 —— 退化成 M5 的獨行俠', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[0]!)
    b.world.destroy(b.world.combatants[1]!)
    b.world.destroy(b.world.combatants[3]!)
    stepBattle(b, DT)
    expect(ai(b, 2).stationReference).toBeNull()
  })

  it('玩家重生後回到自己分隊的長機位', () => {
    const b = createBattle(new Idle())
    b.player.alive = false
    stepBattle(b, DT)
    b.player.alive = true
    stepBattle(b, DT)
    expect(b.flights.positionOf[b.player.index]).toBe(0)
    expect(stationReferenceOf(b.flights, b.player.index)).toBe(-1)
  })

  it('重置之後編制回到滿編', () => {
    const b = createBattle(new Idle())
    b.world.destroy(b.world.combatants[1]!)
    stepBattle(b, DT)
    resetBattle(b)
    expect(b.flights.flights[0]!.count).toBe(SCHWARM_SIZE)
    expect(ai(b, 1).stationReference).toBe(b.world.combatants[0]!.aircraft)
  })
})

describe('playerFlight / playerWingman', () => {
  it('回傳玩家的分隊與僚機', () => {
    const b = createBattle(new Idle())
    const f = playerFlight(b)
    expect(f).not.toBeNull()
    expect(f!.count).toBe(SCHWARM_SIZE)
    expect(f!.members[0]).toBe(b.player.index)
    expect(playerWingman(b)).toBe(b.player.index + 1)
  })

  it('僚機陣亡後 playerWingman 指向遞補上來的那一架', () => {
    const b = createBattle(new Idle())
    const first = playerWingman(b)
    b.world.destroy(b.world.combatants[first]!)
    stepBattle(b, DT)
    expect(playerWingman(b)).toBe(first + 1)
  })

  it('分隊只剩玩家時 playerWingman 回 −1', () => {
    const b = createBattle(new Idle())
    const f = playerFlight(b)!
    for (let i = 1; i < f.count; i++) b.world.destroy(b.world.combatants[f.members[i]!]!)
    stepBattle(b, DT)
    expect(playerWingman(b)).toBe(-1)
  })
})

describe('名冊（M9 spec §6）', () => {
  it('每個座位一位飛行員，玩家只有一位', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1234)
    expect(b.roster.pilots).toHaveLength(b.world.combatants.length)
    expect(b.roster.pilots.filter((p) => p.isPlayer)).toHaveLength(1)
    expect(b.roster.pilots[b.player.index]!.isPlayer).toBe(true)
  })

  it('同種子同名單', () => {
    const a = createBattle(new Idle(), DEFAULT_BATTLE, 777)
    const c = createBattle(new Idle(), DEFAULT_BATTLE, 777)
    expect(a.roster.pilots.map((p) => p.name))
      .toEqual(c.roster.pilots.map((p) => p.name))
  })

  it('全場名字不重複', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 55)
    const names = b.roster.pilots.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('藍隊拿同盟國的名字、紅隊拿軸心國的', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 9)
    for (const c of b.blue) expect(ALLIED_NAMES).toContain(b.roster.pilots[c.index]!.name)
    for (const c of b.red) expect(AXIS_NAMES).toContain(b.roster.pilots[c.index]!.name)
  })
})

describe('stepBattle 的戰績記錄（M9 spec §4.3）', () => {
  it('擊墜記在兇手身上、陣亡記在受害者身上', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
    expect(b.roster.pilots[victim.index]!.alive).toBe(false)
  })

  it('窗口內打過的拿助攻', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const helper = b.blue[2]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 10, 'wingLeft', helper)
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    expect(b.roster.pilots[helper.index]!.assists).toBe(1)
    expect(b.roster.pilots[killer.index]!.assists).toBe(0)
  })

  it('撞海在戰績上完全不存在 —— 只是退場', () => {
    // 【自殺不算真的擊殺】不給 K、不給 D、也不給助攻。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const victim = b.red[0]!
    const helper = b.blue[1]!
    b.world.applyDamage(victim, 10, 'wingLeft', helper)
    b.world.destroy(victim)
    stepBattle(b, DT)
    expect(b.roster.pilots[victim.index]!.alive).toBe(false)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(0)
    expect(b.roster.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
    expect(b.roster.pilots.reduce((s, p) => s + p.assists, 0)).toBe(0)
  })

  it('呼叫端沒有排空時也不會重複計數', () => {
    // 【為什麼這條非有不可】`main.ts` 每個子步排空擊墜事件，headless 的
    // 測試不排。不排的話同一筆事件會在後續每一步被再掃一次 —— 靠的是
    // `recordKill` 的「已陣亡就略過」讓重掃變成空操作。這條測試守的就是
    // 那個冪等性；它一破，守恆律會永遠失衡而症狀離成因很遠。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 1)
    const killer = b.blue[1]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 99999, 'fuselage', killer)
    for (let i = 0; i < 20; i++) stepBattle(b, DT)
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    expect(b.roster.pilots[victim.index]!.deaths).toBe(1)
  })
})

describe('玩家陣亡接手僚機（M9 spec §7）', () => {
  /**
   * 玩家的僚機座位。
   *
   * 【為什麼不能寫 `b.blue[1]`】玩家是**正中央分隊的長機**，perSide 20 時
   * 落在座位 8，他的分隊是 [8, 9, 10, 11] —— 座位 1 是另一個分隊的人，
   * 根本不是接手目標。
   */
  function wingmanSeat(b: ReturnType<typeof createBattle>): number {
    return playerFlight(b)!.members[1]!
  }

  /** 打爆玩家，並走完接手延遲。 */
  function killPlayerAndWait(b: ReturnType<typeof createBattle>, killer: Combatant) {
    b.world.applyDamage(b.player, 99999, 'fuselage', killer)
    stepBattle(b, DT)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
  }

  it('身分互換發生在記錄之前 —— 陣亡記在那位 AI 身上，玩家的戰績原封不動', () => {
    // 【為什麼這是本任務的核心】反過來的話，這次陣亡與兇手的擊墜對象都會
    // 記到玩家頭上，畫面上看起來像自己的戰果被清掉了（M9 spec §7.1）。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    const wingSeat = wingmanSeat(b)
    const playerName = b.roster.pilots[seat]!.name
    const wingName = b.roster.pilots[wingSeat]!.name
    b.roster.pilots[seat]!.kills = 4
    b.roster.pilots[seat]!.assists = 2

    const killer = b.red[0]!
    b.world.applyDamage(b.player, 99999, 'fuselage', killer)
    stepBattle(b, DT)

    // 殘骸那個座位現在坐的是那位 AI，而且他被記為陣亡
    expect(b.roster.pilots[seat]!.name).toBe(wingName)
    expect(b.roster.pilots[seat]!.alive).toBe(false)
    expect(b.roster.pilots[seat]!.deaths).toBe(1)
    expect(b.roster.pilots[seat]!.isPlayer).toBe(false)

    // 玩家搬到僚機的座位，戰績一格也沒少
    expect(b.roster.pilots[wingSeat]!.name).toBe(playerName)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(true)
    expect(b.roster.pilots[wingSeat]!.alive).toBe(true)
    expect(b.roster.pilots[wingSeat]!.kills).toBe(4)
    expect(b.roster.pilots[wingSeat]!.assists).toBe(2)
    expect(b.roster.pilots[wingSeat]!.deaths).toBe(0)

    // 兇手記的是那位 AI 的人頭
    expect(b.roster.pilots[killer.index]!.kills).toBe(1)
    // 死亡鏡頭要轉向他，所以兇手的座位要被記下來
    expect(b.takeoverKiller).toBe(killer.index)
  })

  it('玩家墜海一樣觸發接手 —— 不記 K/D，但人要換', () => {
    // 【為什麼這條非有不可】「自摔什麼都不記」讀起來很像「自摔什麼都不做」。
    // 只要有人把 `killer < 0` 的判斷提到 `drainKills` 開頭，墜海就不再觸發
    // 接手 —— 玩家從此卡在一架已經退場的飛機裡，而記分板上每個數字都正常，
    // 沒有任何東西會透露這件事（算死亡、觸發換機，但不記 K/D）。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    const wingSeat = wingmanSeat(b)
    // 走真正的撞海路徑：crashPolicy 判定 → world.destroy(c)，沒有兇手
    b.player.aircraft.state.position.y = -50
    stepBattle(b, DT)

    expect(b.world.combatants[seat]!.alive).toBe(false)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(true)
    // 戰績上完全不存在
    expect(b.roster.pilots.reduce((s, p) => s + p.kills, 0)).toBe(0)
    expect(b.roster.pilots.reduce((s, p) => s + p.deaths, 0)).toBe(0)
    // 沒有兇手可以看 —— 死亡鏡頭就定定看著自己的火球
    expect(b.takeoverKiller).toBe(-1)

    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
    expect(b.player.index).toBe(wingSeat)
  })

  it('操縱權在延遲之後才移交', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    const wingSeat = wingmanSeat(b)
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    // 才過一步：還沒交
    expect(b.player.index).toBe(seat)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
    expect(b.player.index).toBe(wingSeat)
  })

  it('移交之後控制器換人、編制改釘新座位', () => {
    const controller = new Idle()
    const b = createBattle(controller, DEFAULT_BATTLE, 3)
    const wingSeat = wingmanSeat(b)
    killPlayerAndWait(b, b.red[0]!)
    expect(b.world.combatants[wingSeat]!.controller).toBe(controller)
    expect(b.flights.pinned).toBe(wingSeat)
    expect(playerFlight(b)!.members[0]).toBe(wingSeat)
  })

  it('舊機體維持陣亡 —— 不再重生，所以渲染層會留下殘骸', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const seat = b.player.index
    killPlayerAndWait(b, b.red[0]!)
    expect(b.world.combatants[seat]!.alive).toBe(false)
  })

  it('沒有人可以接手時判落敗', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    for (const c of b.blue) if (c !== b.player) c.alive = false
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
    // 沒有互換，陣亡就記在玩家自己頭上
    expect(b.roster.pilots[b.player.index]!.isPlayer).toBe(true)
    expect(b.roster.pilots[b.player.index]!.deaths).toBe(1)
  })

  it('延遲期間接手目標又被打死 —— 再換一次，玩家再吃一次陣亡', () => {
    // 【為什麼要有這條】那 2 秒裡接手目標仍由它原本的 AI 在飛，所以它有
    // 可能先死（M9 spec §7.4）。行為要明確，不是「怎麼會這樣」。
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const wingSeat = wingmanSeat(b)
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(true)

    b.world.applyDamage(b.world.combatants[wingSeat]!, 99999, 'fuselage', b.red[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[wingSeat]!.isPlayer).toBe(false)
    const player = b.roster.pilots.find((p) => p.isPlayer)!
    expect(player.alive).toBe(true)
    expect(player.deaths).toBe(0)
  })
})

describe('R 重開的完整復原（M9 spec §8）', () => {
  it('玩家回到開局座位，被接手過的座位還給 AI', () => {
    const controller = new Idle()
    const b = createBattle(controller, DEFAULT_BATTLE, 3)
    const seat = b.playerSeat
    // 【僚機是同分隊的下一位，不是 blue[1]】玩家是正中央分隊的長機
    const wingSeat = playerFlight(b)!.members[1]!
    b.world.applyDamage(b.player, 99999, 'fuselage', b.red[0]!)
    for (let i = 0; i < Math.ceil(TAKEOVER_DELAY / DT) + 2; i++) stepBattle(b, DT)
    expect(b.player.index).toBe(wingSeat)

    resetBattle(b)
    expect(b.player.index).toBe(seat)
    expect(b.world.combatants[seat]!.controller).toBe(controller)
    expect(b.world.combatants[wingSeat]!.controller).toBeInstanceOf(AiController)
    expect(b.flights.pinned).toBe(seat)
  })

  it('戰績歸零、結果回到交戰中、接手狀態清空', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    b.world.applyDamage(b.red[0]!, 99999, 'fuselage', b.blue[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[b.blue[1]!.index]!.kills).toBe(1)

    resetBattle(b)
    for (const p of b.roster.pilots) {
      expect(p.kills).toBe(0)
      expect(p.deaths).toBe(0)
      expect(p.assists).toBe(0)
      expect(p.alive).toBe(true)
    }
    expect(b.outcome).toBe('fighting')
    expect(b.takeoverSeat).toBe(-1)
  })

  it('重開換一批名字', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const before = b.roster.pilots.map((p) => p.name)
    resetBattle(b, 99)
    expect(b.roster.pilots.map((p) => p.name)).not.toEqual(before)
  })

  it('重開清掉傷害紀錄 —— 上一場的擦傷不會變成這一場的助攻', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, 3)
    const helper = b.blue[2]!
    const victim = b.red[0]!
    b.world.applyDamage(victim, 10, 'wingLeft', helper)
    resetBattle(b)
    b.world.applyDamage(victim, 99999, 'fuselage', b.blue[1]!)
    stepBattle(b, DT)
    expect(b.roster.pilots[helper.index]!.assists).toBe(0)
  })
})

describe('雙方架數與機種可設定（M10 spec §6）', () => {
  it('兩邊架數不同時各自正確', () => {
    const cfg = { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 3, BF109K4, 7) }
    const b = createBattle(new Idle(), cfg, 1)
    expect(b.blue).toHaveLength(3)
    expect(b.red).toHaveLength(7)
    expect(b.world.combatants).toHaveLength(10)
    expect(b.blue).toContain(b.player)
  })

  it('機種依參數而不是寫死', () => {
    const cfg = { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, BF109K4, 20, P51D, 20) }
    const b = createBattle(new Idle(), cfg, 1)
    for (const c of b.blue) expect(c.aircraft.spec.id).toBe('bf109k4')
    for (const c of b.red) expect(c.aircraft.spec.id).toBe('p51d')
  })

  it('名冊跟著機種走 —— 藍隊飛 Bf109 就拿德文名', () => {
    // 【為什麼這條非有不可】M9 spec §7.1 裁決「換的是機種不是隊伍顏色」，
    // 而名冊靠的是那一隊第一架的 `spec.faction`。這條測試守住那個裁決真的成立。
    const cfg = { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, BF109K4, 20, P51D, 20) }
    const b = createBattle(new Idle(), cfg, 5)
    for (const c of b.blue) expect(AXIS_NAMES).toContain(b.roster.pilots[c.index]!.name)
    for (const c of b.red) expect(ALLIED_NAMES).toContain(b.roster.pilots[c.index]!.name)
  })

  it('藍隊只有一架時，那一架就是玩家', () => {
    const cfg = { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 1, BF109K4, 4) }
    const b = createBattle(new Idle(), cfg, 1)
    expect(b.blue).toHaveLength(1)
    expect(b.player).toBe(b.blue[0])
    expect(playerFlight(b)).not.toBeNull()
    expect(playerFlight(b)!.count).toBe(1)
  })

  it('1 vs 1 也跑得動', () => {
    const cfg = { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 1, BF109K4, 1) }
    const b = createBattle(new Idle(), cfg, 1)
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
  })

  /**
   * 【再打一場之後指揮層不得讀到凍結座標】
   *
   * `Aircraft.reset` 若做 `this.state = createFlightState(...)`，就把
   * `state.position` 換成一個**新的** `Vector3`；而 `createBattle` 若把指揮層
   * 快照的位置抓成那個向量的**別名**，`resetBattle`（再打一場）對每一架都
   * 呼叫 `World.respawn` → `reset()` 之後，40 個別名全部指向孤兒，指揮層
   * 從此讀一整場凍結的座標。
   *
   * 實測（`test/tools/rally-reset.probe.ts`）：重開後 40/40 架失聯、最大
   * 落差 5300 m，集合令因此解除不掉、最長握了 344 秒 —— 人工回報的症狀是
   * AI 繞著一個五公里外的鬼位置無限盤旋。壞掉的不只集合令：側翼落點、
   * 集火解除、撤退令錨的敵群質心全都一起讀鬼影。
   *
   * 兩道修法各配一條斷言：`reset` 就地寫回（物件同一性），指揮層每步
   * `copy`（數值跟得上）。兩者任一被改回去，這裡就紅。
   */
  it('再打一場之後，指揮層的快照仍然跟著飛機走', () => {
    const b = createBattle(new AiController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 8, BF109K4, 8) }, 7)
    const before = b.world.combatants.map((c) => c.aircraft.state)

    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    resetBattle(b, 9)
    // 重開之後要真的飛一段，凍結才會顯現 —— 剛重置時兩者恰好都在出生點
    for (let i = 0; i < 240 * 20; i++) stepBattle(b, DT)

    for (let i = 0; i < b.world.combatants.length; i++) {
      const c = b.world.combatants[i]!
      // 一、`reset` 不得換掉 `state` 物件（根因）
      expect(c.aircraft.state).toBe(before[i])
      // 二、快照的數值必須等於當下的真實座標（第二道防線）
      const u = b.commandUnits[i]!
      const p = c.aircraft.state.position
      expect(u.position.distanceTo(p)).toBeLessThan(1e-6)
      expect(u.velocity.distanceTo(c.aircraft.state.velocity)).toBeLessThan(1e-6)
    }
  })

  /**
   * 【快照要是**副本**，不是別名】上一條驗數值跟得上，這一條驗它不是靠
   * 「指到同一個物件」才跟得上的 —— 靠別名等於把「那個物件永遠不會被
   * 換掉」變成一條沒人守的默契。
   */
  it('指揮層快照持有自己的向量，不是飛機那一份的別名', () => {
    const b = createBattle(new AiController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4) }, 3)
    stepBattle(b, DT)
    for (let i = 0; i < b.world.combatants.length; i++) {
      const c = b.world.combatants[i]!
      expect(b.commandUnits[i]!.position).not.toBe(c.aircraft.state.position)
      expect(b.commandUnits[i]!.velocity).not.toBe(c.aircraft.state.velocity)
    }
  })
})

describe('開局空速不撞紅線', () => {
  const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }
  const iasRatio = (c: Combatant): number => {
    const sigma = atmosphere(c.aircraft.state.position.y, air).sigma
    return (c.aircraft.state.velocity.length() * Math.sqrt(sigma)) / c.aircraft.spec.limits.vne
  }

  /**
   * 【每一架自己的 vne、自己的出生高度】`vne` 是 IAS，開局速度是 TAS。
   * 低空 √σ 接近 1，直接拿 vne 夾 TAS 會讓 IAS 貼著 vne —— A6M5 的 vne
   * 只有 145 m/s，任何高度都會撞上；F6F-5 在 2,000 m 的任務裡也會。
   */
  for (const spec of [A6M5, F4F4, F6F5, P51D, BF109K4]) {
    for (const altitude of [600, 2000, 4000]) {
      it(`${spec.name} @ ${altitude} m：IAS 不超過 vne 的 ${OPENING_VNE_FRACTION}`, () => {
        const b = createBattle(new AiController(), {
          ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, spec, 4, spec, 4), altitude,
        })
        for (const c of b.world.combatants) {
          expect(iasRatio(c)).toBeLessThanOrEqual(OPENING_VNE_FRACTION + 1e-9)
        }
      })
    }
  }

  it('上限只往下夾：P-51D 在 4,000 m 的開局仍是 DEFAULT_BATTLE.tas', () => {
    const b = createBattle(new AiController(), {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, P51D, 4),
    })
    for (const c of b.world.combatants) {
      expect(c.aircraft.state.velocity.length()).toBeCloseTo(DEFAULT_BATTLE.tas, 6)
    }
  })

  it('被夾住的那一架不是隨便慢：IAS 貼著上限，不會低於 0.75', () => {
    const b = createBattle(new AiController(), {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, A6M5, 4, A6M5, 4), altitude: 2000,
    })
    for (const c of b.world.combatants) expect(iasRatio(c)).toBeGreaterThan(0.75)
  })
})
