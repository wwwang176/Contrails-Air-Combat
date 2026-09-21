import { Euler, Quaternion, type Camera, type Vector3 } from 'three'
import { DEG } from '../core/math'
import { hash01 } from '../render/scatter'

/**
 * # 鏡頭震動
 *
 * 附近有東西炸開時相機抖一下；超速時持續抖。純表現：不進判定、不影響飛行，
 * 也不需要決定性。
 *
 * 【為什麼爆炸只有一個量而不是一串震源】同一秒裡可能有連投的一串炸彈、十幾發
 * 高砲與一架被打爆的飛機。一人一格的話要一個池、要過期、要合成；而畫面上
 * 的差別只有「現在抖得多大」。所以爆炸只留一個 `trauma`：隨時間衰減，角度吃
 * 它的平方。
 *
 * 【同時好幾發取最大值，不疊加】疊加的話一串連投的炸彈或一片防空火網會把
 * 它推到滿格並停在那裡 —— 而畫面上分不出「近處一顆」與「遠處十顆」。取
 * 最大值之後震動的大小恆等於**最近最猛的那一發**。超速的 `sustained` 也照
 * 這條與 `trauma` 取最大值。
 *
 * 【火焰不走這裡】燒起來的船與建築是每 0.3 秒一朵小爆炸、燒 60 秒模擬的
 * （`shipFires`／`groundFires`）。那一串接進來的話，只要場上有一處在燒，
 * 畫面就整場抖個不停。
 */

/**
 * 爆炸尺度 1.0（AN-M64 500 lb，與 `scaleBlast` 的基準同一個）搖得到多遠，
 * 公尺。**起始值，由試飛裁定。**
 */
export const SHAKE_RANGE = 500

/** 滿震動衰減到 0 要幾秒。**起始值，由試飛裁定。** */
export const SHAKE_SECONDS = 1.2

/**
 * 單軸的角度上限，弧度。65° 視野下 3.75° 大約是畫面高度的 6%。
 *
 * 【不要再大】相機每幀由 `CameraRig` 重算，震動是疊上去的偏移 —— 幅度大到
 * 準星離開目標的話，玩家會覺得是操縱在飄而不是爆炸在震。
 */
export const SHAKE_MAX_ANGLE = 3.75 * DEG

/** 滾轉的幅度相對於偏航／俯仰的比例。滾轉搶戲，所以小一點 */
export const SHAKE_ROLL_RATIO = 0.6

/** 噪聲的頻率，Hz。一次爆炸的 0.6 秒裡抖八下左右 */
export const SHAKE_FREQUENCY = 14

/**
 * HUD 跟著搖的角度上限，弧度。以**畫面中央**為軸旋轉。
 *
 * 【為什麼 HUD 也要搖】HUD 是釘在座艙上的一層玻璃，鏡頭震而它紋風不動的話，
 * 畫面讀起來像世界在抖而儀表浮在外面。
 *
 * 【不要超過鏡頭】3.75° 的鏡頭震動轉的是整個世界；HUD 比它還晃的話，畫面
 * 讀起來會變成儀表自己在甩。
 */
export const HUD_SHAKE_MAX_ANGLE = 1.5 * DEG

/**
 * HUD 跟著搖的位移上限，**佔畫面寬／高的比例**（左右吃寬、上下吃高）。
 *
 * 【位移比旋轉讀得出來】旋轉時畫面中央幾乎不動，看得出來的只有角落；位移
 * 是整張一起平移，準星與數字都在動。主要的份量放在這裡。
 *
 * 【上限在哪】貼邊的儀表（速度帶、小地圖）會被推出畫面一角 —— 再大就不是
 * 震動而是版面在跑。
 *
 * 【動它就要看滿版的填充】投彈暗角與黑視是整張畫面的填充，HUD 一移就會露出
 * 沒填到的邊 —— 那一份留白由 `widgets/viewport.ts` 依這一幀的實際位移算。
 */
export const HUD_SHAKE_MAX_SHIFT = 0.0225

/**
 * HUD 搖晃的頻率，Hz。**刻意與 `SHAKE_FREQUENCY` 不同** —— 同頻又同相的話
 * 兩者一起動，看起來像 HUD 黏死在世界上，整個效果就消失了。
 */
export const HUD_SHAKE_FREQUENCY = 9

/** 擊墜一架飛機的當量尺度。燃油與彈藥一起炸，與一顆 500 lb 同級 */
export const KILL_SHAKE = 1

/** 地面目標被打爆的當量尺度 */
export const GROUND_KILL_SHAKE = 0.8

/** 艦上砲位被打掉的當量尺度。備射彈殉爆，比一發砲彈大、比一顆炸彈小 */
export const GUN_LOST_SHAKE = 0.5

/**
 * 高砲引爆的當量尺度。5 吋砲彈的裝藥約 3 kg，對 AN-M64 的 227 kg ——
 * 立方根律下是 0.24。
 *
 * 【它同時是防空火網下的震動上限】取最大值而不是疊加，所以一片彈幕搖得
 * 再密也只到這個峰值 —— 角度吃它的平方，畫面上是持續的細微抖動。
 *
 * 【逐發的那一份在 `world/flak.ts`】每一發砲彈自己帶著 `shake`，因為艦砲
 * 與陸砲可以分開調（`ShipGunSpec.burstShake`）。這裡這個是 5 吋砲的值，
 * 護欄釘住兩者相等。
 */
