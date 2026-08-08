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

/**
 * 海的基本色。細浪面與遠海**必須共用**這一個值 —— 兩份會漂開，而漂開的
 * 症狀是 5 km 處出現一條色帶。
 */
export const SEA_COLOR = 0x1d3f5c

export interface Ocean {
  mesh: Mesh
  /**
   * 遠海。**平的、單色、只有兩個三角形**，墊在細浪面底下把海接到地平線。
   *
   * 見 `FAR_SEA_SIZE` / `FAR_SEA_Y` 與下方 `renderOrder` 的註解。
   */
  farMesh: Mesh
  update(time: number, centerX: number, centerZ: number): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}

export function createOcean(): Ocean {
  const geometry = new PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const material = new MeshStandardMaterial({
    color: SEA_COLOR,
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

  // 遠海。用 MeshStandardMaterial 而不是 Basic：要跟細浪面接得上就得受同一
  // 組燈光。roughness / metalness 全部沿用細浪面的值。
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, 1, 1)
  farGeometry.rotateX(-Math.PI / 2)
  const farMaterial = new MeshStandardMaterial({
    color: SEA_COLOR,
    roughness: 0.72,
    metalness: 0.05,
  })
  const farMesh = new Mesh(farGeometry, farMaterial)
  farMesh.frustumCulled = false // 隨鏡頭捲動，永遠可見
  // 建立時就擺好，讓「還沒 update 過」的狀態也是一致的（與 sky.ts 同一招）
  farMesh.position.y = FAR_SEA_Y
  /**
   * 【`renderOrder` 非設不可】遠海與細浪面只相距 3 m，而深度量化
   * `Δz ≈ z²·(f−n)/(n·f·2²⁴) ≈ z²/2²⁴`（近平面 1 m）在 7,000 m 是 2.92 m、
   * 12,000 m 是 8.58 m —— 上帝視角 7,000 m 以上，整片細浪面（永遠是 ±5 km）
   * 的深度都與遠海**分不出前後**。
   *
   * 平手時誰贏由繪製順序決定，而 three 的不透明排序是
   * `renderOrder → material.id → z`（`WebGLRenderLists.js` 的
   * `painterSortStable`）—— **`material.id` 排在 `z` 前面**。不設的話順序
   * 只是「誰先 new 材質」的巧合：細浪面的材質先建、id 較小、因此先畫，
   * 遠海後畫；而預設的 `depthFunc` 是 `LessEqualDepth`，於是**後畫的遠海
   * 勝出，把浪蓋掉**。
   *
   * −1 讓遠海先畫，平手時細浪面與參照物勝出（仍遠大於天空球的 −1000）。
   * 這不是把順序「排對」——那做不到，同 `assembly.ts` 那段關於曳光彈與
   * 模糊圓盤的討論 —— 而是把平手的倒向固定成正確的那一邊。成本是一次
   * 全螢幕 overdraw，兩個三角形，可忽略。
   */
  farMesh.renderOrder = -1

  return {
    mesh,
    farMesh,
    update(time, centerX, centerZ) {
      uTime.value = time
      // 以網格單元對齊捲動，避免頂點在格點間滑動造成抖動
      const cell = OCEAN_SIZE / OCEAN_SEGMENTS
      const sx = Math.round(centerX / cell) * cell
      const sz = Math.round(centerZ / cell) * cell
      mesh.position.set(sx, 0, sz)
      uOrigin.value.set(sx, sz)
      // 【遠海不做格點對齊】對齊是為了避免頂點在格點之間滑動造成波形抖動，
      // 而遠海沒有波。精確跟著中心走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)
    },
    heightAt: gerstnerHeight,
    dispose() {
      geometry.dispose()
      material.dispose()
      farGeometry.dispose()
      farMaterial.dispose()
    },
  }
}
