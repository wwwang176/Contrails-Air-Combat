import {
  Color,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type FogExp2,
  type Mesh,
} from 'three'
import { applyLightPalette, createLights, type Lights } from './lighting'
import { applySkyPalette, createSky } from './sky'
import { createFog } from './fog'
import { DAY_PALETTES, paletteSkyColorAt, type DayPalette, type TimeOfDay } from './timeOfDay'

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
  /** 天空球。展示頁與 `__gfx` 的消融都要摸得到它。 */
  sky: Mesh
  lights: Lights
  /**
   * 換時段。**天空、霧、三盞燈一次到齊。**
   *
   * 【海不在這裡面】`Ocean` 是呼叫端自己建的（有的關卡沒有海），所以海那一半
   * 走 `Ocean.setPalette`。兩邊都要換的話用 `timeOfDay.ts` 的
   * `applyTimeOfDay`，那一支不會漏。
   */
  setPalette(p: DayPalette): void
  resize(): void
}

/** 給 `setPalette` 用的暫存。模組私有，禁止跨模組共用。 */
const FOG_SCRATCH = /* @__PURE__ */ new Color()

/**
 * @param timeOfDay 開局的時段。**預設正午** —— 那一組與時段功能上線前逐位元
 *   相同，所以沒有指定時段的關卡與所有既有基準線都不受影響。
 */
export function createScene(
  canvas: HTMLCanvasElement,
  timeOfDay: TimeOfDay = 'noon',
): SceneContext {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = false // M1 不啟用陰影，見 spec §15

  const scene = new Scene()
  const sky = createSky()
  scene.add(sky)
  // 【霧掛在 scene 上，逐材質生效】three 的 `material.fog` 預設為 true，
  // 所以飛機、參照物、殘骸、曳光彈、粒子都吃霧。天空球是 `ShaderMaterial`
  // （`fog` 預設 false）不吃 —— 正確，天空本來就是無限遠。
  // **海面自 2026-08-09 起明確關掉**（`ocean.ts` 的 `fog: false`），否則
  // 遠海會往天空色靠、地平線糊掉。HUD 是另一張 2D canvas，與這裡無關。
  scene.fog = createFog()

  // 【燈的定義在 `lighting.ts`】遠處的植被走 gl.POINTS，亮度是烘進頂點色的，
  // 而那個係數要拿真正的光照去校 —— 兩處各配一組燈的話係數會是錯的
  const lights = createLights()
  for (const l of lights.all) scene.add(l)

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

  /**
   * 【霧色跟著天空走】它就是**地平線上**的天空色（見 `fog.ts` 的
   * `FOG_COLOR`）。少了這一行，換到黃昏時遠處的飛機仍然往中午的淺藍化開。
   */
  const setPalette = (p: DayPalette): void => {
    applySkyPalette(sky, p)
    applyLightPalette(lights, p)
    const fog = scene.fog as FogExp2
    paletteSkyColorAt(0, p, FOG_SCRATCH)
    fog.color.copy(FOG_SCRATCH)
    fog.density = p.fogDensity
  }

  // 【一律走同一條路徑】正午那一組的每個欄位都直接引用原本的常數，所以這一行
  // 對 `'noon'` 是恆等 —— 而「建立時設一次」與「事後換」因此不會分家
  setPalette(DAY_PALETTES[timeOfDay])

  return { renderer, scene, camera, sky, lights, setPalette, resize }
}