export const FLAK_SHAKE = 0.25

/**
 * 超速搖晃開始的 `vneRatio`。**與 HUD 亮 OVERSPEED 的門檻同一個**
 * （`hud/widgets/energy.ts`）—— 字還沒亮就先搖，玩家會找不到原因。
 */
export const OVERSPEED_ONSET = 0.85

/**
 * 超速搖晃升到上限的 `vneRatio`。**與 HUD 的 OVERSPEED 轉紅同一個門檻**
 * —— 過了之後不再增加，紅字與黃字頂端搖得一樣。
 */
export const OVERSPEED_FULL = 0.95

/**
 * 超速搖晃的上限，與 `trauma` 同一個尺度。角度吃平方，0.25 是 0.23°，與
 * 高砲彈幕下的穩態抖動（`FLAK_SHAKE`）同級。
 *
 * 【比爆炸小很多】它會一直持續。幅度大到準星離開目標的話，玩家會覺得是
 * 操縱在飄 —— 見 `SHAKE_MAX_ANGLE`。
 */
export const OVERSPEED_SHAKE = 0.25

export interface CameraShake {
  /** 爆炸的震動，0…1。爆炸往上加，`stepCameraShake` 線性衰減 */
  trauma: number
  /**
   * 持續的震動，0…1。**呼叫端每幀直接寫入，不衰減** —— 衰減的話穩定超速時
   * 搖晃會一閃一閃，而減速之後還會多晃 `SHAKE_SECONDS` 才停。
   */
  sustained: number
  /**
   * 噪聲的相位，秒。**與 `trauma` 分開，而且震動停了也照走** —— 歸零的話
   * 每一次爆炸都從噪聲的同一點開始，連續兩次會晃出一模一樣的軌跡。
   */
  phase: number
  /** 換一場全部歸零。名字是 `reset` —— `main.ts` 的 `POOLS` 對每一個成員叫它 */
  reset(): void
}

export function createCameraShake(): CameraShake {
  return {
    trauma: 0,
    sustained: 0,
    phase: 0,
    reset() {
      this.trauma = 0
      this.sustained = 0
      this.phase = 0
    },
  }
}

/**
 * 一次爆炸。距離爆心越近加得越多，`SHAKE_RANGE × scale` 之外完全不加。
 *
 * @param scale 爆炸相似律的線性尺度，1.0 = AN-M64 500 lb。與 `scaleBlast`
 *              吃的是同一個數 —— 炸彈與魚雷直接把 `blastScaleOf` 的結果
 *              傳進來，固定配方的用這個檔案裡的常數。
 * @param cam   相機**上一幀**的位置。爆炸是在物理子步裡消費的，那時這一幀
 *              的相機還沒算 —— 在 350 m 的尺度下差一幀的位移看不出來。
 */
export function addShake(
  shake: CameraShake,
  x: number, y: number, z: number, scale: number, cam: Vector3,
): void {
  const range = SHAKE_RANGE * scale
  if (range <= 0) return
  // 【三個維度都算】只算水平距離的話，正下方的爆炸會震得像貼在臉上
  const d = Math.hypot(cam.x - x, cam.y - y, cam.z - z)
  if (d >= range) return
  // 【峰值也跟著當量走，不是一律給滿】只用尺度縮短範圍的話，一發 3 kg 裝藥
  // 的高砲彈在爆心與一顆 227 kg 的炸彈搖得一樣重
  const peak = scale > 1 ? 1 : scale
  // 【取最大值】見檔頭。峰值與衰減率都不超過 1，所以不必再夾上界
  const t = peak * (1 - d / range)
  if (t > shake.trauma) shake.trauma = t
}

/**
 * 小當量彈藥震動尺度的指數。越小，小彈越接近基準彈。**起始值，由試飛裁定。**
 *
 * 1/8 時 A6M5 的 60 kg 彈 0.11 → 0.76：範圍 380 m、爆心 2.2°、150 m 外 0.8°。
 */
export const ORDNANCE_SHAKE_EXPONENT = 1 / 8

/**
 * 投下的炸彈與魚雷交給 `addShake` 的尺度。
 *
 * 基準彈（尺度 1）以上原樣；以下取 `ORDNANCE_SHAKE_EXPONENT` 次方。照原值的話
 * 60 kg 彈範圍只有 55 m、角度吃平方剩 0.05°，投完彈拉起來就完全不搖。
 *
 * 【只給投下的彈藥】高砲、擊墜與砲位殉爆不走這裡 —— `FLAK_SHAKE` 放大之後
 * 防空火網下整段航程都會晃。
 */
export function ordnanceShakeScale(scale: number): number {
  if (!(scale > 0)) return 0
  return scale >= 1 ? scale : Math.pow(scale, ORDNANCE_SHAKE_EXPONENT)
}

