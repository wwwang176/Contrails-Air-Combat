import {
  BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial,
} from 'three'
import { injectVertexAlpha } from './vortex'
import { TORPEDOES_CAPACITY } from '../world/torpedo'

/**
 * 魚雷的航跡 —— **貼著海面的一條白帶**。
 *
 * 【為什麼不是粒子】粒子連不起來，看起來是一點一點的圈圈（凝結尾解過同一
 * 個問題，見 `vortex.ts`）。粒子池是畫**團狀**東西的（煙、爆炸、水花）；
 * 航跡是一條**線**。水花仍然留著 —— 它負責線上的閃爍，帶子負責那條線。
 *
 * 【為什麼是平帶不是管】泡沫是浮在水面上的一層，管子有厚度、會有一半沉在
 * 水裡，而露出來的那半在遠處讀起來像一根白棍。
 *
 * 【高度每幀重算】`terrain.waterAt` 給的是**時間 0** 的浪高（那一支刻意
 * 不吃 time），拿它當節點高度的話，帶子會被真正在動的浪蓋掉一段一段的
 * ——那正是試飛看到的。所以節點只存 x/z，y 由 `step` 每幀用當下的時間問
 * 一次浪高場。
 *
 * 【頭端】正式節點每 6 m 才落一個，所以最新的節點永遠落後魚雷最多 6 m。
 * 少了頭端，帶子看起來是「一段一段長出來」的 —— `vortex.ts` 為同一個回報
 * 加過同一個東西。
 */

/** 節點的取樣間隔，m。直線航行只需要抓得住起點與終點，取樣可以很疏 */
export const WAKE_NODE_SPACING = 6

/**
 * 每一格的節點上限（含頭端佔的那一格）。
 *
 * 【要蓋得住看得見的那一段】22 m/s × 25 s = 550 m ÷ 6 m = 92 個。不夠的話
 * 尾端會在還沒淡完之前就被覆蓋，症狀是航跡被硬切一刀。
 */
export const WAKE_NODES = 96

/** 正式節點的容量。**比總數少一 —— 那一格留給頭端** */
export const WAKE_REAL_NODES = WAKE_NODES - 1

/**
 * 一個節點活多久，秒。**起始值，由試飛裁定。**
 *
 * 【它是一個戰術訊號】航跡指回投放的方向，所以它活多久就等於「被雷擊的
 * 那一方有多少時間反應」。
 */
export const WAKE_LIFE = 25

/** 剛翻起來的泡沫**半**寬，m */
export const WAKE_HALF_FROM = 1.1
/** 散開之後的半寬，m */
export const WAKE_HALF_TO = 3.6

/** 出生時的不透明度。半透明才看得出下面的海 */
export const WAKE_ALPHA = 0.55

/** 泡沫的顏色。比水花白一點 —— 它是被打散的空氣 */
export const WAKE_COLOR = 0xf4fbff

/**
 * 帶子浮在浪面之上多少，m。
 *
 * 【非有不可】與浪面同高的話兩者共面，深度精度會讓帶子一段一段閃爍。
 *
 * 【為什麼要 0.8 而不是勉強夠】浪面的網格是有限細分的，而 GPU 在頂點之間
 * 是線性內插 —— 浪谷處那條弦**高於**解析的正弦曲線。帶子照解析高度擺的話
 * 會在每一個浪谷沉到網格底下，症狀是一條**虛線**。0.8 m 蓋得過那個弦高差，
 * 而在最近的觀察距離上仍然看不出它浮著。
 */
export const WAKE_LIFT = 0.8

/** 一幀最多補幾個節點。分頁切回時 `dt` 會很大，不夾的話一幀補上千個 */
export const WAKE_MAX_PER_FRAME = 8

/**
 * 池子大小。**必須等於 `TORPEDOES_CAPACITY`** —— 航跡的格子就是魚雷的索引，
 * 少了的話索引超出的那幾枚沒有航跡，寫進別的陣列位置也不報錯。
 */
