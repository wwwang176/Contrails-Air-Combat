import {
  AdditiveBlending, Color, NormalBlending, SRGBColorSpace, Vector3, type Texture,
} from 'three'
import { FIRE_CHUNK_SIZE } from './chunks'
import { createParticles, type Particles } from './particles'
import { coneDirection } from './scatter'
import {
  SMOKE_ALPHA, SMOKE_DRAG, SMOKE_GRAVITY, SMOKE_LIFE, SMOKE_LIFE_JITTER,
  SMOKE_SIZE_FROM, SMOKE_SIZE_TO,
} from './smoke'
import { pushImpact, type ImpactEvents } from '../world/events'

/**
 * 炸彈落地的爆炸 —— **組成規則**，不是粒子系統本身。
 *
 * 【它為什麼獨立於 `World`】一次爆炸是五種既有粒子的一組配方，而配方是設計
 * 值：顆數、初速、噴出的錐角、尺寸倍率。把它寫成參數表，`blast.html` 那個
 * 展示區才調得動，而遊戲接上去時走的是同一支 `emitBlast`。
 *
 * 【目前沒有任何遊戲程式呼叫它】接進 `World.onBombImpact` 是另一件事 ——
 * 那要先決定傷害，見 `docs`。
 */

/**
 * 一種爆炸的配方。
 *
 * 【為什麼每一種粒子都有自己的錐角】火球是往上竄的一團、塵土是往外掀的一圈
 * ——同一個角度做不出兩者的差別。
 */
export interface BlastParams {
  /** 火球顆數 */
  fireCount: number
  /** 火球初速，m/s */
  fireSpeed: number
  /** 火球尺寸倍率。1 = `FIREBALL_SIZE_FROM`／`TO` 那一組（一架飛機的擊墜） */
  fireSize: number
  /** 火球噴出的錐半角，rad。軸恆是世界上方 */
  fireCone: number
  smokeCount: number
  smokeSpeed: number
  smokeSize: number
  smokeCone: number
  /** 揚塵。落水恆為 0 */
  dustCount: number
  dustSpeed: number
  dustSize: number
  dustCone: number
  /** 水霧。墜地恆為 0 */
  sprayCount: number
  spraySpeed: number
  sprayCone: number
  /** 水柱根數。墜地恆為 0 */
  jetCount: number
  /** 水柱離爆點多遠，m。一根柱子太細，用一圈換規模 */
  jetSpread: number
  /**
   * 光暈的尺寸，佔火球直徑的倍率。**0 = 不畫光暈。**
   *
   * 【它是加法混合的圓片，不是光源】不會照亮地面或旁邊的飛機，只是在畫面
   * 上那個位置加一片亮色。真的照明要走後製 bloom 或動態光源。
   */
  glowSize: number
  /** 光暈出生時的不透明度 */
  glowAlpha: number
}

/**
 * 整個爆炸的快慢 —— **壽命倍率**，火球、塵、煙三個池一起吃。
 *
 * 【為什麼不在 `BlastParams` 裡】它不是發射時的參數，是**建池**時的：粒子
 * 池的壽命在 `createParticles` 就固定了。改它要重建池，所以它是
 * `createFireChunks`／`createDust`／`createBlastSmoke` 的引數。
 *
 * 【0.6 是什麼】火球 0.85 s、塵 3.2 s、煙 2.5 s 各乘 0.6 —— 0.51 / 1.92 /
 * 1.5 s。**由專案負責人在展示區調定。**
 */
export const BLAST_PACE = 0.6

/**
 * 墜地。**起始值，由試飛裁定。**
 *
 * 【塵比火多】500 lb 落在土地上，看得最久的是那一團土 —— 火球 0.5 s 就沒了。
 *
 * 【尺度的量尺是樹】針葉樹 `TREE_HEIGHT` 是 30 m。火球的團徑要與一棵樹相當
 * （真實的 500 lb 是 25–30 m）。初速就是為此 —— 團的大小由「單塊尺寸 +
 * 擴散」決定，光放大單塊只會糊成一坨。
 *
 * 【塵與煙都不得大過火球】爆炸是主角。塵團比火球寬的話，畫面上讀到的是
 * 一團土裡面有一點火。
 */
