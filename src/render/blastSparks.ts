import {
  BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  ShaderMaterial, Vector3,
} from 'three'
import { coneDirection, hash01 } from './scatter'

/**
 * # 爆炸噴出的火星
 *
 * 每次爆炸挑幾個方向，每個方向噴一束細小的方點：先快速衝出去，
 * 被空氣拖住之後慢慢往下飄；顏色由白轉黃並維持大半壽命，最後才轉紅、轉黑而消失。
 *
 * 【位置由 GPU 算】一波齊投幾十顆炸彈同時爆，每顆幾百顆火星 —— 兩三萬顆
 * 逐幀在 CPU 更新太重。運動有解析解（`sparkOffset`），所以發射時只寫起點、
 * 初速與出生時間，之後每一幀的位置由頂點著色器照同一條公式算。
 *
 * 【不透明】粒子只有一兩個像素大，看不出半透明；不透明不必排序，也不和
 * 煙的混色互相干擾。
 */

/** 每一束幾顆 */
export const SPARKS_PER_CONE = 100
/** 一次爆炸最少幾束；實際是這個到 `+ SPARK_CONES_EXTRA` */
export const SPARK_CONES_MIN = 2
export const SPARK_CONES_EXTRA = 1
/**
 * 每一束的截面是橢圓：長軸方向的半角是這個，短軸是它的 `SPARK_BEAM_ASPECT_MIN`
 * 到 `SPARK_BEAM_ASPECT_MAX` 倍，長軸繞束的中心線隨機轉一個角度。
 * 窄到讀得出「一條一條」，寬到不像一根針。
 */
export const SPARK_BEAM_CONE = 12 * (Math.PI / 180)
export const SPARK_BEAM_ASPECT_MIN = 0.15
export const SPARK_BEAM_ASPECT_MAX = 0.35
/**
 * 落地爆炸時各束的方向離天頂最多幾度。**只往上半邊噴** —— 往地下噴的
 * 那一半一出生就被地面吃掉。空中的爆炸四面八方。
 */
export const SPARK_GROUND_SPREAD = 70 * (Math.PI / 180)
/**
 * 最快那一顆衝到火球半徑的幾倍。噴多遠跟著火球的大小走 —— 火星是從火球裡
 * 甩出來的，比例固定才不會小彈噴得比火球還短、大彈噴得像煙火。
 *
 * 同一束裡的初速取最快那一顆的 `SPARK_SPEED_MIN_RATIO` 到 1 倍 —— 快慢不一，
 * 一束才拉得成一條線而不是一團。
 *
 * 【非線性分布】隨機數取 `SPARK_SPEED_SKEW` 次方：大部分偏慢、聚在爆心附近，
 * 少數特別快、拉出長長的尾巴。均勻分布看起來像一整條等密度的線。
 */
export const SPARK_FIRE_REACH = 3
export const SPARK_SPEED_MIN_RATIO = 0.15
export const SPARK_SPEED_SKEW = 2
/**
 * 空氣阻力，s⁻¹。衝出去的距離約為 初速 ÷ 阻力，
 * 之後的下墜終端速度是 `SPARK_GRAVITY` ÷ 阻力（約 8 m/s）——
 * 這就是「快速噴射、較慢墜落」。
 */
export const SPARK_BURST_DRAG = 2.5
/**
 * 火星受的重力，m/s²。比真實重力大：只調這一項能加快下墜，
 * 不改噴出去的距離（那由初速與阻力決定）。
 */
export const SPARK_GRAVITY = 20
/**
 * 顏色的抖動。每一顆有一點固定的色偏（黃裡偏橘或偏淡），亮度再以
 * `SPARK_FLICKER_HZ` 的頻率上下閃，每一顆的頻率與相位都不同。
 * 隨機值由初速算出來，不必多傳一個屬性。
 */
