import type { Vector3 } from 'three'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'
import type { teamSlot } from '../world/team'
import type { InputState } from '../input/InputState'
import { indicatedAirspeed } from '../core/airspeed'
import { OVERSPEED_FULL, OVERSPEED_SHAKE, overspeedShake } from '../core/overspeedFeedback'
import type { AudioEngine } from './engine'
import { SINGLE_FILES, engineFile, jamPool, sirenFile, type Pool } from './catalog'
import { engineRate, noseDownRad, shakeGainDb, shakeInterval, sirenParams, sirenWobble, windParams } from './curves'
import { nearMiss } from './nearMiss'
import { dryClickInterval } from '../control/gunHeat'

interface FlightAudioFeedback {
  playHeavyHit(severity: number): void
  teamSlot: typeof teamSlot
  /** 玩家的控制器：前機槍過熱而且扳機按著（`control/gunHeat.ts`） */
  gun: { readonly dryFiring: boolean }
}

/** 自機狀態與附近彈藥的聽覺回饋；換場、接手僚機時重設事件邊緣。 */
export function createFlightAudio(
  audio: Pick<AudioEngine, 'selfLoop' | 'playPool' | 'playFile'>, cam: Vector3,
  input: Pick<InputState, 'godView' | 'viewMode'>, feedback: FlightAudioFeedback,
) {
  const { playHeavyHit, teamSlot, gun } = feedback
  /** 敵彈擦過的判定半徑，m；兩次擦過聲之間至少隔幾秒 */
  const FLYBY_RADIUS = 20

  const FLYBY_GAP = 0.12

  /** 炸彈呼嘯：離自己多近、正在下落才播，m */
  const WHISTLE_RANGE = 400

  /** 一幀掉超過這個比例的 HP 算重擊（高射砲、機砲） */
  const HEAVY_HIT = 0.08

  /** 自機俯衝警笛的播放速度與增益暫存。 */
  const SIREN = { rate: 0, gainDb: 0 }

  const WIND = { cutoffHz: 0, gainDb: 0 }

  /** 炸彈呼嘯：每個炸彈槽播過沒有、上一幀的 age（age 變小代表槽被重用） */
  const whistled = new Uint8Array(512)

  const prevBombAge = new Float64Array(512)

  let prevPlayerHp = -1

  let prevReloading = false

  let prevViewMode: typeof input.viewMode = 'third'

  let rattleTimer = 0

  let lastFlyby = -Infinity

  /**
   * 過熱空響的分組：與自己開火的齊射同一套（武器 id ×挺數），每一組依自己的射速各響各的。
   * 換機種時重建（`jamSpec`）；每幀只讀。
   */
  const MAX_JAM_GROUPS = 4
  const jamPools: (Pool | null)[] = []
  const jamIntervals = new Float64Array(MAX_JAM_GROUPS)
  /** 每一組到下一聲還有幾秒。≤ 0 = 該響了；不在空響時歸 0，下一次按下立刻響 */
  const jamTimers = new Float64Array(MAX_JAM_GROUPS)
  let jamSpec: Combatant['aircraft']['spec'] | null = null

  /** 一幀最多補幾聲空響：分頁在背景回來的那一幀時間很長，補不完的就丟掉 */
  const DRY_CLICK_BURST = 4

  function buildJamGroups(spec: Combatant['aircraft']['spec']): void {
    jamSpec = spec
    jamPools.length = 0
    const mounts = spec.battery.mounts
    for (let i = 0; i < mounts.length && jamPools.length < MAX_JAM_GROUPS; i++) {
      const w = mounts[i]!.weapon
      let first = true
      for (let k = 0; k < i; k++) if (mounts[k]!.weapon.id === w.id) first = false
      if (!first) continue
      let guns = 0
      for (const m of mounts) if (m.weapon.id === w.id) guns++
      jamIntervals[jamPools.length] = dryClickInterval(w.roundsPerMinute)
      jamPools.push(jamPool(w.id, guns))
    }
    jamTimers.fill(0)
  }

  function update(
    world: Pick<World, 'projectiles' | 'bombs'>, me: Combatant,
    elapsed: number, worldSeconds: number, arenaWarning: boolean,
  ): void {
    const flying = me.alive && !input.godView
    // 自己身上的循環
    const spec = me.aircraft.spec
    audio.selfLoop('engine', flying ? engineFile(spec.id) : null, engineRate(me.command.throttle), 0)
    const vneRatio = indicatedAirspeed(me.aircraft.diag.aero.tas, me.aircraft.diag.air.sigma) / spec.limits.vne
    windParams(vneRatio, WIND)
    audio.selfLoop('wind', flying ? SINGLE_FILES.wind : null, 1, WIND.gainDb, WIND.cutoffHz)
    // 俯衝警笛：自己的（不定位）。機頭朝下 10° 以上才響（10–45° 漸變），音量與音高隨空速；沒有警笛檔的機種是 null
    const sirenSelf = sirenFile(spec.id)
    sirenParams(vneRatio, noseDownRad(me.aircraft.state.orientation), SIREN)
    audio.selfLoop('siren', flying && sirenSelf !== null ? sirenSelf : null,
      SIREN.rate * sirenWobble(elapsed, 0), SIREN.gainDb)
    // 警告蜂鳴：飛出邊界，或速度進了紅線（與 HUD 的紅線警告同一個門檻）
    const warn = flying && (arenaWarning || vneRatio >= OVERSPEED_FULL)
    audio.selfLoop('warn', warn ? SINGLE_FILES.warn : null, 1, 0)
    // 過熱時扣扳機的空響：每一組依自己射擊間隔的 2.5 倍一聲（`dryClickInterval`）。
    // 【保留餘數】這裡每畫面幀才跑一次；每響一次就重設整個間隔的話，節奏會隨幀率變慢
    if (spec !== jamSpec) buildJamGroups(spec)
    if (flying && gun.dryFiring) {
      for (let g = 0; g < jamPools.length; g++) {
        const pool = jamPools[g]
        if (pool === null || pool === undefined) continue
        let t = jamTimers[g]! - worldSeconds
        for (let n = 0; t <= 0 && n < DRY_CLICK_BURST; n++) {
          audio.playPool(pool, 'reload', 0, 0, 0, false)
          t += jamIntervals[g]!
        }
        jamTimers[g] = t <= 0 ? jamIntervals[g]! : t
      }
    } else {
      jamTimers.fill(0)
    }

    // 【擦過看的是聽者】`cam` 是聽者的位置（`battleAudioController` 寫入）：自己在飛
    // 時是機身，上帝視角時是在世界裡自由飛的鏡頭 —— 從它旁邊掠過的子彈一樣該有聲音
    const eye = cam
    if (elapsed - lastFlyby >= FLYBY_GAP) {
      const team = input.godView ? -1 : teamSlot(me.team)
      const k = nearMiss(world.projectiles, team, eye.x, eye.y, eye.z, FLYBY_RADIUS)
      if (k >= 0) {
        lastFlyby = elapsed
        const p = world.projectiles
        audio.playPool('flyby', 'flyby', p.x[k]!, p.y[k]!, p.z[k]!, true)
      }
    }

    if (!flying) {
      prevPlayerHp = -1
      return
    }
    const pos = me.aircraft.state.position
    // 附近有炸彈落下 —— **自己投的也算**，那就是投彈的回饋
    const bombs = world.bombs
    const cap = Math.min(bombs.capacity, whistled.length)
    for (let i = 0; i < cap; i++) {
      if (bombs.age[i]! < prevBombAge[i]!) whistled[i] = 0
      prevBombAge[i] = bombs.age[i]!
      if (!bombs.active[i] || whistled[i] || bombs.vy[i]! >= 0) continue
      const dx = bombs.x[i]! - pos.x, dy = bombs.y[i]! - pos.y, dz = bombs.z[i]! - pos.z
      if (dx * dx + dy * dy + dz * dz > WHISTLE_RANGE * WHISTLE_RANGE) continue
      whistled[i] = 1
      audio.playFile(SINGLE_FILES.whistle, 'whistle', bombs.x[i]!, bombs.y[i]!, bombs.z[i]!, true)
    }
    // 重擊：HP 一幀掉很多（高射砲、機砲）
    const drop = prevPlayerHp >= 0 ? prevPlayerHp - me.hp : 0
    if (drop > spec.hp * HEAVY_HIT) playHeavyHit(Math.min(1, drop / (spec.hp * HEAVY_HIT * 2)))
    prevPlayerHp = me.hp
    // 機身晃動：超速或重傷
    const k = Math.min(1, overspeedShake(vneRatio) / OVERSPEED_SHAKE)
    if (k > 0) {
      rattleTimer -= worldSeconds
      if (rattleTimer <= 0) {
        audio.playPool('rattle', 'rattle', 0, 0, 0, false, shakeGainDb(k))
        rattleTimer = shakeInterval(k, Math.random)
      }
    } else {
      rattleTimer = 0
    }
    // 彈艙補滿
    const reloading = me.bombBay.reloading
    if (prevReloading && !reloading) audio.playFile(SINGLE_FILES.reloadDone, 'reload', 0, 0, 0, false)
    prevReloading = reloading
    // 進出投彈瞄準視角：彈艙的機械聲
    if (input.viewMode !== prevViewMode) {
      if (input.viewMode === 'bomb' || prevViewMode === 'bomb') {
        audio.playFile(SINGLE_FILES.bayToggle, 'reload', 0, 0, 0, false)
      }
      prevViewMode = input.viewMode
    }
  }

  function reset(): void {
    whistled.fill(0)
    prevBombAge.fill(0)
    prevPlayerHp = -1
    prevReloading = false
    rattleTimer = 0
    lastFlyby = -Infinity
    jamTimers.fill(0)
    prevViewMode = input.viewMode
  }

  return { update, reset }
}
