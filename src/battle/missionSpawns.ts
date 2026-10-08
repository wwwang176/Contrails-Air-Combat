import type { FeelCache } from './battleState'
import { Quaternion, Vector3 } from 'three'
import type { FeelKind } from '../specs/feel'
import type { AircraftSpec } from '../specs/types'
import type { GroundUnitId } from '../specs/ground'
import { P51D } from '../specs/p51d'
import type { World } from '../world/World'
import { SHIP_CLASSES, createShip } from '../world/ships'
import {
  createGroundBattery, createShipGuns, GROUND_LIGHT_FLAK_SPEC, GROUND_M16_SPEC, GROUND_MG_SPEC,
  resetShipGuns, type ShipGunSpec,
} from '../world/shipGuns'
import { createGroundTarget } from '../world/groundTargets'
import { parkedOffset } from '../world/groundAirframe'
import { createBalloon } from '../world/balloons'
import type { BalloonEntry, GroundEntry, MissionFleet } from './missions'
import { feeledSpec } from './flightSpawn'

/**
 * 停在地上的哪一種單位是一架飛機（`GroundTarget.airframe`）。在地上是地面目標，
 * 離地才是空中那一池的飛機；血量、部位、防護力兩邊相同。
 */
const GROUND_AIRFRAME: Readonly<Partial<Record<GroundUnitId, AircraftSpec>>> = {
  parkedP51: P51D,
}

/**
 * 依 `cfg.fleet` 把船放進世界。**省略就一艘都不放。**
 *
 * 偏移是艦隊座標，所以先轉艏向再加中心 —— 改艏向時陣型跟著轉，不必重算
 * 每一艘的世界座標。
 */
export function placeFleet(world: Pick<World, 'ships'>, fleet: MissionFleet | undefined): void {
  if (fleet === undefined) return
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), fleet.heading)
  const p = new Vector3()
  for (const e of fleet.ships) {
    p.copy(e.offset).applyQuaternion(q).add(fleet.center)
    const cls = SHIP_CLASSES[e.cls]
    // 【`vital` 也要透傳】漏掉的症狀是「打沉航母卻沒判輸」，不報錯
    const ship = createShip(
      world.ships.length, cls, e.team, p.x, p.z, fleet.heading + (e.heading ?? 0), fleet.speed,
      e.vital === true,
    )
    ship.guns = createShipGuns(cls)
    ship.gunCooldowns = new Float32Array(cls.zones.length)
    resetShipGuns(ship)
    world.ships.push(ship)
  }
}

/**
 * 依 `cfg.balloons` 把防空氣球放進世界。**省略就一顆都不放。**
 *
 * 繫在船上的：錨點是那艘船的甲板點轉到世界（船不動，建一次就好）。地面的：
 * 高度先填 0，地形接上之後由 `settleBalloons` 落地。
 */
export function placeBalloons(world: Pick<World, 'ships' | 'balloons'>, entries: readonly BalloonEntry[] | undefined): void {
  if (entries === undefined) return
  const p = new Vector3()
  for (const e of entries) {
    const a = e.anchor
    let x: number, y: number, z: number
    if ('ship' in a) {
      const sh = world.ships[a.ship]
      if (sh === undefined) throw new Error(`氣球繫在第 ${a.ship} 艘船上，但這一關只有 ${world.ships.length} 艘`)
      p.copy(a.deck).applyQuaternion(sh.orientation).add(sh.position)
      x = p.x; y = p.y; z = p.z
    } else {
      x = a.x; y = 0; z = a.z
    }
    world.balloons.push(createBalloon(
      world.balloons.length, e.team, x, y, z, e.tether, e.heading, !('ship' in a),
    ))
  }
}

/**
 * 依 `cfg.ground` 把地面目標放進世界。**省略就一台都不放。**
 *
 * 【高度先擺 0】這時 `world.groundAt` 還是預設值（地形在 `main.ts` 建完
 * 戰鬥之後才注入）。落地由 `settleGroundTargets` 在那之後做。
 */
export function placeGround(
  world: Pick<World, 'groundTargets'>, ground: readonly GroundEntry[] | undefined, feeled: FeelCache, flakSpec?: ShipGunSpec,
  feels?: Readonly<Record<string, FeelKind>>,
): void {
  if (ground === undefined) return
  for (const e of ground) {
    const t = createGroundTarget(
      world.groundTargets.length, e.unit, e.team, e.x, e.z, e.heading, e.motion ?? null, e.hidden === true,
    )
    if (e.killAt !== undefined) t.killAt = e.killAt
    // 【地上的飛機照飛機算】血量、部位、防護力與天上那一架相同。規格從同一張
    // 手感表拿 —— 離地時交給的那一席用的是同一份（`spawnMember`）
    const base = GROUND_AIRFRAME[e.unit]
    if (base !== undefined) {
      const spec = feeledSpec(feeled[e.team], base, feels)
      t.airframe = spec
      t.hp = spec.hp
      // 【先算好】第一發打到它的子彈才算的話，那一步會在物理迴圈裡配置
      parkedOffset(spec)
    }
    // 【重高砲位會還手】掛上砲之後它就是一座 `GunPlatform`，與艦砲走同一支
    // `stepGunPlatform`。其餘的地面單位（戰車、卡車、火車、廠房）不掛
    if (e.unit === 'flakHeavy' || e.unit === 'usFlakHeavy') t.guns = createGroundBattery(flakSpec)
    // 【輕型砲也還手】走直射彈那一層，曳光看得見。規格不逐關複寫 —— 試玩改
    // 規格本身。M16 半履帶車與輕砲同一個火力，射界壓得比較低（`GROUND_M16_SPEC`）
    else if (e.unit === 'flakLight') {
      t.guns = createGroundBattery(GROUND_LIGHT_FLAK_SPEC, 'autocannon', GROUND_LIGHT_FLAK_SPEC.caliber)
    } else if (e.unit === 'usFlakTrack') {
      t.guns = createGroundBattery(GROUND_M16_SPEC, 'autocannon', GROUND_M16_SPEC.caliber)
    }
    // 【車頂的機槍由條目指定】同一種卡車在別的關可以只是靶
    else if (e.guns === 'mg') {
      t.guns = createGroundBattery(GROUND_MG_SPEC, 'mg', GROUND_MG_SPEC.caliber)
    }
    world.groundTargets.push(t)
  }
}
