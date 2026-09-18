import { TORPEDO_RANGE, TORPEDO_RUN_SAMPLES } from '../../world/torpedo'
import { hudFont, type HudFrame, type HudLayout } from '../types'
import { bombsightColor } from './bombsight'

/** 中間那幾個刻度的半長，px（未乘 `L.scale`） */
const TICK = 4
/**
 * 末端那一個刻度的半長，px。
 *
 * 【比中間的長】它標的是「線到這裡為止」—— 射程用盡是**無聲回收**，沒有
 * 爆炸也沒有水柱，所以射程上限只能靠這一橫講出來。
 *
 * **起始值，由試飛裁定。**
 */
const END_TICK = 7
/** 射程數字離末端刻度多遠，px */
const LABEL_GAP = 6

/** NDC → 螢幕 px 的換算結果。**每幀畫一次，不重新配置** */
const PX = new Float64Array(TORPEDO_RUN_SAMPLES)
const PY = new Float64Array(TORPEDO_RUN_SAMPLES)

/**
 * 從第 0 點起**連續**落在相機前方的取樣點有幾個。
 *
 * 【為什麼是連續而不是總數】`w ≤ 0` 的點投影出來是**穿過中心鏡射**的：
 * 它不會跑到無限遠讓你發現，它落在畫面上、方向剛好相反，而 canvas 會乾乾
 * 淨淨地把它裁到畫面邊緣。只數總數的話，畫出來是一條線條漂亮、方向錯
 * 180° 的瞄準線 —— 不拋例外、沒有東西會紅。
 *
 * 【判準是 `z < 1`】與 `bombVisible`、`noseVisible` 同一條（`main.ts` 用的
 * 就是它）。恰好等於 1 算在後面。
 *
 * 【收 `ArrayLike` 不收 `number[]`】呼叫端餵進來的是預先配置的
 * `Float64Array` —— 簽章寫死 `number[]` 就逼出每幀一次配置。
 */
export function runFrontCount(z: ArrayLike<number>, n: number): number {
  let k = 0
  while (k < n && z[k]! < 1) k++
  return k
}

/**
 * 這一幀畫不畫航跡線。**一般飛行也畫**，與落點圈同一個道理：投雷的距離是
 * 飛行狀態的函數，進場時不必切投彈模式也要讀得到。
 *
 * 【`bombVisible` 不進判準】那一格額外要求**落點圈**落在畫面內，而線的起點
 * 滑出畫面時線本身還有一大段在畫面裡。
 *
 * 【落點在陸地時 `runCount` 已經是 0】`bombState === 'solved'` 不代表落在
 * 水上 —— `solveImpact` 撞到任何地面都回成功，而真雷遇到陸地是立刻結束、
 * 根本沒有水中段。那一條在 `main.ts` 判（與 `stepAir` 同一個判準）。
 */
export function torpedoLineVisible(f: HudFrame): boolean {
  return f.ordnance === 'torpedo'
    && f.bombState === 'solved'
    && f.runCount >= 2
}

/**
 * 魚雷的水中航跡線。顏色跟著落點圈：投彈模式是實線圈的色，一般飛行是暗圈
 * 的色（`bombsightColor`）。
 *
 * 從入水點（＝落點圈的圓心）沿水中航向畫到射程為止，每
 * `TORPEDO_RUN_STEP` 公尺一個刻度。**圈是線的起點**，兩者組成一組：圈說
 * 「雷從這裡入水」，線說「然後它跑到那裡」。
 *
 * 【為什麼平面投影是精確的】透視投影把直線映成直線，所以投影兩個端點再連
 * 直線就是那條 3D 線在畫面上的真實樣子 —— 不需要細分。刻度點各自投影，
 * 一樣精確。
 *
 * 【畫到畫面外不用自己裁】canvas 只點陣化畫布之內的部分，座標丟到界外它
 * 自己停在邊緣。要自己擋的只有相機後面那一種（見 `runFrontCount`）。
 *
 * 【畫的是散佈之前的名義中心線】與落點圈完全一致 —— 把散佈也套進瞄具的話，
 * 散佈就變成免費的情報，等於沒有散佈。
 */
export function drawTorpedoLine(
  ctx: CanvasRenderingContext2D,
  L: HudLayout,
  f: HudFrame,
): void {
  if (!torpedoLineVisible(f)) return

  const n = f.runCount
  const color = bombsightColor(f.bombing ? 'ring' : 'faint', f.releaseOk)
  // 【先換算進預先配置的緩衝】每幀畫一次，寫成兩個區域閉包就是每幀兩個
  // 配置；順帶讓每一點的換算只做一次
  for (let k = 0; k < n; k++) {
    PX[k] = L.cx + (f.runX[k]! * L.width) / 2
    PY[k] = L.cy - (f.runY[k]! * L.height) / 2
  }

  ctx.strokeStyle = color
  ctx.lineWidth = 1 * L.scale
  ctx.beginPath()
  ctx.moveTo(PX[0]!, PY[0]!)
  for (let k = 1; k < n; k++) ctx.lineTo(PX[k]!, PY[k]!)
  ctx.stroke()

  // 【入水點不畫刻度】落點圈已經在那裡了
  for (let k = 1; k < n; k++) {
    // 【方向取自前一段】刻度要垂直於線在**那一點**的走向
    const dx = PX[k]! - PX[k - 1]!
    const dy = PY[k]! - PY[k - 1]!
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const last = k === TORPEDO_RUN_SAMPLES - 1
    const half = (last ? END_TICK : TICK) * L.scale
    // 法線 = 切線轉 90°
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    ctx.beginPath()
    ctx.moveTo(PX[k]! - nx, PY[k]! - ny)
    ctx.lineTo(PX[k]! + nx, PY[k]! + ny)
    ctx.stroke()
  }

  // 【只有真的走到末端才標】沒走到就標的話那個數字是假的
  if (n < TORPEDO_RUN_SAMPLES) return
  const end = TORPEDO_RUN_SAMPLES - 1
  const dx = PX[end]! - PX[end - 1]!
  const dy = PY[end]! - PY[end - 1]!
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return
  ctx.font = hudFont(Math.round(9 * L.scale))
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  // 【一定要自己設 textBaseline】整個 HUD 共用一個 ctx，而這個屬性是黏著的
  ctx.textBaseline = 'middle'
  const gap = (END_TICK + LABEL_GAP) * L.scale
  ctx.fillText(
    String(TORPEDO_RANGE),
    PX[end]! + (-dy / len) * gap,
    PY[end]! + (dx / len) * gap,
  )
  ctx.textAlign = 'left'
}
