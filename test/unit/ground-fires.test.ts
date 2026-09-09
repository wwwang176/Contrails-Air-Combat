import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { FIRE_SECONDS } from '../../src/render/shipFires'
import {
  GROUND_FIRE_CAPACITY, createGroundFires, lightGroundFire, lightGroundFires, stepGroundFires,
} from '../../src/render/groundFires'
import { createImpacts, pushImpact } from '../../src/world/events'
import { LOADOUT_BY_AIRCRAFT } from '../../src/weapons/stores'

/**
 * # 地面的火
 *
 * 落在陸地上的炸彈、炸毀的建築，在原地掛一根煙柱。純裝飾 —— 不扣血、
 * 不進判定。
 *
 * 【這一支守的是什麼】落地的炸彈**沒有**留下火點不會報錯：畫面上只是少一
 * 根煙。所以事件到火點這一段要有斷言，而且接線那一行也要在 `main.ts` 裡。
 */

const DT = 1 / 60

function collector(): { at: Vector3[]; emit: (x: number, y: number, z: number) => void } {
  const at: Vector3[] = []
  return { at, emit: (x, y, z) => { at.push(new Vector3(x, y, z)) } }
}

describe('lightGroundFires', () => {
  /**
   * 【只有落在陸地的那一筆起火】`nx` 是落點的種類：0 = 陸、1 = 水、2 = 船、
   * 3 = 建築。水上留不下火；船上的火由 `lightShipFires` 管（存艦體座標）；
   * 建築的火在它被炸毀時由擊毀事件點，沒炸毀的那一顆只有爆炸。
   */
  it('nx = 0 起火，1／2／3 不起火', () => {
    const fires = createGroundFires()
    const ev = createImpacts()
    pushImpact(ev, 100, 12, -7000, 0, 11_700, -1)
    pushImpact(ev, 400, 0, 0, 1, 11_700, -1)
    pushImpact(ev, 10, 5, -20, 2, 11_700, 0)
    pushImpact(ev, 50, 18, -7100, 3, 11_700, 4)
    lightGroundFires(fires, ev)
    let live = 0
    for (let i = 0; i < fires.capacity; i++) live += fires.live[i]!
    expect(live).toBe(1)
  })

  /** 【火點就在落點】事件的 y 已經是地面高度，不抬不壓。 */
  it('火點在落點的世界座標上，燒 FIRE_SECONDS', () => {
    const fires = createGroundFires()
    const ev = createImpacts()
    pushImpact(ev, 100, 12, -7000, 0, 11_700, -1)
    lightGroundFires(fires, ev)

    const a = collector()
    stepGroundFires(fires, DT, a.emit)
    expect(a.at.length).toBe(1)
    expect(a.at[0]!.x).toBeCloseTo(100, 3)
    expect(a.at[0]!.y).toBeCloseTo(12, 3)
    expect(a.at[0]!.z).toBeCloseTo(-7000, 3)

    const b = collector()
    for (let i = 0; i < FIRE_SECONDS / DT + 2; i++) stepGroundFires(fires, DT, b.emit)
    expect(fires.live[0]).toBe(0)
  })

  /**
   * 【一個火期內的火點要裝得下】四架 B-17 在 `FIRE_SECONDS` 內落下的炸彈
   * 全部還在燒，加上廠區與砲位全炸掉的 20 座。彈艙空了會自動補彈，所以
   * 一架不只一艙：上界是艙數 × ⌈火期 ÷ 補彈秒數⌉（投放本身還要時間，
   * 實際只會更少）。容量比它小的話**建築的火會被後落的炸彈頂掉**，而那
   * 不報錯。
   *
   * 【滿了覆寫最舊的】理由同船火：純裝飾，掉一個沒有人看得出來。
   */
  it('容量裝得下一個火期的炸彈加建築；超過就覆寫最舊的', () => {
    const bay = LOADOUT_BY_AIRCRAFT.b17g!
    const perAircraft = bay.count * Math.ceil(FIRE_SECONDS / bay.reloadSeconds)
    expect(GROUND_FIRE_CAPACITY).toBeGreaterThanOrEqual(4 * perAircraft + 20)
    const fires = createGroundFires()
    for (let i = 0; i < fires.capacity + 1; i++) lightGroundFire(fires, i, 0, 0)
    const xs = Array.from(fires.x)
    expect(xs).toContain(fires.capacity)
    expect(xs).not.toContain(0)
  })
})

describe('main.ts 的接線', () => {
  // 【用 import.meta.glob 而不是 fs】專案沒有 `@types/node`
  const SOURCES = import.meta.glob('../../src/main.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const MAIN = Object.values(SOURCES)[0]!

  /**
   * 【要排在排空之前】`bombEvents` 在同一個物理子步裡被清掉；接在清空之後
   * 讀到的永遠是 0 筆，火點永遠不點而且不報錯。
   */
  it('炸彈事件在排空之前餵給 lightGroundFires', () => {
    const light = MAIN.indexOf('lightGroundFires(groundFires, world.bombEvents)')
    const clear = MAIN.indexOf('clearImpacts(world.bombEvents)')
    expect(light).toBeGreaterThan(0)
    expect(clear).toBeGreaterThan(light)
  })
})
