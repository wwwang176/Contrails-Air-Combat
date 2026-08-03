import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  aliveCount, createBattle, resetBattle, stepBattle, DEFAULT_BATTLE,
} from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_FIRE } from '../../src/ai/fire'
import { SCHWARM_SIZE, STATION_REFERENCE } from '../../src/battle/flights'
import { STATION_OFFSETS, stationPoint } from '../../src/ai/station'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Combatant } from '../../src/world/World'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

describe('createBattle 的編制', () => {
  it('雙方各 perSide 架，玩家在藍隊', () => {
    const b = createBattle(new Idle())
    expect(b.blue).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.red).toHaveLength(DEFAULT_BATTLE.perSide)
    expect(b.world.combatants).toHaveLength(DEFAULT_BATTLE.perSide * 2)
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
    expect(b.board.assignments).toHaveLength(DEFAULT_BATTLE.perSide * 2)
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

  it('每隊切成 perSide / SCHWARM_SIZE 個分隊', () => {
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
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide)
    b.blue[0]!.alive = false
    b.blue[1]!.alive = false
    expect(aliveCount(b.blue)).toBe(DEFAULT_BATTLE.perSide - 2)
  })
})

const DT = 1 / 240

describe('全滅與重置', () => {
  it('雙方都還有人時倒數為 0', () => {
    const b = createBattle(new Idle())
    stepBattle(b, DT)
    expect(b.countdown).toBe(0)
  })

  it('一方全滅後開始倒數', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    stepBattle(b, DT)
    expect(b.countdown).toBeGreaterThan(0)
    expect(b.countdown).toBeLessThanOrEqual(b.cfg.resetCountdown)
  })

  it('倒數走完之後整場回到滿編', () => {
    const b = createBattle(new Idle())
    for (const c of b.red) c.alive = false
    const steps = Math.ceil(b.cfg.resetCountdown / DT) + 2
    for (let i = 0; i < steps; i++) stepBattle(b, DT)
    expect(aliveCount(b.red)).toBe(b.cfg.perSide)
    expect(aliveCount(b.blue)).toBe(b.cfg.perSide)
    expect(b.countdown).toBe(0)
  })

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
    b.world.projectiles.spawn(0, 4000, 0, 0, 0, -800, 6, 0)
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
