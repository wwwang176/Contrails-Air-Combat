import {
  BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial,
} from 'three'
import { ringBasis, tubeIndices, tubeVertexCount, type RingBasis } from './tube'

/**
 * 翼尖凝結尾 —— **掃掠管**（spec §13）。
 *
 * 【物理依據】真機的翼尖渦凝結尾成因是翼尖低壓區把水氣凝出來，而低壓的
 * 強度跟著升力係數走 —— 也就是跟著 G 走。所以判準取 `|loadFactor|`。
 *
 * 【為什麼不是粒子】廣告板粒子連不起來，看起來是一點一點的圈圈。成因算得
 * 出來 —— `particles.ts`
 * 的著色器是 `smoothstep(0.5, 0.25, r)`，實心核心只有標稱直徑的一半：拉滿
 * 6.5 g 時剛出生的核心 0.80 m 對間隔 1.50 m，接不上；要到 1.0 s、直徑膨脹
 * 到 3.67 m 才連得起來，而那時 alpha 已經剩三成。要讓核心接上就得把間隔壓
 * 到 0.8 m 以下 —— 每秒 20,000 顆，池子直接爆掉。粒子池是畫**團狀**東西的
 * （煙、爆炸、水花）；凝結尾是一條**線**。
 *
 * 【三個通道各管各的】管子的透明度代表強度：
 *
 *   透明度 ← intensity（G）   真機的渦核直徑由機翼決定，G 改變的是凝不凝得出來
 *   半徑   ← 節點的年齡        渦會擴散，與 G 無關
 *   淡出   ← 節點的年齡
 *
 * 【為什麼管子畫好就不動】節點是「翼尖走過的位置」，釘在空中。所以索引
 * 緩衝建一次就好，每幀只把活著的那幾條的節點依序寫進它固定的那一段 ——
 * 沒有環形緩衝的接縫問題。
 */

/** 開始凝結的 G。平飛 1 g 與緩轉 2 g 完全乾淨。 */
export const VORTEX_G_ON = 3.0
/** 透明度拉滿的 G。兩機的持續轉彎大致落在 4–6 g。 */
export const VORTEX_G_FULL = 6.5

/**
 * 節點的取樣間隔，m。**常數** —— 不再隨 intensity 變（那是粒子版的事）。
 *
 * 管子是連續的，節點只需要抓得住**路徑的彎曲**。弦高誤差 `e ≈ L²/(8R)`：
 *
 *   200 m/s @ 6 g（半徑 680 m）→ 0.012 m
 *   120 m/s @ 6 g（半徑 245 m）→ 0.033 m
 *   100 m/s @ 7 g（半徑 146 m）→ 0.055 m   ← 最壞情形
 *
 * 對半徑 0.6–2.0 m 的管子完全看不出來。粒子版要 1.5 m 是為了讓圓形接得上，
 * 那個理由已經不存在。
 */
export const TRAIL_NODE_SPACING = 8

/**
 * 每一條尾跡在幾何裡佔幾個環。40 × 8 m = 320 m，略長於
 * 1.4 s × 200 m/s = 280 m。
 *
 * 【滿了覆蓋最舊的】環形緩衝，尾跡的**尾端先消失** —— 尾端本來就是最淡的
 * 一段。與 `particles.ts` 的覆蓋策略一致。
 */
export const TRAIL_NODES = 40

