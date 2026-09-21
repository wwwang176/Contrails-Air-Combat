import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import {
  FLAK_SHAKE as CAMERA_FLAK_SHAKE, GROUND_KILL_SHAKE, GUN_LOST_SHAKE, KILL_SHAKE,
  HUD_SHAKE_FREQUENCY, HUD_SHAKE_MAX_ANGLE, HUD_SHAKE_MAX_SHIFT,
  SHAKE_FREQUENCY, SHAKE_MAX_ANGLE, SHAKE_RANGE, SHAKE_SECONDS,
  addShake, applyCameraShake, createCameraShake, hudShakeAngle, hudShakeShiftX,
  hudShakeShiftY, ordnanceShakeScale, shakeNoise, stepCameraShake,
} from '../../src/camera/cameraShake'
import { blastScaleOf } from '../../src/weapons/bomb'
import { A6M5_BOMB_LOADOUT, LOADOUT_BY_AIRCRAFT } from '../../src/weapons/stores'
import { FLAK_RADIUS, FLAK_SHAKE, FLAK_SMOKE } from '../../src/world/flak'
import { GROUND_FLAK_SPEC, SHIP_GUN_SPECS } from '../../src/world/shipGuns'

/** 【用 import.meta.glob 而不是 fs】與這個檔案裡「main.ts 的接線」同一個做法 */
const CONSUMERS = import.meta.glob(
  ['../../src/main.ts', '../../src/render/flakBursts.ts', '../../src/render/blast.ts',
    '../../src/hud/Hud.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>
const srcOf = (name: string): string =>
  Object.entries(CONSUMERS).find(([k]) => k.endsWith(name))![1]

/**
 * # 爆炸的鏡頭震動
 *
 * 純表現：不進判定、不影響飛行。相機每一幀由 `CameraRig` 重算，震動是疊在
 * 那之後的一個角度偏移 —— 所以它**不會累積**回相機的狀態。
 *
 * 【這一支守的是什麼】三件靜靜壞掉的事：震動變成逐幀亂跳的白噪音（看起來
 * 像掉幀而不是震動）、平均值不為零把視線永久拉歪、以及火焰那一串每 0.3 秒
 * 的小爆炸也去搖鏡頭（畫面會整場抖個不停）。
 */

const DT = 1 / 60
const ORIGIN = new Vector3(0, 0, 0)

/** 疊上震動之後，相機轉了多少角度（弧度）。基準姿態是單位四元數 */
function shakenAngle(trauma: number, phase: number): number {
  const shake = createCameraShake()
  shake.trauma = trauma
  shake.phase = phase
  const cam = new PerspectiveCamera(65, 16 / 9, 1, 60000)
  applyCameraShake(shake, cam)
  return 2 * Math.acos(Math.min(1, Math.abs(cam.quaternion.w)))
}

describe('addShake：依距離加震動', () => {
  it('爆心給滿，範圍邊界給 0，範圍外完全不加', () => {
    const a = createCameraShake()
    addShake(a, 0, 0, 0, 1, ORIGIN)
    expect(a.trauma).toBeCloseTo(1, 6)

    const b = createCameraShake()
    addShake(b, SHAKE_RANGE, 0, 0, 1, ORIGIN)
    expect(b.trauma).toBeCloseTo(0, 6)

    const c = createCameraShake()
    addShake(c, SHAKE_RANGE * 2, 0, 0, 1, ORIGIN)
    expect(c.trauma).toBe(0)
  })

  /** 【三個軸都要量】只算水平距離的話，正下方 300 m 的爆炸會震得像貼臉 */
  it('距離是三維的，不是水平距離', () => {
    const a = createCameraShake()
    addShake(a, 0, SHAKE_RANGE * 0.5, 0, 1, ORIGIN)
    expect(a.trauma).toBeCloseTo(0.5, 6)
  })

  /**
   * 【範圍隨當量放大】尺度是爆炸相似律的線性倍率（1.0 = 500 lb 炸彈），
   * 與 `scaleBlast` 吃的同一個。少了這一項的話魚雷與高砲搖起來一樣遠。
   */
  it('尺度放大作用範圍', () => {
    const far = SHAKE_RANGE * 1.5
    const small = createCameraShake()
    addShake(small, far, 0, 0, 1, ORIGIN)
    expect(small.trauma).toBe(0)

    const big = createCameraShake()
    addShake(big, far, 0, 0, 2, ORIGIN)
    expect(big.trauma).toBeGreaterThan(0)
  })

  /**
   * 【小當量的爆炸貼臉也只加它自己的份量】只用尺度縮短範圍的話，一發 3 kg
   * 裝藥的高砲彈在爆心與一顆 227 kg 的炸彈搖得一樣重。防空火網下每秒好幾
   * 發近爆，每一發都把 trauma 頂回滿格 —— 畫面整段航程都在劇烈晃動。
   */
  it('峰值跟著當量走，不是一律給滿', () => {
    const s = createCameraShake()
    addShake(s, 0, 0, 0, FLAK_SHAKE, ORIGIN)
    expect(s.trauma).toBeCloseTo(FLAK_SHAKE, 6)

    const big = createCameraShake()
    addShake(big, 0, 0, 0, 3, ORIGIN)
    expect(big.trauma).toBe(1)
  })

  /**
   * 【同時好幾發取最大值，不疊加】疊加的話一串連投的炸彈或一片防空火網會
   * 把 trauma 推到滿格並停在那裡 —— 畫面上分不出「近處一顆」與「遠處
   * 十顆」。震動的大小恆等於最近最猛的那一發。
   *
   * 【先大後小那一組是重點】只寫「小的加不上去」的話，`+=` 照樣通過前半段
   * 的第一次呼叫；要驗的是小的**不會把大的推高**。
   */
  it('同一幀多發取最大值，不疊加', () => {
    const s = createCameraShake()
    for (let i = 0; i < 5; i++) addShake(s, 0, 0, 0, FLAK_SHAKE, ORIGIN)
    expect(s.trauma).toBeCloseTo(FLAK_SHAKE, 6)

    const big = createCameraShake()
    addShake(big, 0, 0, 0, 1, ORIGIN)
    for (let i = 0; i < 5; i++) addShake(big, 0, 0, 0, FLAK_SHAKE, ORIGIN)
    expect(big.trauma).toBe(1)
  })

  /** 【遠處的一發蓋不掉近處的】取的是最大值，不是最後一發 */
  it('後來的遠處爆炸不會把震動壓下去', () => {
    const s = createCameraShake()
    addShake(s, 0, 0, 0, 1, ORIGIN)
    addShake(s, SHAKE_RANGE * 0.9, 0, 0, 1, ORIGIN)
    expect(s.trauma).toBe(1)
  })

  it('相機不在原點也算得對', () => {
    const s = createCameraShake()
    const cam = new Vector3(1000, 200, -3000)
    addShake(s, 1000, 200 + SHAKE_RANGE * 0.25, -3000, 1, cam)
    expect(s.trauma).toBeCloseTo(0.75, 6)
  })
})

describe('stepCameraShake：衰減', () => {
  it('滿震動在 SHAKE_SECONDS 之後歸零', () => {
    const s = createCameraShake()
    addShake(s, 0, 0, 0, 1, ORIGIN)
    for (let i = 0; i < SHAKE_SECONDS / DT - 2; i++) stepCameraShake(s, DT)
    expect(s.trauma).toBeGreaterThan(0)
    for (let i = 0; i < 4; i++) stepCameraShake(s, DT)
    expect(s.trauma).toBe(0)
  })

  /**
   * 【相位不隨震動停止歸零】歸零的話每一次爆炸都從噪聲的同一點開始，
   * 連續兩次爆炸會晃出一模一樣的軌跡。
   */
  it('相位持續前進，震動停了也一樣', () => {
    const s = createCameraShake()
    for (let i = 0; i < 30; i++) stepCameraShake(s, DT)
    expect(s.phase).toBeCloseTo(30 * DT, 6)
  })

  it('reset 清空震動與相位', () => {
    const s = createCameraShake()
    addShake(s, 0, 0, 0, 1, ORIGIN)
    stepCameraShake(s, DT)
    s.reset()
    expect(s.trauma).toBe(0)
    expect(s.phase).toBe(0)
  })
})

describe('shakeNoise：平滑、有界、平均為零', () => {
  /**
   * 【連續性是這一條的重點】直接對每一幀取雜湊也會通過「有界」與「平均為
   * 零」，但畫面上那是白噪音 —— 相機每一幀跳到無關的角度，看起來像掉幀。
   * 取樣間隔取噪聲週期的百分之一，變化量必須遠小於整個振幅。
   */
  it('相鄰時刻的值連續', () => {
    let worst = 0
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.01
      worst = Math.max(worst, Math.abs(shakeNoise(1, t) - shakeNoise(1, t + 0.01)))
    }
    expect(worst).toBeLessThan(0.1)
  })

  it('值落在 −1…1 而且真的有變化', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 2000; i++) {
      const v = shakeNoise(1, i * 0.05)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    expect(lo).toBeGreaterThanOrEqual(-1)
    expect(hi).toBeLessThanOrEqual(1)
    expect(hi - lo).toBeGreaterThan(1)
  })

  /**
   * 【平均要接近 0】偏一邊的話震動會把視線往某個方向推著走，而震動一停
   * 鏡頭又彈回來 —— 那不是震動，是甩鏡。
   */
  it('長時間平均接近 0', () => {
    let sum = 0
    const n = 20_000
    for (let i = 0; i < n; i++) sum += shakeNoise(1, i * 0.037)
    expect(Math.abs(sum / n)).toBeLessThan(0.05)
  })

  /** 【三個軸互不相同】共用一組值的話三個軸同步，晃出來是一條斜線 */
  it('不同軸的值不同', () => {
    let same = 0
    for (let i = 0; i < 200; i++) {
      const t = i * 0.19
      if (Math.abs(shakeNoise(1, t) - shakeNoise(2, t)) < 1e-9) same++
    }
    expect(same).toBe(0)
  })
})

