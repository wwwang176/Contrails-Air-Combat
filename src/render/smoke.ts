import { Color, NormalBlending, Vector3, type Texture } from 'three'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import { IMPACT_STRIDE, type ImpactEvents } from '../world/events'
import { KILL_STRIDE, type KillEvents } from '../world/kills'

/** 壽命，s。60 fps 下 150 幀 —— 拖得出一條讀得到的煙帶。 */
export const SMOKE_LIFE = 2.5

/**
 * 壽命的隨機幅度。0.25 = 每一團各自活 0.75×~1.25× 的 `SMOKE_LIFE`
 * （1.875 ~ 3.125 s）。
 *
 * 【為什麼】同一批煙用同一個壽命的話它們會**同時**淡到不見，煙帶的尾端
 * 讀起來是一條被切齊的線；壽命一抖，尾端就自己散開了。
 */
export const SMOKE_LIFE_JITTER = 0.25

/** 最長的一團活多久，s。池子容量與各種「煙還在不在」的推導用這個上界。 */
export const SMOKE_LIFE_MAX = SMOKE_LIFE * (1 + SMOKE_LIFE_JITTER)

/** 出生直徑，m。 */
export const SMOKE_SIZE_FROM = 2

/** 死亡直徑，m。膨脹是煙散開的樣子。 */
export const SMOKE_SIZE_TO = 9

/**
 * 出生時的不透明度，線性淡到 0。
 *
 * 【誰在讀它】飛機的拖煙、擊墜煙、爆炸的煙柱、火轉煙 —— **四者共用一個
 * 濃度**。
 */
export const SMOKE_ALPHA = 0.7

/** 終端上浮速度，m/s。 */
export const SMOKE_RISE = 3

/** 指數阻尼，s⁻¹。 */
export const SMOKE_DRAG = 1.5

/**
 * 餵給積分器的上浮加速度，m/s²。
 *
 * 【為什麼是加速度而不是速度】`particles.ts` 的積分器只有 `gravity` 這一個
 * 欄位，而終端速度是 `gravity / drag`。要 3 m/s 的上浮就得餵
 * 3 × 1.5 = 4.5 —— 與殘骸的阻尼由終端速度 80 m/s 反推是同一個做法。
 */
export const SMOKE_GRAVITY = SMOKE_RISE * SMOKE_DRAG

/**
 * 殘骸每隔多久冒一團，s。
 *
 * 【為什麼要這麼密】150 m/s 下相鄰兩團相距 6 m，而煙團一出生就有 2 m 直徑、
 * 很快長到 9 m —— 間距小於直徑，煙帶才是連的而不是一串珠子。
 */
export const WRECK_SMOKE_INTERVAL = 0.04

/**
 * 殘骸最多冒多久的煙，s。
 *
 * 【為什麼只有 4 秒】殘骸的壽命是 120 s（`WRECK_MAX_LIFE`），而從
 * 4,000 m 掉到海面要三十秒以上。整段都冒煙的話，一場 20v20 打到後來
 * 天空會被一堆長得看不到頭的煙柱塞滿 —— 那時它已經不是「剛剛有人被打
 * 下來」的訊號，只是背景雜訊。4 秒足夠讓那道煙被看見並讀成一次擊墜。
 *
 * 【為什麼是硬上限而不是讓煙自己淡掉】煙團自己會在 `SMOKE_LIFE` 之後
 * 消失，但只要來源還在發射，煙帶就會一直被補上 —— 淡出解決的是單一團
 * 的壽命，不是整條煙帶的長度。
 */
export const WRECK_SMOKE_SECONDS = 4

/**
 * 冒煙的零件每隔多久冒一團，s。
 *
 * 【為什麼比殘骸那一條還要密】零件的散射初速 40 m/s 疊在母機的 150 m/s
 * 上，一個間隔內會走 `速度 × 間隔` 那麼遠。0.15 s 下那是二十幾公尺，
 * 遠大於煙團的出生直徑，煙帶因此有斷點。
 */
export const DEBRIS_SMOKE_INTERVAL = 0.075

