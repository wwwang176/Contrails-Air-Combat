import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { G4M } from '../../src/specs/g4m'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { bombDragK, BOMB_TERMINAL_SPEED } from '../../src/world/bomb'
import { TORPEDO_RANGE, TORPEDO_SPEED, Torpedoes } from '../../src/world/torpedo'
import {
  ABORT_RANGE, LOCK_CONE, RANGE_MARGIN, RUN_ALTITUDE, TORPEDO_PROFILE,
  RELEASE_RUN, hitWindowOf, makeTorpedoProfile, setTorpedoBallistics,
  shouldRelease, waterRunSeconds,
} from '../../src/ai/torpedoRun'
import { TORPEDO_ENVELOPE } from '../../src/weapons/releaseEnvelope'
import { shipAt } from '../../src/ai/bombRun'
import type { Ship } from '../../src/world/ships'

const DT = 1 / 240
const K = bombDragK(BOMB_TERMINAL_SPEED)

/**
 * # AI 的雷擊
 *
 * **瞄的是「雷走過去的位置」。** 空中一段拋物線、水中一段等速直線，而
 * 兩段加起來的時間裡船一直在跑 —— 1,000 m 的水中航程是 45 秒，船走 364 m，
 * 三個艦身。
 */

describe('waterRunSeconds', () => {
  /** 【最基本的一條】船不動時就是距離除以雷速 */
  it('靜止的船：距離 ÷ 雷速', () => {
    const t = waterRunSeconds(0, 0, 0, -440, 0, 0, TORPEDO_SPEED)
    expect(t).toBeCloseTo(440 / TORPEDO_SPEED, 9)
  })

  it('已經在船上就是 0', () => {
    expect(waterRunSeconds(5, -3, 5, -3, 4, 0, TORPEDO_SPEED)).toBe(0)
  })

  /**
   * 【尾追比正橫久、正橫比迎面久】同一個距離，船跑開就要追得久一點。
   * 這一條同時是「為什麼不需要夾角門檻」的量化版本 —— 尾追不是解不出來，
   * 是解出來的航程太長。
   */
  it('尾追最久、迎面最短', () => {
    const d = 1000
    const away = waterRunSeconds(0, 0, 0, -d, 0, -8, TORPEDO_SPEED)
    const beam = waterRunSeconds(0, 0, 0, -d, 8, 0, TORPEDO_SPEED)
    const head = waterRunSeconds(0, 0, 0, -d, 0, 8, TORPEDO_SPEED)
    expect(away).toBeGreaterThan(beam)
    expect(beam).toBeGreaterThan(head)
    // 尾追：接近速度只剩 22 − 8
    expect(away).toBeCloseTo(d / (TORPEDO_SPEED - 8), 6)
    expect(head).toBeCloseTo(d / (TORPEDO_SPEED + 8), 6)
  })

  /**
   * 【解出來的時間要真的是一個攔截】把 t 代回去，雷走過的距離必須等於
   * 雷到船的距離。這一條擋的是「二次式取錯根」。
   */
  it('解回代成立：雷走的距離 = 雷到船的距離', () => {
    for (const [ux, uz] of [[8, 0], [0, -8], [5, 5], [-6, 3]] as const) {
      const t = waterRunSeconds(0, 0, 300, -900, ux, uz, TORPEDO_SPEED)
      expect(t).toBeGreaterThan(0)
      const px = 300 + ux * t
      const pz = -900 + uz * t
      expect(Math.hypot(px, pz)).toBeCloseTo(TORPEDO_SPEED * t, 5)
    }
  })

  /**
   * 【船比雷快就沒有解】遊戲裡不會發生（最快的船 15 m/s），但判準要
   * 肯定式 —— 退化時回 −1，不是回一個假的時間。
   */
  it('船比雷快而且在逃：回 −1', () => {
    expect(waterRunSeconds(0, 0, 0, -100, 0, -30, TORPEDO_SPEED)).toBe(-1)
  })

  it('船速正好等於雷速、正在逃：回 −1', () => {
    expect(waterRunSeconds(0, 0, 0, -100, 0, -TORPEDO_SPEED, TORPEDO_SPEED)).toBe(-1)
  })
})

