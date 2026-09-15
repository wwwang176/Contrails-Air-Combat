import {
  AdditiveBlending, Box3, DoubleSide, DynamicDrawUsage, Group, InstancedMesh,
  Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SHIP_CLASSES, type Ship, type ShipClassId } from '../world/ships'
import { MAX_SHIP_GUNS } from '../world/shipGuns'
import { TURRET_FLASH_SECONDS } from '../world/turrets'

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

const templates = new Map<ShipClassId, Object3D>()

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
 * 【為什麼要指定要哪幾艘】`japan-m4` 只用 Wichita 與 Fletcher。無條件載
 * 三艘等於為了一關沒出現的航母多下載一份 GLB。
 */
export async function preloadShipModels(ids: readonly ShipClassId[]): Promise<void> {
  const loader = new GLTFLoader()
  await Promise.all([...new Set(ids)].map(async (id) => {
    if (templates.has(id)) return
    const gltf = await loader.loadAsync(SHIP_CLASSES[id].url)
    // 【量一次就好】包圍盒與船在哪無關，而 `setFromObject` 要走遍整棵樹
    gltf.scene.updateMatrixWorld(true)
    modelTops.set(id, BOX.setFromObject(gltf.scene).max.y)
    templates.set(id, gltf.scene)
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
/** 槍焰的尺寸。每幀每砲寫一次 —— 用 clone() 的話那是每秒上千次配置。 */
const SCALE = /* @__PURE__ */ new Vector3()

export function createShipModels(ships: readonly Ship[]): ShipModels {
  const object = new Group()
  const hulls: Object3D[] = []

  for (const s of ships) {
    const t = templates.get(s.cls.id)
    if (t === undefined) {
      throw new Error(`艦級 ${s.cls.id} 的 GLB 還沒載入 —— 少了 preloadShipModels()`)
    }
    const g = t.clone(true)
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
          M.compose(P, Q.identity(), SCALE.copy(ONE).multiplyScalar(f))
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
    },
  }
}
