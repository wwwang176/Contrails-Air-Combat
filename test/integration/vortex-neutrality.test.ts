import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createBattle, stepBattle, DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import { createVortex } from '../../src/render/vortex'
import { replayDigest } from '../tools/spawn-snapshot'

const DT = 1 / 240
const SECONDS = 20

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
 * ── 【為什麼比的是完整狀態校驗和，不是掉血】────────────────
 *
 * 掉血只在子彈命中時才動，所以要先讓兩隊接敵、開火，才看得出分歧 ——
 * 那是一場 20v20 打滿 120 秒。**改比 `replayDigest`（每一架的位置、姿態、
 * 角速度、作動器、血量、彈丸池）之後，分歧在幾個物理步內就顯示得出來**，
 * 因為位置每一步都在變。同一件事守得更嚴，而且 4v4 × 20 秒就夠。
 *
 * ── 【證明它抓得到東西：兩個實驗】──────────────────────
 *
 * **一、借用別人的暫存池 —— 沒有變紅。** 把 `ai/fire.ts` 的私有 `S`
 * 暫時 export 出來，讓 `vortex.emit` 每次都往 `S.v[0]` 塞 (1e9, 1e9, 1e9)。
 * 測試**照樣綠**。原因是那個池子每次使用前都先寫再讀，幀與幀之間塗改它是
 * 無害的 —— 也就是說這個探針本身無效，不是護欄無效。真正危險的是
 * 「讀在寫之前」的暫存，而那種池子要一個一個找。
 *
 * **二、斷言的靈敏度 —— 變紅。** 在 `on` 那一場對**一架**飛機注入
 * `velocity.x += 1e-9`（每物理步一次），校驗和立刻不同。
 *
 * 結論：這個比較偵測得到任意小的分歧，所以「兩場校驗和相同」確實等價於
 * 「凝結尾沒有碰到戰局」。
 */
describe('凝結尾不得改變戰局（4v4、20 秒、兩場）', () => {
  async function run(stepVortex: boolean): Promise<string> {
    const b: Battle = createBattle(new AiController(), {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    })
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
          // 那會把整個 src/render/geometry/ 拉進這條迴圈裡，只為了兩個常數。
          // 真正要跑的是 applyQuaternion 這條路徑。
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
    const digest = await replayDigest(b)
    vortex.dispose()
    return digest
  }

  it('推進凝結尾不改變任何一架的狀態', async () => {
    expect(await run(true)).toBe(await run(false))
  }, 5 * 60 * 1000)
})
