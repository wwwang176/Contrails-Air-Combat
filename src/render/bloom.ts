import {
  AdditiveBlending,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
  type Material,
  type Object3D,
  type Texture,
} from 'three'

/**
 * # 光暈（選擇性 bloom）
 *
 * 只有標在光暈圖層上的東西會暈開：火球、爆炸與火災的火焰、爆炸火花、照明彈
 * （寬的那一層），曳光彈、槍口焰、海面的碎光與太陽高光（窄的那一層）。天空、雲、
 * 海的本色不參與 —— 畫面是 8 位元 sRGB、沒有 HDR，用亮度門檻挑光源的話白天整片天
 * 會跟著暈。
 *
 * ```
 *   1  主場景照舊直接畫到畫布（這一支不碰）
 *   2  遮擋物（地形、佈景、飛機、船、地面單位）只寫深度，到光源圖
 *      （`BLOOM_LOW` 半解析度、`BLOOM_HIGH` 全解析度）
 *   3  窄光源（曳光彈、槍口焰、海面）畫到同一張，往下取樣兩層再疊回
 *   4  只清顏色、留著深度，寬光源畫到同一張，往下取樣四層再疊回
 *   5  兩份結果以加法疊回畫布
 * ```
 *
 * 【兩種寬度】海面的碎光小而多，暈開四層的話整片海蒙上一層霧；曳光彈是細線，
 * 暈開四層就糊成一顆圓球，看不出是一道火線。爆炸大而少，暈只開兩層又看不出在
 * 發光。兩者共用遮擋物的深度，所以遮擋只畫一次。
 *
 * 【主場景不改畫到離屏】那條路（`lowResTransparency.ts`）每幀多一次全解析度的
 * MSAA 解析與複製，Iris Xe 上約 13 ms，見 `main.ts` 煙那一段的註解。這裡的離屏圖
 * 都是半解析度以下，全解析度的只有最後那一趟疊加。
 *
 * 【遮擋物另標一層，不是整個場景重畫】煙、水霧這些半透明的東西不能擋光 ——
 * 火就在自己的煙裡。海面不當遮擋物：它的波浪在頂點著色器裡位移，換成只寫深度的
 * 材質就變回平面（它在光源那一趟用自己的材質畫，深度照樣寫）。植被不標：樹後面
 * 透一點光暈看不出來，而它的頂點數最多。
 *
 * 熱路徑：`render` 每幀一次，不配置。
 */

/** 寬光暈的圖層（爆炸、火、照明彈）。物件同時留在第 0 層，主場景照常畫它 */
export const BLOOM_LAYER = 2

/** 遮擋圖層。物件同時留在第 0 層，主場景照常畫它 */
export const OCCLUDER_LAYER = 3

/** 窄光暈的圖層（曳光彈、槍口焰、海面）。物件同時留在第 0 層，主場景照常畫它 */
export const BLOOM_NARROW_LAYER = 4

/** 把一個物件（連同它底下的）標成寬光暈的光源。物件要在建立時就掛好子物件 */
export function useBloom(root: Object3D): void {
  root.traverse((o) => o.layers.enable(BLOOM_LAYER))
}

/** 把一個物件（連同它底下的）標成窄光暈的光源。物件要在建立時就掛好子物件 */
export function useNarrowBloom(root: Object3D): void {
  root.traverse((o) => o.layers.enable(BLOOM_NARROW_LAYER))
}

/**
 * 把一個物件（連同它底下的）標成會擋住光暈的東西。**之後才掛上去的子物件不算**，
 * 要掛的時候自己再標一次。
 *
 * 【只給頂點不在著色器裡位移的網格】遮擋那一趟換成只寫深度的材質，位移會不見
 *
 * 【不寫深度的跳過】槳盤、座艙玻璃在主畫面裡不擋後面的東西（`depthWrite: false`）；
 * 標上去的話會被只寫深度的材質變成實心，透過槳盤看得到的火，光暈卻被整個截掉
 */
export function useBloomOccluder(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material
    if (m === undefined) return
    const list = Array.isArray(m) ? m : [m]
    if (list.some((x) => !x.depthWrite)) return
    o.layers.enable(OCCLUDER_LAYER)
  })
}

/** 疊回畫布時的強度。**起始值，由試看裁定** */
export const BLOOM_STRENGTH = 0.9

/**
 * 光源圖的解析度（畫布的幾成）與兩種光暈往下取樣的層數。
 *
 * 【層數跟著解析度走】暈的大小由最粗那一層在畫面上多大決定，而每一層是光源圖的
 * 一半。全解析度比半解析度多一層，最粗那一層才同樣是畫面的 1/32（寬）、1/8（窄）
 * —— 兩檔的暈一樣大，全解析度的邊緣更細
 */
