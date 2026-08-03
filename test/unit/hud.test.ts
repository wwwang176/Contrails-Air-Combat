import { describe, it, expect, beforeEach } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createHudContact, createHudFrame, indicatedAirspeed,
  nextHitFlash, HIT_FLASH_SECONDS, HUD_COLORS, HUD_MAX_CONTACTS,
} from '../../src/hud/types'
import { attitudeFromOrientation, headingFromOrientation } from '../../src/hud/attitude-math'
import { advanceGEffect, resetGEffect } from '../../src/hud/widgets/gEffect'
import { PILOT_G_NEGATIVE, PILOT_G_POSITIVE } from '../../src/control/limiters'
import { contactColor, edgeIndicatorPosition, EDGE_INSET } from '../../src/hud/widgets/contacts'
import { edgeClamp, edgeReach, minimapSymbol, MINIMAP_LEVEL_BAND } from '../../src/hud/widgets/minimap'
import { countdownLabel, flightLabel } from '../../src/hud/widgets/roster'
import { DEG, RAD } from '../../src/core/math'

describe('indicatedAirspeed', () => {
  it('海平面 IAS 等於 TAS', () => {
    expect(indicatedAirspeed(150, 1)).toBeCloseTo(150, 10)
  })

  it('高空 IAS 低於 TAS', () => {
    expect(indicatedAirspeed(200, 0.45)).toBeLessThan(200)
    expect(indicatedAirspeed(200, 0.45)).toBeCloseTo(200 * Math.sqrt(0.45), 10)
  })
})

describe('attitudeFromOrientation', () => {
  it('水平姿態的滾轉與俯仰皆為 0', () => {
    const a = attitudeFromOrientation(new Quaternion())
    expect(a.roll).toBeCloseTo(0, 10)
    expect(a.pitch).toBeCloseTo(0, 10)
  })

  it('機首上仰產生正俯仰角', () => {
    // 繞機體 +X（右翼軸）旋轉正角度 = 機首上仰
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 20 * DEG)
    expect(attitudeFromOrientation(q).pitch * RAD).toBeCloseTo(20, 4)
  })

  it('向右滾轉產生正滾轉角', () => {
    // 繞機體 −Z（機首軸）旋轉正角度 = 右滾
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 30 * DEG)
    expect(attitudeFromOrientation(q).roll * RAD).toBeCloseTo(30, 4)
  })

  it('大角度姿態不產生 NaN', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 1).normalize(), 2.7)
    const a = attitudeFromOrientation(q)
    expect(Number.isFinite(a.roll + a.pitch)).toBe(true)
  })
})

describe('headingFromOrientation', () => {
  it('機首朝 −Z 時航向為 0', () => {
    expect(headingFromOrientation(new Quaternion())).toBeCloseTo(0, 10)
  })

  it('機首朝 +X 時航向為 90 度', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -90 * DEG)
    expect(headingFromOrientation(q) * RAD).toBeCloseTo(90, 4)
  })
})

describe('createHudFrame', () => {
  it('初始值不含 NaN', () => {
    const f = createHudFrame()
    for (const v of Object.values(f)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('advanceGEffect', () => {
  const DT = 1 / 60
  beforeEach(resetGEffect)

  it('正常過載不產生任何效果', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(4, DT)
    const g = advanceGEffect(4, DT)
    expect(g.blackout).toBeLessThan(0.01)
    expect(g.redout).toBeLessThan(0.01)
  })

  it('限制器夾住的 6.5 G 持續轉彎看得到黑視（否則整套是死碼）', () => {
    // PILOT_G_POSITIVE 就是指揮儀的過載上限，玩家實際飛得到的最大值。
    // 黑視起點若設在同一個數字，overG 恆為 0，畫面永遠不會暗。
    for (let i = 0; i < 300; i++) advanceGEffect(PILOT_G_POSITIVE, DT)
    expect(advanceGEffect(PILOT_G_POSITIVE, DT).blackout).toBeGreaterThan(0.15)
  })

  it('瞬間拉一下大 G 不會立刻全黑（時間常數必須生效）', () => {
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.05)
    // 半秒還遠不到全黑
    for (let i = 0; i < 30; i++) advanceGEffect(9, DT)
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.5)
  })

  it('持續大 G 約兩秒後明顯變暗，放鬆後恢復', () => {
    for (let i = 0; i < 120; i++) advanceGEffect(9, DT)
    const peak = advanceGEffect(9, DT).blackout
    expect(peak).toBeGreaterThan(0.6)

    for (let i = 0; i < 360; i++) advanceGEffect(1, DT)
    expect(advanceGEffect(1, DT).blackout).toBeLessThan(0.15)
  })

  it('−3 G 是紅視的起點，不是一下子全紅', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(PILOT_G_NEGATIVE, DT)
    expect(advanceGEffect(PILOT_G_NEGATIVE, DT).redout).toBeLessThan(0.05)
  })

  it('更深的負 G 產生紅視而非黑視', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(-5, DT)
    const g = advanceGEffect(-5, DT)
    expect(g.redout).toBeGreaterThan(0.7)
    expect(g.blackout).toBeLessThan(0.01)
  })

  it('resetGEffect 清除殘留（重生後不該還是黑的）', () => {
    for (let i = 0; i < 240; i++) advanceGEffect(9, DT)
    resetGEffect()
    expect(advanceGEffect(1, 0).blackout).toBe(0)
  })
})

