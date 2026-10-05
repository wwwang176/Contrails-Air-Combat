import {
  ClampToEdgeWrapping, Color, DataTexture, FloatType, GLSL3, Group, Mesh, LessDepth,
  LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, MeshStandardMaterial,
  NearestFilter, OrthographicCamera, PlaneGeometry, RedFormat, RGBAFormat, Scene, ShaderMaterial,
  UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, type Camera,
  type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three'
import { SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH } from './sky'
import { CULL, frustumPlanesOf, shareGeometry, visibleRuns } from './cullRuns'
import type { DayPalette } from './timeOfDay'
import type { ShoreFieldData } from '../world/archipelago'
import {
  WAVES, WAVE_WARP_AMP, WAVE_WARP_LEN_A, WAVE_WARP_LEN_B, WAVE_WARP2_AMP, WAVE_WARP2_LEN_A,
  WAVE_WARP2_LEN_B, WAVE_ENV_LO, WAVE_ENV_LEN_A, WAVE_ENV_LEN_B, WAVE_ENV_SPREAD,
  WAVE_WARP_SPEED, WAVE_FADE_LO, WAVE_FADE_HI, gerstnerHeight,
} from '../core/oceanWaves'
import {
  OCEAN_BASE_CELL, OCEAN_RING_SEGMENTS, OCEAN_LEVELS, OCEAN_BLOCK_GRID, BLOCK_BI, BLOCK_BJ,
  OCEAN_CULL, OCEAN_RUN_CAP, OCEAN_CULL_Y, OCEAN_SNAP, OCEAN_MORPH_START, OCEAN_VERT_FADE_LO,
  OCEAN_VERT_FADE_HI, FAR_SEA_SIZE, FAR_SEA_RENDER_ORDER, FAR_SEA_Y, clipmapLevelGeometry,
} from './oceanGeometry'
import {
  SEA_COLOR, SEA_HORIZON_COLOR, SEA_ROUGHNESS, SEA_SPECULAR, SUN_DIR, SPARKLE_SIGMA_BASE,
  SPARKLE_SIGMA_TAIL, SPARKLE_TAIL_WEIGHT, SPARKLE_DENSITY, SHORE_DENSITY, SPARKLE_P_MAX,
  SPARKLE_CREST_BIAS, SPARKLE_CREST_REF, SPARKLE_TWINKLE, SPARKLE_STRENGTH, SPARKLE_ENVELOPE_POW,
  FACE_TINT, FACE_CREST_LIFT, SPARKLE_ATTEN_NEAR, SPARKLE_ATTEN_FAR, SPARKLE_FAR_DIM,
  SPARKLE_FADE_START, SPARKLE_FADE_END, SEA_DIM_LO, SEA_DIM_HI, SEA_DIM_FLOOR, SEA_SHADE_GAIN,
  SEA_REFLECT_F0, SEA_REFLECT_STRENGTH, SEA_AERIAL_HI, SEA_AERIAL_LO, SEA_AERIAL_STRENGTH,
} from './oceanStyle'
import {
  SPARKLE_COMMON, SEA_DIM_FRAGMENT, FACE_FRAGMENT, FACE_TABLE_WIDTH, FACE_TABLE_HEIGHT,
  FACE_TABLE_FRAGMENT, FACE_TABLE_VERTEX, FACE_FRAGMENT_TABLE, sparkleFragment,
} from './oceanShaders'

/**
 * 算逐面量的那個 renderer。**`createScene` 建好 renderer 就登記**，而
 * `createOcean` 在那之後才跑（每個會建地形的頁面都是這個次序）。
 *
 * 【沒有登記時走逐片段那條】headless 的測試與任何沒有 renderer 的呼叫端
 * 因此完全不受影響 —— 畫面相同，只是每個片段自己算。
 */
let oceanRenderer: WebGLRenderer | null = null

export function setOceanRenderer(r: WebGLRenderer): void {
  oceanRenderer = r
}

/** `Ocean.paletteUniforms` 的形狀。 */
export interface OceanPaletteUniforms {
  readonly uSkyHorizon: { value: Color }
  readonly uSkyZenith: { value: Color }
  readonly uSkyPower: { value: number }
  readonly uHorizonColor: { value: Color }
  readonly uSunDirection: { value: Vector3 }
  readonly uSparkleStrength: { value: number }
}

export interface Ocean {
  /**
   * 細浪面。**一組以相機為中心的巢狀方環**（clipmap），不是單一網格。
   * 設計與各層的尺寸見 `OCEAN_BASE_CELL`。
   *
   * 【為什麼回 Group 而不是回陣列】呼叫端（`render/terrain.ts`）只要把它
   * 加進場景；層數是這個模組的內部決定，不該漏出去。`__gfx` 的消融也
   * 靠 traverse 走到葉子，不需要知道有幾層。
   */
  mesh: Group
  /**
   * 遠海。**平的、單色、只有兩個三角形**，墊在細浪面底下把海接到地平線。
   *
   * 見 `FAR_SEA_SIZE` / `FAR_SEA_Y` 與下方 `renderOrder` 的註解。
   */
  farMesh: Mesh
  /**
   * 波相位的原點（著色器的 `uOrigin`），已經吸附到格點。**與
   * `mesh.position.xz` 恆相等** —— 只吸附其中一份的話浪會相對網格滑動，
   * 症狀與完全不吸附一樣。
   *
   * 【為什麼要出現在介面上】`onBeforeCompile` 在 headless 測試裡不會被呼叫，
   * 從材質上讀不到 uniform。公開它是為了讓那一條守得住，沒有別的用途。
   */
  readonly origin: Vector2
  /**
   * `OCEAN_HEIGHT_GLSL` 要的 uniform，**與海面材質是同一組物件**（同一個 uTime、同一個
   * 吸附原點）。貼著海面的東西在自己的著色器裡用它算浪高，與海面逐頂點一致。
   */
  readonly heightUniforms: Readonly<Record<string, { value: unknown }>>
  /**
   * `setPalette` 會寫的那六個著色器 uniform。
   *
   * 【為什麼要出現在介面上】與 `origin` 同一個理由 —— `onBeforeCompile` 在
   * headless 測試裡不會被呼叫，從材質上讀不到 uniform。少了這一格，
   * 「海面反射的天空色跟著時段換」就沒有任何反證：漏掉其中一個的症狀是
   * **黃昏的海反射著中午的天**，畫面上看得出來但不會有東西報錯。
   */
  readonly paletteUniforms: OceanPaletteUniforms
  /**
   * 換時段。**細浪面與遠海一起換** —— 漏掉其中一個就是 5 km 處的一條色帶。
   *
   * 【為什麼是可變的而不是建構參數】展示頁要能即時切換，而「建立時設一次」
   * 與「事後改」若走兩條路徑，展示頁看到的就不是遊戲裡的東西。
   */
  setPalette(p: DayPalette): void
  update(time: number, centerX: number, centerZ: number): void
  /**
   * 依這一台相機畫近海每一層看得到的塊。**每次 render 之前呼叫**；`CULL.enabled`
   * 關掉時每一層整條畫一次，與切塊之前相同
   */
  cull(camera: Camera): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}

/**
 * @param shore 離岸的膨脹圖，浪花吃它。**`null` = 這一場沒有陸地**
 *   （`'sea'`）—— 掛一張 1×1 的零貼圖，取樣恆為 0。
 */
export function createOcean(shore: ShoreFieldData | null): Ocean {
  // clipmap 的四層。L0 實心，其餘挖掉中央 —— 那一塊由內一層負責
  const levels = Array.from({ length: OCEAN_LEVELS }, (_, i) =>
    clipmapLevelGeometry(OCEAN_BASE_CELL * 2 ** i, OCEAN_RING_SEGMENTS, i > 0))
  const levelGeometries = levels.map((l) => l.geometry)

  const material = new MeshPhysicalMaterial({
    color: SEA_COLOR,
    roughness: SEA_ROUGHNESS,
    metalness: 0.05,
    specularIntensity: SEA_SPECULAR,
    flatShading: true,
    // 【海面吃霧】與陸地同一層霧 —— 霧濃的時段遠山化進天色而海面清清楚楚，
    // 看起來是假的。遠海因此往天空色靠、海天那一階變軟。
    // **兩個材質必須一起開**，只開一個就會在 5 km 處出現一條色帶。
    fog: true,
  })

  const uTime = { value: 0 }
  const uOrigin = { value: new Vector2(0, 0) }

  /**
   * 離岸的膨脹圖。單通道 8 位元，1024² 是 1 MiB。
   *
   * 【為什麼要 mipmap】見 FACE_FRAGMENT 裡 `shoreLod` 的說明 —— 遠海一個面
   * 比浪花帶還寬，逐點取樣會整條帶漏掉。1024 是 2 的冪，所以 mip 生得出來。
   *
   * 【`DataTexture` 的預設已經對】`flipY = false`（所以第 0 列對到最小的
   * v，也就是最負的 z）、`NoColorSpace`（這張圖是遮罩不是顏色）、
   * `unpackAlignment = 1`、`ClampToEdgeWrapping`。這裡只改濾波與 mipmap。
   */
  const shoreTexture = new DataTexture(
    shore ? shore.data : new Uint8Array(1),
    shore ? shore.size : 1,
    shore ? shore.size : 1,
    RedFormat,
    UnsignedByteType,
  )
  shoreTexture.wrapS = ClampToEdgeWrapping
  shoreTexture.wrapT = ClampToEdgeWrapping
  shoreTexture.magFilter = LinearFilter
  shoreTexture.generateMipmaps = shore !== null
  shoreTexture.minFilter = shore ? LinearMipmapLinearFilter : LinearFilter
  shoreTexture.needsUpdate = true

  /**
   * 碎光的 uniform。**細浪面與遠海共用同一組物件** —— 同 `SEA_COLOR` 的理由，
   * 兩份會漂開，症狀是近海與遠海的接縫兩側顏色不一樣。
   */
  const sparkle = {
    uWaveDir: { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) },
    uWaveAmp: { value: WAVES.map((w) => w.amplitude) },
    uWaveLen: { value: WAVES.map((w) => w.wavelength) },
    uWaveSpd: { value: WAVES.map((w) => w.speed) },
    uSunDirection: { value: new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) },
    uCrestBias: { value: SPARKLE_CREST_BIAS },
    uCrestRef: { value: SPARKLE_CREST_REF },
    uSigmaBase: { value: SPARKLE_SIGMA_BASE },
    uSigmaTail: { value: SPARKLE_SIGMA_TAIL },
    uTailWeight: { value: SPARKLE_TAIL_WEIGHT },
    uDimLo: { value: SEA_DIM_LO },
    uDimHi: { value: SEA_DIM_HI },
    uDimFloor: { value: SEA_DIM_FLOOR },
    uDensity: { value: SPARKLE_DENSITY },
    uTwinkle: { value: SPARKLE_TWINKLE },
    uSparkleStrength: { value: SPARKLE_STRENGTH },
    uEnvelopePow: { value: SPARKLE_ENVELOPE_POW },
    uFaceTint: { value: FACE_TINT },
    uFaceLift: { value: FACE_CREST_LIFT },
    uShoreMap: { value: shoreTexture },
    // 【尺是 size × cell 而不是 (size − 1) × cell】見 FACE_FRAGMENT 的推導。
    // 沒有陸地時給 1，只是為了不要除以 0 —— 那張貼圖處處是 0
    uShoreExtent: { value: shore ? shore.size * shore.cell : 1 },
    uShoreCell: { value: shore ? shore.cell : 1 },
    uShoreDensity: { value: shore ? SHORE_DENSITY : 0 },
    uPMax: { value: SPARKLE_P_MAX },
    uHalfSeg: { value: OCEAN_RING_SEGMENTS / 2 },
    uMaxLevel: { value: OCEAN_LEVELS - 1 },
    uMorphStart: { value: OCEAN_MORPH_START },
    uSnap: { value: OCEAN_SNAP },
    uCenter: { value: new Vector2() },
    // 【天空色直接取 sky.ts 的常數】海面反射的是那一片天，兩份會漂開。
    // `new Color(hex)` 出來就在線性空間，而這一段也在線性空間（PBR 之後、
    // colorspace_fragment 之前），所以不需要任何轉換
    uSkyHorizon: { value: new Color(SKY_HORIZON) },
    uSkyZenith: { value: new Color(SKY_ZENITH) },
    uSkyPower: { value: SKY_GRADIENT_POWER },
    uReflectF0: { value: SEA_REFLECT_F0 },
    uReflectStrength: { value: SEA_REFLECT_STRENGTH },
    uWarp: {
      value: new Vector3(
        WAVE_WARP_AMP, (Math.PI * 2) / WAVE_WARP_LEN_A, (Math.PI * 2) / WAVE_WARP_LEN_B),
    },
    uWarpSpd: { value: WAVE_WARP_SPEED },
    uWarp2: {
      value: new Vector3(
        WAVE_WARP2_AMP, (Math.PI * 2) / WAVE_WARP2_LEN_A, (Math.PI * 2) / WAVE_WARP2_LEN_B),
    },
    uEnv: {
      value: new Vector3(
        WAVE_ENV_SPREAD, (Math.PI * 2) / WAVE_ENV_LEN_A, (Math.PI * 2) / WAVE_ENV_LEN_B),
    },
    uEnvLo: { value: WAVE_ENV_LO },
    uBaseCell: { value: OCEAN_BASE_CELL },
    uInvHalfSeg: { value: 2 / OCEAN_RING_SEGMENTS },
    uVertFadeLo: { value: OCEAN_VERT_FADE_LO },
    uVertFadeHi: { value: OCEAN_VERT_FADE_HI },
    uNyqLo: { value: WAVE_FADE_LO },
    uNyqHi: { value: WAVE_FADE_HI },
    uShadeGain: { value: SEA_SHADE_GAIN },
    uAttenNear: { value: SPARKLE_ATTEN_NEAR },
    uAttenFar: { value: SPARKLE_ATTEN_FAR },
    uFarDim: { value: SPARKLE_FAR_DIM },
    uFadeStart: { value: SPARKLE_FADE_START },
    uFadeEnd: { value: SPARKLE_FADE_END },
    uAerialHi: { value: SEA_AERIAL_HI },
    uAerialLo: { value: SEA_AERIAL_LO },
    uAerialStrength: { value: SEA_AERIAL_STRENGTH },
    uHorizonColor: { value: new Color(SEA_HORIZON_COLOR) },
  }

  /**
   * 逐面量的表。沒有登記 renderer（headless、單元測試）時是 `null`，近海就
   * 走逐片段那條。
   */
  // 【浮點 render target 不是每張卡都有】沒有 EXT_color_buffer_float 就建不出
  // 這張表，而建失敗的症狀是整片近海壞掉。偵測不到就走逐片段那條 —— 那是
  // 原本的算法，每個片段自己算，只是比較慢
  const useTable = oceanRenderer !== null
    && oceanRenderer.extensions.has('EXT_color_buffer_float')
  const tableTarget = useTable
    ? new WebGLRenderTarget(FACE_TABLE_WIDTH, FACE_TABLE_HEIGHT, {
      depthBuffer: false,
      stencilBuffer: false,
      // 【非 32 位元浮點不可】閃爍骰值與 `p` 的比較吃得住的精度就是它 ——
      // 半精度在 1.0 附近的階距是 1e-3，白面會整片跟著換
      type: FloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    })
    : null
  const tableScene = new Scene()
  const tableCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const tableMaterial = tableTarget === null ? null : new ShaderMaterial({
    // 【非 GLSL3 不可】`SPARKLE_COMMON` 用了 uint 與位移
    glslVersion: GLSL3,
    uniforms: {
      uTime,
      uOrigin,
      ...sparkle,
    },
    vertexShader: `${SPARKLE_COMMON}\n${FACE_TABLE_VERTEX}`,
    fragmentShader: `${SPARKLE_COMMON}\n${FACE_TABLE_FRAGMENT}`,
    depthTest: false,
    depthWrite: false,
  })
  const tableQuad = tableMaterial === null
    ? null
    : new Mesh(new PlaneGeometry(2, 2), tableMaterial)
  if (tableQuad !== null) {
    tableQuad.frustumCulled = false
    tableScene.add(tableQuad)
  }

  /**
   * 把碎光接上一個材質。`displace` 決定要不要同時做頂點位移 —— 遠海是平的，
   * 不位移，但**照樣算真實的波法線**（著色只吃世界座標，與幾何平不平無關）。
   */
  const applySparkle = (
    m: MeshStandardMaterial,
    displace: boolean,
    cacheKey: string,
  ): void => {
    // 【只有近海查表】遠海的面是虛擬的，格距一路放大到 480 m 封頂，覆蓋的
    // 範圍是整個地球，列不進一張表
    const wantTable = displace && tableTarget !== null
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = uTime
      shader.uniforms.uOrigin = uOrigin
      Object.assign(shader.uniforms, sparkle)
      if (wantTable) shader.uniforms['uFaceTable'] = { value: tableTarget.texture }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
${SPARKLE_COMMON}${displace ? '\n  attribute float oceanCell;' : ''}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           ${displace
             ? `vec2 rawXZ = transformed.xz + uOrigin;
                // 【這個頂點所在的層有多粗】四層都以相機為中心，而第 L 層
                // 覆蓋到半徑 (段數/2)×格子(L) —— 所以「離中心多遠」直接
                // 換算得到「這裡的格子多大」。用的是**局部座標**，也就是
                // 離相機的水平距離，與世界座標無關。
                //
                // 【兩層共用的頂點高度相同】交界上的同一點，兩層算出來的
                // vCell 完全相同（都只吃離中心的距離），淡出量因此逐位元一致。
                // 細層多出來的那些頂點靠下面的幾何過渡對齊，見 OCEAN_MORPH_START
                float waveH = oceanWaveHeight(rawXZ, oceanVCell(transformed.xz));

                // 【幾何過渡】細層在外緣那一段把「粗層沒有的頂點」拉到兩旁粗
                // 頂點的平均高度 —— 那正是粗層在那一點的高度（粗層的邊是直線、
                // 粗層的對角線切法見 clipmapLevelGeometry）。拉滿時細網格與粗網格
                // 完全重合，交界沒有高低差
                float morph = oceanMorph(oceanCell, rawXZ);
                if (morph > 0.0) {
                  vec2 odd = mod(floor(transformed.xz / oceanCell + 0.5), 2.0);
                  if (odd.x + odd.y > 0.5) {
                    // 單軸奇數：兩旁在那一軸上；兩軸都奇數：落在粗格的對角線上，
                    // 兩端是 (+c, −c) 與 (−c, +c)
                    vec2 s = odd.x > 0.5 && odd.y > 0.5
                      ? vec2(oceanCell, -oceanCell) : odd * oceanCell;
                    vec2 a = transformed.xz + s;
                    vec2 b = transformed.xz - s;
                    float coarse = 0.5 * (oceanWaveHeight(a + uOrigin, oceanVCell(a))
                      + oceanWaveHeight(b + uOrigin, oceanVCell(b)));
                    waveH = mix(waveH, coarse, morph);
                  }
                }
                transformed.y += waveH;`
             : ''}
           vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
        )

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SPARKLE_COMMON}${
          wantTable ? '\n  uniform highp sampler2D uFaceTable;' : ''}`)
        // 【順序非有不可】基色那一段宣告了碎光要用的視線量，見
        // SEA_DIM_FRAGMENT。color_fragment 在 opaque_fragment 之前展開。
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\n${SEA_DIM_FRAGMENT}`,
        )
        // 【兩個材質都套逐面那一段】見 FACE_FRAGMENT 的「遠海的面是虛擬的」。
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>\n${sparkleFragment(
            wantTable ? FACE_FRAGMENT_TABLE : FACE_FRAGMENT)}`,
        )
    }
    /**
     * 【非設不可】兩個材質的 `onBeforeCompile` 來自同一個 factory，而
     * `customProgramCacheKey` 的預設值就是 `onBeforeCompile.toString()`
     * （three `Material.js`）—— 兩邊會產生**完全相同的字串**而共用同一支
     * program，於是遠海拿到帶頂點位移的那一版（或反之）。症狀離成因極遠。
     */
    m.customProgramCacheKey = () => cacheKey
  }

  // 【查表與不查表要分開的 program】兩份字串不同，共用 key 會讓後建的那一份
  // 拿到前一份的程式 —— 症狀是整片近海查一張沒有綁上去的貼圖
  applySparkle(material, true, useTable ? 'ocean-near-waves-table' : 'ocean-near-waves')

  const mesh = new Group()
  /**
   * 每一層的 `OCEAN_RUN_CAP` 段：`[0]` 是那一層的 Mesh 本身（整條索引、`drawRange`
   * 決定畫哪段），其餘掛在它底下，各自一顆共用屬性的幾何。見 `OCEAN_BLOCK_GRID`
   */
  const levelRuns: Mesh[][] = []
  for (const g of levelGeometries) {
    const runs: Mesh[] = []
    for (let r = 0; r < OCEAN_RUN_CAP; r++) {
      const m = new Mesh(r === 0 ? g : shareGeometry(g), material)
      // 【three 的剔除一律關掉】包圍球看不到頂點位移，而且以相機為中心的那幾塊碰得到
      // 相機 —— 球一定與視錐相交。塊自己剔，見 `cull`
      m.frustumCulled = false
      if (r > 0) {
        m.visible = false
        runs[0]!.add(m)
      }
      runs.push(m)
    }
    levelRuns.push(runs)
    mesh.add(runs[0]!)
  }
  /** 一層的塊的索引區段與包圍盒；`cull` 逐層重填 */
  const MAX_BLOCKS = OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID
  const blockFrom = new Int32Array(MAX_BLOCKS)
  const blockTo = new Int32Array(MAX_BLOCKS)
  const blockBox = new Float32Array(MAX_BLOCKS * 6)
  const runStart = new Int32Array(MAX_BLOCKS)
  const runEnd = new Int32Array(MAX_BLOCKS)
  const planes = new Float64Array(24)

  // 遠海。用 MeshPhysicalMaterial 而不是 Basic：要跟細浪面接得上就得受同一
  // 組燈光。roughness / metalness 全部沿用細浪面的值。
  //
  // 【為什麼要細分成 128×128，不是一個大四邊形】碎光的取樣座標是片段的
  // vOceanWorld.xz，由頂點透視插值而來。整片 6000 km 若只有兩個三角形，
  // 頂點相距數千公里，插值出的世界座標在 float32 下量化誤差約 0.36 m，
  // 相機一移動就跳動 → 遠海白點 1 px 抖，且對角線兩側各自插值、各自抖
  //（實測）。細分到 128 段後單格約 47 km，插值誤差降到約 2.8 mm，
  // 遠小於碎光 14 m 的格子，抖動消失。128² = 16,384 個頂點，farMesh 不做
  // 頂點位移（displace=false），建立一次、之後只平移，成本可忽略。
  const FAR_SEGMENTS = 128
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, FAR_SEGMENTS, FAR_SEGMENTS)
  farGeometry.rotateX(-Math.PI / 2)
  const farMaterial = new MeshPhysicalMaterial({
    color: SEA_COLOR,
    roughness: SEA_ROUGHNESS,
    metalness: 0.05,
    specularIntensity: SEA_SPECULAR,
    /**
     * 【為什麼是 Less 而不是預設的 LessEqual】遠海排在近海之後畫，所以深度
     * 平手時**後畫的勝出** —— 而深度量化 `Δz ≈ z²/2²⁴` 在浪還存在的距離上
     * 已經是公尺級（最長波撐到 12,160 m，那裡是 8.8 m），遠比近海與遠海相距
     * 的 5 m 大。平手會讓遠海蓋掉近海的逐面色。
     *
     * 遠海恆在近海之下，而且在 clipmap 的覆蓋範圍內恆在近海之後（同一條視線
     * 上更遠），所以真實深度恆為 `far >= near`；量化是單調的，量化後仍然
     * `far >= near`。**平手是唯一的失效模式**，`LessDepth` 拒絕相等就補完了。
     *
     * 這比「把遠海壓到量化階的三倍之下」更強：與距離、波長、振幅全都無關，
     * 而且不會讓接縫的落差自己變成一條看得見的線。
     */
    depthFunc: LessDepth,
    // 【與細浪面同一個理由，見上面】兩個一起開，漏一個就是 5 km 處的色帶
    fog: true,
  })
  applySparkle(farMaterial, false, 'ocean-far-flat')

  const farMesh = new Mesh(farGeometry, farMaterial)
  farMesh.frustumCulled = false // 隨鏡頭捲動，永遠可見
  // 建立時就擺好，讓「還沒 update 過」的狀態也是一致的（與 sky.ts 同一招）
  farMesh.position.y = FAR_SEA_Y
  /**
   * 遠海**最後畫**（renderOrder 1）。
   *
   * ── 【為什麼不必怕深度平手】────────────────────────────────
   *
   * 遠海與細浪面只相距 5 m，而深度量化
   * `Δz ≈ z²/2²⁴`（近平面 1 m）在 7,000 m 是 2.92 m、12,000 m 是 8.58 m。
   * 上帝視角爬高之後，整片細浪面（那時永遠是 ±5 km）與遠海分不出前後，
   * 而 `LessEqualDepth` 讓**後畫的贏** —— 遠海會把浪蓋掉。
   *
   * clipmap 上線之後，**浪只存在於相機周圍 3.6 km 之內**：頂點的頻帶限制
   * 讓最長的 140 m 波在 `vCell > 0.4 × 140 = 56 m` 時完全淡出，而 vCell 是
   * 距離的 1/64，所以 56 m 對應 3,584 m。那個距離上 `Δz = 0.77 m`，只有
   * 5 m 間隔的六分之一 —— **深度分得很開，平手不可能發生。**
   *
   * 3.6 km 之外兩者都是平的、用同一支著色器、同一組參數，誰贏都一樣：實測
   * 八個凍結姿態，反轉前後沒有任何帶狀接縫（差異只是碎光的顆粒換了位置，
   * 因為遠海在 y = −5 而 clipmap 在 y = 0，視線向量差了一點）。
   *
   * ── 【換來的：遠海變成免費】────────────────────────────────
   *
   * 先畫的話，被細浪面蓋掉的區域**無法**靠 early-Z 省掉，而遠海是全螢幕的。
   * 而 clipmap 鋪到 82 km，畫面上的海幾乎整片都被它蓋住 —— 等於昂貴的海面
   * 著色器跑了兩次全螢幕。
   *
   * 逐層消融（同一輪內背對背）：
   *
   *     關掉遠海省下的 p50      改前 −16.6%      改後 −0.6%
   *
   * **這一項的收益比 clipmap 本身還大。**
   */
  farMesh.renderOrder = FAR_SEA_RENDER_ORDER

  return {
    mesh,
    farMesh,
    origin: uOrigin.value,
    heightUniforms: {
      uTime, uOrigin,
      uWaveDir: sparkle.uWaveDir, uWaveAmp: sparkle.uWaveAmp,
      uWaveLen: sparkle.uWaveLen, uWaveSpd: sparkle.uWaveSpd,
      uWarp: sparkle.uWarp, uWarpSpd: sparkle.uWarpSpd, uWarp2: sparkle.uWarp2,
      uEnv: sparkle.uEnv, uEnvLo: sparkle.uEnvLo,
      uBaseCell: sparkle.uBaseCell, uInvHalfSeg: sparkle.uInvHalfSeg,
      uVertFadeLo: sparkle.uVertFadeLo, uVertFadeHi: sparkle.uVertFadeHi,
    },
    paletteUniforms: sparkle,
    setPalette(p) {
      material.color.setHex(p.seaColor)
      farMaterial.color.setHex(p.seaColor)
      sparkle.uSkyHorizon.value.setHex(p.skyHorizon)
      sparkle.uSkyZenith.value.setHex(p.skyZenith)
      sparkle.uSkyPower.value = p.skyPower
      sparkle.uHorizonColor.value.setHex(p.seaHorizon)
      sparkle.uSparkleStrength.value = SPARKLE_STRENGTH * p.sparkle
      sparkle.uSunDirection.value
        .set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize()
    },
    update(time, centerX, centerZ) {
      uTime.value = time

      // 【中心必須吸附到格點】頂點在波場裡連續滑動的話，每一幀每個面的三個
      // 角都落在波的不同相位上 —— 面的形狀逐幀改變，畫面上是整片海在蠕動、
      // 稜線在爬。格子 2.5 m 時那個誤差遠小於一個像素，看不出來；60 m 時
      // 它**就是**外觀。
      //
      // 【為什麼吸附到最外層的格距】OCEAN_SNAP 被四層的格距整除，所以一次
      // 吸附讓四層同時落在各自的格點上 —— `uOrigin` 因此仍然只有一個，
      // 各層不必分家。代價是中心最多偏離相機半格（L0 的半寬是 3,840 m）。
      //
      // 【設在群組上，不是每一層】四層共用同一個中心，那正是它們不裂開的
      // 前提。設在群組上讓那件事是**結構保證**的，不是每幀記得同步的。
      //
      // 【uOrigin 必須吃同一個吸附後的值】它算的是波的相位，而 mesh.position
      // 決定頂點在哪 —— 只吸附其中一份的話浪會相對網格滑動，症狀與完全不
      // 吸附一樣，但只看 mesh.position 的測試抓不到。
      const snapX = Math.round(centerX / OCEAN_SNAP) * OCEAN_SNAP
      const snapZ = Math.round(centerZ / OCEAN_SNAP) * OCEAN_SNAP
      mesh.position.set(snapX, 0, snapZ)
      uOrigin.value.set(snapX, snapZ)
      // 【過渡帶吃不吸附的位置】見 oceanMorph
      sparkle.uCenter.value.set(centerX, centerZ)
      // 【遠海不吸附】吸附是為了避免頂點在格點之間滑動造成面的形狀逐幀改變，
      // 而遠海是平的、沒有面可言。精確跟著相機走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)

      // 【表在這裡重畫，不在算繪迴圈裡】它只吃 uTime 與 uOrigin，而這兩個
      // 就是上面剛寫的 —— 換句話說「輸入變了」與「表重畫」是同一件事。
      // 沒有呼叫 update 的那些幀（暫停）輸入沒變，舊表仍然是對的
      if (tableTarget !== null && oceanRenderer !== null) {
        const prev = oceanRenderer.getRenderTarget()
        oceanRenderer.setRenderTarget(tableTarget)
        oceanRenderer.render(tableScene, tableCamera)
        oceanRenderer.setRenderTarget(prev)
      }
    },
    cull(camera) {
      if (CULL.enabled) frustumPlanesOf(camera, planes)
      // 剔除的塊由幾個細塊組成（每邊 `per` 個）；對齊的那幾個在索引上是連續的一段
      const grid = OCEAN_CULL.grid
      const per = OCEAN_BLOCK_GRID / grid
      for (let l = 0; l < levelRuns.length; l++) {
        const runs = levelRuns[l]!
        const starts = levels[l]!.blockStart
        const total = levelGeometries[l]!.index!.count
        let n = 1
        runStart[0] = 0
        runEnd[0] = total
        if (CULL.enabled) {
          // 塊的盒子：以群組（吸附後的中心）為準，水平是塊的範圍，垂直是浪高餘裕
          const half = (OCEAN_RING_SEGMENTS / 2) * OCEAN_BASE_CELL * 2 ** l
          const size = (2 * half) / grid
          let m = 0
          for (let k = 0; k < MAX_BLOCKS; k += per * per) {
            const from = starts[k]!
            const to = starts[k + per * per]!
            // 【洞裡的塊是空的】不進表 —— 看得到的空塊會佔掉一段
            if (to === from) continue
            const gi = Math.floor(BLOCK_BI[k]! / per)
            const gj = Math.floor(BLOCK_BJ[k]! / per)
            const x0 = mesh.position.x - half + gi * size
            const z0 = mesh.position.z - half + gj * size
            blockFrom[m] = from
            blockTo[m] = to
            blockBox[m * 6] = x0
            blockBox[m * 6 + 1] = -OCEAN_CULL_Y
            blockBox[m * 6 + 2] = z0
            blockBox[m * 6 + 3] = x0 + size
            blockBox[m * 6 + 4] = OCEAN_CULL_Y
            blockBox[m * 6 + 5] = z0 + size
            m++
          }
          n = visibleRuns(m, blockFrom, blockTo, blockBox, planes, OCEAN_RUN_CAP, runStart, runEnd)
        }
        for (let r = 0; r < runs.length; r++) {
          const m = runs[r]!
          if (r < n) {
            m.visible = true
            m.geometry.setDrawRange(runStart[r]!, runEnd[r]! - runStart[r]!)
          } else {
            // 【第 0 段只清空不藏】其餘三段是它的孩子
            if (r > 0) m.visible = false
            m.geometry.setDrawRange(0, 0)
          }
        }
      }
    },
    heightAt: gerstnerHeight,
    dispose() {
      for (const runs of levelRuns) for (const m of runs.slice(1)) m.geometry.dispose()
      for (const g of levelGeometries) g.dispose()
      material.dispose()
      farGeometry.dispose()
      farMaterial.dispose()
      // 【貼圖要自己收】material.dispose() 不會去收 uniform 裡的貼圖
      shoreTexture.dispose()
      tableTarget?.dispose()
      tableMaterial?.dispose()
      tableQuad?.geometry.dispose()
    },
  }
}
