import { describe, expect, it } from 'vitest'
import { Color, ShaderChunk, ShaderLib, UniformsLib, UniformsUtils } from 'three'
import {
  BATTLE_FOG, battleFogEdge, battleFogSampleT, clearBattleFog, HEIGHT_FOG_BASE, HEIGHT_FOG_DENSITY,
  HEIGHT_FOG_EDGE_START, HEIGHT_FOG_SAMPLE, HEIGHT_FOG_SCALE_HEIGHT, heightFogColumn, installHeightFog,
  setBattleFog, stepBattleFog,
} from '../../src/render/heightFog'

installHeightFog()

describe('高度霧：共用的 uniform', () => {
  /**
   * 【整個做法成不成立的關鍵】three 建 program 時對材質的 uniform 字典做 `UniformsUtils.clone`，自訂的
   * ShaderMaterial 常用 `UniformsUtils.merge`。值物件如果被複製，每幀改一份、全場材質都看得到這件事就做不到。
   * 純物件（沒有 isVector4 之類的旗標）不會被複製，兩條路都要守住。
   */
  it('clone ShaderLib 與 merge UniformsLib.fog 之後，值仍是同一個物件', () => {
    const cloned = UniformsUtils.clone(ShaderLib['standard']!.uniforms)
    expect(cloned['uBFA']!.value).toBe(BATTLE_FOG.a)
    expect(cloned['uBFB']!.value).toBe(BATTLE_FOG.b)
    const merged = UniformsUtils.merge([UniformsLib['fog'], { other: { value: 1 } }])
    expect(merged['uBFA']!.value).toBe(BATTLE_FOG.a)
    BATTLE_FOG.a.w = 0.37
    expect(cloned['uBFA']!.value.w).toBe(0.37)
    expect(merged['uBFA']!.value.w).toBe(0.37)
    BATTLE_FOG.a.w = 0
  })

  /** 每一種有霧的內建材質都帶著它；沒有霧的（例如線、陰影用的）不必帶 */
  it('每一個有霧的 ShaderLib 項目都帶著兩份 uniform', () => {
    let n = 0
    for (const [name, lib] of Object.entries(ShaderLib)) {
      if (lib.uniforms['fogColor'] === undefined) continue
      n++
      expect(lib.uniforms['uBFA'], name).toBeDefined()
      expect(lib.uniforms['uBFB'], name).toBeDefined()
    }
    expect(n).toBeGreaterThan(5)
  })
})

describe('高度霧：著色器片段', () => {
  it('重複安裝不會重複改：宣告只出現一次', () => {
    installHeightFog()
    installHeightFog()
    expect(ShaderChunk['fog_pars_fragment'].match(/uniform vec4 uBFA;/g)).toHaveLength(1)
    expect(ShaderChunk['fog_pars_vertex'].match(/varying vec3 vFogRay;/g)).toHaveLength(1)
    expect(ShaderChunk['fog_fragment'].match(/uBFA\.w > 0\.0/g)).toHaveLength(1)
  })

  it('頂點端：多帶「相機到這個頂點」的世界方向向量，原來的距離不動', () => {
    expect(ShaderChunk['fog_vertex']).toContain('vFogDepth = - mvPosition.z;')
    expect(ShaderChunk['fog_vertex']).toContain('vFogRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;')
  })

  it('片段端：原來的距離霧公式不動，之後才疊高度霧，強度為 0 時整段略過', () => {
    const f = ShaderChunk['fog_fragment']
    expect(f).toContain('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );')
    expect(f).toContain('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );')
    expect(f.indexOf('uBFA.w > 0.0')).toBeGreaterThan(f.indexOf('mix( gl_FragColor.rgb, fogColor, fogFactor )'))
    expect(f).toContain('battleFogTau( cameraPosition, vFogRay )')
  })

  it('著色器吃的是同一組常數：基準高度、尺度高度、密度、淡出起點', () => {
    const p = ShaderChunk['fog_pars_fragment']
    for (const v of [HEIGHT_FOG_BASE, HEIGHT_FOG_SCALE_HEIGHT, HEIGHT_FOG_EDGE_START]) expect(p).toContain(v.toFixed(4))
    expect(p).toContain(HEIGHT_FOG_DENSITY.toFixed(6))
    // 遮罩的取樣點：從像素往相機走 t（最多一半），t = SAMPLE × H ÷ 高度差
    expect(p).toContain(`min( 0.5, ${(HEIGHT_FOG_SAMPLE * HEIGHT_FOG_SCALE_HEIGHT).toFixed(4)} / max( abs( ray.y ), 1.0 ) )`)
    expect(p).toContain('vec2 q = p.xz - ray.xz * t;')
    // 積分公式的兩個特例要有：高度差接近 0 時取極限，指數夾住不溢位
    expect(p).toContain('abs(k) < 1.0e-3 ? 1.0 : (1.0 - exp(-k)) / k')
    expect(p).toContain('clamp(')
  })
})

