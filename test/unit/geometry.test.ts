import { describe, it, expect } from 'vitest'
import { BufferGeometry, DoubleSide, Mesh, Vector3, type MeshStandardMaterial } from 'three'
import { buildFuselage, type FuselageSection } from '../../src/render/geometry/fuselage'
import { buildCanopy } from '../../src/render/geometry/canopy'
import { buildHull, prepareRings, type HullRing } from '../../src/render/geometry/hull'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'

/**
 * 【這一檔只測「產生器」，不測任何機種的造型】
 *
 * 專案負責人兩次裁決：模型不該寫測試——造型定案後不會再改，而且全部是
 * 視覺判讀。證據也支持：
 *
 *   一、對手寫的造型數字再斷言一次，本質上是同義反覆。
 *   二、「背線形狀」那條改過兩次，**兩次都是測試錯了、幾何是對的**：
 *       第一次容差訂 3 mm，真機實測偏離 22 mm；第二次寫死線稿的絕對高度，
 *       被改採 E-4 參考模型的裁決推翻。它沒擋下任何缺陷，只擋了自己人。
 *   三、實際發生過的外形缺陷（機翼沒畫完、垂尾顛倒、機腹浮空、機翼位置
 *       太後、機身太瘦、座艙罩形狀）**全部是人眼先發現的**。
 *
 * 所以留下來的只有兩類，兩類都與「好不好看」無關：
 *
 *   產生器的機制  —— 給定參數，幾何是否照定義產生（後掠方向、翼尖收縮、
 *                    超橢圓、法線朝外、玻璃輪廓的上下界）。這是程式碼的
 *                    行為，改壞了不是美感問題而是錯誤。
 *   跨模組一致性  —— 包圍盒翼展要等於 spec.wing.span（飛行模型與視覺模型
 *                    共用同一個數字）、機翼四分之一弦線要落在原點（原點是
 *                    物理模型的重心）。這兩條是別的模組的約束漏到這裡。
 */

const RING: FuselageSection[] = [
  { z: 0, halfWidth: 1, halfHeight: 1, centerY: 0 },
  { z: 1, halfWidth: 1, halfHeight: 1, centerY: 0 },
]

/** 封閉網格的帶符號體積 Σ(v0×v1)·v2/6：逆時針纏繞且法線朝外時為正。 */
function signedVolume(geo: BufferGeometry): number {
  const p = geo.getAttribute('position')
  const idx = geo.index
  const n = idx ? idx.count : p.count
  const at = (i: number) => (idx ? idx.getX(i) : i)
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), t = new Vector3()
  let v = 0
  for (let i = 0; i < n; i += 3) {
    const i0 = at(i), i1 = at(i + 1), i2 = at(i + 2)
    a.set(p.getX(i0), p.getY(i0), p.getZ(i0))
    b.set(p.getX(i1), p.getY(i1), p.getZ(i1))
    c.set(p.getX(i2), p.getY(i2), p.getZ(i2))
    v += a.dot(t.crossVectors(b, c))
  }
  return v / 6
}

