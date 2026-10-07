import { describe, it, expect } from 'vitest'
import { groundGunTier, gunSound, impactSound } from '../../src/audio/catalog'
import { INFANTRY_ROUNDS_PER_SECOND } from '../../src/render/groundBattle'
import { SHIP_AA_TIERS } from '../../src/world/shipAA'

/**
 * 【每一層砲要分得出來】五吋砲、40 mm、20 mm 的射速差 24 倍，
 * 聲音一樣的話聽起來就是一片砲火，分不出船上發生什麼事。
 */
describe('艦砲各層的聲音', () => {
  it('每一層都有定義', () => {
    for (const tier of SHIP_AA_TIERS) expect(gunSound(tier).gap, tier).toBeGreaterThan(0)
  })

  /** 口徑越小越短越脆、越小聲，而且限頻率限得越緊 */
  it('口徑越小音高越高、越小聲、限得越緊', () => {
    const flak = gunSound('flak'), auto = gunSound('autocannon'), mg = gunSound('mg')
    expect(flak.rate).toBeLessThan(auto.rate)
    expect(auto.rate).toBeLessThan(mg.rate)
    expect(flak.gainDb).toBeGreaterThan(auto.gainDb)
    expect(auto.gainDb).toBeGreaterThan(mg.gainDb)
    expect(mg.gap).toBeLessThan(flak.gap)
  })

  it('沒定義的層走預設，不是沒聲音', () => {
    expect(gunSound('what').gap).toBeGreaterThan(0)
  })
})

/**
 * 【地面戰的砲共用五吋砲的庫，只改音高與音量】戰車砲與反坦克砲（75～88 mm）介於五吋砲
 * 與 40 mm 機砲之間：比五吋砲高、小聲，比 40 mm 低、大聲。
 */
describe('地面戰的砲聲', () => {
  it('戰車、反坦克砲、步兵、迫擊砲各歸一層，卡車、重高砲不走這條路', () => {
    for (const id of ['tank', 'tankDug', 'panzer4', 'tiger', 'usTank']) expect(groundGunTier(id), id).toBe('tankGun')
    expect(groundGunTier('atGun')).toBe('atGun')
    expect(groundGunTier('infantry')).toBe('infantry')
    expect(groundGunTier('mortar')).toBe('mortar')
    for (const id of ['truck', 'flakHeavy', 'constructor']) expect(groundGunTier(id), id).toBeNull()
  })

  it('這四層都有自己的定義，不是走預設', () => {
    const fallback = gunSound('no-such-tier')
    for (const tier of ['tankGun', 'atGun', 'infantry', 'mortar']) expect(gunSound(tier), tier).not.toEqual(fallback)
  })

  it('音高與音量介於五吋砲與 40 mm 機砲之間', () => {
    const flak = gunSound('flak'), auto = gunSound('autocannon')
    for (const tier of ['tankGun', 'atGun']) {
      const g = gunSound(tier)
      expect(g.rate, tier).toBeGreaterThan(flak.rate)
      expect(g.rate, tier).toBeLessThan(auto.rate)
      expect(g.gainDb, tier).toBeLessThan(flak.gainDb)
      expect(g.gainDb, tier).toBeGreaterThan(auto.gainDb)
      expect(g.gap, tier).toBeGreaterThan(0)
    }
  })

  it('反坦克砲比戰車砲乾脆：音高不低於戰車砲、音色上限不低於戰車砲', () => {
    const tank = gunSound('tankGun'), at = gunSound('atGun')
    expect(at.rate).toBeGreaterThanOrEqual(tank.rate)
    expect(at.cutoffHz).toBeGreaterThanOrEqual(tank.cutoffHz)
  })

  /** 步兵的槍是五吋砲拉到最高、最小聲的那一端：比 20 mm 機砲還高、還小聲 */
  it('步兵槍聲比 20 mm 機砲音高更高、更小聲', () => {
    const inf = gunSound('infantry'), mg = gunSound('mg')
    expect(inf.rate).toBeGreaterThanOrEqual(mg.rate)
    expect(inf.gainDb).toBeLessThanOrEqual(mg.gainDb)
    expect(inf.gap).toBeGreaterThan(0)
  })

  /** 一串裡每一發相隔 1 / 射速：限頻率的 `gap` 不比它短，一串的槍聲會被吃掉一半 */
  it('步兵的限頻率比連發的間隔短：一串裡每一發都響得出來', () => {
    expect(gunSound('infantry').gap).toBeLessThan(1 / INFANTRY_ROUNDS_PER_SECOND)
  })

  /** 迫擊砲發射是管口悶悶的一聲：音高不高於戰車砲、音色上限壓低 */
  it('迫擊砲發射聲比戰車砲悶：音高不高、音色上限更低', () => {
    const mortar = gunSound('mortar'), tank = gunSound('tankGun')
    expect(mortar.rate).toBeLessThanOrEqual(tank.rate)
    expect(mortar.cutoffHz).toBeLessThan(tank.cutoffHz)
    expect(mortar.gap).toBeGreaterThan(0)
  })
})

