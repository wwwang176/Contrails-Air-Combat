import { describe, it, expect } from 'vitest'
import { Box3, BufferGeometry, Mesh, Vector3 } from 'three'
import { buildFuselage, type FuselageSection } from '../../src/render/geometry/fuselage'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { SILHOUETTES, hullOffsetZ } from '../../src/render/geometry/silhouettes'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'

describe('buildFuselage', () => {
  it('產生非空且座標有限的幾何', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage.sections, 8)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) {
      expect(Number.isFinite(pos.array[i]!)).toBe(true)
    }
  })

  it('包含法線', () => {
    expect(buildFuselage(SILHOUETTES.p51d!.fuselage.sections, 8).getAttribute('normal')).toBeDefined()
  })

  it('三角形數落在低多邊形預算內', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage.sections, 8)
    expect(g.getAttribute('position').count / 3).toBeLessThan(200)
  })
})

describe('buildWingPanel', () => {
  const params = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }

  it('右翼延伸至 +X', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(params.halfSpan, 3)
  })

  it('左翼延伸至 −X', () => {
    const pos = buildWingPanel(params, true).getAttribute('position')
    let minX = Infinity
    for (let i = 0; i < pos.count; i++) minX = Math.min(minX, pos.getX(i))
    expect(minX).toBeCloseTo(-params.halfSpan, 3)
  })

  /**
   * 圓翼尖：翼尖弦長要比線性梯形值小，且前緣後退、後緣前移（對中弦線收縮）。
   * 方翼尖版本三項全部相等，所以這條測得出差別。
   */
  it('tipRound 使翼尖弦長收縮並對中弦線內縮', () => {
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
    // 仍然長到全翼展——收的是弦長不是翼展
    let maxX = -Infinity
    const p = buildWingPanel({ ...params, tipRound: 0.3 }, false).getAttribute('position')
    for (let i = 0; i < p.count; i++) maxX = Math.max(maxX, p.getX(i))
    expect(maxX).toBeCloseTo(params.halfSpan, 3)
  })

  it('上反角使翼尖高於翼根', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let tipY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > params.halfSpan - 0.01) tipY = Math.max(tipY, pos.getY(i))
    }
    expect(tipY).toBeGreaterThan(params.rootY)
  })
})

describe('buildAircraft', () => {
  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      it('產生含子物件的 Group', () => {
        const m = buildAircraft(spec)
        // 外層 group 只掛一個承擔重心位移的內層 group，所以要數整棵樹
        let meshes = 0
        m.group.traverse((o) => { if ((o as Mesh).isMesh) meshes++ })
        expect(meshes).toBeGreaterThan(5)
        m.dispose()
      })

      /**
       * 【計畫原稿的斷言是 expect(Number.isFinite(1)).toBe(true)】
       * 那驗證的是「1 是有限數」——與螺旋槳毫無關係，而且**不可能失敗**：
       * 把 setPropSpin 的實作整個刪成空函式，該版本照樣通過。
       * 一條不會失敗的測試比沒有測試更糟，因為它會讓人誤以為這裡有防護。
       * 改為實際檢查三件事：旋轉角有寫進去、模糊圓盤與槳葉的可見性互斥、
       * 且兩種狀態下恰有一組可見。
       */
      it('setPropSpin 寫入旋轉角，且槳葉與模糊圓盤互斥可見', () => {
        const m = buildAircraft(spec)
        const visibleNames = (): string[] => {
          const out: string[] = []
          m.group.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh && o.visible) out.push(o.name || o.uuid)
          })
          return out
        }

        m.setPropSpin(1.2, true)
        const blurred = visibleNames()
        m.setPropSpin(2.5, false)
        const bladed = visibleNames()

        // 兩種狀態必須真的不同——若可見性沒有被切換，這裡會相等
        expect(blurred).not.toEqual(bladed)
        // 且互斥：模糊時可見的那些，換成槳葉時必須隱藏，反之亦然
        const onlyBlurred = blurred.filter((n) => !bladed.includes(n))
        const onlyBladed = bladed.filter((n) => !blurred.includes(n))
        expect(onlyBlurred.length).toBeGreaterThan(0)
        expect(onlyBladed.length).toBeGreaterThan(0)

        // 旋轉角必須真的被寫入（實作寫在 propHub.rotation.z）
        let sawRotation = false
        m.group.traverse((o) => {
          if (Math.abs(o.rotation.z - 2.5) < 1e-9) sawRotation = true
        })
        expect(sawRotation).toBe(true)
        m.dispose()
      })

    })
  }

  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  it('兩台飛機的翼展與外型參數明顯不同', () => {
    const p = SILHOUETTES.p51d!
    const b = SILHOUETTES.bf109g6!
    expect(p.wing.halfSpan).toBeGreaterThan(b.wing.halfSpan)
    // Bf 109 的機身剖面比 P-51D 方（平板側身）、座艙罩更是方框式
    expect(b.fuselage.roundness).toBeGreaterThan(p.fuselage.roundness)
    expect(b.canopy.roundness).toBeGreaterThan(p.canopy.roundness)
    // 槳葉數是辨識機種的線索：P-51D 四葉、Bf 109 三葉
    expect(p.propBlades).toBe(4)
    expect(b.propBlades).toBe(3)
  })
})