describe('buildFuselage', () => {
  it('產生非空、座標有限、含法線的幾何', () => {
    const g = buildFuselage(RING, 8)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i]!)).toBe(true)
    expect(g.getAttribute('normal')).toBeDefined()
  })

  it('法線朝外（帶符號體積為正）', () => {
    // 缺陷版本：機身與所有手寫翼面內外翻轉，正面被背面剔除，
    // 看起來像「沒畫完」。16 個網格中有 6 個中招。
    expect(signedVolume(buildFuselage(RING, 8))).toBeGreaterThan(0)
  })

  it('超橢圓指數提高會讓剖面變方，且不撐大外框', () => {
    // 圓（n=2）上任一點離軸心都是 1；越方，斜角方向的取樣點離軸心越遠。
    // 用 8 分段是因為它剛好取樣到 45°——差異最大的那個角度。12 分段最近的
    // 取樣點在 30°，量到的是 1.141 而不是真正的角點 1.160。
    const cornerRadius = (roundness: number): number => {
      const p = buildFuselage(RING, 8, roundness).getAttribute('position')
      let r = 0
      for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getY(i)))
      return r
    }
    expect(cornerRadius(2)).toBeCloseTo(1, 3)
    expect(cornerRadius(3.5)).toBeGreaterThan(1.15)

    // 但外框（±halfWidth / ±halfHeight）不能被撐大，否則翼展／全長會失真
    const p = buildFuselage(RING, 8, 3.5).getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('buildWingPanel', () => {
  const params = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 20 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }
  const extremes = (geo: BufferGeometry) => {
    const p = geo.getAttribute('position')
    let minX = Infinity, maxX = -Infinity
    for (let i = 0; i < p.count; i++) {
      minX = Math.min(minX, p.getX(i)); maxX = Math.max(maxX, p.getX(i))
    }
    return { minX, maxX }
  }

  it('右翼延伸至 +X、左翼延伸至 −X，皆到全半翼展', () => {
    expect(extremes(buildWingPanel(params, false)).maxX).toBeCloseTo(params.halfSpan, 3)
    expect(extremes(buildWingPanel(params, true)).minX).toBeCloseTo(-params.halfSpan, 3)
  })

  it('左右翼皆法線朝外', () => {
    // 缺陷版本兩者都是 −3.36
    for (const mirrored of [false, true]) {
      expect(signedVolume(buildWingPanel(params, mirrored))).toBeGreaterThan(0)
    }
  })

  it('後掠使翼尖前緣往機尾（+Z）移動，不是往機首', () => {
    const p = buildWingPanel(params, false).getAttribute('position')
    let tipLeadZ = Infinity
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) > params.halfSpan * 0.9) tipLeadZ = Math.min(tipLeadZ, p.getZ(i))
    }
    // 缺陷版本是 −3.54（跑到機首方向）
    expect(tipLeadZ).toBeGreaterThan(params.rootZ)
    expect(tipLeadZ).toBeCloseTo(params.rootZ + Math.tan(params.sweep) * params.halfSpan, 3)
  })

  it('上反角使翼尖高於翼根', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let tipY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > params.halfSpan - 0.01) tipY = Math.max(tipY, pos.getY(i))
    }
    expect(tipY).toBeGreaterThan(params.rootY)
  })

  /** 圓翼尖：翼尖弦長要比線性梯形值小，且前緣後退、後緣前移。 */
  it('tipRound 只收弦長，不收翼展', () => {
    const measure = (geo: BufferGeometry) => {
      const p = geo.getAttribute('position')
      let lead = Infinity, trail = -Infinity
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) < params.halfSpan - 0.01) continue
        lead = Math.min(lead, p.getZ(i))
        trail = Math.max(trail, p.getZ(i))
      }
      return { lead, trail, chord: trail - lead }
    }
    const square = measure(buildWingPanel(params, false))
    const round = measure(buildWingPanel({ ...params, tipRound: 0.3 }, false))

    expect(square.chord).toBeCloseTo(params.tipChord, 3)
    expect(round.chord).toBeCloseTo(params.tipChord * 0.3, 3)
    expect(round.lead).toBeGreaterThan(square.lead)     // 前緣後退
    expect(round.trail).toBeLessThan(square.trail)      // 後緣前移
    expect(extremes(buildWingPanel({ ...params, tipRound: 0.3 }, false)).maxX)
      .toBeCloseTo(params.halfSpan, 3)
  })

  /**
   * 厚度沿翼展線性收到 tipThickness，且**不隨圓翼尖的急收弦長走**——
   * 跟著走的話翼尖最外那一小段會薄成刀口。
   */
  it('tipThickness 決定翼尖厚度，且圓翼尖不會把它再收一次', () => {
    const tipT = (geo: BufferGeometry) => {
      const p = geo.getAttribute('position')
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) < params.halfSpan - 0.01) continue
        lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i))
      }
      return hi - lo
    }
    expect(tipT(buildWingPanel({ ...params, tipThickness: 0.11 }, false))).toBeCloseTo(0.11, 6)
    expect(tipT(buildWingPanel({ ...params, tipThickness: 0.11, tipRound: 0.3 }, false)))
      .toBeCloseTo(0.11, 6)
    // 省略時退回舊行為：按弦長等比例收
    expect(tipT(buildWingPanel(params, false)))
      .toBeCloseTo((params.thickness * params.tipChord) / params.rootChord, 6)
  })
})

