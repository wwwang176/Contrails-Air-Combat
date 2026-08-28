import { createHeightField, type HeightFieldData } from './heightfield'

/**
 * 群島地形的生成器。
 *
 * 【為什麼島形是解析的，不用 noise 函式庫】決定性天然成立（沒有可變狀態）、
 * 沒有第三方相依。**起伏由好幾瓣同一條剖面取聯集做出來**，不是由噪聲場 ——
 * 兩瓣相交處 `max` 留下的摺線就是稜線，而那正是平面著色最吃得到的訊號。
 *
 * 【為什麼沒有 seed 參數】這一輪 `main.ts` 只有一種群島。公開一個沒有需求的
 * 擴充點，代價是它會長出「不同 seed 要不要不同」這種沒人回答得了的測試。
 * 真的要隨機地圖時再加。
 */

/** 高度場的邊長頂點數。1024 × 40 m = 40.92 km 見方 */
export const FIELD_SIZE = 1024
/**
 * 格距，m。
 *
 * 【40 是由三角形數推導的，不是調的】陸地三角形約 126k，而海面是 286,720
 * （近海 clipmap 253,952 加遠海 32,768）—— 地形因此約是海面的四成。20 m
 * 會變成海面的 1.8 倍，80 m 則讓 300 m 的小島只剩 3.75 格、塌成一團。
 *
 * 【它不影響 `sample` 的成本】雙線性插值是 O(1)。粗格省的是三角形。
 */
export const FIELD_CELL = 40

/**
 * 島的直徑下限，m。
 *
 * 40 m 格子下，直徑 300 m 是 7–8 格 —— 剛好長得出一塊有三四個面的礁石。
 * 再小就只剩兩三格，變成一團三角錐。
 */
export const ISLAND_MIN_DIAMETER = 300

/**
 * 峰高上限，m。
 *
 * 【上限訂在地形這一側，不是 AI 那一側】AI 的爬升率與轉彎半徑是物理，
 * 改不動；地形是設計，想怎麼擺都行。所以「AI 閃不掉」這件事的第一道防線
 * 是這個常數，不是讓 AI 更聰明。
 */
export const PEAK_MAX = 1000

/**
 * 島形 `wobble` 的最大值，也就是地形延伸到標稱半徑的幾倍。
 *
 * **這一行與下面 `WOBBLE_A`／`WOBBLE_B` 綁死** —— 1 + 0.18 + 0.11。
 * 動了振幅就要回來重算，否則 `outerRadius` 會小於地形實際的延伸範圍，
 * 而症狀是飛機撞到一片畫面上沒有的陸地。
 */
export const WOBBLE_MAX = 1.29
const WOBBLE_A = 0.18
const WOBBLE_B = 0.11

/**
 * 兩座島的膨脹圓之間至少要留的間隙，m。
 *
 * 【為什麼需要它】「左右有島、中間通得過」是這個地形要能成立的情境。
 * 兩座島的膨脹圓若貼在一起，AI 的圓盤判斷會認為沒有出路，於是去繞遠路或
 * 拉高 —— 而玩家看到的是一條明明飛得過去的水道。
 */
export const CHANNEL_MIN = 1500

/** 島心的散布半徑，m。場地半徑是 20.46 km，留邊避免島被切在邊界上 */
const SPREAD = 15000

/**
 * 沒有島的地方，地形的高度，m。**負的，而且要低於最深的波谷。**
 *
 * 【為什麼不是 0】`smoothstep` 在兩端的導數都是 0，所以島緣是一片**水平**
 * 的面。停在 y = 0 的話它與海面共面，症狀是整圈海岸線閃爍（z-fighting）。
 * 讓它沉到水下之後，海岸線變成「地形與海面的交線」—— 不共面，而且那正是
 * 真實海岸線的成因。
 *
 * 【−8 怎麼來的】五道波的振幅和是 4.673 m，最低的波谷是 −4.673。−8 保證
 * 島緣**永遠**在水下，餘裕 3.3 m。**動 WAVES 的振幅就要回來重算。**
 */
export const SEA_FLOOR = -8

/** 亂數的種子。私有 —— 見檔頭 */
const SEED = 20260827

