/**
 * 把程式版 P-51D（`buildP51D()`）用 `GLTFExporter` 吐成 `public/models/p51d.glb`。
 *
 * 跑法：`npx vite-node test/tools/p51-export.ts`
 *
 * 【為什麼是搬家而不是重畫】外型逐頂點不變，程式路徑先統一到 `glb.ts`
 * 那一條；之後要修外型，是在 Blender 裡對著這個 GLB 改，不必回頭動
 * `p51d.hull.ts` 的錨點表。`test/unit/p51d-glb.test.ts` 釘住「載回來與
 * 程式版逐頂點相同」。
 *
 * 【命名是給 `glb.ts` 看的】它靠**材質名**決定貼哪一種遊戲材質、靠**節點名**
 * 認出槳葉（見 `P51D_MODEL.materials` 與 `.prop.node`）。這裡把 assembly
 * 那四個共用的 `MeshStandardMaterial` 依身分改名，槳葉節點改名 `P51_Prop`。
 *
 * 【模糊槳盤不匯出】它預設 `visible = false`，而 exporter 預設只匯可見的
 * （`onlyVisible: true`）；`glb.ts` 載入時會用 `CircleGeometry` 重做一個。
 *
 * 【`FileReader` 的墊片】exporter 的 binary 路徑用 `FileReader` 把 `Blob`
 * 讀成 `ArrayBuffer`，node 22 有 `Blob` 沒有 `FileReader`。這裡補一個只
 * 做 `readAsArrayBuffer` 的最小版本。
 */
import { writeFileSync } from 'node:fs'
import { Mesh, MeshStandardMaterial, Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildP51D, P51D_BODY_COLOR } from '../../src/render/geometry/p51d'
import { P51D_MODEL } from '../../src/render/geometry/p51d.model'

declare const process: { exitCode?: number }

interface BlobLike { arrayBuffer(): Promise<ArrayBuffer> }
class FileReaderShim {
  result: ArrayBuffer | null = null
  onloadend: (() => void) | null = null
  readAsArrayBuffer(blob: BlobLike): void {
    void blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.() })
  }
}
;(globalThis as unknown as { FileReader: unknown }).FileReader = FileReaderShim

const OUT = `public${P51D_MODEL.url}`

/** 材質種類 → GLB 裡的材質名。與 `P51D_MODEL.materials` 互為反表。 */
const NAME_OF: Record<string, string> = {}
for (const [name, kind] of Object.entries(P51D_MODEL.materials)) NAME_OF[kind] = name

function kindOf(mat: MeshStandardMaterial): string {
  if (mat.transparent) return 'glass'
  if (mat.color.getHex() === P51D_BODY_COLOR) return 'body'
  if (mat.color.getHex() === P51D_MODEL.accentColor) return 'accent'
  if (mat.color.getHex() === 0x191d1a) return 'cockpit'
  throw new Error(`不認得的材質 ${mat.color.getHexString()}`)
}

const model = buildP51D()
const seen = new Map<string, number>()
model.group.traverse((o: Object3D) => {
  const mesh = o as Mesh
  if (!mesh.isMesh || !mesh.visible) return
  const mat = mesh.material as MeshStandardMaterial
  const kind = kindOf(mat)
  mat.name = NAME_OF[kind]!
  seen.set(kind, (seen.get(kind) ?? 0) + 1)
  if (o.userData['spinning']) o.name = P51D_MODEL.prop.node
})
console.log('材質 → mesh 數', Object.fromEntries(seen))

new GLTFExporter().parse(model.group, (out) => {
  if (!(out instanceof ArrayBuffer)) throw new Error('要的是 binary GLB，拿到 JSON')
  writeFileSync(OUT, new Uint8Array(out))
  console.log(`寫出 ${OUT}：${out.byteLength} bytes`)
}, (e) => {
  console.error(e)
  process.exitCode = 1
}, { binary: true })
