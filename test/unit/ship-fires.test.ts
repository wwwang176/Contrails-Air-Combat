import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  FIRE_PUFF, FIRE_SECONDS, SHIP_FIRE_CAPACITY,
  createShipFires, lightShipFires, stepShipFires,
} from '../../src/render/shipFires'
import {
  SHIP_FIRE_PLUME_HEIGHT, SHIP_FIRE_PLUME_SPEED,
  SHIP_FIRE_SMOKE_DRAG, SHIP_FIRE_SMOKE_LIFE, plumeSpeed,
} from '../../src/render/smoke'
import { createImpacts, pushImpact } from '../../src/world/events'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'

/**
 * # 船上的火災
 *
 * 火點是**純裝飾** —— 不扣血、不影響 AI、不進判定。所以它住在算繪層，
 * 與 `sparks`／`smoke` 同一個性質。
 *
 * 【這一支守的是什麼】兩條會靜靜壞掉的性質：火點沒有跟著船走（船從火裡
 * 開出去），與燒的時間不對（燒不完或一瞬間就沒了）。兩者都不會報錯。
 */

const DT = 1 / 60

function ship(index = 0, x = 0, z = 0, speed = 0): Ship {
  return createShip(index, SHIP_CLASSES.wichita, 'red', x, z, 0, speed)
}

/** 收下每一朵迷你爆炸的世界座標。 */
function collector(): { at: Vector3[]; emit: (x: number, y: number, z: number) => void } {
  const at: Vector3[] = []
  return { at, emit: (x, y, z) => { at.push(new Vector3(x, y, z)) } }
}