import { MATERIAL } from '../../src/world/material'

/**
 * 【查不到材質要有預設】新目標忘了定材質、或材質加了而表沒跟上時，
 * 整個沒聲音是最難查的壞法 —— 不報錯、不當掉，只是那個東西打起來悶不吭聲。
 */
describe('撞擊材質', () => {
  it('每一種材質都有定義', () => {
    for (const [name, m] of Object.entries(MATERIAL)) {
      expect(impactSound(m).pool, name).toBeTruthy()
    }
  })

  /**
   * 【鋼板與地面是兩種聲音】船是金屬悶響、地面是撞擊加碎屑。
   *
   * 【悶響靠低通】降音高會把每一下拉長，連續掃射時疊成一片轟隆；低通只切掉
   * 高頻的殘響，長度與節奏維持原樣。
   */
  it('船用命中庫且只留低頻，地面目標用碎屑庫', () => {
    expect(impactSound(MATERIAL.ship).pool).toBe('hit')
    expect(impactSound(MATERIAL.ship).cutoffHz).toBeLessThan(1000)
    expect(impactSound(MATERIAL.ship).cutoffHz)
      .toBeLessThan(impactSound(MATERIAL.ground).cutoffHz)
    expect(impactSound(MATERIAL.ground).pool).toBe('debris')
  })

  /** 【預設跟著地面走】沒定材質的東西多半不是鋼板 */
  it('沒定義的材質走預設，不是沒聲音', () => {
    for (const bad of [99, -1, 1.5, NaN]) {
      expect(impactSound(bad).pool, String(bad)).toBe('debris')
      expect(impactSound(bad).rate, String(bad)).toBe(1)
    }
  })
})

import { existsSync, readFileSync } from 'node:fs'
import {
  ALL_FILES, CATEGORY, POOLS, TURRET_GAIN_FILES, engineFile, fireFile, ownTurretVolleyPools, sirenFile, turretFile,
  turretGainDb, volleyPool,
} from '../../src/audio/catalog'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { JU87 } from '../../src/specs/ju87'
import { voiceLoudnessDb } from '../../src/audio/curves'

const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as Record<string, unknown>

