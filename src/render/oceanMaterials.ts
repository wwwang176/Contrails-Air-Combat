import {
  ClampToEdgeWrapping, Color, DataTexture, FloatType, GLSL3, Mesh, LessDepth,
  LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, MeshStandardMaterial,
  NearestFilter, OrthographicCamera, PlaneGeometry, RedFormat, RGBAFormat, Scene, ShaderMaterial,
  UnsignedByteType, Vector2, Vector3, WebGLRenderTarget,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH } from './sky'
import type { DayPalette } from './timeOfDay'
import type { ShoreFieldData } from '../world/archipelago'
import {
  WAVES, WAVE_WARP_AMP, WAVE_WARP_LEN_A, WAVE_WARP_LEN_B, WAVE_WARP2_AMP, WAVE_WARP2_LEN_A,
  WAVE_WARP2_LEN_B, WAVE_ENV_LO, WAVE_ENV_LEN_A, WAVE_ENV_LEN_B, WAVE_ENV_SPREAD,
  WAVE_WARP_SPEED, WAVE_FADE_LO, WAVE_FADE_HI,
} from '../core/oceanWaves'
import {
  OCEAN_BASE_CELL, OCEAN_RING_SEGMENTS, OCEAN_LEVELS, OCEAN_SNAP, OCEAN_MORPH_START,
  OCEAN_VERT_FADE_LO, OCEAN_VERT_FADE_HI,
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

/** 管近景／遠景這一對材質、共用的 uniform，以及可選的面查表資源 */
export function createOceanMaterials(shore: ShoreFieldData | null, useTable: boolean) {
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

  return {
    material, farMaterial, uTime, uOrigin, sparkle,
    tableTarget, tableScene, tableCamera,
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
    setPalette(p: DayPalette) {
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
    dispose(): void {
      material.dispose()
      farMaterial.dispose()
      // 【貼圖要自己收】material.dispose() 不會去收 uniform 裡的貼圖
      shoreTexture.dispose()
      tableTarget?.dispose()
      tableMaterial?.dispose()
      tableQuad?.geometry.dispose()
    },
  }
}
