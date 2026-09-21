import { Color, MeshBasicMaterial, Vector3 } from 'three'
import type { Particles } from './particles'
import { BLAST_LIGHT_COUNT, createBlastLightUniforms, type BlastLightUniforms } from './blastLights'

interface SmokeLightingShader {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
}

export interface SmokeLightingControl {
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
  setLight(direction: Vector3, color: Color, intensity: number): void
}

/**
 * 在已經套過 `injectBillboard` 的煙霧 shader 上加入便宜的假體積光照。
 *
 * 這不是粒子彼此投影的真正體積陰影。每張 billboard 被當成一顆有厚度的煙球：
 * 螢幕位置重建假法線，alphaMap 的濃度則近似光在煙裡走過的厚度。兩者合起來
 * 讓迎光側較亮、背光側與濃密核心較暗，而且不需要多畫一次煙霧。
 */
export function injectSmokeLighting(shader: SmokeLightingShader): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      'varying vec2 vSpunUv;',
      `varying vec2 vSpunUv;
       uniform vec3 uSmokeSunDirection;
       varying vec3 vSmokeSunDirectionView;
       varying vec3 vSmokeWorldCenter;`,
    )
    .replace(
      'vOffset = position.xy;',
      `vOffset = position.xy;
       // 太陽方向存世界座標；viewMatrix 讓同一套光照跟著鏡頭正確投影到 billboard。
       vSmokeSunDirectionView = normalize(mat3(viewMatrix) * uSmokeSunDirection);
       // 爆炸閃光逐顆煙算一次距離：用這一顆的中心，不逐片元重算
       vSmokeWorldCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      'varying vec2 vSpunUv;',
      `varying vec2 vSpunUv;
       uniform vec3 uSmokeSunColor;
       uniform float uSmokeSunAmount;
       uniform float uSmokeScatterStrength;
       uniform float uSmokeLightingEnabled;
       uniform vec3 uBlastLightPos[${BLAST_LIGHT_COUNT}];
       uniform vec3 uBlastLightColor[${BLAST_LIGHT_COUNT}];
       uniform float uBlastLightRadius[${BLAST_LIGHT_COUNT}];
       varying vec3 vSmokeSunDirectionView;
       varying vec3 vSmokeWorldCenter;`,
    )
    .replace(
      'diffuseColor.a *= texture2D( alphaMap, vSpunUv ).g;',
      `float smokeDensity = texture2D( alphaMap, vSpunUv ).g;
       diffuseColor.a *= smokeDensity;

       // 1. 假球體光照：billboard 上的位置重建一個朝鏡頭凸出的法線。
       vec2 smokeXY = clamp(vOffset * 2.0, vec2(-1.0), vec2(1.0));
       float smokeZ = sqrt(max(1.0 - dot(smokeXY, smokeXY), 0.0));
       vec3 smokeNormal = normalize(vec3(smokeXY, smokeZ));
       float sunFacing = dot(smokeNormal, normalize(vSmokeSunDirectionView));
       float directLight = smoothstep(-0.35, 0.85, sunFacing);

       // 2. 假自遮蔽：貼圖越濃代表光路越厚；背光核心因此最暗。
       float coreDensity = pow(clamp(smokeDensity, 0.0, 1.0), 1.35);
       float sideShade = mix(0.58, 1.0, directLight);
       float densityShade = 1.0 - coreDensity * mix(0.32, 0.12, directLight);
       float volumeShade = sideShade * densityShade;
       float lightWeight = uSmokeLightingEnabled * mix(0.25, 1.0, uSmokeSunAmount);

       // 薄的迎光處補少量帶太陽色的散射，避免只把原本已很黑的 0x1a 放大。
       // 爆炸煙把此值設為 0：它的黑→灰年齡曲線不能被固定亮色蓋掉。
       float scatter = directLight * (1.0 - coreDensity * 0.45)
         * uSmokeScatterStrength;
       diffuseColor.rgb *= mix(1.0, volumeShade, lightWeight);
       diffuseColor.rgb += uSmokeSunColor * scatter * uSmokeLightingEnabled;

       // 3. 爆炸閃光：固定 ${BLAST_LIGHT_COUNT} 盞（\`render/blastLights.ts\`），依這一顆煙的中心離
       //    燈的距離平滑衰減到半徑邊緣為 0。熄著的燈顏色是零，整項加 0。
       //    不看 uSmokeLightingEnabled —— 那一格關的是太陽的假體積光。
       vec3 blastLight = vec3(0.0);
       for (int i = 0; i < ${BLAST_LIGHT_COUNT}; i++) {
         float r = max(uBlastLightRadius[i], 1.0);
         vec3 toLight = vSmokeWorldCenter - uBlastLightPos[i];
         float k = clamp(1.0 - dot(toLight, toLight) / (r * r), 0.0, 1.0);
         blastLight += uBlastLightColor[i] * pow(k, ${BLAST_SMOKE_FALLOFF.toFixed(1)});
       }
       diffuseColor.rgb += blastLight * (1.0 - coreDensity * 0.5) * ${BLAST_SMOKE_GAIN.toFixed(3)};`,
    )
}

/**
 * 爆炸閃光照在煙上的衰減次方。**越大，遠一點的煙就越暗。**
 *
 * 【為什麼不是 2】`k = 1 − (d/r)²` 在半徑之內掉得很慢：次方 2 時，半徑一半處
 * 還有 56% 的亮度。爆炸的照射半徑 400 m 起跳（大當量更遠），於是幾百公尺外
 * 整片煙會一起亮。次方 4 時半徑一半剩 32%、四分之三處剩 3.7%。
 *
 * 照在地形與飛機上的是 `PointLight`，走物理的 1/d²；這一條是煙專用的近似，
 * 次方拉高等於往那個行為靠。**起始值，由試飛裁定。**
 */
export const BLAST_SMOKE_FALLOFF = 4

/**
 * 爆炸閃光照在煙上的增益。燈色 × 亮度比例 × 閃光尺度之後再乘這個數加到煙色上
 * —— 1 的話爆心旁的黑煙會整團變成燈色。**起始值，由試飛裁定。**
 */
export const BLAST_SMOKE_GAIN = 0.9

/** 沒接爆炸燈的煙共用這一份：每一盞都是熄的 */
const NO_BLAST_LIGHTS = createBlastLightUniforms()

/**
 * 只替指定煙池開啟實驗性光照。必須在它第一次 render 前呼叫。
 * 切換只改 uniform，不重建粒子、不重新編譯 shader。
 */
export function addSmokeLighting(
  particles: Particles,
  sunDirection: Vector3,
  sunColor: Color,
  sunIntensity = 1,
  // 黑煙只補一點迎光散射；再高會在正午讀成灰白蒸汽。
  scatterStrength = 0.012,
  // 【與地面同一盞光】傳 `BlastLights.smokeUniforms`；省略就是全部熄著
  blast: BlastLightUniforms = NO_BLAST_LIGHTS,
): SmokeLightingControl {
  const material = particles.object.material as MeshBasicMaterial
  const baseCompile = material.onBeforeCompile
  const enabledUniform = { value: 1 }
  const directionUniform = { value: sunDirection.clone().normalize() }
  const colorUniform = { value: sunColor.clone().multiplyScalar(sunIntensity) }
  const amountUniform = { value: Math.min(Math.max(sunIntensity / 2.2, 0), 1) }
  const scatterUniform = { value: Math.max(scatterStrength, 0) }

  material.onBeforeCompile = (shader, renderer): void => {
    baseCompile(shader, renderer)
    injectSmokeLighting(shader)
    shader.uniforms.uSmokeLightingEnabled = enabledUniform
    shader.uniforms.uSmokeSunDirection = directionUniform
    shader.uniforms.uSmokeSunColor = colorUniform
    shader.uniforms.uSmokeSunAmount = amountUniform
    shader.uniforms.uSmokeScatterStrength = scatterUniform
    shader.uniforms.uBlastLightPos = blast.uBlastLightPos
    shader.uniforms.uBlastLightColor = blast.uBlastLightColor
    shader.uniforms.uBlastLightRadius = blast.uBlastLightRadius
  }
  // onBeforeCompile 的閉包內容不會進 three 的預設 cache key；明確區隔實驗材質。
  const baseCacheKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = (): string => `${baseCacheKey()}|smoke-volume-light-v2`
  material.needsUpdate = true

  return {
    get enabled() { return enabledUniform.value > 0.5 },
    setEnabled(enabled) { enabledUniform.value = enabled ? 1 : 0 },
    setLight(direction, color, intensity) {
      directionUniform.value.copy(direction).normalize()
      colorUniform.value.copy(color).multiplyScalar(intensity)
      amountUniform.value = Math.min(Math.max(intensity / 2.2, 0), 1)
    },
  }
}
