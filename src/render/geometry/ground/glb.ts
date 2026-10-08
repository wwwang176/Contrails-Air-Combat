import { BufferAttribute, BufferGeometry, Color, Material, Mesh, Object3D, Vector3 } from 'three'
import { GUN_TURRET_KEY, type GroundTurretNodes, type GunTurretParts } from './turret'
import { createGltfLoader } from '../gltfLoader'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GLB_MATERIALS, PLANT_MATERIALS } from './palette'
export { GLB_MATERIALS, PLANT_MATERIALS } from './palette'
import { assetUrl } from '../../../core/asset'

const C = /* @__PURE__ */ new Color()

export async function parseGroundGlb(buf: ArrayBuffer, turret?: GroundTurretNodes): Promise<BufferGeometry> {
  const scene = await new Promise<Object3D>((res, rej) => {
    createGltfLoader().parse(buf, '', (gltf) => res(gltf.scene), rej)
  })
  return bakeGroundScene(scene, turret)
}

/**
 * 轉軸節點的世界位置。**只能有平移**：拆塊時頂點只減掉轉軸的位置，節點帶旋轉或縮放的話
 * 拆開的那一塊會躺在錯的方向上，而且放回靜止姿勢時才對得上 —— 轉起來才歪。
 */
function pivotOf(scene: Object3D, name: string): { node: Object3D; at: Vector3 } {
  const node = scene.getObjectByName(name)
  if (node === undefined) throw new Error(`GLB 裡沒有砲塔轉軸節點 ${name}`)
  const e = node.matrixWorld.elements
  const linear = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]
  const unit = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  if (linear.some((v, i) => Math.abs(v! - unit[i]!) > 1e-6)) {
    throw new Error(`砲塔轉軸節點 ${name} 帶旋轉或縮放 —— 轉軸只能有平移`)
  }
  return { node, at: new Vector3(e[12], e[13], e[14]) }
}

/** `o` 是不是 `anc` 本身或它的後代 */
function under(o: Object3D, anc: Object3D): boolean {
  for (let p: Object3D | null = o; p !== null; p = p.parent) if (p === anc) return true
  return false
}

/**
 * 把場景裡的網格烘成一顆帶頂點色、不共用頂點的幾何。
 *
 * 給 `turret` 時照祖先分三塊：Elevate 底下的是上下抬那一塊、其餘 Traverse 底下的是水平轉那一塊、
 * 剩下的固定。回傳固定那一塊，另外兩塊各自減掉轉軸的位置，掛在 `userData[GUN_TURRET_KEY]`。
 */
export function bakeGroundScene(scene: Object3D, turret?: GroundTurretNodes): BufferGeometry {
  scene.updateMatrixWorld(true)
  const trav = turret === undefined ? null : pivotOf(scene, turret.traverse)
  const elev = turret === undefined ? null : pivotOf(scene, turret.elevate)
  if (trav !== null && elev !== null && !under(elev.node, trav.node)) {
    throw new Error(`砲塔的 Elevate 節點 ${turret!.elevate} 不在 Traverse 節點 ${turret!.traverse} 底下`)
  }

  const fixed: BufferGeometry[] = []
  const traversing: BufferGeometry[] = []
  const elevating: BufferGeometry[] = []
  const seen = new Set<string>()
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    const name = (mesh.material as Material).name
    const hex = GLB_MATERIALS[name] ?? PLANT_MATERIALS[name]
    if (hex === undefined) throw new Error(`GLB 材質 ${name} 沒有對應的遊戲顏色`)
    seen.add(name)

    // 烘進世界座標、展開索引（不共用頂點 → flat shading 的稜線是硬的），
    // 只留位置與顏色：法線由合併後統一算，UV 沒有人用。
    const g = mesh.geometry.toNonIndexed()
    g.applyMatrix4(mesh.matrixWorld)
    for (const attr of Object.keys(g.attributes)) {
      if (attr !== 'position') g.deleteAttribute(attr)
    }
    C.setHex(hex)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = C.r
      col[i * 3 + 1] = C.g
      col[i * 3 + 2] = C.b
    }
    g.setAttribute('color', new BufferAttribute(col, 3))
    if (elev !== null && under(mesh, elev.node)) {
      g.translate(-elev.at.x, -elev.at.y, -elev.at.z)
      elevating.push(g)
    } else if (trav !== null && under(mesh, trav.node)) {
      g.translate(-trav.at.x, -trav.at.y, -trav.at.z)
      traversing.push(g)
    } else {
      fixed.push(g)
    }
  })
  if (fixed.length + traversing.length + elevating.length === 0) throw new Error('GLB 裡沒有任何網格')

  const geo = mergeParts(fixed, '固定')
  geo.userData['materials'] = [...seen]
  if (trav !== null && elev !== null) {
    const parts: GunTurretParts = {
      traverse: mergeParts(traversing, '水平轉'),
      elevate: mergeParts(elevating, '上下抬'),
      traversePivot: trav.at,
      elevatePivot: elev.at.clone().sub(trav.at),
    }
    geo.userData[GUN_TURRET_KEY] = parts
  }
  return geo
}