/**
 * 一片零件冒多久的煙，s。**逐片隨機**，上界必須不超過 `DEBRIS_LIFE_MIN`。
 *
 * 【為什麼上界綁在零件壽命的下界】超過的話，最短命的那幾片會在還冒著煙的
 * 當下整片消失 —— 煙帶的頭端與源頭同時不見。卡在 `DEBRIS_LIFE_MIN` 保證
 * 停煙**不晚於**退場；兩者剛好相等的那幾片是臨界情況，不是違例。
 *
 * 【為什麼是範圍】與零件壽命、煙的壽命同一個理由：整批同時停會在畫面上
 * 留下一條被切齊的邊。
 */
export const DEBRIS_SMOKE_SECONDS_MIN = 0.75
export const DEBRIS_SMOKE_SECONDS_MAX = 1.5

/**
 * 三十六片零件裡有幾片冒煙。
 *
 * 【看不見細煙時要調的是粗細，不是片數】「部分零件冒煙」讀得出來靠的是
 * 每一條夠粗（`DEBRIS_SMOKE_SIZE` 0.9），不是條數夠多。
 *
 * 【為什麼不是全部 36 片】畫面上會糊成一片，讀不出「零件在散開」
 * （M8 spec §6.1），而且發射量會從 20×4 變成 20×36。
 */
export const DEBRIS_SMOKE_COUNT = 4

/**
 * 零件冒的煙相對殘骸的尺寸倍率。
 *
 * 【為什麼需要它】煙必須比殘骸拖的那條細，兩種煙才分得出來 —— 一條是
 * 「主體在燒」，另一條是「碎片在燒」。
 *
 * 【為什麼是 0.9】0.35 那個量級在遠方非常不明顯。上限是「略小於機身的
 * 煙」，所以取 0.9（2.6 倍）而不是三倍的 1.05。
 *
 * 【煙團遠大於碎片本身是刻意的】1.8 → 8.1 m 的煙黏在 0.4 m 的碎片上，
 * 鏡頭貼著看確實會讀成「煙球在飛」；但空戰的實際視距下，讀不讀得到才是
 * 先決條件。
 */
export const DEBRIS_SMOKE_SIZE = 0.9

/**
 * 池子大小。
 *
 * 【6144 怎麼來】20 具殘骸各 `2.5 / 0.04 = 63` 團 ≈ 1,260；80 片冒煙的零件
 * 各冒平均 1.125 s、`1.125 / 0.075 = 15` 團 ≈ 1,200（煙團的壽命長過零件的
 * 冒煙時間，所以每一片的存量就是它總共冒過的量）。合計約 2,500 團，
 * 餘裕 2.4 倍。零件的壽命由 5 s 縮到 2 s 之後這一邊少了很多。
 *
 * 【為什麼容量變大不會讓每幀變貴】`step` 對**已經歸零的死格子跳過寫入**
 * （見 `createParticles`），所以每幀的矩陣寫入量跟著存活數走而不是容量。
 */
export const SMOKE_CAPACITY = 6144

/** 煙的顏色，**sRGB**。 */
export const SMOKE_COLOR = 0x1a1a1a

/**
 * 年齡比例 → 顏色。**常數深灰。**
 *
 * 【為什麼不隨年齡變色】煙的消失靠 alpha，不靠顏色。往黑淡在亮天空上方向
 * 是反的（愈淡愈明顯），往白淡則會變成蒸汽（M8 spec §4.3）。
 *
 * 【為什麼是 `setHex` 而不是 `setRGB`】`setRGB` 寫的是**線性**值，而
 * `0x1a1a1a` 是 sRGB 的寫法。寫成 `setRGB(0.102, ...)` 的話，three 輸出時
 * 把那個線性值轉成 sRGB 變成約 `0x5c` 的中灰 —— **比深藍色的海面還亮**，
 * 方向完全相反。在試驗場上一眼就看得出來：那不是黑煙，是白霧。
 * `setHex` 預設就是 sRGB 輸入，會做該做的轉換。
 */
export function smokeColor(_t: number, out: Color): void {
  out.setHex(SMOKE_COLOR)
}

