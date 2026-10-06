import { Quaternion, Vector3 } from 'three'
import type { Ship } from '../../world/ships'
import type { GroundTarget } from '../../world/groundTargets'
import { bombAt, torpedoAt, torpedoEntry, type ReelEvent, type Shot } from '../reelShots'
import { createReelOrdnance, type ReelOrdnance } from './reelOrdnance'

export interface ReelBombardmentFx {
  /** 一枚炸彈落地（`water` = 落在海上）。`y` 是地面或海面高度 */
  bomb(x: number, y: number, z: number, water: boolean): void
  /** 魚雷入水那一下的水花 */
  torpedoSplash(x: number, z: number): void
  /** 魚雷在水中跑：落一個航跡節點。`slot` 是第幾條航跡，`serial` 換一條魚雷就換 */
  torpedoWake(slot: number, x: number, z: number, serial: number): void
  /** 魚雷打中船：水柱 */
  torpedoHit(x: number, z: number): void
  /** 地面物件炸毀：一團落地的火、留下燃燒的火點。`fires` 是幾處火點（油桶堆、油槽多一點） */
  groundKill(x: number, y: number, z: number, fires: number): void
  /**
   * 比一枚炸彈大的爆炸：二次爆炸、油槽殉爆。`size` 是相對一枚炸彈的線性倍率，
   * 地面火點也照它的數目點
   */
  blast(x: number, y: number, z: number, size: number): void
  /** 炸彈落在船上：甲板高度的一團火（不掀水冠） */
  shipHit(x: number, y: number, z: number): void
  /** 船上的火點冒一朵火與黑煙（船火那一套煙柱） */
  shipFire(x: number, y: number, z: number): void
}

/** 投射物只需要確認模型仍在場，並取得事件時刻的飛行路徑。 */
export interface ReelReleaseActor {
  readonly model: object | null
  readonly path: Shot['planes'][number]['path']
}

interface BombardmentStage {
  readonly fx: ReelBombardmentFx
  terrain(): {
    collisionHeightAt(x: number, z: number): number
    waterAt(x: number, z: number): number
  }
}

/** 炸彈槽數（外觀池 `BOMBS_CAPACITY` 之內）；魚雷同時在水中的上限 —— 航跡池的槽數 */
const REEL_BOMBS = 96
const REEL_TORPEDOES = 8
/** 炸彈落在地面物件命中盒外多少公尺內就算炸到 */
export const PROP_BLAST_REACH = 15
/** 炸彈落在船體碰撞盒外多少公尺內算打中船（甲板上爆、留火點），m */
const SHIP_HIT_REACH = 2
/** 船上火點冒一朵的間隔，秒（與戰鬥的 `FIRE_PUFF` 同一個節奏） */
const SHIP_FIRE_INTERVAL = 0.3
/** 一艘船最多幾處火點 —— 再多煙柱糊成一片，也多花粒子 */
const SHIP_FIRES_PER_SHIP = 6
/** 魚雷的瞄點離船體多近算打中那一艘（測試要求瞄點在碰撞盒外擴 4 m 內） */
const TORPEDO_SHIP_REACH = 6
/** 船上的一處火：位置記在艦體座標，跟著船走 */
interface ShipFire {
  readonly ship: number
  readonly local: Vector3
  timer: number
}
/** 殉爆的火球相對一枚炸彈的線性倍率 */
const SECONDARY_SIZE = 2.5
/** 炸毀後整片燒的：油桶堆、彈藥堆、油槽、儲氣槽 */
const BURNS_LONG: ReadonlySet<string> = new Set(['fuelDump', 'bombDump', 'oilTank', 'gasHolder'])

