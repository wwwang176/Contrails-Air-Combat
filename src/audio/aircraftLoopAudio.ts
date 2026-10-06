import type { Vector3 } from 'three'
import type { Combatant } from '../world/combatant'
import { indicatedAirspeed } from '../core/airspeed'
import type { AudioEngine } from './engine'
import { engineFile, fireFile, sirenFile, turretFile } from './catalog'
import { SIREN_AUDIBLE_DB, dopplerRate, engineRate, noseDownRad, sirenParams } from './curves'
import { nearestN } from './nearest'

/** 飛機定位循環的聲道選擇與開火保持；暫存只在建立時配置。 */
export function createAircraftLoopAudio(audio: Pick<AudioEngine, 'assign'>, cam: Vector3, camVel: Vector3) {
  const SIREN = { rate: 0, gainDb: 0 }
  /**
   * 別人的槍：最近這麼多秒內開過火就算「還在開火」，s。
   *
   * 【為什麼要保持】槍口閃光一發只亮 0.03 s，發與發之間有好幾幀是 0 ——
   * 直接看閃光的話，開火的循環一幀開、一幀關，聲道一直釋放又重播。砲塔更嚴重：
   * 不保持的話 60 秒內重啟一千多次。
   *
   * 【自己的槍不用這個】自己那架不播循環 —— 每次擊發播一個齊射 one-shot，
   * 見 `CUE.SelfVolley` 與 `volleyPool`。
   */
  const FIRE_HOLD = 0.25

  const ENGINE_KEYS = new Int32Array(8)

  const FIRE_KEYS = new Int32Array(6)

  const TURRET_KEYS = new Int32Array(6)

  const SIREN_KEYS = new Int32Array(4)

  const SIREN_RATE = new Float32Array(64)

  const SIREN_GAIN = new Float32Array(64)

  const AUDIO_VALID = new Uint8Array(64)

  /** 每架飛機前射武器、砲塔最近一次開火的時間（`elapsed`），依座位索引 */
  const lastGunFire = new Float64Array(64)

  const lastTurretFire = new Float64Array(64)

  /** 每架轟炸機的砲塔循環用第幾座的聲音；−1 = 還沒挑。見 `noteTurretFire` */
  const turretPick = new Int16Array(64)

  function anyFlash(a: Float32Array): boolean {
    for (let i = 0; i < a.length; i++) if (a[i]! > 0) return true
    return false
  }

  /**
   * 記下這架轟炸機的砲塔循環用哪一座的聲音：**最近在開火、管數最多的那一座**。
   *
   * 【只往大的換】閃光一幀一幀在不同砲塔之間跳；每一幀都挑「現在亮著的」的話，
   * 單管、雙聯輪流被選到，每換一次檔就從頭播。停火超過 FIRE_HOLD 才重新挑。
   * 呼叫時 `lastTurretFire` 還是上一次開火的時間。
   */
  function noteTurretFire(c: Combatant, elapsed: number): void {
    const turrets = c.aircraft.spec.turrets
    let cand = -1
    for (let i = 0; i < turrets.length; i++) {
      if (c.turretStates[i]!.flash > 0 && (cand < 0 || turrets[i]!.guns > turrets[cand]!.guns)) cand = i
    }
    if (cand < 0) return
    const i = c.index
    const cur = turretPick[i]!
    if (cur < 0 || elapsed - lastTurretFire[i]! >= FIRE_HOLD || turrets[cand]!.guns > turrets[cur]!.guns) turretPick[i] = cand
    lastTurretFire[i] = elapsed
  }

  /** positions 依座位索引排列，直接讀顯示管理器的內插位置，不重建位置清單。 */
  function update(
    all: readonly Combatant[], positions: readonly Vector3[], me: Combatant,
    elapsed: number, flying: boolean, ownTurretVolley: boolean,
  ): void {
    const n = Math.min(all.length, AUDIO_VALID.length)

    // 引擎：自己不定位；上帝視角時自己也進定位池
    for (let i = 0; i < n; i++) {
      const c = all[i]!
      AUDIO_VALID[i] = c.alive && !c.retired && (c !== me || !flying) ? 1 : 0
    }
    let m = nearestN(positions, AUDIO_VALID, n, cam.x, cam.y, cam.z, ENGINE_KEYS)
    for (let j = 0; j < m; j++) {
      const c = all[ENGINE_KEYS[j]!]!
      const p = positions[c.index]!
      // 【循環音才有多普勒】單次音效的音源是靜止的（爆炸），沒有升降調可言
      const doppler = dopplerRate(p, c.aircraft.state.velocity, cam, camVel)
      audio.assign('engine', c.index, engineFile(c.aircraft.spec.id), p.x, p.y, p.z,
        engineRate(c.command.throttle) * doppler)
    }
    // 俯衝警笛（`sirenFile` 有檔的機種）：隊友、敵人、上帝視角的自己；座艙裡的自己由呼叫端播 selfLoop。
    // 【可聞門檻】巡航中的不進池 —— 免得佔掉四個聲道、也不抬高 HDR 的窗口
    for (let i = 0; i < n; i++) {
      const c = all[i]!
      AUDIO_VALID[c.index] = 0
      if (!c.alive || c.retired || (c === me && flying) || sirenFile(c.aircraft.spec.id) === null) continue
      sirenParams(
        indicatedAirspeed(c.aircraft.diag.aero.tas, c.aircraft.diag.air.sigma) / c.aircraft.spec.limits.vne,
        noseDownRad(c.aircraft.state.orientation), SIREN)
      SIREN_RATE[c.index] = SIREN.rate
      SIREN_GAIN[c.index] = SIREN.gainDb
      if (SIREN.gainDb > SIREN_AUDIBLE_DB) AUDIO_VALID[c.index] = 1
    }
    m = nearestN(positions, AUDIO_VALID, n, cam.x, cam.y, cam.z, SIREN_KEYS)
    for (let j = 0; j < m; j++) {
      const c = all[SIREN_KEYS[j]!]!
      const p = positions[c.index]!
      audio.assign('siren', c.index, sirenFile(c.aircraft.spec.id)!, p.x, p.y, p.z,
        SIREN_RATE[c.index]! * dopplerRate(p, c.aircraft.state.velocity, cam, camVel), SIREN_GAIN[c.index]!)
    }
    // 開火的保持：最近 FIRE_HOLD 秒內開過火就算還在開火
    for (let i = 0; i < n; i++) {
      const c = all[i]!
      if (anyFlash(c.muzzleFlash)) lastGunFire[i] = elapsed
      noteTurretFire(c, elapsed)
    }
    // 其他戰鬥機開火
    for (let i = 0; i < n; i++) {
      const c = all[i]!
      // 【上帝視角時自己也算一架】那時自機在畫面裡，開火聲該從它身上來
      AUDIO_VALID[i] = c.alive && (c !== me || !flying) && fireFile(c.aircraft.spec.id) !== null
        && elapsed - lastGunFire[i]! < FIRE_HOLD ? 1 : 0
    }
    m = nearestN(positions, AUDIO_VALID, n, cam.x, cam.y, cam.z, FIRE_KEYS)
    for (let j = 0; j < m; j++) {
      const c = all[FIRE_KEYS[j]!]!
      const p = positions[c.index]!
      audio.assign('fire', c.index, fireFile(c.aircraft.spec.id)!, p.x, p.y, p.z,
        dopplerRate(p, c.aircraft.state.velocity, cam, camVel))
    }
    // 砲塔（自己的轟炸機也算 —— 砲塔由 AI 操作）
    for (let i = 0; i < n; i++) {
      const c = all[i]!
      // 【自己那架的後座機槍走齊射庫，不進循環】與前機槍同一個道理（上帝視角時才輪到循環）
      AUDIO_VALID[i] = c.alive && turretPick[i]! >= 0 && elapsed - lastTurretFire[i]! < FIRE_HOLD
        && !(c === me && flying && ownTurretVolley) ? 1 : 0
    }
    m = nearestN(positions, AUDIO_VALID, n, cam.x, cam.y, cam.z, TURRET_KEYS)
    for (let j = 0; j < m; j++) {
      const c = all[TURRET_KEYS[j]!]!
      const t = c.aircraft.spec.turrets[turretPick[c.index]!]!
      const p = positions[c.index]!
      audio.assign('turret', c.index, turretFile(t.weapon.id, t.guns), p.x, p.y, p.z,
        dopplerRate(p, c.aircraft.state.velocity, cam, camVel))
    }
  }

  function reset(): void {
    lastGunFire.fill(-Infinity)
    lastTurretFire.fill(-Infinity)
    turretPick.fill(-1)
  }

  return { update, reset }
}