/** 合併一組、算法線與包圍球。空的一組是登記錯了（某一塊底下沒有任何網格） */
function mergeParts(parts: BufferGeometry[], what: string): BufferGeometry {
  if (parts.length === 0) throw new Error(`地面單位的 GLB：${what}那一塊沒有任何網格`)
  const geo = mergeGeometries(parts)
  if (geo === null) throw new Error('地面單位的 GLB 合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

const cache = new Map<string, BufferGeometry>()

/** 預設的取檔方式。node 測試自己讀檔、傳自己的 fetcher。 */
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(url))
  if (!res.ok) throw new Error(`載入 ${url} 失敗：HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** 一支要預載的 GLB：路徑與它的砲塔節點（沒有砲塔就省略） */
export interface GroundGlbSource {
  readonly url: string
  readonly turret?: GroundTurretNodes
}

/**
 * 開場 await 一次。重複呼叫是 no-op。
 *
 * 【同一支 GLB 的砲塔登記要一致】快取以路徑為鍵，拆不拆只做一次。兩個單位共用同一支
 * （`flakLight` 與 `atGun`）卻登記了不同的節點，後面那一個拿到的是前面那一個的拆法 —— 丟錯。
 *
 * @param onLoaded 每一支好了呼叫一次（已經載過的也算），次數是 `sources` 依路徑去重後的數量
 */
export async function preloadGroundGlbs(
  sources: readonly GroundGlbSource[],
  fetcher: (url: string) => Promise<ArrayBuffer> = fetchBuffer,
  onLoaded: () => void = () => {},
): Promise<void> {
  const byUrl = new Map<string, GroundTurretNodes | undefined>()
  for (const s of sources) {
    if (byUrl.has(s.url)) {
      const a = byUrl.get(s.url)
      if (a?.traverse !== s.turret?.traverse || a?.elevate !== s.turret?.elevate) {
        throw new Error(`${s.url} 被登記了兩種不同的砲塔節點`)
      }
    } else {
      byUrl.set(s.url, s.turret)
    }
  }
  await Promise.all([...byUrl].map(async ([url, turret]) => {
    if (!cache.has(url)) cache.set(url, await parseGroundGlb(await fetcher(url), turret))
    onLoaded()
  }))
}

/**
 * 已載入的幾何。**同一份共用**，不 clone —— 幾何是唯讀的，幾台同款各自
 * 一顆 Mesh 指著同一份就好。
 */
export function groundGlb(url: string): BufferGeometry {
  const g = cache.get(url)
  if (g === undefined) throw new Error(`${url} 還沒載入 —— 少了 preloadGroundGlbs()`)
  return g
}