/**
 * 浪花帶的寬度，m。5 格 —— 膨脹圖一個 texel 就是一格，再窄就沒有漸層可言。
 *
 * 【它不是水深，是離岸的距離】水線到 −5 m 這一段在錨島上只有 30 m 寬、
 * 小島上只有 13 m —— 比一個格子還窄，而且大島小島差兩倍多。拿水深當浪花的
 * 驅動會得到一條寬度隨島而異的髮絲。
 */
export const SHORE_BAND = 200

/**
 * 離岸的膨脹圖。**索引與 `HeightFieldData` 完全相同**（列優先、同一個
 * `size` 與 `cell`），所以世界座標換 texel 的算式只有一條。
 */
export interface ShoreFieldData {
  readonly size: number
  readonly cell: number
  /** `size²` 個 0–255。255 = 岸上或水線，0 = 帶外的深水 */
  readonly data: Uint8Array
}

/**
 * 一座島的一瓣。**島的高度是所有瓣取 max。**
 *
 * 【為什麼要公開】`ai/terrainSense.ts` 的爬升判斷要拿它算剖面。少了它那一層
 * 只知道「離島心多遠」，而偏心的次峰在那個模型裡是看不見的 —— 實測最多低估
 * 700 m，而症狀是 AI 認為爬得過去、然後撞上去。
 */
export interface LobeDesc {
  /** 瓣心的世界座標 */
  readonly cx: number
  readonly cz: number
  /** 瓣心離**島心**的距離，m。預算好的 —— AI 的剖面在熱路徑上讀它 */
  readonly offset: number
  /** 標稱半徑，m。地形延伸到 `radius × WOBBLE_MAX` */
  readonly radius: number
  readonly peak: number
  /** 這一瓣自己的 wobble 相位 */
  readonly pa: number
  readonly pb: number
}

export interface IslandDesc {
  readonly cx: number
  readonly cz: number
  /** 標稱半徑，m。高度剖面以它為尺 */
  readonly radius: number
  /**
   * 地形實際延伸到的半徑，m。**mesh 切它、視錐包圍球用它、AI 的圓盤也用它。**
   * 三個消費者共用同一個數字，就不會有人切得比別人小。
   */
  readonly outerRadius: number
  /**
   * **實際的最高點**，m，落在島心（主瓣的瓣心）。
   *
   * 其餘的瓣恆低於它（見 `LOBE_SLOPE`），所以多瓣不會讓島長過 `PEAK_MAX`。
   */
  readonly peak: number
  /** 主瓣排第一（`offset` 為 0），其餘是偏心的次峰 */
  readonly lobes: readonly LobeDesc[]
}

/**
 * 島的三個級距。**混合是專案負責人指定的**：少數大島當戰術核心，
 * 多數小島當景。
 */
const TIERS = [
  { count: 0, radius: [1300, 1600], peak: [800, PEAK_MAX] },
  { count: 6, radius: [500, 800], peak: [300, 500] },
  { count: 40, radius: [ISLAND_MIN_DIAMETER / 2, 260], peak: [60, 160] },
] as const

/**
 * 錨島：兩座**位置與尺寸都寫死**的山，夾在交會區兩側。
 *
 * ```
 *        z
 *        ↑        ● (−2400, 900)      島緣離原點 757 m
 *   ─────┼─────   通道 1,514 m         兩隊在這裡交會
 *        │   ● (2400, −900)
 * ```
 *
 * 【為什麼需要它們】戰場在原點附近，而隨機擺出來的地圖中心 4.7 km 內最高
 * 只有 362 m —— 那對 600 m 的飛機不構成障礙，AI 正確地直接飛過去。實測
 * 結果是地形感知在真實的仗裡**一次都沒跑到**。地形要進得了場，交會區就得
 * 有真正的山。
 *
 * 【為什麼是兩座而不是一座】一座山對一團會漂的纏鬥是開關式的結果：實測
 * 單座在 4v4~20v20 五種規模裡只有兩種會用到，而且其中一種繞的還是別的島。
 * 兩座之後四種會用到，**而且每一次繞的都是錨島**。
 *
 * 【兩座尺寸不同】相同的話「最高」與「最寬」會是同一座，而
 * `terrain-avoidance` 的飛行掃描以那兩者當代表 —— 192 組裡有 64 組會靜靜
 * 地變成重複。相位也不同，不然畫面上是兩座一模一樣的山。
 *
 * 【通道 1,608 m】在 `CHANNEL_MIN` 之上 —— 這正是那個常數當初設計的
 * 情境：「左右有島、中間通得過」。兩隊由 z = ±5,000 對頭進場，從中間穿過去，
 * 然後纏鬥在兩座山之間展開。
 *
 * 【為什麼不調 SEED 調到有兩座落在那裡】種子釣魚的結果沒有人看得懂，
 * 而且下一個動生成器的人會把它釣掉。
 *
 * 【它們取代 TIERS[0] 的兩席，不是追加】島數決定三角形數與 draw call。
 * `radius` 與 `peak` 都落在 tier-0 的區間內 —— 尺度上它們就是那兩座被換掉
 * 的島，所以 `TIERS[0].count` 是 0。
 *
 * 【peak 不貼 PEAK_MAX】上限是給隨機那一批的餘裕；寫死的這兩座貼著上限
 * 只是在跟自己的護欄擦邊。
 *
 * 【動了位置就要重量】高度、規模、繞島佔時三者互相牽動，見
 * `test/integration/terrain-in-play.test.ts`。
 */