/**
 * 這一幀該生幾團。`timer` 是上一幀留下的餘數。
 *
 * 【為什麼低幀率要一次補足】0.5 s 的長幀若只生一團，150 m/s 的殘骸會在煙帶
 * 上留下一段 75 m 的空隙。補足的代價是那幾團生在同一個位置（沒有做位置
 * 內插）—— 一個只在掉幀時出現、而且比空隙輕微得多的瑕疵。
 */
export function smokePuffs(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return Math.floor((timer + dt) / interval)
}

/** 這一幀之後計時器該留下多少。與 `smokePuffs` 成對使用。 */
export function smokeTimer(timer: number, dt: number, interval: number): number {
  if (interval <= 0) return 0
  return (timer + dt) % interval
}

/**
 * 船火的煙柱高度，m。**每一艘都一樣。**
 *
 * 【為什麼不共用通用的煙池】`SMOKE_LIFE` 是 2.5 秒、上升 3 m/s ⇒ 柱高只有
 * 7.5 m。那個高度在 1,000 m 的投彈高度上看不見，而「哪幾艘在燒」正是玩家
 * 要從空中讀的東西。
 *
 * **起始值，待試飛。**
 */
export const SHIP_FIRE_PLUME_HEIGHT = 200
/**
 * 一團煙活多久，s。
 *
 * 【它與柱高一起決定上升速度】兩者的比就是平均速度：200 m ÷ 20 s = 10 m/s，
 * 那是大火煙柱的量級。壽命縮到 12 秒的話同樣的柱高要 31 m/s 的初速 ——
 * 113 km/h，看起來像砲彈不像煙。
 */
export const SHIP_FIRE_SMOKE_LIFE = 20
/**
 * 阻尼，s⁻¹。**很小。**
 *
 * 【為什麼要這麼小】阻尼大就代表「起步很快、然後迅速慢下來」。整段柱子的
 * 高度是固定的，所以阻尼愈大、起步的那一下就愈猛：0.12 之下初速是 12.6 m/s
 * 而收尾只剩 4.6，看起來像噴出去的；0.02 之下是 12.1 → 8.1，從頭到尾都在
 * 10 m/s 上下。
 */
export const SHIP_FIRE_SMOKE_DRAG = 0.02
/**
 * 煙團的直徑，m：出生 → 壽命結束。
 *
 * 【為什麼比色塊版的 3 → 22 大】換成 `smoke.png` 之後同樣的四邊形看起來
 * 小了一截：貼圖是有邊有絮的煙團，而著色器自己裁的圓是實心的。逐像素量
 * 同一張 128×128 的圖與那個圓：
 *
 * ```
 *   α ≥ 0.50 的等面積半徑    色塊 0.750   貼圖 0.413    差 1.81 倍
 *   α ≥ 0.25                     0.837        0.623        1.34
 *   平均 α（總墨水量）           0.452        0.188        1.55 ← 取它
 * ```
 *
 * 取**等墨水量**那一個：實心核心的比值（1.81）會讓外圈的絮飄得太開，
 * 只看外緣（1.34）又補不回中心的份量。1.55 是「整團的視覺重量相同」。
 *
 * 【代價是填充率】線性放大 1.55 倍等於面積 2.4 倍，而這個場景本來就是
 * 填充率吃緊的。真的掉幀時這一格與 `FIRE_SMOKE_PER_PUFF` 是第一順位。
 */
export const SHIP_FIRE_SMOKE_SIZE_FROM = 4.6
export const SHIP_FIRE_SMOKE_SIZE_TO = 34
/**
 * 逐顆亮度抖動的幅度（`particleShade`）。
 *
 * 【為什麼煙柱特別需要它】柱子是一整條同色的東西，前後兩顆長得完全一樣時
 * 眼睛拿不到深度線索，整根讀起來是一塊平的剪影。爆炸的煙用 0.5，柱子比它
 * 厚、疊得更多層，所以再放寬一點。
 */
export const SHIP_FIRE_SMOKE_SHADE = 0.6

