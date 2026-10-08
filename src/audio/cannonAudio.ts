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

  /** 每一種砲聲上一次出聲的時間（`elapsed`）。種類見 `catalog.ts` 的 `gunSound` */
  const lastGunKind = new Map<string, number>()

  /**
   * 這一幀每一種砲聲最近的那一座剛開火的砲。**值就地改寫，不在幀迴圈裡配置** ——
   * 只有第一次見到某一種時才建一個。
   */
  const gunPick = new Map<string, { dist: number; x: number; y: number; z: number }>()

  /**
   * 高射砲、艦砲開火：開火計數增加的那一幀響一下（一幀內開了好幾發也只響一下）。
   *
   * 【每一種各自限頻率，而且只響最近的那一座】20 mm 一座每秒八發、一艘船八個
   * 砲位 —— 不限的話光它就把聲道吃光，五吋砲與爆炸反而聽不見。但那個時段是
   * **整個戰場共用一個**，取第一個輪到的等於隨機挑：貼著一座砲飛時，聽到的
   * 常常是八百公尺外那一門在響，而旁邊這門悶不吭聲。所以先掃一趟挑最近的。
   */
  function playCannons(world: Pick<World, 'ships' | 'groundTargets'>, elapsed: number): void {
    // 第一趟：邊緣偵測，每一種留下離鏡頭最近的那一座。
    // 【候選不在這裡清】地面戰的砲口聲（`noteGroundShot`）在 `updateAudio` 之後才寫進來，要留到
    // 下一幀的這支函式；清除放在第二趟播完之後
    let slot = 0
    // 兩組平台依固定順序掃描，不為每幀建立臨時陣列。
    for (let platform = 0; platform < 2; platform++) {
      const list = platform === 0 ? world.ships : world.groundTargets
      for (const p of list) {
        for (const gun of p.guns) {
          // 【滿了只停止記錄，不能整支返回】第二趟還沒跑，返回等於這一幀全啞
          if (slot >= prevGunShots.length) break
          const was = prevGunShots[slot]!
          prevGunShots[slot++] = gun.shots
          if (!(gun.shots > was) || !p.alive) continue
          GUN_POS.copy(gun.zone.position).applyQuaternion(p.orientation).add(p.position)
          const d = GUN_POS.distanceTo(cam)
          if (d >= CANNON_AUDIO_RANGE) continue
          // 陸上砲位帶自己的種類；船依層對到艦砲的三種
          const kind = gun.zone.sound ?? shipGunSound(gun.zone.tier)
          let best = gunPick.get(kind)
          if (best === undefined) {
            best = { dist: Infinity, x: 0, y: 0, z: 0 }
            gunPick.set(kind, best)
          }
          if (d >= best.dist) continue
          best.dist = d
          best.x = GUN_POS.x
          best.y = GUN_POS.y
          best.z = GUN_POS.z
        }
      }
    }

    // 第二趟：每一種在自己的時段裡響一次，位置取剛才挑到的那一座
    for (const [kind, best] of gunPick) {
      if (best.dist === Infinity) continue
      const g = gunSound(kind)
      // 【不論響不響都清掉】被時段擋下的候選留到下一幀，會把一個過時的位置播出來
      best.dist = Infinity
      if (elapsed - (lastGunKind.get(kind) ?? -Infinity) < g.gap) continue
      lastGunKind.set(kind, elapsed)
      audio.playPool(g.pool, 'cannon', best.x, best.y, best.z, true,
        g.gainDb + (rand() * 2 - 1) * GUN_GAIN_JITTER_DB, false)
    }
  }

  /**
   * 地面戰的戰車砲、反坦克砲開一發：記下這一種離鏡頭最近的一發，下一幀的 `playCannons` 播。
   * 限頻率與艦砲、重高砲同一套，種類由 `groundGunTier` 查；沒有種類的單位（卡車、建物）
   * 不出聲。熱路徑：只有第一次見到某一種時才配置。
   */
  function noteGroundShot(unit: GroundUnitId, x: number, y: number, z: number): void {
    const kind = groundGunTier(unit)
    if (kind === null) return
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
    if (d >= CANNON_AUDIO_RANGE) return
    let best = gunPick.get(kind)
    if (best === undefined) {
      best = { dist: Infinity, x: 0, y: 0, z: 0 }
      gunPick.set(kind, best)
    }
    if (d >= best.dist) return
    best.dist = d
    best.x = x
    best.y = y
    best.z = z
  }

  function reset(): void {
    prevGunShots.fill(0)
    lastGunKind.clear()
    gunPick.clear()
  }

  return { playCannons, noteGroundShot, reset }
}
