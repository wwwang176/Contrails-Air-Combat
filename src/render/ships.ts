import {
  AdditiveBlending, CanvasTexture, DoubleSide, DynamicDrawUsage, Group,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry,
  Quaternion, SRGBColorSpace, Vector3,
} from 'three'
import { numberCanvas, numberMaterial, shipNumber } from './shipNumbers'
import { SHIP_LIVERIES, liveryVariant } from './shipLiveries'
import type { Ship } from '../world/ships'
import { MAX_SHIP_GUNS } from '../world/shipGuns'
import { TURRET_FLASH_SECONDS } from '../world/turrets'
import { shipTemplates, shipNumberDecal } from './shipAssets'
export {
  buildShipNumberDecals, liveryVariantOf, applyShipLivery, dressShipModel,
  shipModelTop, preloadShipModels,
} from './shipAssets'

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
    const ts = shipTemplates(s.cls.id)
    if (ts === undefined) {
      throw new Error(`艦級 ${s.cls.id} 的 GLB 還沒載入 —— 少了 preloadShipModels()`)
    }
    const g = ts[liveryVariant(s.index, ts.length)]!.clone(true)
    // 【號碼一艘一張字圖】幾何同艦級共用，字圖跟著這一艘建、跟著它釋放
    const numbers = SHIP_LIVERIES[s.cls.id]?.numbers
    const decal = shipNumberDecal(s.cls.id)
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
      // 實例矩陣的 GPU 緩衝要靠 mesh 自己的 dispose 放掉；選單短片每一段重建一次船
      flashes.dispose()
      for (const o of owned) o.dispose()
    },
  }
}