describe('hitWindowOf', () => {
  /**
   * 【窗不是一個圓】魚雷是接觸引爆，窗就是艦體本身 —— 而艦體細長。
   * 用一個半徑近似的話，取大的會投一堆擦身而過的雷。
   */
  it('半長遠大於半寬', () => {
    const w = hitWindowOf(SHIP_CLASSES.fletcher)
    expect(w.along).toBeCloseTo(57.4, 6)
    expect(w.across).toBeCloseTo(6.04, 6)
    expect(w.along / w.across).toBeGreaterThan(9)
  })

  /** 【第一個盒恆是艦體】Essex 的第二個盒是寬 43 m 的飛行甲板 */
  it('Essex 取的是艦體不是飛行甲板', () => {
    expect(hitWindowOf(SHIP_CLASSES.essex).across).toBeCloseTo(14.2, 6)
  })
})

/** 一艘停在原點、艏向 −Z、以 `speed` 前進的靶 */
function target(speed = 8, id: keyof typeof SHIP_CLASSES = 'fletcher'): Ship {
  const ship = createShip(0, SHIP_CLASSES[id], 'red', 0, 0, 0, speed)
  ship.guns = []
  return ship
}

/** 一台在 `alt` 高、以 `tas` 朝 −Z 平飛的 G4M，位在 `(x, z)` */
function bomber(x: number, z: number, alt = RUN_ALTITUDE, tas = 100): Aircraft {
  const a = new Aircraft(G4M)
  a.state.position.set(x, alt, z)
  a.state.velocity.set(0, 0, -tas)
  return a
}

/**
 * 一台坡度**確定**超出包絡的轟炸機。
 *
 * 【角度相對包絡取，而且驗過】寫死 45° 的話，包絡一放寬到 45° 這條就只靠
 * `Quaternion` 換算多出來的 1e-16 過關 —— 測試名字說「超過包絡」而實際上
 * 站在邊界上，數值實作稍動就會讓正確的程式變紅。所以取 1.2 倍，並且**先
 * 斷言算出來的坡度真的超過上界**，前提不成立時這裡就紅。
 */
function overBanked(): Aircraft {
  const a = bomber(0, 1500)
  a.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), TORPEDO_ENVELOPE.maxRoll * 1.2)
  const up = new Vector3(0, 1, 0).applyQuaternion(a.state.orientation)
  const right = new Vector3(1, 0, 0).applyQuaternion(a.state.orientation)
  expect(Math.abs(Math.atan2(-right.y, up.y))).toBeGreaterThan(TORPEDO_ENVELOPE.maxRoll)
  return a
}

describe('剖面的旋鈕', () => {
  /**
   * 【航路高度必須落在投雷包絡裡】太低踩安全層、太高投不出去，兩邊都是
   * 廢掉一整趟。這一條把兩份設定綁在一起 —— 改包絡就會紅。
   */
  it('航路高度落在投雷包絡的 AGL 區間內，而且兩邊都有餘裕', () => {
    expect(RUN_ALTITUDE).toBeGreaterThan(TORPEDO_ENVELOPE.minAgl)
    expect(RUN_ALTITUDE).toBeLessThan(TORPEDO_ENVELOPE.maxAgl)
    expect(RUN_ALTITUDE - TORPEDO_ENVELOPE.minAgl).toBeGreaterThanOrEqual(20)
    expect(TORPEDO_ENVELOPE.maxAgl - RUN_ALTITUDE).toBeGreaterThanOrEqual(20)
  })

  it('鎖航向的圓錐比轟炸緊 —— 坡度只准 ±12°', () => {
    expect(LOCK_CONE).toBeLessThan(25 * (Math.PI / 180))
  })

  it('放棄距離是正的，而且比雷程短', () => {
    expect(ABORT_RANGE).toBeGreaterThan(0)
    expect(ABORT_RANGE).toBeLessThan(TORPEDO_RANGE)
  })

  it('射程餘裕留在 0 與 1 之間', () => {
    expect(RANGE_MARGIN).toBeGreaterThan(0)
    expect(RANGE_MARGIN).toBeLessThan(1)
  })

  /**
   * 【鎖定點要在硬性上限之內】鎖定距離吃滿射程的話鎖定點落在 2.4 km 外，
   * 而鎖了之後只剩重阻尼的修正 —— 實測橫向誤差每 0.5 秒收 2 m，從 65 m
   * 收進 6 m 的窗要 30 秒，直飛段只有 28 秒。**鎖得越遠越修不完。**
   */
  it('預期投放航程比硬性射程上限短', () => {
    expect(RELEASE_RUN).toBeGreaterThan(0)
    expect(RELEASE_RUN).toBeLessThan(TORPEDO_RANGE * RANGE_MARGIN)
  })

  it('工廠的預設等於上場的那一份', () => {
    const p = makeTorpedoProfile()
    expect(p.runAltitude).toBe(TORPEDO_PROFILE.runAltitude)
    expect(p.lockCone).toBe(TORPEDO_PROFILE.lockCone)
    expect(p.abortRange).toBe(TORPEDO_PROFILE.abortRange)
  })

  /** 【它必須定高】`null` 是「維持現在的高度」，那是轟炸的做法 */
  it('航路高度不是 null —— 雷擊要降下去', () => {
    expect(TORPEDO_PROFILE.runAltitude).not.toBeNull()
  })
})

