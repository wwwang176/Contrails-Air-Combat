import { Box3, BufferAttribute, Mesh, MeshStandardMaterial, Object3D, SRGBColorSpace, TextureLoader, type BufferGeometry, type Material, type Texture } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createGltfLoader } from './geometry/gltfLoader'
import { applyShipLiveryUv, partTones } from './shipLivery'
import { fittingGrime, grimedLivery, grimeStamps } from './shipGrime'
import { buildNumberDecal, numberBox, type ShipNumbersDef } from './shipNumbers'
import { SHIP_LIVERIES, type ShipLiveryDef } from './shipLiveries'
import { SHIP_CLASSES, type ShipClassId } from '../world/ships'
import { assetUrl } from '../core/asset'

/** 每個艦級的樣板，一種圖案一份（見 `ShipLiveryDef.variants`）；沒有塗裝的只有一份 */
const templates = new Map<ShipClassId, readonly Object3D[]>()

/** 每個艦級的號碼貼花幾何（所有號碼位置併成一份）。號碼字數一樣，所以同艦級共用 */
const numberDecals = new Map<ShipClassId, BufferGeometry>()

/**
 * 建某個艦級的號碼貼花幾何。`root` 是套過塗裝的樣板。
 *
 * 【挑不到面就丟】那個號碼整個不見而且不報錯 —— 位置寫錯（例如落在船殼外）只有
 * 這裡看得出來。
 */
export function buildShipNumberDecals(root: Object3D, def: ShipNumbersDef): BufferGeometry {
  const len = def.values[0]!.length
  if (def.values.some((v) => v.length !== len)) {
    throw new Error(`號碼的字數要一樣：${def.values.join('、')}`)
  }
  root.updateMatrixWorld(true)
  let src: Mesh | undefined
  root.traverse((o) => { if ((o as Mesh).isMesh && o.name === def.mesh) src = o as Mesh })
  if (src === undefined) throw new Error(`找不到號碼要貼的網格 ${def.mesh}`)
  let geo = src.geometry.clone().applyMatrix4(src.matrixWorld)
  if (geo.index !== null) geo = geo.toNonIndexed()
  const pieces = def.marks.map((mark) => {
    const g = buildNumberDecal(geo, mark, numberBox(def.values[0]!, mark), def.largestPartOnly)
    if (g === null) throw new Error(`${def.mesh} 在 ${mark.view} z ${mark.z} 挑不到面`)
    return g
  })
  geo.dispose()
  const out = mergeGeometries(pieces)
  for (const p of pieces) p.dispose()
  if (out === null) throw new Error(`${def.mesh} 的號碼貼花併不起來`)
  return out
}

/**
 * 同一份樣板換另一張貼圖。幾何共用；吃 `from` 那張貼圖的材質換成吃 `to` 的一份
 * （同一個材質換成同一份），其他材質照舊共用。
 */
export function liveryVariantOf(base: Object3D, from: Texture, to: Texture): Object3D {
  const out = base.clone(true)
  const swapped = new Map<Material, Material>()
  out.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const src = mesh.material as MeshStandardMaterial
    if (src.map !== from) return
    let dst = swapped.get(src)
    if (dst === undefined) {
      const m = src.clone()
      m.map = to
      dst = m
      swapped.set(src, dst)
    }
    mesh.material = dst
  })
  return out
}

/**
 * 把塗裝套到剛載入的樣板上：船身與甲板的網格展開成無索引、算 UV，材質換成吃
 * 貼圖的那一份；細部換色。**同一個 GLB 材質換成同一份**，同艦級仍共用材質。
 *
 * `texture` 為 null（node 測試沒有圖可載）時 UV 照算、材質維持單色。`grime` 是細件的
 * 髒污圖（`shipGrime.ts` 的 `fittingGrime`）；細件照船身那套側視投影算 UV 讀它。
 *
 * 頂點不動 —— 包圍盒、砲位、碰撞都與 GLB 相同。
 */