describe('音效目錄', () => {
  it('目錄用到的每個檔都在清單裡', () => {
    for (const f of ALL_FILES) expect(manifest[f], f).toBeDefined()
  })

  it('每個音效庫都不是空的', () => {
    for (const [k, v] of Object.entries(POOLS)) expect(v.length, k).toBeGreaterThan(0)
  })

  /** 【空爆要短】高射砲一秒炸四次，長尾巴的爆炸會把聲道佔滿 */
  it('空爆庫有三個，而且都比爆炸庫短', () => {
    expect(POOLS.flakBurst).toHaveLength(3)
    for (const f of POOLS.flakBurst) expect(manifest[f], f).toBeDefined()
  })

  it('每個機種都有引擎聲；有前射武器的才有開火聲', () => {
    for (const s of ALL_SPECS) {
      expect(manifest[engineFile(s.id)], s.id).toBeDefined()
      const f = fireFile(s.id)
      if (s.battery.mounts.length > 0) expect(manifest[f!], s.id).toBeDefined()
      else expect(f, s.id).toBeNull()
    }
  })

  /** Jumo 211 單發：專屬的低沉引擎聲。He 111 那一份是雙發錄的，帶兩層錯開的拍頻 */
  it('Ju 87 有自己的引擎聲：循環檔、有包絡、檔案在 public/audio、在載入清單裡', () => {
    expect(engineFile('ju87')).toBe('engine-ju87')
    const e = manifest['engine-ju87'] as { loop: boolean; envelopeDb?: number[] } | undefined
    expect(e?.loop).toBe(true)
    expect(e?.envelopeDb?.length).toBeGreaterThan(10)
    expect(existsSync('public/audio/engine-ju87.mp3')).toBe(true)
    expect(ALL_FILES).toContain('engine-ju87')
  })

  /**
   * Ju 87 的前機槍是兩挺翼內 MG 17（1,150 發/分），後座是單管 MG 15（1,050 發/分）。
   * 前機槍：別人看到它開火是自己的循環（兩挺左右擺開），自己駕駛是齊射庫；後座用單管 MG 15 的砲塔檔。
   */
  it('Ju 87 的前機槍有專屬的開火聲與齊射庫，後座 MG 15 用單管砲塔檔', () => {
    expect(fireFile('ju87')).toBe('fire-ju87')
    expect(volleyPool('mg17', 2)).toBe('volley-mg17x2')
    expect(POOLS['volley-mg17x2']).toHaveLength(3)
    for (const f of ['fire-ju87', ...POOLS['volley-mg17x2']]) expect(manifest[f], f).toBeDefined()
    expect((manifest['fire-ju87'] as { loop: boolean }).loop).toBe(true)
    for (const f of POOLS['volley-mg17x2']) expect((manifest[f] as { loop: boolean }).loop, f).toBe(false)
    const rear = JU87.turrets.map((t) => turretFile(t.weapon.id, t.guns))
    expect(rear).toEqual(['turret-mg15x1'])
  })

  /**
   * 自己駕駛 Ju 87 時，後座的單管 MG 15 與前機槍走同一個機制：每發一個齊射 one-shot（`fireSelf`，
   * 不定位、不吃 HDR、聲道充裕，所以連發的聲音可以重疊、停火就停）。
   */
  it('Ju 87 後座的 MG 15 有齊射庫：單聲道、非循環、檔案都在清單裡', () => {
    const t = JU87.turrets[0]!
    expect(volleyPool(t.weapon.id, t.guns)).toBe('volley-mg15x1')
    expect(POOLS['volley-mg15x1']).toHaveLength(3)
    for (const f of POOLS['volley-mg15x1']) {
      expect(manifest[f], f).toBeDefined()
      expect((manifest[f] as { loop: boolean }).loop, f).toBe(false)
      expect(existsSync(`public/audio/${f}.mp3`), f).toBe(true)
    }
  })

  /**
   * 【每一座砲塔都有齊射庫才整架改走齊射】只有一部分有的話（He 111 的機首與兩側是單管 MG 15，背部是
   * MG 131、腹部是雙聯 MG 15），沒有庫的那幾座自己駕駛時會整個沒聲音 —— 不報錯。所以那種機種維持砲塔循環。
   */
  it('自己駕駛時砲塔改走齊射庫的條件：每一座砲塔都有庫（現在只有 Ju 87）', () => {
    expect(ownTurretVolleyPools(JU87.turrets)).toEqual(['volley-mg15x1'])
    const switched = ALL_SPECS.filter((s) => ownTurretVolleyPools(s.turrets) !== null).map((s) => s.id)
    expect(switched).toEqual(['ju87'])
    expect(ownTurretVolleyPools([])).toBeNull()
  })

  /**
   * 俯衝警笛是 Ju 87 專屬：循環檔、有包絡（HDR 靠它）、檔案在 public/audio、在載入清單裡。
   * 其他機種沒有 —— `sirenFile` 就是「這架會不會響警笛」的唯一判斷。
   */
  it('只有 Ju 87 有俯衝警笛：循環檔、有包絡、檔案在 public/audio、在載入清單裡', () => {
    expect(sirenFile('ju87')).toBe('siren-ju87')
    const e = manifest['siren-ju87'] as { loop: boolean; envelopeDb?: number[] } | undefined
    expect(e?.loop).toBe(true)
    expect(e?.envelopeDb?.length).toBeGreaterThan(10)
    expect(existsSync('public/audio/siren-ju87.mp3')).toBe(true)
    expect(ALL_FILES).toContain('siren-ju87')
    const have = ALL_SPECS.filter((s) => sirenFile(s.id) !== null).map((s) => s.id)
    expect(have).toEqual(['ju87'])
    expect(sirenFile('__none__')).toBeNull()
  })

  /**
   * 【別人的警笛要在遠處聽得到】上帝視角停在地面時，鏡頭離俯衝的飛機常有一兩公里。
   * 同為全音量時，1 km 與 2 km 外的警笛要比同一架的引擎大 8 dB 以上，否則被引擎與槍炮蓋掉。
   */
  it('警笛的類別：自己的不定位、比引擎大 10 dB；別人的定位，1–2 km 外比引擎大 8 dB 以上、傳得比引擎遠', () => {
    expect(CATEGORY.sirenSelf.ref).toBe(0)
    expect(CATEGORY.sirenSelf.gainDb).toBe(CATEGORY.engineSelf.gainDb + 10)
    expect(CATEGORY.siren.ref).toBeGreaterThan(0)
    expect(CATEGORY.siren.max).toBeGreaterThan(CATEGORY.engine.max)
    const loud = (c: keyof typeof CATEGORY, d: number): number =>
      voiceLoudnessDb(CATEGORY[c].gainDb, CATEGORY[c].ref, d, CATEGORY[c].rolloff ?? 1)
    for (const d of [1000, 2000]) expect(loud('siren', d) - loud('engine', d), `${d} m`).toBeGreaterThanOrEqual(8)
  })

  it('借用別台引擎聲的只剩 Yak-1B（借 Bf 109 K-4）', () => {
    for (const s of ALL_SPECS) {
      if (s.id === 'yak1b') expect(engineFile(s.id)).toBe('engine-bf109k4')
      else expect(engineFile(s.id), s.id).toBe(`engine-${s.id}`)
    }
    expect(engineFile('yak1b')).toBe('engine-bf109k4')
  })

  it('每種轟炸機砲塔都對得到檔案', () => {
    for (const s of ALL_SPECS) {
      for (const t of s.turrets) expect(manifest[turretFile(t.weapon.id, t.guns)], `${s.id} ${t.id}`).toBeDefined()
    }
  })

  /**
   * 【各砲塔聽起來一樣大】七個檔的 LUFS 都在 −16.4 上下，但九二式 7.7 mm 的中高頻多、
   * A 加權比其他砲塔大 3 dB 以上；九九式 20 mm 的能量在低頻，聽起來偏小。
   */
  it('砲塔音量修正：九二式 −3 dB、九九式 +1 dB，其他不修正', () => {
    expect(turretGainDb('turret-type92x1')).toBe(-3)
    expect(turretGainDb('turret-type99-1x1')).toBe(1)
    for (const id of ['turret-m2-50calx1', 'turret-m2-50calx2', 'turret-mg131x1', 'turret-mg15x1', 'turret-mg15x2']) {
      expect(turretGainDb(id), id).toBe(0)
    }
  })

  /** 【表裡的檔名打錯不會報錯】只會讓那一座的修正靜悄悄地不生效 */
  it('砲塔音量修正表裡的每一個檔都是遊戲用得到的砲塔檔', () => {
    const used = new Set(ALL_SPECS.flatMap((s) => s.turrets.map((t) => turretFile(t.weapon.id, t.guns))))
    for (const id of TURRET_GAIN_FILES) expect(used.has(id), id).toBe(true)
  })
})