describe('lightShipFires', () => {
  /** 【只有打中船的那一筆會起火】落水的那一顆在海上留不下火。 */
  it('命中船的事件起火，nz = −1 的不起火', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    const s = ship()
    pushImpact(ev, 10, 5, -20, 2, 11_700, 0)
    pushImpact(ev, 400, 0, 0, 1, 11_700, -1)
    lightShipFires(fires, ev, [s])
    expect(fires.live).toBe(1)
  })

  /**
   * 【存的是艦體座標】船在動。存世界座標的話火會留在原地，船從火裡開出去
   * —— 而畫面上那看起來像「海面上有一團火」，不像缺陷。
   *
   * 【一定要驗絕對位置，不能只驗位移】把「換算回艦體座標」整段刪掉之後，
   * 讀回來時仍然會加上船的位置，所以**位移完全相同** —— 只驗位移的話那個
   * 錯誤活得下來（實測過）。錯的是絕對位置：火跑到了 `命中點 + 船的位置`。
   */
  it('火點存成艦體座標：第一朵落在命中點上，之後跟著船走', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    // 【船不在原點】原點的話艦體座標與世界座標完全相同，什麼都驗不出來
    const s = ship(0, 0, 500, 10)
    pushImpact(ev, 30, 5, 480, 2, 11_700, 0)
    lightShipFires(fires, ev, [s])

    const a = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [s], DT, a.emit)
    expect(a.at.length).toBeGreaterThan(0)
    expect(a.at[0]!.x).toBeCloseTo(30, 3)
    expect(a.at[0]!.y).toBeCloseTo(5, 3)
    expect(a.at[0]!.z).toBeCloseTo(480, 3)

    // 艏向 0 = 朝 −Z。開 10 秒 = 100 m
    s.position.z -= 100
    const b = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [s], DT, b.emit)
    expect(b.at[0]!.z).toBeCloseTo(380, 3)
  })

  /**
   * 【艏向也要跟】只抄位置不套四元數的話，轉過向的船火點會在錯的舷側。
   * 同樣驗絕對位置 —— 理由見上一條。
   */
  it('火點跟著艏向轉', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    // 艏向 90°：艦體的 +X 指向世界的 −Z
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 100, 200, Math.PI / 2, 0)
    // 右舷 20 m ＝ 艦體 +X ＝ 世界 (100, 5, 180)
    pushImpact(ev, 100, 5, 180, 2, 11_700, 0)
    lightShipFires(fires, ev, [s])

    const a = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [s], DT, a.emit)
    expect(a.at[0]!.x).toBeCloseTo(100, 3)
    expect(a.at[0]!.z).toBeCloseTo(180, 3)

    // 轉回艏向 0：同一個艦體座標現在指向世界的 +X
    const turned = createShip(0, SHIP_CLASSES.wichita, 'red', 100, 200, 0, 0)
    const b = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [turned], DT, b.emit)
    expect(b.at[0]!.x).toBeCloseTo(120, 3)
    expect(b.at[0]!.z).toBeCloseTo(200, 3)
  })

  /**
   * 【池滿了覆寫最舊的】火是純裝飾，掉一個沒有人看得出來。
   *
   * 【光看 `live === 容量` 不夠】改成「滿了就拒絕新火點」也會得到同一個
   * 數字。真正的差別在**內容**：第 65 個要在，
   * 而第 1 個要被它蓋掉。
   */
  it('超過容量就覆寫最舊的，不會拒絕起火', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    const s = ship()
    // 第 i 個火點的 x 就是 i —— 用它認出哪幾個還在
    for (let i = 0; i < SHIP_FIRE_CAPACITY + 1; i++) {
      ev.count = 0
      pushImpact(ev, i, 5, 0, 2, 11_700, 0)
      lightShipFires(fires, ev, [s])
    }
    expect(fires.live).toBe(SHIP_FIRE_CAPACITY)
    const xs = Array.from(fires.x)
    // 最新的那一個進來了
    expect(xs).toContain(SHIP_FIRE_CAPACITY)
    // 最舊的那一個被它蓋掉了（環狀指標繞回第 0 格）
    expect(xs).not.toContain(0)
  })

  /**
   * 【魚雷的火要抬到水線】`onTorpedoEnd` 推的 y 是**雷體自己的高度** ——
   * 定深 −1 m。照抄的話那根 200 m 的煙柱從水面底下長出來。
   *
   * 艦體座標的原點就在水線上（`world/ships.ts`），所以夾在 0 等於夾在水面。
   */
  it('水線以下的命中點抬到水線', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    const s = ship(0, 0, 300)
    // 魚雷命中舷側，y = −1（定深）
    pushImpact(ev, 12, -1, 300, 1, 15_000, 0)
    lightShipFires(fires, ev, [s])

    const c = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(c.at[0]!.y).toBe(0)
    // 橫向不動 —— 夾的只有高度
    expect(c.at[0]!.x).toBeCloseTo(12, 4)
    expect(c.at[0]!.z).toBeCloseTo(300, 4)
  })

  /** 【甲板上的不受影響】夾錯邊的話炸彈的火會全部掉到水面。 */
  it('水線以上的命中點原樣保留', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    const s = ship(0, 0, 300)
    pushImpact(ev, 5, 7, 300, 2, 11_700, 0)
    lightShipFires(fires, ev, [s])

    const c = collector()
    for (let i = 0; i < 1 / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(c.at[0]!.y).toBeCloseTo(7, 4)
  })

  /** 【找不到那一艘就不起火】索引對不上時寧可不畫，也不要讀到 undefined。 */
  it('索引指向不存在的船就不起火', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    pushImpact(ev, 0, 5, 0, 2, 11_700, 7)
    lightShipFires(fires, ev, [ship()])
    expect(fires.live).toBe(0)
  })
})

/**
 * # 煙柱的高度
 *
 * 【為什麼要反解而不是寫死一個速度】柱高與初速之間隔著阻尼。寫死一個
 * 「看起來差不多」的速度的話，改了壽命或阻尼之後柱高就不對了，而症狀只是
 * 「煙柱好像有點矮」。
 */
describe('plumeSpeed', () => {
  /**
   * 【逐格積分驗證】把粒子系統的積分式在這裡重跑一遍
   * （`v ← v·exp(−drag·dt)`、`y ← y + v·dt`），確認 `plumeSpeed` 給的初速
   * 真的會在壽命結束時爬到目標高度。
   *
   * **這是這一支唯一真正的內容** —— 閉式解與實際積分器對不上的話，公式
   * 再漂亮也沒有用。
   */
  it('照它給的初速跑完壽命，剛好爬到目標高度', () => {
    const dt = 1 / 60
    for (const target of [100, SHIP_FIRE_PLUME_HEIGHT, 400]) {
      let v = plumeSpeed(target)
      let y = 0
      const damp = Math.exp(-SHIP_FIRE_SMOKE_DRAG * dt)
      for (let t = 0; t < SHIP_FIRE_SMOKE_LIFE; t += dt) {
        v *= damp
        y += v * dt
      }
      // 離散積分與閉式解差 1% 以內
      expect(y, `${target} m`).toBeGreaterThan(target * 0.99)
      expect(y, `${target} m`).toBeLessThan(target * 1.01)
    }
  })

  /** 【送出去的就是那一個高度算出來的】接錯常數的話柱高會靜靜地跑掉。 */
  it('SHIP_FIRE_PLUME_SPEED 就是 200 m 反解出來的初速', () => {
    expect(SHIP_FIRE_PLUME_SPEED).toBe(plumeSpeed(SHIP_FIRE_PLUME_HEIGHT))
    expect(SHIP_FIRE_PLUME_HEIGHT).toBe(200)
  })
})

