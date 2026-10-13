import { describe, expect, it } from 'vitest'
import {
  AlwaysDepth, Color, Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene,
  ShaderLib, SRGBColorSpace, Vector2, type WebGLRenderer, type WebGLRenderTarget,
} from 'three'
import {
  createLowResTransparencyPass,
  LOW_RES_TRANSPARENCY_LAYER,
  scaledTransparencySize,
  useLowResTransparency,
} from '../../src/render/lowResTransparency'

describe('scaledTransparencySize', () => {
  it('半邊長只保留四分之一像素', () => {
    expect(scaledTransparencySize(1920, 1080, 0.5)).toEqual({
      width: 960,
      height: 540,
    })
  })

  it('四分之一邊長至少保留一個像素', () => {
    expect(scaledTransparencySize(3, 2, 0.25)).toEqual({
      width: 1,
      height: 1,
    })
  })

  it('奇數尺寸取最近整數', () => {
    expect(scaledTransparencySize(1279, 719, 0.5)).toEqual({
      width: 640,
      height: 360,
    })
  })

  it('透明效果的整棵物件樹都移到低解析度圖層', () => {
    const root = new Group()
    const child = new Object3D()
    const grandchild = new Object3D()
    root.add(child)
    child.add(grandchild)

    useLowResTransparency(root)

    expect(root.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(child.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(grandchild.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(root.layers.isEnabled(0)).toBe(false)
  })

  it('原本的色彩複製繪製同時還原場景深度，不增加額外繪製', () => {
    let target: WebGLRenderTarget | null = null
    const draws: { scene: Scene; target: WebGLRenderTarget | null }[] = []
    const renderer = {
      capabilities: { maxSamples: 4 }, outputColorSpace: SRGBColorSpace, autoClear: true,
      getRenderTarget: () => target,
      setRenderTarget: (next: WebGLRenderTarget | null) => { target = next },
      getDrawingBufferSize: (out: Vector2) => out.set(64, 64),
      getClearAlpha: () => 1,
      getClearColor: (out: Color) => out.setRGB(0, 0, 0),
      setClearColor: () => {}, clear: () => {},
      render: (scene: Scene) => { draws.push({ scene, target }) },
    } as unknown as WebGLRenderer
    const pass = createLowResTransparencyPass(renderer)
    try {
      pass.render(new Scene(), new PerspectiveCamera())
      expect(draws).toHaveLength(5)
      const opaque = draws[0]!.target!
      const copy = (draws[3]!.scene.children[0] as Mesh).material as MeshBasicMaterial
      expect(copy.map).toBe(opaque.texture)
      expect(copy.depthTest).toBe(true)
      expect(copy.depthWrite).toBe(true)
      expect(copy.depthFunc).toBe(AlwaysDepth)
      const shader = { ...ShaderLib.basic!, uniforms: { ...ShaderLib.basic!.uniforms } }
      copy.onBeforeCompile(shader as Parameters<typeof copy.onBeforeCompile>[0], renderer)
      expect(shader.uniforms.fullDepthMap!.value).toBe(opaque.depthTexture)
      expect(shader.fragmentShader).toContain('gl_FragDepth = texture2D(fullDepthMap, vMapUv).x;')
      expect(shader.fragmentShader).toContain('#include <colorspace_fragment>')
      const composite = (draws[4]!.scene.children[0] as Mesh).material as MeshBasicMaterial
      expect(composite.depthWrite).toBe(false)
      expect(target).toBeNull()
      expect(renderer.autoClear).toBe(true)
    } finally { pass.dispose() }
  })
})
