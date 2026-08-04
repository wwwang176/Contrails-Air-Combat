import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3,
  type Blending,
} from 'three'
import { hash01 } from './scatter'

export interface ParticleConfig {
  capacity: number
  /** `AdditiveBlending`（火球）或 `NormalBlending`（黑煙、噴濺） */
  blending: Blending
  /** 壽命，s */
  life: number
  /** 出生時的**直徑**，m。著色器把四邊形裁成內接圓，所以縮放值就是直徑 */
  sizeFrom: number
  /** 死亡時的直徑，m */
  sizeTo: number
  /** 加速度，m/s²。負值下墜、正值上浮 */
  gravity: number
  /** 指數阻尼，s⁻¹。終端速度是 `gravity / drag` */
  drag: number
  /** 出生時的不透明度，線性淡到 0 */
  alphaFrom: number
  /**
   * 壽命的隨機幅度，比例。0.25 就是 0.75×~1.25×。省略等於不抖動。
   *
   * 【為什麼要有它】同一批煙用同一個壽命的話，整批會**同時**淡到不見 ——
   * 煙帶的尾端讀起來是一條被切齊的線而不是散開。抖動壽命讓每一團各自
   * 散掉，這是專案負責人在試驗場上要求的。
   */
  lifeJitter?: number
  /**
   * 顏色曲線。`t` 是年齡佔壽命的比例（0..1）。
   *
   * 【為什麼是回呼而不是兩個顏色常數】火球要走白 → 橘 → 暗紅三段，兩點
   * 線性內插到中段會變成脫色的土黃。煙與噴濺則是常數色 —— 一個回呼同時
   * 容得下這兩種需求，而且各自的曲線在各自的模組裡被測試。
   */
  color(t: number, out: Color): void
}

export interface Particles {
  object: InstancedMesh
  /** 目前還活著幾顆。測試與 telemetry 用 */
  readonly live: number
  /**
   * 發射一顆。熱路徑：不配置。
   *
   * @param sizeScale 這一顆的尺寸倍率。同一個池子要出兩種大小時用它 ——
   *                  例如 0.4 m 的碎片冒的煙不該跟整架殘骸冒的一樣大
   */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, sizeScale?: number,
  ): void
  /** 積分一幀並寫入實例矩陣。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number): void
  /**
   * 全部歸零。**換一場戰鬥時呼叫** —— 上一場的煙不該飄在新的一場裡。
   *
   * 【為什麼不是 dispose 再建一個】那會重新配置 GPU 緩衝、還要把新的
   * `object` 重新加進場景 —— 一條只在換場時才走、因此永遠測不夠的路徑。
   */
  reset(): void
  dispose(): void
}

/**
 * 這一格這一次的壽命，s。
 *
 * 【為什麼用格子索引當種子而不是 `Math.random`】與這個專案其他所有隨機
 * 一樣：純函數才測得起來，而且重播可重現（見 `scatter.ts` 的 `hash01`）。
 * 環形緩衝繞一圈後同一格會拿到同一個倍率，但那是 6,144 個值之後的事，
 * 而且相鄰的格子拿到的是雜湊值、彼此無關 —— 同一批發射出去的煙壽命各異，
 * 那正是要的效果。
 */
export function particleLife(life: number, jitter: number, slot: number): number {
  if (jitter <= 0) return life
  return life * (1 + (hash01(slot) * 2 - 1) * jitter)
}

/** 年齡 → 直徑。線性膨脹；壽命之外是 0。 */
export function particleSize(age: number, life: number, from: number, to: number): number {
  if (age < 0 || age >= life) return 0
  return from + (to - from) * (age / life)
}

/** 年齡 → 不透明度。線性淡出；壽命之外是 0。 */
export function particleAlpha(age: number, life: number, alphaFrom: number): number {
  if (age < 0 || age >= life) return 0
  return alphaFrom * (1 - age / life)
}

