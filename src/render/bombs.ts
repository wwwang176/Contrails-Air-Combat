import {
  BoxGeometry, BufferGeometry, InstancedMesh, LatheGeometry, MeshLambertMaterial,
  Object3D, Quaternion, Vector2, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BOMBS_CAPACITY } from '../world/bomb'
import { TORPEDOES_CAPACITY } from '../world/torpedo'

const DUMMY = new Object3D()
const DIR = new Vector3()
/** 模型的尖端方向（局部座標）。姿態就是「把這一根轉到速度上」 */
const NOSE = new Vector3(0, -1, 0)
const Q = new Quaternion()

/** 收起來時擺去哪裡。遠低於任何地形，而且 `frustumCulled` 關著所以不會被誤剔 */
const PARKED_Y = -1e6

/** 全長，m。AN-M64 500 lb 的 1.5 m 量級 */
export const BOMB_LENGTH = 1.6
/** 彈體最大半徑，m。直徑 0.36 m 同上 */
export const BOMB_BODY_RADIUS = 0.18

/** 旋成體的徑向段數。彈體因此是五邊形剖面 */
const RADIAL = 5

/**
 * 旋成體的輪廓，`[半徑, 軸向]`。**軸向 −Y 是頭、+Y 是尾。**
 *
 * 【頭是鈍的】二戰通用炸彈的頭部裝引信，不收尖。0.03 的平頭同時省掉旋成體
 * 頂點那一圈的退化三角形。
 *
 * 【尾管收到 0.115】收尾錐（boat tail）之後是裝尾翼的那一段，比彈體細。
 */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.030, -0.800],
  [0.115, -0.720],
  [0.180, -0.500],
  [0.180, 0.280],
  [0.115, 0.560],
  [0.115, 0.800],
  [0.000, 0.800],
]

const FIN_THICK = 0.012

/**
 * 一種彈藥的外型。**輪廓表 `PROFILE` 是炸彈的絕對尺寸**，這裡的兩個倍率
 * 對它縮放。
 *
 * 【為什麼倍率而不是各寫一張輪廓表】兩者是同一個形狀的長短胖瘦，寫兩張表
 * 等於把「頭是鈍的」「尾管比彈體細」這些決定抄兩份。而且炸彈的倍率是 1，
 * `x * 1` 在 IEEE754 下精確 —— 參數化前後的頂點逐位元相同。
 */
export interface OrdnanceShape {
  /** 軸向倍率。全長 = `BOMB_LENGTH × lengthScale` */
  readonly lengthScale: number
  /** 徑向倍率。最大直徑 = `BOMB_BODY_RADIUS × 2 × radiusScale` */
  readonly radiusScale: number
  /** 尾翼的跨度與弦長，m（**最終尺寸，不再乘倍率**） */
  readonly finSpan: number
  readonly finChord: number
  /** 尾翼的軸向位置，m（同上，最終尺寸） */
  readonly finY: number
}

/** AN-M64 500 lb：全長 1.6 m、直徑 0.36 m */
export const BOMB_SHAPE: OrdnanceShape = {
  lengthScale: 1,
  radiusScale: 1,
  finSpan: 0.34,
  finChord: 0.34,
  finY: 0.61,
}

/**
 * 九一式改三 航空魚雷：全長 5.27 m、直徑 0.45 m。
 *
 * 【就是把炸彈拉長】長徑比由 4.4 變成 11.7 —— 軸向 ×3.294、徑向 ×1.25。
 * 尾翼跨度收到與彈體同寬（0.45 m），不像炸彈那樣相對彈體那麼大。
 */
export const TORPEDO_SHAPE: OrdnanceShape = {
  lengthScale: 3.294,
  radiusScale: 1.25,
  finSpan: 0.45,
  finChord: 0.55,
  finY: 2.30,
}

/**
 * 渲染這一批彈藥要讀的欄位。**`Bombs` 與 `Torpedoes` 都符合。**
 *
 * 【為什麼是結構型別而不是聯集】兩個池的欄位名一樣，而這一層只讀不寫。
 * 寫成聯集的話每加一種彈藥都要回來改一次。
 */
export interface OrdnancePool {
  readonly active: Uint8Array
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
}

export interface BombVisuals {
  object: InstancedMesh
  update(pool: OrdnancePool): void
  dispose(): void
}