describe('plan：瞄雷程時刻，不是入水時刻', () => {
  const out = { aim: new Vector3(), lockRange: 0, egressRange: 0 }

  it('瞄點比「船在入水時刻的位置」更前面一大段', () => {
    setTorpedoBallistics(K, DT)
    const ship = target(8)
    const self = bomber(0, 1500)
    TORPEDO_PROFILE.plan(self, ship, out)

    // 入水大約在飛機前方一點點（50 m 落下）
    const entryShip = shipAt(ship, 3, new Vector3())
    const lead = out.aim.distanceTo(entryShip)
    // 船 8 m/s，水中段上千公尺 —— 前置量至少一個艦身
    expect(lead).toBeGreaterThan(100)
  })

  /** 【鎖定距離 = 空中前拋 + 水中航程】不然會在還沒到位時就鎖死航向 */
  it('鎖定距離涵蓋整條雷的行程', () => {
    setTorpedoBallistics(K, DT)
    const ship = target(8)
    TORPEDO_PROFILE.plan(bomber(0, 1500), ship, out)
    expect(out.lockRange).toBeGreaterThan(1000)
    expect(out.egressRange).toBeGreaterThan(out.lockRange)
  })

  /**
   * 【鎖定距離不得跟著距離一起縮】這是整支最深的一個坑。
   *
   * 拿「這一拍解出來的水中航程」去算鎖定距離的話，飛機越近、解出來的航程
   * 越短，於是 `lockRange` 追著 `range` 一路縮、永遠差一點點 —— 實測
   * 1086/884、1044/853、1001/821…**鎖定條件永遠不成立，一枚都投不出去。**
   *
   * 鎖定距離是一個**固定的接戰距離**：同樣的高度與速度，離船遠近不影響它。
   */
  it('同樣的高度與速度下，鎖定距離不隨離船的遠近改變', () => {
    setTorpedoBallistics(K, DT)
    const ship = target(8)
    TORPEDO_PROFILE.plan(bomber(0, 2500), ship, out)
    const far = out.lockRange
    TORPEDO_PROFILE.plan(bomber(0, 1200), ship, out)
    const near = out.lockRange
    expect(far).toBeGreaterThan(0)
    expect(near).toBeCloseTo(far, 6)
  })

  /** 【解不出來也要給一個瞄點】那時它還在進場，粗略的前置量比沒有好 */
  it('阻力還沒設定時退回接近時刻，不丟例外也不給 NaN', () => {
    setTorpedoBallistics(0, DT)
    const ship = target(8)
    expect(() => TORPEDO_PROFILE.plan(bomber(0, 4000), ship, out)).not.toThrow()
    expect(Number.isFinite(out.aim.x)).toBe(true)
    expect(Number.isFinite(out.aim.z)).toBe(true)
    setTorpedoBallistics(K, DT)
  })
})

