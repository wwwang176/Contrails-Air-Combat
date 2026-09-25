import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { pushFlora, FloraKind, type FloraSource } from '../../src/render/flora'
import {
  BRICK_WALL, BROAD_CROWN_R, BUILDING_DEPTH, BUILDING_WIDTH, BUSH_R, CONE_CROWN_R, OLD_ROOF, ROOF, SLATE, WALL,
} from '../../src/render/floraShapes'
import { CANOPY_SHADE, FLORA_COLORS } from '../../src/render/season'
import { TINT_RANGE } from '../../src/render/vegetation'
import { floraSplats, ROOF_GROW, WALL_SHARE } from '../../src/render/buildingBake'

/** 把固定的幾筆吐進視窗；只吐中心在視窗裡的。一筆是 x, z, rot, scale, tint, kind, wide, tall */
function fixed(items: readonly (readonly number[])[]): FloraSource {
  return (x0, z0, x1, z1, heightAt, out) => {
    for (const [x, z, rot, scale, tint, kind, wide, tall] of items) {
      if (x! < x0 || x! >= x1 || z! < z0 || z! >= z1) continue
      pushFlora(out, x!, heightAt(x!, z!), z!, rot!, scale!, tint!, kind as FloraKind, wide, tall)
    }
  }
}

const corners = (g: ReturnType<typeof floraSplats>, q: number): [number, number][] => {
  const p = g.getAttribute('position')
  return [0, 1, 2, 3].map((k) => [p.getX(q * 4 + k), p.getZ(q * 4 + k)])
}