export const LAND_BLAST: BlastParams = {
  fireCount: 10,
  fireSpeed: 55,
  fireSize: 2.2,
  fireCone: (75 * Math.PI) / 180,
  smokeCount: 31,
  smokeSpeed: 21,
  smokeSize: 2.9,
  smokeCone: (75 * Math.PI) / 180,
  dustCount: 22,
  dustSpeed: 12,
  dustSize: 0.8,
  dustCone: (58 * Math.PI) / 180,
  sprayCount: 0,
  spraySpeed: 0,
  sprayCone: 0,
  jetCount: 0,
  jetSpread: 0,
  glowSize: 1.5,
  glowAlpha: 0.55,
}

/**
 * 落水。**起始值，由試飛裁定。**
 *
 * 【火球留一點點】水面爆炸的火在一瞬間就被壓熄，但那一下黃光是「這是爆炸不是
 * 掉東西」的唯一線索 —— 全關掉的話與濺水長得一樣。
 */
export const WATER_BLAST: BlastParams = {
  fireCount: 5,
  fireSpeed: 15,
  fireSize: 1.2,
  fireCone: (35 * Math.PI) / 180,
  smokeCount: 6,
  smokeSpeed: 7,
  smokeSize: 1.6,
  smokeCone: (30 * Math.PI) / 180,
  dustCount: 0,
  dustSpeed: 0,
  dustSize: 0,
  dustCone: 0,
  sprayCount: 60,
  spraySpeed: 30,
  sprayCone: (52 * Math.PI) / 180,
  jetCount: 7,
  jetSpread: 7,
  glowSize: 1.2,
  glowAlpha: 0.4,
}

/**
 * 當量 → **線性尺度倍率**。`LAND_BLAST`／`WATER_BLAST` 的基準是 1
 * （AN-M64，500 lb）。
 *
 * 【立方根律】爆炸相似律（Hopkinson–Cranz）：火球半徑與持續時間都正比於
 * 當量的立方根。八倍的裝藥只有兩倍大 —— 這不是美術上的取捨，是真的。
 *
 * ```
 *   250 lb    0.5×    尺度 0.79
 *   500 lb    1.0×    尺度 1.00     ← 基準
 *  1000 lb    2.0×    尺度 1.26
 *  2000 lb    4.0×    尺度 1.59
 * ```
 */
export function blastScale(yieldRatio: number): number {
  return Math.cbrt(Math.max(0, yieldRatio))
}

/**
 * 把配方縮放到某個當量，就地寫進 `out`。**放大公式的全部規則在這裡。**
 *
 * ```
 *   尺寸   × s      單顆粒子的直徑、水柱的散佈半徑
 *   顆數   × s      維持覆蓋率：整團的投影面積 ∝ s²，而每顆也大了 s
 *   初速   不變     相似律下質點速度與當量無關；擴散距離 = 速度 × 時間，
 *                   而時間也 ∝ s，所以團徑自己就 ∝ s
 *   錐角   不變     形狀不隨大小改變
 * ```
 *
 * 【時間不在這裡】粒子的壽命是**建池**時決定的，所以 `pace` 要另外乘：
 * `createFireChunks(cap, BLAST_PACE * s, …)`。那也是 `s` 同一個值。
 *
 * 【顆數為 0 的保持 0】墜地沒有水霧、落水沒有揚塵 —— 那是種類的差別，
 * 不該被當量放大成 1 顆。
 */