describe('applyCameraShake：疊在相機姿態上', () => {
  it('沒有震動時姿態逐位元不動', () => {
    const s = createCameraShake()
    const cam = new PerspectiveCamera(65, 16 / 9, 1, 60000)
    const q = new Quaternion(0.1, 0.2, 0.3, 0.927).normalize()
    cam.quaternion.copy(q)
    applyCameraShake(s, cam)
    expect(cam.quaternion.x).toBe(q.x)
    expect(cam.quaternion.y).toBe(q.y)
    expect(cam.quaternion.z).toBe(q.z)
    expect(cam.quaternion.w).toBe(q.w)
  })

  /**
   * 【只轉不移】座艙視角下平移相機會穿出座艙罩，而機外視角下會把機身推出
   * 畫面。震動只給角度。
   */
  it('相機位置完全不動', () => {
    const s = createCameraShake()
    addShake(s, 0, 0, 0, 1, ORIGIN)
    const cam = new PerspectiveCamera(65, 16 / 9, 1, 60000)
    cam.position.set(10, 20, 30)
    applyCameraShake(s, cam)
    expect(cam.position.x).toBe(10)
    expect(cam.position.y).toBe(20)
    expect(cam.position.z).toBe(30)
  })

  /**
   * 【角度吃 trauma 的平方】遠處的爆炸只該給一下輕微的抖動。線性的話
   * trauma 0.3 就有三成的振幅，整場都在晃。
   */
  it('角度隨 trauma 的平方成長，且不超過上限', () => {
    // 相位取一個噪聲接近滿幅的點，比的是同一個相位下的兩個 trauma
    const phase = 3.21
    const full = shakenAngle(1, phase)
    const half = shakenAngle(0.5, phase)
    expect(full).toBeGreaterThan(0)
    expect(half / full).toBeCloseTo(0.25, 2)

    let worst = 0
    for (let i = 0; i < 4000; i++) worst = Math.max(worst, shakenAngle(1, i * 0.011))
    // 三個軸各自不超過 SHAKE_MAX_ANGLE，合成之後的上界是它們的和
    expect(worst).toBeLessThanOrEqual(SHAKE_MAX_ANGLE * (2 + 1) * 1.001)
    // 真的搖得到看得見的幅度：滿震動至少要到單軸上限的一半
    expect(worst).toBeGreaterThan(SHAKE_MAX_ANGLE * 0.5)
  })

  /** 【一秒晃好幾下】頻率太低的話那是鏡頭在飄，不是爆炸 */
  it('震動頻率至少每秒數次', () => {
    expect(SHAKE_FREQUENCY).toBeGreaterThanOrEqual(5)
  })
})