describe('HudContact', () => {
  it('contacts 是預先配置好的固定長度陣列（熱路徑零配置）', () => {
    const f = createHudFrame()
    expect(f.contacts).toHaveLength(HUD_MAX_CONTACTS)
    expect(f.contactCount).toBe(0)
    // 每一格都是獨立物件，不是同一個參考重複 HUD_MAX_CONTACTS 次
    expect(f.contacts[0]).not.toBe(f.contacts[1])
  })

  it('初始值不含 NaN', () => {
    const c = createHudContact()
    for (const v of Object.values(c)) {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('新的 frame 沒有命中閃爍', () => {
    expect(createHudFrame().hitFlash).toBe(0)
  })
})

describe('nextHitFlash', () => {
  it('顯示時間是 spec §8 指定的 0.15 s', () => {
    expect(HIT_FLASH_SECONDS).toBe(0.15)
  })

  it('這一幀有命中就重新計時到滿', () => {
    expect(nextHitFlash(0, 1, 1 / 60)).toBe(HIT_FLASH_SECONDS)
  })

  it('沒命中就依 dt 遞減', () => {
    expect(nextHitFlash(0.1, 0, 0.02)).toBeCloseTo(0.08, 9)
  })

  it('遞減到 0 就停住，不會變成負數', () => {
    // 負數會讓「> 0 才畫」的判斷仍然成立於絕對值比較，也讓計時器越積越深，
    // 下一次命中前得先還完債。
    expect(nextHitFlash(0.01, 0, 0.5)).toBe(0)
    expect(nextHitFlash(0, 0, 0.5)).toBe(0)
  })

  it('期間再命中是重新計時，不是累加', () => {
    // 連射時每一發都重置——否則一秒的連射會累積成好幾秒的殘影。
    const mid = nextHitFlash(HIT_FLASH_SECONDS, 0, 0.05)
    expect(mid).toBeLessThan(HIT_FLASH_SECONDS)
    expect(nextHitFlash(mid, 3, 0.05)).toBe(HIT_FLASH_SECONDS)
  })

  it('一幀多次命中與一次命中的結果相同（時間不疊加）', () => {
    expect(nextHitFlash(0, 6, 1 / 60)).toBe(nextHitFlash(0, 1, 1 / 60))
  })
})

describe('edgeIndicatorPosition', () => {
  const ASPECT = 16 / 9
  /** 箭頭貼的是內縮後的邊，不是視窗邊界本身——整支箭頭才不會被切掉一半。 */
  const EX = ASPECT - EDGE_INSET
  const EY = 1 - EDGE_INSET

  it('螢幕右方的目標指到右緣', () => {
    const p = edgeIndicatorPosition(3, 0, false, ASPECT)
    expect(p.x).toBeCloseTo(EX, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('螢幕上方的目標指到上緣', () => {
    const p = edgeIndicatorPosition(0, 3, false, ASPECT)
    expect(p.y).toBeCloseTo(EY, 6)
    expect(p.x).toBeCloseTo(0, 6)
  })

  it('斜角目標落在邊緣上，不會跑到框外', () => {
    const p = edgeIndicatorPosition(5, 4, false, ASPECT)
    expect(Math.abs(p.x)).toBeLessThanOrEqual(EX + 1e-9)
    expect(Math.abs(p.y)).toBeLessThanOrEqual(EY + 1e-9)
    // 至少有一軸貼著邊
    expect(Math.abs(p.x) > EX - 1e-9 || Math.abs(p.y) > EY - 1e-9).toBe(true)
  })

  it('內縮量為正 —— 箭頭必須整支留在畫面內', () => {
    expect(EDGE_INSET).toBeGreaterThan(0)
    expect(EDGE_INSET).toBeLessThan(0.2)
  })

  it('【背後的目標必須反向】否則轉身時箭頭會指反邊', () => {
    // NDC 在相機背後會翻號：正前方 30° 的目標與正後方 150° 的目標
    // 投影到同一側。不處理的話，被咬住時箭頭會叫你往前看。
    const front = edgeIndicatorPosition(0.5, 0, false, ASPECT)
    const back = edgeIndicatorPosition(0.5, 0, true, ASPECT)
    expect(Math.sign(front.x)).toBe(1)
    expect(Math.sign(back.x)).toBe(-1)
  })

  it('箭頭角度指向該方向', () => {
    expect(edgeIndicatorPosition(3, 0, false, ASPECT).angle).toBeCloseTo(0, 6)
    expect(edgeIndicatorPosition(0, 3, false, ASPECT).angle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('正中央（兩軸皆 0）不產生 NaN', () => {
    const p = edgeIndicatorPosition(0, 0, false, ASPECT)
    expect(Number.isFinite(p.x + p.y + p.angle)).toBe(true)
  })
})

describe('minimapSymbol', () => {
  it('高度差在同層帶內是「方」', () => {
    expect(minimapSymbol(0)).toBe('level')
    expect(minimapSymbol(MINIMAP_LEVEL_BAND * 0.9)).toBe('level')
    expect(minimapSymbol(-MINIMAP_LEVEL_BAND * 0.9)).toBe('level')
  })

  it('明顯高於我是「三角」、低於我是「倒三角」', () => {
    expect(minimapSymbol(MINIMAP_LEVEL_BAND * 2)).toBe('above')
    expect(minimapSymbol(-MINIMAP_LEVEL_BAND * 2)).toBe('below')
  })
})

describe('自機血量', () => {
  it('新的 frame 是滿血', () => {
    const f = createHudFrame()
    expect(f.hpMax).toBeGreaterThan(0)
    expect(f.hp).toBe(f.hpMax)
  })

  it('初始值不含 NaN', () => {
    const f = createHudFrame()
    expect(Number.isFinite(f.hp)).toBe(true)
    expect(Number.isFinite(f.hpMax)).toBe(true)
  })
})

describe('AI 接管指示', () => {
  it('新的 frame 預設不是 AI 接管', () => {
    expect(createHudFrame().aiFlying).toBe(false)
  })
})

describe('低速操縱權警告', () => {
  it('新的 frame 是完全有效', () => {
    expect(createHudFrame().controlAuthority).toBe(1)
  })

  /**
   * 【為什麼不沿用 STALL】現有的 STALL 以 `|α| / α_crit` 觸發，而垂直爬升時
   * 攻角接近 0——它一次都不會亮，即使飛機正在變得不可控。這與 M4 出貨後
   * 修掉的 AI 缺陷（`stallMargin` 對「快沒空速」是瞎的）是同一個盲區。
   *
   * 語意也不同：垂直爬升時你離失速很遠，你只是快沒速度了。
   */
  it('初始值不含 NaN', () => {
    expect(Number.isFinite(createHudFrame().controlAuthority)).toBe(true)
  })
})

describe('HudFrame 的戰場欄位', () => {
  it('createHudFrame 的預設值', () => {
    const f = createHudFrame()
    expect(f.blueAlive).toBe(0)
    expect(f.redAlive).toBe(0)
    expect(f.resetCountdown).toBe(0)
  })
})

describe('countdownLabel', () => {
  it('戰鬥進行中不顯示', () => {
    expect(countdownLabel(0)).toBeNull()
  })

  it('負數也不顯示——倒數不會走成負的，但這一條擋掉「−0 秒」那種畫面', () => {
    expect(countdownLabel(-0.4)).toBeNull()
  })

  it('無條件進位：剩 2.4 秒顯示 3', () => {
    expect(countdownLabel(2.4)).toContain('3')
  })

  it('剩 0.1 秒顯示 1，不是 0', () => {
    // 【為什麼不能顯示 0】倒數走到 0 的那一格就重置了，畫面上永遠不該出現
    // 「重新開始 0」——那看起來像卡住
    expect(countdownLabel(0.1)).toContain('1')
  })
})

describe('小地圖的貼邊夾制', () => {
  const EDGE = 50

  it('edgeReach：沿正 X 推到框邊', () => {
    expect(edgeReach(1, 0, EDGE)).toBe(50)
    expect(edgeReach(2, 0, EDGE)).toBe(25)
  })

  it('edgeReach：對角線推到角落，兩軸都剛好碰到', () => {
    const s = edgeReach(1, 1, EDGE)
    expect(1 * s).toBeCloseTo(EDGE, 9)
    expect(1 * s).toBeCloseTo(EDGE, 9)
  })

  it('edgeReach：原點回傳 0（沒有方位可言）', () => {
    expect(edgeReach(0, 0, EDGE)).toBe(0)
  })

  it('edgeReach：只有一軸為 0 時不產生 NaN', () => {
    expect(Number.isFinite(edgeReach(0, 3, EDGE))).toBe(true)
    expect(edgeReach(0, 3, EDGE)).toBeCloseTo(EDGE / 3, 9)
  })

  it('edgeClamp：框內的不動', () => {
    expect(edgeClamp(10, 10, EDGE)).toBe(1)
    expect(edgeClamp(50, 50, EDGE)).toBe(1)
  })

  it('edgeClamp：框外的夾到框上，而且是方框不是圓', () => {
    // 正前方 200 → 夾到 50（1/4）
    expect(edgeClamp(0, 200, EDGE)).toBeCloseTo(0.25, 9)
    // 45° 方向 200,200 → 夾到 50,50，也就是**角落**。
    // 若夾到內接圓，這裡會是 50/√2 ≈ 35.4，比正前方那個近
    const k = edgeClamp(200, 200, EDGE)
    expect(200 * k).toBeCloseTo(EDGE, 9)
  })

  it('edgeClamp：對角與正向的夾制結果都落在框上，不是圓上', () => {
    for (const [x, y] of [[300, 0], [0, 300], [300, 300], [300, 120]] as const) {
      const k = edgeClamp(x, y, EDGE)
      const onEdge = Math.max(Math.abs(x * k), Math.abs(y * k))
      expect(onEdge).toBeCloseTo(EDGE, 9)
    }
  })
})

describe('contactColor —— 自己的分隊要認得出來（M6 spec §10）', () => {
  it('敵機是危險色', () => {
    expect(contactColor(true, false)).toBe(HUD_COLORS.danger)
  })

  it('一般友機是友方色', () => {
    expect(contactColor(false, false)).toBe(HUD_COLORS.friendly)
  })

  it('自己分隊的同伴用第三個顏色', () => {
    // 【為什麼一定要與一般友機分開】驗收條件 20 要求「你看得出來那是你的
    // 僚機」。不分的話，僚機回頭掩護你這件事在畫面上與「剛好有架友機飛
    // 過」完全無法區分。
    //
    // 【為什麼標整個分隊】members[1] 與 members[2] 都以玩家為站位參考機，
    // 也就是**兩架都在掩護你**；只標一架的話那條分界線不對應任何行為差異。
    expect(contactColor(false, true)).toBe(HUD_COLORS.warn)
    expect(contactColor(false, true)).not.toBe(HUD_COLORS.friendly)
  })

  it('敵機不會因為 flightMate 旗標而變色 —— 那是不可能的狀態，但顏色要可預測', () => {
    expect(contactColor(true, true)).toBe(HUD_COLORS.danger)
  })
})

describe('flightLabel —— 分隊存活（M6 spec §10）', () => {
  it('滿編顯示 4/4', () => {
    expect(flightLabel(4, 4)).toBe('隊 4/4')
  })

  it('遞補之後顯示剩幾架', () => {
    expect(flightLabel(2, 4)).toBe('隊 2/4')
  })

  it('分隊只剩自己時不顯示 —— 那時候沒有「隊」這回事', () => {
    expect(flightLabel(1, 4)).toBeNull()
  })

  it('沒有分隊時不顯示', () => {
    expect(flightLabel(0, 0)).toBeNull()
  })
})