/** 第 q 個色塊的寬與深（軸對齊時） */
const extent = (g: ReturnType<typeof floraSplats>, q: number): [number, number] => {
  const xs = corners(g, q).map((c) => c[0])
  const zs = corners(g, q).map((c) => c[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]
}

describe('屋頂與樹冠的色塊', () => {
  /**
   * 【與模型同一套座標】x 軸轉到 (cos θ, −sin θ)、z 軸 (sin θ, cos θ)
   * （`vegetation.ts` 寫矩陣的方式）。轉錯的話遠處的鎮每一棟都歪一個角度，
   * 拉近時色塊從房子底下斜著露出來。
   */
  it('四個角是放大過的屋頂外框：面寬沿模型的 x 軸、進深沿 z 軸', () => {
    const rot = 0.5
    const g = floraSplats([fixed([[100, 200, rot, 1.2, 0.5, FloraKind.House, 1.5, 2]])], -1000, -1000, 1000, 1000)
    const hw = ((BUILDING_WIDTH + 1) * ROOF_GROW * 1.2 * 1.5) / 2
    const hd = ((BUILDING_DEPTH + 1) * ROOF_GROW * 1.2) / 2
    const ax = [Math.cos(rot), -Math.sin(rot)]
    const az = [Math.sin(rot), Math.cos(rot)]
    const want = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
      [100 + ax[0]! * hw * u! + az[0]! * hd * v!, 200 + ax[1]! * hw * u! + az[1]! * hd * v!])
    const got = corners(g, 0)
    for (const w of want) {
      expect(got.some((c) => Math.hypot(c[0] - w[0]!, c[1] - w[1]!) < 1e-3), JSON.stringify(w)).toBe(true)
    }
    expect(g.index!.count).toBe(6)
    g.dispose()
  })

  /**
   * 【顏色是屋頂與牆混色、乘逐棟明度】明度與植被引擎同一個算法；不乘的話遠處的鎮
   * 是一片同一個紅。牆色的比例見 `WALL_SHARE`
   */
  it('顏色是屋頂與牆的混色乘上建築的明度抖動，線性值', () => {
    const tint = 0.25
    const g = floraSplats([fixed([
      [0, 0, 0, 1, tint, FloraKind.House, 1, 1],
      [100, 0, 0, 1, tint, FloraKind.Barn, 1, 1],
      [200, 0, 0, 1, tint, FloraKind.SlateHouse, 1, 1],
    ])], -1000, -1000, 1000, 1000)
    const k = TINT_RANGE.building[0] + (TINT_RANGE.building[1] - TINT_RANGE.building[0]) * tint
    const col = g.getAttribute('color')
    const px = g.getAttribute('position')
    for (const [roof, wall, x] of [[ROOF, WALL, 0], [OLD_ROOF, BRICK_WALL, 100], [SLATE, WALL, 200]] as const) {
      const c = new Color(roof).lerp(new Color(wall), WALL_SHARE)
      let q = -1
      for (let i = 0; i < px.count; i += 4) {
        const cx = (px.getX(i) + px.getX(i + 2)) / 2
        if (Math.abs(cx - x) < 1) q = i
      }
      expect(q).toBeGreaterThanOrEqual(0)
      expect(col.getX(q)).toBeCloseTo(c.r * k, 5)
      expect(col.getY(q)).toBeCloseTo(c.g * k, 5)
      expect(col.getZ(q)).toBeCloseTo(c.b * k, 5)
    }
    g.dispose()
  })

  /**
   * 【樹也烘】村鎮裡的樹與河岸林在植被圈外不畫；不烘的話遠處的鎮只剩屋頂、
   * 河邊的林子整排消失。外框是樹冠的直徑，顏色是這個季節的樹冠色乘 `CANOPY_SHADE`
   */
  it('樹冠是直徑見方、季節的樹冠色乘植物的明度；教堂畫本堂的屋頂', () => {
    const tint = 0.5
    const g = floraSplats([fixed([
      [0, 0, 0, 1.5, tint, FloraKind.BroadTree, 1, 1],
      [100, 0, 0, 1, tint, FloraKind.ConeTree, 1, 1],
      [200, 0, 0, 1, tint, FloraKind.Bush, 2, 1],
      [300, 0, 0, 2, 0.5, FloraKind.Church, 1, 1],
    ])], -1000, -1000, 1000, 1000, 'lateAutumn')
    expect(g.getAttribute('position').count).toBe(16)
    const c = FLORA_COLORS.lateAutumn
    const k = TINT_RANGE.plant[0] + (TINT_RANGE.plant[1] - TINT_RANGE.plant[0]) * tint
    const col = g.getAttribute('color')
    const want: [number, number, number][] = [
      [2 * BROAD_CROWN_R * 1.5, 2 * BROAD_CROWN_R * 1.5, c.broadLeaf],
      [2 * CONE_CROWN_R, 2 * CONE_CROWN_R, c.conifer],
      // 灌木不吃面寬倍率
      [2 * BUSH_R, 2 * BUSH_R, c.bushLeaf],
    ]
    for (let q = 0; q < 3; q++) {
      const [w, d, hex] = want[q]!
      const [gw, gd] = extent(g, q)
      expect(gw).toBeCloseTo(w, 3)
      expect(gd).toBeCloseTo(d, 3)
      const cc = new Color(hex).multiplyScalar(CANOPY_SHADE)
      expect(col.getX(q * 4)).toBeCloseTo(cc.r * k, 5)
      expect(col.getY(q * 4)).toBeCloseTo(cc.g * k, 5)
      expect(col.getZ(q * 4)).toBeCloseTo(cc.b * k, 5)
    }
    const [cw, cd] = extent(g, 3)
    expect(cw).toBeCloseTo(10 * ROOF_GROW * 2, 3)
    expect(cd).toBeCloseTo(19 * ROOF_GROW * 2, 3)
    g.dispose()
  })

  /** 【容量不夠就重跑】散佈器溢位是靜靜地丟，丟掉的是哪幾棟取決於次序 —— 半個鎮沒有屋頂 */
  it('建築比預設容量多時全部都在', () => {
    const many: number[][] = []
    for (let i = 0; i < 70_000; i++) many.push([(i % 300) * 30, Math.floor(i / 300) * 30, 0, 1, 0.5, FloraKind.House, 1, 1])
    const g = floraSplats([fixed(many)], -1, -1, 100_000, 100_000)
    expect(g.getAttribute('position').count).toBe(70_000 * 4)
    g.dispose()
  })

  it('多個散佈器的建築都收', () => {
    const g = floraSplats([
      fixed([[0, 0, 0, 1, 0.5, FloraKind.House, 1, 1]]),
      fixed([[50, 0, 0, 1, 0.5, FloraKind.TarBarn, 1, 1]]),
    ], -1000, -1000, 1000, 1000)
    expect(g.getAttribute('position').count).toBe(8)
    g.dispose()
  })
})