export const WAKE_SLOTS = TORPEDOES_CAPACITY

/**
 * 節點的不透明度。出生最濃、到壽命歸零。
 *
 * 【為什麼不是線性】線性之下尾端在 12 秒時還有 0.29 對頭端的 0.55 ——
 * 在深色的海面上那兩個讀起來一樣白，整條看起來像一根沒有方向的白棍。
 * 平方讓前三分之一就掉掉一半以上，於是「哪一端是新的」一眼就分得出來。
 */
export function wakeAlpha(age: number): number {
  if (!(age >= 0) || age >= WAKE_LIFE) return 0
  const k = 1 - age / WAKE_LIFE
  return WAKE_ALPHA * k * k
}

/** 節點的半寬，m。泡沫會散開 */
export function wakeHalfWidth(age: number): number {
  const k = age <= 0 ? 0 : age >= WAKE_LIFE ? 1 : age / WAKE_LIFE
  return WAKE_HALF_FROM + (WAKE_HALF_TO - WAKE_HALF_FROM) * k
}

/** 走了 `travelled` 公尺該落幾個節點 */
export function wakeEmitCount(travelled: number): number {
  return Math.floor(travelled / WAKE_NODE_SPACING)
}

/**
 * 一條帶子的索引緩衝。**建一次就不動。**
 *
 * 每一格擁有 `nodes × 2` 個**連續**頂點（左緣、右緣）；相鄰兩個節點之間
 * 兩個三角形。
 *
 * 【三角形一律落在同一格之內】跨過去的話會出現一條橫跨兩枚魚雷的白帶。
 */
export function ribbonIndices(slots: number, nodes: number): Uint32Array {
  const quads = slots * (nodes - 1)
  const idx = new Uint32Array(quads * 6)
  let k = 0
  for (let t = 0; t < slots; t++) {
    const base = t * nodes * 2
    for (let i = 0; i < nodes - 1; i++) {
      const a = base + i * 2
      const b = a + 2
      idx[k++] = a
      idx[k++] = b
      idx[k++] = b + 1
      idx[k++] = a
      idx[k++] = b + 1
      idx[k++] = a + 1
    }
  }
  return idx
}

export interface Wakes {
  object: Mesh
  /** 目前有幾個**正式**節點（不含頭端）。測試與 telemetry 用 */
  readonly live: number
  /**
   * 一枚魚雷的一幀。位置是**水面上**的點，不是雷體。
   *
   * @param id 這一枚的識別碼（`Torpedoes.serial`）。**一換就整條重來** ——
   *           池子的格子會重用，上一枚的航跡接到新的一枚身上會畫出一條橫跨
   *           半張海圖的線。格子超出範圍直接 return（不丟例外）。
   */
  emit(slot: number, x: number, z: number, id: number): void
  /**
   * 老化一幀並重寫頂點。**在渲染幀率呼叫，不在物理步。**
   *
   * @param heightAt 浪高場。**每個節點每幀問一次** —— 帶子要跟著浪起伏，
   *                 否則會被浪蓋掉
   */
  step(dt: number, time: number, heightAt: (x: number, z: number, t: number) => number): void
  /** 全部歸零，**含餘數與上一個位置**。換一場戰鬥時呼叫 */
  reset(): void
  dispose(): void
}