/**
 * 把 three 的 `MeshBasicMaterial` 著色器改造成**廣告板 + 逐實例 alpha +
 * 軟邊圓形**。
 *
 * 【為什麼非得動著色器】`InstancedMesh` 的逐實例顏色只有 RGB 沒有 alpha。
 * M7 兩次繞開這條限制（槍焰靠加法混合淡到黑、水柱靠幾何曲線），黑煙繞不
 * 開：加法混合對黑色無效（`dst + 0` 等於隱形），往黑淡在亮天空上方向是反
 * 的，而一團 9 m 的深色物體直接消失非常明顯（M8 spec §4.3）。
 *
 * 【為什麼不用貼圖】專案目前一張貼圖都沒有。片段端一行 `smoothstep` 就
 * 得到軟邊圓形，而且不必管資產管線。
 *
 * 【為什麼抽成獨立的具名函式】`String.replace` 找不到目標時**不報錯**。
 * 抽出來之後可以拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了 ——
 * 否則 three 改版重新命名 chunk，廣告板會靜靜地退化而沒有任何東西失敗。
 */
export function injectBillboard(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;
       varying vec2 vOffset;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       vOffset = position.xy;
       // 【廣告板】只取實例矩陣的平移與縮放，在視圖空間把四邊形攤平 ——
       // 於是它永遠正對相機，不論從哪個角度看都是一團。
       vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float instScale = length(instanceMatrix[0].xyz);
       mvPosition.xy += position.xy * instScale;
       gl_Position = projectionMatrix * mvPosition;`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying vec2 vOffset;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       // 軟邊圓形：四邊形的頂點在 [-0.5, 0.5]，所以半徑 0.5 是內接圓
       float rEdge = smoothstep(0.5, 0.25, length(vOffset));
       gl_FragColor.a *= vAlpha * rEdge;`,
    )
}

/** 模組私有的暫存。熱路徑：不配置。 */
const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 廣告板粒子池 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 火球、黑煙、噴濺各是它的一個實例。三者的幾何完全相同（一個面向相機的
 * 四邊形）、積分器完全相同、淡出曲線完全相同 —— 差別只有數值與混合模式。
 * 寫成三個長得幾乎一樣的檔案正是這個專案一再點名的**「只有一份會被修好」**
 * 的危險（M8 spec §4.1）。
 *
 * 【與 M7 三個特效各自成檔的差別】那三個的**幾何本身**不同（十字／拉長的
 * 圓柱／收緊的圓柱），運動也不同 —— 共用會是硬湊。
 *
 * 【已知限制：實例之間不排序】`InstancedMesh` 無法逐實例排序，所以互相
 * 重疊的煙團會依繪製順序而非深度混合。因為每一團的顏色幾乎相同、而且
 * `depthWrite` 關著（彼此不遮擋），這個誤差在畫面上看不出來。煙與**飛機**
 * 之間仍然正確：`depthTest` 開著。
 */