export interface BloomQuality {
  readonly scale: number
  readonly wideLevels: number
  readonly narrowLevels: number
}

/**
 * 低：半解析度。高：全解析度，暈的邊緣更細。兩檔的光源圖都沒有抗鋸齒，遠處的
 * 曳光彈在上面都不到一個像素，都要放粗（`tracers.ts` 的 `TRACER_GLOW`）
 */
export const BLOOM_LOW: BloomQuality = { scale: 0.5, wideLevels: 4, narrowLevels: 2 }

export const BLOOM_HIGH: BloomQuality = { scale: 1, wideLevels: 5, narrowLevels: 3 }

const MAX_WIDE_LEVELS = 5
const MAX_NARROW_LEVELS = 3

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

/**
 * 疊回畫布。離屏圖是線性的，這裡轉成畫布的色彩空間再加上去。
 *
 * 【`wideOn`／`narrowOn` 非有不可】這一幀沒有那一種光源時，那一條整段跳過，
 * 它的圖還留著上一幀的內容 —— 不乘 0 的話，最後一發曳光彈的暈會一直掛在畫面上
 */
const COMPOSITE_FRAGMENT = `
  uniform sampler2D wide;
  uniform sampler2D narrow;
  uniform float wideOn;
  uniform float narrowOn;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(wide, vUv).rgb * wideOn + texture2D(narrow, vUv).rgb * narrowOn;
    gl_FragColor = vec4(c * strength, 1.0);
    #include <colorspace_fragment>
  }
`