export const SPARK_HUE_JITTER = 0.15
export const SPARK_FLICKER = 0.3
export const SPARK_FLICKER_HZ_MIN = 4
export const SPARK_FLICKER_HZ_MAX = 9
/** 壽命，s：這個到再加 `SPARK_LIFE_JITTER` */
export const SPARK_BURST_LIFE = 2.6
export const SPARK_LIFE_JITTER = 1.2
/**
 * 顏色的節點，壽命的比例：出生是白，到 `SPARK_YELLOW_AT` 變成黃並維持到
 * `SPARK_YELLOW_UNTIL`，到 `SPARK_RED_AT` 變成紅，到 `SPARK_BLACK_AT` 全黑，
 * 壽命結束時消失。
 */
export const SPARK_YELLOW_AT = 0.15
export const SPARK_YELLOW_UNTIL = 0.9
export const SPARK_RED_AT = 0.95
export const SPARK_BLACK_AT = 1
/** 方點的邊長，m */
export const SPARK_BURST_SIZE = 0.1
/**
 * 至少畫幾個像素寬。遠處的火星會小於一個像素，一閃一閃甚至看不到；
 * 給一個下限，遠處的仍讀得出是一顆亮點。
 */
export const SPARK_MIN_PIXELS = 1
/** 離鏡頭超過這個距離的爆炸不噴，m。那麼遠只剩一兩個像素的一小撮 */
export const SPARK_BURST_CULL = 3000
/**
 * 池子大小。一波 40 顆的齊投 × 每顆最多 300 顆 = 12000，壽命 4 s 內疊得起來；
 * 滿了就從最舊的開始蓋。整個池子每幀都畫，不要開得比需要的大。
 */
export const SPARK_BURST_CAPACITY = 16384

/**
 * 出生後 `age` 秒離起點的位移（寫進 `out`）。**著色器裡是同一條公式**。
 *
 * 速度 v' = −k(v − v∞)，v∞ = (0, −g/k, 0)，g = `SPARK_GRAVITY`：
 * p = v₀·E/k + v∞·(t − E/k)，E = 1 − e^{−kt}
 */