/**
 * 正式節點的容量。**比環數少一 —— 那一格是留給活動頭端的。**
 *
 * 【不留會斷頭】`writeTrail` 寫得下 `TRAIL_NODES` 環，而有效環數是
 * 「正式節點 + 頭端」。正式節點若佔滿全部 40 格，有效環數變成 41，頭端排在
 * 最後於是永遠輪不到 —— 管頭退回最新的正式節點，與翼尖差最多一個間隔，
 * 並隨取樣相位在 0 與 8 m 之間來回跳。
 *
 * 【只有俯衝拉起才踩得到，所以差點漏掉】緩衝要塞滿，得在 `TRAIL_LIFE`
 * 1.4 s 之內走完 39 × 8 = 312 m —— 228.6 m/s 以上。緩轉（120 m/s）只用得到
 * 21 格、200 m/s 也才 35 格，所以只有俯衝抬升那種速度才會斷頭。
 *
 * 【為什麼不是把 TRAIL_NODES 調大】調大只把門檻推到更高的速度，而俯衝速度
 * 沒有上界。留一格之後「有效環數 ≤ TRAIL_NODES」與速度無關。代價是尾跡的
 * 上限短 8 m。
 */
export const TRAIL_REAL_NODES = TRAIL_NODES - 1

/** 管的邊數。50 m 外看不出是方的；6 面貴 50%。 */
export const TRAIL_SIDES = 4

/** 節點的壽命，s。 */
export const TRAIL_LIFE = 1.4

/**
 * 剛生成的管半徑，m。
 *
 * 【0.2 是試飛定的】0.6 那個粗度太粗，兩個半徑一起收成三分之一。
 *
 * 【`DoubleSide` 讓實效不透明度加倍】視線穿過一條管子恆疊近側壁與遠側壁
 * 兩層，實效是 `1 − (1 − TRAIL_ALPHA)²`。調 `TRAIL_ALPHA` 時要記得這件事，
 * 否則會把「太白」誤判成參數選得不好。
 */
export const TRAIL_RADIUS_FROM = 0.2
/** 死亡時的管半徑，m。渦會擴散。同樣是 2.0 的三分之一。 */
export const TRAIL_RADIUS_TO = 0.65

/**
 * `intensity = 1` 時剛生成的不透明度 —— 整條管子最不透明的那一點。
 *
 * 【0.385 是試飛定的】由 0.55 打七折。經 `DoubleSide` 疊兩層之後實效
 * `1 − (1 − 0.385)² ≈ 0.62`。
 */
export const TRAIL_ALPHA = 0.385

/** 凝結尾的顏色。近白、略帶天空的藍。 */
export const TRAIL_COLOR = 0xeef4f8

/**
 * 每個翼尖每幀最多加幾個節點。**這是防爆閥，不是視覺參數。**
 *
 * 【它現在幾乎踩不到】`travelled < TRAIL_NODE_SPACING + VORTEX_MAX_STEP`
 * = 68 m，除以 8 最多 8 個 —— 剛好貼在上限。真正的上界是 `TRAIL_NODES` 的
 * 環形緩衝。留著是因為它不要錢，而且哪天有人調大 `MAX_STEP` 或調小間隔時
 * 它還在。
 */
export const VORTEX_MAX_PER_FRAME = 8

/**
 * 兩幀之間的位移上限，m。超過就只記錄、不加節點，並標記斷開。
 *
 * 擋的是換場、重生、接手、以及分頁切回來時的巨大 `dt` —— 否則會出現一條
 * 橫跨半個地圖的白管。200 m/s × 0.3 s = 60 m，比任何正常幀都寬得多。
 */
export const VORTEX_MAX_STEP = 60

/**
 * 座位數。每個座位兩條尾跡（左右翼尖）。
 *
 * 【為什麼不 import MAX_COMBATANTS】它住在 `src/battle/skirmish.ts`，而這個
 * 檔不得相依 `src/battle/`。64 對 20v20 的 40 個座位有 1.6 倍餘裕。兩個常數
 * 不准漂開由 `test/unit/vortex.test.ts` 守著 —— 跨層相依在測試裡是允許的。
 */
export const VORTEX_SEATS = 64

export function vortexIntensity(loadFactor: number): number {
  const g = Math.abs(loadFactor)
  if (g <= VORTEX_G_ON) return 0
  if (g >= VORTEX_G_FULL) return 1
  return (g - VORTEX_G_ON) / (VORTEX_G_FULL - VORTEX_G_ON)
}