/**
 * 想爬到 `height` 公尺要多快的初速，m/s。
 *
 * 積分器是 `v ← v·exp(−k·dt)`（`gravity` 為 0），所以
 * `v(t) = v₀·e^(−kt)`，積出來的高度是
 *
 * ```
 *   y(L) = v₀ · (1 − e^(−kL)) / k
 * ```
 *
 * **不要寫死一個「看起來差不多」的速度** —— 柱高與初速之間隔著阻尼，
 * 改了壽命或阻尼之後那個數字就不對了，而症狀只是「煙柱好像有點矮」。
 */
export function plumeSpeed(
  height: number,
  life: number = SHIP_FIRE_SMOKE_LIFE,
  drag: number = SHIP_FIRE_SMOKE_DRAG,
): number {
  return (height * drag) / (1 - Math.exp(-drag * life))
}

/** 每一團煙出生時的上升初速，m/s。 */
export const SHIP_FIRE_PLUME_SPEED = plumeSpeed(SHIP_FIRE_PLUME_HEIGHT)

/**
 * 容量。**64 個火點 × 每 0.3 秒 3 團 × 壽命 20 秒 = 12,800** 的上界，
 * 取 16,384。
 *
 * 【為什麼要照上界配】滿了會覆寫最舊的（`createParticles`），而最舊的正是
 * 柱子的**頂端** —— 症狀是煙柱莫名其妙變矮，而不是任何錯誤。
 *
 * 【為什麼容量大不等於每幀貴】`step` 對已經歸零的死格子跳過寫入，所以成本
 * 跟著存活數走而不是容量。實戰到不了 64 個火點：那要八艘船全部挨滿彈。
 */
export const SHIP_FIRE_SMOKE_CAPACITY = 16384

/**
 * 船火的煙柱池。**垂直向上**：每一團的初速是朝上的，水平只抖一點寬度。
 * 爆炸那一份的煙是錐狀噴出去的，這一份不是。
 *
 * @param alphaMap 煙團的不透明度貼圖。**給了它，著色器就不再自己裁軟邊
 *                 圓形**（`injectBillboard` 的 `soft`）—— 兩層淡出疊起來
 *                 會把煙縮成一個小核。柱子是全場疊得最厚的一叢粒子，正是
 *                 「一堆同心圓看得出是圓形」最明顯的地方，而貼圖版還會逐顆
 *                 轉 UV 破掉那個重複感
 * @param hex      煙的顏色，**sRGB 十六進位**。顏色是逐池的，不是逐顆 ——
 *                 要兩種顏色就開兩份池子。省略即船火那個深灰
 */
export function createShipFireSmoke(
  capacity: number = SHIP_FIRE_SMOKE_CAPACITY,
  alphaMap?: Texture,
  hex: number = SMOKE_COLOR,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: SHIP_FIRE_SMOKE_LIFE,
    sizeFrom: SHIP_FIRE_SMOKE_SIZE_FROM,
    sizeTo: SHIP_FIRE_SMOKE_SIZE_TO,
    // 【浮力是 0】柱高全部由每一團的初速決定（見 `plumeSpeed`），這樣
    // 「爬到 200 m」就是一個解得出來的式子而不是兩個常數湊出來的結果
    gravity: 0,
    drag: SHIP_FIRE_SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    lifeJitter: SMOKE_LIFE_JITTER,
    shadeJitter: SHIP_FIRE_SMOKE_SHADE,
    // 【`setHex` 不是 `setRGB`】理由見 `smokeColor`：`setRGB` 寫的是線性值，
    // 深灰會被輸出成比海面還亮的中灰
    color: (_t, out) => { out.setHex(hex) },
  })
}

/** 蒸汽的容量。廠區四根煙囪與冷卻塔各每秒幾顆、活 8 秒 —— 幾百顆就夠 */
export const STEAM_CAPACITY = 1024
/** 蒸汽的壽命，s。比黑煙長：它是持續冒出的柱，不是一團 */
export const STEAM_LIFE = 8
const STEAM_COLOR = /* @__PURE__ */ new Color(0.92, 0.92, 0.9)

