import { Vector3 } from 'three'
import { hash01 } from '../core/hash'
import {
  GROUND_KILL_SHAKE, GUN_LOST_SHAKE, KILL_SHAKE, addShake, ordnanceShakeScale, type createCameraShake,
} from '../camera/cameraShake'
import { blastScaleOf } from '../weapons/bomb'
import { IMPACT_STRIDE, clearImpacts, type ImpactEvents } from '../world/events'
import { KILL_STRIDE, type KillEvents } from '../world/kills'
import type { BurstEvents } from '../world/flak'
import type { GroundTarget } from '../world/groundTargets'
import {
  AIR_BLAST, BOMB_BLAST_SIZE, LAND_BLAST, TORPEDO_BLAST, WATER_BLAST,
  blastFireRadius, emitBlast, scaleBlast, type BlastParams, type BlastPools,
} from './blast'
import { MORTAR_BLAST } from './mortarBlast'
import { BLAST_DEBRIS_COLOR, type createDebris } from './debris'
import { lightGroundFire, type createGroundFires } from './groundFires'
import type { createBlastLights } from './blastLights'
import type { createBlastSparks } from './blastSparks'
import type { createTerrain } from './terrain'
import { FIREBALL_COUNT, FIREBALL_SPEED } from './fireball'
import type { Particles } from './particles'

type BlastTerrain = Pick<ReturnType<typeof createTerrain>, 'collisionHeightAt' | 'waterAt'>

export interface BlastPresentationPools {
  readonly BLAST_POOLS: BlastPools
  readonly cameraPosition: Vector3
  readonly cameraShake: ReturnType<typeof createCameraShake>
  readonly blastLights: Pick<ReturnType<typeof createBlastLights>, 'flash'>
  readonly blastSparks: Pick<ReturnType<typeof createBlastSparks>, 'burst'>
  readonly debris: Pick<ReturnType<typeof createDebris>, 'burst'>
  readonly groundFires: ReturnType<typeof createGroundFires>
  /** 艦砲殉爆使用的火球池；與 BLAST_POOLS.fireball 的碎塊池分開。 */
  readonly fireball: Pick<Particles, 'emit'>
}

/**
 * 離地多近算「墜地」，m。
 *
 * 【它分的是兩套表現】貼著地面炸的要揚塵，空中炸的不要 —— 一架 12 m 長的
 * 飛機撞地時機身中心大約就在這個高度。
 */
export const CRASH_BLAST_HEIGHT = 25

/**
 * 空中擊墜的爆炸繼承多少母機速度。
 *
 * 【與 `FIREBALL_INHERIT` 同一個值、同一個理由】火球完全靜止的話，一架
 * 150 m/s 的飛機在半秒的壽命內會飛出 75 m —— 畫面上是「爆炸發生在飛機
 * 後面」。真實的火球會先隨殘骸往前衝，再被空氣煞住。
 */
export const KILL_BLAST_INHERIT = 0.5

/**
 * 碎片散射速度的基準火球半徑：未放大的 `LAND_BLAST`（基準彈、尺度 1）。
 * 火球比它大幾倍，碎片的初速就是 `DEBRIS_SPEED` 的幾倍。
 */
const DEBRIS_REF_FIRE_RADIUS = blastFireRadius(LAND_BLAST)

/** 短片的炸彈相對基準彈的尺度（`blastScaleOf` 的那個尺度）。一串十幾枚，太大會糊成一片 */
const REEL_BOMB_SCALE = 0.8

/** 導演指定的大爆炸，閃光最多放大到一枚炸彈的幾倍 */
const REEL_FLASH_MAX = 1.5

/** 大爆炸裡每一團相對一枚炸彈的線性倍率、最多幾團、`size` 每多 1 往外撒幾公尺 */
const REEL_BLAST_LUMP = 1.2

const REEL_BLAST_LUMPS = 24

const REEL_BLAST_SPREAD = 9

/** 魚雷入水的水花：水面爆炸配方的當量倍率 —— 只是一個小水柱，不是爆炸 */
const REEL_TORPEDO_SPLASH = 0.004

/** 戰鬥與選單共用爆炸呈現。建立一次；配方暫存與種子跨換場保留。
 * 地形、時間與事件由呼叫端傳入，不持有戰局，也不在事件迴圈配置物件。 */