const ANCHORS = [
  { cx: 2500, cz: -950, radius: 1400, peak: 900, pa: 0, pb: 0, seed: 11 },
  { cx: -2500, cz: 950, radius: 1500, peak: 850, pa: 2.1, pb: 4.3, seed: 29 },
] as const

/** 每座島最多試幾個位置。試不下就少放一座 —— 間距是硬約束，數量不是 */
const PLACE_TRIES = 300

/**
 * 主瓣之外每座島有幾瓣。**每座島都是這麼多瓣，沒有「抽到太小就丟掉」** ——
 * 半徑改成夾在 `LOBE_MIN_RADIUS` 之上，所以瓣數不是隨機的。
 *
 * 【為什麼不丟】丟的話最小的島（半徑 150 m）有約 9% 的機率只剩一瓣以下、
 * 1% 一瓣都不剩，而「這座島有沒有起伏」就變成一件測不準的事。
 */
const LOBE_COUNT = 4
/** 一瓣至少要有這麼大才畫得出形狀，m。1.5 格 —— 再小只是一個尖角 */
const LOBE_MIN_RADIUS = 60
/**
 * 瓣半徑佔島半徑的比例。
 *
 * 【上界為什麼不能再大】瓣要露得出來就得離島心夠遠，而放得下的最遠處是
 * `(1 − 半徑比) × outerRadius`。半徑比越大，能站的位置越靠內，而那裡的主瓣
 * 越高。0.62 的時候兩者剛好對撞：需要的峰高 0.92，而坡度上限只給到 0.93。
 * 0.45 讓可行區間寬到 0.43～0.90（見 `LOBE_SLOPE`）。
 */
const LOBE_RADIUS = [0.28, 0.45] as const
/** 瓣心的偏移佔「露得出來到放得下」那一段的比例。下界不為 0 —— 恰好露出來等於沒露 */
const LOBE_OFFSET = [0.35, 1.0] as const
/** 瓣高在（剛好露得出來，坡度上限）之間的位置。下界同理 */
const LOBE_PEAK_LO = 0.25
/**
 * 一瓣的最陡坡度是主瓣的幾倍。**沒有這一條，瓣可以又小又尖。**
 *
 * 【它守的是 `world/occlusion.ts` 的取樣步長】那一層的漏判是
 * `坡度 × 步長 / 2`。不封的話一顆半徑 0.28R、高 0.95P 的瓣坡度是今天最壞的
 * 三倍以上。封在 2.0 之後最壞是 4.79（今天是 2.37）—— 見那個檔案裡重寫過的
 * 說明，以及 `docs/backlog.md`。
 *
 * 【它與「瓣一定露得出來」不衝突】峰高的下界是主瓣在**最遠可放處**的高度
 * `rf²(3 − 2rf)`，上界是 `LOBE_SLOPE × rf`。rf ∈ [0.28, 0.45] 上兩者是
 * 0.19～0.43 對 0.56～0.90，差得很開。上界又恆 ≤ 0.90 < 1，所以 `peak`
 * 仍然是實際的最高點。
 */
