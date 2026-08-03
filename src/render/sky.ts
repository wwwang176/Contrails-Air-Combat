import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Color, Vector3 } from 'three'

/**
 * 天空球半徑，m。
 *
 * 【與相機遠平面的關係】遠平面是 60 km（見 render/scene.ts）。天空球跟著
 * 相機走，所以它永遠在視野正中央，只要半徑落在近平面與遠平面之間即可。
 * 40 km 留了 1.5 倍的餘裕，同時遠大於任何場景物件（海面 10 km）。
 */
export const SKY_RADIUS = 40000

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
      horizon: { value: new Color(0x9fc3d8) },
      zenith: { value: new Color(0x1f4f80) },
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
