import { IMPACT_STRIDE } from '../world/events'
import { emitBlast, WRECK_WATER_BLAST, type BlastPools } from './blast'
import { emitSmoke, DEBRIS_SMOKE_SIZE } from './smoke'
import { emitSpray, DEBRIS_SPRAY_COUNT, WRECK_SPRAY_COUNT } from './spray'
import type { Particles } from './particles'
import type { createWrecks } from './wrecks'
import type { createDebris } from './debris'
import type { createFirePuff } from './firePuff'
import type { createSplashes } from './splash'
import type { createTerrain } from './terrain'

type EffectTerrain = Pick<ReturnType<typeof createTerrain>, 'heightAt' | 'waterAt'>
type StepEffect = Pick<Particles, 'step'>

export interface EffectStepPools {
  readonly sparks: StepEffect
  readonly blastSparks: StepEffect
  readonly wrecks: Pick<ReturnType<typeof createWrecks>, 'step' | 'fireEvents' | 'sprayEvents' | 'splashEvents' | 'anchors'>
  readonly debris: Pick<ReturnType<typeof createDebris>, 'step' | 'smokeEvents' | 'sprayEvents'>
  readonly emitWreckFirePuff: ReturnType<typeof createFirePuff>
  readonly smoke: Pick<Particles, 'emit' | 'step'>
  readonly spray: Pick<Particles, 'emit'>
  readonly BLAST_POOLS: BlastPools
  readonly splashes: Pick<ReturnType<typeof createSplashes>, 'step' | 'emit'>
  readonly fireball: StepEffect
  readonly steam: StepEffect
  readonly shipFireSmoke: StepEffect
  readonly wreckFireSmoke: StepEffect
  readonly blastJets: StepEffect
  readonly blastChunks: StepEffect
  readonly blastGlow: StepEffect
  readonly blastEmber: StepEffect
  readonly blastSmoke: StepEffect
  readonly blastDust: StepEffect
  readonly blastMist: StepEffect
  readonly flakBursts: StepEffect
  readonly blastLights: StepEffect
}

/** 管理共用特效的步進與事件傳遞順序。池與回呼只綁定一次，不持有戰局或地形。 */
export function createEffectStepper({
  sparks, blastSparks, wrecks, debris, emitWreckFirePuff, smoke, spray, BLAST_POOLS,
  splashes, fireball, steam, shipFireSmoke, wreckFireSmoke, blastJets,
  blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, blastMist, flakBursts, blastLights,
}: EffectStepPools) {
  /**
   * 殘骸、零件與爆炸那一組池子的一幀。**戰鬥與選單的短片共用。**
   *
   * 【裡面不得讀 `world`】選單第一次出現時 `world` 還沒建（`startWorld` 才賦值）。
   * 種子時間由呼叫端給：戰鬥是 `world.time`、選單是 `elapsed`。
   */
  return function stepEffects(
    worldSeconds: number, seedTime: number, terrain: EffectTerrain, elapsed: number,
  ): void {
    // 【火花與水柱在幀率積分】純裝飾，不參與判定也不需要決定性
    sparks.step(worldSeconds)
    // 【爆炸的火星走 `elapsed`】位置在著色器裡由出生到現在的時間算出來 ——
    // 暫停時它不走，慢動作時它一起慢
    blastSparks.step(elapsed)
    // 【殘骸與零件先步進，再把它們吐出來的事件餵給煙、噴濺與水柱】兩者的
    // 事件緩衝在各自的 step 開頭排空，所以這裡讀到的恆是這一幀的
    // 【落地與落水用兩支不同的函式】`heightAt` 決定「碰到地面了沒」，
    // `waterAt` 決定「那是水嗎」。共用一支的話摔在島上會噴水柱
    wrecks.step(worldSeconds, terrain.heightAt, terrain.waterAt, elapsed)
    debris.step(worldSeconds, terrain.heightAt, terrain.waterAt, elapsed)
    // 【殘骸的引擎在燒】走船火那一份配方，小一號。位置由 `wrecks` 每一步從
    // 機體座標轉成世界座標，法線那三格帶的是殘骸的速度 —— 火團要繼承它
    {
      const d = wrecks.fireEvents.data
      for (let e = 0; e < wrecks.fireEvents.count; e++) {
        const o = e * IMPACT_STRIDE
        emitWreckFirePuff(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!)
      }
    }
    emitSmoke(smoke, debris.smokeEvents, DEBRIS_SMOKE_SIZE)
    emitSpray(spray, wrecks.sprayEvents, WRECK_SPRAY_COUNT)
    // 【殘骸落水掀一個水冠】粗水柱塌下留水霧、柱腳噴水花 —— 與魚雷、炸彈落水同一套池
    {
      const d = wrecks.sprayEvents.data
      for (let e = 0; e < wrecks.sprayEvents.count; e++) {
        const o = e * IMPACT_STRIDE
        emitBlast(BLAST_POOLS, WRECK_WATER_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
          (e * 173 + Math.round(seedTime * 60)) | 0)
      }
    }
    emitSpray(spray, debris.sprayEvents, DEBRIS_SPRAY_COUNT)
    // 殘骸入水的那一圈水柱沿用 M7 的池子 —— 用數量換規模，splash.ts 不用改
    splashes.emit(wrecks.splashEvents, terrain.heightAt, elapsed)
    // 零件入水各濺一根小水柱。與噴濺讀同一份事件：同一次入水的兩個表現，
    // 位置相同。高低粗細由 splashSize 依格子隨機
    splashes.emit(debris.sprayEvents, terrain.heightAt, elapsed)
    splashes.step(worldSeconds)
    fireball.step(worldSeconds)
    smoke.step(worldSeconds)
    steam.step(worldSeconds)
    shipFireSmoke.step(worldSeconds)
    wreckFireSmoke.step(worldSeconds)
    // 【爆炸那一組】水冠要在水霧之前 —— 它的 `onFade` 會往水霧池發射，
    // 同一幀生的那幾團才不會被水霧自己的 `step` 漏掉一幀
    blastJets.step(worldSeconds)
    // 【這兩個要拿到殘骸的錨點】引擎火吸附在殘骸上，世界座標由池子每一幀
    // 自己組。不給的話那些火當場收掉 —— 畫面上是「飛機不燒了」
    blastChunks.step(worldSeconds, wrecks.anchors)
    blastGlow.step(worldSeconds, wrecks.anchors)
    blastEmber.step(worldSeconds)
    blastSmoke.step(worldSeconds)
    blastDust.step(worldSeconds)
    blastMist.step(worldSeconds)
    flakBursts.step(worldSeconds)
    // 【畫面時間】閃光是純表現，與火花、火球同一條
    blastLights.step(worldSeconds)
  }
}
