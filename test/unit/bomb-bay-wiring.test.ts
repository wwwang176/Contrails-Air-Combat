import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 彈艙的接線護欄 —— **讀 `main.ts` 的原始碼**。
 *
 * 守的是「`stepBombBay` 不在任何視角分支裡」。關進去的話回補與連投節拍會在
 * 那個視角之外凍住，而 `bomb-bay.test.ts` 抓不到 —— 那一支測的是「餵它 dt
 * 會怎樣」，這裡的缺陷是**沒有人餵它**。
 *
 * 【判斷方式是順序，不是括號配對】`main.ts` 有樣板字串與大量中文註解，數
 * 大括號會誤判，而會誤報的護欄比沒有護欄更糟。相機的兩個分支各有一行只出現
 * 在自己那一支的呼叫；彈艙排在兩者之前就代表它不在任何一支裡面。
 */
const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).split('\n')

/** 唯一一行含 `needle` 的行號。找不到或找到多行都讓測試失敗 —— 那代表這支護欄該重寫 */
function only(needle: string): number {
  const hits: number[] = []
  for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
  expect(hits, `main.ts 裡「${needle}」應該只出現一次，實際 ${hits.length} 次`).toHaveLength(1)
  return hits[0]!
}

describe('彈艙的接線：不得被關進任何視角分支', () => {
  // 【針對呼叫本身，不針對引數的名字】守的是「這一行在哪裡」。釘住引數名
  // 的話，改名就會讓護欄靜靜地失效：`bombBay` 改成 `playerBay()` 之後，
  // 這一支變成 0 個相符而不是位置錯了
  const bay = only('stepBombBay(')
  const godBranch = only('stepGodCamera(godCam')
  const flyBranch = only('rig.update(')

  it('排在上帝視角分支之前 —— 按 G 不得凍住回補與連投節拍', () => {
    expect(bay).toBeLessThan(godBranch)
  })

  it('排在座艙／機外分支之前 —— 那一支是相機，與彈艙無關', () => {
    expect(bay).toBeLessThan(flyBranch)
  })

  it('投彈點與彈艙同一格，否則連投中途換視角會從凍住的位置投出去', () => {
    const eye = only('BOMB_EYE.copy(bp)')
    expect(eye).toBeLessThan(bay)
    expect(bay - eye).toBeLessThan(6)
  })

  /**
   * 【吃這一幀真的跑過的物理時間，不吃畫面時間】物理每幀最多補 8 步，低於
   * 30 fps 時世界變慢。吃畫面時間的話裝填照現實時鐘走，慢的電腦上裝填期間
   * 世界過的時間比較短 —— AI 的彈艙在 `World` 裡吃物理 dt，兩邊就不公平
   */
  it('吃這一幀累加的物理時間，與 AI 的彈艙同一個時鐘', () => {
    expect(SRC[bay]!).toContain('physicsSeconds')
    expect(SRC[bay]!).not.toContain('frameSeconds')
    const advance = only('loop.advance(frameSeconds, (dt) => {')
    const add = only('physicsSeconds += dt')
    expect(add).toBeGreaterThan(advance)
    expect(add).toBeLessThan(bay)
  })

  it('包住它的條件只看「掛不掛得了彈」，不看視角', () => {
    // 往上找最近的一行 `if (`
    let i = bay
    while (i > 0 && !SRC[i]!.trimStart().startsWith('if (')) i--
    const guard = SRC[i]!.trim()
    expect(guard).toContain('bp !== null')
    expect(guard).not.toContain('viewMode')
    expect(guard).not.toContain('godView')
  })
})

/**
 * # 標記的接線護欄 —— 同樣讀 `main.ts` 的原始碼
 *
 * 守的是「`fillMarkers` 真的被叫到」。`hud-marker-feed.test.ts` 是**直接**
 * 呼叫那支函數，所以把 `main.ts` 裡那一行刪掉不會讓任何測試紅 ——
 * 而 `HudFrame` 開出來 `markerCount` 是 0、widget 只讀前 `markerCount` 格，
 * 症狀就是**整組標記一個都不畫，而且沒有任何錯誤訊息**。
 * 與上面那一支是同一個手法、同一個理由。
 */
describe('標記的接線：`fillMarkers` 必須真的被呼叫', () => {
  const fill = only('fillMarkers(')

  it('不在任何視角分支裡 —— 三種視角都要畫標記', () => {
    let i = fill
    while (i > 0 && !SRC[i]!.trimStart().startsWith('if (')) i--
    const guard = SRC[i]!.trim()
    expect(guard).not.toContain('viewMode')
    expect(guard).not.toContain('godView')
  })

  /** 【兩個池都要餵】少一個就是「魚雷沒有標記」，而且不會有錯誤訊息 */
  it('炸彈與魚雷兩個池都接上去', () => {
    const near = SRC.slice(Math.max(0, fill - 6), fill).join('\n')
    expect(near).toContain('world.bombs')
    expect(near).toContain('world.torpedoes')
  })
})

