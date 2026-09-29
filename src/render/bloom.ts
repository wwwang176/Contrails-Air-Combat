import {
  AdditiveBlending,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
  type Object3D,
  type Texture,
} from 'three'

/**
 * # 光暈（選擇性 bloom）
 *
 * 只有標在 `BLOOM_LAYER` 上的東西會暈開：曳光彈、槍口焰、火球、爆炸與火災的
 * 火焰、照明彈。天空、雲、海面反光不參與 —— 畫面是 8 位元 sRGB、沒有 HDR，
 * 用亮度門檻挑光源的話白天整片天會跟著暈。
 *
 * ```
 *   1  主場景照舊直接畫到畫布（這一支不碰）
 *   2  只畫光暈圖層，到半解析度的離屏圖
 *   3  1/4 → 1/32 往下取樣，再逐層往上疊回 1/4（dual Kawase）
 *   4  1/4 那一張以加法疊回畫布
 * ```
 *
 * 【主場景不改畫到離屏】那條路（`lowResTransparency.ts`）每幀多一次全解析度的
 * MSAA 解析與複製，Iris Xe 上約 13 ms，見 `main.ts` 煙那一段的註解。這裡的離屏圖
 * 都是半解析度以下，全解析度的只有最後那一趟疊加。
 *
 * 【沒有遮擋】光暈圖層不讀主場景的深度：躲在機身或山後面的火，光暈照樣透出來。
 *
 * 熱路徑：`render` 每幀一次，不配置。
 */

/** 光暈圖層。物件同時留在第 0 層，主場景照常畫它 */
export const BLOOM_LAYER = 2

/** 把一個物件（連同它底下的）標成光源。物件要在建立時就掛好子物件 */
export function useBloom(root: Object3D): void {
  root.traverse((o) => o.layers.enable(BLOOM_LAYER))
}

/** 疊回畫布時的強度。**起始值，由試看裁定** */
export const BLOOM_STRENGTH = 0.9

/** 往下取樣幾層：半解析度之下的 1/4、1/8、1/16、1/32 */
const LEVELS = 4

const FULLSCREEN_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** 往下取樣：中心加四角，四角各取在半個像素的交界上，一次讀到 16 個像素 */
const DOWN_FRAGMENT = `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(src, vUv) * 4.0;
    s += texture2D(src, vUv - texel);
    s += texture2D(src, vUv + texel);
    s += texture2D(src, vUv + vec2(texel.x, -texel.y));
    s += texture2D(src, vUv - vec2(texel.x, -texel.y));
    gl_FragColor = s / 8.0;
  }
`

/** 往上取樣：八點的帳篷濾波。以加法疊到下一層原本的內容上，各尺度一起留著 */
const UP_FRAGMENT = `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(src, vUv + vec2(-2.0 * texel.x, 0.0));
    s += texture2D(src, vUv + vec2(-texel.x, texel.y)) * 2.0;
    s += texture2D(src, vUv + vec2(0.0, 2.0 * texel.y));
    s += texture2D(src, vUv + vec2(texel.x, texel.y)) * 2.0;
    s += texture2D(src, vUv + vec2(2.0 * texel.x, 0.0));
    s += texture2D(src, vUv + vec2(texel.x, -texel.y)) * 2.0;
    s += texture2D(src, vUv + vec2(0.0, -2.0 * texel.y));
    s += texture2D(src, vUv + vec2(-texel.x, -texel.y)) * 2.0;
    gl_FragColor = s / 12.0;
  }
`

/** 疊回畫布。離屏圖是線性的，這裡轉成畫布的色彩空間再加上去 */
const COMPOSITE_FRAGMENT = `
  uniform sampler2D src;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(src, vUv).rgb * strength, 1.0);
    #include <colorspace_fragment>
  }
`

export interface BloomPass {
  enabled: boolean
  /** 主場景畫完之後呼叫。`enabled` 為 false 時什麼都不做 */
  render(scene: Scene, camera: Camera): void
  dispose(): void
}

function lowTarget(depth: boolean): WebGLRenderTarget {
  const t = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: depth, stencilBuffer: false })
  t.texture.minFilter = LinearFilter
  t.texture.magFilter = LinearFilter
  t.texture.generateMipmaps = false
  return t
}