export function sparkOffset(
  vx: number, vy: number, vz: number, age: number, drag: number, out: Vector3,
): Vector3 {
  const e = 1 - Math.exp(-drag * age)
  const fall = (SPARK_GRAVITY / drag) * (age - e / drag)
  return out.set(vx * e / drag, vy * e / drag - fall, vz * e / drag)
}
export interface BlastSparks {
  object: Mesh
  /**
   * 噴一次。`fireRadius` 是這一團爆炸的火球半徑，m（`blastFireRadius`）；
   * 最快的一顆衝到它的 `SPARK_FIRE_REACH` 倍。`floorY` 以下的火星熄掉。
   * `upward` 為真時只往上半邊噴。`vx..vz` 是爆心繼承的速度。
   */
  burst(
    x: number, y: number, z: number, floorY: number, fireRadius: number, upward: boolean, seed: number,
    now: number, camX: number, camY: number, camZ: number, vx?: number, vy?: number, vz?: number,
  ): void
  /** 每幀一次：把時間與像素尺度交給著色器、把這一幀寫過的區段上傳 */
  step(now: number, fovRad: number, viewportHeightPx: number): void
  reset(): void
  dispose(): void
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uDrag;
uniform float uPixel;
attribute vec3 aOrigin;
attribute vec3 aVel;
/** 出生時間、壽命、邊長、熄滅高度 */
attribute vec4 aBirth;
varying vec3 vColor;

void main() {
  float age = uTime - aBirth.x;
  float t = age / aBirth.y;
  float e = 1.0 - exp(-uDrag * age);
  vec3 p = aOrigin + aVel * (e / uDrag);
  p.y -= (${SPARK_GRAVITY.toFixed(3)} / uDrag) * (age - e / uDrag);
  if (age < 0.0 || t >= 1.0 || p.y < aBirth.w) {
    // 丟到裁切範圍外：四個角落在同一點，不產生任何像素
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec3(0.0);
    return;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = max(aBirth.z, ${SPARK_MIN_PIXELS.toFixed(2)} * uPixel * -mv.z);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  // 白 → 黃（維持一段）→ 紅 → 黑
  vec3 white = vec3(1.0);
  vec3 yellow = vec3(1.0, 0.85, 0.2);
  vec3 red = vec3(0.9, 0.08, 0.02);
  vColor = mix(white, yellow, smoothstep(0.0, ${SPARK_YELLOW_AT.toFixed(2)}, t));
  vColor = mix(vColor, red, smoothstep(${SPARK_YELLOW_UNTIL.toFixed(2)}, ${SPARK_RED_AT.toFixed(2)}, t));
  vColor = mix(vColor, vec3(0.0), smoothstep(${SPARK_RED_AT.toFixed(2)}, ${SPARK_BLACK_AT.toFixed(2)}, t));
  // 抖動：每一顆兩個 0..1 的隨機值，由初速雜湊出來
  float h1 = fract(sin(dot(aVel, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float h2 = fract(h1 * 91.7361);
  vColor.g *= 1.0 + ${SPARK_HUE_JITTER.toFixed(3)} * (h1 * 2.0 - 1.0);
  float hz = ${SPARK_FLICKER_HZ_MIN.toFixed(2)} + ${(SPARK_FLICKER_HZ_MAX - SPARK_FLICKER_HZ_MIN).toFixed(2)} * h2;
  vColor *= 1.0 - ${SPARK_FLICKER.toFixed(3)} * (0.5 + 0.5 * sin(age * hz * 6.28318 + h1 * 6.28318));
}
`

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`

const DIR = new Vector3()
const BEAM = new Vector3()
/** 束截面橢圓的長軸與短軸方向，都垂直於 `BEAM` */
const MAJOR = new Vector3()
const MINOR = new Vector3()

/** 以 `BEAM`（單位向量）為中心線，長軸繞它轉 `roll` 弳，寫進 `MAJOR`／`MINOR` */
function beamAxes(roll: number): void {
  // 與 BEAM 最不平行的座標軸，拿來造切線
  const ax = Math.abs(BEAM.x)
  const ay = Math.abs(BEAM.y)
  const az = Math.abs(BEAM.z)
  if (ax <= ay && ax <= az) MAJOR.set(1, 0, 0)
  else if (ay <= az) MAJOR.set(0, 1, 0)
  else MAJOR.set(0, 0, 1)
  MAJOR.cross(BEAM).normalize()
  MINOR.copy(BEAM).cross(MAJOR)
  const c = Math.cos(roll)
  const s = Math.sin(roll)
  // 同時轉兩軸：MAJOR' = c·MAJOR + s·MINOR，MINOR' = BEAM × MAJOR'
  MAJOR.multiplyScalar(c).addScaledVector(MINOR, s)
  MINOR.copy(BEAM).cross(MAJOR)
}

export function createBlastSparks(capacity = SPARK_BURST_CAPACITY): BlastSparks {
  const geometry = new InstancedBufferGeometry()
  // 一個朝向鏡頭的方形面片：兩個三角形。小到看不出立體，不必是立方體
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const origin = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const vel = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const birth = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  for (const a of [origin, vel, birth]) a.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aOrigin', origin)
  geometry.setAttribute('aVel', vel)
  geometry.setAttribute('aBirth', birth)
  geometry.instanceCount = capacity

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uDrag: { value: SPARK_BURST_DRAG },
      uPixel: { value: 0 },
    },
  })
  const object = new Mesh(geometry, material)
  object.name = 'blastSparks'
  // 【不做視錐剔除】位置在著色器裡才算出來，three 的包圍球是那一個面片的
  object.frustumCulled = false

  const ob = origin.array as Float32Array
  const vb = vel.array as Float32Array
  const bb = birth.array as Float32Array
  let cursor = 0
  /** 這一幀寫過的範圍（實例索引，含頭不含尾）。繞回開頭時整條重傳 */
  let dirtyLo = capacity
  let dirtyHi = 0

  function clear(): void {
    for (let i = 0; i < capacity; i++) bb[i * 4] = -1e9
    cursor = 0
    dirtyLo = 0
    dirtyHi = capacity
  }
  clear()

  return {
    object,
    burst(x, y, z, floorY, fireRadius, upward, seed, now, camX, camY, camZ, vx = 0, vy = 0, vz = 0) {
      if (Math.hypot(x - camX, y - camY, z - camZ) > SPARK_BURST_CULL) return
      const cones = SPARK_CONES_MIN + Math.floor(hash01(seed * 7 + 3) * (SPARK_CONES_EXTRA + 1))
      const top = SPARK_FIRE_REACH * fireRadius * SPARK_BURST_DRAG
      for (let c = 0; c < cones; c++) {
        coneDirection(0, 1, 0, upward ? SPARK_GROUND_SPREAD : Math.PI, seed * 31 + c * 5 + 1, BEAM)
        beamAxes(hash01(seed * 53 + c * 7 + 2) * Math.PI)
        const minor = SPARK_BEAM_CONE * (SPARK_BEAM_ASPECT_MIN
          + (SPARK_BEAM_ASPECT_MAX - SPARK_BEAM_ASPECT_MIN) * hash01(seed * 59 + c * 11 + 3))
        for (let k = 0; k < SPARKS_PER_CONE; k++) {
          const n = seed * 977 + c * 131 + k
          // 橢圓截面內均勻取一點：半徑取平方根，面積上才均勻、不擠在中心
          const r = Math.sqrt(hash01(n * 7 + 5))
          const phi = hash01(n * 11 + 6) * Math.PI * 2
          DIR.copy(BEAM)
            .addScaledVector(MAJOR, Math.tan(r * Math.cos(phi) * SPARK_BEAM_CONE))
            .addScaledVector(MINOR, Math.tan(r * Math.sin(phi) * minor))
            .normalize()
          const speed = top * (SPARK_SPEED_MIN_RATIO + (1 - SPARK_SPEED_MIN_RATIO) * hash01(n * 3 + 2) ** SPARK_SPEED_SKEW)
          const i = cursor
          cursor = (cursor + 1) % capacity
          if (cursor === 0) {
            dirtyLo = 0
            dirtyHi = capacity
          } else {
            if (i < dirtyLo) dirtyLo = i
            if (i + 1 > dirtyHi) dirtyHi = i + 1
          }
          ob[i * 3] = x
          ob[i * 3 + 1] = y
          ob[i * 3 + 2] = z
          vb[i * 3] = DIR.x * speed + vx
          vb[i * 3 + 1] = DIR.y * speed + vy
          vb[i * 3 + 2] = DIR.z * speed + vz
          bb[i * 4] = now
          bb[i * 4 + 1] = SPARK_BURST_LIFE + SPARK_LIFE_JITTER * hash01(n * 5 + 4)
          bb[i * 4 + 2] = SPARK_BURST_SIZE
          bb[i * 4 + 3] = floorY
        }
      }
    },
    step(now, fovRad, viewportHeightPx) {
      const u = material.uniforms
      u['uTime']!.value = now
      // 深度 1 m 處一個像素多寬，m
      u['uPixel']!.value = (2 * Math.tan(fovRad / 2)) / Math.max(1, viewportHeightPx)
      if (dirtyHi <= dirtyLo) return
      origin.clearUpdateRanges()
      vel.clearUpdateRanges()
      birth.clearUpdateRanges()
      origin.addUpdateRange(dirtyLo * 3, (dirtyHi - dirtyLo) * 3)
      vel.addUpdateRange(dirtyLo * 3, (dirtyHi - dirtyLo) * 3)
      birth.addUpdateRange(dirtyLo * 4, (dirtyHi - dirtyLo) * 4)
      origin.needsUpdate = true
      vel.needsUpdate = true
      birth.needsUpdate = true
      dirtyLo = capacity
      dirtyHi = 0
    },
    reset: clear,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