describe('buildHull / buildCanopy', () => {
  /** 兩圈同形的方管，半剖面由正上方到正下方。 */
  const RINGS: HullRing[] = [-1, 1].map((z) => ({
    z,
    half: [[0, 0.6], [0.3, 0.55], [0.4, 0.2], [0.4, -0.2], [0.3, -0.55], [0, -0.6]] as const,
  }))
  const STATIONS = [
    { z: -0.5, sill: 0.3, roof: 0.9 },
    { z: 0.5, sill: 0.3, roof: 0.9 },
  ]
  const ys = (g: { getAttribute(n: string): { count: number; getY(i: number): number } }) => {
    const p = g.getAttribute('position')
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)) }
    return { lo, hi }
  }

  it('沒有開口時是封閉管，法線朝外', () => {
    expect(signedVolume(buildHull(RINGS).geometry)).toBeGreaterThan(0)
  })

  /**
   * 【這是「座艙挖空」的核心行為】開口段的艙緣以上不能有面。挖不掉的話，
   * 透過半透明玻璃看到的還是機身蒙皮——那正是改成烘焙頂點之前的樣子。
   */
  it('開口段把艙緣以上挖掉，且邊緣是一條水平線', () => {
    const rings = prepareRings(RINGS, STATIONS.map((s) => s.z))
    const cut = { sill: STATIONS.map((s) => [s.z, s.sill] as const) }
    const solid = buildHull(rings).geometry
    const holed = buildHull(rings, cut).geometry
    expect(holed.getAttribute('position').count)
      .toBeLessThan(solid.getAttribute('position').count)

    // 開口 z 範圍內不得有任何高於艙緣的頂點
    const p = holed.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) < -0.5 - 1e-9 || p.getZ(i) > 0.5 + 1e-9) continue
      expect(p.getY(i)).toBeLessThanOrEqual(0.3 + 1e-6)
    }
  })

  it('玻璃下緣正好落在開口邊緣上（機體與玻璃要銜接）', () => {
    const rings = prepareRings(RINGS, STATIONS.map((s) => s.z))
    const cut = { sill: STATIONS.map((s) => [s.z, s.sill] as const) }
    const rim = buildHull(rings, cut).rim
    const g = buildCanopy(rings, STATIONS, { topWidth: 0.15 })
    const b = ys(g)
    expect(b.lo).toBeCloseTo(0.3, 6)      // 下緣＝艙緣
    expect(b.hi).toBeCloseTo(0.9, 6)      // 上緣＝罩頂

    // 玻璃在艙緣的半寬必須等於開口邊緣的半寬，否則兩者之間會有縫
    const p = g.getAttribute('position')
    let widest = 0
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getY(i) - 0.3) < 1e-6) widest = Math.max(widest, Math.abs(p.getX(i)))
    }
    expect(widest).toBeCloseTo(rim[0]!.x, 6)
  })

  it('艙緣高過罩頂時玻璃收成一點（尾端斜切靠這個收掉）', () => {
    const g = buildCanopy(RINGS, [
      { z: -0.5, sill: 0.3, roof: 0.9 }, { z: 0.5, sill: 1.0, roof: 0.9 },
    ], { topWidth: 0.15 })
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i) - 0.5) < 1e-9) {
        expect(p.getX(i)).toBeCloseTo(0, 6)
        expect(p.getY(i)).toBeCloseTo(0.9, 6)
      }
    }
  })
})

