import { describe, it, expect } from 'vitest'
import { createHudFrame, HUD_COLORS, type HudLayout } from '../../src/hud/types'
import {
  drawBombBay, releaseGateColor, releaseGateVisible,
} from '../../src/hud/widgets/bombBay'
import {
  BOMB_ENVELOPE, TORPEDO_ENVELOPE, canRelease,
} from '../../src/weapons/releaseEnvelope'

/**
 * 一定在包絡外的姿態。
 *
 * 【相對包絡取，不寫死度數】門檻是可調的。寫死 30° 的話，門檻只要放寬到
 * 30° 以上，這幾條就會因為**調參數**而不是**壞掉**變紅 —— 而且「出界」那個
 * 前提會靜靜地不成立，測試名字說的事其實沒有被測到。
 */
const OUT_ROLL = TORPEDO_ENVELOPE.maxRoll * 2
const OUT_PITCH = TORPEDO_ENVELOPE.maxPitch * 2

const LAYOUT: HudLayout = {
  width: 1280, height: 720, cx: 640, cy: 360, unit: 360, scale: 1,
}

function fakeCtx(): {
  ctx: CanvasRenderingContext2D
  texts: { text: string; x: number; color: string }[]
} {
  const texts: { text: string; x: number; color: string }[] = []
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    strokeStyle: '', fillStyle: '', lineWidth: 0,
    fillRect(): void {},
    strokeRect(): void {},
    // 【顏色要在呼叫的當下抄下來】`fillStyle` 會被下一格覆寫
    fillText(text: string, x: number): void {
      texts.push({ text, x, color: String(ctx.fillStyle) })
    },
  } as unknown as CanvasRenderingContext2D & { fillStyle: string }
  return { ctx, texts }
}

/** 掛一枚魚雷、平飛 100 m、姿態全在包絡內 */
function torpedoFrame(): ReturnType<typeof createHudFrame> {
  const f = createHudFrame()
  f.bombCapable = true
  f.ordnance = 'torpedo'
  f.bombBayCapacity = 1
  f.bombLoad = 1
  f.releaseEnv = TORPEDO_ENVELOPE
  f.releaseAgl = 100
  f.altitude = 100
  f.roll = 0
  f.pitch = 0
  return f
}

/** 閘門那三段文字（彈艙格子不畫字，所以剩下的都是它的） */
function gateTexts(f: ReturnType<typeof createHudFrame>): {
  text: string; x: number; color: string
}[] {
  const { ctx, texts } = fakeCtx()
  drawBombBay(ctx, LAYOUT, f)
  return texts
}

describe('releaseGateVisible', () => {
  it('掛魚雷、有艙、沒在裝填 → 畫', () => {
    expect(releaseGateVisible(torpedoFrame())).toBe(true)
  })

  /**
   * 【與「裝填中」二擇一】兩個都畫的話會在同一個 baseline 上疊字。
   */
  it('裝填中就讓位', () => {
    const f = torpedoFrame()
    f.bombReloading = true
    expect(releaseGateVisible(f)).toBe(false)
  })

  /**
   * 【炸彈不畫】`BOMB_ENVELOPE` 只擋退化狀態（倒飛、60 m），常態恆綠，
   * 畫出來是純噪音。
   */
  it('掛炸彈不畫', () => {
    const f = torpedoFrame()
    f.ordnance = 'bomb'
    f.releaseEnv = BOMB_ENVELOPE
    expect(releaseGateVisible(f)).toBe(false)
  })

  it('掛不了東西就不畫', () => {
    const f = torpedoFrame()
    f.bombCapable = false
    expect(releaseGateVisible(f)).toBe(false)
  })

  it('沒有包絡就不畫 —— 沒有門檻可以比', () => {
    const f = torpedoFrame()
    f.releaseEnv = null
    expect(releaseGateVisible(f)).toBe(false)
  })

  /**
   * 【不限投彈模式】它是儀表。進場的姿態要在切投彈模式**之前**就擺好，
   * 只在投彈模式顯示的話它出現得太晚 —— 與彈艙格子「釘在畫面下方而不是
   * 跟著準星走」同一條理由。
   */
  it('一般飛行照樣畫', () => {
    const f = torpedoFrame()
    f.bombing = false
    expect(releaseGateVisible(f)).toBe(true)
  })
})

describe('releaseGateColor', () => {
  it('過綠、不過紅', () => {
    expect(releaseGateColor(true)).toBe(HUD_COLORS.primary)
    expect(releaseGateColor(false)).toBe(HUD_COLORS.danger)
  })
})

/**
 * 【為什麼一定要驗畫出來的東西】只驗上面兩支純函數的話，下面每一種寫錯都
 * 全綠：
 *
 * ```
 *   坡度與俯仰兩格對調
 *   高度那一格讀 altitude 而不是 releaseAgl
 *   在繪圖函數裡重抄一份 12° 的比較
 *   裝填中的時候把閘門也一起畫上去
 * ```
 */