const LOBE_SLOPE = 2.0

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** 一瓣的原始參數。**在挑位置之前抽好** —— 見 `createArchipelago` 的說明 */
interface LobeDraw {
  dir: number
  /** 半徑佔島半徑的比例，已經夾過 `LOBE_MIN_RADIUS` 之後才用得到島半徑 */
  rf: number
  /** 偏移佔「還放得下的最大偏移」的比例 */
  uOff: number
  /** 瓣高在（露得出來，坡度上限）之間的位置 */
  uPeak: number
  pa: number
  pb: number
}

/** 種子進、序列出。**不得 Math.random** —— 決定性是 replayDigest 的前提 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function drawLobes(rand: () => number): LobeDraw[] {
  const out: LobeDraw[] = []
  for (let i = 0; i < LOBE_COUNT; i++) {
    out.push({
      dir: rand() * Math.PI * 2,
      rf: LOBE_RADIUS[0] + rand() * (LOBE_RADIUS[1] - LOBE_RADIUS[0]),
      uOff: LOBE_OFFSET[0] + rand() * (LOBE_OFFSET[1] - LOBE_OFFSET[0]),
      uPeak: LOBE_PEAK_LO + rand() * (1 - LOBE_PEAK_LO),
      pa: rand() * Math.PI * 2,
      pb: rand() * Math.PI * 2,
    })
  }
  return out
}

/**
 * `smoothstep(1, 0, x) = s` 的反解，s ∈ [0, 1]。
 *
 * 【為什麼需要它】一瓣要露得出來，就得放在**主瓣已經降到這一瓣峰高以下**的
 * 半徑上。那就是在解剖面的反函數。三次式 `t²(3 − 2t) = s` 的實根有閉式解
 * `t = 0.5 − sin(asin(1 − 2s) / 3)`，而 `smoothstep(1, 0, x)` 的 `t` 是
 * `1 − x`，所以 `x = 1 − t`。
 *
 * 【為什麼不用二分法】閉式解沒有迭代次數這個可調參數，也就沒有「調到看起來
 * 對為止」的空間。
 */
function invSmoothstep(s: number): number {
  const c = Math.min(1, Math.max(0, s))
  return 0.5 + Math.sin(Math.asin(1 - 2 * c) / 3)
}

/**
 * 把原始參數換成落在世界裡的瓣。主瓣排第一。
 *
 * 【偏移由「還放得下多少」反推】`off = uOff × (outerRadius − r × WOBBLE_MAX)`，
 * 所以
 *
 * ```
 *   離島心的距離 ≤ off + 離瓣心的距離 ≤ off + r × wobble(θ) ≤ off + r × WOBBLE_MAX
 *                ≤ outerRadius
 * ```
 *
 * 是一條**恆等式**，不是一個要驗的條件。θ 由瓣心量起不影響這個推導。
 * `outerRadius` 因此不動 —— AI 的圓盤、mesh 的裁切、視錐包圍球全部照舊。
 */
function makeLobes(
  cx: number, cz: number, radius: number, outerRadius: number, peak: number,
  pa: number, pb: number, draws: readonly LobeDraw[],
): LobeDesc[] {
  const lobes: LobeDesc[] = [
    { cx, cz, offset: 0, radius, peak, pa, pb },
  ]
  for (const d of draws) {
    // 【夾在 LOBE_MIN_RADIUS 之上，不是丟掉】見 LOBE_COUNT
    const r = Math.max(LOBE_MIN_RADIUS, d.rf * radius)
    const rf = r / radius
    // 放得下的最遠處：off + r × WOBBLE_MAX = outerRadius，換成比例就是 1 − rf
    const xMax = 1 - rf
    // 【峰高先定，位置後定】下界是主瓣在**最遠可放處**的高度 —— 低於它的話
    // 這一瓣不論放哪裡都埋在主瓣底下，等於白抽。上界是坡度上限。
    // 兩者差得很開，見 LOBE_SLOPE
    const pfFloor = smoothstep(1, 0, xMax)
    const pf = pfFloor + d.uPeak * (LOBE_SLOPE * rf - pfFloor)
    // 主瓣降到 pf 的那個半徑 —— 再往外這一瓣就露出來了。
    // 【用 outerRadius 當尺】而不是這個方位真正的 radius × wobble：那樣會
    // 高估主瓣，所以「露得出來」只會更確定
    const xNeed = invSmoothstep(pf)
    const off = outerRadius * (xNeed + d.uOff * (xMax - xNeed))
    lobes.push({
      cx: cx + Math.cos(d.dir) * off,
      cz: cz + Math.sin(d.dir) * off,
      offset: off,
      radius: r,
      peak: pf * peak,
      pa: d.pa,
      pb: d.pb,
    })
  }
  return lobes
}

