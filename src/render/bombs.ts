import {
  BoxGeometry, BufferGeometry, InstancedMesh, LatheGeometry, MeshLambertMaterial,
  Object3D, Quaternion, Vector2, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BOMBS_CAPACITY, type Bombs } from '../world/bomb'

const DUMMY = new Object3D()
const DIR = new Vector3()
const TAIL = new Vector3(0, 1, 0)
const Q = new Quaternion()

/** 收起來時擺去哪裡。遠低於任何地形，而且 `frustumCulled` 關著所以不會被誤剔 */
const PARKED_Y = -1e6

/** 全長，m。AN-M64 500 lb 的 1.5 m 量級 */
export const BOMB_LENGTH = 1.6
/** 彈體最大半徑，m。直徑 0.36 m 同上 */
export const BOMB_BODY_RADIUS = 0.18

/** 旋成體的徑向段數。8 段在空中的尺度上已經讀不出稜線，再多只是三角形 */
const RADIAL = 8

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

/** 尾翼：十字四片。跨度與彈體同寬、軸向從 0.44 到 0.78 */
const FIN_SPAN = 0.34
const FIN_CHORD = 0.34
const FIN_THICK = 0.012
const FIN_Y = 0.61

export interface BombVisuals {
  object: InstancedMesh
  update(bombs: Bombs): void
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
export function createBombGeometry(): BufferGeometry {
  const body = new LatheGeometry(PROFILE.map(([r, y]) => new Vector2(r, y)), RADIAL)
  const finA = new BoxGeometry(FIN_SPAN, FIN_CHORD, FIN_THICK).translate(0, FIN_Y, 0)
  const finB = finA.clone().rotateY(Math.PI / 2)
  const merged = mergeGeometries([body, finA, finB], false)
  body.dispose()
  finA.dispose()
  finB.dispose()
  if (merged === null) throw new Error('mergeGeometries 回 null：屬性集合不一致')
  return merged
}

/**
 * 空中的炸彈。
 */
export function createBombs(): BombVisuals {
  const geo = createBombGeometry()
  const mat = new MeshLambertMaterial({ color: 0x4a4a48 })
  const mesh = new InstancedMesh(geo, mat, BOMBS_CAPACITY)
  // 【關掉視錐剔除】包圍盒是建構時算的，而實例每幀在動 —— 開著的話整批會在
  // 相機轉開時消失。與其他實例池同一個處置
  mesh.frustumCulled = false
  mesh.count = BOMBS_CAPACITY

  return {
    object: mesh,
    update(bombs) {
      for (let i = 0; i < BOMBS_CAPACITY; i++) {
        if (bombs.active[i] === 0) {
          DUMMY.position.set(0, PARKED_Y, 0)
          DUMMY.quaternion.identity()
        } else {
          DUMMY.position.set(bombs.x[i]!, bombs.y[i]!, bombs.z[i]!)
          DIR.set(bombs.vx[i]!, bombs.vy[i]!, bombs.vz[i]!)
          // 【尖端朝速度】炸彈順著氣流轉正。投下的第一瞬間速度是水平的，
          // 落地前幾乎垂直 —— 那個轉正本身就讀得出彈道
          if (DIR.lengthSq() > 1e-6) {
            DIR.normalize()
            DUMMY.quaternion.copy(Q.setFromUnitVectors(TAIL, DIR))
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
