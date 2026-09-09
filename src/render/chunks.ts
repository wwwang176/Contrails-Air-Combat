import {
  Color, DynamicDrawUsage, IcosahedronGeometry, InstancedBufferAttribute,
  InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SRGBColorSpace, Vector3,
} from 'three'
import { hash01 } from './scatter'
import type { Particles } from './particles'
import type { Anchors } from './anchors'

/**
 * 不透明的低面數球塊 —— 廣告板圓片的替代品，同一個 `Particles` 介面。
 *
 * 【與圓片的差別】圓片恆正對相機、靠 alpha 淡出；球塊有體積、面與面之間有
 * 明暗差，而且**畫得出黑** —— 加法混合的圓片做不到（`dst + 0` 等於沒加）。
 *
 * 【不透明】半透明球體要逐實例排序，而 `InstancedMesh` 做不到；球有明確
 * 輪廓，互相穿插會閃。圓片沒事是因為 `depthWrite` 關著、顏色又幾乎相同。
 *
 * 【消失】尾段淡出，見 `chunkAlpha`。
 */

/** 二十面體的細分。0 = 20 面，一個塊看得出稜就夠 */
const DETAIL = 0

/**
 * 膨脹佔壽命的比例。0.85 s 的壽命下 0.08 是 68 ms。
 *
 * 【瞬間】爆炸的膨脹是衝擊波那一下，之後火球不再長大。拉長會讀成一顆被
 * 吹起來的氣球。
 */
export const CHUNK_GROW = 0.08
/** 出生時的直徑佔峰值的比例 */
export const CHUNK_SEED = 0.3
/** 脹滿之後還會慢慢長這麼多。熱氣一直在膨脹 */
export const CHUNK_CREEP = 0.15
/**
 * 開始淡出的年齡比例。
 *
 * 【短】淡出中的球塊互相穿插時看得見彼此的稜線，讀起來像玻璃；0.75 之後
 * 整團已經是黑的，那一段看不出來。
 */
export const CHUNK_FADE = 0.75

/**
 * 年齡比例 → 直徑佔峰值的比例。**瞬間脹到滿，之後只微微續脹。**
 *
 * 【不收縮】火球是燒完之後淡掉、位置交給煙，消失由 `chunkAlpha` 負責。
 * 收縮會讀成一顆被吸回去的氣球，而且轉黑那一段會同時縮成一個小點，顏色
 * 的變化就看不到了。
 */
export function chunkScale(t: number): number {
  if (t <= 0) return CHUNK_SEED
  if (t <= CHUNK_GROW) return CHUNK_SEED + (1 - CHUNK_SEED) * (t / CHUNK_GROW)
  const k = Math.min(1, (t - CHUNK_GROW) / (1 - CHUNK_GROW))
  return 1 + CHUNK_CREEP * k
}

/**
 * 年齡比例 → 不透明度。**尾段淡出，位置交給煙。**
 *
 * 【排序誤差限縮在這一段】球塊互相穿插的錯誤只在 `alpha < 1` 時存在，而
 * 那時整團已經是黑的。不透明的那 75% 仍然逐塊正確遮擋。
 */
export function chunkAlpha(t: number): number {
  if (t <= CHUNK_FADE) return 1
  return Math.max(0, 1 - (t - CHUNK_FADE) / (1 - CHUNK_FADE))
}

/**
 * 這一格**顏色走完曲線的快慢**。1 = 剛好在壽命結束時走到黑。
 *
 * 【只影響顏色】尺寸、淡出、交棒仍然共用同一條時間軸 —— 分開的話整團會散。
 *
 * 【上界 > 1】超過 1 的那幾塊提早燒到全黑，然後停在黑色。整團同時變黑讀
 * 起來是一個物件在換色，不是十幾塊各自燒完的火。
 */
export function chunkColorRate(slot: number): number {
  return 0.65 + hash01(slot * 0x27d4eb2f) * 0.9
}

/**
 * 這一格的自轉軸與角速度。
 *
 * 【為什麼由格子索引決定】與 `particleLife`、`coneDirection` 同一條紀律：
 * 純函數才測得起來，而且重播可重現。
 */
