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

const FULLSCREEN_VERTEX = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/**
 * Render ordinary geometry once at full resolution, downsample its depth, then
 * render transparent effects at a lower resolution. Depth-aware upsampling keeps
 * smoke from bleeding across full-resolution object silhouettes.
 */
export function createLowResTransparencyPass(
  renderer: WebGLRenderer,
  initialScale: TransparencyScale = 0.5,
): LowResTransparencyPass {
  const smokeTarget = new WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    type: HalfFloatType,
  })
  smokeTarget.texture.name = 'low-res-transparency'
  smokeTarget.texture.minFilter = LinearFilter
  smokeTarget.texture.magFilter = LinearFilter
  smokeTarget.texture.generateMipmaps = false
  smokeTarget.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
  smokeTarget.depthTexture.format = DepthFormat

  // Keep the original scene antialiasing when it is redirected offscreen. Three
  // resolves both color and depth before the following fullscreen passes sample it.
  const opaqueTarget = new WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
    samples: Math.min(4, renderer.capabilities.maxSamples),
  })
  opaqueTarget.texture.name = 'full-resolution-scene'
  opaqueTarget.texture.minFilter = LinearFilter
  opaqueTarget.texture.magFilter = LinearFilter
  opaqueTarget.texture.generateMipmaps = false
  opaqueTarget.texture.colorSpace = renderer.outputColorSpace
  opaqueTarget.depthTexture = new DepthTexture(1, 1, UnsignedIntType)
  opaqueTarget.depthTexture.format = DepthFormat

  const fullSize = new Vector2(1, 1)
  const lowSize = new Vector2(1, 1)
  const depthDownsampleMaterial = new ShaderMaterial({
    uniforms: {
      fullDepthMap: { value: opaqueTarget.depthTexture },
      fullSize: { value: fullSize },
      lowSize: { value: lowSize },
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: `
      uniform sampler2D fullDepthMap;
      uniform vec2 fullSize;
      uniform vec2 lowSize;
      varying vec2 vUv;

      float atOffset(vec2 offset) {
        return texture2D(fullDepthMap, clamp(vUv + offset, vec2(0.0), vec2(1.0))).x;
      }

      void main() {
        // Conservatively keep the nearest opaque sample covered by this low-res
        // pixel. Nine taps also work for the quarter-edge-size comparison mode.
        vec2 radius = max(vec2(0.0), 0.5 / lowSize - 0.5 / fullSize);
        float depth = atOffset(vec2(0.0));
        depth = min(depth, atOffset(vec2(-radius.x, -radius.y)));
        depth = min(depth, atOffset(vec2(0.0, -radius.y)));
        depth = min(depth, atOffset(vec2(radius.x, -radius.y)));
        depth = min(depth, atOffset(vec2(-radius.x, 0.0)));
        depth = min(depth, atOffset(vec2(radius.x, 0.0)));
        depth = min(depth, atOffset(vec2(-radius.x, radius.y)));
        depth = min(depth, atOffset(vec2(0.0, radius.y)));
        depth = min(depth, atOffset(vec2(radius.x, radius.y)));
        gl_FragDepth = depth;
        gl_FragColor = vec4(0.0);
      }
    `,
    colorWrite: false,
    // WebGL only updates the depth buffer while the depth test is enabled.
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  })

  const copyMaterial = new MeshBasicMaterial({
    map: opaqueTarget.texture,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })

  // The smoke target contains premultiplied alpha. Convert to straight alpha
  // before Three.js performs output conversion and premultiplies it again.
  const compositeMaterial = new ShaderMaterial({
    uniforms: {
      smokeMap: { value: smokeTarget.texture },
      lowDepthMap: { value: smokeTarget.depthTexture },
      fullDepthMap: { value: opaqueTarget.depthTexture },
      lowSize: { value: lowSize },
      cameraNear: { value: 1 },
      cameraFar: { value: 1_000_000 },
      depthAware: { value: true },
    },
    vertexShader: FULLSCREEN_VERTEX,
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

  const fullscreenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const quadGeometry = new PlaneGeometry(2, 2)
  const depthScene = new Scene()
  depthScene.add(new Mesh(quadGeometry, depthDownsampleMaterial))
  const copyScene = new Scene()
  copyScene.add(new Mesh(quadGeometry, copyMaterial))
  const compositeScene = new Scene()
  compositeScene.add(new Mesh(quadGeometry, compositeMaterial))

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
      smokeTarget.setSize(width, height)
      lowSize.set(width, height)
    }

    if (nextFullWidth !== fullWidth || nextFullHeight !== fullHeight) {
      fullWidth = nextFullWidth
      fullHeight = nextFullHeight
      opaqueTarget.setSize(fullWidth, fullHeight)
      fullSize.set(fullWidth, fullHeight)
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
    setDepthAware(next) {
      depthAware = next
      compositeMaterial.uniforms.depthAware!.value = next
    },
    render(scene, camera) {
      const savedTarget = renderer.getRenderTarget()
      const savedAutoClear = renderer.autoClear
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

        // Draw the full-resolution scene exactly once and retain its real depth.
        camera.layers.set(0)
        renderer.setRenderTarget(opaqueTarget)
        renderer.clear(true, true, true)
        renderer.render(scene, camera)

        // Seed the low-resolution hardware depth buffer from full-resolution depth.
        renderer.setRenderTarget(smokeTarget)
        renderer.setClearColor(0x000000, 0)
        renderer.clear(true, true, true)
        renderer.render(depthScene, fullscreenCamera)

        // Render just smoke against the conservative low-resolution depth.
        camera.layers.set(LOW_RES_TRANSPARENCY_LAYER)
        renderer.render(scene, camera)

        // Restore the full-resolution scene, then blend the upsampled smoke over it.
        renderer.setRenderTarget(savedTarget)
        renderer.setClearColor(savedClear, savedAlpha)
        renderer.clear(true, true, true)
        renderer.render(copyScene, fullscreenCamera)
        const perspective = camera as Camera & { near?: number; far?: number }
        compositeMaterial.uniforms.cameraNear!.value = perspective.near ?? 1
        compositeMaterial.uniforms.cameraFar!.value = perspective.far ?? 1_000_000
        renderer.render(compositeScene, fullscreenCamera)
      } finally {
        camera.layers.mask = savedLayers
        renderer.setClearColor(savedClear, savedAlpha)
        renderer.autoClear = savedAutoClear
        renderer.setRenderTarget(savedTarget)
      }
    },
    dispose() {
      smokeTarget.dispose()
      opaqueTarget.dispose()
      depthDownsampleMaterial.dispose()
      copyMaterial.dispose()
      compositeMaterial.dispose()
      quadGeometry.dispose()
    },
  }
}
