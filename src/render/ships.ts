import {
  AdditiveBlending, Box3, BufferAttribute, CanvasTexture, DoubleSide, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  Quaternion, SRGBColorSpace, TextureLoader, Vector3,
  type BufferGeometry, type Material, type Texture,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createGltfLoader } from './geometry/gltfLoader'
import { applyShipLiveryUv, partTones } from './shipLivery'
import {
  buildNumberDecal, numberBox, numberCanvas, numberMaterial, shipNumber, type ShipNumbersDef,
} from './shipNumbers'
import { SHIP_LIVERIES, liveryVariant, type ShipLiveryDef } from './shipLiveries'
import { SHIP_CLASSES, type Ship, type ShipClassId } from '../world/ships'
import { MAX_SHIP_GUNS } from '../world/shipGuns'
import { TURRET_FLASH_SECONDS } from '../world/turrets'
import { assetUrl } from '../core/asset'

/**
 * # 船的渲染
 *
 * **不畫砲管。** `shipAA.ts` 的砲位座標就是從 GLB 量出來的砲口 —— 砲本身
 * 已經建在模型裡了。飛機那一邊要畫（`render/turretBarrels.ts`）是因為程式化
 * 機體沒有砲塔幾何，船沒有這個問題。
 *
 * 所以這一層只做三件事：把 GLB 擺到船的位置、在開火的砲位上閃一下槍焰、
 * 在被打掉的砲位上留一團火。
 *
 * 【船不隨浪起伏、沒有航跡浪】spec §12 明列不做。
 */

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
 * `texture` 為 null（node 測試沒有圖可載）時 UV 照算、材質維持單色。
 *
 * 頂點不動 —— 包圍盒、砲位、碰撞都與 GLB 相同。
 */
