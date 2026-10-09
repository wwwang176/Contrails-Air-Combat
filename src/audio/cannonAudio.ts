import { Vector3 } from 'three'
import type { World } from '../world/World'
import type { GroundUnitId } from '../specs/ground'
import type { AudioEngine } from './engine'
import { groundGunTier, gunSound, shipGunSound } from './catalog'

/**
 * 每發開火聲的音量小變化，±dB。音高的小變化在引擎（`cannon` 類別的 `pitchJitter`），這裡不再乘 ——
 * 兩邊都乘的話幅度會疊成兩倍
 */
export const GUN_GAIN_JITTER_DB = 1

/** 地面戰一幀最多排幾發；超過時丟最遠的。全場同時開火遠低於此數 */
export const GROUND_SHOT_QUEUE = 64

/**
 * 艦砲、高射砲與地面砲聲共用的候選、邊緣偵測與限頻狀態。
 *
 * @param rand 每發音量亂數的來源。測試注入固定值
 */
export function createCannonAudio(audio: Pick<AudioEngine, 'playPool'>, cam: Vector3, rand: () => number = Math.random) {
  /** 高射砲、艦砲開火聲的距離上限，m */
  const CANNON_AUDIO_RANGE = 6000

  const GUN_POS = new Vector3()

  /**
   * 上一幀每一門砲的開火計數（`ShipGun.shots`）—— 增加了就是這兩幀之間開過火。依平台、砲位的順序排。
   *
   * 【不看槍焰】槍焰只亮 0.03 s，低於約 33 幀時會在兩幀之間亮了又滅，那一發就沒有聲音。
   * 【變小不算】世界重設會把計數歸零
   */
  const prevGunShots = new Float64Array(1024)

  /** 每一門砲上一次出聲的時間（`elapsed`），與 `prevGunShots` 同一個順序 */
  const lastShotAt = new Float64Array(1024).fill(-Infinity)

  /**
   * 地面戰每一台上一次出聲的時間（`elapsed`），依 `groundBattle` 的單位序號。超出長度的序號不限頻
   */
  const lastUnitShotAt = new Float64Array(1024).fill(-Infinity)

  /** 地面戰等著下一幀播的開火：種類、位置、離鏡頭的距離、開砲那一台的序號。固定大小，不配置 */
  const queueKind: string[] = new Array<string>(GROUND_SHOT_QUEUE).fill('')
  const queueX = new Float64Array(GROUND_SHOT_QUEUE)
  const queueY = new Float64Array(GROUND_SHOT_QUEUE)
  const queueZ = new Float64Array(GROUND_SHOT_QUEUE)
  const queueDist = new Float64Array(GROUND_SHOT_QUEUE)
  const queueUnit = new Int32Array(GROUND_SHOT_QUEUE)
  let queued = 0

  /**
   * 高射砲、艦砲開火：開火計數增加的那一幀響一下（一幀內開了好幾發也只響一下）。
   *
   * 【每一座砲各自限頻率，總量交給引擎】`gap` 只防同一座在一瞬間疊好幾聲。全場同一種共用一個
   * 時段的話，一公里外那座先開火就把旁邊這座消音（勒熱夫實測：貼著一座四聯 20 mm，它 75% 的開火
   * 被擋，擋它的砲中位數 1,072 m 外）。同時有幾十聲時，引擎的每類配額（`VOICE_QUOTA`）與
   * 「比響度、丟最小聲的」管住總量 —— 被丟的是遠處的砲。
   */
  function playCannons(world: Pick<World, 'ships' | 'groundTargets'>, elapsed: number): void {
    let slot = 0
    // 兩組平台依固定順序掃描，不為每幀建立臨時陣列。
    for (let platform = 0; platform < 2; platform++) {
      const list = platform === 0 ? world.ships : world.groundTargets
      for (const p of list) {
        for (const gun of p.guns) {
          // 【滿了只停止記錄，不能整支返回】地面戰那一趟還沒跑，返回等於它們這一幀全啞
          if (slot >= prevGunShots.length) break
          const s = slot++
          const was = prevGunShots[s]!
          prevGunShots[s] = gun.shots
          if (!(gun.shots > was) || !p.alive) continue
          GUN_POS.copy(gun.zone.position).applyQuaternion(p.orientation).add(p.position)
          if (GUN_POS.distanceTo(cam) >= CANNON_AUDIO_RANGE) continue
          // 陸上砲位帶自己的種類；船依層對到艦砲的三種
          const g = gunSound(gun.zone.sound ?? shipGunSound(gun.zone.tier))
          if (elapsed - lastShotAt[s]! < g.gap) continue
          lastShotAt[s] = elapsed
          audio.playPool(g.pool, 'cannon', GUN_POS.x, GUN_POS.y, GUN_POS.z, true,
            g.gainDb + (rand() * 2 - 1) * GUN_GAIN_JITTER_DB, false)
        }
      }
    }

    // 地面戰：佇列裡每一發依開砲那一台的時段，與砲位同一套。
    // 【佇列不在掃砲位之前清】回呼在 `updateAudio` 之後才寫進來，要留到這一幀；清除放在播完之後。
    // 【被時段擋下的不留】留到下一幀會把一個過時的位置播出來
    for (let i = 0; i < queued; i++) {
      const g = gunSound(queueKind[i]!)
      const u = queueUnit[i]!
      if (u < lastUnitShotAt.length && elapsed - lastUnitShotAt[u]! < g.gap) continue
      if (u < lastUnitShotAt.length) lastUnitShotAt[u] = elapsed
      audio.playPool(g.pool, 'cannon', queueX[i]!, queueY[i]!, queueZ[i]!, true,
        g.gainDb + (rand() * 2 - 1) * GUN_GAIN_JITTER_DB, false)
    }
    queued = 0
  }

  /**
   * 地面戰開一發（戰車、反坦克砲、步兵、迫擊砲）：排進佇列，下一幀的 `playCannons` 播。
   * 種類由 `groundGunTier` 查；沒有種類的單位（卡車、建物）不出聲。佇列滿了時取代最遠的那一發，
   * 這一發比它還遠就不排。熱路徑：不配置
   *
   * @param index 開砲那一台的序號（`groundBattle` 的單位序號），限頻率依它
   */
  function noteGroundShot(unit: GroundUnitId, x: number, y: number, z: number, index: number): void {
    const kind = groundGunTier(unit)
    if (kind === null) return
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
    if (d >= CANNON_AUDIO_RANGE) return
    let k = queued
    if (k < GROUND_SHOT_QUEUE) {
      queued++
    } else {
      k = 0
      for (let i = 1; i < GROUND_SHOT_QUEUE; i++) if (queueDist[i]! > queueDist[k]!) k = i
      if (d >= queueDist[k]!) return
    }
    queueKind[k] = kind
    queueX[k] = x
    queueY[k] = y
    queueZ[k] = z
    queueDist[k] = d
    queueUnit[k] = index
  }

  function reset(): void {
    prevGunShots.fill(0)
    lastShotAt.fill(-Infinity)
    lastUnitShotAt.fill(-Infinity)
    queued = 0
  }

  return { playCannons, noteGroundShot, reset }
}
