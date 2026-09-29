import { BufferAttribute, BufferGeometry } from 'three'

/**
 * 佈景切塊的格寬，m。
 *
 * 【為什麼要切】廠區與機場的佈景各是一顆合併網格，廠區那一顆 29.7 萬個三角形、包圍
 * 半徑 12 km —— three 的視錐剔除用包圍球，那顆球恆與視錐相交，背對廠區時照畫全部。
 * 切成方格之後每一格各有自己的包圍球，畫面外的整格丟掉。
 *
 * 【格寬取捨】格數就是 draw call 數。一公里讓廠區切成十幾塊：背對時幾乎全剔，
 * 面對時多十幾次 draw call。
 */
export const SCENERY_CHUNK = 1000

/**
 * 三角形少於這個數的格不自成一塊，全部併進同一塊「零散」的。
 *
 * 【為什麼】廠區的 GLB 鋪滿整張圖：八成的格只有幾百個三角形（圍牆、零星的設備），
 * 各自一塊就是八十幾次 draw call。併起來那一塊包圍球很大、幾乎永遠在畫，但總共
 * 只有一萬多個三角形。
 */
export const SCENERY_MIN_TRIS = 4000

/**
 * 把非索引的三角形湯依三角形重心切成 `cell` 見方的格，每格一顆幾何，各自算好包圍球。
 * 三角形少於 `minTris` 的格併成最後一塊。
 *
 * 三角形與它的每一個屬性整組搬過去，不重排頂點、不去重 —— 合起來與原幾何是同一批
 * 三角形。回傳的幾何各自擁有自己的屬性陣列，可以各自 dispose。
 */
export function splitByGrid(
  geometry: BufferGeometry, cell: number, minTris: number = 0,
): BufferGeometry[] {
  if (geometry.index !== null) throw new Error('splitByGrid：只收非索引的幾何')
  const pos = geometry.getAttribute('position')
  const tris = pos.count / 3
  // 每個三角形落在哪一格
  const keyOf = new Float64Array(tris)
  const count = new Map<number, number>()
  for (let t = 0; t < tris; t++) {
    const v = t * 3
    const cx = (pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2)) / 3
    const cz = (pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2)) / 3
    // 格號平移到非負再合成一個數：±5 萬格（±50 km）綽綽有餘
    const key = (Math.floor(cx / cell) + 50000) * 100000 + (Math.floor(cz / cell) + 50000)
    keyOf[t] = key
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  // 【零散的格改到同一個鍵】-1 排在最前面，所以是回傳的第一塊
  const REST = -1
  const small = new Set<number>()
  for (const [key, n] of [...count]) {
    if (n >= minTris) continue
    small.add(key)
    count.delete(key)
    count.set(REST, (count.get(REST) ?? 0) + n)
  }
  if (small.size > 0) for (let t = 0; t < tris; t++) if (small.has(keyOf[t]!)) keyOf[t] = REST
  const keys = [...count.keys()].sort((a, b) => a - b)
  const names = Object.keys(geometry.attributes)
  const out: BufferGeometry[] = []
  for (const key of keys) {
    const n = count.get(key)! * 3
    const g = new BufferGeometry()
    for (const name of names) {
      const src = geometry.getAttribute(name) as BufferAttribute
      const size = src.itemSize
      const arr = new (src.array.constructor as Float32ArrayConstructor)(n * size)
      let w = 0
      for (let t = 0; t < tris; t++) {
        if (keyOf[t] !== key) continue
        const from = t * 3 * size
        for (let k = 0; k < 3 * size; k++) arr[w++] = src.array[from + k]!
      }
      g.setAttribute(name, new BufferAttribute(arr, size, src.normalized))
    }
    g.computeBoundingSphere()
    out.push(g)
  }
  return out
}
