import { hash01 } from '../core/hash'
import type { Flares } from '../world/flares'
import type { GroundTarget } from '../world/groundTargets'
import { PLANT_STACKS } from '../world/leuna'
import type { TerrainKind } from '../world/terrainKind'
import type { Particles } from './particles'
import { STEAM_PLUME_SPEED } from './smoke'

/** 每一座冒煙的構件每秒幾顆蒸汽 */
const STEAM_PER_SECOND = 6

/**
 * 蒸汽被吹斜的水平速度，m/s，與抖動的幅度。
 *
 * 【風向要固定】每一顆各抽一個方向的話，柱子是往四面散開的一叢；真的煙囪
 * 是整片往同一邊斜。八根煙囪的斜度一致，才有「同一片天空」的感覺。
 */
const STEAM_WIND_X = 2.6

const STEAM_WIND_Z = -1.4

const STEAM_GUST = 0.7

/** 每一枚亮著的照明彈每秒幾顆白煙 */
const FLARE_SMOKE_PER_SECOND = 4

/** 白煙的發射節拍與共用種子。建立一次，粒子池重設時仍保留未滿一顆的累積量。 */
export function createSteamEmission(steam: Pick<Particles, 'emit'>) {
  let steamAccum = 0
  let steamSeed = 0
  let flareSmokeAccum = 0

  /**
   * 廠區的白煙：每一座**活著的**煙囪與冷卻塔在頂端持續冒蒸汽，加上佈景的
   * 八根煙囪（打不掉，所以炸完六座構件之後廠區仍在冒煙）。純裝飾，種子用
   * 計數器 —— 與 `emitFirePuff` 同一套。
   *
   * 【這裡不配置記憶體】每幀跑。`PLANT_STACKS` 是模組常數而且已經是世界
   * 座標，迴圈裡沒有 `new`、沒有換算。
   */
  function emitPlantSteam(frameSeconds: number, targets: readonly GroundTarget[], terrainKind: TerrainKind): void {
    steamAccum += frameSeconds * STEAM_PER_SECOND
    const n = Math.floor(steamAccum)
    if (n <= 0) return
    steamAccum -= n
    if (terrainKind === 'leuna') {
      for (const p of PLANT_STACKS) {
        for (let k = 0; k < n; k++) {
          const s = (steamSeed = (steamSeed + 1) | 0)
          const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
          const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
          const ox = (hash01(s * 3 + 3) * 2 - 1) * 1.5
          steam.emit(p.x + ox, p.y, p.z,
            STEAM_WIND_X + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z + gz, 1)
        }
      }
    }
    for (const t of targets) {
      if (!t.alive) continue
      const id = t.unit.id
      if (id !== 'chimney' && id !== 'coolingTower') continue
      for (let k = 0; k < n; k++) {
        const s = (steamSeed = (steamSeed + 1) | 0)
        const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
        const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
        // 冷卻塔的頂寬，蒸汽從整個頂面冒；煙囪從一個點
        const spread = id === 'coolingTower' ? 8 : 1.5
        const ox = (hash01(s * 3 + 3) * 2 - 1) * spread
        steam.emit(t.position.x + ox, t.impactY, t.position.z,
          STEAM_WIND_X + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z + gz, 1)
      }
    }
  }

  /**
   * 照明彈的白煙：傘降的煙是往上拖的。借 `steam` 池（與廠區的蒸汽同一個），
   * 種子用同一個計數器。每幀跑，不配置。
   */
  function emitFlareSmoke(frameSeconds: number, fl: Flares): void {
    if (fl.count === 0) return
    flareSmokeAccum += frameSeconds * FLARE_SMOKE_PER_SECOND
    const n = Math.floor(flareSmokeAccum)
    if (n <= 0) return
    flareSmokeAccum -= n
    for (let i = 0; i < fl.capacity; i++) {
      // 還沒點燃的不冒煙
      if (fl.live[i] === 0 || fl.age[i]! < 0) continue
      for (let k = 0; k < n; k++) {
        const s = (steamSeed = (steamSeed + 1) | 0)
        const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
        const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
        steam.emit(fl.x[i]!, fl.y[i]!, fl.z[i]!, STEAM_WIND_X * 0.5 + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z * 0.5 + gz, 1.5)
      }
    }
  }

  return { emitPlantSteam, emitFlareSmoke }
}