/**
 * 廠區的白煙：煙囪與冷卻塔頂持續冒出的蒸汽。**與黑煙同一套粒子系統的
 * 另一份實例** —— 壽命、上升、起訖尺寸是整池共用的建立期設定，一份設定
 * 生不出兩種煙。
 *
 * 白、慢慢上升、越飄越大、淡。炸毀就停（呼叫端不再 `emit`）。
 */
export function createSteam(capacity: number = STEAM_CAPACITY, alphaMap?: Texture): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: STEAM_LIFE,
    sizeFrom: 6,
    sizeTo: 26,
    // 終端速度 gravity / drag = 2 m/s：一根 8 秒的柱約 20 m 高，再被風感
    // 的水平初速拉斜
    gravity: 1.2,
    drag: 0.6,
    alphaFrom: 0.45,
    lifeJitter: 0.3,
    shadeJitter: 0.15,
    color: (_t: number, out: Color) => { out.copy(STEAM_COLOR) },
  })
}

export function createSmoke(capacity: number = SMOKE_CAPACITY): Particles {
  return createParticles({
    capacity,
    blending: NormalBlending,
    life: SMOKE_LIFE,
    sizeFrom: SMOKE_SIZE_FROM,
    sizeTo: SMOKE_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    lifeJitter: SMOKE_LIFE_JITTER,
    color: smokeColor,
  })
}

/**
 * 依位置事件生煙。**初速恆為零** —— 一團煙生出來就與發射體脫鉤。
 *
 * 【為什麼重用 `ImpactEvents`】煙只需要「一個位置」，而那個型別就是
 * `x,y,z` 加三個這裡用不到的法線欄位。M7 spec §2.2 已經為「命中與入海共用
 * 一個型別」寫過同樣的理由 —— 為了省三個 float 再發明一個結構才是壞的。
 */
/**
 * 擊墜當下的煙球噴幾團。
 *
 * 【為什麼火球之外還要這個】火焰要轉成黑色之後才可以消失。
 * 火球是**加法混合**的，而加法畫不出黑（`dst + 0` 等於沒加）—— 在那個
 * 混合模式下「變黑」與「消失」是同一件事。真正看得見的黑必須是一團一般
 * 混合的深色東西留在原地：火球褪去、煙球在同一個位置浮現，那正是真實
 * 爆炸的樣子。
 */
export const KILL_SMOKE_COUNT = 10

/** 擊墜煙球的尺寸倍率。4.8 → 21.6 m —— 要蓋得住 8 m 的火球才接得起來。 */
export const KILL_SMOKE_SIZE = 2.4

/** 煙球向外擴的初速，m/s。慢到讀得出是「一團」而不是「炸開」。 */
export const KILL_SMOKE_SPEED = 8

/** 繼承多少母機速度。與火球相同，兩者才會一起往前走。 */
export const KILL_SMOKE_INHERIT = 0.5

/** 模組私有的暫存。熱路徑：不配置。 */
const DIR = new Vector3()

/**
 * 依擊墜事件生一團大煙球，接在火球後面。
 *
 * 與 `emitFireball` 生在同一個位置、繼承同樣比例的母機速度，所以兩者
 * 疊在一起走 —— 火在前 0.5 s 熄掉，煙球撐 2.5 s。
 */
export function emitKillSmoke(pool: Particles, events: KillEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * KILL_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    const ivx = d[o + 3]! * KILL_SMOKE_INHERIT
    const ivy = d[o + 4]! * KILL_SMOKE_INHERIT
    const ivz = d[o + 5]! * KILL_SMOKE_INHERIT
    for (let k = 0; k < KILL_SMOKE_COUNT; k++) {
      coneDirection(0, 1, 0, Math.PI, e * KILL_SMOKE_COUNT + k, DIR)
      pool.emit(
        x, y, z,
        ivx + DIR.x * KILL_SMOKE_SPEED,
        ivy + DIR.y * KILL_SMOKE_SPEED,
        ivz + DIR.z * KILL_SMOKE_SPEED,
        KILL_SMOKE_SIZE,
      )
    }
  }
}

export function emitSmoke(
  pool: Particles, events: ImpactEvents, sizeScale = 1,
): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    pool.emit(d[o]!, d[o + 1]!, d[o + 2]!, 0, 0, 0, sizeScale)
  }
}
