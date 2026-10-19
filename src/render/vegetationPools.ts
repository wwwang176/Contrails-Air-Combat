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
import { FLORA_ROUGHNESS, VIEW_SHADE_GLSL, ViewShadeRow, type ViewShade } from './viewShade'

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
 * 【點吃不到光照】`PointsMaterial` 是 basic 的。逐株的顏色是樹冠色 × 明度，再乘
 * 那一類樹的表（`viewShade.ts`）：表是照此刻的燈算的中級樹冠輻射，由鏡頭到這一點的
 * 方向查。一個樹種一個材質 —— 查的是表的哪一列（`uViewRow`），三個材質共用同一支程式
 */
function createPointMaterial(
  row: ViewShadeRow, shade: ViewShade, fade: FadeGroup = FadeGroup.None, uFade = NO_FADE,
): PointsMaterial {
  const m = new PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: 1 })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shade.uniforms, { uViewRow: { value: row }, uFade })
    shader.vertexShader = 'attribute float aSize;\nuniform float uViewRow;\n' + VIEW_SHADE_GLSL + shader.vertexShader
      .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[1][1] * size;')
      .replace('#include <color_vertex>', `#include <color_vertex>
{
  vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  vColor.rgb *= viewShade(uViewRow, toCam);
}`)
    if (fade !== FadeGroup.None) shader.fragmentShader = withFade(shader.fragmentShader, fade)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用。列是 uniform，三個樹種同一個 key
  m.customProgramCacheKey = () => `flora-point-view${FADE_KEY[fade]}`
  return m
}

/** 一池的區段表分三組：一般、淡入、淡出（見 `vegetationRebuild.ts`） */
export const enum FadeGroup {
  None = 0,
  In = 1,
  Out = 2,
}
const FADE_KEY = ['', ':fade-in', ':fade-out'] as const
/** 一池的段分幾組（一般、淡入、淡出） */
const GROUPS = 3

/** 不淡的材質用的 uFade（不讀，只為了型別） */
const NO_FADE = { value: 1 }

/**
 * 換級時的抖動交疊：螢幕上每個像素一個 4×4 Bayer 門檻 `d`（0..1），淡入的材質 `d ≥ uFade`
 * 就丟掉、淡出的材質 `d < uFade` 就丟掉。同一個像素同一個門檻，兩種互補：任何時候每個
 * 像素只看到其中一級，不疊成半透明
 */
export const FADE_GLSL = `
uniform float uFade;
float floraFadeThreshold(vec2 p) {
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  return (B[i] + 0.5) / 16.0;
}
`

