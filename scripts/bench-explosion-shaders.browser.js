// 由量測腳本附加到展示頁模組；遊戲與一般展示頁不會載入本檔。
const benchGL = ctx.renderer.getContext()
const benchTimer = benchGL.getExtension('EXT_disjoint_timer_query_webgl2')
if (!benchTimer) throw new Error('需要 GPU timer query；不以 CPU 時間冒充 GPU 時間')
const benchDebug = benchGL.getExtension('WEBGL_debug_renderer_info')
const benchRAF = () => new Promise(resolve => requestAnimationFrame(resolve))
const benchPools = [blastFire, blastGlow, blastSmoke, blastEmber, burnSmoke]
const benchSmokePools = [blastSmoke, blastEmber, burnSmoke]
const benchMaterials = new Map()
const benchShaders = new Set()
const benchGolden = new Map()
let benchCase
let benchVariant = 'baseline'

function benchReplace(source, before, after) {
  if (!source.includes(before)) throw new Error('找不到 shader 注入點：' + before)
  return source.replace(before, after)
}

function benchPatchSmoke(shader, variant) {
  if (variant === 'light' || variant === 'lightHash' || variant === 'combined') {
    // 中心到燈的計算與像素位置無關，移至頂點；濃度衰減仍留在片元。
    const uniforms = shader.fragmentShader.match(/uniform (?:vec3|float) uBlastLight\w+\[\d+\];/g)
    const loop = shader.fragmentShader.match(/vec3 blastLight = vec3\(0\.0\);[\s\S]*?\n\s*}\n/)
    if (uniforms?.length !== 3 || !loop) throw new Error('爆炸光 shader 結構改變')
    shader.vertexShader = benchReplace(shader.vertexShader, 'varying vec3 vSmokeWorldCenter;',
      'varying vec3 vSmokeWorldCenter;\nvarying vec3 vBenchBlastLight;\n' + uniforms.join('\n'))
    const centre = 'vSmokeWorldCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;'
    shader.vertexShader = benchReplace(shader.vertexShader, centre,
      centre + '\n' + loop[0] + '\nvBenchBlastLight = blastLight;')
    shader.fragmentShader = benchReplace(shader.fragmentShader, 'varying vec3 vSmokeWorldCenter;',
      'varying vec3 vSmokeWorldCenter;\nvarying vec3 vBenchBlastLight;')
    shader.fragmentShader = benchReplace(shader.fragmentShader, loop[0], 'vec3 blastLight = vBenchBlastLight;\n')
  }
  if (variant === 'zero' || variant === 'combined') {
    // 只跳過精確為零的透明像素，不使用會削掉半透明細節的門檻。
    shader.fragmentShader = benchReplace(shader.fragmentShader,
      'diffuseColor.a *= smokeDensity;',
      'diffuseColor.a *= smokeDensity;\nif (diffuseColor.a == 0.0 || vAlpha == 0.0) discard;')
  }
}

for (const pool of benchPools) {
  const original = pool.object.material
  const compile = original.onBeforeCompile
  const key = original.customProgramCacheKey.bind(original)
  const variants = new Map()
  for (const variant of ['baseline', 'light', 'zero', 'hash', 'lightHash', 'combined']) {
    // 基準沿用原材質，其餘另建測試材質，沒有修改遊戲的共用工廠。
    const material = variant === 'baseline' ? original : original.clone()
    material.onBeforeCompile = (shader, renderer) => {
      compile.call(material, shader, renderer)
      if (benchSmokePools.includes(pool)) {
        benchShaders.add(shader)
        benchPatchSmoke(shader, variant)
      }
      if (pool === blastFire && (variant === 'hash' || variant === 'lightHash' || variant === 'combined')) {
        shader.fragmentShader = benchReplace(shader.fragmentShader,
          '#include <alphahash_fragment>',
          'if (diffuseColor.a < 1.0) {\n#include <alphahash_fragment>\n}')
      }
    }
    material.customProgramCacheKey = () => key() + '|bench-' + variant
    variants.set(variant, material)
  }
  benchMaterials.set(pool, variants)
}

function benchSetVariant(variant) {
  for (const pool of benchPools) pool.object.material = benchMaterials.get(pool).get(variant)
  benchVariant = variant
  cameraSmoke.reset()
}

function benchLights() {
  // 額外燈光案例只驗證煙的燈光公式，不代表單次爆炸的自然閃光時序。
  for (const shader of benchShaders) {
    const lit = benchCase.lit === true
    shader.uniforms.uBlastLightPos.value[0].set(0, terrain.heightAt(0, 0, 0) + 10, 0)
    shader.uniforms.uBlastLightPos.value[1].set(15, 30, -10)
    shader.uniforms.uBlastLightColor.value[0].set(lit ? .7 : 0, lit ? .28 : 0, lit ? .07 : 0)
    shader.uniforms.uBlastLightColor.value[1].set(lit ? .05 : 0, lit ? .1 : 0, lit ? .2 : 0)
    shader.uniforms.uBlastLightRadius.value[0] = 400
    shader.uniforms.uBlastLightRadius.value[1] = 35
  }
}