describe('shouldRelease', () => {
  it('離得太遠：水中航程超過射程 —— 不投', () => {
    setTorpedoBallistics(K, DT)
    expect(shouldRelease(bomber(0, TORPEDO_RANGE + 1500), target(8))).toBe(false)
  })

  /**
   * 【這一條是整支的重點】對著船的正橫、在合理的距離上飛進去，總有一拍
   * 會說「現在」。不然 AI 永遠不投。
   */
  it('正橫進場的航路上找得到放手的那一拍', () => {
    setTorpedoBallistics(K, DT)
    let released = 0
    for (let z = 2200; z > 200; z -= 5) {
      const ship = target(8)
      // 讓船的正橫對著飛機：船艏 −Z，飛機從 −Z 方向朝 +Z⋯⋯改成飛機在 +Z
      // 側、朝 −Z 飛，船從 −X 往 −Z 跑 —— 用旋轉過的靶更直觀
      ship.position.set(0, 0, 0)
      if (shouldRelease(bomber(0, z), ship)) released++
    }
    expect(released).toBeGreaterThan(0)
  })

  /** 【垂直下墜沒有水平航向】那時候不能從速度反推，一律不投 */
  it('沒有水平速度就不投', () => {
    setTorpedoBallistics(K, DT)
    const a = bomber(0, 800)
    a.state.velocity.set(0, -80, 0)
    expect(shouldRelease(a, target(8))).toBe(false)
  })

  /**
   * 【窗是艦體，所以橫向比縱向嚴得多】把飛機往旁邊平移，橫向偏一點就不投
   * 了；而同樣的量沿著艦體軸偏則還在窗內。
   */
  it('橫向偏比縱向偏更快失去解', () => {
    setTorpedoBallistics(K, DT)
    // 先找到一個會投的點
    let base = -1
    for (let z = 2200; z > 200; z -= 5) {
      if (shouldRelease(bomber(0, z), target(8))) { base = z; break }
    }
    expect(base).toBeGreaterThan(0)
    // 船艏 −Z：橫向是 X。偏 30 m（半寬 6.04）應該就掉出窗外
    expect(shouldRelease(bomber(30, base), target(8))).toBe(false)
  })
})

describe('水平航向在空中段守恆', () => {
  /**
   * 【這是 `shouldRelease` 的地基】它假設「雷的水中航向 = 投放瞬間的水平
   * 航向」。`stepBomb` 的阻力與速度反向、重力只動垂直分量，所以水平兩軸
   * 恆等比例縮放 —— 方向不變。**這一條把那個假設釘住。**
   */
  it('入水速度的水平方向等於投放時的水平方向', () => {
    const pool = new Torpedoes(2)
    const vx = 37
    const vz = -84
    pool.spawn(0, 400, 0, vx, 12, vz, 15000, 0, -1)
    for (let t = 0; t < 60 && pool.phase[0] === 0; t += DT) {
      pool.step(DT, K, () => 0, () => 0, () => {}, () => {}, () => {})
    }
    expect(pool.phase[0]).toBe(1)
    const l0 = Math.hypot(vx, vz)
    expect(pool.headX[0]!).toBeCloseTo(vx / l0, 9)
    expect(pool.headZ[0]!).toBeCloseTo(vz / l0, 9)
  })
})

describe('可以鎖 = 可以投', () => {
  const out = { aim: new Vector3(), lockRange: 0, egressRange: 0 }

  /**
   * 【這一條守的是「帶著坡度鎖航向」】鎖定只看機首方向，而轉彎中的機首會
   * 短暫地指對方向。實測一台 G4M 帶著 45° 坡度進入直飛段，一邊改平一邊讓解
   * 掃過去：誤差穿過 (1, 1)（正中艦體）的那一拍坡度是 36.5°，被包絡擋掉；
   * 等改平到 6.3° 時誤差已經長到 34 m，而窗只有 6 m。
   *
   * `lockRange = 0` 就是「這一拍還不到鎖的時候」—— 任何距離都大於它。
   */
  it('坡度超過包絡時鎖定距離是 0', () => {
    setTorpedoBallistics(K, DT)
    const ship = target(8)
    const level = bomber(0, 1500)
    TORPEDO_PROFILE.plan(level, ship, out)
    expect(out.lockRange).toBeGreaterThan(0)

    const banked = overBanked()
    TORPEDO_PROFILE.plan(banked, ship, out)
    expect(out.lockRange).toBe(0)
  })

  /** 【脫離距離照算】它管的是「飛多遠才准回頭」，與這一拍鎖不鎖無關 */
  it('不准鎖的時候脫離距離仍然是正的', () => {
    setTorpedoBallistics(K, DT)
    TORPEDO_PROFILE.plan(overBanked(), target(8), out)
    expect(out.egressRange).toBeGreaterThan(0)
  })
})