describe('高度霧：沿視線的積分', () => {
  /** 數值積分：把視線切成很多段，每一段的密度乘上段長 */
  const numeric = (camY: number, pY: number, d: number): number => {
    const n = 200000
    let sum = 0
    for (let i = 0; i < n; i++) {
      const y = camY + ((pY - camY) * (i + 0.5)) / n
      sum += Math.exp(-(y - HEIGHT_FOG_BASE) / HEIGHT_FOG_SCALE_HEIGHT) * (d / n)
    }
    return HEIGHT_FOG_DENSITY * sum
  }

  it.each([
    ['從高處俯看地面', 1500, 0, 1600],
    ['斜著看遠處的地面', 1500, 0, 2800],
    ['貼地平視', 20, 30, 3000],
    ['低空往上看', 10, 400, 900],
    ['完全水平', 80, 80, 1200],
    ['相機在基準高度以下', -50, 100, 300],
  ])('%s：與數值積分一致', (_n, camY, pY, d) => {
    const exact = numeric(camY, pY, d)
    expect(heightFogColumn(camY, pY, d)).toBeCloseTo(exact, 6)
    expect(exact).toBeGreaterThan(0)
  })

  /** 高度差只有一點點時公式是 0/0：取極限，不能出現 NaN 或突然歸零 */
  it('高度差趨近 0：連續、有限，沒有 NaN', () => {
    const flat = heightFogColumn(80, 80, 1200)
    for (const dy of [1e-1, 1e-3, 1e-6, 1e-9]) {
      const v = heightFogColumn(80, 80 + dy, 1200)
      expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(v - flat) / flat).toBeLessThan(1e-2)
    }
  })

  /** 離霧越高，視線穿過霧的比例越小：從 3 km 高處看到的比從 300 m 看到的淡 */
  it('相機越高越淡；視線越長越濃', () => {
    expect(heightFogColumn(3000, 0, 3000)).toBeLessThan(heightFogColumn(300, 0, 3000))
    expect(heightFogColumn(300, 0, 600)).toBeLessThan(heightFogColumn(300, 0, 1200))
  })

  it('極端高度：不溢位', () => {
    for (const [a, b] of [[1e6, 0], [0, 1e6], [-1e6, 1e6]] as const) {
      expect(Number.isFinite(heightFogColumn(a, b, 1e6))).toBe(true)
    }
  })
})

describe('高度霧：水平遮罩取在視線的哪一點', () => {
  /**
   * 視線上大部分的光學厚度集中在**靠近像素那一端**（那裡最低、密度最高）。從高處斜看遠處的地面，遮罩要
   * 取在像素附近，不是視線的中點 —— 取中點的話，圈外很遠的像素只因為視線飛越過戰場上方就被蓋上一層霧，
   * 整張畫面像蒙了灰。視線接近水平（相機也在霧裡）時整段都在霧裡，才取中點。
   */
  it('陡的視線取在像素端附近，接近水平的視線取中點，高度差越大越靠近像素', () => {
    expect(battleFogSampleT(80, 80)).toBe(0.5)
    expect(battleFogSampleT(80, 85)).toBe(0.5)
    expect(battleFogSampleT(1500, 0)).toBeLessThan(0.15)
    expect(battleFogSampleT(1500, 0)).toBeCloseTo((HEIGHT_FOG_SAMPLE * HEIGHT_FOG_SCALE_HEIGHT) / 1500, 9)
    let prev = 0.5
    for (const dy of [50, 100, 200, 400, 800, 1600]) {
      const t = battleFogSampleT(0, dy)
      expect(t).toBeLessThanOrEqual(prev + 1e-12)
      prev = t
    }
    // 上下對稱：往上看與往下看，只看高度差
    expect(battleFogSampleT(0, -300)).toBe(battleFogSampleT(0, 300))
  })
})

describe('高度霧：水平的淡出與狀態', () => {
  it('邊緣淡出：內圈 1、半徑外 0、單調遞減', () => {
    expect(battleFogEdge(0, 2000)).toBe(1)
    expect(battleFogEdge(2000 * HEIGHT_FOG_EDGE_START, 2000)).toBe(1)
    expect(battleFogEdge(2000, 2000)).toBe(0)
    expect(battleFogEdge(9000, 2000)).toBe(0)
    let prev = 1
    for (let d = 900; d <= 2000; d += 20) {
      const v = battleFogEdge(d, 2000)
      expect(v).toBeLessThanOrEqual(prev + 1e-12)
      prev = v
    }
  })

  it('setBattleFog 寫進共用的 uniform，clear 把強度歸零，step 讓團塊的時間前進', () => {
    setBattleFog({ x: 100, z: -200, radius: 2300, tint: new Color(0.5, 0.4, 0.3) })
    expect([BATTLE_FOG.a.x, BATTLE_FOG.a.y, BATTLE_FOG.a.z, BATTLE_FOG.a.w]).toEqual([100, -200, 2300, 1])
    expect(BATTLE_FOG.b.x).toBeCloseTo(0.5, 6)
    expect(BATTLE_FOG.b.y).toBeCloseTo(0.4, 6)
    expect(BATTLE_FOG.b.z).toBeCloseTo(0.3, 6)
    expect(BATTLE_FOG.b.w).toBe(0)
    stepBattleFog(2.5)
    stepBattleFog(1)
    expect(BATTLE_FOG.b.w).toBeCloseTo(3.5, 9)
    clearBattleFog()
    expect(BATTLE_FOG.a.w).toBe(0)
  })

  it('強度可以另外給（量測用的開關）', () => {
    setBattleFog({ x: 0, z: 0, radius: 1000, tint: new Color(1, 1, 1), strength: 0.5 })
    expect(BATTLE_FOG.a.w).toBe(0.5)
    clearBattleFog()
  })
})