/** 片段著色器加上淡入或淡出的丟棄（`FADE_GLSL`） */
function withFade(frag: string, fade: FadeGroup): string {
  const test = fade === FadeGroup.In ? '>=' : '<'
  return FADE_GLSL + frag.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (floraFadeThreshold(gl_FragCoord.xy) ${test} uFade) discard;`)
}

/** 網格池的材質；`fade` 是淡入或淡出時加上抖動丟棄 */
function createMeshMaterial(fade: FadeGroup, uFade: { value: number }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: FLORA_ROUGHNESS })
  if (fade !== FadeGroup.None) {
    m.onBeforeCompile = (shader) => {
      shader.uniforms['uFade'] = uFade
      shader.fragmentShader = withFade(shader.fragmentShader, fade)
    }
    m.customProgramCacheKey = () => `flora-mesh${FADE_KEY[fade]}`
  }
  return m
}

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

/** 點池查視角係數表的哪一列 */
const POINT_ROW: Record<PointPool, ViewShadeRow> = {
  broadPoint: ViewShadeRow.Broad,
  conePoint: ViewShadeRow.Cone,
  bushPoint: ViewShadeRow.Bush,
}

export function createVegetationPools(
  cap: Record<PoolName, number>, season: Season, tileCache: number, shade: ViewShade,
) {
  const geometries = createFloraGeometries(season)
  /** 換級淡化的進度 0..1，淡入、淡出的材質共用 */
  const uFade = { value: 1 }
  /** 網格池的材質：一般、淡入、淡出（以 `FadeGroup` 索引） */
  const meshMaterials = [
    createMeshMaterial(FadeGroup.None, uFade),
    createMeshMaterial(FadeGroup.In, uFade),
    createMeshMaterial(FadeGroup.Out, uFade),
  ]
  /** 點池的材質，每個樹種一組：一般、淡入、淡出 */
  const pointMaterialSets = Object.fromEntries((['broadPoint', 'conePoint', 'bushPoint'] as const).map((n) => [n, [
    createPointMaterial(POINT_ROW[n], shade),
    createPointMaterial(POINT_ROW[n], shade, FadeGroup.In, uFade),
    createPointMaterial(POINT_ROW[n], shade, FadeGroup.Out, uFade),
  ]])) as Record<PointPool, PointsMaterial[]>
  const pointList = Object.values(pointMaterialSets).flat()
  /** 正在淡化：淡入組用淡入的材質、淡出組有畫 */
  let fading = false
  const group = new Group()
  /**
   * 十一個池。**遠處那三個是 `Points`，其餘八個是 `InstancedMesh`。**
   * 寫入路徑因此要分岔 —— 見 `rebuild`。
   *
   * 池物件本身是一般組的第 0 段；其餘的段（一般組第 1 段以後、淡入組、淡出組，各
   * `RUN_CAP` 段，第 g 組第 r 段是 `g·RUN_CAP + r`）掛在它底下（`object.children` 因此
   * 仍是一池一個）
   */
  const pools: Record<PoolName, InstancedMesh | Points> =
    {} as Record<PoolName, InstancedMesh | Points>
  /** 點池的三條屬性，各兩份輪流換。索引順序：位置、顏色、大小 */
  const altPt: Partial<Record<PoolName, BufferAttribute[][]>> = {}
  /** 點池的樹冠色（線性），開場算一次 */
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
      for (let r = 0; r < RUN_CAP * GROUPS; r++) {
        const geo = new BufferGeometry()
        geo.setAttribute('position', two[0]![0]!)
        geo.setAttribute('color', two[0]![1]!)
        geo.setAttribute('aSize', two[0]![2]!)
        geo.setDrawRange(0, 0)
        // 【包圍球自己給無限大】內容每次重建都換，three 算出來的球會過期；
        // 而 three 的剔除本來就關掉了 —— 見檔頭
        geo.boundingSphere = new Sphere(new Vector3(), Infinity)
        const pts = new Points(geo, pointMaterialSets[name as PointPool][r < RUN_CAP * 2 ? 0 : 2]!)
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
      pointBase[name] = new Color(pointColorOf(name as PointPool, season))
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
    for (let r = 0; r < RUN_CAP * GROUPS; r++) {
      runs.push(createMeshRun(r === 0 ? base : shareGeometry(base),
        meshMaterials[r < RUN_CAP * 2 ? 0 : 2]!, mats[0]!, cols[0]!))
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
  /**
   * 各池各份淡入組、淡出組的第一筆（見 `vegetationRebuild.ts`）：一般組是 `[0, 淡入)`、
   * 淡入組 `[淡入, 淡出)`、淡出組 `[淡出, 筆數)`
   */
  const entFadeIn: Int32Array[] = []
  const entFadeOut: Int32Array[] = []
  for (let p = 0; p < poolCount; p++) {
    // 【一格最多三筆】一般組、淡入組、淡出組各一筆
    const m = Math.min(tileCache * GROUPS, cap[POOL_NAMES[p]!])
    entStart.push([new Int32Array(m), new Int32Array(m)])
    entEnd.push([new Int32Array(m), new Int32Array(m)])
    entBox.push([new Float32Array(m * 6), new Float32Array(m * 6)])
    entN.push(new Int32Array(2))
    entFadeIn.push(new Int32Array(2))
    entFadeOut.push(new Int32Array(2))
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

  /** 第 p 池第 `g` 組畫 `runStart/runEnd` 的前 `n` 段；那一組其餘的段藏起來 */
  function setRuns(p: number, g: FadeGroup, n: number): void {
    const name = POOL_NAMES[p]!
    const sd = side[name]!
    const o = g * RUN_CAP
    if (IS_POINT[name]) {
      const runs = pointRuns[name]!
      for (let r = 0; r < RUN_CAP; r++) {
        const pts = runs[o + r]!
        if (r < n) {
          pts.visible = true
          pts.geometry.setDrawRange(runStart[r]!, runEnd[r]! - runStart[r]!)
        } else {
          // 【池物件只清空不藏】它是其餘段的父物件，藏了連孩子一起不畫
          if (o + r > 0) pts.visible = false
          pts.geometry.setDrawRange(0, 0)
        }
      }
      return
    }
    const runs = meshRuns[name]!
    const mat = altMat[name]![sd]!
    const col = altCol[name]![sd]!
    for (let r = 0; r < RUN_CAP; r++) {
      const run = runs[o + r]!
      if (r < n) {
        run.mesh.visible = true
        aimRun(run, mat, col, runStart[r]!)
        run.mesh.count = runEnd[r]! - runStart[r]!
      } else {
        if (o + r > 0) run.mesh.visible = false
        run.mesh.count = 0
      }
    }
  }

  /** 第 p 池掛著那一份裡，第 e 筆開始的實例位置；`e` 到底就是實例總數 */
  function instanceAt(p: number, sd: number, e: number): number {
    return e < entN[p]![sd]! ? entStart[p]![sd]![e]! : counts[POOL_NAMES[p]!]
  }

  /**
   * 整條畫：三組各畫成一段 —— 剛換上、`CULL` 關掉、沒有相機時。淡出組只在淡化時畫
   */
  function showAll(p: number): void {
    const sd = side[POOL_NAMES[p]!]!
    const a = instanceAt(p, sd, entFadeIn[p]![sd]!)
    const b = instanceAt(p, sd, entFadeOut[p]![sd]!)
    const used = counts[POOL_NAMES[p]!]
    runStart[0] = 0
    runEnd[0] = a
    setRuns(p, FadeGroup.None, a > 0 ? 1 : 0)
    runStart[0] = a
    runEnd[0] = b
    setRuns(p, FadeGroup.In, b > a ? 1 : 0)
    runStart[0] = b
    runEnd[0] = used
    setRuns(p, FadeGroup.Out, fading && used > b ? 1 : 0)
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
      const e1 = entFadeIn[p]![sd]!
      const e2 = entFadeOut[p]![sd]!
      const e3 = entN[p]![sd]!
      const starts = entStart[p]![sd]!
      const ends = entEnd[p]![sd]!
      const boxes = entBox[p]![sd]!
      // 三組各自接段：組與組之間的實例不相連，接在一起的話中間那一組會用錯材質
      setRuns(p, FadeGroup.None, used === 0 ? 0
        : visibleRuns(e1, starts, ends, boxes, planes, limit, runStart, runEnd, 0))
      setRuns(p, FadeGroup.In, e2 === e1 ? 0
        : visibleRuns(e2, starts, ends, boxes, planes, limit, runStart, runEnd, e1))
      setRuns(p, FadeGroup.Out, !fading || e3 === e2 ? 0
        : visibleRuns(e3, starts, ends, boxes, planes, limit, runStart, runEnd, e2))
    }
  }

  /**
   * 換級淡化的進度。`t` 0..1：淡入組用淡入的材質、淡出組有畫；`null`：沒在淡，淡入組用
   * 一般材質、淡出組不畫。下一次 `cull`（或 `showAll`）才生效
   */
  function setFade(t: number | null): void {
    uFade.value = t ?? 1
    if (fading === (t !== null)) return
    fading = t !== null
    for (const name of POOL_NAMES) {
      if (IS_POINT[name]) {
        const set = pointMaterialSets[name as PointPool]
        const runs = pointRuns[name]!
        for (let r = RUN_CAP; r < RUN_CAP * 2; r++) runs[r]!.material = set[fading ? 1 : 0]!
        continue
      }
      const runs = meshRuns[name]!
      for (let r = RUN_CAP; r < RUN_CAP * 2; r++) runs[r]!.mesh.material = meshMaterials[fading ? 1 : 0]!
    }
  }

  function setPointLight(scale: number, tint = 0xffffff): void {
    // 色盤以 sRGB 指定，先轉成線性光照色；切回未染色時段也要清除舊色。
    for (const m of pointList) m.color.setHex(tint).multiplyScalar(scale)
  }

  function dispose(): void {
    disposeFloraGeometries(geometries)
    for (const m of meshMaterials) m.dispose()
    for (const m of pointList) m.dispose()
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
    poolCount, entStart, entEnd, entBox, entN, entFadeIn, entFadeOut, geoRx, geoRz,
    geoLo, geoHi, counts, showAll, cull, setFade, setPointLight, dispose,
  }
}