/**
 * 累積到現在這麼多距離，該加幾個節點。
 *
 * 【`travelled` 是「上次加點後的餘數 + 這一幀的位移」，不是這一幀的位移】
 * 只吃這一幀位移的話，走不滿一個間隔的幀會被整幀丟掉 —— 粒子版實測那讓
 * 起效門檻從設計的 3 g 變成 3.93 g（200 m/s @ 60 fps）、5.80 g（120 m/s），
 * 而 120 fps 下永遠不出現。餘數累積讓「同一個動作在不同機器上長得一樣」。
 */
export function vortexEmitCount(travelled: number): number {
  return Math.min(Math.floor(travelled / TRAIL_NODE_SPACING), VORTEX_MAX_PER_FRAME)
}

/**
 * 把 three 的 `MeshBasicMaterial` 著色器改造成**逐頂點 alpha**。
 *
 * 【為什麼非得動著色器】`BufferGeometry` 的頂點色只有 RGB 沒有 alpha，而
 * 這條管子的淡出必須逐節點（尾端淡、頭端濃）。
 *
 * 【為什麼抽成獨立的具名函式】`String.replace` 找不到目標時**不報錯**。
 * 抽出來之後可以拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了 ——
 * 否則 three 改版重新命名 chunk，逐頂點 alpha 會靜靜地失效，管子變成一片
 * 不透明的白。與 `particles.ts` 的 `injectBillboard` 同一個理由。
 *
 * 【與 `injectBillboard` 不共用】那邊還要把四邊形在視圖空間攤平成廣告板，
 * 這邊不用 —— 管子是真的幾何。共用會是硬湊。
 */
