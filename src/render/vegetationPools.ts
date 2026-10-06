/** 植被 GPU 池的資源所有權、雙緩衝與可見區段；串流引擎只寫入預配的陣列。 */
import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group,
  InstancedBufferAttribute, InstancedInterleavedBuffer, InstancedMesh, InterleavedBufferAttribute,
  MeshStandardMaterial, Points, PointsMaterial, Sphere, Vector3, type Camera,
} from 'three'
import { CULL, frustumPlanesOf, shareGeometry, visibleRuns } from './cullRuns'
import {
  createFloraGeometries, disposeFloraGeometries, pointColorOf,
  type MeshPool, type PointPool, type PoolName,
} from './floraShapes'
import { POOL_NAMES, IS_POINT, RUN_CAP, RUN_SPLIT_MIN } from './vegetationPolicy'
import type { Season } from './season'

/**
 * 遠處那三個池的材質。**`gl.POINTS`。**
 *
 * 【為什麼是點】6 km 的樹只有 2.1 px 寬 —— 圓的方的三角的在那個尺度上是
 * 同一團色塊。點一株只要一個頂點與 56 byte（位置 3 ＋ 顏色 3 ＋ 大小 1，
 * 雙緩衝），而一片轉向鏡頭的網格要三到六個頂點與 152 byte（矩陣 16 ＋
 * 顏色 3，雙緩衝）。
 * 而幀時間的大頭是 `bufferSubData`。
 *
 * 【側面的好處】一片只繞 Y 轉的網格由正上方俯視時是側面朝上、幾乎看不見 ——
 * 而那是空戰最常見的視角。點是螢幕對齊的，俯視時照樣是方塊。
 *
 * 【`size` 一定要留著且設成 1】DPR 藏在它裡面：`WebGLMaterials` 寫的是
 * `uniforms.size.value = material.size * pixelRatio`，而
 * `uniforms.scale.value = height * 0.5` 用的是 **CSS 高**。把 `size` 整個
 * 換掉的話，DPR = 2 的螢幕上點只有一半大 —— 而在 DPR = 1 的機器上完全正常。
 *
 * 四個因子相乘就是「世界長度 `aSize` 的緩衝區像素數」：
 *
 * ```
 *   aSize                     世界長度，m（逐株屬性）
 *   projectionMatrix[1][1]    1 / tan(fovY/2)
 *   size                      1 × devicePixelRatio      ← three 乘上去的
 *   scale / -mvPosition.z     (CSS 高 / 2) / 距離        ← sizeAttenuation
 * ```
 *
 * 【點吃不到光照】`PointsMaterial` 是 basic 的。開局後光照固定，所以亮度
 * 由 `POINT_LIGHT` 烘進逐株的顏色 —— 見那個常數。
 */
function createPointMaterial(): PointsMaterial {
  const m = new PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: 1 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader
      .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[1][1] * size;')
      // 往下看亮一點（`POINT_TOPDOWN_GAIN`）：俯角由鏡頭到這一點的方向算
      .replace('#include <color_vertex>', `#include <color_vertex>
{
  vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  vColor.rgb *= 1.0 + ${(POINT_TOPDOWN_GAIN - 1).toFixed(3)} * smoothstep(0.0, ${POINT_TOPDOWN_RAMP.toFixed(3)}, toCam.y);
}`)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用
  m.customProgramCacheKey = () => 'flora-point'
  return m
}

/**
 * 點池的亮度補償。**逐通道乘在樹冠色上。**
 *
 * 【為什麼要有它】點走 `PointsMaterial`，吃不到場上那三盞燈；而它取代的
 * 中級樹冠走 `MeshStandardMaterial`，是被照亮的。不補的話過 3 km 門檻時
 * 整片林相會暗一階。
 *
 * 【值是量出來的】`flora-card.e2e.ts` 在 `POINT_NEAR` 兩側各量一次平均 RGB
 * （2,500 m 的中級樹冠對 3,600 m 的點），要求亮度差在 8% 以內。實測 −2.5%。
 *
 * 【小於 1 是對的】輸出是 sRGB 編碼的，而樹冠色本身就是那個亮度 —— 補的是
 * 「標準材質在這組燈下比純色暗一點」那一段，不是「把暗的補亮」。
 *
 * 【烘一次成立是因為開局後光照固定】燈的定義在 `render/lighting.ts`，量測
 * 用的 fixture 與正式場景共用同一份 —— 各配一組的話係數會是錯的。
 */
