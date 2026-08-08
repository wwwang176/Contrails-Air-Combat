import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three'

export interface WaveSpec {
  dirX: number
  dirZ: number
  amplitude: number
  /** 波長，公尺 */
  wavelength: number
  /** 相位速度，m/s */
  speed: number
}

/** 波參數的唯一權威來源：同時餵給 shader uniform 與 CPU 的 gerstnerHeight。 */
export const WAVES: readonly WaveSpec[] = [
  { dirX: 1.0, dirZ: 0.15, amplitude: 1.1, wavelength: 140, speed: 9.0 },
  { dirX: 0.55, dirZ: -0.84, amplitude: 0.7, wavelength: 78, speed: 7.2 },
  { dirX: -0.3, dirZ: 0.95, amplitude: 0.35, wavelength: 31, speed: 5.1 },
]

/**
 * CPU 端波高。必須與 shader 的頂點位移公式完全一致，
 * 否則會出現視覺與碰撞判定不一致。
 */
export function gerstnerHeight(x: number, z: number, time: number): number {
  let h = 0
  for (const w of WAVES) {
    const k = (Math.PI * 2) / w.wavelength
    h += w.amplitude * Math.sin(k * (w.dirX * x + w.dirZ * z) - w.speed * k * time)
  }
  return h
}

export const OCEAN_SIZE = 10000
export const OCEAN_SEGMENTS = 192

/**
 * 遠海的邊長，m。**這是一片平的四邊形，不是網格。**
 *
 * 【為什麼要 500 km】12,000 m（上帝視角的 `maxAltitude`）往下看時，半邊
 * 250 km 的邊緣落在俯角 `atan(12/250) ≈ 2.7°` —— 幾乎就在地平線上，而該處
 * 的霧已經吃滿（`fogFactor(250000, FOG_DENSITY) > 0.999`），看不到硬邊。
 *
 * 【為什麼不必分段】它是平的，分段沒有任何意義。霧是逐片段算的，所以顏色
 * 在整面上仍然是連續漸層。
 */
export const FAR_SEA_SIZE = 500_000

/**
 * 遠海的高度，m。
 *
 * 【為什麼是負的】三道波的振幅和是 2.15 m，細浪面的最低點因此是 −2.15。
 * 遠海放在 0 會在波谷之間穿插、產生 z-fighting。放在 −3 保證它在 ±5 km
 * 的範圍內**永遠被細浪面蓋住**。
 *
 * 代價是接縫處有一道 3 m 的落差 —— 在 5 km 外張角 0.6 mrad（0.034°），
 * 而 1080p / 65° FOV 的一個像素是 0.06°。落在一個像素以內。
 */
export const FAR_SEA_Y = -3

export interface Ocean {
  mesh: Mesh
  update(time: number, centerX: number, centerZ: number): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const material = new MeshStandardMaterial({
    color: 0x1d3f5c,
    roughness: 0.72,
    metalness: 0.05,
    flatShading: true,
  })

  const uTime = { value: 0 }
  const uOrigin = { value: new Vector2(0, 0) }

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = uTime
    shader.uniforms.uOrigin = uOrigin
    shader.uniforms.uWaveDir = { value: WAVES.map((w) => new Vector2(w.dirX, w.dirZ)) }
    shader.uniforms.uWaveAmp = { value: WAVES.map((w) => w.amplitude) }
    shader.uniforms.uWaveLen = { value: WAVES.map((w) => w.wavelength) }
    shader.uniforms.uWaveSpd = { value: WAVES.map((w) => w.speed) }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec2 uOrigin;
         uniform vec2 uWaveDir[${WAVES.length}];
         uniform float uWaveAmp[${WAVES.length}];
         uniform float uWaveLen[${WAVES.length}];
         uniform float uWaveSpd[${WAVES.length}];`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec2 worldXZ = transformed.xz + uOrigin;
         float waveH = 0.0;
         for (int i = 0; i < ${WAVES.length}; i++) {
           float k = 6.28318530718 / uWaveLen[i];
           waveH += uWaveAmp[i] * sin(k * dot(uWaveDir[i], worldXZ) - uWaveSpd[i] * k * uTime);
         }
         transformed.y += waveH;`,
      )
  }

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false // 隨玩家捲動，永遠可見

  return {
    mesh,
    update(time, centerX, centerZ) {
      uTime.value = time
      // 以網格單元對齊捲動，避免頂點在格點間滑動造成抖動
      const cell = OCEAN_SIZE / OCEAN_SEGMENTS
      const sx = Math.round(centerX / cell) * cell
      const sz = Math.round(centerZ / cell) * cell
      mesh.position.set(sx, 0, sz)
      uOrigin.value.set(sx, sz)
    },
    heightAt: gerstnerHeight,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