export function scaleBlast(
  src: BlastParams, yieldRatio: number, out: { -readonly [K in keyof BlastParams]: number },
): void {
  const s = blastScale(yieldRatio)
  const n = (v: number): number => (v === 0 ? 0 : Math.max(1, Math.round(v * s)))
  out.fireCount = n(src.fireCount)
  out.fireSpeed = src.fireSpeed
  out.fireSize = src.fireSize * s
  out.fireCone = src.fireCone
  out.smokeCount = n(src.smokeCount)
  out.smokeSpeed = src.smokeSpeed
  out.smokeSize = src.smokeSize * s
  out.smokeCone = src.smokeCone
  out.dustCount = n(src.dustCount)
  out.dustSpeed = src.dustSpeed
  out.dustSize = src.dustSize * s
  out.dustCone = src.dustCone
  out.sprayCount = n(src.sprayCount)
  out.spraySpeed = src.spraySpeed
  out.sprayCone = src.sprayCone
  out.jetCount = n(src.jetCount)
  out.jetSpread = src.jetSpread * s
  // 【光暈是比例，不吃當量】它跟著火球的直徑走，而那已經乘過 s 了
  out.glowSize = src.glowSize
  out.glowAlpha = src.glowAlpha
}

/** 揚塵的壽命，s。比黑煙短 —— 土會落下 */
export const DUST_LIFE = 3.2
export const DUST_LIFE_JITTER = 0.3
export const DUST_SIZE_FROM = 4
/**
 * 死亡直徑，m。
 *
 * 【上界是火球，而且要明顯小】塵比爆炸本身大的話，讀起來是「一團土裡面
 * 有一點火」—— 主角變成配角。火球的團徑約 30 m；這裡乘上配方的 0.8 倍
 * 之後單顆 11 m，散開之後約 16 m，是火球的一半。
 */
export const DUST_SIZE_TO = 14
/**
 * 往上，m/s²。
 *
 * 【土在爆炸的頭三秒是被熱氣帶著上升的】它確實會落下，但那是幾十秒的事。
 * 負值會讓塵在 10 m 內煞停，成為一塊貼在地上的餅。
 */
export const DUST_GRAVITY = 2
/** 終端上升速度 = gravity / drag。1.15 之下是 1.7 m/s，柱子撐得住三秒 */
export const DUST_DRAG = 1.15
export const DUST_ALPHA = 0.72
/** 一次墜地 24 顆，池子夠十幾次同時活著 */
export const DUST_CAPACITY = 512

/** 深咖啡色。**由專案負責人裁定** —— 原本的沙土色在綠地上讀起來像煙不像土 */
const DUST_YOUNG = { r: 0.30, g: 0.19, b: 0.11 }
const DUST_OLD = { r: 0.16, g: 0.10, b: 0.06 }

/**
 * 年齡比例 → 塵土的顏色。
 *
 * 【為什麼不沿用黑煙】土是暖色的，而黑煙整條曲線都是中性灰 —— 兩者疊在
 * 同一次爆炸上時，差別正是「地面被掀起來」與「東西在燒」。
 *
 * 【色標是 sRGB，所以要指定色彩空間】`setRGB` 預設寫的是線性值，火球與黑煙
 * 都為此踩過同一個坑。
 */
export function dustColor(t: number, out: Color): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  out.setRGB(
    DUST_YOUNG.r + (DUST_OLD.r - DUST_YOUNG.r) * k,
    DUST_YOUNG.g + (DUST_OLD.g - DUST_YOUNG.g) * k,
    DUST_YOUNG.b + (DUST_OLD.b - DUST_YOUNG.b) * k,
    SRGBColorSpace,
  )
}

export function createDust(
  capacity: number = DUST_CAPACITY, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: DUST_LIFE * pace,
    lifeJitter: DUST_LIFE_JITTER,
    sizeFrom: DUST_SIZE_FROM,
    sizeTo: DUST_SIZE_TO,
    gravity: DUST_GRAVITY,
    drag: DUST_DRAG,
    alphaFrom: DUST_ALPHA,
    shadeJitter: DUST_SHADE,
    riseSpan: DUST_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: dustColor,
  })
}

/** 逐顆的亮度衰減幅度。0.5 = 0.5×~1×。見 `particleShade` */
export const BLAST_SMOKE_SHADE = 0.5
export const DUST_SHADE = 0.45

