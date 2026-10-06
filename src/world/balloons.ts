import { Quaternion, Vector3 } from 'three'
import { hitAircraft, segmentPointDistanceSq, type Box, type HitBox, type HitResult } from './hit'
import { obbOverlap } from './obb'
import type { Team } from './team'

/**
 * # 防空氣球
 *
 * 一顆氣囊繫在一條鋼索上：鋼索下端是錨點（LST 的艉甲板，或灘頭地面的絞車），
 * 上端是吊索的匯集點，在陣風裡飄晃（`stepBalloons`）。**不是 `Combatant`、不是
 * 任務目標**。
 *
 * - 飛機碰到鋼索或氣囊就墜毀（`balloonCollision`）；撞上氣囊的話氣球也破
 * - 子彈打得到氣囊，血量歸零就破（`World.resolveHits`）；破了之後鋼索與氣囊
 *   都不再擋東西
 * - AI 看到的是一座**看不見的山**（`balloonHills.ts`）：山頂在氣球之上、往四周
 *   降坡，既有的丘陵避讓就會爬過去或繞開
 *
 * ## 座標系
 *
 * 與 GLB（`models-src/balloon.glb`）一致：X 橫向、**Y 上**、**−Z 艇首**，原點在
 * 吊索的匯集點（`Balloon.top`）。
 */

/**
 * 氣囊的碰撞盒，氣球座標。尾翼不在盒裡 —— 與船的盒同一個性質，是粗體積。
 * 數字與 `balloon.glb` 一致，GLB 換了要跟著對：艇首 z −9.5、艇尾 +11、中心線在
 * 匯集點上方 9.5 m、最大半徑 3.8。
 */
export const BALLOON_ENVELOPE: Box = {
  center: new Vector3(0, 9.5, 0.75),
  half: new Vector3(4.5, 4.5, 10.25),
}
/** 氣囊盒最遠角到盒心的距離，m：子彈與飛機的粗篩用它 */
export const BALLOON_REACH = Math.hypot(4.5, 4.5, 10.25)
/** 整顆氣球的最高點離匯集點多高，m（朝上那片尾翼的頂） */
export const BALLOON_TOP = 15.7
/**
 * 氣囊的血量。**起始值，由試飛裁定。**
 *
 * 氣囊是布，但灌的是氫氣、分成好幾個氣室 —— 史實上要燒夷彈才打得下來。
 * 40 大約是一架疾風一小段連射。
 */
export const BALLOON_HP = 40

export interface Balloon {
  readonly index: number
  readonly team: Team
  /** 鋼索下端，世界座標。地面絞車的高度由 `settleBalloons` 照地形填 */
  readonly anchor: Vector3
  /** 鋼索放出多長，m：吊索匯集點在錨點正上方這麼高（沒有風的時候） */
  readonly tether: number
  /** 艇首朝向（沒有風的時候），rad。0 = 朝 −Z */
  readonly heading: number
  /**
   * 吊索匯集點（鋼索上端、模型原點），世界座標。**每一步由 `stepBalloons` 依
   * 飄晃重寫** —— 碰撞與畫面讀的都是它。破了之後停在破的那一刻
   */
  readonly top: Vector3
  /** 艇首朝向，含飄晃。與 `top` 同一個約定 */
  readonly orientation: Quaternion
  /** 錨點在地面上：落地時照地形取高度。LST 甲板上的錨點不動 */
  readonly grounded: boolean
  hp: number
  alive: boolean
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/**
 * @param anchorY 錨點的高度，m。地面絞車填什麼都行，`settleBalloons` 會蓋掉
 * @param tether  鋼索放出多長，m
 */
export function createBalloon(
  index: number, team: Team, x: number, anchorY: number, z: number,
  tether: number, heading: number, grounded: boolean,
): Balloon {
  return {
    index, team, grounded, tether, heading,
    anchor: new Vector3(x, anchorY, z),
    top: new Vector3(x, anchorY + tether, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    hp: BALLOON_HP,
    alive: true,
  }
}

export function resetBalloon(b: Balloon): void {
  b.hp = BALLOON_HP
  b.alive = true
}

/** 地面絞車照地形落地。**地形接上之後呼叫** —— 建戰鬥時 `groundAt` 還是 0 */
export function settleBalloons(
  balloons: readonly Balloon[], groundAt: (x: number, z: number) => number,
): void {
  for (const b of balloons) {
    if (b.grounded) b.anchor.y = groundAt(b.anchor.x, b.anchor.z)
    b.top.set(b.anchor.x, b.anchor.y + b.tether, b.anchor.z)
  }
}

// ── 飄晃 ────────────────────────────────────────────────────

/**
 * 陣風裡的飄晃。**純函數於時間**：同一個 `time` 同一個姿態，所以重播逐位元
 * 相同、也不需要亂數。每一顆的相位由索引錯開，不會整排同步擺。
 *
 * 水平漂移隨鋼索長度放大（鋼索愈長、擺幅愈大），幾道不同週期疊起來才不像鐘擺。
 * **全部是起始值，由試飛裁定。**
 */
/** 水平漂移的振幅，鋼索長度的幾成 */
const SWAY_DRIFT = 0.12
/** 上下起伏的振幅，m */
const SWAY_BOB = 3
/** 偏航、俯仰、滾轉的振幅，rad */
const SWAY_YAW = 12 * Math.PI / 180
const SWAY_PITCH = 5 * Math.PI / 180
const SWAY_ROLL = 7 * Math.PI / 180

const Q_YAW = /* @__PURE__ */ new Quaternion()
const Q_TILT = /* @__PURE__ */ new Quaternion()
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)
const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)