describe('drawBombBay 畫出來的閘門', () => {
  it('三段的順序是坡度、俯仰、高度', () => {
    const t = gateTexts(torpedoFrame())
    expect(t.length).toBe(3)
    expect(t[0]!.text.startsWith('坡度')).toBe(true)
    expect(t[1]!.text.startsWith('俯仰')).toBe(true)
    expect(t[2]!.text.startsWith('高度')).toBe(true)
    // 由左至右
    expect(t[0]!.x).toBeLessThan(t[1]!.x)
    expect(t[1]!.x).toBeLessThan(t[2]!.x)
  })

  it('全部在包絡內時三段都是綠的', () => {
    for (const t of gateTexts(torpedoFrame())) {
      expect(t.color, t.text).toBe(HUD_COLORS.primary)
    }
  })

  /**
   * 【一格只受自己那一軸影響】這一條殺的是「坡度與俯仰兩格對調」。
   */
  it('只有俯仰出界時，只有俯仰那一格紅', () => {
    const f = torpedoFrame()
    f.pitch = OUT_PITCH
    const t = gateTexts(f)
    expect(t[0]!.color).toBe(HUD_COLORS.primary)
    expect(t[1]!.color).toBe(HUD_COLORS.danger)
    expect(t[2]!.color).toBe(HUD_COLORS.primary)
  })

  it('只有坡度出界時，只有坡度那一格紅', () => {
    const f = torpedoFrame()
    f.roll = OUT_ROLL
    const t = gateTexts(f)
    expect(t[0]!.color).toBe(HUD_COLORS.danger)
    expect(t[1]!.color).toBe(HUD_COLORS.primary)
    expect(t[2]!.color).toBe(HUD_COLORS.primary)
  })

  it('坡度看絕對值 —— 左右一樣紅', () => {
    const f = torpedoFrame()
    f.roll = -OUT_ROLL
    expect(gateTexts(f)[0]!.color).toBe(HUD_COLORS.danger)
  })

  /**
   * 【高度跟著 `releaseAgl` 走，不是 `altitude`】這一條殺的是讀錯欄位。
   * 海上兩者相同，飛過島上空才分家 —— 症狀是閘門說可以投而扳機沒反應。
   */
  it('高度那一格讀 releaseAgl，不讀 altitude', () => {
    const f = torpedoFrame()
    f.altitude = 100      // 海拔留在包絡內
    f.releaseAgl = 900    // 離地已經超出上界
    const t = gateTexts(f)
    expect(t[2]!.color).toBe(HUD_COLORS.danger)
    expect(t[2]!.text).toContain('900')
  })

  /**
   * 【門檻跟著 `releaseEnv` 走】這一條殺的是「在繪圖函數裡重抄一份門檻」。
   */
  it('換一組包絡，同一組姿態的紅綠跟著翻', () => {
    const f = torpedoFrame()
    f.roll = OUT_ROLL
    expect(gateTexts(f)[0]!.color).toBe(HUD_COLORS.danger)
    // 放寬到剛好蓋過它：同一個坡度就變合法
    f.releaseEnv = { ...TORPEDO_ENVELOPE, maxRoll: OUT_ROLL * 1.5 }
    expect(gateTexts(f)[0]!.color).toBe(HUD_COLORS.primary)
  })

  /**
   * 【三格全綠 ⟺ canRelease】這是「錶上綠燈但投不出去」的守門員。
   */
  it('三格全綠恰好等於 canRelease（不限速時）', () => {
    const e = TORPEDO_ENVELOPE
    let sawTrue = false
    let sawFalse = false
    for (const roll of [0, e.maxRoll, e.maxRoll * 2]) {
      for (const pitch of [0, e.maxPitch, e.maxPitch * 2]) {
        for (const agl of [e.minAgl, e.maxAgl, e.maxAgl * 2]) {
          const f = torpedoFrame()
          f.roll = roll
          f.pitch = pitch
          f.releaseAgl = agl
          const allGreen = gateTexts(f).every((t) => t.color === HUD_COLORS.primary)
          const want = canRelease(e, roll, pitch, agl, 80)
          expect(allGreen, `roll=${roll} pitch=${pitch} agl=${agl}`).toBe(want)
          if (want) sawTrue = true
          else sawFalse = true
        }
      }
    }
    expect(sawTrue).toBe(true)
    expect(sawFalse).toBe(true)
  })

  /**
   * 【二擇一】這一條殺的是「兩個都畫」。
   */
  it('裝填中時畫得出「裝填中」，而且完全沒有閘門的三段', () => {
    const f = torpedoFrame()
    f.bombReloading = true
    f.bombReloadLeft = 12
    const t = gateTexts(f)
    expect(t.length).toBe(1)
    expect(t[0]!.text).toContain('裝填中')
    for (const s of ['坡度', '俯仰', '高度']) {
      expect(t.some((x) => x.text.includes(s)), s).toBe(false)
    }
  })

  it('掛炸彈時兩者都不畫', () => {
    const f = torpedoFrame()
    f.ordnance = 'bomb'
    f.releaseEnv = BOMB_ENVELOPE
    expect(gateTexts(f)).toEqual([])
  })

  /** 【炸彈的「裝填中」是既有行為，不得回歸】 */
  it('掛炸彈且裝填中時，「裝填中」照舊畫', () => {
    const f = torpedoFrame()
    f.ordnance = 'bomb'
    f.releaseEnv = BOMB_ENVELOPE
    f.bombBayCapacity = 10
    f.bombReloading = true
    f.bombReloadLeft = 8
    const t = gateTexts(f)
    expect(t.length).toBe(1)
    expect(t[0]!.text).toContain('裝填中')
  })
})
