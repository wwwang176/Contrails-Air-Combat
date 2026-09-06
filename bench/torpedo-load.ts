import { Vector3 } from 'three'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../src/battle/setup'
import { TORPEDOES_CAPACITY } from '../src/world/torpedo'
import { MISSIONS } from '../src/battle/missions'
import type { ReadyMissionCard } from '../src/battle/missions'
import { missionConfigFrom } from '../src/battle/missions'
import type { Aircraft } from '../src/aircraft/Aircraft'
import type { Command, Controller } from '../src/control/Controller'

export const LOAD_DT = 1 / 240

class Idle implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = false
  }
}

export interface TorpedoLoadState {
  battle: Battle
}

/**
 * 「滿池魚雷 × 一整支艦隊」的負載。
 *
 * 【為什麼不能沿用 `multi-load`】那一份走 `DEFAULT_BATTLE`，**沒有艦隊也
 * 沒有魚雷**（Codex 審查 2026-09-06）。跑它證明不了這一輪的成本 —— 加了池
 * 之後它最多量到八格空池的 `active` 檢查。
 *
 * 這一份用倫內爾島（八艘船），並且每一步把八格全部補滿：每一枚每一步要付
 * 一次高度場取樣，加上對每一艘船一次線段到船心的粗篩。
 */
export function createTorpedoLoad(): TorpedoLoadState {
  const card = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard
  const cfg = missionConfigFrom(card)
  const battle = createBattle(new Idle(), cfg)
  // 【地形照關卡設定給平海】benchmark 不建 render 層，而 `World` 的預設
  // 就是「海是平的、到處都是水」—— 與倫內爾島的實際情形相同
  const state: TorpedoLoadState = { battle }
  fill(state)
  return state
}

function fill(state: TorpedoLoadState): void {
  const t = state.battle.world.torpedoes
  const ships = state.battle.world.ships
  const c = ships[0]
  const cx = c?.position.x ?? 0
  const cz = c?.position.z ?? 0
  while (t.live < TORPEDOES_CAPACITY) {
    // 【散在艦隊四周】全部疊在一起的話包圍球粗篩會一次過或一次不過，
    // 量到的是兩個極端而不是穩態
    const a = (t.dropped / TORPEDOES_CAPACITY) * Math.PI * 2
    state.battle.world.dropTorpedo(
      cx + Math.cos(a) * 900, 60, cz + Math.sin(a) * 900,
      -Math.cos(a) * 90, 0, -Math.sin(a) * 90,
      // 【傷害 0】量的是彈道與碰撞的成本。真的扣血的話船會沉，而沉了的
      // 船在後面的每一步都便宜 —— 那會讓「有魚雷」看起來比「沒魚雷」快
      0, -Math.cos(a), -Math.sin(a),
    )
  }
}

export function stepTorpedoLoad(state: TorpedoLoadState): void {
  fill(state)
  stepBattle(state.battle, LOAD_DT)
}

export function resetTorpedoLoad(state: TorpedoLoadState): void {
  state.battle.world.torpedoes.clear()
  fill(state)
}
