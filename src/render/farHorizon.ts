import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from 'three'
import { applyFields } from './farmGround'
import type { Season } from './season'
import { FARM_EXTENT } from '../world/farmland'

/**
 * 遠景環 —— 細節地形之外的那一片平地。**中央 30 km 見方是空的**，正好由
 * 細節地形填。
 *
 * 【為什麼是環而不是一整片】兩者都是地面，重疊就會 z-fighting。相機遠平面
 * 5,000 km，深度量化 `Δz ≈ z²/2²⁴` 在細節地形的角落（離中心 21 km）已經是
 * 26 m —— 要靠沉下去避開就得沉 26 m 以上，而那在交界處是一道看得見的坎。
 * 挖洞之後兩者只共用一條邊，問題不存在。
 *
 * 【為什麼不跟著鏡頭走】1,000 km 從 12 km 的界內永遠看不到邊，跟著走換不到
 * 任何東西。而**不跟著走**換到的是「與細節地形沒有任何重疊面積」。
 *
 * 【為什麼不能不寫深度】初稿想用天空球那一招（`depthWrite: false` 加負的
 * `renderOrder`）。那是錯的 —— 不寫深度等於它不遮任何東西：
 *
 * ```
 *   render/wrecks.ts    殘骸落到地表下 25 m 才回收 → 看得到它沉在地裡
 *   render/sparks.ts    火花本身 depthWrite:false、吃重力、沒有地面碰撞
 *   上帝視角             相機飛得出細節區
 * ```
 *
 * 【接縫為什麼不會裂】兩邊的邊都是 `y = 0` 上的直線，而且 x（或 z）都恰好
 * 是 `±FARM_EXTENT / 2` —— 共用一條邊，細分數不必相同。
 */

/** 環往外鋪到哪裡，m。霧在 100 km 已經吃掉 86% */
export const FAR_GROUND_REACH = 1_000_000

/**
 * 外圈每一邊切幾段。
 *
 * 【為什麼不是一整塊】田的取樣座標由頂點的世界座標透視插值而來，而 float32
 * 在 10⁶ 量級的解析度是 0.06 m。單格 98.5 km 下誤差遠小於一條 18 m 的樹籬
 * —— 與遠海碎光那次（`ocean.ts` 的 `FAR_SEGMENTS`）同一個帳。
 */
const RINGS = 10

const ROUGHNESS = 0.95

/**
 * 座標軸上的格線：`−REACH … −half`，然後 `+half … +REACH`。
 * **`±half` 之間沒有格線** —— 那一格就是要挖掉的洞。
 */
function axis(half: number): number[] {
  const step = (FAR_GROUND_REACH - half) / RINGS
  const out: number[] = []
  for (let i = RINGS; i >= 0; i--) out.push(-(half + i * step))
  for (let i = 0; i <= RINGS; i++) out.push(half + i * step)
  return out
}

export interface FarHorizon {
  readonly mesh: Mesh
  dispose(): void
}

/**
 * **不吃 `site`。** 廠區那一層的 GLSL（墊面、鋪面、鐵路、道路）是每個像素都跑
 * 的，而道路那一段還刻意留在外接矩形判斷之外 —— 連外道路要畫到圖邊。但環
 * 中央挖掉的洞就是細節地形那 30 km 見方，廠區與所有連外線段都在洞裡，環上
 * 一個像素都畫不到它們。餵進來只會讓 1,000 km 的環每個像素白跑十五段點線
 * 距離，畫面完全不變。
 *
 * 【前提由測試守著】`far-horizon.test.ts` 有一條在驗那些線段真的都在 ±15 km
 * 以內。有人把連外道路拉出去而這裡沒跟著改的話，環上會少畫一截 —— 不報錯。
 */
/** `open` 同 `createFarmGround` */
export function createFarHorizon(season: Season = 'summer', open = false): FarHorizon {
  const half = FARM_EXTENT / 2
  const xs = axis(half)
  const n = xs.length

  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = (j * n + i) * 3
      positions[v] = xs[i]!
      positions[v + 1] = 0
      positions[v + 2] = xs[j]!
      normals[v] = 0
      normals[v + 1] = 1
      normals[v + 2] = 0
    }
  }

  // 【挖掉中央那一格】`axis` 讓 −half 與 +half 相鄰，所以洞恰好是一格。
  // 由上往下看要逆時針（three 的 FrontSide 是 CCW），法線才朝上
  const mid = RINGS   // xs[mid] === −half、xs[mid + 1] === +half
  const indices: number[] = []
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      if (i === mid && j === mid) continue
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()

  // 【平的東西不必 flatShading】法線全部是 +Y，兩種著色結果相同，而關掉
  // 少一個 shader 變體
  const material = new MeshStandardMaterial({ flatShading: false, roughness: ROUGHNESS })
  applyFields(material, season, undefined, undefined, open)

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false

  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
