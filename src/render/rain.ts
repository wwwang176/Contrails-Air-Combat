import {
  BufferAttribute, BufferGeometry, Color, LineSegments, ShaderMaterial, Vector3, type Object3D,
} from 'three'

/**
 * # 雨
 *
 * 鏡頭周圍一個方盒裡的雨絲。**雨滴釘在世界座標上**：每一滴由自己的種子加上
 * `雨速 × 時間` 決定位置，再對方盒取餘數繞回鏡頭身邊 —— 鏡頭移動時雨從身邊
 * 掠過，視差是對的。
 *
 * 【雨絲沿著相對速度拉開】一滴雨在畫面上劃出的是它**相對鏡頭**的軌跡：
 * `雨速 − 鏡頭速度`（`rainRelativeVelocity`）。停著看是直直落下的短絲；
 * 高速往前飛時轉成迎面斜射過來的長絲，轉彎、爬升時跟著轉。
 *
 * 【鏡頭身邊與方盒邊緣淡掉】身邊 `NEAR_CLEAR` 以內不畫 —— 座艙視角時雨才不會
 * 穿進座艙；方盒邊緣淡掉 —— 繞回另一邊的那一下看不到。
 *
 * 每幀只寫幾個 uniform，不配置。
 */

/** 雨滴數 */
const DROPS = 14000
/** 方盒的邊長，m。雨只在鏡頭身邊這一塊 */
const BOX = 70
/** 雨在世界裡的速度，m/s：落速約 9 m/s，帶一點風 */
export const RAIN_VELOCITY: Readonly<{ x: number; y: number; z: number }> = { x: 2.5, y: -9, z: 1.2 }
/** 雨絲的「曝光時間」，s：長度 = 相對速度 × 它 */
const STREAK_SECONDS = 0.035
/** 雨絲長度的上下限，m。太短看不到、太長像一條線掃過畫面 */
const STREAK_MIN = 0.6
const STREAK_MAX = 5
/**
 * 雨絲越長越淡：一滴雨的亮度攤在整條絲上。這個長度以內不淡，m。
 * 少了它高速飛行時滿畫面都是亮線，像跳進光速。
 */
const STREAK_BRIGHT = 1.2
/** 鏡頭身邊這麼近的雨不畫，m */
const NEAR_CLEAR = 3
const COLOR = new Color(0xb4bec8)
const OPACITY = 0.45

/**
 * 雨相對鏡頭的速度，m/s：`RAIN_VELOCITY − camVel`。雨絲沿它的反方向從雨滴拖出。
 */
export function rainRelativeVelocity(camVel: Readonly<{ x: number; y: number; z: number }>, out: Vector3): Vector3 {
  return out.set(RAIN_VELOCITY.x - camVel.x, RAIN_VELOCITY.y - camVel.y, RAIN_VELOCITY.z - camVel.z)
}

const VERTEX = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uRel;
uniform vec3 uDrift;
uniform float uBox;
uniform float uStreak;
attribute vec3 aSeed;
attribute float aEnd;
varying float vAlpha;
void main() {
  // 雨滴的世界位置，繞回以鏡頭為中心的方盒裡
  vec3 p = aSeed * uBox + uDrift;
  p = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  float len = clamp(length(uRel) * uStreak, ${STREAK_MIN.toFixed(2)}, ${STREAK_MAX.toFixed(2)});
  vec3 dir = length(uRel) > 1e-3 ? normalize(uRel) : vec3(0.0, -1.0, 0.0);
  // 頭在雨滴上，尾巴往相對速度的反方向拖
  vec3 q = p - dir * len * aEnd;
  float edge = max(max(abs(p.x), abs(p.y)), abs(p.z)) / (0.5 * uBox);
  float near = smoothstep(${NEAR_CLEAR.toFixed(1)}, ${(NEAR_CLEAR * 2).toFixed(1)}, length(p));
  float spread = min(1.0, ${STREAK_BRIGHT.toFixed(2)} / len);
  vAlpha = (1.0 - smoothstep(0.75, 1.0, edge)) * near * (1.0 - 0.8 * aEnd) * spread;
  gl_Position = projectionMatrix * viewMatrix * vec4(q + uCam, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vAlpha);
}
`

export interface Rain {
  readonly object: Object3D
  /**
   * 每幀在鏡頭定位之後、渲染之前呼叫。
   *
   * @param camVel 鏡頭速度，m/s（`main.ts` 的 `camVel`）
   * @param time 這場雨下了多久，s。**暫停時不前進** —— 雨停在半空
   */
  update(camPos: Readonly<Vector3>, camVel: Readonly<Vector3>, time: number): void
  /** 目前的 uniform，給測試讀 —— shader 在無頭測試裡不會跑 */
  readonly uniforms: { readonly uCam: { value: Vector3 }; readonly uRel: { value: Vector3 }; readonly uDrift: { value: Vector3 } }
  dispose(): void
}

/** 種子序列：同一場雨每次長一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createRain(): Rain {
  const rand = makeRand(20260925)
  const seeds = new Float32Array(DROPS * 2 * 3)
  const ends = new Float32Array(DROPS * 2)
  for (let i = 0; i < DROPS; i++) {
    const x = rand()
    const y = rand()
    const z = rand()
    seeds.set([x, y, z, x, y, z], i * 6)
    ends[i * 2 + 1] = 1
  }
  const geometry = new BufferGeometry()
  // 【position 只是佔位】位置全在 shader 裡算；three 要它才知道有幾個頂點
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 2 * 3), 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3))
  geometry.setAttribute('aEnd', new BufferAttribute(ends, 1))

  const uniforms = {
    uCam: { value: new Vector3() },
    uRel: { value: new Vector3() },
    uDrift: { value: new Vector3() },
    uBox: { value: BOX },
    uStreak: { value: STREAK_SECONDS },
    uColor: { value: COLOR.clone() },
    uOpacity: { value: OPACITY },
  }
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
  })
  const lines = new LineSegments(geometry, material)
  // 【不裁】位置在 shader 裡算，包圍球是假的
  lines.frustumCulled = false

  return {
    object: lines,
    uniforms,
    update(camPos, camVel, time) {
      uniforms.uCam.value.copy(camPos)
      rainRelativeVelocity(camVel, uniforms.uRel.value)
      // 【飄移在這裡取餘數】世界時間一直長，在 shader 裡乘上雨速會掉 float32 的
      // 精度。這裡用雙精度算、對方盒取餘數 —— 差的是整數個方盒，shader 本來就
      // 對方盒取餘數，畫面上一模一樣
      uniforms.uDrift.value.set(
        (RAIN_VELOCITY.x * time) % BOX, (RAIN_VELOCITY.y * time) % BOX, (RAIN_VELOCITY.z * time) % BOX)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