/**
 * 超速時的持續震動量，寫進 `CameraShake.sustained`。
 *
 * `OVERSPEED_ONSET` 以下是 0，到 `OVERSPEED_FULL` 線性升到 `OVERSPEED_SHAKE`，
 * 再往上不增加。角度吃平方，所以剛過門檻時幾乎感覺不到。
 */
export function overspeedShake(vneRatio: number): number {
  if (vneRatio <= OVERSPEED_ONSET) return 0
  if (vneRatio >= OVERSPEED_FULL) return OVERSPEED_SHAKE
  return OVERSPEED_SHAKE * (vneRatio - OVERSPEED_ONSET) / (OVERSPEED_FULL - OVERSPEED_ONSET)
}

/**
 * 推進一步。**只衰減 `trauma`**，`sustained` 由呼叫端每幀寫。
 *
 * @param dt **畫面時間**，不是物理子步 —— 震動是純表現。
 */
export function stepCameraShake(shake: CameraShake, dt: number): void {
  shake.phase += dt
  const t = shake.trauma - dt / SHAKE_SECONDS
  shake.trauma = t > 0 ? t : 0
}

/**
 * 一軸的平滑噪聲，值域 −1…1。
 *
 * 【為什麼不直接取雜湊】那是白噪音：相機每一幀跳到一個無關的角度，畫面上
 * 看起來像掉幀而不是震動。這裡在整數格點上取雜湊，格點之間用 smoothstep
 * 內插 —— 相鄰兩幀的角度因此是連續的。
 *
 * 【三個軸要用不同的 `channel`】共用一組值的話三軸同步，晃出來是一條斜線。
 */
export function shakeNoise(channel: number, t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const a = hash01(channel * 8191 + i) * 2 - 1
  const b = hash01(channel * 8191 + i + 1) * 2 - 1
  return a + (b - a) * f * f * (3 - 2 * f)
}

/**
 * HUD 這一幀的噪聲，−1…1。與鏡頭同一個震動量（爆炸與超速取最大值）、同樣
 * 吃平方，但走自己的頻率與噪聲通道 —— 見 `HUD_SHAKE_FREQUENCY`。
 *
 * 【通道不能與鏡頭的三軸重覆】1、2、3 是鏡頭在用的；共用的話 HUD 會與
 * 某一軸完全同步。三個通道自己之間也要分開，否則位移會走成一條斜線。
 */
function hudNoise(shake: CameraShake, channel: number): number {
  const s = shake.trauma > shake.sustained ? shake.trauma : shake.sustained
  if (s <= 0) return 0
  return s * s * shakeNoise(channel, shake.phase * HUD_SHAKE_FREQUENCY)
}

/** HUD 這一幀要轉多少，弧度。**正負都有**，值域 ±`HUD_SHAKE_MAX_ANGLE` */
export function hudShakeAngle(shake: CameraShake): number {
  return HUD_SHAKE_MAX_ANGLE * hudNoise(shake, 4)
}

/** HUD 這一幀往左右移多少，佔畫面寬的比例。值域 ±`HUD_SHAKE_MAX_SHIFT` */
export function hudShakeShiftX(shake: CameraShake): number {
  return HUD_SHAKE_MAX_SHIFT * hudNoise(shake, 5)
}

/** HUD 這一幀往上下移多少，佔畫面高的比例。值域 ±`HUD_SHAKE_MAX_SHIFT` */
export function hudShakeShiftY(shake: CameraShake): number {
  return HUD_SHAKE_MAX_SHIFT * hudNoise(shake, 6)
}

/** 熱路徑：每幀一次，不配置 */
const SHAKE_Q = new Quaternion()
const SHAKE_E = new Euler(0, 0, 0, 'YXZ')

/**
 * 把震動疊到相機姿態上。**只轉不移** —— 座艙視角下平移會穿出座艙罩，機外
 * 視角下會把機身推出畫面。
 *
 * 【一定要排在 `rig.update` 與 `applyBlend` 之後】那兩支每一幀從頭寫相機
 * 姿態，排在它們之前的震動會被整個蓋掉，而畫面上只是「沒有震動」。也因為
 * 它們每幀重寫，這裡的偏移不會累積回相機的狀態。
 *
 * 【角度吃震動量的平方】線性的話 0.3 就有三成的振幅，遠處的一聲爆炸也搖得
 * 很明顯，整場都在晃。
 */
export function applyCameraShake(shake: CameraShake, camera: Camera): void {
  const s = shake.trauma > shake.sustained ? shake.trauma : shake.sustained
  const a = SHAKE_MAX_ANGLE * s * s
  if (a <= 0) return
  const t = shake.phase * SHAKE_FREQUENCY
  SHAKE_E.set(
    a * shakeNoise(2, t),
    a * shakeNoise(1, t),
    a * SHAKE_ROLL_RATIO * shakeNoise(3, t),
  )
  // 【右乘】偏移是在相機自己的座標裡轉，得到的才是畫面的搖晃
  camera.quaternion.multiply(SHAKE_Q.setFromEuler(SHAKE_E))
}
