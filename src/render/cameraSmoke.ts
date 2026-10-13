import {
  Color, Matrix3, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3,
  type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three'
import { cameraSmokeEnabled, cameraSmokeResponse, sampleCameraSmoke } from './cameraSmokeField'

/** 單層煙內遮罩：沿用煙霧貼圖，只蓋戰場，DOM／Canvas HUD 維持原本層級。 */
export function createCameraSmoke(texture: Texture) {
  const sample = { density: 0, diameter: 0, color: new Color() }
  const previous = new Vector3()
  const viewBackward = new Vector3()
  let initialized = false
  let time = 0
  const uniforms = {
    smokeMap: { value: texture },
    smokeColor: { value: new Color() },
    density: { value: 0 },
    diameter: { value: 10 },
    eye: { value: new Vector3() },
    viewRotation: { value: new Matrix3() },
    aspect: { value: 1 },
    tanHalfFov: { value: 1 },
    time: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      #include <common>
      uniform sampler2D smokeMap;
      uniform vec3 smokeColor;
      uniform float density;
      uniform float diameter;
      uniform vec3 eye;
      uniform mat3 viewRotation;
      uniform float aspect;
      uniform float tanHalfFov;
      uniform float time;
      varying vec2 vUv;
      // 使用素材中央區域並鏡射平鋪，避免黑色邊框與跨格接縫。
      vec2 smokeUv(vec2 p) { return 0.2 + 0.6 * abs(fract(p * 0.5) * 2.0 - 1.0); }
      void main() {
        vec2 screen = vUv * 2.0 - 1.0;
        vec3 ray = viewRotation * normalize(vec3(screen.x * aspect * tanHalfFov, screen.y * tanHalfFov, -1.0));
        // 紋理固定於世界空間，鏡頭平移與轉向都會穿過紋理，不是黏在眼前的隨機閃爍。
        vec3 p = (eye + ray * max(diameter, 3.0) * 0.55) / 24.0;
        p += vec3(time * 0.025, time * 0.013, time * 0.018);
        float grain = texture2D(smokeMap, smokeUv(p.xz)).g * 0.6
                    + texture2D(smokeMap, smokeUv(p.xy * 1.37 + 0.31)).g * 0.4;
        float alpha = 1.0 - exp(-density * (0.65 + grain * 0.7));
        gl_FragColor = vec4(smokeColor * (0.85 + grain * 0.3), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.name = 'cameraSmoke'
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  scene.add(new Mesh(geometry, material))

  return {
    /** 必須在戰場 render 前呼叫，粒子淡出與遮罩讀同一個鏡頭。 */
    update(world: Scene, view: PerspectiveCamera, frameSeconds: number, worldSeconds: number): void {
      view.updateWorldMatrix(true, false)
      cameraSmokeEnabled.value = 1
      viewBackward.setFromMatrixColumn(view.matrixWorld, 2).normalize()
      sampleCameraSmoke(world, view.position, sample, viewBackward)
      const distance = initialized ? previous.distanceTo(view.position) : 0
      const speed = distance / Math.max(frameSeconds, 0.0001)
      const blend = !initialized || distance > 100 ? 1 : cameraSmokeResponse(frameSeconds, speed)
      // 沒有煙就立即清除，換鏡頭／離開煙區不殘留遮罩。
      uniforms.density.value = sample.density === 0 ? 0
        : uniforms.density.value + (sample.density - uniforms.density.value) * blend
      if (sample.density > 0) {
        uniforms.smokeColor.value.copy(sample.color)
        uniforms.diameter.value = sample.diameter
      }
      previous.copy(view.position)
      initialized = true
      uniforms.eye.value.copy(view.position)
      uniforms.viewRotation.value.setFromMatrix4(view.matrixWorld)
      uniforms.aspect.value = view.aspect
      uniforms.tanHalfFov.value = Math.tan(view.fov * Math.PI / 360) / view.zoom
      time += worldSeconds
      uniforms.time.value = time
    },
    render(renderer: WebGLRenderer): void {
      if (uniforms.density.value < 0.001) return
      const autoClear = renderer.autoClear
      const autoReset = renderer.info.autoReset
      renderer.autoClear = false
      renderer.info.autoReset = false
      try { renderer.render(scene, camera) } finally {
        renderer.autoClear = autoClear
        renderer.info.autoReset = autoReset
      }
    },
    reset(): void {
      cameraSmokeEnabled.value = 0
      uniforms.density.value = 0
      initialized = false
      time = 0
    },
    dispose(): void { geometry.dispose(); material.dispose() },
  }
}
