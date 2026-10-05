import type { Vector3 } from 'three'
import type { World, Combatant } from '../world/World'
import { DAMAGE_STRIDE } from '../world/damage'
import { IMPACT_STRIDE, clearImpacts } from '../world/events'
import { flakDamage } from '../world/flak'
import { HIT_PARTS, type HitPart } from '../world/hit'
import type { AudioEngine } from './engine'
import { impactSound, ownTurretVolleyPools, volleyPool, type Pool } from './catalog'
import { blastGainDb, blastRate, damageGainDb, hitFeedback, hitRate } from './curves'
import { queueExplosionCues, type ExplosionTerrain } from './explosionCues'
import { LAYER_DB } from './pick'
import { CUE, CUE_STRIDE, clearCues, createCueQueue, pushCue } from './queue'

type CueWorld = Pick<World, 'killEvents' | 'groundKillEvents' | 'bombEvents' | 'torpedoEvents'
  | 'groundTargets' | 'burstEvents' | 'materialHits' | 'damageEvents' | 'time'>

/** 固定容量的戰鬥單次音效：物理子步收集，鏡頭更新後集中播放。 */
export function createBattleAudioCues(audio: Pick<AudioEngine, 'playPool'>, cam: Vector3, crashBlastHeight: number) {
  const state = {
    /** 後座砲塔走自機齊射時，座艙視角須排除同一架的定位砲塔循環。 */
    ownTurretVolley: false,
    rebuildVolleyGroups, queueAudioCues, playFrame, playHeavyHit, queueExplosion, clear, reset,
  }

  /** 一幀最多 8 步、每步幾類事件 —— 512 筆夠寬，滿了丟新的 */
  const cues = createCueQueue(512)

  /** 自己被子彈打中時，另外播一下機身受創的機率 */
  const HIT_DAMAGE_CHANCE = 0.35

  /**
   * 機槍打在自己機身上的額外增益，dB。**只作用在這一條** —— 受創的悶響、
   * 以及疊在它上面的那一層金屬聲不吃這個值，五吋砲空爆造成的受創聲維持原樣。
   */
  const BULLET_HIT_DB = -1.4

  /** 子彈打中自己時，機身受創的輕重（0–1）。子彈沒有逐發的傷害事件，取一個中間偏輕的值 */
  const BULLET_SEVERITY = 0.35

  /** 空爆超過這個距離不記，m */
  const FLAK_AUDIO_RANGE = 5000

  /** 爆炸離鏡頭這麼近時另外播一陣機身晃動，m */
  const NEAR_BLAST = 200

  /**
   * 打中敵機的回饋至少隔這麼久才再響一次，s。
   *
   * 【為什麼要限】掃到敵機時幾乎每一幀都有命中，而命中聲平均 0.65 s —— 不限的話
   * 60 fps 疊將近 40 層，比單獨一次大 16 dB，還會把 24 個單次聲道佔滿。
   */
  const HIT_DEALT_GAP = 0.1

  /** 子彈打在船殼、建築上最密多久一次，s */
  const MATERIAL_HIT_GAP = 0.07

  /**
   * 自己那架的槍分組：前射武器同一種槍算一組，每組記一個代表掛架與它的齊射庫；有齊射庫的
   * 後座砲塔（Ju 87 的 MG 15）各自一組，與前機槍走同一個機制。`mount` 或 `turret` 其中一個是 −1。
   *
   * 【為什麼同一種槍只記一個掛架】`stepCadence` 讓同型槍共用一份射速時鐘，
   * 六挺是一起擊發的；素材也是照這樣疊出來的，一組播一次就好。
   */
  const volleyGroups: { mount: number; turret: number; pool: Pool; db: number }[] = []

  /** 分組代表掛架（或砲塔）上一個子步的槍焰 —— 由 0 變正就是剛擊發 */
  const prevVolleyFlash = new Float32Array(8)

  /**
   * 後座機槍比前機槍小的分貝：一挺 MG 15 比兩挺 MG 17 單薄。**起始值，由試玩裁定。**
   */
  const TURRET_VOLLEY_DB = -0.5

  const HIT_FB = { gainDb: 0, cutoffHz: 0 }

  let lastHitDealt = -Infinity

  /** 上一次播子彈打在船殼、建築上的世界時間 */
  let lastMaterialHit = -Infinity

  /** 最後一次有飛機被打中，是誰的哪個部位。−1 = 這一場還沒有過 */
  let lastDealtVictim = -1

  let lastDealtPart = 0

  /** 這一幀有飛機被打中（自己以外）。子步裡寫、`updateAudio` 讀完歸零 */
  let hitDealtPending = false

  /** 自己這架的前射武器依武器種類分組 */
  function rebuildVolleyGroups(player: Combatant): void {
    volleyGroups.length = 0
    prevVolleyFlash.fill(0)
    const mounts = player.aircraft.spec.battery.mounts
    const seen = new Map<string, number>()
    for (let i = 0; i < mounts.length; i++) {
      const id = mounts[i]!.weapon.id
      if (seen.has(id)) continue
      seen.set(id, i)
      let guns = 0
      for (const m of mounts) if (m.weapon.id === id) guns++
      const pool = volleyPool(id, guns)
      if (pool !== null && volleyGroups.length < prevVolleyFlash.length) {
        volleyGroups.push({ mount: i, turret: -1, pool, db: 0 })
      }
    }
    // 後座砲塔：每一座都有齊射庫的機種（Ju 87）各自一組，其餘維持砲塔循環
    const rear = ownTurretVolleyPools(player.aircraft.spec.turrets)
    state.ownTurretVolley = rear !== null
    if (rear === null) return
    for (let i = 0; i < rear.length && volleyGroups.length < prevVolleyFlash.length; i++) {
      volleyGroups.push({ mount: -1, turret: i, pool: rear[i]!, db: TURRET_VOLLEY_DB })
    }
  }

  /**
   * 打中敵機的回饋。**不定位、但依那架有多遠給一點衰減與變悶**（見 `hitFeedback`）：
   * 打遠的聽起來悶而小聲，打近的清脆，兩者都還聽得見。
   *
   * 距離與部位取最後一筆命中事件的受擊飛機。
   */
  function playHitDealt(world: Pick<World, 'combatants'>, elapsed: number): void {
    if (elapsed - lastHitDealt < HIT_DEALT_GAP) return
    const victim = world.combatants[lastDealtVictim]
    if (victim === undefined) return
    lastHitDealt = elapsed
    hitFeedback(victim.aircraft.state.position.distanceTo(cam), HIT_FB)
    // 【與自己被打中同一條曲線】只是換成看對方那架：大台的、護甲厚的部位比較低沉
    const spec = victim.aircraft.spec
    const rate = hitRate(spec.mass, spec.protection[partOf(lastDealtPart)])
    audio.playPool('hit', 'hitDealt', 0, 0, 0, false, HIT_FB.gainDb, false, rate, HIT_FB.cutoffHz)
  }

  /** 物理子步裡呼叫，排在所有事件清除之前。只寫佇列 */
  function queueAudioCues(world: CueWorld, player: Combatant, terrain: ExplosionTerrain, godView: boolean): void {
    // 自己開火：每一組同型槍（或後座砲塔）擊發一次記一筆。上帝視角時自己那架改走定位的循環
    const flash = player.muzzleFlash
    for (let i = 0; i < volleyGroups.length; i++) {
      const g = volleyGroups[i]!
      const now = g.turret >= 0 ? player.turretStates[g.turret]?.flash ?? 0 : flash[g.mount] ?? 0
      const was = prevVolleyFlash[i]!
      prevVolleyFlash[i] = now
      if (now > 0 && was <= 0 && player.alive && !godView) pushCue(cues, CUE.SelfVolley, i, 0, 0)
    }
    queueExplosionCues(cues, world, terrain, crashBlastHeight)
    const f = world.burstEvents
    const me = player.aircraft.state.position
    for (let i = 0; i < f.count; i++) {
      const dx = f.x[i]! - cam.x, dy = f.y[i]! - cam.y, dz = f.z[i]! - cam.z
      if (dx * dx + dy * dy + dz * dz < FLAK_AUDIO_RANGE * FLAK_AUDIO_RANGE) {
        pushCue(cues, CUE.FlakBurst, f.x[i]!, f.y[i]!, f.z[i]!)
      }
      // 【炸在自己身上就是受創】爆風的傷害不走子彈那條事件（`World.applyBursts`
      // 自己吃掉），這裡用同一支 `flakDamage` 算，聲音的輕重才跟實際傷害一致
      //
      // 【上帝視角不記】身上的聲音是不定位的，那時鏡頭在世界裡、離自機很遠，
      // 貼在鏡頭上播等於「在耳邊」，與畫面對不上
      if (!player.alive || godView) continue
      const ex = f.x[i]! - me.x, ey = f.y[i]! - me.y, ez = f.z[i]! - me.z
      // 【輕重看炸得多近，不看血量】同一發打在 B-17 與 P-51 身上，玩家聽到的該是
      // 同一聲；除以血量的話，血厚的機種永遠只聽到擦邊
      const dmg = flakDamage(Math.sqrt(ex * ex + ey * ey + ez * ez), f.radius[i]!, f.damage[i]!)
      if (dmg > 0) pushCue(cues, CUE.Damage, dmg / f.damage[i]!, 0, 0)
    }
    // 子彈打在船殼、建築上。【要限頻率】對船掃射時六挺每秒命中幾十發，
    // 不限的話光這一項就把事件佇列灌滿，爆炸與擊落會被擠掉
    const mh = world.materialHits
    for (let e = 0; e < mh.count; e++) {
      if (world.time - lastMaterialHit < MATERIAL_HIT_GAP) break
      lastMaterialHit = world.time
      const o = e * IMPACT_STRIDE
      pushCue(cues, CUE.MaterialHit, mh.data[o]!, mh.data[o + 1]!, mh.data[o + 2]!, mh.data[o + 3]!)
    }
    clearImpacts(mh)
    const dmg = world.damageEvents
    for (let i = 0; i < dmg.count && !godView; i++) {
      const o = i * DAMAGE_STRIDE
      // 【誰打中誰都算】不分射手 —— 僚機打中的也聽得到。太遠的由距離衰減擋掉，
      // 而距離要量**真正被打中的那一架**，所以這裡記下是誰
      if (dmg.data[o]! !== player.index) {
        lastDealtVictim = dmg.data[o]!
        lastDealtPart = dmg.data[o + 4]!
        hitDealtPending = true
      }
      if (dmg.data[o]! !== player.index) continue
      // 【x 帶的是被打中的部位序號】不是座標；護甲厚的部位聽起來比較低沉
      pushCue(cues, CUE.HitSelf, dmg.data[o + 4]!, 0, 0)
      if (Math.random() < HIT_DAMAGE_CHANCE) pushCue(cues, CUE.Damage, BULLET_SEVERITY, 0, 0)
    }
  }

  function playCues(player: Combatant): void {
    for (let i = 0; i < cues.count; i++) {
      const o = i * CUE_STRIDE
      const x = cues.data[o + 1]!, y = cues.data[o + 2]!, z = cues.data[o + 3]!
      // 【當量決定大小聲與低沉／脆】零戰的 60 kg 彈是 0.11、陸攻的魚雷是 1.67
      const scale = cues.data[o + 4]!
      const db = blastGainDb(scale)
      const rate = blastRate(scale)
      switch (cues.data[o]!) {
        // 【疊兩層】爆炸、水花、自己被打一次挑兩個不同的疊（見 `playPool` 的 layered）
        case CUE.Explosion:
        case CUE.Blast:
          // 【同一個庫、不同的類別】差別只在傳多遠，見 `CATEGORY.blast`
          audio.playPool('explosion', cues.data[o]! === CUE.Blast ? 'blast' : 'explosion',
            x, y, z, true, db, true, rate)
          if (Math.hypot(x - cam.x, y - cam.y, z - cam.z) < NEAR_BLAST) {
            audio.playPool('rattle', 'rattle', 0, 0, 0, false, -6)
          }
          break
        case CUE.Splash: audio.playPool('splash', 'splash', x, y, z, true, db, true, rate); break
        case CUE.SplashBoom: audio.playPool('explosion', 'blast', x, y, z, true, db - 12, false, rate); break
        case CUE.FlakBurst: audio.playPool('flakBurst', 'flakBurst', x, y, z, true, 0, true); break
        // 【x 帶的是被打中的部位序號】不是座標
        case CUE.HitSelf: audio.playPool('hit', 'hitSelf', 0, 0, 0, false, BULLET_HIT_DB, true, selfHitRate(player, x)); break
        // 【第五格帶的是材質】查不到的材質走預設，不會沒聲音
        case CUE.MaterialHit: {
          const m = impactSound(scale)
          audio.playPool(m.pool, 'impact', x, y, z, true, m.gainDb, false, m.rate, m.cutoffHz)
          break
        }
        // 【受創的 x 帶的是輕重】0 = 擦到一點、1 = 重擊，見 `damageGainDb`
        case CUE.Damage: playHeavyHit(x); break
        // 【自己開火的 x 帶的是分組序號】不是座標
        case CUE.SelfVolley: {
          const g = volleyGroups[x]!
          audio.playPool(g.pool, 'fireSelf', 0, 0, 0, false, g.db)
          break
        }
      }
    }
  }

  /**
   * 自己被打中的播放速度：**越大台、被打中的部位護甲越厚就越低沉**。
   * 部位序號是 `HIT_PARTS` 的索引，由受擊事件帶過來。
   */
  function selfHitRate(player: Combatant, partIndex: number): number {
    const spec = player.aircraft.spec
    return hitRate(spec.mass, spec.protection[partOf(partIndex)])
  }

  /** 部位序號 → 部位。認不得的當機身 —— 音效不該因為一個序號就整個不播 */
  function partOf(partIndex: number): HitPart {
    return HIT_PARTS[partIndex] ?? 'fuselage'
  }

  /** 自己受創：一下結構的悶響，疊一下小一截的金屬命中。音量跟著輕重走 */
  function playHeavyHit(severity: number): void {
    const db = damageGainDb(severity)
    audio.playPool('damage', 'damage', 0, 0, 0, false, db)
    audio.playPool('hit', 'hitSelf', 0, 0, 0, false, db + LAYER_DB)
  }

  function playFrame(world: Pick<World, 'combatants'>, player: Combatant, elapsed: number, flying: boolean): void {
    playCues(player)
    clearCues(cues)
    // 【誰打中誰都播】僚機打中的也算。太遠的由距離衰減擋掉
    if (hitDealtPending && flying) playHitDealt(world, elapsed)
    hitDealtPending = false
  }

  /** 地面佈景的落地回呼在物理子步外發生，仍走同一份佇列。 */
  function queueExplosion(x: number, y: number, z: number, scale: number): void {
    pushCue(cues, CUE.Explosion, x, y, z, scale)
  }

  function clear(): void { clearCues(cues) }

  /** 重設命中限頻；佇列清除與自機武裝重建由各自的生命週期入口負責。 */
  function reset(): void {
    lastHitDealt = -Infinity
    lastMaterialHit = -Infinity
    lastDealtVictim = -1
  }

  return state as Readonly<typeof state>
}