export const POINT_LIGHT = new Color(0.36, 0.36, 0.36)

/**
 * 往下看時點要再亮多少：平視乘 1，sin(俯角) 到 `POINT_TOPDOWN_RAMP` 之間平滑升到
 * 這個數，再往下都是它。
 *
 * 【為什麼要跟著角度】`POINT_LIGHT` 是平視校的（樹冠多半露側面、偏暗）；往下看露出
 * 被太陽照亮的樹冠頂，同一片林子亮得多，而點是平的色塊，哪個角度看都一樣。實測
 * 1.5 km 與 3 km 高度看 3.5～5.5 km 的林子（sin 俯角 0.26～0.65），點都要乘約 1.45
 * 才與樹冠、遠處的烘圖接得上；不跟著角度的話，那一圈比兩側暗一截
 */
export const POINT_TOPDOWN_GAIN = 1.45

/** 俯角的正弦到這裡就用滿 `POINT_TOPDOWN_GAIN`（約 11.5°） */
export const POINT_TOPDOWN_RAMP = 0.2

/**
 * 實例池的一段：一顆 `InstancedMesh`，實例矩陣與顏色是指向池緩衝某個位移的
 * interleaved 屬性。
 *
 * 【每條屬性兩個物件，只改沒在 VAO 裡的那一個】three 的 VAO 快取（以幾何與程式為鍵）
 * 用屬性**物件的身分**決定要不要重設指標 —— 只改 `offset` 不換物件，畫出來的是舊
 * 位移。而快取裡記的是**上一次真的畫的時候**綁的那一個，所以 `onBeforeRender` 記下它，
 * `aimRun` 只改另一個再換上去。隱藏期間改來改去也不會碰到快取裡那一個。
 *
 * 【換物件的那一幀會配置】three 重設 VAO 時（`saveCache`）為每條屬性配一個小物件。
 * 只發生在段的起點變了的那一幀（轉頭、飛越格界），一幀至多幾十次；身分一換就走這條，
 * 繞不開
 */
interface MeshRun {
  mesh: InstancedMesh
  mat: [InterleavedBufferAttribute, InterleavedBufferAttribute]
  col: [InterleavedBufferAttribute, InterleavedBufferAttribute]
  /** 上一次真的畫出去時掛著的那兩個 */
  drawnMat: InterleavedBufferAttribute | null
  drawnCol: InterleavedBufferAttribute | null
}

function createMeshRun(
  geometry: BufferGeometry, material: MeshStandardMaterial,
  mat: InstancedInterleavedBuffer, col: InstancedInterleavedBuffer,
): MeshRun {
  // 【容量給 1】建構子配的那條矩陣立刻被換掉；實例數由 `count` 決定，不受它限制
  const mesh = new InstancedMesh(geometry, material, 1)
  const run: MeshRun = {
    mesh,
    mat: [new InterleavedBufferAttribute(mat, 16, 0), new InterleavedBufferAttribute(mat, 16, 0)],
    col: [new InterleavedBufferAttribute(col, 3, 0), new InterleavedBufferAttribute(col, 3, 0)],
    drawnMat: null,
    drawnCol: null,
  }
  // 【型別】three 的宣告只收 InstancedBufferAttribute；算繪那一側兩種都認
  mesh.instanceMatrix = run.mat[0] as unknown as InstancedBufferAttribute
  mesh.instanceColor = run.col[0] as unknown as InstancedBufferAttribute
  mesh.count = 0
  mesh.frustumCulled = false
  // 【包圍球先給】three 排序時會替沒有球的 InstancedMesh 自己算，而它讀矩陣不看位移 ——
  // 算出來的是別段的實例
  mesh.boundingSphere = new Sphere(new Vector3(), Infinity)
  mesh.onBeforeRender = () => {
    run.drawnMat = mesh.instanceMatrix as unknown as InterleavedBufferAttribute
    run.drawnCol = mesh.instanceColor as unknown as InterleavedBufferAttribute
  }
  return run
}

