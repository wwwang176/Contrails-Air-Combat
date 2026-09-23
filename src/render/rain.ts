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
 * 【雨絲沿著相對速度拉開】一滴雨在畫面上劃出的是它**相對鏡頭**的軌跡
 * （`rainApparentVelocity`）。停著看是斜落的短絲；高速往前飛時轉成迎面射過來
 * 的長絲，轉彎、爬升時跟著轉。
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
/**
 * 雨在世界裡的速度，m/s。**落速 9 m/s 是大雨滴（直徑 4～5 mm）的終端速度**，
 * 熱帶雷雨就是這個量級；帶一點風。
 */
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

/** 相對速度逐幀平滑的時間常數，s（真實時間）。幀時間的抖動不該變成雨絲的抖動 */
const REL_TAU = 0.05

/**
 * 雨滴這一幀在鏡頭眼裡的速度，m/s（每**真實**秒）：雨在世界時間裡走的路，
 * 減掉鏡頭這一幀的位移，除以真實的幀時間。雨絲沿它的反方向從雨滴拖出。
 *
 * 【為什麼不拿現成的鏡頭速度】上帝視角的鏡頭照真實時間移動、最快好幾百 m/s，
 * 而音訊那一份用世界時間相除、超過 400 m/s 就當瞬移歸零 —— 雨滴明明正高速
 * 掠過，雨絲卻直直往下，兩者對不上。這裡算的就是雨滴在畫面上實際的移動，
 * 暫停、慢動作、上帝視角都一致。
 *
 * @param camStep 鏡頭這一幀的位移，m
 * @param worldDt 這一幀世界前進的時間，s（暫停時 0）
 * @param frameDt 這一幀的真實時間，s。**必須 > 0**
 */
export function rainApparentVelocity(
  camStep: Readonly<{ x: number; y: number; z: number }>, worldDt: number, frameDt: number, out: Vector3,
): Vector3 {
  return out.set(
    (RAIN_VELOCITY.x * worldDt - camStep.x) / frameDt,
    (RAIN_VELOCITY.y * worldDt - camStep.y) / frameDt,
    (RAIN_VELOCITY.z * worldDt - camStep.z) / frameDt,
  )
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
   * @param worldDt 這一幀世界前進的時間，s。**暫停時 0** —— 雨停在半空
   * @param frameDt 這一幀的真實時間，s
   */
  update(camPos: Readonly<Vector3>, worldDt: number, frameDt: number): void
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
    // 【開場當作鏡頭停著】第一幀還沒有位移可算
    uRel: { value: new Vector3(RAIN_VELOCITY.x, RAIN_VELOCITY.y, RAIN_VELOCITY.z) },
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

  const prevCam = new Vector3()
  let prevValid = false
  const step = new Vector3()
  const rel = new Vector3()
  // 【飄移用雙精度累加、對方盒取餘數】在 shader 裡拿世界時間乘雨速會掉 float32
  // 的精度；差的是整數個方盒，shader 本來就對方盒取餘數，畫面上一模一樣
  let dx = 0
  let dy = 0
  let dz = 0

  return {
    object: lines,
    uniforms,
    update(camPos, worldDt, frameDt) {
      dx = (dx + RAIN_VELOCITY.x * worldDt) % BOX
      dy = (dy + RAIN_VELOCITY.y * worldDt) % BOX
      dz = (dz + RAIN_VELOCITY.z * worldDt) % BOX
      uniforms.uDrift.value.set(dx, dy, dz)
      uniforms.uCam.value.copy(camPos)

      if (!prevValid || !(frameDt > 0)) {
        prevCam.copy(camPos)
        prevValid = true
        return
      }
      step.subVectors(camPos, prevCam)
      prevCam.copy(camPos)
      // 【換鏡頭不是速度】一幀跳過半個方盒以上 —— 切視角、重生 —— 這一幀不算
      if (step.length() > BOX / 2) return
      rainApparentVelocity(step, worldDt, frameDt, rel)
      uniforms.uRel.value.lerp(rel, 1 - Math.exp(-frameDt / REL_TAU))
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