describe('buildAircraft', () => {
  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      it('每一個網格都是法線朝外', () => {
        const m = buildAircraft(spec)
        const inverted: string[] = []
        m.group.traverse((o) => {
          const g = (o as Mesh).geometry
          if (!g?.getAttribute?.('position')) return
          // 座艙內裝刻意朝內（從開口往下看要看得到內側），略過。
          if (o.userData['inwardShell']) return
          // 玻璃是開放的殼，帶符號體積不是嚴格的纏繞判準；但殼翻過來就會被
          // 背面剔除、整片看不見，這條仍然抓得到那種情況。
          if (signedVolume(g) < 0) inverted.push(o.name || o.type)
        })
        expect(inverted).toEqual([])
        m.dispose()
      })

      /**
       * 【計畫原稿的斷言是 expect(Number.isFinite(1)).toBe(true)】
       * 那驗證的是「1 是有限數」——與螺旋槳毫無關係，而且**不可能失敗**：
       * 把 setPropSpin 的實作整個刪成空函式，該版本照樣通過。改為實際檢查：
       * 旋轉角有寫進去、模糊圓盤與槳葉的可見性互斥。
       */
      it('setPropSpin 寫入旋轉角，且槳葉與模糊圓盤互斥可見', () => {
        const m = buildAircraft(spec)
        const visible = (): string[] => {
          const out: string[] = []
          m.group.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh && o.visible) out.push(o.uuid)
          })
          return out
        }
        m.setPropSpin(1.2, true)
        const blurred = visible()
        m.setPropSpin(2.5, false)
        const bladed = visible()

        expect(blurred).not.toEqual(bladed)
        expect(blurred.filter((n) => !bladed.includes(n)).length).toBeGreaterThan(0)
        expect(bladed.filter((n) => !blurred.includes(n)).length).toBeGreaterThan(0)

        let sawRotation = false
        m.group.traverse((o) => {
          if (Math.abs(o.rotation.z - 2.5) < 1e-9) sawRotation = true
        })
        expect(sawRotation).toBe(true)
        m.dispose()
      })

      it('整流罩在最前方，metrics.noseZ 與實際幾何一致', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        let minZ = Infinity
        const v = new Vector3()
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            minZ = Math.min(minZ, v.set(p.getX(i), p.getY(i), p.getZ(i))
              .applyMatrix4(o.matrixWorld).z)
          }
        })
        expect(m.metrics.noseZ).toBeCloseTo(minZ, 6)
        m.dispose()
      })

      /**
       * 翼展直接對 spec —— 飛行模型與視覺模型用的是同一個數字，
       * 兩邊各改各的會在這裡被抓到。全長容許 5%：整流罩尖端與尾錐是
       * 造型取捨，不是硬性尺寸。
       */
      it('包圍盒的翼展與全長吻合真機', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        const v = new Vector3()
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x)
            minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z)
          }
        })
        expect(maxX - minX).toBeCloseTo(spec.wing.span, 2)
        expect(maxZ - minZ).toBeGreaterThan(m.metrics.realLength * 0.95)
        expect(maxZ - minZ).toBeLessThan(m.metrics.realLength * 1.05)
        m.dispose()
      })

      /**
       * 原點是物理模型的**重心**（`state.position` 就是重心），所以模型的
       * 機翼四分之一弦線必須壓在原點上。實測位移前 P-51D 差 0.81 m、
       * Bf 109 差 2.08 m——那等於把重心放在氣動中心後方兩公尺，物理上說
       * 不通，視覺上追尾相機也會對準錯的點。
       *
       * 量的是**建好的幾何**而不是造型資料：主翼是那片跨越 ±80% 半翼展的
       * 網格，取它在 x≈0 的翼根弦長。
       */
      it('機翼四分之一弦線落在原點（＝重心）', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        const half = spec.wing.span / 2
        const v = new Vector3()
        let lead = Infinity, trail = -Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          let x0 = Infinity, x1 = -Infinity
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x)
          }
          if (x1 - x0 < half * 0.8) return          // 不是主翼板
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            if (Math.abs(v.x) > 0.02) continue      // 只取翼根站位
            lead = Math.min(lead, v.z); trail = Math.max(trail, v.z)
          }
        })
        expect(lead + 0.25 * (trail - lead)).toBeCloseTo(0, 6)
        m.dispose()
      })
    })
  }
})