export function createParticles(cfg: ParticleConfig): Particles {
  const { capacity, life } = cfg
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  const jitter = cfg.lifeJitter ?? 0
  /**
   * 【起始年齡設無限大】等於「一出生就是死的」，不必另外一個 alive 陣列。
   *
   * 【為什麼是 Infinity 而不是 `life`】每一格的壽命現在各不相同，死亡的
   * 判準是 `age >= lifeOf[i]`。填一個具體的值就得保證它大於任何可能的
   * `lifeOf` —— 而 float32 的來回轉換可以讓一個和存成比它自己還小的值
   * （`splash.ts` 就踩過這個坑）。Infinity 沒有這個問題。
   */
  const age = new Float32Array(capacity).fill(Infinity)
  /** 這一格這一次的壽命。抖動關掉時每一格都是 `cfg.life`。 */
  const lifeOf = new Float32Array(capacity).fill(life)
  const sizeMul = new Float32Array(capacity).fill(1)
  /**
   * 這一格的矩陣是不是已經被歸零了。
   *
   * 【為什麼需要它】`step` 原本每幀對每一個死格子都寫一次零矩陣 —— 容量
   * 6,144 而存活只有幾百時，九成的工作是把 0 重複寫成 0。歸零只需要在
   * 「活 → 死」那一幀做一次。有了它，每幀的寫入量跟著**存活數**走而不是
   * 容量，加大池子才不用付代價。
   */
  const zeroed = new Uint8Array(capacity).fill(1)
  let next = 0
  let live = 0

  // 四邊形的頂點落在 [-0.5, 0.5]，所以縮放值就是直徑（見著色器的 rEdge）
  const geometry = new PlaneGeometry(1, 1)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  alphas.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aAlpha', alphas)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: cfg.blending,
  })
  material.onBeforeCompile = injectBillboard

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點）——開著視錐剔除，相機一離開原點附近
  // 整批粒子會一起消失。與曳光彈、火花同一個坑。
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

    emit(x, y, z, evx, evy, evz, sizeScale = 1): void {
      const i = next
      next = next + 1 >= capacity ? 0 : next + 1
      // 【滿了覆蓋最舊的】最舊的正好是最淡的那一顆，覆蓋看不出來；丟棄新的
      // 則會在最該看到爆炸的時候整批不見。與 sparks.ts 同一個取捨。
      // 【先用舊壽命判生死，再寫新的】反過來的話，覆蓋一格活著的粒子時
      // 有機會被新壽命誤判成「原本是死的」而重複計數
      if (age[i]! >= lifeOf[i]!) live++
      lifeOf[i] = particleLife(life, jitter, i)
      zeroed[i] = 0
      px[i] = x
      py[i] = y
      pz[i] = z
      vx[i] = evx
      vy[i] = evy
      vz[i] = evz
      sizeMul[i] = sizeScale
      age[i] = 0
    },

    step(dt: number): void {
      const damp = Math.exp(-cfg.drag * dt)
      const a = alphas.array as Float32Array
      live = 0
      let touched = false
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        const lf = lifeOf[i]!
        if (old >= lf) {
          // 【已經歸零的死格子直接跳過】把 0 重複寫成 0 是這個迴圈原本
          // 九成的工作量
          if (zeroed[i] === 1) continue
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          object.setColorAt(i, TINT.setRGB(0, 0, 0))
          a[i] = 0
          zeroed[i] = 1
          touched = true
          continue
        }
        const na = old + dt
        age[i] = na
        if (na >= lf) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          object.setColorAt(i, TINT.setRGB(0, 0, 0))
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

        const s = particleSize(na, lf, cfg.sizeFrom, cfg.sizeTo) * sizeMul[i]!
        POS.set(nx, ny, nz)
        // 【不寫旋轉】朝向由著色器在視圖空間決定；寫進矩陣會讓著色器取到的
        // length(instanceMatrix[0].xyz) 不再是直徑。
        SCALE.set(s, s, s)
        M.compose(POS, ROT.identity(), SCALE)
        object.setMatrixAt(i, M)

        // 【顏色與 alpha 走各自的壽命比例】長命的那幾團淡得慢，那才是
        // 「壽命不同」在畫面上的意思
        cfg.color(na / lf, TINT)
        object.setColorAt(i, TINT)
        a[i] = particleAlpha(na, lf, cfg.alphaFrom)
      }
      // 【沒有任何格子被動到就不必上傳】整池全死時省下一次完整的
      // buffer 上傳
      if (touched) {
        object.instanceMatrix.needsUpdate = true
        alphas.needsUpdate = true
        if (object.instanceColor) object.instanceColor.needsUpdate = true
      }
    },

    reset(): void {
      age.fill(Infinity)
      live = 0
      next = 0
      const a = alphas.array as Float32Array
      M.compose(ZERO, ROT.identity(), ZERO)
      for (let i = 0; i < capacity; i++) {
        // 【已經歸零的跳過】與 step 同一個理由：把 0 重複寫成 0 是白工
        if (zeroed[i] === 1) continue
        object.setMatrixAt(i, M)
        object.setColorAt(i, TINT.setRGB(0, 0, 0))
        a[i] = 0
        zeroed[i] = 1
      }
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
      alphas.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