export function applyShipLivery(root: Object3D, def: ShipLiveryDef, texture: Texture | null): void {
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
    if (kind === 'body' || kind === 'deck') {
      // 【UV 用艦體座標算】節點可能帶變換；算在烘過的副本上，只把 UV 搬回來
      const baked = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      applyShipLiveryUv(baked, kind, def.layout)
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
      if (kind === 'accent') m.color.set(def.accentColor)
      else if (texture !== null) {
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
  let texture: Texture | null = null
  try {
    texture = await loadShipLivery(livery.layout.url)
  } catch (e) {
    console.warn(`艦級 ${id} 的塗裝貼圖載不到，維持單色`, e)
  }
  applyShipLivery(root, livery, texture)
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
      const [gltf, ...textures] = await Promise.all([
        loader.loadAsync(assetUrl(SHIP_CLASSES[id].url)),
        ...urls.map(loadShipLivery),
      ])
      if (livery !== undefined) applyShipLivery(gltf.scene, livery, textures[0]!)
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

export interface ShipModels {
  /** 加進場景的根節點。 */
  readonly object: Group
  /**
   * 每幀更新一次。
   *
   * @param onGunLost 某個砲位在這一幀之前被打掉了。呼叫端拿它噴火球 ——
   *                  這一層不認識火球池（那是 `main.ts` 的接線）。
   */
  update(ships: readonly Ship[], onGunLost: (x: number, y: number, z: number) => void): void
  dispose(): void
}

/**
 * 槍焰的十字亮片。**與 `render/muzzle.ts` 的做法相同但各自一份** ——
 * 那一份的容量是「架數 × MAX_MOUNTS」，寫死給 combatant 用的。
 */
function flareGeometry(): PlaneGeometry {
  return new PlaneGeometry(2.2, 2.2)
}

const M = /* @__PURE__ */ new Matrix4()
const P = /* @__PURE__ */ new Vector3()
const Q = /* @__PURE__ */ new Quaternion()
const ONE = /* @__PURE__ */ new Vector3(1, 1, 1)

/**
 * 槍焰的大小倍率，由口徑決定。20 mm 是 1 倍，五吋（127 mm）是 3.6 倍。
 *
 * 【為什麼要分】三層砲原本共用同一個大小，五吋砲看起來與 20 mm 一樣一點 ——
 * 那一聲巨響於是沒有對應的畫面。加上聲音本來就有音速延遲（200 m 外就是
 * 半秒多），看起來就像慢半拍，其實是視覺少了那一下。
 */
export function flashScale(calibreMm: number): number {
  return Math.pow(Math.max(1, calibreMm) / 20, 0.7)
}
/** 槍焰的尺寸。每幀每砲寫一次 —— 用 clone() 的話那是每秒上千次配置。 */
const SCALE = /* @__PURE__ */ new Vector3()

export function createShipModels(ships: readonly Ship[]): ShipModels {
  const object = new Group()
  const hulls: Object3D[] = []
  /** 這一批船自己建的號碼字圖與材質（樣板的東西不在這裡，別的場還要用） */
  const owned: { dispose(): void }[] = []

  for (const s of ships) {
    const ts = templates.get(s.cls.id)
    if (ts === undefined) {
      throw new Error(`艦級 ${s.cls.id} 的 GLB 還沒載入 —— 少了 preloadShipModels()`)
    }
    const g = ts[liveryVariant(s.index, ts.length)]!.clone(true)
    // 【號碼一艘一張字圖】幾何同艦級共用，字圖跟著這一艘建、跟著它釋放
    const numbers = SHIP_LIVERIES[s.cls.id]?.numbers
    const decal = numberDecals.get(s.cls.id)
    if (numbers !== undefined && decal !== undefined) {
      const tex = new CanvasTexture(numberCanvas(shipNumber(numbers.values, s.index), numbers))
      tex.colorSpace = SRGBColorSpace
      tex.anisotropy = 8
      const mat = numberMaterial(tex)
      g.add(new Mesh(decal, mat))
      owned.push(tex, mat)
    }
    object.add(g)
    hulls.push(g)
  }

  const capacity = Math.max(1, ships.length * MAX_SHIP_GUNS)
  const flashes = new InstancedMesh(
    flareGeometry(),
    // 【forceSinglePass】透明雙面預設分兩趟、每次繪製重算兩次 shader program。
    // 加法混色與順序無關，一趟畫出來的像素相同
    new MeshBasicMaterial({
      color: 0xffe6b0, transparent: true, opacity: 0.95,
      depthWrite: false, blending: AdditiveBlending, side: DoubleSide, forceSinglePass: true,
    }),
    capacity,
  )
  flashes.instanceMatrix.setUsage(DynamicDrawUsage)
  // 【關掉視錐剔除】包圍球是建立時算的（全部在原點），開著的話相機一離開
  // 原點附近整批槍焰會一起消失 —— 與曳光彈、飛機槍焰同一個坑。
  flashes.frustumCulled = false
  flashes.count = 0
  object.add(flashes)

  /**
   * 上一幀每個砲位還活著嗎。**用來抓「這一幀剛被打掉」那一瞬間** ——
   * `World` 那一側沒有「砲位被打掉」的事件，而為了一團火球去加一個事件
   * 型別、事件緩衝與排空約定並不划算。
   */
  const wasAlive = ships.map((s) => s.guns.map(() => true))

  return {
    object,

    update(list, onGunLost) {
      for (let k = 0; k < list.length && k < hulls.length; k++) {
        const s = list[k]!
        const g = hulls[k]!
        g.position.copy(s.position)
        g.quaternion.copy(s.orientation)
      }

      let slot = 0
      for (let k = 0; k < list.length; k++) {
        const s = list[k]!
        const prev = wasAlive[k]
        for (let i = 0; i < s.guns.length && slot < capacity; i++) {
          const gun = s.guns[i]!
          if (prev !== undefined && prev[i] === true && !gun.alive) {
            P.copy(gun.zone.position).applyQuaternion(s.orientation).add(s.position)
            onGunLost(P.x, P.y, P.z)
          }
          if (prev !== undefined) prev[i] = gun.alive

          if (!gun.alive || gun.flash <= 0) continue
          // 槍口的世界位置。**與彈丸出膛的位置是同一個算法**
          // （`stepShipGuns` 的 MUZZLE）—— 分開寫的話槍焰會離開彈流。
          P.copy(gun.zone.position).applyQuaternion(s.orientation).add(s.position)
          // 亮度隨剩餘時間衰減，用尺寸表達（實例沒有逐格 opacity）
          const f = gun.flash / TURRET_FLASH_SECONDS
          M.compose(P, Q.identity(), SCALE.copy(ONE).multiplyScalar(f * flashScale(gun.zone.calibreMm)))
          flashes.setMatrixAt(slot, M)
          slot++
        }
      }
      // 【只要調 count，不必把舊槽位清成零】`InstancedMesh` 只畫前 count 個
      // 實例，所以停火之後那些矩陣留著也不會出現在畫面上。飛機那一邊要清是
      // 因為它的槽位是**固定配置**（每架每管一格），中間會有空洞。
      flashes.instanceMatrix.needsUpdate = true
      flashes.count = slot
    },

    dispose() {
      flashes.geometry.dispose()
      ;(flashes.material as MeshBasicMaterial).dispose()
      for (const o of owned) o.dispose()
    },
  }
}
