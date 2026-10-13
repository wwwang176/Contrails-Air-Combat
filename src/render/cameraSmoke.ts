import {
  Matrix3, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3,
  type PerspectiveCamera, type Texture, type WebGLRenderer,
} from 'three'
import { cameraSmokeEnabled, cameraSmokeResponse } from './cameraSmokeField'
import { createCameraSmokeMask } from './cameraSmokeMask'
import { createCameraSmokeProjection } from './cameraSmokeProjection'

/** 空間煙霧與鏡頭內霧分開合成；原煙片與遮罩共用逐顆交接程度。 */
export function createCameraSmoke(texture: Texture) {
  const mask = createCameraSmokeMask(texture)
  const projected = createCameraSmokeProjection()
  const previous = new Vector3(), eye = new Vector3()
  let initialized = false, time = 0
  const uniforms = {
    smokeMap: { value: texture },
    eye: { value: new Vector3() }, viewRotation: { value: new Matrix3() },
    aspect: { value: 1 }, tanHalfFov: { value: 1 }, time: { value: 0 },
    near: { value: 0.1 }, volumeColor: { value: mask.volumeColor }, volumeDensity: { value: 0 },
  }
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, -1.0, 1.0); }
    `,
    fragmentShader: `
      #include <common>
      uniform sampler2D smokeMap;
      uniform vec3 eye;
      uniform mat3 viewRotation;
      uniform float aspect;
      uniform float tanHalfFov;
      uniform float time;
      uniform float near;
      uniform vec3 volumeColor;
      uniform float volumeDensity;
      varying vec2 vUv;
      vec2 smokeUv(vec2 p) { return 0.2 + 0.6 * abs(fract(p * 0.5) * 2.0 - 1.0); }
      void main() {
        vec2 screen = vUv * 2.0 - 1.0;
        vec3 ray = viewRotation * normalize(vec3(screen.x * aspect * tanHalfFov, screen.y * tanHalfFov, -1.0));
        // 素材細節固定在世界空間；平移、轉向與穿煙速度自然影響流動。
        vec3 p = (eye + ray * min(near, 20.0)) / 24.0;
        p += vec3(time * 0.025, time * 0.013, time * 0.018);
        float grain = texture2D(smokeMap, smokeUv(p.xz)).g * 0.6
                    + texture2D(smokeMap, smokeUv(p.xy * 1.37 + 0.31)).g * 0.4;
        float alpha = 1.0 - exp(-volumeDensity * (0.95 + grain * 0.1));
        gl_FragColor = vec4(volumeColor / max(volumeDensity, 0.00001) * (0.97 + grain * 0.06), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.name = 'cameraSmoke'
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const volume = new Mesh(geometry, material)
  volume.name = 'cameraSmoke.volume'
  volume.frustumCulled = false
  volume.renderOrder = 1
  volume.visible = false
  scene.add(projected.object, volume)
  return {
    stats: mask.stats,
    update(world: Scene, view: PerspectiveCamera, frameSeconds: number, worldSeconds: number): void {
      view.updateWorldMatrix(true, false)
      view.getWorldPosition(eye)
      cameraSmokeEnabled.value = 1
      const distance = initialized ? previous.distanceTo(eye) : 0
      const speed = distance / Math.max(frameSeconds, 0.0001)
      const blend = !initialized || distance > 100 ? 1 : cameraSmokeResponse(frameSeconds, speed)
      mask.update(world, view, blend)
      projected.update(mask, view.near, view.far)
      uniforms.volumeDensity.value = mask.volumeDensity
      volume.visible = mask.volumeDensity > 0.00001
      previous.copy(eye); initialized = true
      uniforms.eye.value.copy(eye)
      uniforms.viewRotation.value.setFromMatrix4(view.matrixWorld)
      uniforms.aspect.value = view.aspect
      uniforms.tanHalfFov.value = Math.tan(view.fov * Math.PI / 360) / view.zoom
      uniforms.near.value = view.near
      time += worldSeconds; uniforms.time.value = time
    },
    render(renderer: WebGLRenderer): void {
      if (mask.stats.maxDensity < 0.00001) return
      const autoClear = renderer.autoClear, autoReset = renderer.info.autoReset
      renderer.autoClear = false; renderer.info.autoReset = false
      try {
        // 四層投影格已合成一個 Mesh；體積霧放在其後，整個遮罩最多兩次 draw。
        renderer.render(scene, camera)
      } finally {
        renderer.autoClear = autoClear; renderer.info.autoReset = autoReset
      }
    },
    reset(): void {
      cameraSmokeEnabled.value = 0
      mask.reset(); projected.reset(); volume.visible = false; initialized = false; time = 0
    },
    dispose(): void { mask.dispose(); projected.dispose(); geometry.dispose(); material.dispose() },
  }
}