export interface BloomPass {
  enabled: boolean
  /** 換解析度與層數。離屏圖下一次畫的時候照新的尺寸重配 */
  setQuality(q: BloomQuality): void
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

/**
 * 光源那兩趟的前後各叫一次（`on` 為 true、false）。給那些同一個材質在光暈裡要畫得
 * 不一樣的東西切換，兩者都在窄的那一趟：海面只留亮部（`ocean.ts` 的 `OCEAN_GLOW`），
 * 遠處的曳光彈放粗（`tracers.ts` 的 `TRACER_GLOW`）。`halfHeight` 是光源圖高度的一半，px
 */
export type GlowPassHook = (kind: 'narrow' | 'wide', on: boolean, halfHeight: number) => void

export function createBloomPass(
  renderer: WebGLRenderer, onGlowPass?: GlowPassHook,
): BloomPass {
  // 光源那一張帶深度：遮擋物的深度要留給兩種光源用，同一團火裡前後的火塊也要照常遮擋
  const source = lowTarget(true)
  const wide: WebGLRenderTarget[] = []
  for (let i = 0; i < MAX_WIDE_LEVELS; i++) wide.push(lowTarget(false))
  const narrow: WebGLRenderTarget[] = []
  for (let i = 0; i < MAX_NARROW_LEVELS; i++) narrow.push(lowTarget(false))
  let quality = BLOOM_LOW

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
    uniforms: {
      wide: { value: wide[0]!.texture }, narrow: { value: narrow[0]!.texture },
      wideOn: { value: 0 }, narrowOn: { value: 0 }, strength: { value: BLOOM_STRENGTH },
    },
    vertexShader: FULLSCREEN_VERTEX, fragmentShader: COMPOSITE_FRAGMENT,
    blending: AdditiveBlending, transparent: true,
    depthTest: false, depthWrite: false, toneMapped: false,
  })

  /**
   * 遮擋那一趟的材質：只寫深度。
   *
   * 【往後推一點】地面火與燃燒的殘骸貼著地表，遮擋深度與光源深度幾乎相同，半解析度
   * 下兩者會互相穿插，光暈跟著閃。推開幾個深度單位，貼著的那一層才照常亮
   */
  const occluderMaterial = new MeshBasicMaterial({
    colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
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
    const w = Math.max(1, Math.round(drawing.x * quality.scale))
    const h = Math.max(1, Math.round(drawing.y * quality.scale))
    if (w === width && h === height) return
    width = w
    height = h
    source.setSize(w, h)
    for (let i = 0; i < MAX_WIDE_LEVELS; i++) wide[i]!.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)))
    for (let i = 0; i < MAX_NARROW_LEVELS; i++) narrow[i]!.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)))
  }

  function pass(material: ShaderMaterial, src: Texture, target: WebGLRenderTarget | null): void {
    quad.material = material
    material.uniforms['src']!.value = src
    renderer.setRenderTarget(target)
    renderer.render(quadScene, quadCamera)
  }

  /**
   * 把光源圖往下取樣 `count` 層、再逐層疊回，結果在 `levels[0]`。
   * 每一層先清掉，往上疊的時候才不會留著上一幀
   */
  function blur(levels: readonly WebGLRenderTarget[], count: number): void {
    let src: Texture = source.texture
    let srcW = width
    let srcH = height
    for (let i = 0; i < count; i++) {
      downTexel.set(1 / srcW, 1 / srcH)
      renderer.setRenderTarget(levels[i]!)
      renderer.clear(true, false, false)
      pass(down, src, levels[i]!)
      src = levels[i]!.texture
      srcW = Math.max(1, width >> (i + 1))
      srcH = Math.max(1, height >> (i + 1))
    }
    for (let i = count - 1; i > 0; i--) {
      upTexel.set(1 / Math.max(1, width >> (i + 1)), 1 / Math.max(1, height >> (i + 1)))
      pass(up, levels[i]!.texture, levels[i - 1]!)
    }
  }

  const bloom: BloomPass = {
    enabled: true,
    setQuality(q) {
      quality = q
      // 尺寸記號歸零，下一次 resize 一定照新的解析度重配
      width = 0
      height = 0
    },
    render(scene, camera) {
      if (!bloom.enabled) return
      resize()
      const savedTarget = renderer.getRenderTarget()
      const savedAutoClear = renderer.autoClear
      const savedAlpha = renderer.getClearAlpha()
      renderer.getClearColor(savedClear)
      const savedLayers = camera.layers.mask
      const savedAutoUpdate = scene.matrixWorldAutoUpdate
      const savedOverride = scene.overrideMaterial
      // 【統計不歸零】three 每次 render 預設把 `info.render` 清掉，光暈這幾趟會蓋掉主場景
      // 的數字（`__renderInfo` 只剩最後那一個四邊形）。關掉之後是整幀的總數，
      // 每一趟有沒有畫到東西改看前後差
      const savedAutoReset = renderer.info.autoReset
      const info = renderer.info.render
      try {
        renderer.info.autoReset = false
        renderer.autoClear = false
        renderer.setClearColor(0x000000, 0)

        // 1. 遮擋物只寫深度。世界矩陣剛在主場景那一趟更新過，之後幾趟不再走一次整棵樹
        renderer.setRenderTarget(source)
        renderer.clear(true, true, false)
        scene.matrixWorldAutoUpdate = false
        camera.layers.set(OCCLUDER_LAYER)
        scene.overrideMaterial = occluderMaterial
        renderer.render(scene, camera)
        scene.overrideMaterial = savedOverride

        // 2. 窄光源。這一趟沒畫到任何東西就不模糊（例如內陸沒有海）
        camera.layers.set(BLOOM_NARROW_LAYER)
        onGlowPass?.('narrow', true, height / 2)
        let calls = info.calls
        renderer.render(scene, camera)
        onGlowPass?.('narrow', false, height / 2)
        const narrowOn = info.calls > calls
        if (narrowOn) blur(narrow, quality.narrowLevels)

        // 3. 寬光源。只清顏色：遮擋物與海面的深度留著照樣擋
        renderer.setRenderTarget(source)
        renderer.clear(true, false, false)
        camera.layers.set(BLOOM_LAYER)
        onGlowPass?.('wide', true, height / 2)
        calls = info.calls
        renderer.render(scene, camera)
        onGlowPass?.('wide', false, height / 2)
        const wideOn = info.calls > calls
        if (wideOn) blur(wide, quality.wideLevels)

        camera.layers.mask = savedLayers
        scene.matrixWorldAutoUpdate = savedAutoUpdate
        if (!narrowOn && !wideOn) return

        // 4. 疊回畫布
        composite.uniforms['wideOn']!.value = wideOn ? 1 : 0
        composite.uniforms['narrowOn']!.value = narrowOn ? 1 : 0
        quad.material = composite
        renderer.setRenderTarget(savedTarget)
        renderer.render(quadScene, quadCamera)
      } finally {
        renderer.info.autoReset = savedAutoReset
        onGlowPass?.('narrow', false, height / 2)
        onGlowPass?.('wide', false, height / 2)
        camera.layers.mask = savedLayers
        scene.matrixWorldAutoUpdate = savedAutoUpdate
        scene.overrideMaterial = savedOverride
        renderer.setClearColor(savedClear, savedAlpha)
        renderer.autoClear = savedAutoClear
        renderer.setRenderTarget(savedTarget)
      }
    },
    dispose() {
      source.dispose()
      for (const t of wide) t.dispose()
      for (const t of narrow) t.dispose()
      down.dispose()
      up.dispose()
      occluderMaterial.dispose()
      composite.dispose()
      quad.geometry.dispose()
    },
  }
  return bloom
}
