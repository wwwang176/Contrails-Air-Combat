import { describe, it, expect } from 'vitest'
import { Color, Vector3, type Mesh, type MeshStandardMaterial, type ShaderMaterial } from 'three'
import {
  DAY_PALETTES, TIME_OF_DAY_IDS, applyTimeOfDay, paletteSkyColorAt, paletteSunDir,
  type DayPalette, type PaletteTarget,
} from '../../src/render/timeOfDay'
import {
  applySkyPalette, createSky, skyColorAt, SKY_GRADIENT_POWER, SKY_HORIZON, SKY_ZENITH,
} from '../../src/render/sky'
import {
  createOcean, SEA_COLOR, SEA_HORIZON_COLOR, SPARKLE_STRENGTH,
} from '../../src/render/ocean'
import { createLights, applyLightPalette } from '../../src/render/lighting'
import { FOG_COLOR, FOG_DENSITY } from '../../src/render/fog'
import { MISSIONS } from '../../src/battle/missions'
import { DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import type { SceneContext } from '../../src/render/scene'
import type { TimeOfDay } from '../../src/world/timeOfDay'

const ALL = TIME_OF_DAY_IDS.map((id) => DAY_PALETTES[id])

describe('DAY_PALETTES', () => {
  it('五個時段都在，鍵與 id 一致', () => {
    expect(TIME_OF_DAY_IDS).toEqual(['dawn', 'noon', 'dusk', 'night', 'novemberNoon'])
    for (const id of TIME_OF_DAY_IDS) expect(DAY_PALETTES[id].id).toBe(id)
  })

  it('novemberNoon：太陽仰角二十幾度、霧比正午濃、海色照抄正午', () => {
    const n = DAY_PALETTES.novemberNoon
    const noon = DAY_PALETTES.noon
    const [x, y, z] = n.sunDir
    const elevation = Math.asin(y / Math.hypot(x, y, z))
    expect(elevation).toBeGreaterThan(20 * Math.PI / 180)
    expect(elevation).toBeLessThan(30 * Math.PI / 180)
    expect(n.fogDensity).toBeGreaterThan(noon.fogDensity)
    expect(n.sunIntensity).toBeLessThan(noon.sunIntensity)
    expect(n.seaColor).toBe(noon.seaColor)
    expect(n.seaHorizon).toBe(noon.seaHorizon)
  })

  /**
   * 【正午必須逐位元等於那些原本的常數】這是整支功能「不影響既有十一關」
   * 的**唯一**承重點。`createScene` 一律走 `setPalette`，所以只要這一條成立，
   * 沒有指定時段的關卡畫出來就與沒有時段功能時完全相同。
   *
   * 比的是「palette 的欄位」與「原本那些常數」，不是兩個 palette 互比 ——
   * 後者兩邊一起改照樣綠。
   */
  it('正午的每一格都直接引用原本的常數', () => {
    const p = DAY_PALETTES.noon
    expect(p.skyHorizon).toBe(SKY_HORIZON)
    expect(p.skyZenith).toBe(SKY_ZENITH)
    expect(p.skyPower).toBe(SKY_GRADIENT_POWER)
    expect(p.seaColor).toBe(SEA_COLOR)
    expect(p.seaHorizon).toBe(SEA_HORIZON_COLOR)
    expect(p.fogDensity).toBe(FOG_DENSITY)
    // 三個倍率在正午都是恆等元
    expect(p.stars).toBe(0)
    expect(p.sparkle).toBe(1)
    expect(p.foliage).toBe(1)
  })

  /**
   * 【正午的三盞燈也要逐位元相同】`createLights()` 的預設就是這一組，而
   * e2e 的量測 fixture 與正式場景共用它 —— 植被點的亮度係數 `POINT_LIGHT`
   * 就是在這組燈下校的。
   */
  it('正午的燈與 createLights() 的預設是同一組', () => {
    const l = createLights()
    const p = DAY_PALETTES.noon
    expect(l.sun.color.getHex()).toBe(p.sunColor)
    expect(l.sun.intensity).toBe(p.sunIntensity)
    expect(l.hemi.color.getHex()).toBe(p.hemiSky)
    expect(l.hemi.groundColor.getHex()).toBe(p.hemiGround)
    expect(l.hemi.intensity).toBe(p.hemiIntensity)
    expect(l.ambient.color.getHex()).toBe(p.ambientColor)
    expect(l.ambient.intensity).toBe(p.ambientIntensity)
  })

  /**
   * 【正午的霧色仍然由天空推導】`fog.ts` 的 `FOG_COLOR` 是
   * `skyColorAt(0)`，而 `scene.setPalette` 改走 `paletteSkyColorAt(0, p)`。
   * 兩支若算得不一樣，正午的霧就會靜靜地偏掉 —— 而畫面上只是「遠處的飛機
   * 化開的顏色不太對」。
   */
  it('paletteSkyColorAt(0, 正午) 逐分量等於 FOG_COLOR', () => {
    const c = paletteSkyColorAt(0, DAY_PALETTES.noon, new Color())
    expect(c.r).toBeCloseTo(FOG_COLOR.r, 12)
    expect(c.g).toBeCloseTo(FOG_COLOR.g, 12)
    expect(c.b).toBeCloseTo(FOG_COLOR.b, 12)
    // 順便釘住它與 sky.ts 那一支在正午上是同一條公式
    const s = skyColorAt(0, new Color())
    expect(c.r).toBeCloseTo(s.r, 12)
  })

  it('每一格都在合理範圍內', () => {
    for (const p of ALL) {
      expect(p.stars).toBeGreaterThanOrEqual(0)
      expect(p.stars).toBeLessThanOrEqual(1)
      expect(p.sparkle).toBeGreaterThanOrEqual(0)
      expect(p.foliage).toBeGreaterThanOrEqual(0)
      expect(p.sunIntensity).toBeGreaterThan(0)
      expect(p.fogDensity).toBeGreaterThan(0)
      expect(p.name.length).toBeGreaterThan(0)
      for (const hex of [p.skyHorizon, p.skyZenith, p.sunColor, p.hemiSky,
        p.hemiGround, p.ambientColor, p.seaColor, p.seaHorizon]) {
        expect(hex).toBeGreaterThanOrEqual(0)
        expect(hex).toBeLessThanOrEqual(0xffffff)
      }
    }
  })
})

describe('paletteSunDir', () => {
  /**
   * 【光源不能指向地平線以下】`DirectionalLight` 的方向是正規化過的
   * `position`，仰角為負時整個場景只剩環境光 —— 那看起來像「光照壞了」
   * 而不是「太陽下山了」。清晨與黃昏刻意壓到很低，所以這條守的是下界。
   */
  it('回傳單位向量，而且四個時段都在地平線之上', () => {
    for (const p of ALL) {
      const v = paletteSunDir(p, new Vector3())
      expect(v.length()).toBeCloseTo(1, 9)
      expect(v.y).toBeGreaterThan(0)
    }
  })
})

describe('applySkyPalette', () => {
  it('四個 uniform 全部寫進去，包含星點', () => {
    const sky = createSky()
    const u = (sky.material as ShaderMaterial).uniforms
    applySkyPalette(sky, DAY_PALETTES.night)
    const p = DAY_PALETTES.night
    expect((u.horizon!.value as Color).getHex()).toBe(p.skyHorizon)
    expect((u.zenith!.value as Color).getHex()).toBe(p.skyZenith)
    expect(u.power!.value).toBe(p.skyPower)
    expect(u.stars!.value).toBe(p.stars)
  })

  /**
   * 【星點的 uniform 在正午必須是 0】著色器對它有一道
   * `if (stars > 0.0)`，那是「正午與加星之前逐位元相同」的來源。
   */
  it('套回正午時星點歸零', () => {
    const sky = createSky()
    applySkyPalette(sky, DAY_PALETTES.night)
    applySkyPalette(sky, DAY_PALETTES.noon)
    expect((sky.material as ShaderMaterial).uniforms.stars!.value).toBe(0)
  })
})

describe('applyLightPalette', () => {
  it('三盞燈一起換', () => {
    const l = createLights()
    applyLightPalette(l, DAY_PALETTES.dusk)
    const p = DAY_PALETTES.dusk
    expect(l.sun.color.getHex()).toBe(p.sunColor)
    expect(l.sun.intensity).toBe(p.sunIntensity)
    expect(l.hemi.color.getHex()).toBe(p.hemiSky)
    expect(l.hemi.groundColor.getHex()).toBe(p.hemiGround)
    expect(l.ambient.color.getHex()).toBe(p.ambientColor)
    expect(l.ambient.intensity).toBe(p.ambientIntensity)
  })

  it('方向性光的 position 是正規化過的光源方向', () => {
    const l = createLights()
    applyLightPalette(l, DAY_PALETTES.dawn)
    expect(l.sun.position.length()).toBeCloseTo(1, 9)
    expect(l.sun.position.y).toBeGreaterThan(0)
  })
})

describe('Ocean.setPalette', () => {
  /**
   * 【細浪面與遠海必須一起換】漏掉其中一個的症狀是 5 km 處一條看得見的
   * 色帶 —— 而兩個材質是分開建的，很容易只改到一個。
   */
  it('細浪面與遠海的本色一起換', () => {
    const ocean = createOcean(null)
    ocean.setPalette(DAY_PALETTES.night)
    const near = ocean.mesh.children[0] as Mesh
    const nearColor = (near.material as MeshStandardMaterial).color.getHex()
    const farColor = ((ocean.farMesh as Mesh).material as MeshStandardMaterial).color.getHex()
    expect(nearColor).toBe(DAY_PALETTES.night.seaColor)
    expect(farColor).toBe(DAY_PALETTES.night.seaColor)
    ocean.dispose()
  })

  /**
   * 【海面反射的天空必須跟著換】漏掉其中一個 uniform 的症狀是**黃昏的海
   * 反射著中午的天** —— 看得出來，但不會有任何東西報錯。這六個在 headless
   * 讀不到材質上的 uniform，所以走 `Ocean.paletteUniforms`。
   */
  it('六個著色器 uniform 全部跟著 palette 走', () => {
    const ocean = createOcean(null)
    const p = DAY_PALETTES.dusk
    ocean.setPalette(p)
    const u = ocean.paletteUniforms
    expect(u.uSkyHorizon.value.getHex()).toBe(p.skyHorizon)
    expect(u.uSkyZenith.value.getHex()).toBe(p.skyZenith)
    expect(u.uSkyPower.value).toBe(p.skyPower)
    expect(u.uHorizonColor.value.getHex()).toBe(p.seaHorizon)
    expect(u.uSparkleStrength.value).toBeCloseTo(SPARKLE_STRENGTH * p.sparkle, 12)
    // 太陽方向是正規化過的 —— 海面的鏡面反射與三盞燈必須指向同一個地方
    expect(u.uSunDirection.value.length()).toBeCloseTo(1, 9)
    const sun = paletteSunDir(p, new Vector3())
    expect(u.uSunDirection.value.x).toBeCloseTo(sun.x, 12)
    expect(u.uSunDirection.value.y).toBeCloseTo(sun.y, 12)
    ocean.dispose()
  })

  it('換回正午時六個 uniform 都回到原本的常數', () => {
    const ocean = createOcean(null)
    ocean.setPalette(DAY_PALETTES.night)
    ocean.setPalette(DAY_PALETTES.noon)
    const u = ocean.paletteUniforms
    expect(u.uSkyHorizon.value.getHex()).toBe(SKY_HORIZON)
    expect(u.uSkyZenith.value.getHex()).toBe(SKY_ZENITH)
    expect(u.uSkyPower.value).toBe(SKY_GRADIENT_POWER)
    expect(u.uHorizonColor.value.getHex()).toBe(SEA_HORIZON_COLOR)
    expect(u.uSparkleStrength.value).toBe(SPARKLE_STRENGTH)
    ocean.dispose()
  })

  it('換回正午等於原本的 SEA_COLOR', () => {
    const ocean = createOcean(null)
    ocean.setPalette(DAY_PALETTES.dusk)
    ocean.setPalette(DAY_PALETTES.noon)
    const far = ((ocean.farMesh as Mesh).material as MeshStandardMaterial).color.getHex()
    expect(far).toBe(SEA_COLOR)
    ocean.dispose()
  })
})

describe('applyTimeOfDay', () => {
  /**
   * 【它存在的唯一理由：不會漏掉海】天空那一半在 `SceneContext`、海那一半在
   * `Terrain`，兩者沒有共同的擁有者。呼叫端各叫各的話，漏掉海的症狀是
   * 「黃昏的天配中午的海」，而且不會有任何東西報錯。
   */
  it('場景與地形兩邊都收到同一個 palette', () => {
    const seen: DayPalette[] = []
    const ctx = { setPalette: (p: DayPalette) => seen.push(p) } as unknown as SceneContext
    const world: PaletteTarget = { setPalette: (p) => seen.push(p) }
    applyTimeOfDay(ctx, world, 'dusk')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(DAY_PALETTES.dusk)
    expect(seen[1]).toBe(DAY_PALETTES.dusk)
  })

  it('沒有地形時只換場景，不拋錯', () => {
    const seen: DayPalette[] = []
    const ctx = { setPalette: (p: DayPalette) => seen.push(p) } as unknown as SceneContext
    applyTimeOfDay(ctx, null, 'night')
    expect(seen).toEqual([DAY_PALETTES.night])
  })
})

describe('關卡的時段', () => {
  const cards = Object.values(MISSIONS).flat()
  const ready = cards.filter((c) => c.battle !== null)

  it('可出擊的關卡都有一個合法的時段（省略即正午）', () => {
    expect(ready.length).toBeGreaterThan(0)
    for (const c of ready) {
      const tod = c.battle!.timeOfDay
      if (tod !== undefined) expect(TIME_OF_DAY_IDS).toContain(tod)
    }
  })

  /**
   * 【倫內爾島非黃昏不可】卡片文案寫的是「在黃昏低空雷擊」。改成別的時段
   * 就與自己的簡報矛盾，而那只有人看得出來。
   */
  it('倫內爾島是黃昏', () => {
    const m4 = cards.find((c) => c.id === 'japan-m4')!
    expect(m4.battle!.timeOfDay).toBe('dusk')
    expect(m4.summary).toContain('黃昏')
  })

  it('遭遇戰的預設是正午', () => {
    expect(DEFAULT_SKIRMISH.timeOfDay).toBe<TimeOfDay>('noon')
  })
})