/**
 * 一枚炸彈的幾何：卵形頭 + 圓柱彈體 + 收尾錐 + 十字尾翼。
 *
 * 【為什麼是程序化而不是 GLB】它進的是 `InstancedMesh`，要的是**單一**
 * `BufferGeometry`；而這個外型全部由旋成體與兩片交叉板構成，寫成輪廓表比
 * 匯出一支模型再合併分塊短得多。
 *
 * 【尾翼是兩片交叉的薄板而不是四片鰭】四片各自獨立是四個盒子 48 個三角形，
 * 交叉兩片是 24 個，畫面上完全一樣 —— 板穿過彈體的那一段在裡面看不到。
 */
export function createBombGeometry(shape: OrdnanceShape = BOMB_SHAPE): BufferGeometry {
  const body = new LatheGeometry(
    PROFILE.map(([r, y]) => new Vector2(r * shape.radiusScale, y * shape.lengthScale)),
    RADIAL,
  )
  const finA = new BoxGeometry(shape.finSpan, shape.finChord, FIN_THICK)
    .translate(0, shape.finY, 0)
  const finB = finA.clone().rotateY(Math.PI / 2)
  const merged = mergeGeometries([body, finA, finB], false)
  body.dispose()
  finA.dispose()
  finB.dispose()
  if (merged === null) throw new Error('mergeGeometries 回 null：屬性集合不一致')
  return merged
}

/**
 * 炸彈的姿態：**尖端朝速度**。就地寫進 `out`。
 *
 * 【方向是尖端不是尾巴】`setFromUnitVectors(from, to)` 轉的是 `from`，所以
 * 這裡要餵局部的 −Y（尖端）。餵 +Y 的話炸彈整支倒過來飛，而且不會有任何
 * 錯誤 —— 尾翼在前看起來一樣「有姿態」。
 *
 * 【為什麼抽成函數】上面那件事只有算出來才看得見，而 `update` 進不了單元
 * 測試。
 */
export function bombOrientation(
  vx: number, vy: number, vz: number, out: Quaternion,
): void {
  DIR.set(vx, vy, vz).normalize()
  out.setFromUnitVectors(NOSE, DIR)
}

/**
 * 一批同型彈藥的實例池。炸彈與魚雷共用 —— 兩者的差別只有幾何、容量與顏色。
 */
function createOrdnanceVisuals(
  shape: OrdnanceShape, capacity: number, color: number,
): BombVisuals {
  const geo = createBombGeometry(shape)
  const mat = new MeshLambertMaterial({ color })
  const mesh = new InstancedMesh(geo, mat, capacity)
  // 【關掉視錐剔除】包圍盒是建構時算的，而實例每幀在動 —— 開著的話整批會在
  // 相機轉開時消失。與其他實例池同一個處置
  mesh.frustumCulled = false
  mesh.count = capacity

  return {
    object: mesh,
    update(pool) {
      for (let i = 0; i < capacity; i++) {
        if (pool.active[i] === 0) {
          DUMMY.position.set(0, PARKED_Y, 0)
          DUMMY.quaternion.identity()
        } else {
          DUMMY.position.set(pool.x[i]!, pool.y[i]!, pool.z[i]!)
          const vx = pool.vx[i]!
          const vy = pool.vy[i]!
          const vz = pool.vz[i]!
          // 【順著氣流轉正】炸彈投下的第一瞬間速度是水平的，落地前幾乎
          // 垂直 —— 那個轉正本身就讀得出彈道。魚雷入水之後速度恆為水平，
          // 所以同一支公式也讓它平著跑
          if (vx * vx + vy * vy + vz * vz > 1e-6) {
            bombOrientation(vx, vy, vz, Q)
            DUMMY.quaternion.copy(Q)
          }
        }
        DUMMY.updateMatrix()
        mesh.setMatrixAt(i, DUMMY.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      mesh.dispose()
    },
  }
}

/** 空中的炸彈。 */
export function createBombs(): BombVisuals {
  return createOrdnanceVisuals(BOMB_SHAPE, BOMBS_CAPACITY, 0x4a4a48)
}

/**
 * 空中與水中的魚雷。
 *
 * 【與炸彈是兩個 `InstancedMesh`】一個實例池只畫一種幾何。多一個繪製呼叫，
 * 而池只有 8 格。
 *
 * 【顏色比炸彈深一點】雷體是黑的，而且水中段只露出水面下 1 m —— 太亮會像
 * 浮在水面上。
 */
export function createTorpedoes(): BombVisuals {
  return createOrdnanceVisuals(TORPEDO_SHAPE, TORPEDOES_CAPACITY, 0x2e3236)
}