export function applyShipLivery(
  root: Object3D, def: ShipLiveryDef, texture: Texture | null, grime: Texture | null = null,
): void {
  root.updateMatrixWorld(true)
  const swapped = new Map<Material, Material>()
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const src = mesh.material as Material
    const kind = def.kinds[src.name]
    if (kind === undefined) return
    if (mesh.geometry.index !== null) {
      const flat = mesh.geometry.toNonIndexed()
      mesh.geometry.dispose()
      mesh.geometry = flat
    }
    // 【UV 用艦體座標算】節點可能帶變換；算在烘過的副本上，只把 UV 搬回來。
    // 細件照船身那套投影：髒污圖與塗裝圖同一個版面，朝上的面落在單色區（白，不髒）。
    // 伸出側條頂的桅杆讀到空白處或另一舷條，都是白或髒污，不會讀到塗裝
    {
      const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      applyShipLiveryUv(baked, kind === 'deck' ? 'deck' : 'body', def.layout)
      mesh.geometry.setAttribute('uv', baked.getAttribute('uv'))
      baked.dispose()
    }
    // 【同一個材質的網格都要有頂點色】船殼與上層結構共用船身材質；缺了這一格的
    // 那一個網格讀到的是 0，整塊變黑
    const toned = kind !== 'deck'
    if (toned) {
      const n = mesh.geometry.getAttribute('position').count
      const kinds = def.parts[mesh.name]
      const tones = kinds !== undefined
        ? partTones(mesh.geometry, kinds, mesh.name)
        : new Float32Array(n * 3).fill(1)
      mesh.geometry.setAttribute('color', new BufferAttribute(tones, 3))
    }
    let dst = swapped.get(src)
    if (dst === undefined) {
      const m = (src as MeshStandardMaterial).clone()
      m.vertexColors = toned
      if (kind === 'accent') {
        m.color.set(def.accentColor)
        m.map = grime
      } else if (texture !== null) {
        m.map = texture
        m.color.set(0xffffff)
      }
      dst = m
      swapped.set(src, dst)
    }
    mesh.material = dst
  })
}

/**
 * 塗裝貼圖，依路徑快取。**flipY = false**：UV 的原點在圖的左上角（`shipLivery.ts`）；
 * `TextureLoader` 預設會把圖上下翻。
 *
 * 【失敗就從快取拿掉】留著的話那一個被拒絕的 Promise 會一直被重用，網路恢復之後
 * 同一頁也再抓不到。
 */
const liveryTextures = new Map<string, Promise<Texture>>()

function loadShipLivery(url: string): Promise<Texture> {
  let t = liveryTextures.get(url)
  if (t === undefined) {
    t = new TextureLoader().loadAsync(assetUrl(url)).then((tex) => {
      tex.flipY = false
      tex.colorSpace = SRGBColorSpace
      // 舷側多半是斜著看的，沒有異向過濾的話遠一點就糊成一團
      tex.anisotropy = 8
      return tex
    })
    t.catch(() => liveryTextures.delete(url))
    liveryTextures.set(url, t)
  }
  return t
}

/**
 * 把塗裝套到一份自己載的 GLB 上。給不走 `preloadShipModels` 的地方（機庫）用；
 * 沒有塗裝的艦級什麼都不做。
 *
 * 【貼圖載不到就維持單色】機庫是檢視工具，少一張貼圖不該讓整艘船不見。
 * 遊戲走 `preloadShipModels`，那一條載不到照樣丟錯。
 */
export async function dressShipModel(id: string, root: Object3D): Promise<void> {
  const livery = SHIP_LIVERIES[id as ShipClassId]
  if (livery === undefined) return
  let textures: { texture: Texture, grime: Texture } | null = null
  try {
    textures = await dressedTextures(id, livery)
  } catch (e) {
    console.warn(`艦級 ${id} 的塗裝貼圖載不到，維持單色`, e)
  }
  applyShipLivery(root, livery, textures?.texture ?? null, textures?.grime ?? null)
}

/**
 * 機庫用的蓋過髒污的貼圖，**每個艦級一份**。
 *
 * 【為什麼要快取】機庫每切一次船就套一次塗裝，而切走時只釋放幾何與材質、不釋放貼圖；
 * 每次都新蓋的話每切一次就多兩張 GPU 貼圖。載入失敗就從快取拿掉，下次重試。
 */
const dressed = new Map<string, Promise<{ texture: Texture, grime: Texture }>>()

