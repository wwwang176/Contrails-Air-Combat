/**
 * 把 `models-src/*.glb` 壓成 `public/models/*.glb`。`npm run dev` 與
 * `npm run build` 之前自動跑（package.json 的 predev／prebuild）。
 *
 * 【原檔在 models-src，public/models 是產物】Blender 腳本匯出到 models-src，
 * public/models 不進版控。改了原檔只要重跑 dev 或 build。
 *
 * 【無損】只套 EXT_meshopt_compression 的無損編碼，不量化、不重排頂點 ——
 * 頂點屬性與原檔逐位元相同，三角形只差起點輪轉（見 `sameAccessors`）。每一檔
 * 寫出前都解回來比對一次，對不上就中止建置。
 *
 * 【壓了反而大就不壓】網站本來就 gzip 傳輸。沒量化的浮點數經過 meshopt 之後
 * gzip 反而壓不動，多數飛機會變大；只有廠區、機場這種大量重複結構的模型
 * 變小很多。所以逐檔比 gzip 之後的大小，小的那一個才寫出去。
 *
 * 【增量】產物比原檔新就跳過。`--force` 全部重做。
 */
import { NodeIO } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SRC = 'models-src'
const OUT = 'public/models'
const force = process.argv.includes('--force')

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions([...KHRONOS_EXTENSIONS, EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

/** 三角形 (a,b,c) 與 (d,e,f) 是同一個：只差起點的輪轉，繞向相同 */
function sameTriangle(p, q, k) {
  const a = p[k], b = p[k + 1], c = p[k + 2]
  const d = q[k], e = q[k + 1], f = q[k + 2]
  return (a === d && b === e && c === f)
    || (a === e && b === f && c === d)
    || (a === f && b === d && c === e)
}

/**
 * 兩份文件的 accessor 逐一相同。順序由 gltf-transform 讀寫保留。
 *
 * 頂點屬性要逐位元相同。**索引允許每個三角形輪轉起點** —— meshopt 的索引編碼
 * 會把 (a,b,c) 存成 (b,c,a)，三角形的次序與繞向（正反面）都不變，畫出來是
 * 同一個幾何。
 */
function sameAccessors(a, b) {
  const indices = new Set()
  for (const mesh of a.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getIndices() !== null) indices.add(prim.getIndices())
    }
  }
  const x = a.getRoot().listAccessors()
  const y = b.getRoot().listAccessors()
  if (x.length !== y.length) return `accessor 數 ${x.length} ≠ ${y.length}`
  for (let i = 0; i < x.length; i++) {
    const p = x[i].getArray()
    const q = y[i].getArray()
    if (p.length !== q.length) return `第 ${i} 個 accessor 長度不同`
    if (indices.has(x[i])) {
      if (p.length % 3 !== 0) return `第 ${i} 個索引不是三角形清單`
      for (let k = 0; k < p.length; k += 3) {
        if (!sameTriangle(p, q, k)) return `第 ${i} 個索引的第 ${k / 3} 個三角形不同`
      }
      continue
    }
    const pb = new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
    const qb = new Uint8Array(q.buffer, q.byteOffset, q.byteLength)
    if (p.constructor !== q.constructor || !Buffer.from(pb).equals(Buffer.from(qb))) {
      return `第 ${i} 個 accessor 內容不同`
    }
  }
  return null
}

fs.mkdirSync(OUT, { recursive: true })
let kept = 0
let packed = 0
let skipped = 0
for (const name of fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const src = path.join(SRC, name)
  const dst = path.join(OUT, name)
  if (!force && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) {
    skipped++
    continue
  }
  const raw = fs.readFileSync(src)
  const doc = await io.readBinary(new Uint8Array(raw))
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  const bin = await io.writeBinary(doc)

  const diff = sameAccessors(await io.readBinary(new Uint8Array(raw)), await io.readBinary(bin))
  if (diff !== null) throw new Error(`${name} 壓縮後解不回原檔：${diff}`)

  const gzRaw = zlib.gzipSync(raw).length
  const gzBin = zlib.gzipSync(bin).length
  if (gzBin < gzRaw) {
    fs.writeFileSync(dst, bin)
    packed++
    console.log(`  壓縮 ${name}  gzip ${(gzRaw / 1024).toFixed(0)} → ${(gzBin / 1024).toFixed(0)} KB`)
  } else {
    fs.copyFileSync(src, dst)
    kept++
  }
}
console.log(`models：壓縮 ${packed}、照搬 ${kept}、未變 ${skipped}`)