/**
 * 【這一組是三個實際出貨缺陷的回歸防護】
 *
 * Task 21 交付後由人工在機庫中肉眼發現三個問題，事後全部可以用數字證明——
 * 也就是說當時的測試本來就該擋下來，只是它們只檢查了「幾何非空」與
 * 「座標有限」，那兩件事對這三個缺陷完全不敏感：
 *
 *   一、機身與所有手寫翼面內外翻轉（帶符號體積為負，法線指向內部）。
 *       正面被背面剔除，看起來像「沒畫完」。16 個網格中有 6 個中招。
 *   二、後掠方向相反。機首是 −Z，`rootZ − tan(sweep)×span` 讓翼尖往機首
 *       跑，做出前掠翼；垂直安定面用同一個函式立起來，於是整片向前傾，
 *       看起來像「垂尾顛倒」。
 *   三、固定翼面只建到 62% 翼展，外側 38% 只有一根弦長 0.55 m 的副翼棒。
 */
describe('幾何的方向性與完整性（回歸）', () => {
  /** 封閉網格的帶符號體積 Σ(v0×v1)·v2/6：逆時針纏繞且法線朝外時為正。 */
  const signedVolume = (geo: BufferGeometry): number => {
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

  const WING = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 20 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }

  it('翼面板左右皆為法線朝外（帶符號體積為正）', () => {
    for (const mirrored of [false, true]) {
      // 缺陷版本兩者都是 −3.36；量值本身也順便釘住盒體體積算對了
      expect(signedVolume(buildWingPanel(WING, mirrored))).toBeGreaterThan(0)
    }
  })

  it('機身為法線朝外', () => {
    for (const id of ['p51d', 'bf109g6']) {
      expect(signedVolume(buildFuselage(SILHOUETTES[id]!.fuselage.sections, 8))).toBeGreaterThan(0)
    }
  })

  it('超橢圓指數提高會讓剖面變方，且不撐大外框', () => {
    const ring = [
      { z: 0, halfWidth: 1, halfHeight: 1, centerY: 0 },
      { z: 1, halfWidth: 1, halfHeight: 1, centerY: 0 },
    ]
    // 圓（n=2）上任一點離軸心都是 1；越方，斜角方向的取樣點離軸心越遠。
    // 用 8 分段是因為它剛好取樣到 45°——差異最大的那個角度。12 分段最近的
    // 取樣點在 30°，量到的是 1.141 而不是真正的角點 1.160。
    const cornerRadius = (roundness: number): number => {
      const p = buildFuselage(ring, 8, roundness).getAttribute('position')
      let r = 0
      for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getY(i)))
      return r
    }
    expect(cornerRadius(2)).toBeCloseTo(1, 3)
    expect(cornerRadius(3.5)).toBeGreaterThan(1.15)

    // 但外框（±halfWidth / ±halfHeight）不能被撐大，否則翼展／全長會失真
    const p = buildFuselage(ring, 8, 3.5).getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(1 + 1e-9)
      expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('全機每一個網格都是法線朝外', () => {
    for (const spec of [P51D, BF109G6]) {
      const m = buildAircraft(spec)
      const inverted: string[] = []
      m.group.traverse((o) => {
        const g = (o as Mesh).geometry
        if (!g?.getAttribute?.('position')) return
        if (signedVolume(g) < 0) inverted.push(o.name || o.type)
      })
      expect(inverted).toEqual([])
      m.dispose()
    }
  })

  it('後掠使翼尖前緣往機尾（+Z）移動，不是往機首', () => {
    const p = buildWingPanel(WING, false).getAttribute('position')
    let tipLeadZ = Infinity
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) > WING.halfSpan * 0.9) tipLeadZ = Math.min(tipLeadZ, p.getZ(i))
    }
    // 缺陷版本是 −3.54（跑到機首方向）
    expect(tipLeadZ).toBeGreaterThan(WING.rootZ)
    expect(tipLeadZ).toBeCloseTo(WING.rootZ + Math.tan(WING.sweep) * WING.halfSpan, 3)
  })

  it('垂直安定面朝上且後掠', () => {
    for (const id of ['p51d', 'bf109g6']) {
      const f = SILHOUETTES[id]!.fin
      const mesh = new Mesh(buildWingPanel({
        rootChord: f.chordRoot, tipChord: f.chordTip, halfSpan: f.height,
        sweep: f.sweep, dihedral: 0, thickness: 0.12, rootZ: f.z, rootY: 0,
      }, false))
      mesh.rotation.z = 90 * DEG
      mesh.updateMatrixWorld(true)
      const p = mesh.geometry.getAttribute('position')
      const v = new Vector3()
      let maxY = -Infinity, zAtMaxY = 0
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mesh.matrixWorld)
        if (v.y > maxY) { maxY = v.y; zAtMaxY = v.z }
      }
      expect(maxY).toBeCloseTo(f.height, 3)          // 朝上，高度等於 spec
      expect(zAtMaxY).toBeGreaterThan(f.z)           // 頂端在翼根之後（後掠）
    }
  })

  it('翼面延伸到全翼展', () => {
    for (const spec of [P51D, BF109G6]) {
      const sil = SILHOUETTES[spec.id]!
      const m = buildAircraft(spec)
      m.group.updateMatrixWorld(true)
      let fixedTipX = 0     // 單側翼面能到的最遠 X
      m.group.traverse((o) => {
        const mesh = o as Mesh
        const p = mesh.geometry?.getAttribute?.('position')
        if (!p) return
        const v = new Vector3()
        let x0 = Infinity, x1 = -Infinity
        for (let i = 0; i < p.count; i++) {
          v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mesh.matrixWorld)
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x)
        }
        // 主翼板：跨越半翼展量級且只在單側
        if (x1 - x0 > sil.wing.halfSpan * 0.8 && x0 >= -0.01) fixedTipX = Math.max(fixedTipX, x1)
      })
      // 缺陷版本：固定翼面只到 3.50（62% 半翼展），外段是空的
      expect(fixedTipX).toBeCloseTo(sil.wing.halfSpan, 2)
      m.dispose()
    }
  })
})