export function createArchipelago(): {
  field: HeightFieldData
  islands: readonly IslandDesc[]
} {
  const rand = makeRand(SEED)
  const between = (lo: number, hi: number): number => lo + rand() * (hi - lo)

  const field = createHeightField(FIELD_SIZE, FIELD_CELL)
  const islands: IslandDesc[] = []

  // 【錨島先進去，而且不碰主序列】位置、相位、瓣全部是常數 —— 瓣由**它們
  // 自己的**亂數序列抽（`seed`），所以後面加減幾次 rand() 都動不到它們。
  // 後面的島照舊 rejection sampling，並且要避開它
  for (const a of ANCHORS) {
    const outerRadius = a.radius * WOBBLE_MAX
    islands.push({
      cx: a.cx, cz: a.cz, radius: a.radius, outerRadius, peak: a.peak,
      lobes: makeLobes(a.cx, a.cz, a.radius, outerRadius, a.peak, a.pa, a.pb,
        drawLobes(makeRand(a.seed))),
    })
  }

  for (const tier of TIERS) {
    for (let n = 0; n < tier.count; n++) {
      const radius = between(tier.radius[0], tier.radius[1])
      const peak = between(tier.peak[0], tier.peak[1])
      const outerRadius = radius * WOBBLE_MAX
      // 【形狀先抽完，位置後挑】抽不抽得到位置都要抽，序列才不會因為
      // rejection 而漂。**瓣也是** —— 移到挑位置的迴圈裡的話，一座島試了
      // 幾次會決定下一座島長什麼樣，而那不會讓任何測試變紅
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      const draws = drawLobes(rand)

      for (let t = 0; t < PLACE_TRIES; t++) {
        const cx = (rand() - 0.5) * 2 * SPREAD
        const cz = (rand() - 0.5) * 2 * SPREAD
        let ok = true
        for (const o of islands) {
          const gap = Math.hypot(cx - o.cx, cz - o.cz) - outerRadius - o.outerRadius
          if (gap < CHANNEL_MIN) { ok = false; break }
        }
        if (!ok) continue
        islands.push({
          cx, cz, radius, outerRadius, peak,
          lobes: makeLobes(cx, cz, radius, outerRadius, peak, pa, pb, draws),
        })
        break
      }
    }
  }

  bake(field, islands)
  return { field, islands }
}

/**
 * 把島烘進高度場。
 *
 * 【只掃每座島的 bounding box】全圖是 1,048,576 個頂點，逐點對 48 座島算
 * 距離是五千萬次運算。逐島只掃自己的方框之後總量降到約五萬格。
 */
function bake(field: HeightFieldData, islands: readonly IslandDesc[]): void {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const last = size - 1
  // 海床先鋪滿。島是從這個高度長上來的，島緣也回到它 —— 見 SEA_FLOOR
  data.fill(SEA_FLOOR)

  for (let k = 0; k < islands.length; k++) {
    const isl = islands[k]!
    const c0 = Math.max(0, Math.floor((isl.cx - isl.outerRadius) / cell + half))
    const c1 = Math.min(last, Math.ceil((isl.cx + isl.outerRadius) / cell + half))
    const r0 = Math.max(0, Math.floor((isl.cz - isl.outerRadius) / cell + half))
    const r1 = Math.min(last, Math.ceil((isl.cz + isl.outerRadius) / cell + half))

    for (let row = r0; row <= r1; row++) {
      const z = (row - half) * cell
      const dz = z - isl.cz
      for (let col = c0; col <= c1; col++) {
        const x = (col - half) * cell
        const dx = x - isl.cx
        // 【島層級的早退仍然對】所有瓣都在膨脹圓之內 —— 見 makeLobes 的
        // 那條恆等式
        if (Math.hypot(dx, dz) > isl.outerRadius) continue

        // 【一座島 = 好幾瓣取 max】兩瓣相交處留下的摺線就是稜線。
        // 起點是海床，所以沒有任何瓣蓋到的格子仍然是 SEA_FLOOR
        let h = SEA_FLOOR
        for (const lo of isl.lobes) {
          const lx = x - lo.cx
          const lz = z - lo.cz
          const d = Math.hypot(lx, lz)
          if (d > lo.radius * WOBBLE_MAX) continue
          const theta = Math.atan2(lz, lx)
          const wobble = 1
            + WOBBLE_A * Math.sin(3 * theta + lo.pa)
            + WOBBLE_B * Math.sin(5 * theta + lo.pb)
          // s = 1 在瓣心、0 在瓣緣。瓣緣落回海床而不是 0，見 SEA_FLOOR
          const s = smoothstep(1, 0, d / lo.radius / wobble)
          const hl = lo.peak * s + SEA_FLOOR * (1 - s)
          if (hl > h) h = hl
        }

        const i = row * size + col
        // 取 max：島若重疊，高的那一座說了算。間距約束讓這件事不該發生，
        // 但取 max 保證即使發生也不會挖出一個洞
        if (h > data[i]!) data[i] = h
      }
    }
  }
}