/**
 * 高度明暗：升到這麼高算「頂」，m。
 *
 * 【煙比塵高】煙的終端上升是 3 m/s、塵只有 1.7 m/s —— 兩者能爬的高度不同，
 * 量尺也就不同。用同一個值的話，塵永遠停在梯度底端、整團一律暗。
 */
export const BLAST_SMOKE_RISE_SPAN = 22
export const DUST_RISE_SPAN = 12
/** 底與頂的亮度落差。0.5 = 底 0.5×、頂 1×（見 `particleRiseShade`：只變暗） */
export const BLAST_RISE_RANGE = 0.5

/**
 * 煙出生時的顏色 —— **幾乎純黑**，接的是燒完的火球那一刻的顏色。
 */
const SMOKE_BORN = { r: 0.03, g: 0.03, b: 0.028 }
/**
 * 煙轉完之後的顏色 —— 兩層明暗都只往暗走，所以這是**最亮的那一顆**。
 *
 * ```
 *   基色        0.19          頂端受光的那幾顆
 *   隨機層 ×    0.5 – 1.0
 *   高度層 ×    0.5 – 1.0
 *   最暗        ≈ 0.048
 *   平均        ≈ 0.11        `SMOKE_COLOR` 是 0.10
 * ```
 *
 * 【不用 `SMOKE_COLOR`】那一支是飛機的拖煙，一條沒有重疊的細線，愈黑愈讀
 * 得出來。0.10 之下明暗的絕對差只有幾個色階，團內看不出前後。
 */
const SMOKE_AGED = { r: 0.19, g: 0.185, b: 0.175 }
/** 黑轉深灰佔壽命的比例 */
const SMOKE_WARM = 0.35

/**
 * 年齡比例 → 爆炸煙的顏色。**黑 → 深灰。**
 *
 * 【出生是黑的】火球燒到最後幾乎純黑，煙在同一個位置接手 —— 出生就是深灰
 * 的話，交棒那一刻會亮一下。
 */
export function blastSmokeColor(t: number, out: Color): void {
  const k = t <= 0 ? 0 : t >= SMOKE_WARM ? 1 : t / SMOKE_WARM
  out.setRGB(
    SMOKE_BORN.r + (SMOKE_AGED.r - SMOKE_BORN.r) * k,
    SMOKE_BORN.g + (SMOKE_AGED.g - SMOKE_BORN.g) * k,
    SMOKE_BORN.b + (SMOKE_AGED.b - SMOKE_BORN.b) * k,
    SRGBColorSpace,
  )
}

/**
 * 爆炸專用的黑煙池。
 *
 * 【為什麼不共用 `createSmoke`】那一支是飛機的拖煙與擊墜煙，壽命是寫死的
 * `SMOKE_LIFE`。爆炸要能整組調快調慢（`pace`），而池的壽命是建構時決定的
 * —— 共用就等於連飛機的拖煙一起改。其餘每一個參數都直接引用同一組常數。
 */
export function createBlastSmoke(
  capacity = 2048, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: SMOKE_LIFE * pace,
    lifeJitter: SMOKE_LIFE_JITTER,
    sizeFrom: SMOKE_SIZE_FROM,
    sizeTo: SMOKE_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    shadeJitter: BLAST_SMOKE_SHADE,
    riseSpan: BLAST_SMOKE_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: blastSmokeColor,
  })
}

/**
 * 火轉煙的那一批 —— **每一塊火球淡出時在原地留下的一顆煙**。
 *
 * 【為什麼不能用 `createBlastSmoke`】那一支是配方裡的 `smokeCount` 那批，
 * 尺寸從 2 長到 9（四倍半）。這裡的煙要**一出生就等於那一塊火球的直徑**，
 * 所以 `sizeFrom` 是 1（呼叫端把直徑直接當倍率傳進來），而且只長到 2.2 倍
 * ——用四倍半的曲線接手，煙會比原本的火球大四倍。
 *
 * 【壽命比配方的煙短】它接的是火，不是爆炸的煙柱。
 */
