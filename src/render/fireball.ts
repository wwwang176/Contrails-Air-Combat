import { AdditiveBlending, Color, SRGBColorSpace, Vector3 } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { KILL_STRIDE, type KillEvents } from '../world/kills'

/** 一次擊墜噴幾顆。 */
export const FIREBALL_COUNT = 12

/** 壽命，s。60 fps 下 30 幀，看得完一次爆開。 */
export const FIREBALL_LIFE = 0.5

/** 出生直徑，m。 */
export const FIREBALL_SIZE_FROM = 3

/**
 * 死亡直徑，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。8 m 的
 * 火球在 1 km 上是 13.5 px，而空戰交戰距離通常在 500 m 內（約 27 px）——
 * **因此不需要距離剔除**（M8 spec §5）。
 */
export const FIREBALL_SIZE_TO = 8

/** 向外噴的初速，m/s。 */
export const FIREBALL_SPEED = 15

/**
 * 繼承多少比例的母機速度。
 *
 * 【為什麼不是 0】火球若完全靜止，一架 150 m/s 的飛機在 0.5 s 的壽命內會
 * 飛出 75 m —— 畫面上是「爆炸發生在飛機後面」。真實的火球會先隨殘骸往前
 * 衝，再被空氣迅速煞住（M8 spec §5）。
 */
export const FIREBALL_INHERIT = 0.5

/** 指數阻尼，s⁻¹。時間常數 0.25 s，正好在壽命之內煞停。 */
export const FIREBALL_DRAG = 4

/** 池子大小。40 架 × 12 顆 = 480，512 有餘裕。 */
export const FIREBALL_CAPACITY = 512

/**
 * 四個色標：白熱 → 橘 → 暗紅 → 黑。數值是 **sRGB**，見 `fireballColor`。
 *
 * 【為什麼要有「黑」這一段】火焰要轉成黑色之後才可以消失，那才有燃燒感。
 * 加法混合畫不出黑（`dst + 0` 等於沒加），所以這裡
 * 能做的是讓**火自己熄掉** —— 顏色在最後四分之一由暗紅收到全黑，而不是
 * 帶著橘紅硬淡出去。真正看得見的黑由 `emitKillSmoke` 那團煙負責。
 */
const HOT = { r: 1.0, g: 0.95, b: 0.80 }
const MID = { r: 1.0, g: 0.45, b: 0.05 }
const EMBER = { r: 0.35, g: 0.04, b: 0.0 }
const BLACK = { r: 0.0, g: 0.0, b: 0.0 }

/**
 * 年齡比例 → 顏色。
 *
 * 【為什麼是三段而不是兩點內插】白 (1,.95,.8) 直接線性內插到暗紅
 * (.25,.02,0)，中點是 (.63,.49,.4) —— 那是脫色的土黃，不是火。火焰的色溫
 * 曲線本來就不是直線。
 *
 * 【淡出交給 alpha】加法混合下 `blendSrc` 是 `SrcAlphaFactor`，所以
 * `particleAlpha` 的線性淡出對加法混合一樣有效（M8 spec §5）。
 *
 * 【色標是 sRGB，所以要指定色彩空間】`setRGB` 預設寫的是**線性**值。把
 * 「橘色 (1, .45, .05)」當線性值寫進去，輸出會變成 sRGB 的 (1, .70, .25)
 * ——一個發白的黃，不是橘。黑煙踩過同一個坑（見 `smokeColor`）。
 */
export function fireballColor(t: number, out: Color): void {
  // 三段內插：0–0.45 白熱→橘、0.45–0.75 橘→暗紅、0.75–1 暗紅→黑
  let a = HOT
  let b = MID
  let k = 0
  if (t <= 0.45) {
    k = t / 0.45
  } else if (t <= 0.75) {
    a = MID
    b = EMBER
    k = (t - 0.45) / 0.3
  } else {
    a = EMBER
    b = BLACK
    k = (t - 0.75) / 0.25
  }
  out.setRGB(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    SRGBColorSpace,
  )
}

export function createFireball(capacity: number = FIREBALL_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: AdditiveBlending,
    life: FIREBALL_LIFE,
    sizeFrom: FIREBALL_SIZE_FROM,
    sizeTo: FIREBALL_SIZE_TO,
    gravity: 0,
    drag: FIREBALL_DRAG,
    alphaFrom: 1,
    color: fireballColor,
  })
}

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依擊墜事件噴一團火球。
 *
 * **不做距離剔除**：見 `FIREBALL_SIZE_TO` 的推導 —— 8 m 在 1 km 上仍有
 * 13.5 px，而火球本來就該從遠處看得到（那是戰場資訊）。
 */
export function emitFireball(pool: Particles, events: KillEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * KILL_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    const ivx = d[o + 3]! * FIREBALL_INHERIT
    const ivy = d[o + 4]! * FIREBALL_INHERIT
    const ivz = d[o + 5]! * FIREBALL_INHERIT
    for (let k = 0; k < FIREBALL_COUNT; k++) {
      // 半角 π = 等向。軸取 +Y 只是為了給錐一個參考，等向下不影響結果
      coneDirection(0, 1, 0, Math.PI, e * FIREBALL_COUNT + k, DIR)
      pool.emit(
        x, y, z,
        ivx + DIR.x * FIREBALL_SPEED,
        ivy + DIR.y * FIREBALL_SPEED,
        ivz + DIR.z * FIREBALL_SPEED,
      )
    }
  }
}