export function chunkSpin(slot: number, out: Vector3): number {
  const a = hash01(slot * 0x9e3779b1) * Math.PI * 2
  const b = hash01(slot * 0x85ebca6b) * 2 - 1
  const r = Math.sqrt(Math.max(0, 1 - b * b))
  out.set(r * Math.cos(a), b, r * Math.sin(a))
  return 1.2 + hash01(slot * 0xc2b2ae35) * 3.4
}

/**
 * 把 `MeshBasicMaterial` 的著色器加一層**固定方向的假光照**。
 *
 * 【為什麼不用 MeshLambertMaterial】火球是自發光的：夜間的關卡光照會把它
 * 壓成暗紅色的一團，而爆炸在夜裡本來就該是畫面上最亮的東西。假光照只取
 * 法線的仰角，與場景光無關。
 *
 * 【為什麼一定要有明暗差】平塗的不透明多面體是一個剪影 —— 十幾個疊起來
 * 會糊成一坨，看不出是幾塊。面與面之間的亮度差正是「這是 3D 塊」的來源。
 *
 * 【抽成具名函式】`String.replace` 找不到目標時不報錯，所以測試拿 three
 * 真正的 `ShaderLib.basic` 斷言注入確實發生（同 `injectBillboard`）。
 */
export function injectFacetShade(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;
       varying vec3 vFacetN;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       vFacetN = normalize(mat3(instanceMatrix) * normal);
       #include <project_vertex>`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying vec3 vFacetN;`,
    )
    // 【alpha 要在 alphahash 之前寫進 diffuseColor】three 的
    // `<alphahash_fragment>` 讀的是 `diffuseColor.a`。寫到 `gl_FragColor.a`
    // 已經太晚 —— 那要材質 `transparent`，而那條路會遮住後面的煙
    .replace(
      '#include <alphatest_fragment>',
      `diffuseColor.a *= vAlpha;
       #include <alphatest_fragment>`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       // 朝上的面亮、朝下的面暗。範圍 0.5…1.15 —— 上限超過 1 是為了讓
       // 頂面在白熱那一段真的過曝
       gl_FragColor.rgb *= 0.5 + 0.65 * (0.5 + 0.5 * vFacetN.y);`,
    )
}

export interface ChunkConfig {
  capacity: number
  /** 壽命，s */
  life: number
  /** 峰值直徑，m */
  size: number
  /** 加速度，m/s² */
  gravity: number
  /** 指數阻尼，s⁻¹ */
  drag: number
  /** 年齡比例 → 顏色 */
  /**
   * 年齡比例 → 顏色。
   *
   * @param slot 池格索引。要逐顆不同的顏色時用它當種子 —— 與
   *             `chunkSpin`、`chunkColorRate` 同一條紀律
   */
  color(t: number, out: Color, slot: number): void
  /**
   * 一塊**開始淡出**時呼叫一次，帶著它當下的位置、速度與直徑。
   *
   * 【時機是開始淡出，不是死亡】煙生在還不透明的火球**裡面**，被火擋著看
   * 不見；火一淡就從同一個位置露出來。等火死透才生的話，中間有一格是空的。
   *
   * @param d    這一刻的直徑，m。煙接手時用它當尺寸倍率
   * @param slot 池格索引。**接手的那幾顆要散開，而散開的方向必須是確定性
   *             的** —— 這是唯一可以拿來當種子的東西
   */
  onFade?: ((
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, d: number, slot: number,
  ) => void) | undefined
}

/** 一次墜地十幾塊，池子夠十幾次同時活著 */
export const FIRE_CHUNK_CAPACITY = 256
export const FIRE_CHUNK_LIFE = 0.85
/**
 * 峰值直徑，m。
 *
 * 【比圓片的 8 m 小】不透明的塊互相遮擋，同樣的顆數看起來比圓片密得多 ——
 * 一樣大的話整團會糊成一顆爆米花，看不出是幾塊組成的。
 */
export const FIRE_CHUNK_SIZE = 7
/** 火球往上飄。熱氣本來就上升 */
export const FIRE_CHUNK_GRAVITY = 3
export const FIRE_CHUNK_DRAG = 3.2

const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const AXIS = new Vector3()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)
/** 錨點的變換。熱路徑：每幀每顆吸附的球塊一次 */
const ANCHOR_POS = new Vector3()
const ANCHOR_QUAT = new Quaternion()

export function createChunks(cfg: ChunkConfig): Particles {
  const { capacity, life } = cfg
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  /** 起始年齡無限大 = 一出生就是死的。與 `createParticles` 同一個手法 */
  const age = new Float32Array(capacity).fill(Infinity)
  const sizeMul = new Float32Array(capacity).fill(1)
  const zeroed = new Uint8Array(capacity).fill(1)
  /** 這一格的 `onFade` 已經叫過了。每一塊只交棒一次 */
  const faded = new Uint8Array(capacity).fill(1)
  /**
   * 這一格吸附在哪一個錨點上，−1 = 自由飛（見 `anchors.ts`）。
   *
   * 吸附時 `px/py/pz` 與 `vx/vy/vz` 存的是**錨點的區域座標**。
   */
  const anchor = new Int32Array(capacity).fill(-1)
  let next = 0
  let live = 0

  // 半徑 0.5 —— 於是縮放值就是直徑，與圓片那一支同一套單位
  const geometry = new IcosahedronGeometry(0.5, DETAIL)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  alphas.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aAlpha', alphas)

  /**
   * 【淡出走 alpha hash，不走 `transparent`】三種畫法的後果：
   *
   * ```
   *   transparent + depthWrite    淡出中的球照樣寫深度 → 把後面的煙挖掉一個洞
   *   transparent + !depthWrite   不透明那 75% 的球塊之間失去遮擋，稜線互相穿插
   *   alphaHash                   隨機丟棄片段，深度緩衝全程正確
   * ```
   *
   * 代價是淡出那一段有雜點：0.51 s 壽命的最後 25%（130 ms），而且那時整團
   * 已經是黑的。
   */
  const material = new MeshBasicMaterial({ color: 0xffffff })
  material.alphaHash = true
  material.onBeforeCompile = injectFacetShade

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整批會一起消失。與圓片、曳光彈、火花同一個坑
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(0, 0, 0))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  return {
    object,
    get live() { return live },

    emit(x, y, z, evx, evy, evz, sizeScale = 1, attach = -1): void {
      const i = next
      next = next + 1 >= capacity ? 0 : next + 1
      if (age[i]! >= life) live++
      zeroed[i] = 0
      faded[i] = 0
      // 【每一次發射都要寫】環形緩衝繞回同一格時不寫的話，新的自由球塊會
      // 繼承上一顆的錨點，然後跟著一個毫不相干的物件跑
      anchor[i] = attach
      px[i] = x
      py[i] = y
      pz[i] = z
      vx[i] = evx
      vy[i] = evy
      vz[i] = evz
      sizeMul[i] = sizeScale
      age[i] = 0
    },

    step(dt: number, anchors?: Anchors): void {
      const damp = Math.exp(-cfg.drag * dt)
      const a = alphas.array as Float32Array
      live = 0
      let touched = false
      for (let i = 0; i < capacity; i++) {
        let old = age[i]!
        const at = anchor[i]!
        // 【錨點不在了就當場收掉】不收的話球塊會掛在最後那個變換上燒完
        // 剩下的壽命 —— 畫面上是空中一團無主的火。
        // 【查得到的錨點在這裡就寫進 ANCHOR_*】下面組世界座標時直接用
        const held = at >= 0 && old < life
          && anchors !== undefined && anchors.frame(at, ANCHOR_POS, ANCHOR_QUAT)
        if (at >= 0 && !held) {
          old = Infinity
          age[i] = Infinity
        }
        if (old >= life) {
          if (zeroed[i] === 1) continue
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          a[i] = 0
          zeroed[i] = 1
          touched = true
          continue
        }
        const na = old + dt
        age[i] = na
        if (na >= life) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          a[i] = 0
          zeroed[i] = 1
          touched = true
          continue
        }
        live++
        touched = true

        const nvx = vx[i]! * damp
        const nvy = vy[i]! * damp + cfg.gravity * dt
        const nvz = vz[i]! * damp
        vx[i] = nvx
        vy[i] = nvy
        vz[i] = nvz
        const nx = px[i]! + nvx * dt
        const ny = py[i]! + nvy * dt
        const nz = pz[i]! + nvz * dt
        px[i] = nx
        py[i] = ny
        pz[i] = nz

        const t = na / life
        const s = cfg.size * sizeMul[i]! * chunkScale(t)
        const rate = chunkSpin(i, AXIS)
        POS.set(nx, ny, nz)
        // 【吸附的球塊在這裡才組回世界座標】上面那一段積分走的是錨點的
        // 區域座標，所以噴出的方向會跟著錨點轉
        if (held) POS.applyQuaternion(ANCHOR_QUAT).add(ANCHOR_POS)
        SCALE.set(s, s, s)
        M.compose(POS, ROT.setFromAxisAngle(AXIS, na * rate), SCALE)
        object.setMatrixAt(i, M)

        // 【顏色走自己的速度】見 `chunkColorRate`
        cfg.color(Math.min(1, t * chunkColorRate(i)), TINT, i)
        object.setColorAt(i, TINT)
        a[i] = chunkAlpha(t)

        if (cfg.onFade !== undefined && faded[i] === 0 && t >= CHUNK_FADE) {
          faded[i] = 1
          cfg.onFade(nx, ny, nz, nvx, nvy, nvz, s, i)
        }
      }
      if (touched) {
        object.instanceMatrix.needsUpdate = true
        alphas.needsUpdate = true
        if (object.instanceColor) object.instanceColor.needsUpdate = true
      }
    },

    reset(): void {
      age.fill(Infinity)
      faded.fill(1)
      live = 0
      next = 0
      const a = alphas.array as Float32Array
      M.compose(ZERO, ROT.identity(), ZERO)
      for (let i = 0; i < capacity; i++) {
        if (zeroed[i] === 1) continue
        object.setMatrixAt(i, M)
        a[i] = 0
        zeroed[i] = 1
      }
      object.instanceMatrix.needsUpdate = true
      alphas.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}

/**
 * 四個色標：紅 → 深紅 → 焦紅 → 黑。數值是 **sRGB**。
 *
 * 【與 `fireballColor` 的差別】那一支是擊墜的火球，走白熱 → 橘 → 暗紅，白
 * 與橘佔了前六成 —— 讀起來是一團橘色的火。**炸彈落地要的是一顆紅球逐漸
 * 轉黑**，所以白熱壓到只剩開頭一瞬，其餘全部給紅到黑那一段。
 *
 * 【白熱為什麼不整個拿掉】爆炸的頭幾十毫秒確實是白的，而 0.85 s 的壽命下
 * 0.08 就是 68 ms —— 拿掉的話球是憑空出現的一顆紅色，少了「炸開」那一下。
 *
 * 【紅之後是連續往下走的】中間停在定紅不動的話，讀起來是一顆紅色的橡皮球
 * 突然轉黑。**要的是整顆球一路暗下去**。
 */
const FLASH = { r: 1.0, g: 0.72, b: 0.45 }
const RED = { r: 0.95, g: 0.16, b: 0.03 }
const DEEP = { r: 0.42, g: 0.04, b: 0.01 }
const BLACK = { r: 0.02, g: 0.01, b: 0.01 }

export function blastFireColor(t: number, out: Color): void {
  let a = FLASH
  let b = RED
  let k = 0
  if (t <= 0.08) {
    // 炸開的那一瞬。0.85 s 的壽命下這是 68 ms
    k = t / 0.08
  } else if (t <= 0.5) {
    a = RED
    b = DEEP
    k = (t - 0.08) / 0.42
  } else {
    a = DEEP
    b = BLACK
    k = Math.min(1, (t - 0.5) / 0.5)
  }
  out.setRGB(
    a.r + (b.r - a.r) * k,
    a.g + (b.g - a.g) * k,
    a.b + (b.b - a.b) * k,
    SRGBColorSpace,
  )
}

/**
 * 火球的球塊版。
 *
 * @param pace 壽命倍率。**整個爆炸的快慢**由它與 `createDust`／
 *             `createBlastSmoke` 一起吃 —— 見 `BlastParams` 的說明
 */
export function createFireChunks(
  capacity: number = FIRE_CHUNK_CAPACITY, pace = 1,
  onFade?: ChunkConfig['onFade'],
): Particles {
  return createChunks({
    capacity,
    life: FIRE_CHUNK_LIFE * pace,
    size: FIRE_CHUNK_SIZE,
    gravity: FIRE_CHUNK_GRAVITY,
    drag: FIRE_CHUNK_DRAG,
    color: blastFireColor,
    onFade,
  })
}
