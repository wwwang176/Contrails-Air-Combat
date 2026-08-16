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
 * 【它只有一個約束】必須大於遠海的**半對角線**（`FAR_SEA_SIZE / 2 × √2`
 * = 4,243 km），否則遠海的四個角會被裁掉，而被裁掉的邊緣就是一條硬邊。
 * 2026-08-09 遠海由半邊 250 km 放大到 3,000 km（見 `ocean.ts` 的
 * `FAR_SEA_SIZE`），這裡跟著由 800 km 拉到 5,000 km。
 *
 * 【深度精度的代價幾乎是零】解析度是 `Δz ≈ z²·(f−n)/(n·f·2^bits)`，而
 * `f ≫ n` 時 `(f−n)/(n·f) → 1/n`。**近平面沒有動**，所以近場精度不變。
 * 這次只把那個因子從 0.99999875 變成 0.9999998。
 *
 * 【但那個計算假設 24-bit 深度緩衝，而 WebGL 只保證 16 bit】24-bit 下
 * 100 m 處是 0.6 mm、12,000 m 處是 8.58 m；16-bit 下是 0.15 m 與 2.2 km。
 * **這是遠平面拉到 800 km 時就存在的事，不是後來引入的** —— `f ≫ n` 之後
 * 精度幾乎只由近平面決定。實際位元數由 `battlefield-visuals.e2e.ts` 讀
 * `gl.getParameter(gl.DEPTH_BITS)` 記錄。
 *
 * 【遠海與細浪面只相距 3 m】高空俯視時兩者的深度分不出前後 —— 既有的限制，
 * 處置見 `ocean.ts` 的 `farMesh.renderOrder`。那個 `renderOrder` 只固定
 * 平手的倒向，不會增加深度精度。
 */
export const CAMERA_FAR = 5_000_000

/**
 * 垂直視角，度。
 *
 * 【為什麼是具名常數而不是建構子裡的 65】任何「這個東西在 N 公里外佔螢幕
 * 多少」的推導都要用到它 —— 撤離圓環的半徑就是這樣定的（任務框架 spec
 * §6.4）。留在建構子裡的話那些推導會各自抄一份 65，而抄本不會跟著改。
 */
export const CAMERA_FOV_DEG = 65

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
  // 所以飛機、參照物、殘骸、曳光彈、粒子都吃霧。天空球是 `ShaderMaterial`
  // （`fog` 預設 false）不吃 —— 正確，天空本來就是無限遠。
  // **海面自 2026-08-09 起明確關掉**（`ocean.ts` 的 `fog: false`），否則
  // 遠海會往天空色靠、地平線糊掉。HUD 是另一張 2D canvas，與這裡無關。
  scene.fog = createFog()

  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  scene.add(sun)
  scene.add(new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9))
  scene.add(new AmbientLight(0xffffff, 0.15))

  const camera = new PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR)

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