/** 讓這一段從池緩衝的第 `start` 筆開始畫。已經指在那裡就不動 —— 見 `MeshRun` */
function aimRun(
  run: MeshRun, mat: InstancedInterleavedBuffer, col: InstancedInterleavedBuffer, start: number,
): void {
  const m = run.mesh.instanceMatrix as unknown as InterleavedBufferAttribute
  if (m.data !== mat || m.offset !== start * 16) {
    const pick = run.mat[0] === run.drawnMat ? run.mat[1] : run.mat[0]
    pick.data = mat
    pick.offset = start * 16
    run.mesh.instanceMatrix = pick as unknown as InstancedBufferAttribute
  }
  const c = run.mesh.instanceColor as unknown as InterleavedBufferAttribute
  if (c.data !== col || c.offset !== start * 3) {
    const pick = run.col[0] === run.drawnCol ? run.col[1] : run.col[0]
    pick.data = col
    pick.offset = start * 3
    run.mesh.instanceColor = pick as unknown as InstancedBufferAttribute
  }
}

export function createVegetationPools(cap: Record<PoolName, number>, season: Season, tileCache: number) {
  const geometries = createFloraGeometries(season)
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9,
  })
  const pointMaterial = createPointMaterial()
  const group = new Group()
  /**
   * 十一個池。**遠處那三個是 `Points`，其餘八個是 `InstancedMesh`。**
   * 寫入路徑因此要分岔 —— 見 `rebuild`。
   *
   * 池物件本身是第 0 段；第 1 段以後掛在它底下（`object.children` 因此仍是一池一個）。
   */
  const pools: Record<PoolName, InstancedMesh | Points> =
    {} as Record<PoolName, InstancedMesh | Points>
  /** 點池的三條屬性，各兩份輪流換。索引順序：位置、顏色、大小 */
  const altPt: Partial<Record<PoolName, BufferAttribute[][]>> = {}
  /** 點池的樹冠色 × `POINT_LIGHT`，開場算一次 */
  const pointBase: Partial<Record<PoolName, Color>> = {}
  /**
   * 每個池兩份實例緩衝，重建時輪流換。**這是 1% low 的關鍵。**
   *
   * 【為什麼】對**正在被 GPU 讀的**那條緩衝呼叫 `bufferSubData` 時，驅動
   * 只能等 GPU 讀完或整條重配 —— 實測那一下是 190 ms。輪流換之後寫的永遠
   * 是上一幀沒在畫的那一份，寫完才掛上去。
   *
   * 【代價是記憶體加倍】兩份加起來 7.6 MB。全部開場配掉。
   *
   * 【interleaved 是為了逐段畫】WebGL2 沒有「從第 N 個實例開始畫」，所以每一段
   * 用一個 `offset` 指到段起點的 `InterleavedBufferAttribute`，全部指向同一條緩衝 ——
   * 上傳仍然是一池一條、一次。
   */
  const altMat: Record<PoolName, InstancedInterleavedBuffer[]> =
    {} as Record<PoolName, InstancedInterleavedBuffer[]>
  const altCol: Record<PoolName, InstancedInterleavedBuffer[]> =
    {} as Record<PoolName, InstancedInterleavedBuffer[]>
  const side: Record<PoolName, number> = {} as Record<PoolName, number>
  /** 實例池的每一段。`[0]` 是池物件本身 */
  const meshRuns: Partial<Record<PoolName, MeshRun[]>> = {}
  /** 點池的每一段。`[0]` 是池物件本身；各段的幾何共用同一批屬性 */
  const pointRuns: Partial<Record<PoolName, Points[]>> = {}
  for (const name of POOL_NAMES) {
    if (IS_POINT[name]) {
      const n = cap[name]
      const mk = (): BufferAttribute[] => {
        const a = [
          new BufferAttribute(new Float32Array(n * 3), 3),
          new BufferAttribute(new Float32Array(n * 3), 3),
          new BufferAttribute(new Float32Array(n), 1),
        ]
        for (const at of a) at.setUsage(DynamicDrawUsage)
        return a
      }
      const two = [mk(), mk()]
      altPt[name] = two
      side[name] = 0
      const runs: Points[] = []
      for (let r = 0; r < RUN_CAP; r++) {
        const geo = new BufferGeometry()
        geo.setAttribute('position', two[0]![0]!)
        geo.setAttribute('color', two[0]![1]!)
        geo.setAttribute('aSize', two[0]![2]!)
        geo.setDrawRange(0, 0)
        // 【包圍球自己給無限大】內容每次重建都換，three 算出來的球會過期；
        // 而 three 的剔除本來就關掉了 —— 見檔頭
        geo.boundingSphere = new Sphere(new Vector3(), Infinity)
        const pts = new Points(geo, pointMaterial)
        pts.frustumCulled = false
        if (r > 0) {
          pts.visible = false
          runs[0]!.add(pts)
        }
        runs.push(pts)
      }
      pointRuns[name] = runs
      pools[name] = runs[0]!
      group.add(runs[0]!)
      pointBase[name] = new Color(pointColorOf(name as PointPool, season)).multiply(POINT_LIGHT)
      continue
    }
    const mats = [0, 1].map(() => new InstancedInterleavedBuffer(
      new Float32Array(cap[name] * 16), 16, 1).setUsage(DynamicDrawUsage))
    const cols = [0, 1].map(() => new InstancedInterleavedBuffer(
      new Float32Array(cap[name] * 3), 3, 1).setUsage(DynamicDrawUsage))
    altMat[name] = mats
    altCol[name] = cols
    side[name] = 0
    // 【型別】上面那個 `continue` 已經把點池濾掉了，但 TS 收窄不到
    const base = geometries[name as MeshPool]
    const runs: MeshRun[] = []
    for (let r = 0; r < RUN_CAP; r++) {
      runs.push(createMeshRun(r === 0 ? base : shareGeometry(base), material, mats[0]!, cols[0]!))
      if (r > 0) {
        runs[r]!.mesh.visible = false
        runs[0]!.mesh.add(runs[r]!.mesh)
      }
    }
    meshRuns[name] = runs
    pools[name] = runs[0]!.mesh
    group.add(runs[0]!.mesh)
  }

  // ── 剔除用的區段表 ────────────────────────────────────
  /**
   * 每一池、每一份緩衝一張表：第 e 筆是「某一格在這一池的實例 `[start, end)`」與那些
   * 實例的包圍盒（minX, minY, minZ, maxX, maxY, maxZ）。
   *
   * 【盒子由實例本身算，不讀即時的槽位】槽位會被放掉、給新的格重用，而舊的那一份
   * 緩衝在下一次重建之前仍然掛著、仍然要剔。表跟著它的緩衝一起寫、一起換上去。
   *
   * 筆數不超過「有這一池實例的格數」，所以取快取格數與容量的較小者。以池在
   * `POOL_NAMES` 的索引存取。
   */
  const poolCount = POOL_NAMES.length
  const entStart: Int32Array[][] = []
  const entEnd: Int32Array[][] = []
  const entBox: Float32Array[][] = []
  /** 各池各份的筆數 */
  const entN: Int32Array[] = []
  for (let p = 0; p < poolCount; p++) {
    const m = Math.min(tileCache, cap[POOL_NAMES[p]!])
    entStart.push([new Int32Array(m), new Int32Array(m)])
    entEnd.push([new Int32Array(m), new Int32Array(m)])
    entBox.push([new Float32Array(m * 6), new Float32Array(m * 6)])
    entN.push(new Int32Array(2))
  }
  /**
   * 實例幾何的範圍，盒子由它推：水平半徑兩軸各一（實例繞 Y 轉，x 吃面寬倍率、
   * z 吃縮放）、垂直的上下緣（吃樓高倍率）。點池不用，點的範圍是邊長
   */
  const geoRx = new Float64Array(poolCount)
  const geoRz = new Float64Array(poolCount)
  const geoLo = new Float64Array(poolCount)
  const geoHi = new Float64Array(poolCount)
  for (let p = 0; p < poolCount; p++) {
    const name = POOL_NAMES[p]!
    if (IS_POINT[name]) continue
    const g = geometries[name as MeshPool]
    if (g.boundingBox === null) g.computeBoundingBox()
    const b = g.boundingBox!
    geoRx[p] = Math.max(Math.abs(b.min.x), Math.abs(b.max.x))
    geoRz[p] = Math.max(Math.abs(b.min.z), Math.abs(b.max.z))
    geoLo[p] = b.min.y
    geoHi[p] = b.max.y
  }

  const counts: Record<PoolName, number> =
    Object.fromEntries(POOL_NAMES.map((n) => [n, 0])) as Record<PoolName, number>

  // ── 逐段畫 ──────────────────────────────────────────
  /** `visibleRuns` 的輸出。一池一池輪流用，長度取區段表最長的那一張 */
  let maxEnt = 1
  for (let p = 0; p < poolCount; p++) maxEnt = Math.max(maxEnt, entStart[p]![0]!.length)
  const runStart = new Int32Array(maxEnt)
  const runEnd = new Int32Array(maxEnt)
  const planes = new Float64Array(24)

  /** 第 p 池畫 `runStart/runEnd` 的前 `n` 段；其餘的段藏起來 */
  function setRuns(p: number, n: number): void {
    const name = POOL_NAMES[p]!
    const sd = side[name]!
    if (IS_POINT[name]) {
      const runs = pointRuns[name]!
      for (let r = 0; r < RUN_CAP; r++) {
        const pts = runs[r]!
        if (r < n) {
          pts.visible = true
          pts.geometry.setDrawRange(runStart[r]!, runEnd[r]! - runStart[r]!)
        } else {
          // 【第 0 段只清空不藏】它是其餘段的父物件，藏了連孩子一起不畫
          if (r > 0) pts.visible = false
          pts.geometry.setDrawRange(0, 0)
        }
      }
      return
    }
    const runs = meshRuns[name]!
    const mat = altMat[name]![sd]!
    const col = altCol[name]![sd]!
    for (let r = 0; r < RUN_CAP; r++) {
      const run = runs[r]!
      if (r < n) {
        run.mesh.visible = true
        aimRun(run, mat, col, runStart[r]!)
        run.mesh.count = runEnd[r]! - runStart[r]!
      } else {
        if (r > 0) run.mesh.visible = false
        run.mesh.count = 0
      }
    }
  }

  /** 整條畫成一段 —— 剛換上、`CULL` 關掉、沒有相機時 */
  function showAll(p: number): void {
    const used = counts[POOL_NAMES[p]!]
    runStart[0] = 0
    runEnd[0] = used
    setRuns(p, used > 0 ? 1 : 0)
  }

  function cull(camera: Camera): void {
    if (!CULL.enabled) {
      for (let p = 0; p < poolCount; p++) showAll(p)
      return
    }
    frustumPlanesOf(camera, planes)
    for (let p = 0; p < poolCount; p++) {
      const used = counts[POOL_NAMES[p]!]
      const sd = side[POOL_NAMES[p]!]!
      const limit = used >= RUN_SPLIT_MIN ? RUN_CAP : 1
      const n = used === 0 ? 0 : visibleRuns(
        entN[p]![sd]!, entStart[p]![sd]!, entEnd[p]![sd]!, entBox[p]![sd]!,
        planes, limit, runStart, runEnd)
      setRuns(p, n)
    }
  }

  function setPointLight(scale: number): void { pointMaterial.color.setScalar(scale) }

  function dispose(): void {
    disposeFloraGeometries(geometries)
    material.dispose()
    pointMaterial.dispose()
    for (const name of POOL_NAMES) {
      for (const run of meshRuns[name] ?? []) {
        run.mesh.dispose()
        if (run.mesh.geometry !== geometries[name as MeshPool]) run.mesh.geometry.dispose()
      }
      for (const pts of pointRuns[name] ?? []) pts.geometry.dispose()
    }
  }

  return {
    group, altPt, pointBase, altMat, altCol, side, pointRuns,
    poolCount, entStart, entEnd, entBox, entN, geoRx, geoRz,
    geoLo, geoHi, counts, showAll, cull, setPointLight, dispose,
  }
}
