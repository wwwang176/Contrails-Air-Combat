import { Color, MeshBasicMaterial, Vector3 } from 'three'
import type { Particles } from './particles'

interface SmokeLightingShader {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
}

export interface SmokeLightingControl {
  readonly enabled: boolean
  setEnabled(enabled: boolean): void
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
       varying vec3 vSmokeSunDirectionView;`,
    )
    .replace(
      'vOffset = position.xy;',
      `vOffset = position.xy;
       // 太陽方向存世界座標；viewMatrix 讓同一套光照跟著鏡頭正確投影到 billboard。
       vSmokeSunDirectionView = normalize(mat3(viewMatrix) * uSmokeSunDirection);`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      'varying vec2 vSpunUv;',
      `varying vec2 vSpunUv;
       uniform vec3 uSmokeSunColor;
       uniform float uSmokeLightingEnabled;
       varying vec3 vSmokeSunDirectionView;`,
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

       // 薄的迎光處補少量帶太陽色的散射，避免只把原本已很黑的 0x1a 放大。
       float scatter = directLight * (1.0 - coreDensity * 0.45) * 0.018;
       diffuseColor.rgb *= mix(1.0, volumeShade, uSmokeLightingEnabled);
       diffuseColor.rgb += uSmokeSunColor * scatter * uSmokeLightingEnabled;`,
    )
}

/**
 * 只替指定煙池開啟實驗性光照。必須在它第一次 render 前呼叫。
 * 切換只改 uniform，不重建粒子、不重新編譯 shader。
 */
export function addSmokeLighting(
  particles: Particles,
  sunDirection: Vector3,
  sunColor: Color,
  sunIntensity = 1,
): SmokeLightingControl {
  const material = particles.object.material as MeshBasicMaterial
  const baseCompile = material.onBeforeCompile
  const enabledUniform = { value: 1 }
  const directionUniform = { value: sunDirection.clone().normalize() }
  const colorUniform = { value: sunColor.clone().multiplyScalar(sunIntensity) }

  material.onBeforeCompile = (shader, renderer): void => {
    baseCompile(shader, renderer)
    injectSmokeLighting(shader)
    shader.uniforms.uSmokeLightingEnabled = enabledUniform
    shader.uniforms.uSmokeSunDirection = directionUniform
    shader.uniforms.uSmokeSunColor = colorUniform
  }
  // onBeforeCompile 的閉包內容不會進 three 的預設 cache key；明確區隔實驗材質。
  const baseCacheKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = (): string => `${baseCacheKey()}|smoke-volume-light-v1`
  material.needsUpdate = true

  return {
    get enabled() { return enabledUniform.value > 0.5 },
    setEnabled(enabled) { enabledUniform.value = enabled ? 1 : 0 },
  }
}