export function injectVertexAlpha(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       #include <project_vertex>`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;`,
    )
    .replace(
      // 【接在 dithering 之後】霧在更前面（`fog_fragment`），所以霧先套 RGB、
      // 這裡再乘 alpha —— 順序正確。與 `injectBillboard` 挑同一個錨點。
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha;`,
    )
}

export interface Vortex {
  object: Mesh
  /**
   * 目前有幾個**節點**（含斷開處的退化節點）。測試與 telemetry 用。
   *
   * 【不是粒子數】這是掃掠管，`live` 數的是路徑上的取樣點。
   */
  readonly live: number
  /**
   * 一架飛機的一幀。`l*` / `r*` 是兩個翼尖的**世界座標**。
   *
   * 熱路徑：不配置。`index` 超出座位數直接 return（不丟例外）。
   */
  emit(
    index: number, loadFactor: number,
    lx: number, ly: number, lz: number,
    rx: number, ry: number, rz: number,
  ): void
  /** 老化一幀並重寫頂點。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  /** 全部歸零，**含上一幀的翼尖位置與餘數**。換一場戰鬥時呼叫。 */
  reset(): void
  dispose(): void
}

/** 環上各側面的 cos / sin。`TRAIL_SIDES` 是常數，算一次就好。 */
const COS = new Float32Array(TRAIL_SIDES)
const SIN = new Float32Array(TRAIL_SIDES)
for (let s = 0; s < TRAIL_SIDES; s++) {
  const a = (s / TRAIL_SIDES) * Math.PI * 2
  COS[s] = Math.cos(a)
  SIN[s] = Math.sin(a)
}

/** 模組私有的暫存。熱路徑：不配置。 */
const BASIS: RingBasis = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }

export function createVortex(seats: number = VORTEX_SEATS): Vortex {
  /** 尾跡條數：每個座位左右各一。 */
  const trails = seats * 2

  // ── 節點資料（每條一段連續的 TRAIL_NODES 格，環形緩衝）──
  const nx = new Float32Array(trails * TRAIL_NODES)
  const ny = new Float32Array(trails * TRAIL_NODES)
  const nz = new Float32Array(trails * TRAIL_NODES)
  const nAge = new Float32Array(trails * TRAIL_NODES)
  /** 生成當下的不透明度（`TRAIL_ALPHA × intensity`）。0 = 退化節點。 */
  const nAlpha0 = new Float32Array(trails * TRAIL_NODES)
  /** 這一條目前有幾個節點。 */
  const count = new Uint16Array(trails)
  /** 環形緩衝的寫入位置。 */
  const head = new Uint16Array(trails)
  /** 下一個節點是否為新的一段（要先補兩個退化節點）。 */
  const broken = new Uint8Array(trails).fill(1)
  /** 上次加點之後剩下的距離，m。 */
  const carry = new Float32Array(trails)
  /** 這一條的頂點是不是還需要再寫一次（用來省下「本來就空」的重寫）。 */
  const dirty = new Uint8Array(trails)

  // ── 活動頭端 ──
  /**
   * **每幀重寫**的頭端，永遠貼在當下的翼尖上。
   *
   * 【為什麼需要它】正式節點每 `TRAIL_NODE_SPACING`（8 m）才落一個，所以
   * 最新的正式節點永遠落後翼尖最多 8 m —— 沒有頭端的話，管子會在飛機飛出
   * 一段距離之後才出現，與飛機之間留一個距離差。
   *
   * 頭端不進環形緩衝、不計入 `live`、也不會老化 —— 它只是「這一幀翼尖在
   * 哪裡」，滿 8 m 之後才由 `advance` 固化成正式節點。
   */
  const hx = new Float32Array(trails)
  const hy = new Float32Array(trails)
  const hz = new Float32Array(trails)
  /** 頭端的不透明度（＝當下的 `TRAIL_ALPHA × intensity`）。 */
  const hAlpha = new Float32Array(trails)
  /** 這一條這一幀有沒有頭端。**斷開中的那一條不可以有** —— 見 `advance`。 */
  const hasHead = new Uint8Array(trails)

  // ── 每個座位的上一幀翼尖位置（左 xyz、右 xyz）──
  const prev = new Float32Array(seats * 6)
  /** 這個座位有沒有上一幀。第一幀不加節點。 */
  const seen = new Uint8Array(seats)

  let liveNodes = 0

  // ── 幾何 ──
  const vertexCount = tubeVertexCount(trails, TRAIL_NODES, TRAIL_SIDES)
  const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
  const alpha = new BufferAttribute(new Float32Array(vertexCount), 1)
  position.setUsage(DynamicDrawUsage)
  alpha.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', alpha)
  geometry.setIndex(new BufferAttribute(
    tubeIndices(trails, TRAIL_NODES, TRAIL_SIDES), 1,
  ))

  const material = new MeshBasicMaterial({
    color: TRAIL_COLOR,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  material.onBeforeCompile = injectVertexAlpha

  const object = new Mesh(geometry, material)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整條管子會消失。與曳光彈、火花、粒子同一個坑。
  object.frustumCulled = false

  const pos = position.array as Float32Array
  const alp = alpha.array as Float32Array

  /** 第 `j` 舊的節點在資料陣列裡的索引。 */
  const slotOf = (trail: number, j: number): number =>
    trail * TRAIL_NODES
    + (((head[trail]! - count[trail]! + j) % TRAIL_NODES) + TRAIL_NODES) % TRAIL_NODES

  const pushNode = (
    trail: number, x: number, y: number, z: number, a0: number,
  ): void => {
    const i = trail * TRAIL_NODES + head[trail]!
    nx[i] = x
    ny[i] = y
    nz[i] = z
    nAge[i] = 0
    nAlpha0[i] = a0
    head[trail] = (head[trail]! + 1) % TRAIL_NODES
    // 【容量比環數少一】留最後一格給活動頭端，否則高速時頭端會被擠掉
    if (count[trail]! < TRAIL_REAL_NODES) {
      count[trail] = count[trail]! + 1
      liveNodes++
    }
    dirty[trail] = 1
  }

  /**
   * 把頭端貼到當下的翼尖上。**斷開中的那一條不給頭端** —— 它的最後一個
   * 正式節點屬於上一段，接上去就是一條穿過缺口的管子。
   */
  const attachHead = (
    trail: number, x: number, y: number, z: number, a0: number,
  ): void => {
    if (broken[trail] === 1) {
      hasHead[trail] = 0
      return
    }
    hx[trail] = x
    hy[trail] = y
    hz[trail] = z
    hAlpha[trail] = a0
    hasHead[trail] = 1
    dirty[trail] = 1
  }

  /** 在一條線段上加節點。`trail` 是尾跡編號（座位 × 2 + 左右）。 */
  const advance = (
    trail: number,
    px: number, py: number, pz: number,
    x: number, y: number, z: number,
    a0: number,
  ): void => {
    const dx = x - px
    const dy = y - py
    const dz = z - pz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > VORTEX_MAX_STEP) {
      // 換場／重生／分頁切回：這一段軌跡整段放棄，下一段要重新開始
      carry[trail] = 0
      broken[trail] = 1
      hasHead[trail] = 0
      dirty[trail] = 1
      return
    }
    const start = carry[trail]!
    const travelled = start + dist
    let n = vortexEmitCount(travelled)
    if (n >= VORTEX_MAX_PER_FRAME) {
      // 【被防爆閥夾住就把餘數丟掉】不丟的話 carry 會逐幀累積、沒有上界
      n = VORTEX_MAX_PER_FRAME
      carry[trail] = 0
    } else {
      carry[trail] = travelled - n * TRAIL_NODE_SPACING
    }

    if (n === 0) {
      // 這一幀還走不滿一個間隔：沒有新的正式節點，但頭端照樣要跟上翼尖。
      // 【`broken` 時不給頭端】那條尾跡的最後一個正式節點屬於**上一段**，
      // 頭端接上去就會畫出一條穿過缺口的管子 —— 那正是兩個退化節點要避免
      // 的事。等真的落下新一段的正式節點之後才給。
      attachHead(trail, x, y, z, a0)
      return
    }

    // 第 k 個節點在線段上的位置比例。`start` 是「已經走過但還沒取樣」的那段。
    // 【要夾在 [0,1]】斷開之後 `start` 可能大於這一幀的位移，弧長會是負的。
    const along = (k: number): number => {
      const d = k * TRAIL_NODE_SPACING - start
      return d <= 0 ? 0 : (d >= dist ? 1 : d / dist)
    }

    if (broken[trail] === 1) {
      broken[trail] = 0
      // 【兩個退化節點】一個在舊尾巴、一個在新段的起點，alpha 都是 0。
      // 三個銜接帶因此全部不可見：舊尾→退化@舊位置（零長度）、
      // 退化→退化（兩端 alpha 都是 0）、退化@新位置→新頭（零長度）。
      // 只用一個的話中間那帶會是 a→0 的漸層，在缺口上留一道淡痕。
      pushNode(trail, px, py, pz, 0)
      const t0 = along(1)
      pushNode(trail, px + dx * t0, py + dy * t0, pz + dz * t0, 0)
    }

    for (let k = 1; k <= n; k++) {
      const t = along(k)
      pushNode(trail, px + dx * t, py + dy * t, pz + dz * t, a0)
    }
    attachHead(trail, x, y, z, a0)
  }

  /** 有效環的 X 座標。`j < count` 是正式節點，`j === count` 是活動頭端。 */
  const ringX = (trail: number, j: number): number =>
    j < count[trail]! ? nx[slotOf(trail, j)]! : hx[trail]!
  const ringY = (trail: number, j: number): number =>
    j < count[trail]! ? ny[slotOf(trail, j)]! : hy[trail]!
  const ringZ = (trail: number, j: number): number =>
    j < count[trail]! ? nz[slotOf(trail, j)]! : hz[trail]!

  /**
   * 把一條尾跡寫成頂點。
   *
   * 有效環 = `count` 個正式節點（最舊 → 最新）＋ 可有可無的活動頭端。
   * 之後的環全部塌到**最後一個有效環**的位置、半徑 0、alpha 0 ——
   * 零長度、零面積的帶畫不出東西。塌到「第一個」的話，環 `used−1`
   * （最新、alpha 最高）與環 `used` 之間會連出一條**從管頭回到管尾**的
   * 320 m 長錐，而且不會有任何測試紅。
   */
  /**
   * 這一幀被 `writeTrail` 碰過的頂點區間 `[vLo, vUp)`。
   *
   * 【為什麼在 `writeTrail` 當下累積，而不是事後掃 `dirty`】`step` 在
   * 「本幀剛清空」那一支寫完零頂點之後**立刻**把 `dirty[t]` 清成 0。事後掃
   * 會漏掉那一條，於是 GPU 只收到別條尾跡的區間，已死的尾跡殘留在畫面上。
   */
  let vLo = vertexCount
  let vUp = 0

  const writeTrail = (trail: number): void => {
    const v0 = trail * TRAIL_NODES * TRAIL_SIDES
    if (v0 < vLo) vLo = v0
    if (v0 + TRAIL_NODES * TRAIL_SIDES > vUp) vUp = v0 + TRAIL_NODES * TRAIL_SIDES
    const c = count[trail]!
    const used = c + (hasHead[trail] === 1 ? 1 : 0)
    const base = trail * TRAIL_NODES * TRAIL_SIDES * 3
    const abase = trail * TRAIL_NODES * TRAIL_SIDES
    const ex = used > 0 ? ringX(trail, used - 1) : 0
    const ey = used > 0 ? ringY(trail, used - 1) : 0
    const ez = used > 0 ? ringZ(trail, used - 1) : 0

    for (let j = 0; j < TRAIL_NODES; j++) {
      let cx = ex
      let cy = ey
      let cz = ez
      let radius = 0
      let a = 0
      if (j < used) {
        cx = ringX(trail, j)
        cy = ringY(trail, j)
        cz = ringZ(trail, j)
        if (j < c) {
          const s = slotOf(trail, j)
          const u = nAge[s]! / TRAIL_LIFE
          a = nAlpha0[s]! * (1 - u)
          // 【退化節點的半徑也要是 0】`nAlpha0 === 0` 就是退化節點的記號。
          // 不收半徑的話，它與相鄰的正式環同位置、不同半徑，會連出一片
          // 扁平的環形貼片（alpha 由邊緣漸層到 0）。收成 0 之後那一帶是
          // 一個零長度的錐 —— 讀起來是把管口封起來的軟端蓋。
          radius = a > 0 ? TRAIL_RADIUS_FROM + (TRAIL_RADIUS_TO - TRAIL_RADIUS_FROM) * u : 0
        } else {
          // 活動頭端：永遠是最新的，年齡 0
          a = hAlpha[trail]!
          radius = TRAIL_RADIUS_FROM
        }
        // 管軸：前後兩個有效環的差；端點用單側差分
        const p = j > 0 ? j - 1 : j
        const q = j < used - 1 ? j + 1 : j
        ringBasis(
          ringX(trail, q) - ringX(trail, p),
          ringY(trail, q) - ringY(trail, p),
          ringZ(trail, q) - ringZ(trail, p),
          BASIS,
        )
      } else {
        ringBasis(0, 0, 0, BASIS)
      }
      for (let s = 0; s < TRAIL_SIDES; s++) {
        const co = COS[s]! * radius
        const si = SIN[s]! * radius
        const o = base + (j * TRAIL_SIDES + s) * 3
        pos[o] = cx + BASIS.ax * co + BASIS.bx * si
        pos[o + 1] = cy + BASIS.ay * co + BASIS.by * si
        pos[o + 2] = cz + BASIS.az * co + BASIS.bz * si
        alp[abase + j * TRAIL_SIDES + s] = a
      }
    }
  }

  return {
    object,
    get live() { return liveNodes },

    emit(index, loadFactor, lx, ly, lz, rx, ry, rz): void {
      if (index < 0 || index >= seats) return
      const b = index * 6
      const tL = index * 2
      const tR = tL + 1
      const intensity = vortexIntensity(loadFactor)
      if (intensity > 0 && seen[index] === 1) {
        const a0 = TRAIL_ALPHA * intensity
        advance(tL, prev[b]!, prev[b + 1]!, prev[b + 2]!, lx, ly, lz, a0)
        advance(tR, prev[b + 3]!, prev[b + 4]!, prev[b + 5]!, rx, ry, rz, a0)
      } else {
        // 【沒在冒尾跡就把餘數歸零並標記斷開】飛機照樣在飛，但那一段軌跡
        // 沒有渦 —— 不標記的話重新拉起來時會接到上一段的尾巴上，畫出一條
        // 穿過中間的管子。
        carry[tL] = 0
        carry[tR] = 0
        broken[tL] = 1
        broken[tR] = 1
        // 頭端也要收掉：G 掉回門檻以下之後，管子應該停在最後一個正式節點
        if (hasHead[tL] === 1) { hasHead[tL] = 0; dirty[tL] = 1 }
        if (hasHead[tR] === 1) { hasHead[tR] = 0; dirty[tR] = 1 }
      }
      // 【門檻以下也要記錄位置】不記的話，從緩轉切進硬拉的第一幀會拿到
      // 很久以前的位置，拉出一條長管。
      prev[b] = lx
      prev[b + 1] = ly
      prev[b + 2] = lz
      prev[b + 3] = rx
      prev[b + 4] = ry
      prev[b + 5] = rz
      seen[index] = 1
    },

    step(dt: number): void {
      let touched = false
      for (let t = 0; t < trails; t++) {
        const c = count[t]!
        if (c === 0 && hasHead[t] === 0) {
          // 【本來就空、而且上一幀已經寫乾淨了就跳過】整場只有幾架在拉 G，
          // 其餘一百多條不該每幀重寫 160 個頂點
          if (dirty[t] === 1) {
            writeTrail(t)
            dirty[t] = 0
            touched = true
          }
          continue
        }
        // 老化，再從**最舊**那一端退休。**必須是 while** —— 分頁切回來的
        // 巨大 dt 會讓好幾個節點同時到期
        for (let j = 0; j < c; j++) {
          const s = slotOf(t, j)
          nAge[s] = nAge[s]! + dt
        }
        let alive = c
        while (alive > 0 && nAge[slotOf(t, c - alive)]! >= TRAIL_LIFE) alive--
        if (alive !== c) {
          liveNodes -= c - alive
          count[t] = alive
        }
        writeTrail(t)
        dirty[t] = 1
        touched = true
      }
      if (touched) {
        // 單位是型別化陣列的元素：位置一個頂點三個 float，alpha 一個
        position.addUpdateRange(vLo * 3, (vUp - vLo) * 3)
        alpha.addUpdateRange(vLo, vUp - vLo)
        position.needsUpdate = true
        alpha.needsUpdate = true
      }
      vLo = vertexCount
      vUp = 0
    },

    reset(): void {
      count.fill(0)
      head.fill(0)
      broken.fill(1)
      carry.fill(0)
      hasHead.fill(0)
      nAge.fill(0)
      nAlpha0.fill(0)
      seen.fill(0)
      liveNodes = 0
      pos.fill(0)
      alp.fill(0)
      dirty.fill(0)
      // 【要先清區間】上一幀累積的區間若還沒被 render 消費掉，這裡整條重寫
      // 卻只傳那一段，畫面會留著上一場的管子
      position.clearUpdateRanges()
      alpha.clearUpdateRanges()
      vLo = vertexCount
      vUp = 0
      position.needsUpdate = true
      alpha.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
    },
  }
}