describe('透明材質不寫深度（M10 驗收）', () => {
  /**
   * 【為什麼這不算「造型測試」】它守的不是任何一個數字長什麼樣，而是一條
   * 渲染規則：半透明的東西**不可以寫深度緩衝**，否則它會把後面的東西整條
   * 丟掉而不是混合出來。M10 驗收時螺旋槳的模糊圓盤正是這樣把曳光彈吃掉的
   * —— 一個 22% 不透明度的圓盤讓子彈完全消失。
   *
   * 專案裡其他每一個透明材質（曳光彈、槍焰、火球、煙、噴濺、火花、水柱）
   * 都已經關掉 `depthWrite`；`assembly.ts` 那兩個是 M1 寫的，比這條慣例更早，
   * 於是一路漏到 M10 才被人眼抓到。
   */
  for (const spec of [P51D, BF109G6]) {
    it(`${spec.id}：機體上每一個 transparent 材質都關掉 depthWrite`, () => {
      const m = buildAircraft(spec)
      const offenders: string[] = []
      m.group.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          if (mat.transparent && mat.depthWrite) offenders.push(mesh.geometry.type)
        }
      })
      expect(offenders).toEqual([])
      m.dispose()
    })
  }

  it('模糊圓盤排在其他透明物件之後才畫', () => {
    // 【為什麼只關 depthWrite 還不夠】關掉之後遮擋不再是「丟掉」而是「混合」，
    // 但混合的先後仍然由**逐物件**排序決定 —— 而曳光彈整批是一個
    // InstancedMesh，它的排序深度取的是世界原點，與子彈實際飛在哪裡無關。
    // renderOrder 把常見情形（子彈在圓盤後方）釘成正確的那一邊。
    const m = buildAircraft(P51D)
    const discs: Mesh[] = []
    m.group.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh && mesh.geometry.type === 'CircleGeometry') discs.push(mesh)
    })
    expect(discs).toHaveLength(1)
    expect(discs[0]!.renderOrder).toBeGreaterThan(0)
    m.dispose()
  })

  /**
   * 【為什麼這條不是造型測試】它測的是材質的一個旗標，改壞了的症狀是
   * 「螺旋槳整個不見」而不是「不好看」—— 屬於檔頭裁決留下的「產生器的
   * 機制」那一類。
   *
   * 【它守的是什麼】圓盤是 `CircleGeometry`，法線指 +Z，而機首朝 −Z。
   * 材質若是 `FrontSide`（`MeshStandardMaterial` 的預設），圓盤**只有從
   * 飛機後方畫得出來**；而油門 > 0.15 時 `setPropSpin` 會把三／四片槳葉
   * 全部隱藏（`assembly.ts:319`）。兩件事合起來的結果是：**從飛機前方或
   * 斜前方看，螺旋槳整個不存在。**
   *
   * 座艙相機永遠在圓盤後方，所以這個缺陷從 M1 活到上帝視角才被看見 ——
   * 那是第一個會從機頭方向看自己飛機的視角。
   */
  for (const [name, spec] of [['P-51D', P51D], ['Bf 109 G-6', BF109G6]] as const) {
    it(`${name}：模糊圓盤兩面都畫得出來`, () => {
      const m = buildAircraft(spec)
      const discs: Mesh[] = []
      m.group.traverse((o) => {
        const mesh = o as Mesh
        if (mesh.isMesh && mesh.geometry.type === 'CircleGeometry') discs.push(mesh)
      })
      expect(discs).toHaveLength(1)
      expect((discs[0]!.material as MeshStandardMaterial).side).toBe(DoubleSide)
      m.dispose()
    })
  }
})