/**
 * 離岸的**膨脹圖**：陸地是 255，往海裡 `SHORE_BAND` 公尺之內由 255 平滑降到 0。
 *
 * 【為什麼由高度場推，不由島的參數另外算】海岸線是好幾瓣聯集出來的，形狀
 * 沒有閉式解；而且島形以後怎麼改，這張圖自動跟著走。**兩份不可能漂。**
 *
 * 【兩趟 chamfer】正交 1、對角 √2，單位是格。近似誤差在 √2 那一支上約 4%，
 * 而這張圖的用途是「白點在這裡比較容易出現」—— 4% 落在一個 texel 之內。
 * 精確的歐氏距離要多兩趟，換不到任何看得見的東西。
 *
 * 【值域用 8 位元】1024² 是 1 MiB。用 Float32 是 4 MiB，而 256 階在一條
 * 5 格寬的漸層上遠遠夠用。
 */
export function bakeShore(field: HeightFieldData): ShoreFieldData {
  const { size, cell, data } = field
  const n = size * size
  const last = size - 1
  const dist = new Float32Array(n)
  // 陸地是 0，其餘是「還沒算過」。1e9 比任何真實距離都大，而且加得動
  // （Infinity + 1 還是 Infinity，比較時分不出誰先傳到）
  const FAR = 1e9
  for (let i = 0; i < n; i++) dist[i] = data[i]! >= 0 ? 0 : FAR
  const DIAG = Math.SQRT2

  // 正向：左上到右下。看得到的鄰居是上一列的三個與同列的左邊一個
  for (let row = 0; row <= last; row++) {
    for (let col = 0; col <= last; col++) {
      const i = row * size + col
      let v = dist[i]!
      if (v === 0) continue
      if (row > 0) {
        const up = i - size
        if (dist[up]! + 1 < v) v = dist[up]! + 1
        if (col > 0 && dist[up - 1]! + DIAG < v) v = dist[up - 1]! + DIAG
        if (col < last && dist[up + 1]! + DIAG < v) v = dist[up + 1]! + DIAG
      }
      if (col > 0 && dist[i - 1]! + 1 < v) v = dist[i - 1]! + 1
      dist[i] = v
    }
  }
  // 反向：右下到左上。少了這一趟，島的左上方沒有浪花
  for (let row = last; row >= 0; row--) {
    for (let col = last; col >= 0; col--) {
      const i = row * size + col
      let v = dist[i]!
      if (v === 0) continue
      if (row < last) {
        const dn = i + size
        if (dist[dn]! + 1 < v) v = dist[dn]! + 1
        if (col > 0 && dist[dn - 1]! + DIAG < v) v = dist[dn - 1]! + DIAG
        if (col < last && dist[dn + 1]! + DIAG < v) v = dist[dn + 1]! + DIAG
      }
      if (col < last && dist[i + 1]! + 1 < v) v = dist[i + 1]! + 1
      dist[i] = v
    }
  }

  const band = SHORE_BAND / cell
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, dist[i]! / band)
    out[i] = Math.round((1 - t * t * (3 - 2 * t)) * 255)
  }
  return { size, cell, data: out }
}
