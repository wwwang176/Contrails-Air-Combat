import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'

/**
 * 讀 `public/models/` 的 GLB 一律用這一支建 loader。
 *
 * 【為什麼要掛 Meshopt 解碼器】那些 GLB 是 `scripts/compress-models.mjs` 從
 * `models-src/` 產出的，其中幾支（廠區、機場……）用 `EXT_meshopt_compression`
 * 壓過，而且標成必要擴充。沒掛解碼器的 loader 讀到它會直接丟例外 —— 哪幾支
 * 有壓是腳本逐檔決定的，換一次原檔就可能換一批，所以每一個 loader 都掛。
 *
 * 解碼器約 20 KB，WASM 內嵌在 JS 裡，不用另外放檔案。
 */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
}