describe('main.ts 的接線', () => {
  // 【用 import.meta.glob 而不是 fs】專案沒有 `@types/node`
  const SOURCES = import.meta.glob('../../src/main.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const MAIN = Object.values(SOURCES)[0]!

  /** 取出某個函數的函數體（到第一個頂層 `\n}` 為止）。 */
  function bodyOf(name: string): string {
    const from = MAIN.indexOf(`function ${name}(`)
    if (from < 0) throw new Error(`main.ts 裡找不到 ${name}() —— 這條測試的錨點過期了`)
    const to = MAIN.indexOf('\n}', from)
    if (to < 0) throw new Error(`${name}() 的結尾找不到`)
    return MAIN.slice(from, to)
  }

  for (const fn of ['emitKillBlasts', 'emitGroundKills', 'emitBombBlasts', 'emitTorpedoBlasts']) {
    it(`${fn} 會搖鏡頭`, () => {
      expect(bodyOf(fn)).toContain('addShake(')
    })
  }

  /** 高砲的引爆走 `burstEvents`，配方在 `blast.ts` 裡放，震動在 main 這一層加 */
  it('高砲引爆會搖鏡頭', () => {
    expect(bodyOf('shakeFlakBursts')).toContain('addShake(')
  })

  /**
   * 【砲位被打掉也是一次性爆炸】它不走事件流，走的是 `shipModels.update`
   * 的回呼，所以上面那一圈函數名的列舉抓不到它。
   */
  it('艦上砲位被打掉會搖鏡頭', () => {
    const from = MAIN.indexOf('shipModels?.update(world.ships,')
    expect(from).toBeGreaterThan(0)
    const to = MAIN.indexOf('\n  })', from)
    expect(MAIN.slice(from, to)).toContain('addShake(')
  })

  /**
   * 【火焰要排除】燒起來的船與建築每 0.3 秒放一朵小爆炸，燒 60 秒。跟著
   * 搖的話只要場上有一處在燒，畫面就整場抖個不停 —— 而那看起來像效能問題，
   * 不像缺陷。
   */
  it('火焰的迷你爆炸不搖鏡頭', () => {
    // `emitFirePuff` 是一行的 `createFirePuff(...)`；只看那一行，不切到
    // 下一個 `}` —— 那會把後面整支別的函式掃進來
    const from = MAIN.indexOf('const emitFirePuff')
    expect(from).toBeGreaterThan(0)
    const to = MAIN.indexOf('\n', from)
    expect(MAIN.slice(from, to)).not.toContain('addShake')
  })

  /**
   * 【一定要排在相機算完之後】`rig.update` 與 `applyBlend` 每一幀從頭寫
   * 相機姿態，排在它們之前的震動會被整個蓋掉，而畫面上只是「沒有震動」。
   * 也一定要在 `renderer.render` 之前。
   */
  it('震動疊在 applyBlend 之後、渲染之前', () => {
    const blend = MAIN.indexOf('applyBlend(godBlend')
    const apply = MAIN.indexOf('applyCameraShake(cameraShake')
    const render = MAIN.indexOf('ctx.renderer.render(ctx.scene, ctx.camera)')
    expect(blend).toBeGreaterThan(0)
    expect(apply).toBeGreaterThan(blend)
    expect(render).toBeGreaterThan(apply)
  })

  it('每幀推進衰減', () => {
    expect(MAIN).toContain('stepCameraShake(cameraShake,')
  })
})

describe('各種爆炸的當量尺度', () => {
  /**
   * 【高砲要明顯小於炸彈】5 吋砲彈的裝藥約 3 kg，AN-M64 是 227 kg ——
   * 立方根律下差四倍。一樣大的話一場防空火網會把畫面搖爛。
   */
  it('高砲 < 砲位 < 地面目標 ≤ 擊墜', () => {
    expect(FLAK_SHAKE).toBeLessThan(GUN_LOST_SHAKE)
    expect(GUN_LOST_SHAKE).toBeLessThan(GROUND_KILL_SHAKE)
    expect(GROUND_KILL_SHAKE).toBeLessThanOrEqual(KILL_SHAKE)
    expect(FLAK_SHAKE * SHAKE_RANGE).toBeLessThan(200)
  })

  /**
   * 【防空火網下不能一直大震】艦隊有 12 個砲區、每區 20 rpm，玩家在最前面
   * 時多區會同時瞄他，約每秒 3.7 發引爆 —— 也就是每一幀都有近爆把 trauma
   * 重新頂到 `FLAK_SHAKE`。取最大值之後那就是彈幕下的穩態，角度必須小到
   * 只是細微的抖動。
   */
  it('高砲彈幕下的穩態震動小於單軸上限的十分之一', () => {
    const steady = SHAKE_MAX_ANGLE * FLAK_SHAKE * FLAK_SHAKE
    expect(steady).toBeLessThan(SHAKE_MAX_ANGLE * 0.1)
  })
})

/**
 * # 黑雲的三個表現尺度是三個獨立的旋鈕
 *
 * 一朵雲有四個數字：殺傷半徑（傷害）、黑煙大小、閃光大小、震動。**它們互相
 * 獨立，也不從殺傷半徑推導** —— 雲小一號、搖一樣重、閃光大一點都是合法的
 * 選擇，綁成公式之後調任何一個都會動到另外三個。
 *
 * 兩份表：`SHIP_GUN_SPECS.flak`（5 吋艦砲）與 `GROUND_FLAK_SPEC`（陸上 88）。
 */
describe('高砲雲的表現尺度', () => {
  it('艦砲那一份與 flak.ts 的預設常數對齊', () => {
    const s = SHIP_GUN_SPECS.flak
    expect(s.burstRadius).toBe(FLAK_RADIUS)
    expect(s.burstSmoke).toBe(FLAK_SMOKE)
    expect(s.burstShake).toBe(FLAK_SHAKE)
    // 【相機層的那一份不得漂掉】兩處都寫著 0.25，改一邊忘一邊不會報錯
    expect(FLAK_SHAKE).toBe(CAMERA_FLAK_SHAKE)
  })

  /**
   * 【四格互相獨立】陸砲的殺傷半徑比艦砲大、爆心傷害比艦砲小、震動比艦砲重，
   * 而雲與閃光一樣大 —— 那個組合只有在四格各自是一格時才寫得出來。哪天有人
   * 把它們綁回同一個公式（例如 `burstSmoke = burstRadius / 3`），這一條會紅。
   */
  it('陸砲與艦砲的四格各自獨立', () => {
    const ground = GROUND_FLAK_SPEC
    const ship = SHIP_GUN_SPECS.flak
    expect(ground.burstRadius).not.toBe(ship.burstRadius)
    expect(ground.burstDamage).not.toBe(ship.burstDamage)
    expect(ground.burstShake).not.toBe(ship.burstShake)
    expect(ground.burstSmoke).toBe(ship.burstSmoke)
    expect(ground.burstBlast).toBe(ship.burstBlast)
    // 【雲比殺傷範圍小得多】75 m 的殺傷配 16.7 m 的雲 —— 看得見的那一團
    // 不等於危險範圍
    expect(ground.burstSmoke).toBeLessThan(ground.burstRadius)
  })

  /**
   * 【震動要看得見】角度吃 `trauma` 的平方，所以 0.25 在爆心只有 0.23 度 ——
   * 65 度視野、900 px 下是三個像素，等於沒有。陸砲的彈幕是這一關唯一告訴
   * 玩家「你正在挨打」的回饋。
   */
  it('陸砲在爆心的震動角度看得見', () => {
    const deg = (SHAKE_MAX_ANGLE * GROUND_FLAK_SPEC.burstShake ** 2 * 180) / Math.PI
    const px = deg * (900 / 65)
    expect(px, `爆心只有 ${px.toFixed(1)} px`).toBeGreaterThan(8)
  })

  /** 【三個消費端都要讀逐發的那一格】寫死常數的話這一條會紅 */
  it('震動、黑煙、閃光都讀那一發自己帶的尺度', () => {
    expect(srcOf('main.ts'), '震動').toContain('events.shake[e]!')
    expect(srcOf('flakBursts.ts'), '黑煙').toContain('events.smoke[e]!')
    expect(srcOf('blast.ts'), '閃光').toContain('events.blast[e]!')
  })
})

/**
 * 投下來的炸彈與魚雷的震動尺度。
 *
 * 【小當量要放大】A6M5 的 60 kg 彈尺度 0.11：照原值搖，範圍 55 m、爆心峰值
 * 0.11，角度吃平方只剩 0.05°，飛離爆點一點就完全不搖。
 */
describe('ordnanceShakeScale：炸彈與魚雷的震動尺度', () => {
  it('小當量非線性放大，而且保持單調', () => {
    const a6m = blastScaleOf(A6M5_BOMB_LOADOUT.damage)
    expect(ordnanceShakeScale(a6m)).toBeGreaterThan(a6m * 3)
    expect(ordnanceShakeScale(0.1)).toBeLessThan(ordnanceShakeScale(0.5))
    expect(ordnanceShakeScale(0.5)).toBeLessThan(ordnanceShakeScale(0.9))
  })

  it('基準彈以上不變：B-17、He 111 與魚雷搖得和以前一樣', () => {
    expect(ordnanceShakeScale(1)).toBe(1)
    for (const id of ['b17g', 'he111', 'g4m']) {
      const s = blastScaleOf(LOADOUT_BY_AIRCRAFT[id]!.damage)
      expect(ordnanceShakeScale(s), id).toBe(s)
    }
  })

  it('沒有當量就不搖', () => {
    expect(ordnanceShakeScale(0)).toBe(0)
  })

  /** 【炸彈與魚雷兩個消費端都要經過它】只接一個的話另一種照舊搖不動 */
  it('main.ts 的炸彈與魚雷爆炸都經過它，高砲不經過', () => {
    const main = srcOf('main.ts')
    expect(main).toContain('ordnanceShakeScale(')
    const bombs = main.slice(main.indexOf('function emitBombBlasts'), main.indexOf('const emitFirePuff'))
    expect(bombs).toContain('ordnanceShakeScale(')
    const torpedoes = main.slice(main.indexOf('function emitTorpedoBlasts'), main.indexOf('function shakeFlakBursts'))
    expect(torpedoes).toContain('ordnanceShakeScale(')
    const flak = main.slice(main.indexOf('function shakeFlakBursts'))
    expect(flak.slice(0, flak.indexOf('\n}\n'))).not.toContain('ordnanceShakeScale')
  })
})

/**
 * # HUD 跟著搖
 *
 * HUD 是釘在座艙上的一層玻璃。鏡頭震而它紋風不動的話，畫面讀起來像世界在抖
 * 而儀表浮在外面。
 *
 * 【這一支守的是什麼】三件靜靜壞掉的事：HUD 與鏡頭同頻同相（看起來像 HUD
 * 黏死在世界上，等於沒有這個效果）、不震的時候角度不是零（HUD 永遠歪著）、
 * 以及幅度大到讀不出數字。
 */
describe('HUD 的搖晃', () => {
  it('不震的時候三個量恰好都是 0 —— 不是很小的數', () => {
    const s = createCameraShake()
    for (const f of [hudShakeAngle, hudShakeShiftX, hudShakeShiftY]) {
      expect(f(s)).toBe(0)
      s.phase = 3.7
      expect(f(s)).toBe(0)
    }
  })

  /**
   * 【位移是主角】轉 3° 時畫面中央幾乎不動，看得出來的只有角落；位移是整張
   * 一起平移，準星與數字都在動。兩個量各自有上限，但位移那一份要讀得出來。
   */
  it('位移在正負之間走滿，而且不超過上限', () => {
    const s = createCameraShake()
    s.trauma = 1
    for (const f of [hudShakeShiftX, hudShakeShiftY]) {
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k < 4000; k++) {
        s.phase = k * 0.01
        const v = f(s)
        if (v < lo) lo = v
        if (v > hi) hi = v
        expect(Math.abs(v)).toBeLessThanOrEqual(HUD_SHAKE_MAX_SHIFT)
      }
      expect(lo).toBeLessThan(-HUD_SHAKE_MAX_SHIFT * 0.5)
      expect(hi).toBeGreaterThan(HUD_SHAKE_MAX_SHIFT * 0.5)
    }
  })

  /** 【兩個軸不能同步】共用一組值的話位移走的是一條 45° 斜線，不是晃 */
  it('左右與上下互不相同', () => {
    const s = createCameraShake()
    s.trauma = 1
    let same = 0
    for (let k = 0; k < 500; k++) {
      s.phase = k * 0.019
      if (Math.abs(hudShakeShiftX(s) - hudShakeShiftY(s)) < 1e-12) same++
    }
    expect(same).toBe(0)
  })

  it('正負都有而且不超過上限', () => {
    const s = createCameraShake()
    s.trauma = 1
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < 4000; k++) {
      s.phase = k * 0.01
      const a = hudShakeAngle(s)
      if (a < lo) lo = a
      if (a > hi) hi = a
      expect(Math.abs(a)).toBeLessThanOrEqual(HUD_SHAKE_MAX_ANGLE)
    }
    expect(lo).toBeLessThan(0)
    expect(hi).toBeGreaterThan(0)
  })

  /**
   * 【平均值要接近 0】不為零的話一震起來 HUD 會整個偏到一邊，而那看起來
   * 像「HUD 裝歪了」不像震動 —— 與鏡頭那三軸同一條理由。
   */
  it('平均值接近 0', () => {
    const s = createCameraShake()
    s.trauma = 1
    let sum = 0
    const n = 20000
    // 【取樣間隔照上面 `shakeNoise` 那一條】噪聲時間裡走 0.037 一步。太細的
    // 話會與整數格點共振，量到的是取樣的偏差而不是噪聲的
    for (let k = 0; k < n; k++) {
      s.phase = (k * 0.037) / HUD_SHAKE_FREQUENCY
      sum += hudShakeAngle(s)
    }
    expect(Math.abs(sum / n)).toBeLessThan(HUD_SHAKE_MAX_ANGLE * 0.05)
  })

  /**
   * 【頻率要與鏡頭不同】同頻的話兩者一起動，HUD 看起來黏死在世界上。
   * 噪聲通道也不能與鏡頭的三軸（1、2、3）重覆 —— 共用會完全同步。
   */
  it('頻率與鏡頭不同，噪聲通道也不重覆', () => {
    expect(HUD_SHAKE_FREQUENCY).not.toBe(SHAKE_FREQUENCY)
    const s = createCameraShake()
    s.trauma = 1
    let same = 0
    for (let k = 0; k < 500; k++) {
      s.phase = k * 0.02
      const t = s.phase * SHAKE_FREQUENCY
      const cam = [shakeNoise(1, t), shakeNoise(2, t), shakeNoise(3, t)]
      const hud = hudShakeAngle(s) / (HUD_SHAKE_MAX_ANGLE * s.trauma * s.trauma)
      if (cam.some((c) => Math.abs(c - hud) < 1e-12)) same++
    }
    expect(same).toBe(0)
  })

  /** 【不超過鏡頭】HUD 比世界還晃的話，讀起來變成儀表自己在甩 */
  it('角度不超過鏡頭的角度上限', () => {
    expect(HUD_SHAKE_MAX_ANGLE).toBeLessThan(SHAKE_MAX_ANGLE)
  })

  /**
   * 【超速的持續搖晃也要帶到】只看 `trauma` 的話，超速時鏡頭在搖而 HUD 不動。
   * 與 `applyCameraShake` 取同一個最大值。
   */
  it('超速的持續震動也會讓 HUD 搖', () => {
    const s = createCameraShake()
    s.sustained = 1
    s.phase = 0.37
    expect(Math.abs(hudShakeAngle(s))).toBeGreaterThan(0)
    expect(Math.abs(hudShakeShiftX(s))).toBeGreaterThan(0)
    expect(Math.abs(hudShakeShiftY(s))).toBeGreaterThan(0)
  })

  /**
   * 【HUD 不用 canvas 的變換】儀表與盤面走離屏快取，貼回來時 `setTransform`
   * 成 identity —— 疊在 context 上的旋轉它們吃不到，畫面上會變成「除了儀表
   * 以外都在轉」。所以走的是元素的 CSS transform。
   */
  it('Hud.ts 用 CSS transform 轉與移，不用 ctx 的變換', () => {
    const hud = srcOf('Hud.ts')
    expect(hud).toContain('this.canvas.style.transform')
    expect(hud).toContain('translate(${(x * 100).toFixed(2)}%, ${(y * 100).toFixed(2)}%) rotate(${a}rad)')
    expect(hud).not.toContain('ctx.rotate(')
    expect(hud).not.toContain('ctx.translate(')
  })

  /**
   * 【要排在 `stepCameraShake` 之後】排在它之前的話 HUD 慢鏡頭一幀，
   * 兩者對不起來 —— 而畫面上只是「搖得怪怪的」。
   */
  it('main.ts 在推進震動之後才算 HUD 的角度', () => {
    const main = srcOf('main.ts')
    const step = main.indexOf('stepCameraShake(cameraShake')
    const hud = main.indexOf('hudFrame.shakeAngle = hudShakeAngle(cameraShake)')
    expect(step).toBeGreaterThan(0)
    expect(hud).toBeGreaterThan(step)
    expect(main.indexOf('hud.render(hudFrame')).toBeGreaterThan(hud)
    // 【三個量都要接上】只接角度的話位移永遠是 0，而那正是要的主要份量
    expect(main).toContain('hudFrame.shakeX = hudShakeShiftX(cameraShake)')
    expect(main).toContain('hudFrame.shakeY = hudShakeShiftY(cameraShake)')
  })
})