export const EMBER_LIFE = 1.4
export const EMBER_SIZE_FROM = 1
export const EMBER_SIZE_TO = 2.2
export const EMBER_CAPACITY = 1024

/**
 * 一塊火球交棒給幾顆煙。**專案負責人裁定 3。**
 *
 * 【一顆的話煙團的結構等於火球的結構】十塊換十顆，重疊的方式一模一樣。
 * 三顆散開的小煙互相交錯才是「一團」而不是「一顆」。
 */
export const EMBER_PER_CHUNK = 3
/** 三顆散開多遠，佔火球直徑的比例 */
export const EMBER_SPREAD = 0.32
/** 每一顆的尺寸，佔火球直徑的比例。三顆加起來才蓋得住原本那一塊 */
export const EMBER_SIZE = 0.72
/** 垂直方向的散開壓扁多少。爆炸的煙團是扁的，不是球 */
export const EMBER_FLATTEN = 0.6

export function createEmberSmoke(
  capacity = EMBER_CAPACITY, pace = 1, alphaMap?: Texture,
): Particles {
  return createParticles({
    capacity,
    alphaMap,
    blending: NormalBlending,
    life: EMBER_LIFE * pace,
    lifeJitter: SMOKE_LIFE_JITTER,
    sizeFrom: EMBER_SIZE_FROM,
    sizeTo: EMBER_SIZE_TO,
    gravity: SMOKE_GRAVITY,
    drag: SMOKE_DRAG,
    alphaFrom: SMOKE_ALPHA,
    shadeJitter: BLAST_SMOKE_SHADE,
    riseSpan: BLAST_SMOKE_RISE_SPAN,
    riseRange: BLAST_RISE_RANGE,
    color: blastSmokeColor,
  })
}

/**
 * 一塊火球淡出時的交棒 —— 在原地放 `EMBER_PER_CHUNK` 顆散開的煙。
 *
 * 【方向由 slot 決定】與整個專案其他所有隨機同一條紀律：純函數、重播可
 * 重現（`coneDirection` 依索引取方向）。
 *
 * @param slot 火球那一格的索引，由 `ChunkConfig.onFade` 給
 * @param d    那一塊當下的直徑，m
 */
export function emitEmber(
  pool: Particles, slot: number,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number, d: number,
): void {
  const r = EMBER_SPREAD * d
  for (let k = 0; k < EMBER_PER_CHUNK; k++) {
    // 半角 π = 整個球面
    coneDirection(0, 1, 0, Math.PI, slot * 31 + k, DIR)
    pool.emit(
      x + DIR.x * r, y + DIR.y * r * EMBER_FLATTEN, z + DIR.z * r,
      vx, vy, vz, d * EMBER_SIZE,
    )
  }
}

/**
 * 火球的光暈 —— **加法混合的圓片**，疊在球塊上。
 *
 * 【加法混合】背後的顏色**加上**橘光，而不是被換掉 —— 讀起來是光而不是
 * 一片橘色的塑膠。代價是明亮的背景（天空 0.6–0.8）會把它吃掉，襯著地面
 * 與海面才明顯。
 *
 * 【壽命比球塊短】火還在燒的時候熱輝最亮，球塊還沒消失光就已經退掉了。
 */
export const GLOW_LIFE_RATIO = 0.6
/** 出生／死亡直徑，相對火球的峰值直徑 */
export const GLOW_SIZE_FROM = FIRE_CHUNK_SIZE * 0.9
export const GLOW_SIZE_TO = FIRE_CHUNK_SIZE * 1.5
export const GLOW_CAPACITY = 512

const GLOW_HOT = { r: 1.0, g: 0.46, b: 0.14 }
const GLOW_MID = { r: 0.72, g: 0.16, b: 0.03 }
const GLOW_OUT = { r: 0.0, g: 0.0, b: 0.0 }

