import { describe, expect, it } from 'vitest'
import { BATTLE_HAZE, BATTLE_HALF, toLocal } from '../../src/world/kursk'
import { MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob(['../../src/main.ts', '../../src/render/heightFogInstall.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const src = (name: string): string =>
  Object.entries(SOURCES).find(([k]) => k.endsWith(name))![1].replace(/\r\n/g, '\n')
const MAIN = src('main.ts')
const body = (from: string, to: string): string => {
  const at = MAIN.indexOf(from)
  return MAIN.slice(at, MAIN.indexOf(to, at))
}

describe('戰場高度霧的接線', () => {
  it('德 M4 的卡片帶著霧的範圍，圓心在戰場中央，半徑蓋得住整個戰場框的四角', () => {
    const card = MISSIONS.germany.find((c) => c.id === 'germany-m4') as ReadyMissionCard
    expect(card.battle.theater!.haze).toEqual(BATTLE_HAZE)
    const c = toLocal(BATTLE_HAZE.x, BATTLE_HAZE.z)
    expect(Math.abs(c.lx)).toBeLessThan(50)
    expect(Math.abs(c.lz)).toBeLessThan(300)
    expect(BATTLE_HAZE.radius).toBeGreaterThanOrEqual(Math.hypot(BATTLE_HALF, BATTLE_HALF))
  })

  /**
   * 【安裝時機】霧的 chunk 與 uniform 表一定要在第一次編譯任何著色器、建任何自訂材質的字典之前改好；
   * 之前編好的 program 與之前建好的字典不會有霧，而且不報錯。所以它是 `main.ts` 的第一個 import，
   * 而且是一個有副作用的小模組（ES 模組依 import 順序求值，放在 `main.ts` 本體裡呼叫就太晚了）。
   */
  it('安裝是 main.ts 的第一個 import，安裝模組一載入就呼叫', () => {
    const firstImport = MAIN.split('\n').find((l) => l.startsWith('import '))!
    expect(firstImport).toBe("import './render/heightFogInstall'")
    const install = src('heightFogInstall.ts')
    expect(install).toContain("import { installHeightFog } from './heightFog'")
    expect(install).toContain('installHeightFog()')
  })

  /** 每一場依卡片開、離場與換場都關：只在換場時關的話，放棄任務回到選單後霧會留在選單的背景裡 */
  it('每一場依卡片開霧；離場與換場跟地面戰的戲一起關', () => {
    expect(MAIN).toContain('setBattleFog(')
    expect(MAIN).toContain('theater.haze')
    const release = body('function releaseGroundBattle', '\n}\n')
    expect(release).toContain('clearBattleFog()')
  })

  it('每幀吃世界秒數，暫停時團塊停在原地', () => {
    expect(MAIN).toContain('stepBattleFog(worldSeconds)')
  })
})
