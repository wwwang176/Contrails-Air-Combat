/**
 * 把程式化建構的機種用 `GLTFExporter` 吐成 `models-src/<id>.glb` —— 搬到
 * GLB 路的第一步。之後匯進 Blender 存成 `tools/blender/<id>.blend`，再由
 * Blender 匯出正式的 GLB；程式版留著當重匯來源。
 *
 * 跑法：`npx vite-node test/tools/procedural-export.ts he111`
 *
 * 【命名是給 `glb.ts` 看的】它靠**材質名**決定貼哪一種遊戲材質、靠**節點名**
 * 認出槳葉（manifest 的 `materials` 與 `props[].node`）。assembly 那幾個共用的
 * `MeshStandardMaterial` 沒有名字，這裡依身分改名：透明的是玻璃、雙面機身色
 * 是骨架（frame）、雙面暗色是碗（inner）、機身色的是機身、內裝色
 * （0x191d1a、平滑著色）的是座艙、其餘暗色是 accent。
 *
 * 【多發機的槳葉按轉軸位置分名】每一具的槳葉都掛在 assembly `propeller`
 * 建的那個 hub Group 底下（blade → arm → hub）。hub 的世界位置與 manifest
 * 的 `(hubX, hubY, hubZ)` 對上，那一具的槳葉就取那一筆的 `node` 名。對不上
 * 就報錯 —— manifest 抄錯位置時在這裡就會知道，不會等到載入時槳葉不轉。
 *
 * 【模糊槳盤不匯出】它預設 `visible = false`，exporter 預設只匯可見的；
 * `glb.ts` 載入時會用 `CircleGeometry` 重做一個。
 *
 * 【`FileReader` 的墊片】exporter 的 binary 路徑用 `FileReader` 把 `Blob`
 * 讀成 `ArrayBuffer`，node 22 有 `Blob` 沒有 `FileReader`。
 */
import { writeFileSync } from 'node:fs'
import { DoubleSide, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { AircraftModel } from '../../src/render/geometry/assembly'
import type { GlbAircraft } from '../../src/render/geometry/glb'
import { buildHe111 } from '../../src/render/geometry/he111'
import { HE111_MODEL } from '../../src/render/geometry/he111.model'

declare const process: { argv: readonly string[]; exitCode?: number }

/**
 * 程式版還留著、可以重匯的機種。
 *
 * B-17G **不在這裡** —— 它的 GLB 由 `tools/blender/build_b17.py` 對著參考模型
 * 重建，與程式版沒有血緣，重匯會把外型倒退回第一代。
 */
const SOURCES: Record<string, { build: () => AircraftModel; def: GlbAircraft }> = {
  he111: { build: buildHe111, def: HE111_MODEL },
}

interface BlobLike { arrayBuffer(): Promise<ArrayBuffer> }
class FileReaderShim {
  result: ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: BlobLike): void {
    void blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.() })
  }
}
;(globalThis as unknown as { FileReader: unknown }).FileReader = FileReaderShim

const id = process.argv[2] ?? ''
const entry = SOURCES[id]
if (!entry) throw new Error(`不認得的機種 ${id}；可用：${Object.keys(SOURCES).join(', ')}`)
const { build, def } = entry
// 【寫進原檔目錄】`/models/x.glb` → `models-src/x.glb`；public/models 是壓縮產物
const OUT = `models-src${def.url.slice('/models'.length)}`

const NAME_OF: Record<string, string> = {}
for (const [name, kind] of Object.entries(def.materials)) NAME_OF[kind] = name

function kindOf(mat: MeshStandardMaterial): string {
  const hex = mat.color.getHex()
  if (mat.transparent) return 'glass'
  if (mat.side === DoubleSide) {
    if (hex === def.bodyColor) return 'frame'
    if (hex === 0x191d1a) return 'inner'
    throw new Error(`雙面材質 ${mat.color.getHexString()} 還沒有對應的 GLB 種類`)
  }
  if (hex === def.bodyColor) return 'body'
  if (hex === 0x191d1a && !mat.flatShading) return 'cockpit'
  if (hex === def.accentColor) return 'accent'
  throw new Error(`不認得的材質 ${mat.color.getHexString()}`)
}

const model = build()
model.group.updateMatrixWorld(true)

/** 槳葉所屬的 hub（blade → arm → hub）在 manifest 裡是第幾具。 */
function propIndexOf(blade: Object3D): number {
  const hub = blade.parent?.parent
  if (!hub) throw new Error(`槳葉 ${blade.uuid} 沒有 hub`)
  const p = hub.getWorldPosition(new Vector3())
  const at = def.props.findIndex((q) =>
    Math.abs(p.x - (q.hubX ?? 0)) < 1e-6 && Math.abs(p.y - q.hubY) < 1e-6 && Math.abs(p.z - q.hubZ) < 1e-6)
  if (at < 0) {
    throw new Error(`hub 在 (${p.x}, ${p.y}, ${p.z}) 的槳葉在 manifest 的 props 裡沒有對應的位置`)
  }
  return at
}

const seen = new Map<string, number>()
const bladesPerProp = def.props.map(() => 0)
model.group.traverse((o: Object3D) => {
  const mesh = o as Mesh
  if (!mesh.isMesh || !mesh.visible) return
  const kind = kindOf(mesh.material as MeshStandardMaterial)
  const name = NAME_OF[kind]
  if (!name) throw new Error(`模型用了 ${kind} 材質，但 manifest 的 materials 沒列它`)
  ;(mesh.material as MeshStandardMaterial).name = name
  seen.set(kind, (seen.get(kind) ?? 0) + 1)
  if (o.userData['spinning']) {
    const at = propIndexOf(o)
    o.name = def.props[at]!.node
    bladesPerProp[at]!++
  }
})
for (const kind of Object.values(def.materials)) {
  if (!seen.has(kind)) throw new Error(`manifest 列了 ${kind} 但模型裡沒有這種材質`)
}
def.props.forEach((p, i) => {
  if (bladesPerProp[i] === 0) throw new Error(`manifest 的 ${p.node} 沒有任何槳葉對上`)
})
console.log(`${id}：材質 → mesh 數`, Object.fromEntries(seen))
console.log(`${id}：每具槳葉數`, bladesPerProp.join(', '))

new GLTFExporter().parse(model.group, (out) => {
  if (!(out instanceof ArrayBuffer)) throw new Error('要的是 binary GLB，拿到 JSON')
  writeFileSync(OUT, new Uint8Array(out))
  console.log(`寫出 ${OUT}：${out.byteLength} bytes`)
}, (e) => {
  console.error(e)
  process.exitCode = 1
}, { binary: true })
