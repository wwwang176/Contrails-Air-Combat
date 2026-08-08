import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { createVortex } from '../../src/render/vortex'

const DT = 1 / 240
const SECONDS = 120

/** 翼尖的世界座標。與 `main.ts` 同一招：模組層暫存，迴圈裡不配置。 */
const TIP = new Vector3()
const TIP2 = new Vector3()

/**
 * 【這條護欄實際在守什麼】它看起來近乎恆真 —— `vortex.ts` 只 import `three`
 * 與 `./particles`，怎麼可能改到戰局？但這個專案裡有一個真的會踩到的機制：
 * **模組層級的共用暫存池**（`core/pool.ts` 的 `makeScratch`，`src/ai/` 與
 * `CameraRig` 都在用）。特效若借用了別人的池子，就會在別人用到一半時把內容
 * 改掉，而症狀是「戰局悄悄變了」而不是任何錯誤。
 *
 * 上帝視角那條同型的護欄（`god-view.test.ts` 的「鏡頭不得改變戰局」）就是
 * 為這個而寫的，這一條照抄它的做法。
 *
 * 它**守不到** `main.ts` 的算繪路徑（接線點接錯、翼尖換算用錯姿態之類），
 * 那一段沒有無頭測試 —— 由 Playwright 與手動試飛補。
 *
 * ── 【這條測試不是空的：兩個實驗】──
 *
 * 它一開始就是綠的，所以必須證明它抓得到東西。做了兩個實驗：
 *
 * **一、借用別人的暫存池 —— 沒有變紅。** 把 `ai/fire.ts` 的私有 `S`
 * 暫時 export 出來，讓 `vortex.emit` 每次都往 `S.v[0]` 塞 (1e9, 1e9, 1e9)。
 * 測試**照樣綠**（B2714:R1873 兩場相同）。原因是那個池子每次使用前都先寫
 * 再讀，幀與幀之間塗改它是無害的 —— 也就是說這個探針本身無效，不是護欄
 * 無效。真正危險的是「讀在寫之前」的暫存，而那種池子要一個一個找。
 *
 * **二、斷言的靈敏度 —— 變紅，而且非常靈敏。** 在 `on` 那一場對**一架**
 * 飛機注入 `velocity.x += 1e-9`（每物理步一次）。120 秒後藍隊掉血從
 * **2714.0 變成 1822.6**，紅隊 1873 → 1956 —— 三成的差距。
 *
 * 結論：這個比較能偵測到任意小的分歧，所以「兩場逐位元組相同」確實等價於
 * 「凝結尾沒有碰到戰局」。實驗二才是有意義的那一個。
 */
describe('凝結尾不得改變戰局（20v20、120 秒、兩場）', () => {
  function damage(stepVortex: boolean): { blue: number, red: number } {
    const b = createBattle(new AiController())
    const hp0 = b.world.combatants.map((c) => c.hp)
    const vortex = createVortex()
    for (let s = 0; s < SECONDS * 240; s++) {
      stepBattle(b, DT)
      if (stepVortex) {
        for (const c of b.world.combatants) {
          if (!c.alive) continue
          const p = c.aircraft.state.position
          const q = c.aircraft.state.orientation
          // 【2.8 是隨便取的一個約當半翼展】這條測的是「有沒有碰到共用暫存
          // 池」，翼尖精確在哪裡與它無關 —— 所以刻意不 import buildAircraft，
          // 那會把整個 src/render/geometry/ 拉進一條 120 秒 × 240 Hz 的迴圈
          // 裡，只為了兩個常數。真正要跑的是 applyQuaternion 這條路徑。
          TIP.set(-2.8, 0, 0).applyQuaternion(q).add(p)
          TIP2.set(2.8, 0, 0).applyQuaternion(q).add(p)
          vortex.emit(
            c.index, c.aircraft.diag.loadFactor,
            TIP.x, TIP.y, TIP.z, TIP2.x, TIP2.y, TIP2.z,
          )
        }
        vortex.step(DT)
      }
    }
    const out = { blue: 0, red: 0 }
    for (const c of b.world.combatants) {
      const lost = hp0[c.index]! - c.hp
      if (c.team === 'blue') out.blue += lost
      else out.red += lost
    }
    vortex.dispose()
    return out
  }

  it('推進凝結尾不改變任何一架的掉血', () => {
    const off = damage(false)
    const on = damage(true)
    console.log(JSON.stringify({
      off: `B${off.blue.toFixed(0)}:R${off.red.toFixed(0)}`,
      on: `B${on.blue.toFixed(0)}:R${on.red.toFixed(0)}`,
    }))
    expect(on.blue).toBe(off.blue)
    expect(on.red).toBe(off.red)
  }, 10 * 60 * 1000)
})
