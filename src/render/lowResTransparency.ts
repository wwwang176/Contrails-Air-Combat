import {
  Color,
  DepthFormat,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
} from 'three'

/** Keep low-resolution transparent effects separate from the regular scene. */
export const LOW_RES_TRANSPARENCY_LAYER = 1

export type TransparencyScale = 1 | 0.5 | 0.25

export interface LowResTransparencyPass {
  readonly scale: TransparencyScale
  readonly depthAware: boolean
  readonly width: number
  readonly height: number
  setScale(scale: TransparencyScale): void
  setDepthAware(enabled: boolean): void
  render(scene: Scene, camera: Camera): void
  dispose(): void
}

/** Move a transparent effect and every child it owns to the low-resolution layer. */
export function useLowResTransparency(root: Object3D): void {
  root.traverse((object) => object.layers.set(LOW_RES_TRANSPARENCY_LAYER))
}

export function scaledTransparencySize(
  width: number,
  height: number,
  scale: TransparencyScale,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Render ordinary geometry at full resolution and transparent effects at a lower
 * resolution. The optional depth-aware upsampler uses the full-resolution opaque
 * depth buffer to avoid blending smoke across object silhouettes.
 */
export function createLowResTransparencyPass(
  renderer: WebGLRenderer,
  initialScale: TransparencyScale = 0.5,
): LowResTransparencyPass {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    type: HalfFloatType,
  })
  target.texture.name = 'low-res-transparency'
  target.texture.minFilter = LinearFilter
  target.texture.magFilter = LinearFilter
  target.texture.generateMipmaps = false
  target.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
  target.depthTexture.format = DepthFormat

  const fullDepthTarget = new WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
  })
  fullDepthTarget.texture.name = 'full-resolution-depth'
  fullDepthTarget.texture.generateMipmaps = false
  fullDepthTarget.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
  fullDepthTarget.depthTexture.format = DepthFormat

  const depthOnly = new MeshBasicMaterial({
    colorWrite: false,
    depthTest: true,
    depthWrite: true,
  })

  // The smoke target contains premultiplied alpha. Convert to straight alpha
  // before Three.js performs output conversion and premultiplies it again.
  const compositeMaterial = new ShaderMaterial({
    uniforms: {
      smokeMap: { value: target.texture },
      lowDepthMap: { value: target.depthTexture },
      fullDepthMap: { value: fullDepthTarget.depthTexture },
      lowSize: { value: new Vector2(1, 1) },
      cameraNear: { value: 1 },
      cameraFar: { value: 1_000_000 },
      depthAware: { value: true },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D smokeMap;
      uniform sampler2D lowDepthMap;
      uniform sampler2D fullDepthMap;
      uniform vec2 lowSize;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform bool depthAware;
      varying vec2 vUv;

      float viewDistance(float depth) {
        float viewZ = (cameraNear * cameraFar)
          / ((cameraFar - cameraNear) * depth - cameraFar);
        return max(-viewZ, cameraNear);
      }

      vec4 depthAwareSmoke() {
        vec2 at = vUv * lowSize - 0.5;
        vec2 blend = fract(at);
        vec2 base = (floor(at) + 0.5) / lowSize;
        vec2 texel = 1.0 / lowSize;

        vec2 uv0 = clamp(base, vec2(0.0), vec2(1.0));
        vec2 uv1 = clamp(base + vec2(texel.x, 0.0), vec2(0.0), vec2(1.0));
        vec2 uv2 = clamp(base + vec2(0.0, texel.y), vec2(0.0), vec2(1.0));
        vec2 uv3 = clamp(base + texel, vec2(0.0), vec2(1.0));

        float fullLogZ = log2(viewDistance(texture2D(fullDepthMap, vUv).x));
        float d0 = abs(log2(viewDistance(texture2D(lowDepthMap, uv0).x)) - fullLogZ);
        float d1 = abs(log2(viewDistance(texture2D(lowDepthMap, uv1).x)) - fullLogZ);
        float d2 = abs(log2(viewDistance(texture2D(lowDepthMap, uv2).x)) - fullLogZ);
        float d3 = abs(log2(viewDistance(texture2D(lowDepthMap, uv3).x)) - fullLogZ);

        vec4 spatial = vec4(
          (1.0 - blend.x) * (1.0 - blend.y),
          blend.x * (1.0 - blend.y),
          (1.0 - blend.x) * blend.y,
          blend.x * blend.y
        );
        vec4 weight = spatial * exp2(-vec4(d0, d1, d2, d3) * 12.0);
        float total = dot(weight, vec4(1.0));
        // A horizon can fall between every low-resolution depth sample. Returning
        // transparent here exposes a one-pixel strip of the bright opaque scene.
        // Fall back to the ordinary filtered smoke instead of punching a hole.
        if (total < 0.00001) return texture2D(smokeMap, vUv);

        return (
          texture2D(smokeMap, uv0) * weight.x
          + texture2D(smokeMap, uv1) * weight.y
          + texture2D(smokeMap, uv2) * weight.z
          + texture2D(smokeMap, uv3) * weight.w
        ) / total;
      }

      void main() {
        vec4 smoke = depthAware
          ? depthAwareSmoke()
          : texture2D(smokeMap, vUv);
        if (smoke.a > 0.00001) smoke.rgb /= smoke.a;
        gl_FragColor = smoke;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const compositeScene = new Scene()
  const compositeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const compositeQuad = new Mesh(new PlaneGeometry(2, 2), compositeMaterial)
  compositeScene.add(compositeQuad)

  const drawingSize = new Vector2()
  const savedClear = new Color()
  let scale = initialScale
  let depthAware = true
  let width = 1
  let height = 1
  let fullWidth = 1
  let fullHeight = 1

  function resizeTargets(): void {
    renderer.getDrawingBufferSize(drawingSize)
    const nextFullWidth = Math.max(1, Math.round(drawingSize.x))
    const nextFullHeight = Math.max(1, Math.round(drawingSize.y))
    const next = scaledTransparencySize(nextFullWidth, nextFullHeight, scale)

    if (next.width !== width || next.height !== height) {
      width = next.width
      height = next.height
      target.setSize(width, height)
      compositeMaterial.uniforms.lowSize!.value.set(width, height)
    }

    if (nextFullWidth !== fullWidth || nextFullHeight !== fullHeight) {
      fullWidth = nextFullWidth
      fullHeight = nextFullHeight
      fullDepthTarget.setSize(fullWidth, fullHeight)
    }
  }

  return {
    get scale() { return scale },
    get depthAware() { return depthAware },
    get width() { return width },
    get height() { return height },
    setScale(next) {
      scale = next
      resizeTargets()
    },
    setDepthAware(enabled) {
      depthAware = enabled
      compositeMaterial.uniforms.depthAware!.value = enabled
    },
    render(scene, camera) {
      const savedTarget = renderer.getRenderTarget()
      const savedAutoClear = renderer.autoClear
      const savedOverride = scene.overrideMaterial
      const savedLayers = camera.layers.mask
      const savedAlpha = renderer.getClearAlpha()
      renderer.getClearColor(savedClear)

      try {
        renderer.autoClear = false

        if (scale === 1) {
          camera.layers.enable(LOW_RES_TRANSPARENCY_LAYER)
          renderer.setRenderTarget(savedTarget)
          renderer.clear(true, true, true)
          renderer.render(scene, camera)
          return
        }

        resizeTargets()

        // Draw the opaque scene normally at full resolution.
        camera.layers.set(0)
        renderer.setRenderTarget(savedTarget)
        renderer.clear(true, true, true)
        renderer.render(scene, camera)

        // Capture a full-resolution opaque depth reference only when requested.
        if (depthAware) {
          renderer.setRenderTarget(fullDepthTarget)
          renderer.setClearColor(0x000000, 0)
          renderer.clear(true, true, true)
          scene.overrideMaterial = depthOnly
          renderer.render(scene, camera)
          scene.overrideMaterial = savedOverride
        }

        // Fill the low-resolution opaque depth buffer without writing color.
        renderer.setRenderTarget(target)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, true, true)
        scene.overrideMaterial = depthOnly
        renderer.render(scene, camera)
        scene.overrideMaterial = savedOverride
        renderer.clear(true, false, false)

        // Render just the transparent layer against the preserved depth buffer.
        camera.layers.set(LOW_RES_TRANSPARENCY_LAYER)
        renderer.render(scene, camera)

        // Composite smoke over the already-rendered full-resolution scene.
        renderer.setRenderTarget(savedTarget)
        const perspective = camera as Camera & { near?: number; far?: number }
        compositeMaterial.uniforms.cameraNear!.value = perspective.near ?? 1
        compositeMaterial.uniforms.cameraFar!.value = perspective.far ?? 1_000_000
        renderer.render(compositeScene, compositeCamera)
      } finally {
        camera.layers.mask = savedLayers
        scene.overrideMaterial = savedOverride
        renderer.setClearColor(savedClear, savedAlpha)
        renderer.autoClear = savedAutoClear
        renderer.setRenderTarget(savedTarget)
      }
    },
    dispose() {
      target.dispose()
      fullDepthTarget.dispose()
      depthOnly.dispose()
      compositeQuad.geometry.dispose()
      compositeMaterial.dispose()
    },
  }
}