export function createBloomPass(renderer: WebGLRenderer): BloomPass {
  // 光源那一張帶深度：同一團火裡前後的火塊要照常遮擋
  const source = lowTarget(true)
  const levels: WebGLRenderTarget[] = []
  for (let i = 0; i < LEVELS; i++) levels.push(lowTarget(false))

  const downTexel = new Vector2()
  const upTexel = new Vector2()
  const down = new ShaderMaterial({
    uniforms: { src: { value: null as Texture | null }, texel: { value: downTexel } },
    vertexShader: FULLSCREEN_VERTEX, fragmentShader: DOWN_FRAGMENT,
    depthTest: false, depthWrite: false, toneMapped: false,
  })
  const up = new ShaderMaterial({
    uniforms: { src: { value: null as Texture | null }, texel: { value: upTexel } },
    vertexShader: FULLSCREEN_VERTEX, fragmentShader: UP_FRAGMENT,
    blending: AdditiveBlending, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false,
  })
  const composite = new ShaderMaterial({
    uniforms: { src: { value: levels[0]!.texture }, strength: { value: BLOOM_STRENGTH } },
    vertexShader: FULLSCREEN_VERTEX, fragmentShader: COMPOSITE_FRAGMENT,
    blending: AdditiveBlending, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false,
  })

  const quad = new Mesh(new PlaneGeometry(2, 2), down)
  quad.frustumCulled = false
  const quadScene = new Scene()
  quadScene.add(quad)
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const drawing = new Vector2()
  const savedClear = new Color()
  let width = 0
  let height = 0

  function resize(): void {
    renderer.getDrawingBufferSize(drawing)
    const w = Math.max(1, Math.round(drawing.x / 2))
    const h = Math.max(1, Math.round(drawing.y / 2))
    if (w === width && h === height) return
    width = w
    height = h
    source.setSize(w, h)
    for (let i = 0; i < LEVELS; i++) {
      levels[i]!.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)))
    }
  }

  function pass(material: ShaderMaterial, src: Texture, target: WebGLRenderTarget | null): void {
    quad.material = material
    material.uniforms['src']!.value = src
    renderer.setRenderTarget(target)
    renderer.render(quadScene, quadCamera)
  }

  const bloom: BloomPass = {
    enabled: true,
    render(scene, camera) {
      if (!bloom.enabled) return
      resize()
      const savedTarget = renderer.getRenderTarget()
      const savedAutoClear = renderer.autoClear
      const savedAlpha = renderer.getClearAlpha()
      renderer.getClearColor(savedClear)
      const savedLayers = camera.layers.mask
      const savedAutoUpdate = scene.matrixWorldAutoUpdate
      try {
        renderer.autoClear = false
        renderer.setClearColor(0x000000, 0)

        // 1. 光源。世界矩陣剛在主場景那一趟更新過，這一趟不再走一次整棵樹
        renderer.setRenderTarget(source)
        renderer.clear(true, true, false)
        camera.layers.set(BLOOM_LAYER)
        scene.matrixWorldAutoUpdate = false
        renderer.render(scene, camera)
        camera.layers.mask = savedLayers
        scene.matrixWorldAutoUpdate = savedAutoUpdate
        // 這一幀沒有任何光源：模糊與疊加全部省掉
        if (renderer.info.render.calls === 0) return

        // 2. 往下取樣。每一層先清掉，往上疊的時候才不會留著上一幀
        let src: Texture = source.texture
        let srcW = width
        let srcH = height
        for (let i = 0; i < LEVELS; i++) {
          downTexel.set(1 / srcW, 1 / srcH)
          renderer.setRenderTarget(levels[i]!)
          renderer.clear(true, false, false)
          pass(down, src, levels[i]!)
          src = levels[i]!.texture
          srcW = Math.max(1, width >> (i + 1))
          srcH = Math.max(1, height >> (i + 1))
        }

        // 3. 往上取樣，加到上一層原本的內容上
        for (let i = LEVELS - 1; i > 0; i--) {
          upTexel.set(1 / Math.max(1, width >> (i + 1)), 1 / Math.max(1, height >> (i + 1)))
          pass(up, levels[i]!.texture, levels[i - 1]!)
        }

        // 4. 疊回畫布
        pass(composite, levels[0]!.texture, savedTarget)
      } finally {
        camera.layers.mask = savedLayers
        scene.matrixWorldAutoUpdate = savedAutoUpdate
        renderer.setClearColor(savedClear, savedAlpha)
        renderer.autoClear = savedAutoClear
        renderer.setRenderTarget(savedTarget)
      }
    },
    dispose() {
      source.dispose()
      for (const t of levels) t.dispose()
      down.dispose()
      up.dispose()
      composite.dispose()
      quad.geometry.dispose()
    },
  }
  return bloom
}
