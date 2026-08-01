import { describe, it, expect } from 'vitest'
import { Box3, BufferGeometry, Mesh, Vector3 } from 'three'
import { buildFuselage, type FuselageSection } from '../../src/render/geometry/fuselage'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { SILHOUETTES, type LoftPart } from '../../src/render/geometry/silhouettes'
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
        expect(m.group.children.length).toBeGreaterThan(5)
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

      /**
       * 【計畫原稿有兩個缺陷，已修正】
       * 一、`position.count / 3` 對**有索引**的幾何算的是唯一頂點數，不是
       *     三角形數。真實三角形數要看 index.count / 3。實測差距很大：
       *     P-51D 真實 384、原公式 267.7；Bf 109 真實 296、原公式 250.0。
       * 二、測試名稱寫「400–1200」，斷言卻是 > 200 且 < 1500，兩者不符。
       *
       * 兩個缺陷剛好互相抵銷才讓原版通過：若量對東西又套用名稱裡的門檻，
       * 兩架飛機都會不及格（384 與 296 都低於 400）。
       *
       * 【門檻依實測訂為 250–800】（專案負責人裁決：維持現有細緻度）
       * 下界只是防止幾何退化成空殼，**不是品質保證**——外型好不好看、
       * 特徵認不認得出來，測試量不到，只有人眼判得出。上界才是有意義的
       * 那一側：它守住低多邊形的效能預算。
       */
      it('全機三角形數落在低多邊形預算內', () => {
        const m = buildAircraft(spec)
        let tris = 0
        m.group.traverse((o) => {
          const g = (o as unknown as {
            geometry?: {
              index?: { count: number } | null
              getAttribute(n: string): { count: number } | undefined
            }
          }).geometry
          if (!g) return
          const p = g.getAttribute('position')
          if (!p) return
          // 有索引就用索引數，那才是真正被畫出來的三角形
          tris += g.index ? g.index.count / 3 : p.count / 3
        })
        expect(tris).toBeGreaterThan(250)
        expect(tris).toBeLessThan(800)
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
 * 【外型精緻度的驗收】
 *
 * 這一組守的是「看得見」這件事。細節做得再多，只要埋在機身裡就等於沒做——
 * 而埋不埋得住，靠肉眼在機庫裡轉一圈很容易漏掉（座艙罩沉下去 2 cm 看起來
 * 只是「有點矮」，不像壞掉）。這些全部可以純數字判定。
 *
 * 另一半守的是「別偏離真機」：造型參數是手調的，調著調著很容易把翼展或
 * 全長改掉而沒人發現。包圍盒對 spec.wing.span 與 realLength 是唯一的錨。
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

      it('座艙罩高出機身背線，不是埋在裡面', () => {
        let maxProtrusion = -Infinity
        for (const s of sil.canopy.sections) {
          const f = fuselageAt(sil.fuselage.sections, s.z)
          maxProtrusion = Math.max(
            maxProtrusion, (s.centerY + s.halfHeight) - (f.centerY + f.halfHeight),
          )
        }
        // 【門檻是 0.10 不是 0.15】下界的用途只有一個：擋住「座艙罩整個埋
        // 進機身」。它**不能**用來要求氣泡罩——P-51D 的泡罩露出 0.28 m，
        // Bf 109 是低座艙罩配高背脊，只露出 0.13 m，兩者都是對的。
        // 訂在 0.15 會把 109 正確的高背脊造型判成不及格。
        expect(maxProtrusion).toBeGreaterThan(0.10)
      })

      /**
       * 【這條擋的是實際發生過的缺陷】P-51D 的機腹散熱器導管後半段浮在空中：
       * 機腹自機翼後緣起就往上收（boat-tail），導管卻一路平飛，到 z=2.4
       * 已經離開機身 0.20 m——側視是一根獨立漂浮的方管。
       *
       * 【判準要用真正的表面，不能用中線】第一版只比對兩者的垂直區間是否
       * 相交，那等於只檢查了 x=0 那一條線。機身是超橢圓剖面，導管**兩側**
       * 對應的機身表面比中線高得多，所以中線相交、上緣兩角照樣懸空——修完
       * 第一版之後實測仍在機身表面外 3.69 倍（1.0 才是表面）。
       *
       * 正確判準：把部件朝向機身那一側的**極端頂點**（導管的頂稜、座艙罩的
       * 底稜）逐一代入機身的超橢圓不等式，全部必須 <1（在機身內部）。極端
       * 頂點進得去，交線就是封閉的，不會有縫。
       */
      it('座艙罩與機腹導管的接合稜線都埋在機身內', () => {
        const attached: [string, LoftPart, boolean][] = [['座艙罩', sil.canopy, false]]
        if (sil.scoop) attached.push(['機腹導管', sil.scoop, true])

        for (const [tag, part, towardTop] of attached) {
          const e = 2 / part.roundness
          const shape = (v: number) => Math.sign(v) * Math.abs(v) ** e
          for (const s of part.sections) {
            const f = fuselageAt(sil.fuselage.sections, s.z)
            const n = f.roundness ?? sil.fuselage.roundness
            // 產生該站位的實際頂點，取朝向機身那一側最極端的那些
            const ring = Array.from({ length: part.segments }, (_, i) => {
              const t = (i / part.segments) * Math.PI * 2
              return { x: shape(Math.cos(t)) * s.halfWidth, y: shape(Math.sin(t)) * s.halfHeight }
            })
            const extreme = towardTop
              ? Math.max(...ring.map((p) => p.y))
              : Math.min(...ring.map((p) => p.y))
            for (const p of ring.filter((p) => Math.abs(p.y - extreme) < 1e-9)) {
              const d = Math.abs(p.x / f.halfWidth) ** n
                + Math.abs((s.centerY + p.y - f.centerY) / f.halfHeight) ** n
              expect(d, `${tag} z=${s.z} x=${p.x.toFixed(3)}`).toBeLessThan(1)
            }
          }
        }
      })

      /**
       * Bf 109 自座艙後方到尾錐，側視的背線與腹線都是**直線**（機身是等直
       * 錐度的半殼單殼構造，不是收口的錐體）。原本的背線斜率是
       * −0.0615 → −0.0538 → −0.0750：中段變平、尾段折下去。
       *
       * P-51D 不受此拘束——它的後段背脊確實是有弧度的，所以只驗 Bf 109。
       */
      it('座艙罩尾端與機身背線齊平，不留斷差', () => {
        const tail = sil.canopy.sections[sil.canopy.sections.length - 1]!
        const f = fuselageAt(sil.fuselage.sections, tail.z)
        // 缺陷版本：Bf 109 罩尾 0.55 對背線 0.456（差 0.094）、P-51D 差 0.10
        expect(Math.abs((tail.centerY + tail.halfHeight) - (f.centerY + f.halfHeight)))
          .toBeLessThan(0.02)
      })

      if (spec.id === 'bf109g6') {
        it('座艙後方的背線與腹線是直的', () => {
          const aft = sil.fuselage.sections.filter((s) => s.z >= 0.3)
          const first = aft[0]!, last = aft[aft.length - 1]!
          for (const line of ['top', 'bottom'] as const) {
            const at = (s: typeof first) =>
              line === 'top' ? s.centerY + s.halfHeight : s.centerY - s.halfHeight
            const slope = (at(last) - at(first)) / (last.z - first.z)
            for (const s of aft.slice(1, -1)) {
              const expected = at(first) + slope * (s.z - first.z)
              // 缺陷版本的背線在 z=1.60 偏離 5 mm、z=2.90 偏離 14 mm
              expect(Math.abs(at(s) - expected), `${line} @ z=${s.z}`).toBeLessThan(0.003)
            }
          }
        })

        /**
         * 高背脊：座艙罩玻璃頂與其後方背脊的高度差要小。109 的座艙罩只是
         * 薄薄一片凸出物（後方視野惡名昭彰的原因），不是擱在錐體上的氣泡罩。
         */
        it('座艙罩頂與其後方背脊接近齊平（高背脊）', () => {
          const roof = Math.max(...sil.canopy.sections.map((s) => s.centerY + s.halfHeight))
          const tail = sil.canopy.sections[sil.canopy.sections.length - 1]!
          const deck = fuselageAt(sil.fuselage.sections, tail.z)
          // 缺陷版本：罩頂 0.78 對其後方背脊 0.46，差 0.32
          expect(roof - (deck.centerY + deck.halfHeight)).toBeLessThan(0.12)
        })

        /** 平尾裝在垂尾上、高於背線——109 側影一眼可辨的特徵。 */
        it('水平尾翼高於機身背線', () => {
          const deck = fuselageAt(sil.fuselage.sections, sil.tailplane.rootZ)
          // 缺陷版本：rootY 0.18 比背線 0.362 還低 0.18 m
          expect(sil.tailplane.rootY).toBeGreaterThan(deck.centerY + deck.halfHeight)
        })
      }

      it('每個凸起塊都露在機身外', () => {
        for (const b of sil.blisters) {
          const f = fuselageAt(sil.fuselage.sections, b.z)
          // 「露出來」可以靠垂直方向（鼓包、進氣口）也可以靠橫向（翼下散熱器、
          // 尾翼支柱）。支柱本來就有一端插進機身裡，只檢查垂直方向會誤判。
          const up = (b.y + b.height / 2) - (f.centerY + f.halfHeight)
          const down = (f.centerY - f.halfHeight) - (b.y - b.height / 2)
          const side = Math.abs(b.x) + b.width / 2 - f.halfWidth
          expect(Math.max(up, down, side)).toBeGreaterThan(0.02)
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
        expect(minZ).toBeLessThan(sil.fuselage.sections[0]!.z)
        m.dispose()
      })
    })
  }
})