function benchDraw() {
  benchLights()
  cameraSmoke.update(ctx.scene, ctx.camera, 1 / 60, 0)
  pass.render(ctx.scene, ctx.camera)
  cameraSmoke.render(ctx.renderer)
}

function benchSetup(spec) {
  benchCase = spec
  setTab('blast')
  setScale(1)
  setCameraSmoke(true)
  setTimeOfDay(spec.time ?? 'noon')
  controls.minDistance = .1
  for (const pool of benchPools) pool.reset()
  groundFire.reset()
  const y = terrain.heightAt(0, 0, 0)
  emitBlast(blastPools, FIRE_SMOKE_BLAST, 0, y + 1, 0, 197)
  for (let t = 0; t < spec.age - 1e-6; t += 1 / 120) {
    const dt = Math.min(1 / 120, spec.age - t)
    blastFire.step(dt)
    blastGlow.step(dt)
    blastEmber.step(dt)
    blastSmoke.step(dt)
  }
  ctx.camera.position.set(0, y + 6, spec.distance)
  controls.target.set(0, y + 6, 0)
  controls.update()
  terrain.update(spec.age, 0, spec.distance)
  return { ...spec, camera: ctx.camera.position.toArray(), counts: benchPools.map(p => p.live) }
}

function benchPixels(save) {
  benchDraw()
  const pixels = new Uint8Array(benchGL.drawingBufferWidth * benchGL.drawingBufferHeight * 4)
  benchGL.readPixels(0, 0, benchGL.drawingBufferWidth, benchGL.drawingBufferHeight,
    benchGL.RGBA, benchGL.UNSIGNED_BYTE, pixels)
  if (save) benchGolden.set(benchCase.id, pixels)
  const golden = benchGolden.get(benchCase.id)
  if (!golden) throw new Error('缺少基準影像')
  let changed = 0, aboveOne = 0, max = 0, total = 0
  for (let i = 0; i < pixels.length; i += 4) {
    let pixelMax = 0
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(pixels[i + c] - golden[i + c])
      pixelMax = Math.max(pixelMax, delta)
      total += delta
    }
    if (pixelMax > 0) changed++
    if (pixelMax > 1) aboveOne++
    max = Math.max(max, pixelMax)
  }
  return { changedPixels: changed, pixelsAboveOneLevel: aboveOne, maxChannelDelta: max,
    meanChannelDelta: total / (pixels.length / 4 * 3), pixelCount: pixels.length / 4 }
}

async function benchMeasure(variant, count = 45, saveGolden = false) {
  benchSetVariant(variant)
  // 編譯、uniform 更新與 GPU 升頻均在計時外暖機。
  for (let i = 0; i < 20; i++) { benchDraw(); await benchRAF() }
  const gpu = [], cpu = []
  let disjoint = 0
  for (let i = 0; i < count; i++) {
    const query = benchGL.createQuery()
    benchGL.beginQuery(benchTimer.TIME_ELAPSED_EXT, query)
    const start = performance.now()
    benchDraw()
    cpu.push(performance.now() - start)
    benchGL.endQuery(benchTimer.TIME_ELAPSED_EXT)
    await benchRAF()
    let attempts = 0
    while (!benchGL.getQueryParameter(query, benchGL.QUERY_RESULT_AVAILABLE)) {
      if (++attempts > 180) throw new Error('GPU query 逾時')
      await benchRAF()
    }
    if (benchGL.getParameter(benchTimer.GPU_DISJOINT_EXT)) disjoint++
    else gpu.push(benchGL.getQueryParameter(query, benchGL.QUERY_RESULT) / 1e6)
    benchGL.deleteQuery(query)
  }
  if (gpu.length < count * .9) throw new Error('有效 GPU 樣本不足')
  const stats = data => {
    const sorted = [...data].sort((a, b) => a - b)
    return { median: sorted[Math.floor(sorted.length * .5)], p90: sorted[Math.floor(sorted.length * .9)], samples: data }
  }
  const result = { variant: benchVariant, gpu: stats(gpu), cpu: stats(cpu), disjoint,
    calls: ctx.renderer.info.render.calls, triangles: ctx.renderer.info.render.triangles }
  // 讀像素會同步 GPU，故放在整批量測完成之後。
  result.image = benchPixels(saveGolden)
  return result
}

window.__explosionBench = {
  setup: benchSetup, measure: benchMeasure,
  info: { renderer: benchDebug ? benchGL.getParameter(benchDebug.UNMASKED_RENDERER_WEBGL) : 'unknown',
    width: benchGL.drawingBufferWidth, height: benchGL.drawingBufferHeight, dpr: devicePixelRatio },
}