/**
 * # 火災的接線護欄 —— 同樣讀 `main.ts` 的原始碼
 *
 * `ship-fires.test.ts` 直接呼叫 `lightShipFires`，所以把 `main.ts` 裡那兩行
 * 刪掉不會讓任何測試紅。而症狀是**一個火點都不會出現、零錯誤訊息**。
 *
 * **順序是這支護欄真正的內容**：兩份命中事件都在物理子步裡被 `clearImpacts`
 * 清掉。起火排在排空之後的話讀到的永遠是空的。
 */
describe('火災的接線：起火必須排在事件排空之前', () => {
  const lines = (needle: string): number[] => {
    const hits: number[] = []
    for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
    return hits
  }

  it('炸彈與魚雷兩份事件都拿去起火', () => {
    expect(lines('lightShipFires(')).toHaveLength(2)
    const near = lines('lightShipFires(').map((i) => SRC[i]!).join('\n')
    expect(near).toContain('world.bombEvents')
    expect(near).toContain('world.torpedoEvents')
  })

  it('每一個 clearImpacts 的命中事件之前都先起火', () => {
    for (const events of ['world.bombEvents', 'world.torpedoEvents']) {
      const light = lines(`lightShipFires(shipFires, ${events}`)
      const clear = lines(`clearImpacts(${events})`)
      expect(light, events).toHaveLength(1)
      expect(clear, events).toHaveLength(1)
      expect(light[0]!, events).toBeLessThan(clear[0]!)
    }
  })

  /** 【燃燒一幀推一次】它是純裝飾。塞進物理子步的話一幀會燒好幾次。 */
  it('stepShipFires 吃的是 worldSeconds', () => {
    const step = lines('stepShipFires(')
    expect(step).toHaveLength(1)
    expect(SRC[step[0]!]!).toContain('worldSeconds')
  })
})

/**
 * # 畫面那一側的時鐘 —— 同樣讀 `main.ts` 的原始碼
 *
 * 低於 30 fps 時物理丟時間、世界變慢。特效、螺旋槳與鏡頭吃畫面時間的話會比
 * 世界快，慢的電腦上看起來像兩個速度。它們要吃 `worldSeconds`。
 */
describe('特效、螺旋槳與鏡頭跟世界同一個時鐘', () => {
  const all = SRC.join('\n')

  it('特效沒有任何一支還吃 frameSeconds', () => {
    expect(all).not.toMatch(/\.step\(frameSeconds/)
  })

  it('螺旋槳、座艙鏡頭、過渡與震動吃 worldSeconds', () => {
    expect(all).toContain('propRotation += worldSeconds')
    expect(all).toContain('input.lookPitch, worldSeconds')
    expect(all).toContain('applyBlend(godBlend, ctx.camera, worldSeconds)')
    expect(all).toContain('stepCameraShake(cameraShake, worldSeconds)')
  })

  it('海浪與地形讀的 elapsed 也只前進世界的時間', () => {
    expect(all).toContain('const world = loop.worldSeconds(sim)')
    expect(all).toContain('elapsed += world')
    expect(all).not.toContain('elapsed += sim')
  })
})

/**
 * # 地面目標的標記接線
 *
 * `hud-marker-feed.test.ts` 直接呼叫 `fillMarkers`，所以 `main.ts` 忘了把
 * `world.groundTargets` 傳進去不會讓任何測試紅 —— 症狀是**畫面上沒有任何
 * 建築的標記**，而船與炸彈的都在。呼叫是多行的，看呼叫起點之後幾行。
 */
describe('標記的接線：地面目標必須傳進 `fillMarkers`', () => {
  it('呼叫的引數裡有 world.groundTargets', () => {
    const fill = only('fillMarkers(')
    const call = SRC.slice(fill, fill + 4).join('\n')
    expect(call).toContain('world.ships')
    expect(call).toContain('world.groundTargets')
  })
})

/**
 * 代飛（按 I、上帝視角）的那一顆 `playerAi` 要看得到玩家那一架的彈艙 ——
 * 否則它只會掃射，與同一關的友軍 AI 行為不同。不會報錯。
 */
describe('代飛接上玩家的彈艙', () => {
  const ALL = SRC.join('\n')

  it('playerAi.bombBay 接的是玩家那一架的彈艙', () => {
    expect(ALL).toContain('playerAi.bombBay = player.bombBay')
    expect(ALL).not.toMatch(/playerAi\.bombBay = null/)
  })

  it('雷擊或投彈的航路跟著玩家的掛載', () => {
    expect(ALL).toMatch(/playerAi\.strikeProfile = player\.loadout\?\.kind === 'torpedo'/)
  })
})
