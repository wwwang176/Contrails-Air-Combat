import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { createSky } from './sky'

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

  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  scene.add(sun)
  scene.add(new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9))
  scene.add(new AmbientLight(0xffffff, 0.15))

  const camera = new PerspectiveCamera(65, 1, 1, 60000)

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