/** 持有投放佇列、投射物與船體火點；放映流程只提供當前演員與片內時間。 */
export function createReelBombardment(
  stage: BombardmentStage,
  releasePose: (actor: ReelReleaseActor, time: number, position: Vector3, velocity: Vector3) => void,
  toWorld: (point: Vector3) => Vector3,
  burn: (x: number, z: number) => void,
) {
  const { fx } = stage
  const bombs = createReelOrdnance(REEL_BOMBS)
  const torpedoes = createReelOrdnance(REEL_TORPEDOES)
  let torpedoSerial = 0
  let pendingBombs: { at: number, actor: number }[] = []
  let shipFires: ShipFire[] = []
  const V1 = new Vector3()
  const V2 = new Vector3()
  const LOCAL = new Vector3()
  const INV_Q = new Quaternion()
  const AIM = { x: 0, z: 0 }
  /**
   * `shipUnder` 找到的那一點正下方最高的盒頂，m。**不是 `Ship.impactY`** —— 那是主甲板；
   * 落在 LST 艉樓、Essex 艦島上的炸彈要在它們的頂上爆，不是穿進去到甲板才爆
   */
  let underTop = 0

  function queueBomb(e: Extract<ReelEvent, { kind: 'bomb' }>): void {
    for (let k = 0; k < e.count; k++) pendingBombs.push({ at: e.at + k * e.interval, actor: e.actor })
  }

  function releaseTorpedo(e: Extract<ReelEvent, { kind: 'torpedo' }>, actors: readonly ReelReleaseActor[]): void {
    const a = actors[e.actor]
    if (a === undefined || a.model === null) return
    const i = torpedoes.next
    torpedoes.next = (i + 1) % REEL_TORPEDOES
    // 【姿態取事件那一刻的】事件在擺位之前觸發，演員身上還是上一幀的位置；
    // 導演的鏡頭照 `at` 那一刻算魚雷，差一幀就是一兩公尺
    releasePose(a, e.at, torpedoes.p0[i]!, torpedoes.v0[i]!)
    torpedoes.t0[i] = e.at
    torpedoes.entry[i] = torpedoEntry(torpedoes.p0[i]!, torpedoes.v0[i]!)
    V1.set(e.aim.x, 0, e.aim.z)
    toWorld(V1)
    torpedoes.aimX[i] = V1.x
    torpedoes.aimZ[i] = V1.z
    torpedoes.hit[i] = e.hit ? 1 : 0
    torpedoes.phase[i] = 0
    torpedoes.serial[i] = ++torpedoSerial
    torpedoes.active[i] = 1
  }

  /**
   * 這一點在哪一艘船的船體上（俯視：碰撞盒外擴 `reach` m）。沒有回 −1。
   * 只看水平 —— 呼叫端拿 `underTop` 判斷高度
   */
  function shipUnder(ships: readonly Ship[], p: Vector3, reach = SHIP_HIT_REACH): number {
    for (let k = 0; k < ships.length; k++) {
      const s = ships[k]!
      LOCAL.copy(p).sub(s.position).applyQuaternion(INV_Q.copy(s.orientation).invert())
      let top = -Infinity
      for (const b of s.cls.hull) {
        if (Math.abs(LOCAL.x - b.center.x) < b.half.x + reach
          && Math.abs(LOCAL.z - b.center.z) < b.half.z + reach) top = Math.max(top, b.center.y + b.half.y)
      }
      if (top > -Infinity) {
        underTop = top
        return k
      }
    }
    return -1
  }

  /** 第 `k` 艘船在世界座標 `p` 那裡起火：記成艦體座標，之後跟著船走 */
  function igniteShip(ships: readonly Ship[], k: number, p: Vector3): void {
    let n = 0
    for (const f of shipFires) if (f.ship === k) n++
    if (n >= SHIP_FIRES_PER_SHIP) return
    const s = ships[k]!
    const local = p.clone().sub(s.position).applyQuaternion(INV_Q.copy(s.orientation).invert())
    shipFires.push({ ship: k, local, timer: 0 })
  }

  /** 船上的火點：每 `SHIP_FIRE_INTERVAL` 秒在它現在的位置冒一朵 */
  function stepShipFires(ships: readonly Ship[], dt: number): void {
    for (const f of shipFires) {
      f.timer -= dt
      if (f.timer > 0) continue
      f.timer += SHIP_FIRE_INTERVAL
      const s = ships[f.ship]!
      V1.copy(f.local).applyQuaternion(s.orientation).add(s.position)
      fx.shipFire(V1.x, V1.y, V1.z)
    }
  }

  /** 地面物件炸毀：換殘骸（`alive` false 由外觀池換材質）、爆一團、起火 */
  function destroyProp(g: GroundTarget): void {
    if (!g.alive) return
    g.alive = false
    g.hp = 0
    const burns = BURNS_LONG.has(g.unit.id)
    fx.groundKill(g.position.x, g.position.y, g.position.z, burns ? 5 : 1)
    // 油槽、儲氣槽、油料與彈藥堆殉爆：在半高處多一團比炸彈大得多的火球
    if (burns) fx.blast(g.position.x, (g.position.y + g.impactY) / 2, g.position.z, SECONDARY_SIZE)
  }

  /**
   * 炸彈與魚雷的一幀：照投下那一刻算出現在的位置，填進外觀池。炸彈碰到地面或海面
   * 就爆；魚雷入水掀水花、在水中落航跡、跑到瞄點時（打中的話）炸水柱
   */
  function step(t: number, actors: readonly ReelReleaseActor[], ships: readonly Ship[], props: readonly GroundTarget[]): void {
    // 排著的炸彈到了秒數就投
    for (let k = pendingBombs.length - 1; k >= 0; k--) {
      const p = pendingBombs[k]!
      if (p.at > t) continue
      // 【換到最後再彈出】`splice` 每次回傳一個新陣列；佇列不需要保持順序，而且往回掃，
      // 換過來的那一格已經看過了
      pendingBombs[k] = pendingBombs[pendingBombs.length - 1]!
      pendingBombs.pop()
      const a = actors[p.actor]
      if (a === undefined || a.model === null) continue
      const i = bombs.next
      bombs.next = (i + 1) % REEL_BOMBS
      releasePose(a, p.at, bombs.p0[i]!, bombs.v0[i]!)
      bombs.t0[i] = p.at
      bombs.active[i] = 1
    }
    const terrain = stage.terrain()
    for (let i = 0; i < REEL_BOMBS; i++) {
      if (bombs.active[i] === 0) continue
      const tau = t - bombs.t0[i]!
      bombAt(bombs.p0[i]!, bombs.v0[i]!, tau, V1)
      // 【先看有沒有打中船】船不是地形：落在船上要在甲板高度爆，不是掉到海面掀水柱
      const k = shipUnder(ships, V1)
      if (k >= 0 && V1.y <= underTop) {
        V1.y = underTop
        fx.shipHit(V1.x, V1.y, V1.z)
        igniteShip(ships, k, V1)
        bombs.active[i] = 0
        continue
      }
      const ground = terrain.collisionHeightAt(V1.x, V1.z)
      if (V1.y <= ground) {
        const water = terrain.waterAt(V1.x, V1.z) > -Infinity
        fx.bomb(V1.x, water ? 0 : ground, V1.z, water)
        bombs.active[i] = 0
        // 落在地面物件旁邊就炸毀它
        for (const g of props) {
          if (!g.alive) continue
          const reach = g.radius + PROP_BLAST_REACH
          if ((g.position.x - V1.x) ** 2 + (g.position.z - V1.z) ** 2 < reach * reach) destroyProp(g)
        }
        burn(V1.x, V1.z)
        continue
      }
      bombAt(bombs.p0[i]!, bombs.v0[i]!, tau + 0.02, V2)
      writeOrdnance(bombs, i, V1, V2)
    }
    for (let i = 0; i < REEL_TORPEDOES; i++) {
      if (torpedoes.active[i] === 0) continue
      const tau = t - torpedoes.t0[i]!
      AIM.x = torpedoes.aimX[i]!
      AIM.z = torpedoes.aimZ[i]!
      const phase = torpedoAt(torpedoes.p0[i]!, torpedoes.v0[i]!, torpedoes.entry[i]!, AIM, tau, V1)
      if (phase >= 1 && torpedoes.phase[i] === 0) fx.torpedoSplash(V1.x, V1.z)
      torpedoes.phase[i] = phase
      if (phase === 2) {
        if (torpedoes.hit[i] === 1) {
          fx.torpedoHit(AIM.x, AIM.z)
          // 打中的那艘：命中那一側的船舷水線上方留一處火、甲板上再一處
          V1.set(AIM.x, 0, AIM.z)
          const k = shipUnder(ships, V1, TORPEDO_SHIP_REACH)
          if (k >= 0) {
            V1.y = 4
            igniteShip(ships, k, V1)
            V1.y = underTop
            igniteShip(ships, k, V1)
          }
        }
        torpedoes.active[i] = 0
        continue
      }
      if (phase === 1) fx.torpedoWake(i, V1.x, V1.z, torpedoes.serial[i]!)
      torpedoAt(torpedoes.p0[i]!, torpedoes.v0[i]!, torpedoes.entry[i]!, AIM, tau + 0.02, V2)
      writeOrdnance(torpedoes, i, V1, V2)
    }
  }

  /** 外觀池讀的那幾格：位置與（由下一刻差出來的）速度 —— 彈體順著速度轉正 */
  function writeOrdnance(o: ReelOrdnance, i: number, now: Vector3, next: Vector3): void {
    o.x[i] = now.x
    o.y[i] = now.y
    o.z[i] = now.z
    o.vx[i] = (next.x - now.x) / 0.02
    o.vy[i] = (next.y - now.y) / 0.02
    o.vz[i] = (next.z - now.z) / 0.02
  }

  function clear(): void {
    shipFires = []
    pendingBombs = []
    bombs.active.fill(0)
    torpedoes.active.fill(0)
  }

  return { bombs, torpedoes, queueBomb, releaseTorpedo, destroyProp, step, stepShipFires, clear }
}
