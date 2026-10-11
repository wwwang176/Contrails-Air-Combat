/** Render true side silhouettes from the same GLB assets loaded by the game. */
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const destination = 'public/ui/maps/model-silhouettes'
const ids = ['p51d', 'm16', 'cckw', 'm4a3', 'm1_90mm', 'wichita', 'fletcher', 'essex', 'b17g', 'flak18', 'flak38', 'zis3', 'panzer4', 't34']
await mkdir(destination, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage()
  await page.route('**/src/main.ts*', route => route.fulfill({ contentType: 'application/javascript', body: '' }))
  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' })
  const manifest = []
  for (const id of ids) {
    const result = await page.evaluate(async id => {
      const THREE = await import('/node_modules/.vite/deps/three.js')
      const { createGltfLoader } = await import('/src/render/geometry/gltfLoader.ts')
      const { scene: model } = await createGltfLoader().loadAsync(`/models/${id}.glb`)
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
      let meshes = 0
      model.traverse(o => { if (o.isMesh) { o.material = material; meshes++ } })
      model.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(model)
      const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
      const width = 1024, height = Math.max(96, Math.round(width * size.y / size.z))
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
      renderer.setSize(width, height)
      renderer.setClearColor(0x000000, 0)
      const extent = size.z * 1.06, vertical = extent * height / width
      const camera = new THREE.OrthographicCamera(-extent/2, extent/2, vertical/2, -vertical/2, .01, size.length()*10)
      camera.position.set(center.x + size.length()*3, center.y, center.z)
      camera.lookAt(center)
      const scene = new THREE.Scene()
      scene.add(model)
      renderer.render(scene, camera)
      const png = renderer.domElement.toDataURL('image/png').split(',')[1]
      renderer.dispose()
      model.traverse(o => { if (o.isMesh) o.geometry.dispose() })
      material.dispose()
      return { png, width, height, meshes, bounds: size.toArray() }
    }, id)
    await writeFile(`${destination}/${id}.png`, Buffer.from(result.png, 'base64'))
    const { png, ...meta } = result
    manifest.push({ id, source: `public/models/${id}.glb`, sha256: createHash('sha256').update(await readFile(`public/models/${id}.glb`)).digest('hex'), ...meta })
    console.log(id, meta)
  }
  await writeFile(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2))
} finally { await browser.close() }
