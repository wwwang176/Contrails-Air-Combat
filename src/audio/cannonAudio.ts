import { Vector3 } from 'three'
import type { World } from '../world/World'
import type { GroundUnitId } from '../specs/ground'
import type { AudioEngine } from './engine'
import { groundGunTier, gunSound } from './catalog'

/** 艦砲、高射砲與地面砲聲共用的候選、邊緣偵測與限頻狀態。 */
export function createCannonAudio(audio: Pick<AudioEngine, 'playPool'>, cam: Vector3) {
  /** 高射砲、艦砲開火聲的距離上限，m */
  const CANNON_AUDIO_RANGE = 6000

  const GUN_POS = new Vector3()

  /** 上一幀每一門砲的 flash —— 由 0 變正就是剛開火。依平台、砲位的順序排 */
  const prevGunFlash = new Float32Array(1024)

  /** 每一層砲上一次開火出聲的時間（`elapsed`）。層的名字見 `world/shipAA.ts` */
  const lastGunTier = new Map<string, number>()

  /**
   * 這一幀每一層最近的那一座剛開火的砲。**值就地改寫，不在幀迴圈裡配置** ——
   * 只有第一次見到某一層時才建一個。
   */
  const gunPick = new Map<string, { dist: number; x: number; y: number; z: number }>()

  /**
   * 高射砲、艦砲開火：flash 由 0 變正的那一幀響一下。
   *
   * 【每一層各自限頻率，而且只響最近的那一座】20 mm 一座每秒八發、一艘船八個
   * 砲位 —— 不限的話光它就把聲道吃光，五吋砲與爆炸反而聽不見。但那個時段是
   * **整個戰場共用一個**，取第一個輪到的等於隨機挑：貼著一座砲飛時，聽到的
   * 常常是八百公尺外那一門在響，而旁邊這門悶不吭聲。所以先掃一趟挑最近的。
   */
  function playCannons(world: Pick<World, 'ships' | 'groundTargets'>, elapsed: number): void {
    // 第一趟：邊緣偵測，每一層留下離鏡頭最近的那一座。
    // 【候選不在這裡清】地面戰的砲口聲（`noteGroundShot`）在 `updateAudio` 之後才寫進來，要留到
    // 下一幀的這支函式；清除放在第二趟播完之後
    let slot = 0
    // 兩組平台依固定順序掃描，不為每幀建立臨時陣列。
    for (let platform = 0; platform < 2; platform++) {
      const list = platform === 0 ? world.ships : world.groundTargets
      for (const p of list) {
        for (const gun of p.guns) {
          // 【滿了只停止記錄，不能整支返回】第二趟還沒跑，返回等於這一幀全啞
          if (slot >= prevGunFlash.length) break
          const was = prevGunFlash[slot]!
          prevGunFlash[slot++] = gun.flash
          if (!(gun.flash > 0 && was <= 0) || !p.alive) continue
          GUN_POS.copy(gun.zone.position).applyQuaternion(p.orientation).add(p.position)
          const d = GUN_POS.distanceTo(cam)
          if (d >= CANNON_AUDIO_RANGE) continue
          let best = gunPick.get(gun.zone.tier)
          if (best === undefined) {
            best = { dist: Infinity, x: 0, y: 0, z: 0 }
            gunPick.set(gun.zone.tier, best)
          }
          if (d >= best.dist) continue
          best.dist = d
          best.x = GUN_POS.x
          best.y = GUN_POS.y
          best.z = GUN_POS.z
        }
      }
    }

    // 第二趟：每一層在自己的時段裡響一次，位置取剛才挑到的那一座
    for (const [tier, best] of gunPick) {
      if (best.dist === Infinity) continue
      const g = gunSound(tier)
      // 【不論響不響都清掉】被時段擋下的候選留到下一幀，會把一個過時的位置播出來
      best.dist = Infinity
      if (elapsed - (lastGunTier.get(tier) ?? -Infinity) < g.gap) continue
      lastGunTier.set(tier, elapsed)
      audio.playPool('cannon', 'cannon', best.x, best.y, best.z, true,
        g.gainDb, false, g.rate, g.cutoffHz)
    }
  }

  /**
   * 地面戰的戰車砲、反坦克砲開一發：記下這一層離鏡頭最近的一發，下一幀的 `playCannons` 播。
   * 聲音庫與限頻率都與艦砲、重高砲同一套，層名由 `groundGunTier` 查；沒有層的單位（卡車、建物）
   * 不出聲。熱路徑：只有第一次見到某一層時才配置。
   */
  function noteGroundShot(unit: GroundUnitId, x: number, y: number, z: number): void {
    const tier = groundGunTier(unit)
    if (tier === null) return
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z)
    if (d >= CANNON_AUDIO_RANGE) return
    let best = gunPick.get(tier)
    if (best === undefined) {
      best = { dist: Infinity, x: 0, y: 0, z: 0 }
      gunPick.set(tier, best)
    }
    if (d >= best.dist) return
    best.dist = d
    best.x = x
    best.y = y
    best.z = z
  }

  function reset(): void {
    prevGunFlash.fill(0)
    lastGunTier.clear()
    gunPick.clear()
  }

  return { playCannons, noteGroundShot, reset }
}
