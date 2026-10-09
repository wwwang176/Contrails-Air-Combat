import type { Vector3 } from 'three'
import type { World } from '../world/World'
import type { Combatant } from '../world/combatant'
import { DAMAGE_STRIDE } from '../world/damage'
import { IMPACT_STRIDE, clearImpacts, type ImpactEvents } from '../world/events'
import { burstDamageTo } from '../world/flak'
import { HIT_PARTS, type HitPart } from '../world/hit'
import type { AudioEngine } from './engine'
import { CATEGORY, WATER_HIT, impactSound, type Pool } from './catalog'
import { blastGainDb, blastRate, damageGainDb, hitFeedback, hitRate } from './curves'
import { queueExplosionCues, type ExplosionTerrain } from './explosionCues'
import { LAYER_DB, randomRate } from './pick'
import { CUE, CUE_STRIDE, clearCues, createCueQueue, pushCue } from './queue'
import { buildVolleyGroups } from './volleyGroups'
import { warmJamGainDb } from '../control/gunHeat'

type CueWorld = Pick<World, 'killEvents' | 'groundKillEvents' | 'bombEvents' | 'torpedoEvents'
  | 'groundTargets' | 'burstEvents' | 'materialHits' | 'damageEvents' | 'time'>

/** 固定容量的戰鬥單次音效：物理子步收集，鏡頭更新後集中播放。 */
/**
 * @param gun 玩家的控制器：快過熱（黃色）時每一發齊射配一聲槍機聲（`control/gunHeat.ts`）。省略 = 不配
 */