export function createBlastPresentation({
  BLAST_POOLS, cameraPosition, cameraShake, blastLights, blastSparks, debris, groundFires, fireball,
}: BlastPresentationPools) {
  const GUN_LOST_DIR = new Vector3()

  /** 傳給艦船模型的固定回呼；每次砲位陣亡只觸發一次，不在幀迴圈建立。 */
  function emitGunLostBlast(x: number, y: number, z: number): void {
    addShake(cameraShake, x, y, z, GUN_LOST_SHAKE, cameraPosition)
    blastLights.flash(x, y, z, GUN_LOST_SHAKE, cameraPosition)
    for (let k = 0; k < FIREBALL_COUNT; k++) {
      GUN_LOST_DIR.set(
        Math.cos(k * 2.39963) * 0.7, Math.abs(Math.sin(k * 1.7)) * 0.9, Math.sin(k * 2.39963) * 0.7,
      ).normalize()
      fireball.emit(
        x, y, z,
        GUN_LOST_DIR.x * FIREBALL_SPEED * 0.5,
        GUN_LOST_DIR.y * FIREBALL_SPEED * 0.5,
        GUN_LOST_DIR.z * FIREBALL_SPEED * 0.5,
      )
    }
  }

  /** 依當量縮放後的配方。建立呈現器時配置一次，每次爆炸重用。 */
  const SCALED_BLAST: { -readonly [K in keyof BlastParams]: number } = { ...LAND_BLAST }

  /**
   * 小爆炸：迫擊砲彈落地、戰車與反坦克砲的砲彈擊中時放。炸彈那一份火球與粒子縮小，配方在
   * `render/mortarBlast.ts`。**純畫面**：不震鏡頭、不打燈、不點地面火。
   */
  /** 每一發推一格，同一幀的兩團才不會噴成一樣的形狀 */
  let mortarSeed = 0

  /** 火星的種子。每噴一次推一格，同一幀的兩團爆炸才不會噴成一樣的形狀 */
  let sparkSeed = 0

  /** 短片的爆炸種子，每一團推一格 */
  let reelBlastSeed = 0

  const emitMortarBlast = (x: number, y: number, z: number): void => {
    emitBlast(BLAST_POOLS, MORTAR_BLAST, x, y, z, (mortarSeed = (mortarSeed + 1) | 0))
  }

  /**
   * 炸彈與魚雷的碎片散射倍率，跟著這一團的火球半徑走。**呼叫前 `SCALED_BLAST`
   * 要已經是這一團的配方。** 直接乘當量尺度的話，60 kg 彈（0.11）的碎片
   * 只有 4 m/s，連同拖著的煙幾乎原地落下。
   */
  function blastDebrisSpeed(): number {
    return blastFireRadius(SCALED_BLAST) / DEBRIS_REF_FIRE_RADIUS
  }

  /**
   * 炸彈與魚雷的爆炸噴火星，只往上半邊噴。**呼叫前 `SCALED_BLAST` 要已經是
   * 這一團的配方** —— 噴多遠跟著它的火球半徑走。落到腳下的地面或海面就熄掉。
   */
  function burstSparks(x: number, y: number, z: number, terrain: BlastTerrain, elapsed: number): void {
    const cam = cameraPosition
    sparkSeed = (sparkSeed + 1) | 0
    blastSparks.burst(x, y, z, terrain.collisionHeightAt(x, z) - 0.5, blastFireRadius(SCALED_BLAST),
      true, sparkSeed, elapsed, cam.x, cam.y, cam.z)
  }

  /**
   * 擊墜的爆炸。**空中與墜地是同一條事件流**（兩者都走 `World.destroy`），
   * 由離地高度分辨。
   */
  function emitKillBlasts(events: KillEvents, time: number, terrain: BlastTerrain): void {
    const d = events.data
    for (let e = 0; e < events.count; e++) {
      const o = e * KILL_STRIDE
      const x = d[o]!
      const y = d[o + 1]!
      const z = d[o + 2]!
      const ground = terrain.collisionHeightAt(x, z)
      // 【撞海不算墜地】海面的 `collisionHeightAt` 是 0，只看高度的話撞海會
      // 揚起一團深咖啡色的土。入水的表現由殘骸的水柱負責（`wrecks`）
      const onLand = !(terrain.waterAt(x, z) > -Infinity)
        && y - ground <= CRASH_BLAST_HEIGHT
      // 【墜地那一份的爆點壓到地面】事件的 y 是機身中心，火球生在半空的話
      // 揚塵會浮著
      // 【空中那一份繼承母機速度】墜地的不繼承 —— 它已經撞停了
      const inherit = onLand ? 0 : KILL_BLAST_INHERIT
      emitBlast(BLAST_POOLS, onLand ? LAND_BLAST : AIR_BLAST,
        x, onLand ? ground : y, z, (e * 131 + Math.round(time * 60)) | 0,
        d[o + 3]! * inherit, d[o + 4]! * inherit, d[o + 5]! * inherit)
      addShake(cameraShake, x, onLand ? ground : y, z, KILL_SHAKE, cameraPosition)
      blastLights.flash(x, onLand ? ground : y, z, KILL_SHAKE, cameraPosition)
    }
  }

  /**
   * 地面目標被摧毀：在它的位置點一團落地的火。**與墜地那一份同一個配方**
   * （`LAND_BLAST`）—— 燒起來的卡車與撞地的飛機看起來就該是同一種土與火。
   * 事件的 y 已經是地面高度，不必再壓。這裡自己排空。
   */
  function emitGroundKills(events: ImpactEvents, time: number, groundTargets: readonly GroundTarget[]): void {
    const d = events.data
    for (let e = 0; e < events.count; e++) {
      const o = e * IMPACT_STRIDE
      const t = groundTargets[d[o + 3]!]
      // 【人死不爆炸】火球、震動、閃光與煙柱都略過：機槍掃倒一個班只是人不見了。
      // 炸彈的爆炸是彈自己的落點事件放的，不在這裡
      if (t !== undefined && t.unit.personnel === true) continue
      // 【炸彈擊毀不放第二次爆炸】`nz` = 1 表示這一筆是爆風打的，那一顆的
      // 落點事件已經在 `emitBombBlasts` 放過火球與碎片；子彈擊毀沒有落點
      // 事件，這裡才放一團
      //
      // 【不能改看 `ny`】那一格是兇手的座位索引，玩家投的彈也是非負的
      if (d[o + 5]! === 0) {
        emitBlast(BLAST_POOLS, LAND_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
          (e * 97 + Math.round(time * 60)) | 0, 0, 0, 0)
        // 【炸彈擊毀的不搖第二次】同一個理由：那一顆的落點事件已經搖過
        addShake(cameraShake, d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, cameraPosition)
        blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, cameraPosition)
      }
      // 【原地掛煙柱】燒 60 秒，與船火同一套參數
      const top =t === undefined ? 0 : t.impactY - t.position.y
      // 【油桶堆整片燒】一個火點在 28 × 18 m 的堆上只是一角冒煙；其餘一個
      const n = t !== undefined && t.unit.id === 'fuelDump' ? 6 : 1
      // 【散在腳印上】六個火點沿黃金角撒在半徑 8 m 內 —— 純裝飾
      for (let k = 0; k < n; k++) {
        const r = n === 1 ? 0 : 8 * Math.sqrt((k + 0.5) / n)
        const a = k * 2.39996
        lightGroundFire(groundFires, d[o]! + Math.cos(a) * r, d[o + 1]! + top * 0.3, d[o + 2]! + Math.sin(a) * r)
      }
    }
    clearImpacts(events)
  }

  /**
   * 炸彈落地。`nx` 是落點的種類：0 = 陸、1 = 水、2 = 船（見
   * `World.onBombImpact`）。
   *
   * 【打中船用空爆那一份】甲板上炸不揚土、也不掀水冠 —— 剩下的正好是
   * `AIR_BLAST` 的火球加煙。
   */
  function emitBombBlasts(events: ImpactEvents, time: number, terrain: BlastTerrain, elapsed: number): void {
    const d = events.data
    for (let e = 0; e < events.count; e++) {
      const o = e * IMPACT_STRIDE
      // 0 = 陸、1 = 水、2 = 船、3 = 建築。船與建築同一套：火加碎片
      const kind = d[o + 3]!
      const recipe = kind > 1.5 ? AIR_BLAST : kind > 0.5 ? WATER_BLAST : LAND_BLAST
      // 【表現的規模跟著那一顆的傷害走】`ny` 帶的是爆心傷害，而尺度的立方
      // 才是 `scaleBlast` 要的當量 —— 傷害本身正比於尺度，見 `blastScaleOf`
      const scale = blastScaleOf(d[o + 4]!)
      // 【光與震動不吃放大】用原尺度，見 `BOMB_BLAST_SIZE`；碎片與火星跟著火球走
      const vis = scale * BOMB_BLAST_SIZE
      scaleBlast(recipe, vis * vis * vis, SCALED_BLAST)
      const seed = (e * 197 + Math.round(time * 60)) | 0
      emitBlast(BLAST_POOLS, SCALED_BLAST, d[o]!, d[o + 1]!, d[o + 2]!, seed)
      addShake(cameraShake, d[o]!, d[o + 1]!, d[o + 2]!, ordnanceShakeScale(scale), cameraPosition)
      blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, scale, cameraPosition)
      // 碎片與擊墜共用同一個池；散射速度跟著火球的大小走
      debris.burst(d[o]!, d[o + 1]!, d[o + 2]!, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
      // 【落水的不噴】水面爆炸是水冠，火星不合理
      if (kind < 0.5 || kind > 1.5) burstSparks(d[o]!, d[o + 1]!, d[o + 2]!, terrain, elapsed)
    }
  }

  /**
   * 氣球破掉：氫氣燒起來的那一團火球。之後燒著掉下來的火由 `burnBalloon` 接手。
   */
  function emitBalloonPops(events: ImpactEvents, time: number): void {
    const d = events.data
    for (let e = 0; e < events.count; e++) {
      const o = e * IMPACT_STRIDE
      emitBlast(BLAST_POOLS, AIR_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
        (e * 131 + Math.round(time * 60)) | 0, 0, 0, 0)
      addShake(cameraShake, d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, cameraPosition)
      blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, cameraPosition)
    }
    clearImpacts(events)
  }

  /**
   * 魚雷引爆。`nx` 是 0 撞岸／1 撞船，兩者共用同一份水冠配方。
   *
   * 【爆點抬到水面】事件的 y 是定深（−1 m）—— 水柱從那裡長的話，整根的底部
   * 一公尺埋在水裡。
   */
  function emitTorpedoBlasts(events: ImpactEvents, time: number, terrain: BlastTerrain, elapsed: number): void {
    const d = events.data
    for (let e = 0; e < events.count; e++) {
      const o = e * IMPACT_STRIDE
      const x = d[o]!
      const z = d[o + 2]!
      const w = terrain.waterAt(x, z)
      const scale = blastScaleOf(d[o + 4]!)
      scaleBlast(TORPEDO_BLAST, scale * scale * scale, SCALED_BLAST)
      const y = Number.isFinite(w) ? w : d[o + 1]!
      const seed = (e * 211 + Math.round(time * 60)) | 0
      emitBlast(BLAST_POOLS, SCALED_BLAST, x, y, z, seed)
      addShake(cameraShake, x, y, z, ordnanceShakeScale(scale), cameraPosition)
      blastLights.flash(x, y, z, scale, cameraPosition)
      // 碎片從水面往上拋；與擊墜共用同一個池
      debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
      burstSparks(x, y, z, terrain, elapsed)
    }
  }

  /**
   * 高砲的引爆搖鏡頭。**配方在 `emitFlakBlasts`（`blast.ts`）裡放，震動在這
   * 一層加** —— 那一支不知道相機在哪裡，而震動一定要量到相機的距離。
   *
   * 呼叫端負責排空 `events`。
   */
  function shakeFlakBursts(events: BurstEvents): void {
    for (let e = 0; e < events.count; e++) {
      // 【尺度逐發帶】艦砲與陸砲各有自己的 `burstShake`，要分開調就改那一格
      addShake(cameraShake, events.x[e]!, events.y[e]!, events.z[e]!,
        events.shake[e]!, cameraPosition)
      // 【不放大】火網下每秒好幾發；照原始尺度亮一下
      blastLights.flash(events.x[e]!, events.y[e]!, events.z[e]!,
        events.shake[e]!, cameraPosition, false)
    }
  }

  function reelBomb(x: number, y: number, z: number, water: boolean, terrain: BlastTerrain, elapsed: number): void {
    // 與 `emitBombBlasts` 同一套：配方依落點、放大到基準彈的尺度、閃光、碎片；
    // 落在陸上的噴火星、點一處地面火
    const vis = BOMB_BLAST_SIZE * REEL_BOMB_SCALE
    scaleBlast(water ? WATER_BLAST : LAND_BLAST, vis * vis * vis, SCALED_BLAST)
    const seed = (reelBlastSeed = (reelBlastSeed + 197) | 0)
    emitBlast(BLAST_POOLS, SCALED_BLAST, x, y, z, seed)
    blastLights.flash(x, y, z, REEL_BOMB_SCALE, cameraPosition)
    debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    if (!water) {
      burstSparks(x, y, z, terrain, elapsed)
      lightGroundFire(groundFires, x, y, z)
    }
  }

  function reelTorpedoSplash(x: number, z: number): void {
    scaleBlast(WATER_BLAST, REEL_TORPEDO_SPLASH, SCALED_BLAST)
    emitBlast(BLAST_POOLS, SCALED_BLAST, x, 0, z, (reelBlastSeed = (reelBlastSeed + 211) | 0))
  }

  function reelTorpedoHit(x: number, z: number, terrain: BlastTerrain, elapsed: number): void {
    // 與 `emitTorpedoBlasts` 同一套，尺度取基準
    scaleBlast(TORPEDO_BLAST, 1, SCALED_BLAST)
    const seed = (reelBlastSeed = (reelBlastSeed + 223) | 0)
    emitBlast(BLAST_POOLS, SCALED_BLAST, x, 0, z, seed)
    blastLights.flash(x, 0, z, 1, cameraPosition)
    debris.burst(x, 0, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    burstSparks(x, 0, z, terrain, elapsed)
  }

  function reelShipHit(x: number, y: number, z: number, terrain: BlastTerrain, elapsed: number): void {
    // 與 `emitBombBlasts` 打中船那一份同一套：空爆配方（甲板上不揚土、不掀水冠）
    const vis = BOMB_BLAST_SIZE * REEL_BOMB_SCALE
    scaleBlast(AIR_BLAST, vis * vis * vis, SCALED_BLAST)
    const seed = (reelBlastSeed = (reelBlastSeed + 199) | 0)
    emitBlast(BLAST_POOLS, SCALED_BLAST, x, y, z, seed)
    blastLights.flash(x, y, z, REEL_BOMB_SCALE, cameraPosition)
    debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    burstSparks(x, y, z, terrain, elapsed)
  }

  function reelBlast(x: number, y: number, z: number, size: number, terrain: BlastTerrain, elapsed: number): void {
    // 【一群炸彈大小的火球疊成一大團，不是把一團放大】單團放大到好幾倍時，發光粒子
    // 也跟著放大，火球外圍會畫出一圈彩虹似的色帶，整團讀成一片橘色的煙塵罩。
    // 團數 ∝ 體積（size³，上限 `REEL_BLAST_LUMPS`），撒在半徑 ∝ size 的半球裡
    const vis = BOMB_BLAST_SIZE * REEL_BOMB_SCALE * REEL_BLAST_LUMP
    scaleBlast(LAND_BLAST, vis * vis * vis, SCALED_BLAST)
    const lumps = Math.min(REEL_BLAST_LUMPS, Math.max(1, Math.round(size * size * size)))
    const reach = REEL_BLAST_SPREAD * (size - 1)
    for (let k = 0; k < lumps; k++) {
      const seed = (reelBlastSeed = (reelBlastSeed + 229) | 0)
      const a = k * 2.39996
      const r = lumps === 1 ? 0 : reach * Math.sqrt((k + 0.5) / lumps)
      const h = reach * 0.8 * hash01(seed)
      emitBlast(BLAST_POOLS, SCALED_BLAST, x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, seed)
    }
    const seed = reelBlastSeed
    blastLights.flash(x, y, z, REEL_BOMB_SCALE * Math.min(size, REEL_FLASH_MAX), cameraPosition)
    debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    burstSparks(x, y, z, terrain, elapsed)
    const fires = Math.max(1, Math.round(size))
    for (let k = 0; k < fires; k++) {
      const r = fires === 1 ? 0 : 6 * size * Math.sqrt((k + 0.5) / fires)
      const a = k * 2.39996
      lightGroundFire(groundFires, x + Math.cos(a) * r, y, z + Math.sin(a) * r)
    }
  }

  function reelGroundKill(x: number, y: number, z: number, fires: number): void {
    // 與 `emitGroundKills` 同一套：落地的火、閃光；火點沿黃金角撒在半徑 8 m 內
    emitBlast(BLAST_POOLS, LAND_BLAST, x, y, z, (reelBlastSeed = (reelBlastSeed + 97) | 0))
    blastLights.flash(x, y, z, GROUND_KILL_SHAKE, cameraPosition)
    for (let k = 0; k < fires; k++) {
      const r = fires === 1 ? 0 : 8 * Math.sqrt((k + 0.5) / fires)
      const a = k * 2.39996
      lightGroundFire(groundFires, x + Math.cos(a) * r, y + 1, z + Math.sin(a) * r)
    }
  }

  return {
    emitGunLostBlast,
    reelGroundKill,
    emitMortarBlast,
    emitKillBlasts,
    emitGroundKills,
    emitBombBlasts,
    emitBalloonPops,
    emitTorpedoBlasts,
    shakeFlakBursts,
    reelBomb,
    reelTorpedoSplash,
    reelTorpedoHit,
    reelShipHit,
    reelBlast,
  }
}
