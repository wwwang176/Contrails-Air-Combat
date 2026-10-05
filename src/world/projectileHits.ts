import { Quaternion, Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { AIRCRAFT_ARMOUR, SHIP_GUN_ARMOUR, penetrationDamage } from '../weapons/armour'
import {
  createHitResult, hitAircraft, segmentBox, segmentPointDistanceSq,
  NO_HIT, PART_INDEX, partDamage, type HitPart,
} from './hit'
import type { Projectiles } from './Projectiles'
import { pushImpact, type ImpactEvents } from './events'
import { pushDamage, type DamageEvents } from './damage'
import { CullIndex } from './cull'
import { landHitT, type LandField } from './occlusion'
import { normalAt, type SurfaceNormal } from './heightfield'
import {
  BALLOON_ENVELOPE, BALLOON_REACH, envelopeCenter, type Balloon,
} from './balloons'
import type { Combatant } from './World'
import type { GroundTarget } from './groundTargets'
import type { Ship } from './ships'
import { airframePose } from './groundAirframe'
import { ownerShipIndex } from './shipGuns'
import { MATERIAL } from './material'
import { popIfDead, sinkIfDead, wreckIfDead } from './targetDeaths'

export interface ProjectileHitWorld {
  readonly combatants: readonly Combatant[]
  readonly projectiles: Projectiles
  readonly ships: readonly Ship[]
  readonly groundTargets: readonly GroundTarget[]
  readonly balloons: readonly Balloon[]
  readonly land: LandField | null
  readonly hitEvents: ImpactEvents
  readonly materialHits: ImpactEvents
  readonly shipKillEvents: ImpactEvents
  readonly groundKillEvents: ImpactEvents
  readonly balloonKillEvents: ImpactEvents
  readonly splashEvents: ImpactEvents
  readonly damageEvents: DamageEvents
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void
}

// 模組暫存由同步結算重用；每個世界自己的索引與命中結果由 ProjectileHits 持有。
const S = makeScratch(4)
const LAND_N: SurfaceNormal = { nx: 0, ny: 1, nz: 0 }
const SHIP_INV = /* @__PURE__ */ new Quaternion()
const AF_POS = /* @__PURE__ */ new Vector3()
const AF_QUAT = /* @__PURE__ */ new Quaternion()
const BALLOON_C = /* @__PURE__ */ new Vector3()

/**
 * 水面高度，m。**只用來決定「水柱畫在哪裡」**，不是回收深度。
 *
 * 【它是一個平面而海面不是】`main.ts` 注入的撞海判定走 Gerstner 波
 * （振幅合計約 ±2.15 m）。在 `resolveHits`（4,000 發 × 240 Hz）裡對每一
 * 發彈丸取一次浪高是每秒近百萬次 sin/cos，不划算。誤差最多 2.15 m ——
 * 887 m/s 下 2.4 ms —— 而**看得到的那個東西**（水柱）由渲染層擺在真實
 * 浪高上，所以畫面是對的（M7 spec §4.2）。
 */
export const SEA_SURFACE_Y = 0

/**
 * 彈丸低於這個高度就回收，m。
 *
 * 【為什麼不是 SEA_SURFACE_Y】撞海判定是 `y <= 浪高 + CRASH_CLEARANCE`，
 * 而 `CRASH_CLEARANCE = 2 m`、浪谷可到 −2.15 m —— 一架**還活著**的飛機
 * 可以低到 `y = −0.15 m`，它的命中盒更可以伸到更低。在水面就回收，理論上
 * 會吃掉那些命中（M7 spec §4.3，初稿在這裡寫錯過）。
 *
 * 【−20 m 的推導】存活 ⟹ 機體原點 > 浪谷 + `CRASH_CLEARANCE`。取一個保守
 * 的浪谷 −5 m（實際約 −2.15 m）得原點 > −3 m；加上全機種最大的包圍半徑
 * 7.1 m（P-51D 的機尾角），存活飛機的命中盒伸不到 −10.1 m 以下。−20 m
 * 有兩倍餘裕，所以**證明得出**回收它不會少算任何命中。
 *
 * 代價是彈丸多飛 20 m —— 887 m/s 下 22 ms，而且那一段整個被海面遮住。
 */
export const SEA_KILL_Y = -20

/** 彈丸的粗篩、精確命中與傷害結算；容量在場景組裝時預留。 */
export class ProjectileHits {
  private readonly hit = createHitResult()
  /** 地上飛機的結果獨立保存，避免覆寫同一發彈對空中飛機的候選命中。 */
  private readonly groundHit = createHitResult()
  private readonly cull = new CullIndex()

  ensure(capacity: number): void {
    this.cull.ensure(capacity)
  }

  /**
   * 重填粗篩索引：只收存活的飛機，依 x 排序。
   *
   * 【為什麼在 resolveHits 裡而不是 step 開頭】判定吃的是**推進後**的位置。
   * 在飛機推進之前填，粗篩用的是上一步的殘影，視窗會偏掉一整步的位移。
   */
  private buildCull(combatants: readonly Combatant[]): void {
    const cull = this.cull
    cull.clear()
    for (let i = 0; i < combatants.length; i++) {
      const c = combatants[i]!
      if (!c.alive) continue
      const p = c.aircraft.state.position
      cull.add(p.x, p.y, p.z, c.hitRadius, c.index, c.team === 'blue' ? 0 : 1)
    }
    cull.sort()
  }

  /**
   * 線段 vs 各機的命中盒，取最近的那一架。
   *
   * 【這是整個專案最熱的迴圈】滿載 4,000 發 × 40 架。粗篩換成排序掃描之前
   * 是 7,408 µs，換之後 202 µs（M5 spec §5.1）。所以這裡刻意寫得比別處囉嗦：
   *
   *   - **保留索引迴圈**，直接走訪池與粗篩陣列，不建立中介集合。
   *   - **視窗用 x 區間夾**。窗外的飛機在代數上不可能被命中（spec §5.3），
   *     所以窗內取到的最小 t 就是全場的最小 t。
   *   - **座標從 CullIndex 的並排陣列讀**，不穿 Combatant → Aircraft → state。
   *   - **s0/s1 只在通過粗篩後才寫**。粗篩擋掉絕大多數的配對，把兩個
   *     Vector3.set 留在外面等於替它們白做。
   */
  resolve(world: ProjectileHitWorld): void {
    this.buildCull(world.combatants)

    const p = world.projectiles
    const combatants = world.combatants
    const cull = this.cull
    const rMax = cull.rMax
    const s0 = S.v[0]!
    const s1 = S.v[1]!
    // 【在迴圈外取出】4,000 發的迴圈裡每一發讀一次屬性是白付的
    const land = world.land
    const ships = world.ships
    const targets = world.groundTargets
    const balloons = world.balloons

    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner === -1) continue
      const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
      const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!

      // 射手的陣營。同隊的彈丸直接穿過（spec §5.4）。
      //
      // 【為什麼讀 p.team 而不是從 owner 反查】船不是 combatant，反查不到
      // —— 同隊過濾會靜靜失效，船於是打自己人。飛機那一側 `World.fire` 與
      // `stepTurrets` 填的值與反查出來的完全相同，所以行為逐位元不變。
      const shooter = owner >= 0 && owner < combatants.length ? combatants[owner] : undefined
      const ownerTeam = p.team[i]!

      const lo = (ax < bx ? ax : bx) - rMax
      const hi = (ax > bx ? ax : bx) + rMax

      let bestT = Infinity
      let victim: Combatant | null = null
      let part: HitPart = 'fuselage'
      // 【法線要與 bestT 一起抄】this.hit 每次 hitAircraft 呼叫都被覆寫，
      // 留到迴圈外再讀就會拿到「最後一個被測到的盒」而不是「最近的那一個」
      let bestNx = 0
      let bestNy = 0
      let bestNz = 0
      const count = cull.count
      for (let j = cull.lowerBound(lo); j < count; j++) {
        const cx = cull.x[j]!
        if (cx > hi) break
        if (cull.team[j]! === ownerTeam) continue
        // 【同隊過濾已經涵蓋自傷，但這一條要留】spec §5.4：「同隊零傷害」
        // 必須是一條自己成立的規則，而不是碰巧被另一條擋掉。
        if (cull.index[j]! === owner) continue
        // 【粗篩】線段離機體重心比包圍球還遠就一定碰不到，跳過六次 slab
        // 測試與兩次四元數旋轉。
        if (segmentPointDistanceSq(
          ax, ay, az, bx, by, bz, cx, cull.y[j]!, cull.z[j]!,
        ) > cull.r2[j]!) continue

        const c = combatants[cull.index[j]!]!
        s0.set(ax, ay, az)
        s1.set(bx, by, bz)
        if (!hitAircraft(
          c.aircraft.spec.hitBoxes, c.aircraft.state.position, c.aircraft.state.orientation,
          s0, s1, this.hit,
        )) continue
        if (this.hit.t >= bestT) continue
        bestT = this.hit.t
        victim = c
        part = this.hit.part
        bestNx = this.hit.nx
        bestNy = this.hit.ny
        bestNz = this.hit.nz
      }
      // ── 船 ──────────────────────────────────────────────
      //
      // 【為什麼排在飛機之後、陸地之前】同一個物理步之內「先擦過一架飛機、
      // 再撞上艦橋」是合法的，而彈丸一步走 3.7–4.5 m。順序用線段參數 t 比。
      //
      // 【兩條排除規則缺一不可】
      //   發射的那一艘：砲口就在砲位盒的中心，而 `segmentBox` 對「起點已在
      //   盒內」回傳 t = 0 —— 每一發直射彈會在出膛那一步打中自己。
      //   同隊的船：spec §12 明令不做船對船，而姊妹艦就在 800 m 外。
      let shipHit: Ship | null = null
      let shipGun = -1
      if (ships.length > 0) {
        const fromShip = ownerShipIndex(owner)
        for (let k = 0; k < ships.length; k++) {
          const sh = ships[k]!
          // 沉了的船不再擋子彈
          if (!sh.alive) continue
          if (k === fromShip) continue
          if ((sh.team === 'blue' ? 0 : 1) === ownerTeam) continue
          if (segmentPointDistanceSq(
            ax, ay, az, bx, by, bz, sh.position.x, sh.position.y, sh.position.z,
          ) > sh.cls.radius * sh.cls.radius) continue

          // 世界 → 艦體：平移再套用艏向的逆旋轉。與 `hitAircraft` 同一招，
          // 但船只有 yaw，所以直接用四元數共軛即可。
          SHIP_INV.copy(sh.orientation).conjugate()
          const a = S.v[0]!.set(ax, ay, az).sub(sh.position).applyQuaternion(SHIP_INV)
          const b = S.v[1]!.set(bx, by, bz).sub(sh.position).applyQuaternion(SHIP_INV)

          // 【砲位優先於船體，不比 t】砲位盒可能與船體盒重疊（砲架長在甲板
          // 與上層建築上，而船體盒是粗體積）。照 t 比的話從上方來的子彈會先
          // 碰到船體那一面，砲位就打不掉了。露在外面的是砲，打到砲就算砲。
          for (let gi = 0; gi < sh.guns.length; gi++) {
            const g = sh.guns[gi]!
            // 【死掉的砲位不參與判定】打掉的砲位是一個洞，不是擋子彈的殘骸。
            if (!g.alive) continue
            const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, g.box)
            if (t === NO_HIT || t >= bestT) continue
            bestT = t
            victim = null
            shipHit = sh
            shipGun = gi
          }
          if (shipGun >= 0) continue

          for (const box of sh.cls.hull) {
            const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
            if (t === NO_HIT || t >= bestT) continue
            bestT = t
            victim = null
            shipHit = sh
            shipGun = -1
          }
        }
      }
      if (shipHit !== null) {
        // 【火花與打到飛機同一組】`hitEvents` 的消費者是 `sparks.emit`。
        // **不推 `damageEvents`** —— 那一條要一個 combatant 索引，船不是飛機。
        const hx = ax + (bx - ax) * bestT, hy = ay + (by - ay) * bestT, hz = az + (bz - az) * bestT
        pushImpact(world.hitEvents, hx, hy, hz, -(bx - ax), -(by - ay), -(bz - az))
        pushImpact(world.materialHits, hx, hy, hz, MATERIAL.ship, 0, 0)
        const dmg = p.damage[i]!
        const cal = p.caliber[i]!
        // 【不套 PART_MULTIPLIER】那是飛機的六個部位，船沒有座艙也沒有機翼。
        //
        // 【艦體吃口徑門檻，砲位不吃】機槍打不穿主力艦的裝甲帶，但甲板上的
        // 防空砲是露天的 —— 掃射軍艦的意義正是打掉那幾座砲，而不是打沉它。
        // 兩者問的是同一支函數，差別只在資料（`weapons/armour.ts`）。
        shipHit.hp -= penetrationDamage(dmg, cal, shipHit.cls.armour)
        if (shipGun >= 0) {
          const g = shipHit.guns[shipGun]!
          g.hp -= penetrationDamage(dmg, cal, SHIP_GUN_ARMOUR)
          if (g.hp <= 0) g.alive = false
        }
        // 【要夾】船砲彈的 `owner` 在負數區（見 `ships.ts` 的 `index`），
        // 不是 combatant —— 與底下地面目標那一行同一條
        // 【命中 X】打中船與打中飛機同一格（`hitsDealt`），HUD 讀它
        if (owner >= 0 && owner < combatants.length) combatants[owner]!.hitsDealt++
        sinkIfDead(
          shipHit, owner >= 0 && owner < combatants.length ? owner : -1, world.shipKillEvents,
        )
        p.kill(i)
        continue
      }

      // ── 地面目標 ────────────────────────────────────────
      //
      // 【排在船之後、陸地之前，同一個理由】盒子貼在地上，彈丸一步走 3.7～
      // 4.5 m，「先穿過戰車再入土」在同一步之內是合法命中，順序用 t 比。
      // 一台一個盒、沒有部位、沒有砲位 —— 打中就扣。同隊過濾與船相同。
      //
      // 【地上的飛機例外】`airframe` 不是 null 的照飛機算：部位盒、部位倍率、
      // 防護力（`groundAirframe.ts`、`partDamage`），與天上那一架同一條式子。
      // 包圍球半徑照停放的盒 —— 它包得住 P-51 的部位盒（8.279 < 8.284 m）
      if (targets.length > 0) {
        let hitTarget: GroundTarget | null = null
        let hitPart: HitPart | null = null
        for (let k = 0; k < targets.length; k++) {
          const t = targets[k]!
          if (!t.alive) continue
          if ((t.team === 'blue' ? 0 : 1) === ownerTeam) continue
          if (segmentPointDistanceSq(
            ax, ay, az, bx, by, bz, t.position.x, t.position.y, t.position.z,
          ) > t.radius * t.radius) continue
          if (t.airframe !== null) {
            airframePose(t, AF_POS, AF_QUAT)
            s0.set(ax, ay, az)
            s1.set(bx, by, bz)
            if (!hitAircraft(t.airframe.hitBoxes, AF_POS, AF_QUAT, s0, s1, this.groundHit)) continue
            if (this.groundHit.t >= bestT) continue
            bestT = this.groundHit.t
            victim = null
            hitTarget = t
            hitPart = this.groundHit.part
            continue
          }
          SHIP_INV.copy(t.orientation).conjugate()
          const a = S.v[0]!.set(ax, ay, az).sub(t.position).applyQuaternion(SHIP_INV)
          const b = S.v[1]!.set(bx, by, bz).sub(t.position).applyQuaternion(SHIP_INV)
          for (const box of t.unit.hull) {
            const tt = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
            if (tt === NO_HIT || tt >= bestT) continue
            bestT = tt
            victim = null
            hitTarget = t
            hitPart = null
          }
        }
        if (hitTarget !== null) {
          const hx = ax + (bx - ax) * bestT, hy = ay + (by - ay) * bestT, hz = az + (bz - az) * bestT
          pushImpact(world.hitEvents, hx, hy, hz, -(bx - ax), -(by - ay), -(bz - az))
          pushImpact(world.materialHits, hx, hy, hz, MATERIAL.ground, 0, 0)
          if (hitPart !== null) {
            hitTarget.hp -= partDamage(hitTarget.airframe!.protection, p.damage[i]!, hitPart)
          } else {
            // 口徑門檻與船同一支函數：戰車的 45 mm 讓機槍與機砲只扣底線
            hitTarget.hp -= penetrationDamage(p.damage[i]!, p.caliber[i]!, hitTarget.armour)
          }
          // 【命中 X】打中地面目標與打中飛機同一格（`hitsDealt`），HUD 讀它
          if (owner >= 0 && owner < combatants.length) combatants[owner]!.hitsDealt++
          // 兇手只記飛機；船砲的 owner 在負數區，不是 combatant
          wreckIfDead(
            hitTarget, owner >= 0 && owner < combatants.length ? owner : -1, false,
            world.groundKillEvents,
          )
          p.kill(i)
          continue
        }
      }

      // ── 防空氣球 ────────────────────────────────────────
      //
      // 【與地面目標同一個做法】一顆一個氣囊盒，打中就扣；鋼索太細，子彈不判。
      // 同隊過濾相同 —— 美軍自己的防空砲打不破自己的氣球。
      if (balloons.length > 0) {
        let hitBalloon: Balloon | null = null
        for (let k = 0; k < balloons.length; k++) {
          const bl = balloons[k]!
          if (!bl.alive) continue
          if ((bl.team === 'blue' ? 0 : 1) === ownerTeam) continue
          envelopeCenter(bl, BALLOON_C)
          if (segmentPointDistanceSq(
            ax, ay, az, bx, by, bz, BALLOON_C.x, BALLOON_C.y, BALLOON_C.z,
          ) > BALLOON_REACH * BALLOON_REACH) continue
          SHIP_INV.copy(bl.orientation).conjugate()
          const a = S.v[0]!.set(ax, ay, az).sub(bl.top).applyQuaternion(SHIP_INV)
          const b = S.v[1]!.set(bx, by, bz).sub(bl.top).applyQuaternion(SHIP_INV)
          const tt = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, BALLOON_ENVELOPE)
          if (tt === NO_HIT || tt >= bestT) continue
          bestT = tt
          victim = null
          hitBalloon = bl
        }
        if (hitBalloon !== null) {
          const hx = ax + (bx - ax) * bestT, hy = ay + (by - ay) * bestT, hz = az + (bz - az) * bestT
          pushImpact(world.hitEvents, hx, hy, hz, -(bx - ax), -(by - ay), -(bz - az))
          hitBalloon.hp -= p.damage[i]!
          popIfDead(hitBalloon, owner >= 0 && owner < combatants.length ? owner : -1, world.balloonKillEvents)
          p.kill(i)
          continue
        }
      }

      // ── 陸地 ────────────────────────────────────────────
      //
      // 【為什麼排在飛機之後而不是迴圈開頭】同一個物理步之內「先打中飛機、
      // 後進入地面」是合法命中。飛機真的會貼著坡面飛（甲板實測量到過離地
      // 6 m），而彈丸一步走 3.7~4.5 m —— 在迴圈開頭無條件 `continue` 會把
      // 那個命中吃掉。所以要算出交點參數再跟 `bestT` 比先後。
      //
      // 【火花與打到飛機同一組】`hitEvents` 的消費者是 `sparks.emit`，
      // 傷害走的是 `damageEvents` —— 所以推一筆進去就是「跟打到飛機一樣的
      // 火花」，渲染層一行都不用改。**不推 `damageEvents`**：那一條要一個
      // `victim.index`，山不是一架飛機。
      if (land !== null) {
        const landT = landHitT(ax, ay, az, bx, by, bz, land)
        if (landT < bestT) {
          const hx = ax + (bx - ax) * landT
          const hy = ay + (by - ay) * landT
          const hz = az + (bz - az) * landT
          normalAt(land.field, hx, hz, LAND_N)
          pushImpact(world.hitEvents, hx, hy, hz, LAND_N.nx, LAND_N.ny, LAND_N.nz)
          p.kill(i)
          continue
        }
      }

      if (!victim) {
        // 【水柱只在跨過水面的那一步推】寫成「y <= 水面」的話，彈丸在
        // 水面下的每一步都會再推一筆，一發變成一串。
        if (ay > SEA_SURFACE_Y && by <= SEA_SURFACE_Y) {
          const s = (ay - SEA_SURFACE_Y) / (ay - by)
          pushImpact(
            world.splashEvents,
            ax + (bx - ax) * s, SEA_SURFACE_Y, az + (bz - az) * s,
            0, 1, 0,
          )
        }
        // 【回收在更深的地方】見 SEA_KILL_Y 的推導
        if (by <= SEA_KILL_Y) p.kill(i)
        continue
      }

      // 【命中點與世界法線】命中點是線段上的 bestT；法線由機體座標轉世界
      const n = S.v[3]!
      if (bestNx !== 0 || bestNy !== 0 || bestNz !== 0) {
        n.set(bestNx, bestNy, bestNz).applyQuaternion(victim.aircraft.state.orientation)
      } else {
        // 【起點就在盒內】沒有入射面（M7 spec §3.2）。迎面噴回去 ——
        // 這是唯一一個「沒有正確答案」的情形，取一個不會出錯的方向。
        n.set(ax - bx, ay - by, az - bz)
        const len = n.length()
        if (len > 1e-6) n.divideScalar(len)
        else n.set(0, 1, 0)
      }
      pushImpact(
        world.hitEvents,
        ax + (bx - ax) * bestT, ay + (by - ay) * bestT, az + (bz - az) * bestT,
        n.x, n.y, n.z,
      )

      // 【方向取彈丸速度的反向，不是射手的位置】887 m/s 飛 500 m 要 0.56 秒
      // —— 指射手**現在**的位置，指的是一個玩家沒看到過的東西；而射手可能
      // 已經死了。「子彈從那裡來」正是玩家在畫面上看到的曳光彈方向
      // （受擊方向指示器 spec §3.2）。
      const vx = p.vx[i]!, vy = p.vy[i]!, vz = p.vz[i]!
      const vs = Math.hypot(vx, vy, vz)
      // 靜止的彈丸不存在，但除以 0 會把 NaN 一路餵進 HUD —— 擋在源頭
      if (vs > 1e-6) {
        pushDamage(world.damageEvents, victim.index, -vx / vs, -vy / vs, -vz / vs, PART_INDEX[part])
      }

      // 【命中即回收】不回收的話同一發會在後續每一步繼續扣血，而且池子
      // 會被打進機身的彈丸塞滿。
      //
      // 【飛機的裝甲是 0】口徑門檻於是恆不成立，這一條與規則出現之前逐位元
      // 相同。留著這一句是因為規則屬於**每一次子彈結算**，哪裡咬人由資料
      // 決定 —— 哪天有一台裝甲攻擊機，那是加一格資料，不是改這裡
      world.applyDamage(
        victim, penetrationDamage(p.damage[i]!, p.caliber[i]!, AIRCRAFT_ARMOUR), part, shooter,
      )
      p.kill(i)
    }
  }
}