/**
 * 年齡比例 → 光暈的顏色。橘 → 暗紅 → 黑。
 *
 * 【收到黑】加法混合下黑等於沒加，所以顏色與 alpha 兩條線同時把它關掉。
 */
export function fireGlowColor(t: number, out: Color): void {
  let a = GLOW_HOT
  let b = GLOW_MID
  let k = 0
  if (t <= 0.45) {
    k = t / 0.45
  } else {
    a = GLOW_MID
    b = GLOW_OUT
    k = Math.min(1, (t - 0.45) / 0.55)
  }
  out.setRGB(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    SRGBColorSpace,
  )
}

export function createFireGlow(
  capacity = GLOW_CAPACITY, pace = 1, life = 0.85, alphaFrom = 0.55,
): Particles {
  return createParticles({
    capacity,
    blending: AdditiveBlending,
    life: life * GLOW_LIFE_RATIO * pace,
    sizeFrom: GLOW_SIZE_FROM,
    sizeTo: GLOW_SIZE_TO,
    gravity: 3,
    drag: 3.2,
    alphaFrom,
    color: fireGlowColor,
  })
}

export interface BlastPools {
  fireball: Particles
  smoke: Particles
  dust: Particles
  spray: Particles
  /** 水柱的事件通道。呼叫端每幀餵給 `Splashes.emit` —— 與 `World` 同一條路 */
  splashEvents: ImpactEvents
  /** 火球的光暈。省略 = 不畫 */
  glow?: Particles | undefined
}

/** 模組私有的暫存。熱路徑：不配置 */
const DIR = new Vector3()

/**
 * 噴一次。
 *
 * @param seed 方向的序號起點。**同一個 seed 逐位元噴出同一組方向** ——
 *             `coneDirection` 由索引決定方向，與專案其他隨機同一條紀律。
 */
export function emitBlast(
  pools: BlastPools, p: BlastParams,
  x: number, y: number, z: number, seed: number,
): void {
  // 【四種粒子各自從 seed 的不同段取索引】共用同一段的話，火球第 3 顆與
  // 塵土第 3 顆會朝完全相同的方向，畫面上是一條並排的雙軌
  emitCone(pools.fireball, p.fireCount, p.fireSpeed, p.fireCone, p.fireSize, x, y, z, seed)
  // 【光暈與火球同一段 seed】方向必須逐顆對齊，光暈才貼在球塊上而不是
  // 散在它旁邊
  if (pools.glow !== undefined && p.glowSize > 0) {
    emitCone(pools.glow, p.fireCount, p.fireSpeed, p.fireCone,
      p.fireSize * p.glowSize, x, y, z, seed)
  }
  emitCone(pools.smoke, p.smokeCount, p.smokeSpeed, p.smokeCone, p.smokeSize,
    x, y, z, seed + 1013)
  emitCone(pools.dust, p.dustCount, p.dustSpeed, p.dustCone, p.dustSize,
    x, y, z, seed + 2027)
  emitCone(pools.spray, p.sprayCount, p.spraySpeed, p.sprayCone, 1,
    x, y, z, seed + 3041)

  // 【水柱排成一圈而不是疊在一點】`splashSize` 依池格給高低粗細，五根散開
  // 讀起來是一圈掀起來的水；疊在同一點只是一根比較亮的柱子
  for (let n = 0; n < p.jetCount; n++) {
    const a = (n / p.jetCount) * Math.PI * 2
    pushImpact(
      pools.splashEvents,
      x + Math.cos(a) * p.jetSpread, y, z + Math.sin(a) * p.jetSpread,
      0, 1, 0,
    )
  }
}

function emitCone(
  pool: Particles, count: number, speed: number, cone: number, size: number,
  x: number, y: number, z: number, seed: number,
): void {
  for (let k = 0; k < count; k++) {
    coneDirection(0, 1, 0, cone, seed + k, DIR)
    pool.emit(x, y, z, DIR.x * speed, DIR.y * speed, DIR.z * speed, size)
  }
}
