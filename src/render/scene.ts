import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { createSky } from './sky'
import { createFog } from './fog'

/** 近平面，m。**沒有動過** —— 深度精度幾乎全由它決定。 */
export const CAMERA_NEAR = 1

/**
 * 遠平面，m。
 *
 * 【為什麼從 60 km 拉到 800 km】遠海半邊 250 km（半對角線 354 km），遠平面
 * 小於它的話遠海的角會被裁掉，而被裁掉的邊緣就是這一整件事正要消除的那條
 * 硬邊。
 *
 * 【深度精度的代價幾乎是零】解析度是 `Δz ≈ z²·(f−n)/(n·f·2²⁴)`，而 `f ≫ n`
 * 時 `(f−n)/(n·f) → 1/n`。近平面沒有動，所以近場精度不變 —— 100 m 處仍然
 * 是 0.6 mm。這個改動只把那個因子從 0.99998333 變成 0.99999875，差 1.5e-5。
 *
 * 【但「沒有變差」不等於「夠用」】決定 `Δz` 的是**近平面與距離**：12,000 m
 * 處是 8.58 m。遠海與細浪面只相距 3 m，所以高空俯視時兩者的深度分不出前後
 * —— 那是遠平面拉大之前就存在的限制，處置見 `ocean.ts` 的
 * `farMesh.renderOrder`。
 */
export const CAMERA_FAR = 800_000

export interface SceneContext {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  resize(): void
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = false // M1 不啟用陰影，見 spec §15

  const scene = new Scene()
  scene.add(createSky())
  // 【霧掛在 scene 上，逐材質生效】three 的 `material.fog` 預設為 true，
  // 所以飛機、海、參照物、殘骸、曳光彈、粒子全部吃霧。天空球是
  // `ShaderMaterial`（`fog` 預設 false）不吃 —— 正確，天空本來就是無限遠。
  // HUD 是另一張 2D canvas，與這裡無關。
  scene.fog = createFog()

  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  scene.add(sun)
  scene.add(new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9))
  scene.add(new AmbientLight(0xffffff, 0.15))

  const camera = new PerspectiveCamera(65, 1, CAMERA_NEAR, CAMERA_FAR)

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    // 第三個參數是 updateStyle。關掉的話 three 只設 canvas.width/height（＝
    // 緩衝區像素數），不設 CSS 尺寸——canvas 於是拿緩衝區像素數當 CSS 像素
    // 去排版。dpr=2 的螢幕上版面就變成視窗的兩倍大，只看得到左上四分之一，
    // 畫面中心跑到右下角。dpr=1 完全正常，所以很容易漏掉。
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  return { renderer, scene, camera, resize }
}
