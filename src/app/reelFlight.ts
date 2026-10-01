import { Matrix4, Quaternion, Vector3 } from 'three'
import type { IslandDesc } from '../world/archipelago'

/**
 * 主選單短片的飛行：**路徑是時間的純函數，姿態由路徑推出來。**
 *
 * 寫一段分鏡只需要描述「這架飛機第 t 秒在哪」。機首、俯仰與滾轉不手寫 ——
 * 手寫的滾轉角只要與航跡的彎曲對不上幾度，畫面上就是側滑或往外側傾，
 * 而且說不出哪裡怪。
 */

/** 第 `t` 秒的位置，寫進 `out` 並回傳它。**不得配置** —— 每幀每架呼叫好幾次 */
export type Path = (t: number, out: Vector3) => Vector3

export interface Flight {
  readonly position: Vector3
  /** m/s */
  readonly velocity: Vector3
  readonly quaternion: Quaternion
  /** 過載，G：升力方向上的「加速度 + 重力」除以 g。平飛是 1 */
  loadFactor: number
}

export function createFlight(): Flight {
  return { position: new Vector3(), velocity: new Vector3(), quaternion: new Quaternion(), loadFactor: 1 }
}

const G = 9.81
/**
 * 差分的步長，秒。
 *
 * 【不能太小】二階差分除以 h²，h 太小時位置的浮點誤差被放大成加速度的雜訊，
 * 滾轉角會抖。0.05 秒在 150 m/s 時是 7.5 m，遠小於任何一段彎的半徑。
 */
const H = 0.05

const P0 = new Vector3()
const P2 = new Vector3()
const ACC = new Vector3()
const FWD = new Vector3()
const UP = new Vector3()
const RIGHT = new Vector3()
const BACK = new Vector3()
const BASIS = new Matrix4()

/**
 * 路徑在 `t` 的位置、速度與姿態，寫進 `out`。
 *
 * - 機首沿速度。
 * - 機體上方沿「加速度 + 重力」去掉沿機首的分量 —— 也就是升力該指的方向。
 *   轉彎自動往內側壓坡度、拉起自動抬頭，坡度就是協調轉彎的 `atan(v²/(r·g))`。
 *
 * 機體座標的約定與 `world/` 相同：機首 −Z、上 +Y、右 +X。
 */
export function flightPose(path: Path, t: number, out: Flight): Flight {
  path(t - H, P0)
  path(t, out.position)
  path(t + H, P2)
  out.velocity.subVectors(P2, P0).multiplyScalar(1 / (2 * H))
  ACC.copy(P2).addScaledVector(out.position, -2).add(P0).multiplyScalar(1 / (H * H))

  // 【停著的路徑】速度為零時沒有機首方向可言，保持上一幀的姿態
  const speed = out.velocity.length()
  if (speed < 1e-6) return out
  FWD.copy(out.velocity).multiplyScalar(1 / speed)
  UP.set(ACC.x, ACC.y + G, ACC.z)
  UP.addScaledVector(FWD, -UP.dot(FWD))
  out.loadFactor = UP.length() / G
  // 【垂直俯衝或爬升時升力方向退化】拿世界的水平面補一個上方
  if (UP.lengthSq() < 1e-9) UP.set(0, 0, 1).addScaledVector(FWD, -FWD.z)
  UP.normalize()
  RIGHT.crossVectors(FWD, UP)
  BACK.copy(FWD).negate()
  BASIS.makeBasis(RIGHT, UP, BACK)
  out.quaternion.setFromRotationMatrix(BASIS)
  return out
}

/** 找開闊海面時，候選點一圈一圈往外推的間距，m */
const SEARCH_STEP = 1000
/** 每一圈的候選方位數 */
const SEARCH_BEARINGS = 24
/** 最多找幾圈。群島的範圍遠小於它 */
const SEARCH_RINGS = 60

/**
 * 離原點最近、半徑 `radius` 內沒有任何島的一點。
 *
 * 【圓內不能有島】分鏡都寫在海上：船開上沙灘、飛機貼海面飛進山裡都不會報錯，
 * 只會很難看。判準用島的 `outerRadius` —— 地形實際延伸到那裡。
 */
export function openSeaOrigin(
  islands: readonly IslandDesc[], radius: number,
): { x: number, z: number } {
  const clear = (x: number, z: number): boolean => {
    for (const s of islands) {
      if (Math.hypot(x - s.cx, z - s.cz) < s.outerRadius + radius) return false
    }
    return true
  }
  if (clear(0, 0)) return { x: 0, z: 0 }
  for (let ring = 1; ring <= SEARCH_RINGS; ring++) {
    const r = ring * SEARCH_STEP
    for (let k = 0; k < SEARCH_BEARINGS; k++) {
      const a = (k / SEARCH_BEARINGS) * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (clear(x, z)) return { x, z }
    }
  }
  return { x: SEARCH_RINGS * SEARCH_STEP, z: 0 }
}