describe('stepShipFires', () => {
  const light = (): ReturnType<typeof createShipFires> => {
    const fires = createShipFires()
    const ev = createImpacts()
    pushImpact(ev, 0, 5, 0, 2, 11_700, 0)
    lightShipFires(fires, ev, [ship()])
    return fires
  }

  /**
   * 【節拍是 FIRE_PUFF，不是每幀一朵】每幀一朵的話 60 fps 下一分鐘是 3,600
   * 朵爆炸 —— 那不是火災，是一台機關槍。
   */
  it('速率是每 FIRE_PUFF 秒一朵：3 秒 10 朵、6 秒 20 朵', () => {
    const s = ship()
    const count = (seconds: number): number => {
      const c = collector()
      const fires = light()
      for (let i = 0; i < seconds / DT; i++) stepShipFires(fires, [s], DT, c.emit)
      return c.at.length
    }
    // 【第一朵在命中的那一瞬間】`puff` 起始值是 0，所以第一步就放 ——
    // 不然玩家要等 0.3 秒才看得到命中處起火
    expect(count(3)).toBe(Math.round(3 / FIRE_PUFF))
    expect(count(6)).toBe(Math.round(6 / FIRE_PUFF))
  })

  /** 【燒滿一分鐘】少了就是「炸完閃一下」，多了就是永遠燒下去。 */
  it('燒 FIRE_SECONDS 秒之後熄掉', () => {
    const fires = light()
    const s = ship()
    const c = collector()
    for (let i = 0; i < (FIRE_SECONDS - 1) / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(fires.live).toBe(1)
    for (let i = 0; i < 2 / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(fires.live).toBe(0)
  })

  /** 【熄了就不再噴】計時歸零卻繼續噴的話，一分鐘後海上還在放煙火。 */
  it('熄掉之後不再噴', () => {
    const fires = light()
    const s = ship()
    for (let i = 0; i < (FIRE_SECONDS + 1) / DT; i++) {
      stepShipFires(fires, [s], DT, () => {})
    }
    const c = collector()
    for (let i = 0; i < 5 / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(c.at.length).toBe(0)
  })

  /**
   * 【沉了照樣燒完】一艘剛沉的船在海面上冒煙是對的。
   */
  it('船沉了，既有的火照樣燒完', () => {
    const fires = light()
    const s = ship()
    s.alive = false
    const c = collector()
    for (let i = 0; i < 3 / DT; i++) stepShipFires(fires, [s], DT, c.emit)
    expect(fires.live).toBe(1)
    expect(c.at.length).toBeGreaterThan(0)
  })

  /**
   * 【致命的那一擊也要起火】`World` 是**先扣血、`sinkIfDead`，再推事件**
   * （`onBombImpact` / `onTorpedoEnd`），所以打沉一艘船的那一顆送到
   * `lightShipFires` 時，那艘船已經是 `alive === false`。
   *
   * 【為什麼要單獨釘這一條】上面那一條是先點火再把船設死，順序與實戰相反
   * —— 有人在 `lightShipFires` 加一道看起來很合理的 `!s.alive` 過濾的話，
   * 致命一擊不會起火，而上面那一條照樣綠。
   */
  it('打沉那一發也要起火 —— 事件推出來時船已經沉了', () => {
    const fires = createShipFires()
    const ev = createImpacts()
    const s = ship()
    s.alive = false
    pushImpact(ev, 0, 5, 0, 2, 11_700, 0)
    lightShipFires(fires, ev, [s])
    expect(fires.live).toBe(1)
  })

  /**
   * 【換一場要歸零】不然上一場的火會用同一個船索引附到新一場的船上，
   * 燒滿 60 秒。名字是 `reset` 才進得了 `main.ts` 的 `POOLS`。
   */
  it('reset 之後不留任何一個火點', () => {
    const fires = light()
    fires.reset()
    expect(fires.live).toBe(0)
  })
})