/**
 * 【滿版的遮罩畫在不震的那一張畫布上】投彈暗角與黑視是壓在世界上的滿版填充。
 * 跟著 HUD 震的話，畫布一移開，邊上就露出一道沒壓暗的世界 —— 而且**往外多填
 * 補不了**：超出點陣的部分會被畫布裁掉。
 *
 * 【為什麼用掃原始碼】這是「畫面上多了一道亮邊」，在 node 環境驗不到，而且
 * 只在震動的那零點幾秒出現 —— 試玩很容易錯過。
 */
describe('滿版的遮罩不跟著震', () => {
  const hud = srcOf('Hud.ts')

  it('遮罩清單就是暗角與黑視，而且走另一個 context', () => {
    expect(hud).toContain("const MASK: readonly HudWidget[] = ['gEffect', 'bombVignette']")
    expect(hud).toContain('WIDGET_DRAW[w](MASK.includes(w) ? maskCtx : ctx, L, f, dt)')
  })

  /** 【只有 #hud 吃變換】遮罩那一張跟著動的話，這一整件事就白做了 */
  it('CSS 變換只寫在 #hud 上', () => {
    expect(hud.match(/\.style\.transform\s*=/g) ?? []).toHaveLength(1)
    expect(hud).toContain('this.canvas.style.transform = css')
  })

  /**
   * 【順序要靠排序維持】遮罩那一張疊在 `#hud` 底下，所以清單裡凡是走遮罩的
   * 都必須排在會震的前面 —— 不然畫出來的層次與清單寫的不一樣，而那不會報錯。
   */
  it('每一份清單裡，不震的都排在會震的前面', async () => {
    const { hudWidgets } = await import('../../src/hud/Hud')
    const mask = ['gEffect', 'bombVignette']
    for (const [god, bombing] of [[false, false], [false, true], [true, false]] as const) {
      const list = hudWidgets(god, bombing)
      const last = list.reduce((k, w, i) => (mask.includes(w) ? i : k), -1)
      const first = list.findIndex((w) => !mask.includes(w))
      if (last >= 0 && first >= 0) expect(last, `${god}/${bombing}`).toBeLessThan(first)
    }
  })

  /** 【兩張一起藏】遮罩那一張留著的話，選單上會蓋著最後一幀的暗角 */
  it('main.ts 兩張畫布一起藏', () => {
    expect(srcOf('main.ts')).toContain('hudMaskCanvas.hidden = hudCanvas.hidden')
  })
})