/**
 * 【這裡只留「機制」與「跨模組一致性」，不留造型判斷】
 *
 * 原本這一組還有八條在斷言造型：座艙罩露出多少、罩尾與背線齊不齊、凸起塊
 * 凸不凸、機身深度與收口比值……全部移除。理由是專案負責人指出的，而且有
 * 證據支持：
 *
 *   一、那些斷言是對**手寫的造型數字**再斷言一次，本質上同義反覆。
 *   二、「背線形狀」那條改過兩次，**兩次都是測試錯了、幾何是對的**：
 *       第一次容差訂 3 mm，真機實測偏離 22 mm；第二次寫死線稿的絕對高度，
 *       被改採 E-4 參考模型的裁決推翻。它沒擋下任何缺陷，只擋了自己人。
 *   三、實際發生過的外形缺陷（機翼沒畫完、垂尾顛倒、機腹浮空、機翼位置
 *       太後、機身太瘦）**全部是人眼先發現的**，測試都是事後補的。
 *
 * 留下來的兩條不是造型判斷：包圍盒對 spec.wing.span 是飛行模型與視覺模型
 * 共用同一個數字的一致性檢查；四分之一弦線落在原點是物理模型的重心約束。
 */
describe('外型與真機的對照', () => {
  /** 機身在站位 z 的外殼半高／半寬與中心（線性內插，與 loft 一致）。 */
  const fuselageAt = (sections: readonly FuselageSection[], z: number) => {
    const first = sections[0]!
    const last = sections[sections.length - 1]!
    if (z <= first.z) return first
    if (z >= last.z) return last
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i]!, b = sections[i + 1]!
      if (z > b.z) continue
      const t = (z - a.z) / (b.z - a.z)
      return {
        z,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
        halfHeight: a.halfHeight + (b.halfHeight - a.halfHeight) * t,
        centerY: a.centerY + (b.centerY - a.centerY) * t,
        // loft 是逐站位建環的，站位之間的剖面形狀由著色插值處理；
        // 取較近的那一端最接近實際看到的形狀
        roundness: (t < 0.5 ? a.roundness : b.roundness),
      }
    }
    return last
  }

  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      const sil = SILHOUETTES[spec.id]!

      it('包圍盒的翼展與全長吻合真機', () => {
        const m = buildAircraft(spec)
        const box = new Box3().setFromObject(m.group)
        const size = box.getSize(new Vector3())
        // 翼展直接對 spec——飛行模型與視覺模型用的是同一個數字，
        // 兩邊各改各的會在這裡被抓到
        expect(size.x).toBeCloseTo(spec.wing.span, 2)
        // 全長容許 5%：整流罩尖端與尾錐是造型取捨，不是硬性尺寸
        expect(size.z).toBeGreaterThan(sil.realLength * 0.95)
        expect(size.z).toBeLessThan(sil.realLength * 1.05)
        m.dispose()
      })

      /**
       * 【這條擋的是實際發生過的缺陷】垂尾與背鰭原本一律從 y=0 長起，但
       * 機身後段的中心線是抬高的，下半截因此埋在機身裡。等它從背線冒出來
       * 時，前緣已被後掠角帶往機尾：109 可見的垂尾根部落在全長 86.7%，
       * 設計值（也是線稿量到的值）是 82%——差 4.6% 全長，看起來又小又靠後。
       *
       * P-51D 的背鰭更嚴重：高 0.42 但該站位背線在 0.570，**整片看不見**。
       */
      it('垂尾與背鰭露出背線，且可見根部不偏離設計站位', () => {
        const fins: [string, typeof sil.fin][] = [['垂尾', sil.fin]]
        if (sil.finFillet) fins.push(['背鰭', sil.finFillet])
        for (const [tag, f] of fins) {
          const deck = fuselageAt(sil.fuselage.sections, f.z)
          const deckTop = deck.centerY + deck.halfHeight
          const rootY = f.rootY ?? 0

          // 一、頂端必須高出背線，否則整片埋在機身裡（背鰭缺陷版本：0.42 < 0.570）
          expect(rootY + f.height, `${tag} 頂端`).toBeGreaterThan(deckTop + 0.15)

          // 二、前緣在背線高度的 Z，與設計站位的差距（缺陷版本 109 為 0.409 m）
          const drift = Math.tan(f.sweep) * Math.max(0, deckTop - rootY)
          expect(drift / sil.realLength, `${tag} 可見根部偏移`).toBeLessThan(0.02)
        }
      })

      it('整流罩在機首之前，槳葉數與 spec 一致', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)

        // 槳葉的定義就是「模糊時要藏起來的那些網格」——直接用實作契約去數，
        // 比用幾何形狀猜可靠：槳葉繞軸排開後，各自的世界座標包圍盒完全不同，
        // 任何「細長且伸到槳尖」的形狀判準都只會數到指向 +Y 的那一片。
        const visible = (): Set<string> => {
          const s = new Set<string>()
          m.group.traverse((o) => { if ((o as Mesh).isMesh && o.visible) s.add(o.uuid) })
          return s
        }
        m.setPropSpin(0, false)
        const bladed = visible()
        m.setPropSpin(0, true)
        const blurred = visible()
        const blades = [...bladed].filter((u) => !blurred.has(u))
        expect(blades.length).toBe(sil.propBlades)

        let minZ = Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          const v = new Vector3()
          for (let i = 0; i < p.count; i++) {
            minZ = Math.min(minZ, v.set(p.getX(i), p.getY(i), p.getZ(i))
              .applyMatrix4(o.matrixWorld).z)
          }
        })
        // 造型座標要加上重心位移才能跟世界座標比
        expect(minZ).toBeLessThan(sil.fuselage.sections[0]!.z + hullOffsetZ(sil))
        m.dispose()
      })

      /**
       * 原點是物理模型的**重心**（`state.position` 就是重心），所以模型的
       * 機翼四分之一弦線必須壓在原點上。實測位移前 P-51D 差 0.81 m、
       * Bf 109 差 2.08 m——那等於把重心放在氣動中心後方兩公尺，物理上說不通，
       * 視覺上追尾相機也會對準錯的點。
       */
      it('機翼四分之一弦線落在原點（＝重心）', () => {
        const quarterChord = sil.wing.rootZ + 0.25 * sil.wing.rootChord + hullOffsetZ(sil)
        expect(quarterChord).toBeCloseTo(0, 9)
      })
    })
  }
})
