import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color, Vector3 } from 'three'

/**
 * 天空球半徑，m。
 *
 * 【與相機遠平面的關係】遠平面是 `CAMERA_FAR`（`render/scene.ts`）。天空球
 * 跟著相機走，所以它永遠在視野正中央，只要半徑落在近平面與遠平面之間即可。
 *
 * 【為什麼遠海比它還大卻沒問題】遠海半邊 250 km，遠大於這顆球。但天空球
 * `depthWrite: false` 而且 `renderOrder = −1000` —— 先畫、不寫深度，所以
 * 任何東西都蓋得過它。它是背景不是物件。
 */
export const SKY_RADIUS = 40000

/**
 * 天空球的地平色與天頂色。
 *
 * 【為什麼要具名】`fog.ts` 的霧色必須比地平色暗一階，否則遠海化進霧色之後
 * 會與天空同色、地平線消失（見 `FOG_COLOR`）。那條關係要被測試釘住，而釘
 * 它需要這個值有名字 —— 原本它是 `uniforms` 字面量裡的一個 magic number。
 * 純粹是取名，值沒有動。
 */
export const SKY_HORIZON = 0x9fc3d8
export const SKY_ZENITH = 0x1f4f80

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 horizon;
  uniform vec3 zenith;
  varying vec3 vDir;
  void main() {
    float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizon, zenith, pow(t, 0.65)), 1.0);
  }
`

/**
 * 漸層天空球。關閉深度寫入並設定 renderOrder，永遠在最遠處。
 *
 * 【天空球必須跟著相機走】它半徑 40 km 而相機遠平面是 60 km。固定在原點的
 * 話，飛出 40 km 就會**從殼外面看它**，而場景沒有設定 clear color ——
 * 球以外的方向全部是黑的。更早出現的症狀是「破洞」：接近殼壁時近平面
 * （1 m）會切過球面，被切掉的那幾塊沒有任何東西畫上去。
 *
 * 海面本來就會跟著相機重新置中（見 ocean.ts 的 `update`），天空是漏的
 * 那一個。
 *
 * 【為什麼用 onBeforeRender 而不是叫 main.ts 每幀設一次】天空跟著相機是
 * 它自己的不變量，不是呼叫端要記得做的事。寫在這裡，任何人把它加進場景
 * 都自動成立。
 */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      horizon: { value: new Color(SKY_HORIZON) },
      zenith: { value: new Color(SKY_ZENITH) },
    },
    side: BackSide,
    depthWrite: false,
  })
  const mesh = new Mesh(new SphereGeometry(1, 24, 16), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  mesh.scale.setScalar(SKY_RADIUS)
  mesh.matrixAutoUpdate = false
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    followCamera(mesh, camera.position)
  }
  // 建立時就擺好，讓「還沒 render 過」的狀態也是一致的
  followCamera(mesh, ORIGIN)
  return mesh
}

const ORIGIN = new Vector3()

/**
 * 把天空球移到 `eye`，並自行更新世界矩陣。
 *
 * `matrixAutoUpdate` 關掉是因為 three 在 `onBeforeRender` **之前**就走完了
 * 場景圖的矩陣更新 —— 只設 `position` 的話這一幀還是用舊矩陣畫，天空會
 * 落後一幀。落後一幀在 200 m/s 下是 3.3 m，遠小於 40 km 的半徑因此看不
 * 出來；但它是一個會在別處咬人的壞習慣，直接更新掉。
 */
function followCamera(mesh: Mesh, eye: Vector3): void {
  mesh.position.copy(eye)
  mesh.updateMatrix()
  mesh.updateMatrixWorld(true)
}
