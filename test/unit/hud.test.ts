import { describe, it, expect, beforeEach } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createHudContact, createHudFrame, indicatedAirspeed,
  contactColor, nextHitFlash, HIT_FLASH_SECONDS, HUD_COLORS, HUD_MAX_CONTACTS,
  contactBoxRadius, type HudLayout,
} from '../../src/hud/types'
import {
  godMarkerVisible, flightStrengthLabel, godMarkerColor, drawGodMarkers,
} from '../../src/hud/widgets/godMarkers'
import { MAX_COMBATANTS } from '../../src/battle/skirmish'
import { attitudeFromOrientation, headingFromOrientation } from '../../src/hud/attitude-math'
import { advanceGEffect, resetGEffect } from '../../src/hud/widgets/gEffect'
import { PILOT_G_NEGATIVE } from '../../src/control/limiters'
import { P51D } from '../../src/specs/p51d'
import { edgeIndicatorPosition, EDGE_INSET } from '../../src/hud/widgets/contacts'
import { edgeClamp, edgeReach, minimapSymbol, MINIMAP_LEVEL_BAND } from '../../src/hud/widgets/minimap'
import { flightLabel } from '../../src/hud/widgets/roster'
import { hudWidgets, WIDGET_DRAW } from '../../src/hud/Hud'
import { hintKeys } from '../../src/hud/widgets/hints'
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

  it('限制器夾住的過載持續轉彎看得到黑視（否則整套是死碼）', () => {
    // 【意圖不變，輸入改了】這條守的是「黑視起點不能設在過載上限之上，
    // 否則 overG 恆為 0、整套黑視是死碼」。
    //
    // 2026-08-11 之前，玩家飛得到的最大過載是 PILOT_G_POSITIVE = 6.5
    // （指揮儀硬夾）。那個硬夾已經拿掉，現在的上限是**結構極限**
    // （control/limiters.ts）。所以輸入換成 P-51D 的 8 G —— 換的是
    // 「誰是上限」這個事實，不是這條測試的判準。
    const CAP = P51D.limits.gPositive
    for (let i = 0; i < 300; i++) advanceGEffect(CAP, DT)
    expect(advanceGEffect(CAP, DT).blackout).toBeGreaterThan(0.15)
  })

  it('瞬間拉一下大 G 不會立刻全黑（時間常數必須生效）', () => {
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.05)
    // 半秒還遠不到全黑
    for (let i = 0; i < 30; i++) advanceGEffect(9, DT)
    expect(advanceGEffect(9, DT).blackout).toBeLessThan(0.5)
  })

  it('持續大 G 約兩秒後明顯變暗，放鬆後恢復', () => {
    // 【0.6 → 0.5：門檻隨黑視曲線重新定值，專案負責人 2026-08-11 試飛認可】
    // 曲線由 6/8 搬到 7.5/9.5（見 hud/widgets/gEffect.ts 的推導：兩個門檻
    // 同時 +1.5，等於過載上限由 6.5 移到 8.0 的同一個位移，好讓極限持續
    // 轉彎維持在 25% 強度這個原始設計意圖）。
    // 9 G 在舊曲線早已飽和到 1.0，在新曲線是 75%，兩秒的累積因此到 0.537。
    // 這條測的是「持續大 G 兩秒後**明顯**變暗」，0.5 仍然明顯。
    for (let i = 0; i < 120; i++) advanceGEffect(9, DT)
    const peak = advanceGEffect(9, DT).blackout
    expect(peak).toBeGreaterThan(0.5)

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

describe('上帝視角的 HUD', () => {
  /**
   * 【為什麼要把「畫哪些」抽成純函數】canvas 在 node 環境驗不到，而
   * 「準星在上帝視角下絕不能出現」是一條真的會壞、而且壞了很難察覺的
   * 性質 —— 它會讓人以為那個方向會有子彈出去。抽出來就驗得到。
   *
   * 繪製**順序**也在這個回傳值裡，所以既有的分層註解（黑視最底、準星
   * 壓在接觸點之上）不會被這次改動悄悄弄丟。
   */
  it('上帝視角畫分隊標示、小地圖、名冊、提示、任務目標', () => {
    expect(hudWidgets(true)).toEqual(
      ['godMarkers', 'minimap', 'roster', 'hints', 'objective'],
    )
  })

  /**
   * 【`objective` 不是座艙儀表】它是**這一場的規則** —— 還剩幾架、倒數剩
   * 幾秒，與鏡頭在哪裡無關。所以它是唯一同時出現在兩張清單裡的新成員。
   */
  it('任務目標兩種視角都畫，而且壓在最上層', () => {
    for (const godView of [false, true]) {
      const w = hudWidgets(godView)
      expect(w, `godView=${godView}`).toContain('objective')
      expect(w[w.length - 1], `godView=${godView}`).toBe('objective')
    }
  })

  /**
   * 【為什麼光是「在清單裡」不夠】清單與繪製是兩件事。`FULL` 更新了卻漏掉
   * 繪製分派的話，上面兩條仍然全綠而 HUD 完全不畫（Codex 審查 2026-08-16）。
   * 分派改成 `Record` 之後這一條是防禦而不是主要保證 —— 主要保證是編譯錯誤。
   */
  it('清單上的每一個 widget 都真的有繪製函數', () => {
    for (const godView of [false, true]) {
      for (const w of hudWidgets(godView)) {
        expect(WIDGET_DRAW[w], `${w}（godView=${godView}）`).toBeTypeOf('function')
      }
    }
  })

  /**
   * 【座艙裡不畫分隊標示】那裡已經有完整的目標框與預瞄環，再疊一層分隊框
   * 是雜訊。這一條與「準星在上帝視角不出現」是對稱的兩半 —— 只守一邊的話，
   * 哪天有人把 `godMarkers` 加進 `FULL` 也不會有東西紅。
   */
  it('座艙不畫分隊標示', () => {
    expect(hudWidgets(false)).not.toContain('godMarkers')
  })

  it('一般飛行畫得到準星，上帝視角畫不到', () => {
    expect(hudWidgets(false)).toContain('reticle')
    expect(hudWidgets(true)).not.toContain('reticle')
  })

  /**
   * 【繪製順序是有意義的，不只是集合】黑視／紅視必須在最底（其餘元件疊
   * 在上面才維持可讀），接觸點必須在準星**之前**（準星壓在最上層）。
   * 這兩條理由本來只活在註解裡，抽成純函數之後才釘得住。
   */
  it('一般飛行的順序：黑視最底、接觸點在準星之前', () => {
    const w = hudWidgets(false)
    expect(w[0]).toBe('gEffect')
    expect(w.indexOf('contacts')).toBeLessThan(w.indexOf('reticle'))
  })

  /** 【提示行要換】上帝視角下 W/S 不是油門，寫著油門就是騙人 */
  it('上帝視角的提示行提到 WASD 與 Q/E，不提油門', () => {
    const god = hintKeys(true)
    expect(god).toContain('WASD')
    expect(god).toContain('Q/E')
    expect(god).not.toContain('油門')
    expect(hintKeys(false)).toContain('油門')
  })

  /** 【G 要寫在一般飛行的提示行裡】不然這個模式是不可發現的 */
  it('一般飛行的提示行要告訴玩家 G 進得去', () => {
    expect(hintKeys(false)).toContain('G')
  })
})

describe('contactBoxRadius', () => {
  /**
   * 【為什麼這個夾制值得一條測試】它原本寫在 `contacts.ts` 的繪製函數裡，
   * 而繪製函數在 node 環境驗不到 —— 於是那段註解記下的錯（先夾再乘 scale，
   * 動態尺寸被二次縮放）沒有任何東西守著。搬到 `types.ts` 給兩個 widget
   * 共用的同時，順帶讓它第一次有測試。
   */
  it('小於下界時夾到下界', () => {
    expect(contactBoxRadius(0.0001, 400, 1)).toBe(9)
  })

  it('大於上界時夾到上界', () => {
    expect(contactBoxRadius(10, 400, 1)).toBe(46)
  })

  it('中間段就是 radius × unit', () => {
    expect(contactBoxRadius(0.05, 400, 1)).toBeCloseTo(20, 10)
  })

  /**
   * 【順序不能反】上下界要**先乘 scale 再夾**。反過來的話固定的上下界只縮放
   * 一次、動態尺寸卻縮放兩次，兩者在不同視窗高度下對不起來。
   */
  it('上下界跟著 scale 走：scale = 2 時下界是 18 不是 9', () => {
    expect(contactBoxRadius(0.0001, 400, 2)).toBe(18)
    expect(contactBoxRadius(10, 400, 2)).toBe(92)
  })

  it('scale 不會把中間段乘第二次', () => {
    // radius × unit = 20，落在 [18, 92] 之內，所以原封不動
    expect(contactBoxRadius(0.05, 400, 2)).toBeCloseTo(20, 10)
  })
})

describe('HudContact 的分隊欄位', () => {
  /**
   * 【為什麼要守初始值】接觸點是**固定長度的池**，格子會被重複使用。
   * 新欄位若沒有初始值，型別上是 undefined、執行期會畫出 `(undefined/undefined)`。
   */
  it('createHudContact 把三個分隊欄位設成不畫標示的狀態', () => {
    const c = createHudContact()
    expect(c.flightLeader).toBe(false)
    expect(c.flightAlive).toBe(0)
    expect(c.flightSize).toBe(0)
  })
})

describe('godMarkerVisible —— 上帝視角要畫誰', () => {
  /** 在畫面正中央、已啟用的長機。各條測試由它出發只改一個欄位 */
  const leader = (): ReturnType<typeof createHudContact> => {
    const c = createHudContact()
    c.active = true
    c.flightLeader = true
    c.x = 0
    c.y = 0
    c.behind = false
    return c
  }

  it('長機且在畫面內就畫', () => {
    expect(godMarkerVisible(leader(), 16 / 9)).toBe(true)
  })

  /** 【這是這一份的核心要求】「只需標記小隊的長機」 */
  it('不是長機就不畫，即使它在畫面正中央', () => {
    const c = leader()
    c.flightLeader = false
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })

  /**
   * 【背後的接觸點必須擋掉】NDC 在相機背後會翻號，正前方 30° 與正後方 150°
   * 的目標會投影到同一側。不擋的話，你背後的分隊會被畫在你面前
   * —— 與 `edgeIndicatorPosition` 要吃 `behind` 是同一個成因。
   */
  it('在鏡頭背後就不畫', () => {
    const c = leader()
    c.behind = true
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })

  it('水平超出畫面就不畫（邊界是 aspect 不是 1）', () => {
    const aspect = 16 / 9
    const inside = leader()
    inside.x = aspect - 0.01
    expect(godMarkerVisible(inside, aspect)).toBe(true)

    const outside = leader()
    outside.x = aspect + 0.01
    expect(godMarkerVisible(outside, aspect)).toBe(false)
  })

  it('垂直超出畫面就不畫（邊界是 1）', () => {
    const inside = leader()
    inside.y = 0.99
    expect(godMarkerVisible(inside, 16 / 9)).toBe(true)

    const outside = leader()
    outside.y = 1.01
    expect(godMarkerVisible(outside, 16 / 9)).toBe(false)
  })

  /**
   * 【邊界是含端點的】`<=` 而不是 `<`，與 `drawContacts` 的 on-screen 判斷
   * 逐字一致 —— 兩邊若一個含端點一個不含，同一個投影座標會在座艙與上帝
   * 視角得到不同的答案。上面那兩條用的是 ±0.01，抓不到 `<=` 被改成 `<`
   * （Codex 2026-08-09 審查指出）。
   */
  it('恰好在邊界上要畫', () => {
    const aspect = 16 / 9
    const atX = leader()
    atX.x = aspect
    expect(godMarkerVisible(atX, aspect)).toBe(true)

    const atY = leader()
    atY.y = 1
    expect(godMarkerVisible(atY, aspect)).toBe(true)

    const atNegY = leader()
    atNegY.y = -1
    expect(godMarkerVisible(atNegY, aspect)).toBe(true)
  })

  /** 池子是固定長度的，沒在用的格子裡是上一場留下來的值 */
  it('沒啟用的格子不畫', () => {
    const c = leader()
    c.active = false
    expect(godMarkerVisible(c, 16 / 9)).toBe(false)
  })
})

describe('flightStrengthLabel', () => {
  it('存活與編制寫成 (2/4)', () => {
    expect(flightStrengthLabel(2, 4)).toBe('(2/4)')
  })

  /**
   * 【與 `roster.ts` 的 `flightLabel` 相反，這裡剩一架照樣顯示】那一個在
   * `alive < 2` 時回傳 null，理由是「剩一架時沒有『隊』這回事」。上帝視角是
   * 旁觀全場：`(1/4)` 正是「那一隊快被打光了」，是最值得看的資訊之一。
   */
  it('剩一架照樣顯示 (1/4)', () => {
    expect(flightStrengthLabel(1, 4)).toBe('(1/4)')
  })

  /** 架數不是 SCHWARM_SIZE 的倍數時，最後一個分隊比較小 —— 不需要特例 */
  it('編制員額 1 的分隊是 (1/1)', () => {
    expect(flightStrengthLabel(1, 1)).toBe('(1/1)')
  })
})

describe('godMarkerColor', () => {
  /**
   * 【兩色不是三色】座艙的 `contactColor` 有第三個顏色給玩家自己的 Schwarm
   * （警示黃 `HUD_COLORS.warn`），用來標「誰會在你被咬時回頭掩護你」。
   * 上帝視角是旁觀全場，那個區別沒有意義 —— 專案負責人 2026-08-09 的裁決。
   * 下面兩條精確相等就把「不得是警示黃」一起釘住了；**不要再補一條
   * `not.toBe(HUD_COLORS.warn)`**，那在相等斷言已經成立之後是恆真的，
   * 什麼都不守（Codex 2026-08-09 審查指出）。
   */
  it('敵方是危險色、我方是友軍色，沒有第三個', () => {
    expect(godMarkerColor(true)).toBe(HUD_COLORS.danger)
    expect(godMarkerColor(false)).toBe(HUD_COLORS.friendly)
  })
})

/**
 * 【為什麼要一個假的 canvas context】上面那些純函數全部通過，`drawGodMarkers`
 * 卻可能根本沒被呼叫、或把 `flightAlive` 與 `flightSize` 寫反、或把 y 軸翻錯 ——
 * 沒有任何一條會紅（Codex 2026-08-09 審查指出）。canvas 在 node 環境沒有實作，
 * 但這個 widget 只碰幾個成員，手寫一個記錄呼叫的替身就夠。
 *
 * **這不是「測試繪製好不好看」**（那條紀律不變，好不好看只有專案負責人判定
 * 得了）。它測的是「畫了幾個、畫在哪、字是什麼」—— 三件有明確正確答案的事。
 */
describe('drawGodMarkers', () => {
  const LAYOUT: HudLayout = {
    width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
  }

  function fakeCtx(): {
    ctx: CanvasRenderingContext2D
    rects: { x: number, y: number, w: number, h: number, color: string }[]
    texts: { text: string, x: number, y: number, color: string }[]
  } {
    const rects: { x: number, y: number, w: number, h: number, color: string }[] = []
    const texts: { text: string, x: number, y: number, color: string }[] = []
    // 【顏色要在呼叫的當下抄下來】`strokeStyle` 是一個會被下一圈覆寫的欄位。
    // 只在最後讀一次的話，十個標示都會顯示成最後那一個的顏色 —— 於是
    // 「敵紅我藍」根本沒有被測到（Codex 2026-08-09 審查指出）。
    const ctx = {
      font: '', textAlign: '', textBaseline: '',
      strokeStyle: '', fillStyle: '', lineWidth: 0,
      strokeRect(x: number, y: number, w: number, h: number): void {
        rects.push({ x, y, w, h, color: String(ctx.strokeStyle) })
      },
      fillText(text: string, x: number, y: number): void {
        texts.push({ text, x, y, color: String(ctx.fillStyle) })
      },
    } as unknown as CanvasRenderingContext2D & { strokeStyle: string, fillStyle: string }
    return { ctx, rects, texts }
  }

  /** 長機在 (0, 0.5)、半徑 0.05（× unit 360 = 18，落在夾制的中間段） */
  function twoContacts(): ReturnType<typeof createHudFrame> {
    const f = createHudFrame()
    const leader = f.contacts[0]!
    leader.active = true
    leader.flightLeader = true
    leader.hostile = true
    leader.x = 0
    leader.y = 0.5
    leader.radius = 0.05
    leader.flightAlive = 2
    leader.flightSize = 4

    const wingman = f.contacts[1]!
    wingman.active = true
    wingman.flightLeader = false
    wingman.hostile = true
    wingman.x = 0.2
    wingman.y = 0.1
    wingman.radius = 0.05
    wingman.flightAlive = 2
    wingman.flightSize = 4

    f.contactCount = 2
    return f
  }

  it('兩架同隊只畫一個框 —— 僚機沒有', () => {
    const { ctx, rects, texts } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    expect(rects).toHaveLength(1)
    expect(texts).toHaveLength(1)
  })

  /** 【y 要翻】螢幕座標往下為正，接觸點的 y 往上為正 */
  it('框以長機為中心，而且 y 軸有翻', () => {
    const { ctx, rects } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    // cx + 0 × 360 = 640；cy − 0.5 × 360 = 180；r = 0.05 × 360 = 18
    expect(rects[0]).toMatchObject({ x: 640 - 18, y: 180 - 18, w: 36, h: 36 })
  })

  /** 【分子分母不能對調】寫反的話畫出來是 (4/2)，而純函數測試抓不到 */
  it('框下的字是 (存活/編制)，貼在框底下', () => {
    const { ctx, texts } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, twoContacts())
    expect(texts[0]!.text).toBe('(2/4)')
    expect(texts[0]!.x).toBe(640)
    expect(texts[0]!.y).toBe(180 + 18 + 3)
  })

  /**
   * 【要求原文是「敵我雙方都要有」】上面那些案例只有一個分隊，證明不了
   * 「兩個分隊各畫一個」，也證明不了顏色真的接上去了 —— 把顏色寫死成
   * `HUD_COLORS.danger`，或把紅藍寫反，前面每一條都照樣綠
   * （Codex 2026-08-09 審查指出）。
   */
  it('敵我各一個長機時，兩個框各自用自己的顏色、字也是', () => {
    const f = createHudFrame()
    const foe = f.contacts[0]!
    foe.active = true
    foe.flightLeader = true
    foe.hostile = true
    foe.x = -0.5
    foe.y = 0.5
    foe.radius = 0.05
    foe.flightAlive = 3
    foe.flightSize = 4

    const friend = f.contacts[1]!
    friend.active = true
    friend.flightLeader = true
    friend.hostile = false
    friend.x = 0.5
    friend.y = -0.5
    friend.radius = 0.05
    friend.flightAlive = 1
    friend.flightSize = 4

    f.contactCount = 2

    const { ctx, rects, texts } = fakeCtx()
    drawGodMarkers(ctx, LAYOUT, f)

    expect(rects).toHaveLength(2)
    expect(rects[0]!.color).toBe(HUD_COLORS.danger)
    expect(rects[1]!.color).toBe(HUD_COLORS.friendly)
    expect(texts.map((t) => t.color)).toEqual([HUD_COLORS.danger, HUD_COLORS.friendly])
    expect(texts.map((t) => t.text)).toEqual(['(3/4)', '(1/4)'])
  })
})

/**
 * 【接觸點池必須裝得下整場】`drawGodMarkers` 是從池子裡**過濾**長機的，
 * 而池子在 `main.ts` 是先到先得（`n >= HUD_MAX_CONTACTS` 就不再收）。
 * 池子若比參戰架數小，被擠掉的可能正好是某個分隊的長機 —— 那一隊就
 * **靜靜地沒有標示**，沒有錯誤、沒有警告（Codex 2026-08-09 審查指出）。
 *
 * 【為什麼這條護欄只能住在測試裡】`src/hud/` 不得 import `src/battle/`
 * （`HudFrame` 是純 DTO）。測試沒有這個限制，兩邊都 import 得到 ——
 * 與 `src/render/vortex.ts:131` 註解記的「為什麼不 import MAX_COMBATANTS」
 * 是同一個處置。
 */
describe('接觸點池的容量', () => {
  it('裝得下整場最大架數', () => {
    expect(HUD_MAX_CONTACTS).toBeGreaterThanOrEqual(MAX_COMBATANTS)
  })
})