export function createWakes(slots: number = WAKE_SLOTS): Wakes {
  const total = slots * WAKE_NODES
  const nx = new Float32Array(total)
  const nz = new Float32Array(total)
  const nAge = new Float32Array(total)
  /** 這一格目前有幾個正式節點 */
  const count = new Uint16Array(slots)
  /** 環形緩衝的寫入位置 */
  const head = new Uint16Array(slots)
  /** 上次落點之後剩下的距離，m */
  const carry = new Float32Array(slots)
  /** 上一幀的位置 */
  const px = new Float32Array(slots)
  const pz = new Float32Array(slots)
  /** 這一格有沒有上一幀 */
  const seen = new Uint8Array(slots)
  /**
   * 上一幀是哪一枚。**Float64 而不是 Float32** —— 識別碼要逐位元比對，
   * 存進 Float32 會被捨入，比對的是捨入後的值
   */
  const lastId = new Float64Array(slots)
  /** 活動頭端：魚雷這一幀在哪裡。不進環形緩衝、不老化、不計入 `live` */
  const hx = new Float32Array(slots)
  const hz = new Float32Array(slots)
  const hasHead = new Uint8Array(slots)

  let liveNodes = 0

  const vertexCount = total * 2
  const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
  const alpha = new BufferAttribute(new Float32Array(vertexCount), 1)
  position.setUsage(DynamicDrawUsage)
  alpha.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', alpha)
  geometry.setIndex(new BufferAttribute(ribbonIndices(slots, WAKE_NODES), 1))

  const material = new MeshBasicMaterial({
    color: WAKE_COLOR,
    transparent: true,
    // 【不寫深度】帶子是貼在水面上的一層，會被自己的後半段擋住
    depthWrite: false,
    side: DoubleSide,
  })
  material.onBeforeCompile = injectVertexAlpha

  const object = new Mesh(geometry, material)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整條帶子會消失。與曳光彈、火花、粒子同一個坑
  object.frustumCulled = false

  const pos = position.array as Float32Array
  const alp = alpha.array as Float32Array

  /** 第 `j` 舊的正式節點在資料陣列裡的索引 */
  const slotOf = (slot: number, j: number): number =>
    slot * WAKE_NODES
    + (((head[slot]! - count[slot]! + j) % WAKE_NODES) + WAKE_NODES) % WAKE_NODES

  const pushNode = (slot: number, x: number, z: number): void => {
    const i = slot * WAKE_NODES + head[slot]!
    nx[i] = x
    nz[i] = z
    nAge[i] = 0
    head[slot] = (head[slot]! + 1) % WAKE_NODES
    // 【容量比總數少一】留最後一格給頭端，否則高速時頭端會被擠掉
    if (count[slot]! < WAKE_REAL_NODES) {
      count[slot] = count[slot]! + 1
      liveNodes++
    }
  }

  const cut = (slot: number): void => {
    liveNodes -= count[slot]!
    count[slot] = 0
    head[slot] = 0
    carry[slot] = 0
    seen[slot] = 0
    hasHead[slot] = 0
  }

  /** 有效節點的座標。`j < count` 是正式節點，`j === count` 是頭端 */
  const ringX = (slot: number, j: number): number =>
    j < count[slot]! ? nx[slotOf(slot, j)]! : hx[slot]!
  const ringZ = (slot: number, j: number): number =>
    j < count[slot]! ? nz[slotOf(slot, j)]! : hz[slot]!

  /**
   * 把一格寫成頂點。**節點不足兩個時整格塌到原點且 alpha 為 0** ——
   * 索引緩衝是固定的，不寫的話會留著上一次的頂點。
   */
  const write = (
    slot: number, time: number,
    heightAt: (x: number, z: number, t: number) => number,
  ): void => {
    const base = slot * WAKE_NODES * 2
    const n = count[slot]! + (hasHead[slot] === 1 ? 1 : 0)
    if (n < 2) {
      for (let v = 0; v < WAKE_NODES * 2; v++) {
        const o = (base + v) * 3
        pos[o] = 0
        pos[o + 1] = 0
        pos[o + 2] = 0
        alp[base + v] = 0
      }
      return
    }
    for (let j = 0; j < WAKE_NODES; j++) {
      // 【超出節點數的那幾格塌到最後一個上】它們之間的四邊形因此是零面積
      const jj = j < n ? j : n - 1
      const x = ringX(slot, jj)
      const z = ringZ(slot, jj)
      // 【橫向是水平的】帶子是平的，所以垂直於航向、且留在水平面上
      const a = jj === 0 ? 0 : jj - 1
      const b = jj === n - 1 ? n - 1 : jj + 1
      const dx = ringX(slot, b) - ringX(slot, a)
      const dz = ringZ(slot, b) - ringZ(slot, a)
      const len = Math.sqrt(dx * dx + dz * dz)
      // 退化（兩個節點同位置）時任取一個方向 —— 帶子在那裡寬度為零，看不到
      const sx = len > 1e-9 ? -dz / len : 1
      const sz = len > 1e-9 ? dx / len : 0
      // 【頭端的年齡是 0】它就是這一幀的位置
      const age = jj < count[slot]! ? nAge[slotOf(slot, jj)]! : 0
      const w = wakeHalfWidth(age)
      const al = j < n ? wakeAlpha(age) : 0
      const y = heightAt(x, z, time) + WAKE_LIFT
      const o0 = (base + j * 2) * 3
      pos[o0] = x + sx * w
      pos[o0 + 1] = y
      pos[o0 + 2] = z + sz * w
      pos[o0 + 3] = x - sx * w
      pos[o0 + 4] = y
      pos[o0 + 5] = z - sz * w
      alp[base + j * 2] = al
      alp[base + j * 2 + 1] = al
    }
  }

  return {
    object,
    get live() { return liveNodes },

    emit(slot, x, z, id) {
      if (!(slot >= 0) || slot >= slots) return
      // 【識別碼一換就是換了一枚】不能拿航程當身分：它每一枚都從 0 開始，
      // 只認得出「變小」。上一枚在近距離命中、只被畫到航程 0 就收掉時，
      // 下一枚的第一幀也是 0，兩條就接起來了
      if (id !== lastId[slot]!) cut(slot)
      lastId[slot] = id

      // 【頭端每幀都貼上去】不然帶子的前端永遠落後魚雷最多一個間隔，
      // 看起來像一段一段長出來的
      hx[slot] = x
      hz[slot] = z
      hasHead[slot] = 1

      if (seen[slot] === 0) {
        px[slot] = x
        pz[slot] = z
        seen[slot] = 1
        return
      }
      const dx = x - px[slot]!
      const dz = z - pz[slot]!
      const ox = px[slot]!
      const oz = pz[slot]!
      px[slot] = x
      pz[slot] = z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= 0) return
      const start = carry[slot]!
      const travelled = start + dist
      let n = wakeEmitCount(travelled)
      if (n >= WAKE_MAX_PER_FRAME) {
        // 【被夾住就把餘數丟掉】不丟的話 carry 逐幀累積、沒有上界
        n = WAKE_MAX_PER_FRAME
        carry[slot] = 0
      } else {
        carry[slot] = travelled - n * WAKE_NODE_SPACING
      }
      for (let k = 1; k <= n; k++) {
        const d = k * WAKE_NODE_SPACING - start
        const t = d <= 0 ? 0 : d >= dist ? 1 : d / dist
        pushNode(slot, ox + dx * t, oz + dz * t)
      }
    },

    step(dt, time, heightAt) {
      liveNodes = 0
      for (let slot = 0; slot < slots; slot++) {
        const n = count[slot]!
        if (n > 0) {
          // 【最舊的先過期】節點是依序落下的，所以年齡沿著 j 遞減
          let alive = 0
          for (let j = 0; j < n; j++) {
            const i = slotOf(slot, j)
            nAge[i] = nAge[i]! + dt
            if (nAge[i]! < WAKE_LIFE) alive++
          }
          if (alive < n) count[slot] = alive
          liveNodes += alive
        }
        write(slot, time, heightAt)
      }
      position.needsUpdate = true
      alpha.needsUpdate = true
    },

    reset() {
      nAge.fill(0)
      count.fill(0)
      head.fill(0)
      carry.fill(0)
      seen.fill(0)
      lastId.fill(0)
      hasHead.fill(0)
      liveNodes = 0
      pos.fill(0)
      alp.fill(0)
      position.needsUpdate = true
      alpha.needsUpdate = true
    },

    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