export function createBattleAudioCues(
  audio: Pick<AudioEngine, 'playPool'>, cam: Vector3, crashBlastHeight: number,
  gun: { readonly warmFiring: boolean; readonly gunHeat: { readonly heat: number } } | null = null,
) {
  const state = {
    /** 後座砲塔走自機齊射時，座艙視角須排除同一架的定位砲塔循環。 */
    ownTurretVolley: false,
    rebuildVolleyGroups, queueAudioCues, noteWaterHits, playFrame, playHeavyHit, queueExplosion, clear, reset,
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

  /** 打到水面最密多久一次，s。與撞擊同一個值（試聽的「掃射」就是這個間隔） */
  const WATER_HIT_GAP = 0.07

  /** 上一次播打到水面的 `elapsed` */
  let lastWaterHit = -Infinity

  /** 這一幀聽得到的範圍內離鏡頭最近的那一發打到水面；`waterDist2` 是 Infinity 時沒有 */
  let waterDist2 = Infinity
  let waterX = 0
  let waterY = 0
  let waterZ = 0

  /**
   * 自己那架的槍分組：前射武器同一種槍算一組，每組記一個代表掛架與它的齊射庫；有齊射庫的
   * 後座砲塔（Ju 87 的 MG 15）各自一組，與前機槍走同一個機制。`mount` 或 `turret` 其中一個是 −1。
   *
   * 【為什麼同一種槍只記一個掛架】`stepCadence` 讓同型槍共用一份射速時鐘，
   * 六挺是一起擊發的；素材也是照這樣疊出來的，一組播一次就好。
   */
  const volleyGroups: { mount: number; turret: number; pool: Pool; db: number; jam: Pool | null }[] = []

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

  /** 一幀最多記幾架被打中的飛機；同一架只佔一格，超過的不記 */
  const DEALT_CAPACITY = 64

  /**
   * 這一幀被打中的飛機（自己以外）與它最後被打中的部位，同一架只記一次。子步裡寫、
   * `playFrame` 挑離鏡頭最近的那一架播完歸零
   */
  const dealtVictims = new Int32Array(DEALT_CAPACITY)
  const dealtParts = new Int32Array(DEALT_CAPACITY)
  let dealtCount = 0

  /** 自己這架的前射武器依武器種類分組 */
  function rebuildVolleyGroups(player: Combatant): void {
    const built = buildVolleyGroups(player, prevVolleyFlash.length, TURRET_VOLLEY_DB)
    volleyGroups.length = 0
    volleyGroups.push(...built.groups)
    prevVolleyFlash.fill(0)
    state.ownTurretVolley = built.ownTurretVolley
  }

  /**
   * 打中敵機的回饋。**不定位、但依那架有多遠給一點衰減與變悶**（見 `hitFeedback`）：
   * 打遠的聽起來悶而小聲，打近的清脆，兩者都還聽得見。
   *
   * 距離、機型與部位取這一幀被打中、離鏡頭最近的那一架。【不取最後一筆】同一幀僚機在遠處打中的話，
   * 自己近距離打中的那一聲會用遠處的悶聲播
   */
  function playHitDealt(world: Pick<World, 'combatants'>, elapsed: number): void {
    if (elapsed - lastHitDealt < HIT_DEALT_GAP) return
    let best: Combatant | undefined
    let bestPart = 0
    let bestD2 = Infinity
    for (let k = 0; k < dealtCount; k++) {
      const victim = world.combatants[dealtVictims[k]!]
      if (victim === undefined) continue
      const d2 = victim.aircraft.state.position.distanceToSquared(cam)
      if (d2 >= bestD2) continue
      best = victim
      bestPart = dealtParts[k]!
      bestD2 = d2
    }
    if (best === undefined) return
    lastHitDealt = elapsed
    hitFeedback(best.aircraft.state.position.distanceTo(cam), HIT_FB)
    // 【與自己被打中同一條曲線】只是換成看對方那架：大台的、護甲厚的部位比較低沉
    const spec = best.aircraft.spec
    const rate = hitRate(spec.mass, spec.protection[partOf(bestPart)])
    audio.playPool('hit', 'hitDealt', 0, 0, 0, false, HIT_FB.gainDb, false, rate, HIT_FB.cutoffHz)
  }

  /**
   * 子彈、砲彈打到水面（海面、河面都算，事件的位置在水面上）：記下聽得到的範圍內離鏡頭最近的那一發，
   * `playFrame` 播。一幀內可以呼叫好幾次（每個物理子步、地面戰的砲彈落地）。熱路徑：不配置
   *
   * 【候選播完才清】地面戰的砲彈落地在 `playFrame` 之後才寫進來，留到下一幀播
   */
  function noteWaterHits(events: ImpactEvents): void {
    const max2 = CATEGORY.waterHit.max * CATEGORY.waterHit.max
    for (let e = 0; e < events.count; e++) {
      const o = e * IMPACT_STRIDE
      const x = events.data[o]!, y = events.data[o + 1]!, z = events.data[o + 2]!
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > max2 || d2 >= waterDist2) continue
      waterDist2 = d2
      waterX = x
      waterY = y
      waterZ = z
    }
  }

  /**
   * 播 `noteWaterHits` 記下的那一發：碎屑過低通，疊上落水聲，**兩層同一個音高**（類別的
   * `pitchJitter` 是 0，音高在這裡給）。【被時段擋下的不留】留到下一幀會把過時的位置播出來
   */
  function playWaterHit(elapsed: number): void {
    if (waterDist2 === Infinity) return
    waterDist2 = Infinity
    if (elapsed - lastWaterHit < WATER_HIT_GAP) return
    lastWaterHit = elapsed
    const rate = randomRate(Math.random)
    audio.playPool('debris', 'waterHit', waterX, waterY, waterZ, true, WATER_HIT.debrisDb, false, rate,
      WATER_HIT.debrisCutoffHz)
    audio.playPool('waterHit', 'waterHit', waterX, waterY, waterZ, true, WATER_HIT.splashDb, false, rate)
  }

  /** 記下這一幀有一架被打中：已經記過就只更新部位。熱路徑：不配置 */
  function noteDealt(victim: number, part: number): void {
    for (let k = 0; k < dealtCount; k++) {
      if (dealtVictims[k] !== victim) continue
      dealtParts[k] = part
      return
    }
    if (dealtCount >= DEALT_CAPACITY) return
    dealtVictims[dealtCount] = victim
    dealtParts[dealtCount] = part
    dealtCount++
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
      // 自己吃掉），這裡用同一支 `burstDamageTo` 算：同隊的砲不扣血也不出聲，
      // 聲音的輕重跟實際傷害一致
      //
      // 【上帝視角不記】身上的聲音是不定位的，那時鏡頭在世界裡、離自機很遠，
      // 貼在鏡頭上播等於「在耳邊」，與畫面對不上
      if (!player.alive || godView) continue
      // 【輕重看炸得多近，不看血量】同一發打在 B-17 與 P-51 身上，玩家聽到的該是
      // 同一聲；除以血量的話，血厚的機種永遠只聽到擦邊
      const dmg = burstDamageTo(f, i, player.team === 'blue' ? 0 : 1, me.x, me.y, me.z)
      if (dmg > 0) pushCue(cues, CUE.Damage, dmg / f.damage[i]!, 0, 0)
    }
    // 子彈打在船殼、建築上。【要限頻率】對船掃射時六挺每秒命中幾十發，
    // 不限的話光這一項就把事件佇列灌滿，爆炸與擊落會被擠掉。一個時段播一聲：這一子步裡挑
    // 聽得到的範圍內最近的那一發。【先濾距離再佔時段】聽不到的遠處命中佔掉時段的話，旁邊那一發就被擋掉
    const mh = world.materialHits
    if (world.time - lastMaterialHit >= MATERIAL_HIT_GAP) {
      let best = -1
      let bestD2 = CATEGORY.impact.max * CATEGORY.impact.max
      for (let e = 0; e < mh.count; e++) {
        const o = e * IMPACT_STRIDE
        const dx = mh.data[o]! - cam.x, dy = mh.data[o + 1]! - cam.y, dz = mh.data[o + 2]! - cam.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > bestD2) continue
        best = o
        bestD2 = d2
      }
      if (best >= 0) {
        lastMaterialHit = world.time
        pushCue(cues, CUE.MaterialHit, mh.data[best]!, mh.data[best + 1]!, mh.data[best + 2]!, mh.data[best + 3]!)
      }
    }
    clearImpacts(mh)
    const dmg = world.damageEvents
    for (let i = 0; i < dmg.count && !godView; i++) {
      const o = i * DAMAGE_STRIDE
      // 【誰打中誰都算】不分射手 —— 僚機打中的也聽得到。太遠的由距離衰減擋掉，
      // 而距離要量**真正被打中的那一架**，所以這裡記下是誰
      if (dmg.data[o]! !== player.index) {
        noteDealt(dmg.data[o]!, dmg.data[o + 4]!)
        continue
      }
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
          // 【快過熱：每一發配一聲槍機聲】與槍聲同步，越熱越大聲，過熱那一刻接上空響（`flightAudio`）
          if (g.jam !== null && gun !== null && gun.warmFiring) {
            audio.playPool(g.jam, 'reload', 0, 0, 0, false, warmJamGainDb(gun.gunHeat.heat))
          }
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
    playWaterHit(elapsed)
    // 【誰打中誰都播】僚機打中的也算。太遠的由距離衰減擋掉
    if (dealtCount > 0 && flying) playHitDealt(world, elapsed)
    dealtCount = 0
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
    dealtCount = 0
    lastWaterHit = -Infinity
    waterDist2 = Infinity
  }

  return state as Readonly<typeof state>
}