function dressedTextures(id: string, livery: ShipLiveryDef): Promise<{ texture: Texture, grime: Texture }> {
  let p = dressed.get(id)
  if (p === undefined) {
    p = loadShipLivery(livery.layout.url).then((base) => {
      const stamps = grimeStamps(livery.layout, Math.random)
      return { texture: grimedLivery(base, stamps), grime: fittingGrime(stamps) }
    })
    p.catch(() => dressed.delete(id))
    dressed.set(id, p)
  }
  return p
}

/**
 * 每個艦級的模型最高點，m（艦體座標，水線為 0）。**HUD 的標記高度用它。**
 *
 * 【為什麼不能用碰撞盒推】`world/ships.ts` 的船體盒止於主甲板、砲位盒只包
 * 到砲塔 —— 桅杆與測距儀不在任何一個盒裡。兩者差了兩三倍：
 *
 * ```
 *              碰撞盒   模型
 *   Fletcher    12.7    27.0
 *   Wichita     13.7    38.2
 *   Essex       23.1    45.2
 * ```
 *
 * 標記畫在 13.7 m 的話，貼近看時它插在艦橋中間。**「物體的最高點」只有
 * 模型答得出來**，所以這一格住在算繪層。
 */
const modelTops = new Map<ShipClassId, number>()
const BOX = /* @__PURE__ */ new Box3()

/**
 * 這個艦級的模型最高點，m。**`preloadShipModels` 之後才有值。**
 *
 * 【載不到就丟】回一個猜的數字會讓標記靜靜地跑到錯的高度，而那正是這一
 * 整輪在修的東西 —— 與 `createShipModels` 少了 GLB 就丟是同一條。
 */
export function shipModelTop(id: ShipClassId): number {
  const y = modelTops.get(id)
  if (y === undefined) {
    throw new Error(`艦級 ${id} 的 GLB 還沒載入 —— 少了 preloadShipModels()`)
  }
  return y
}

/**
 * 先把要用到的艦級載進來。**開場 await 一次**，之後 `createShipModels`
 * 是同步的 —— 與 `preloadAircraftModels` 同一個做法。
 *
 * 【為什麼要指定要哪幾艘】`japan-m3` 只用 Wichita 與 Fletcher。無條件載
 * 三艘等於為了一關沒出現的航母多下載一份 GLB。
 *
 * @param onLoaded 每一個艦級好了呼叫一次（已經載過的也算），次數是 `ids` 去重後的
 *   數量（載入進度用）
 */
export async function preloadShipModels(
  ids: readonly ShipClassId[], onLoaded: () => void = () => {},
): Promise<void> {
  const loader = createGltfLoader()
  await Promise.all([...new Set(ids)].map(async (id) => {
    if (!templates.has(id)) {
      const livery = SHIP_LIVERIES[id]
      const urls = livery === undefined ? [] : [livery.layout.url, ...(livery.variants ?? [])]
      const [gltf, ...originals] = await Promise.all([
        loader.loadAsync(assetUrl(SHIP_CLASSES[id].url)),
        ...urls.map(loadShipLivery),
      ])
      // 【髒污在載入時蓋】同艦級共用一組印子，幾種圖案蓋同一組；每次載入位置不同。
      // 原圖（快取裡那一份）不動，遊戲讀的是蓋過的那一張
      const stamps = livery === undefined ? [] : grimeStamps(livery.layout, Math.random)
      const textures = originals.map((t) => grimedLivery(t, stamps))
      if (livery !== undefined) {
        applyShipLivery(gltf.scene, livery, textures[0]!, fittingGrime(stamps))
      }
      // 【量一次就好】包圍盒與船在哪無關，而 `setFromObject` 要走遍整棵樹
      gltf.scene.updateMatrixWorld(true)
      modelTops.set(id, BOX.setFromObject(gltf.scene).max.y)
      if (livery?.numbers !== undefined) {
        numberDecals.set(id, buildShipNumberDecals(gltf.scene, livery.numbers))
      }
      templates.set(id, [
        gltf.scene,
        ...textures.slice(1).map((t) => liveryVariantOf(gltf.scene, textures[0]!, t)),
      ])
    }
    onLoaded()
  }))
}

/** 只借用快取；場景實例不得釋放共用模板與貼花幾何。 */
export function shipTemplates(id: ShipClassId): readonly Object3D[] | undefined {
  return templates.get(id)
}

export function shipNumberDecal(id: ShipClassId): BufferGeometry | undefined {
  return numberDecals.get(id)
}
