import { InstancedBufferAttribute, InstancedMesh, MeshBasicMaterial } from 'three'
import { createFireChunks } from './chunks'

/** 遊戲採用的表面配色；展示區以此為預設，可獨立調整。 */
export const FIRE_SURFACE = { strength: 0.65, density: 0.5 } as const

/** 保留球塊生命週期、深度與交接規則，加入附著於表面的立體燃燒紋理。 */
export function createTexturedFireChunks(
  pace: number,
  onFade: Parameters<typeof createFireChunks>[2],
  strength: { value: number } = { value: FIRE_SURFACE.strength },
  density: { value: number } = { value: FIRE_SURFACE.density },
  handoffAt?: number,
): ReturnType<typeof createFireChunks> {
  const pool = createFireChunks(undefined, pace, onFade, handoffAt)
  const mesh = pool.object
  if (!(mesh instanceof InstancedMesh) || !(mesh.material instanceof MeshBasicMaterial)) {
    throw new Error('火焰表面紋理需要球塊實例材質')
  }
  const phase = new Float32Array(mesh.count)
  for (let i = 0; i < phase.length; i++) phase[i] = (i * 0.61803398875 % 1) * 31
  mesh.geometry.setAttribute('aBurnPhase', new InstancedBufferAttribute(phase, 1))
  const time = { value: 0 }
  const material = mesh.material
  const originalCompile = material.onBeforeCompile
  const originalKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer): void => {
    originalCompile.call(material, shader, renderer)
    shader.uniforms.uBurnTime = time
    shader.uniforms.uBurnStrength = strength
    shader.uniforms.uBurnDensity = density
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      attribute float aBurnPhase;
      varying vec3 vBurnPosition;
      varying float vBurnPhase;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vBurnPosition = position;
      vBurnPhase = aBurnPhase;
    `)
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform float uBurnTime;
      uniform float uBurnStrength;
      uniform float uBurnDensity;
      varying vec3 vBurnPosition;
      varying float vBurnPhase;

      float burnHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float burnNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(burnHash(i), burnHash(i + vec3(1,0,0)), f.x),
              mix(burnHash(i + vec3(0,1,0)), burnHash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(burnHash(i + vec3(0,0,1)), burnHash(i + vec3(1,0,1)), f.x),
              mix(burnHash(i + vec3(0,1,1)), burnHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      if (uBurnStrength > 0.0) {
        // 用球塊自身座標取樣，紋理跨面連續，轉鏡頭時不會滑動。
        // 密度只縮放取樣座標，保留原本的雜訊層數與球塊數量。
        vec3 p = vBurnPosition * (5.5 * uBurnDensity) + vec3(vBurnPhase);
        p.y -= uBurnTime * 0.65;
        float broad = burnNoise(p);
        float detail = burnNoise(p * 2.15 + broad * 1.8);
        float fine = burnNoise(p * 5.1);
        float pattern = broad * 0.57 + detail * 0.33 + fine * 0.10;
        float hot = smoothstep(0.43, 0.72, pattern);
        float bright = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        // 開頭閃光時較淡、紅熱時最清楚；熄滅後不另生亮斑。
        float burning = smoothstep(0.008, 0.18, bright);
        float reveal = 1.0 - smoothstep(0.25, 0.65, diffuseColor.g) * 0.65;
        vec3 mottled = diffuseColor.rgb * mix(0.48, 1.15, hot);
        mottled += vec3(1.0, 0.28, 0.018) * hot * hot * bright * 0.65 * burning;
        diffuseColor.rgb = mix(diffuseColor.rgb, mottled, uBurnStrength * reveal * burning);
      }
    `)
  }
  material.customProgramCacheKey = () => originalKey + '-fire-surface-v2'
  const step = pool.step.bind(pool)
  const reset = pool.reset.bind(pool)
  pool.step = (dt): void => { time.value += dt; step(dt) }
  pool.reset = (): void => { time.value = 0; reset() }
  return pool
}