/**
 * 推進一步：把每一顆還在的氣球擺到 `time` 那一刻的位置與姿態。**不配置。**
 * 破掉的停在破的那一刻（畫面接手讓它燒著掉下去）。
 */
export function stepBalloons(balloons: readonly Balloon[], time: number): void {
  for (const b of balloons) {
    if (!b.alive) continue
    const p = b.index * 1.7
    const drift = SWAY_DRIFT * b.tether
    // 兩個水平方向各疊兩道週期（約 11 s 與 4.3 s）
    const sx = drift * (0.7 * Math.sin(0.57 * time + p) + 0.3 * Math.sin(1.46 * time + 2.1 * p))
    const sz = drift * (0.7 * Math.sin(0.49 * time + 1.3 * p) + 0.3 * Math.sin(1.31 * time + 0.7 * p))
    const sy = SWAY_BOB * Math.sin(0.83 * time + 0.9 * p)
    b.top.set(b.anchor.x + sx, b.anchor.y + b.tether + sy, b.anchor.z + sz)
    const yaw = b.heading + SWAY_YAW * Math.sin(0.37 * time + 1.9 * p)
    const pitch = SWAY_PITCH * Math.sin(0.71 * time + 0.5 * p)
    const roll = SWAY_ROLL * Math.sin(0.93 * time + 1.1 * p)
    Q_YAW.setFromAxisAngle(UP, yaw)
    b.orientation.copy(Q_YAW)
    Q_TILT.setFromAxisAngle(RIGHT, pitch)
    b.orientation.multiply(Q_TILT)
    Q_TILT.setFromAxisAngle(FWD, roll)
    b.orientation.multiply(Q_TILT)
  }
}

/** 氣囊盒的中心，世界座標。寫進 `out` */
export function envelopeCenter(b: Balloon, out: Vector3): Vector3 {
  return out.copy(BALLOON_ENVELOPE.center).applyQuaternion(b.orientation).add(b.top)
}

/** `balloonCollision` 的結果 */
export const BALLOON_MISS = 0
export const BALLOON_TETHER = 1
export const BALLOON_ENVELOPE_HIT = 2

const ENV_C = /* @__PURE__ */ new Vector3()
const BODY_C = /* @__PURE__ */ new Vector3()

/**
 * 這一架飛機這一步有沒有碰到這顆氣球。
 *
 * 【鋼索用飛機的命中盒判】`hitAircraft` 本來就是「線段對命中盒」—— 鋼索就是
 * 錨點到匯集點那一條線段（飄晃時是斜的）。240 Hz 下一步約 1 m，比翼弦短，不會
 * 從翼中間穿過去。
 *
 * 【氣囊與撞船同一個做法】命中盒（機體 AABB ＋ 姿態 ＝ OBB）對氣囊盒做分離軸。
 *
 * 【先粗篩】鋼索看飛機到線段的距離、氣囊看包圍球 —— 絕大多數的步數在這裡就
 * 結束了。
 */
export function balloonCollision(
  b: Balloon, boxes: readonly HitBox[], pos: Vector3, q: Quaternion, hitRadius: number,
  scratch: HitResult,
): number {
  if (!b.alive) return BALLOON_MISS
  const a = b.anchor
  const t = b.top
  if (segmentPointDistanceSq(a.x, a.y, a.z, t.x, t.y, t.z, pos.x, pos.y, pos.z) < hitRadius * hitRadius
    && hitAircraft(boxes, pos, q, a, t, scratch)) return BALLOON_TETHER
  envelopeCenter(b, ENV_C)
  const reach = hitRadius + BALLOON_REACH
  if (pos.distanceToSquared(ENV_C) > reach * reach) return BALLOON_MISS
  for (const hb of boxes) {
    BODY_C.copy(hb.center).applyQuaternion(q).add(pos)
    if (obbOverlap(BODY_C, hb.half, q, ENV_C, BALLOON_ENVELOPE.half, b.orientation)) {
      return BALLOON_ENVELOPE_HIT
    }
  }
  return BALLOON_MISS
}
