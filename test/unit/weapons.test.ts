import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { batteryDps, mountDirection, MAX_MOUNTS } from '../../src/weapons/types'
import { stepCadence } from '../../src/weapons/cadence'
import { M2_BROWNING, P51D_BATTERY } from '../../src/weapons/p51d'
import { BF109K4_BATTERY, MG131, MK108 } from '../../src/weapons/bf109k4'
import { F6F5_BATTERY } from '../../src/weapons/f6f5'
// 跨模組：MK 108 的單發傷害是拿 hp 校準的，所以要讀機體資料。
// 與 hitbox.test.ts 守「槍口在機翼命中盒內」是同一個模式。
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import { KI84 } from '../../src/specs/ki84'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { P51D } from '../../src/specs/p51d'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'

/**
 * L2 史實值：資料表本身就是被測物，與 M1 的 specs.test.ts 同一個模式。
 * 這些數字若被「調參」動過，這裡就該紅。
 */
describe('L2 武器史實值', () => {
  it('M2 Browning .50 cal：887 m/s、800 rpm、機翼 6 挺', () => {
    expect(M2_BROWNING.muzzleVelocity).toBe(887)
    expect(M2_BROWNING.roundsPerMinute).toBe(800)
    expect(P51D_BATTERY.mounts).toHaveLength(6)
    expect(P51D_BATTERY.mounts.every((m) => m.weapon === M2_BROWNING)).toBe(true)
  })

  it('MK 108：505 m/s、650 rpm、單門穿槳轂', () => {
    expect(MK108.muzzleVelocity).toBe(505)
    expect(MK108.roundsPerMinute).toBe(650)
    const axial = BF109K4_BATTERY.mounts.filter((m) => m.weapon === MK108)
    expect(axial).toHaveLength(1)
    // 穿槳轂＝在中軸線上
    expect(axial[0]!.position.x).toBe(0)
  })

  it('MG 131：750 m/s、900 rpm、機首左右各一', () => {
    expect(MG131.muzzleVelocity).toBe(750)
    expect(MG131.roundsPerMinute).toBe(900)
    const cowl = BF109K4_BATTERY.mounts.filter((m) => m.weapon === MG131)
    expect(cowl).toHaveLength(2)
    expect(cowl[0]!.position.x).toBeCloseTo(-cowl[1]!.position.x, 9)
  })

  it('P-51 的六挺翼槍左右對稱，而且真的在機翼上', () => {
    const xs = P51D_BATTERY.mounts.map((m) => m.position.x).sort((a, b) => a - b)
    for (let i = 0; i < 3; i++) expect(xs[i]).toBeCloseTo(-xs[5 - i]!, 9)
    // 離中軸線超過機身半寬（0.45），否則就不是翼槍了
    expect(Math.min(...xs.map(Math.abs))).toBeGreaterThan(0.5)
  })

  it('F6F-5 的六挺翼槍左右對稱，而且在摺翼線（x = 2.00）之外', () => {
    const xs = F6F5_BATTERY.mounts.map((m) => m.position.x).sort((a, b) => a - b)
    for (let i = 0; i < 3; i++) expect(xs[i]).toBeCloseTo(-xs[5 - i]!, 9)
    // 【為什麼門檻是 2.00 而不是機身半寬】F6F 的外翼是 Sto-Wing 折疊段，
    // 槍艙在摺線外側 —— 摺翼肋與鉸鏈佔滿內側，槍裝不進去。摺線位置由參考
    // 模型的上反角折點量到 2.00 m，見 `weapons/f6f5.ts`。這一條守的是那個
    // 結構事實，不是「離中軸線夠遠」這種泛泛的檢查。
    expect(Math.min(...xs.map(Math.abs))).toBeGreaterThan(2.0)
  })

  /**
   * 【為什麼要有這一條】兩台裝的是同一款 AN/M2，`weapons/f6f5.ts` 因此
   * **指向** P-51D 那個 `M2_BROWNING` 物件而不是抄一份數字。抄一份的失敗
   * 模式很安靜：日後調 M2 的傷害時只調到一半，兩台的 .50 從此不一樣重，
   * 而沒有任何東西會紅。這一條把「指的是同一挺」釘死。
   */
  it('F6F-5 與 P-51D 用的是同一個 M2 物件，所以彈道與傷害必然相同', () => {
    expect(F6F5_BATTERY.mounts.every((m) => m.weapon === M2_BROWNING)).toBe(true)
    expect(F6F5_BATTERY.sight).toBe(M2_BROWNING)
    expect(batteryDps(F6F5_BATTERY)).toBe(batteryDps(P51D_BATTERY))
    // 【TTK 不再相同，而那正是重點】火力逐項相同，但 2026-09-01 起血量
    // 正比於質量 —— F6F-5 由 1000 升到 1270，所以打爆它要多花 27% 的時間。
    // 這一條釘的是「差別**只**來自血量」：兩台的 DPS 必須逐位元相等。
    expect(F6F5.hp / batteryDps(F6F5_BATTERY)).toBeCloseTo(0.882, 3)
    expect(P51D.hp / batteryDps(P51D_BATTERY)).toBeCloseTo(0.694, 3)
  })

  /**
   * 【翼槍機的匯聚距離必須一致】1,000 m 是專案負責人在 M10 對翼槍下的
   * 裁決。兩台同樣是六挺 .50 的翼槍機，匯聚點不同就等於偷偷改了平衡 ——
   * 而那個差別只會在遠距離的彈著散佈上看得出來，不會有任何測試紅。
   */
  it('兩台翼槍機的匯聚距離相同', () => {
    expect(F6F5_BATTERY.convergence).toBe(P51D_BATTERY.convergence)
  })
})

/**
 * L3 平衡：守的是**相對關係**，不是絕對值（spec §6.3 明示數值可調）。
 */
describe('L3 火力平衡的相對關係', () => {
  it('MK 108 的單發傷害顯著高於 .50 BMG', () => {
    // 30 mm Minengeschoss 對 .50 BMG。上一版的 MG 151/20 是 ×4.7，
    // 換上 MK 108 之後是 ×13.9——門檻仍寫 ×3，守的是「量級不同」這件事。
    expect(MK108.damage).toBeGreaterThan(M2_BROWNING.damage * 3)
  })

  /**
   * 【史實校準】MK 108 公認需要約 4 發解決單發戰鬥機、約 20 發解決
   * 四發轟炸機。hp 見 specs/*.ts，部位倍率 1.0（機身）。
   */
  it('MK 108 打單發戰鬥機約 4 發、打 B-17G 約 20 發', () => {
    expect(Math.ceil(BF109K4.hp / MK108.damage)).toBe(4)
    expect(Math.ceil(B17G.hp / MK108.damage)).toBe(20)
  })

  /**
   * 初速是 MK 108 在本模型裡**唯一**被模擬到的代價（彈藥量沒有模型，
   * 見 weapons/bf109k4.ts 的說明）。它必須明顯慢，否則 K-4 的換槍
   * 就是純粹的免費升級。
   */
  it('MK 108 的初速明顯低於三挺 .50 與 MG 131', () => {
    expect(MK108.muzzleVelocity).toBeLessThan(M2_BROWNING.muzzleVelocity * 0.6)
    expect(MK108.muzzleVelocity).toBeLessThan(MG131.muzzleVelocity * 0.7)
  })

  /**
   * 預瞄環的基準槍取掛架中**初速最快**的那一挺（MG 131），不是傷害最高的
   * MK 108。理由與取捨見 weapons/bf109k4.ts 的 `sight` 註解：環更貼目標、
   * 好瞄，代價是慢速的主砲在中遠距離偏後。這裡釘住「選的是最快那挺」。
   */
  it('K-4 預瞄基準槍是掛架中初速最快的（MG 131）', () => {
    const fastest = BF109K4_BATTERY.mounts.reduce((a, b) =>
      b.weapon.muzzleVelocity > a.weapon.muzzleVelocity ? b : a).weapon
    expect(BF109K4_BATTERY.sight).toBe(fastest)
    expect(BF109K4_BATTERY.sight).toBe(MG131)
  })

  it('Bf 109 的總 DPS 高於 P-51', () => {
    expect(batteryDps(BF109K4_BATTERY)).toBeGreaterThan(batteryDps(P51D_BATTERY))
  })

  it('DPS 對得上設計值（P-51 1440、K-4 3608.33）', () => {
    // 【2026-08-09：三個單發傷害一律 ×3】專案負責人的調參決定，DPS 因此
    // 由 480 / 626.67 變成 1440 / 1880。**精度沒有放寬** —— 還是 0 位與
    // 1 位小數，只是被釘住的值換成了新的設計值。
    //
    // 【2026-08-25：109 由 G-6 換成 K-4】專案負責人裁決「武器也要改一下
    // 攻擊力更高」。中軸砲 MG 151/20（700 rpm × 84）換成 MK 108
    //（650 rpm × 250），DPS 由 1880 變成 3608.33：
    //
    //   MK 108     650/60 × 250 = 2708.33
    //   MG 131 ×2  900/60 ×  30 ×2 = 900.00
    //
    // 對 P-51 的比值由 1.31 變成 **2.51**。這是知情的取捨，不是失手——
    // 代價寫在 weapons/bf109k4.ts（初速 −245 m/s）與「沒有彈藥模型」
    // 那一段。spec §6.3 的表已被這次裁決取代。
    expect(batteryDps(P51D_BATTERY)).toBeCloseTo(1440, 0)
    expect(batteryDps(BF109K4_BATTERY)).toBeCloseTo(3608.33, 1)
  })
})

describe('mountDirection（匯聚幾何）', () => {
  const out = new Vector3()

  it('射向只在橫向匯聚，縱向與瞄準線平行', () => {
    // 【偏離 spec §5.3 字面的理由】沒有重力，縱向也匯聚的話超過 300 m
    // 之後彈道會爬到瞄準線上方——實測 750 m 尾追整串從目標上方飛過，0 命中。
    for (let i = 0; i < P51D_BATTERY.mounts.length; i++) {
      mountDirection(P51D_BATTERY, i, out)
      expect(out.y).toBe(0)
      expect(out.length()).toBeCloseTo(1, 12)
    }
  })

  /**
   * 某一挺在「機體座標 z = −range 的平面」上偏離中軸線多少。
   *
   * 【注意 s 的算法】匯聚點是機體座標的 (0, 0, −convergence)，而槍口本身
   * 已經在 z ≈ −0.9 了。所以要走到 z = −range 的平面，前進量是
   * `(range + p.z) / |out.z|`，不是 `range / |out.z|`——後者會多走一個
   * 槍口的縱向位置，六挺在匯聚點上就對不齊（實測殘差 4 mm）。
   */
  const offsetAt = (battery: typeof P51D_BATTERY, i: number, range: number): number => {
    const p = battery.mounts[i]!.position
    mountDirection(battery, i, out)
    const s = (range + p.z) / -out.z
    return p.x + out.x * s
  }
  const spreadAt = (battery: typeof P51D_BATTERY, range: number): number => {
    let worst = 0
    for (let i = 0; i < battery.mounts.length; i++) {
      worst = Math.max(worst, Math.abs(offsetAt(battery, i, range)))
    }
    return worst
  }

  it('走到匯聚平面時，六挺的橫向位置全部收斂到 0', () => {
    for (let i = 0; i < P51D_BATTERY.mounts.length; i++) {
      expect(offsetAt(P51D_BATTERY, i, P51D_BATTERY.convergence)).toBeCloseTo(0, 9)
    }
  })

  it('彈著散佈在匯聚點最密，太近與太遠都變差', () => {
    // 【為什麼用 convergence 表示而不是寫死距離】原本這一條寫的是「300 m
    // 最密」，而 M10 驗收時匯聚點被改成 1,000 m —— 於是它紅了。紅的原因
    // 不是行為退化，是它把一個**設定值**寫成了斷言。這一條真正要守的是
    // 「最密的地方就是匯聚點」，那與那個值是多少無關。
    const c = P51D_BATTERY.convergence
    expect(spreadAt(P51D_BATTERY, c)).toBeLessThan(0.01)
    expect(spreadAt(P51D_BATTERY, c * 0.33)).toBeGreaterThan(1.0)
    expect(spreadAt(P51D_BATTERY, c * 1.67)).toBeGreaterThan(1.0)
    expect(spreadAt(P51D_BATTERY, c * 2.5))
      .toBeGreaterThan(spreadAt(P51D_BATTERY, c * 1.67))
  })

  it('109 的軸心武裝在纏鬥距離的散佈遠小於 P-51 的翼槍', () => {
    // 史實優勢從資料自然落出來：軸心武裝不必修正匯聚。用**相對關係**而不是
    // 絕對門檻 —— 絕對值隨槍位微調而變，相對關係才是這一條要守的東西。
    //
    // 【M10 起門檻由 750 m 換到纏鬥距離，而且那是一個真的設計改變】原本
    // 兩者的匯聚點都是 300 m，750 m 上 109 為 0.30 m、P-51 為 3.10 m，
    // 差 10 倍。專案負責人在 M10 驗收時把 P-51 外推到 1,000 m，於是 750 m
    // 落進它的甜蜜點附近（0.52 m），差距縮到 1.7 倍 —— **這一條的舊說法
    // 在新設定下就是假的**，不能靠調小 5 倍這個門檻讓它過去。
    //
    // 新設定下仍然成立、而且是同一件事的，是纏鬥距離：109 的槍在中軸線上，
    // 200~300 m 幾乎不散；P-51 在那裡正好離匯聚點最遠，是它最散的時候。
    for (const range of [200, 300]) {
      expect(spreadAt(BF109K4_BATTERY, range))
        .toBeLessThan(spreadAt(P51D_BATTERY, range) / 5)
    }
    expect(spreadAt(BF109K4_BATTERY, 300)).toBeLessThan(0.1)
  })

  it('1,000 m 附近 P-51 反而比 109 集中 —— 匯聚點外推換來的長處', () => {
    // 【為什麼要有這一條】上面那一條守的是 109 的優勢，而外推匯聚點是拿
    // 近戰換遠戰。沒有這一條，「換到了什麼」就沒有任何東西記著 ——
    // 哪天有人把匯聚點調回去，只會看到一條測試變綠、不會知道少了什麼。
    expect(spreadAt(P51D_BATTERY, P51D_BATTERY.convergence))
      .toBeLessThan(spreadAt(BF109K4_BATTERY, P51D_BATTERY.convergence))
  })
})

describe('stepCadence', () => {
  const DT = 1 / 240

  it('扣下扳機的第一步立刻擊發（不吃掉第一發）', () => {
    const cd = new Float32Array(1)
    expect(stepCadence(cd, 0, 800, true, DT)).toBe(1)
  })

  it('持續扣扳機一秒，發數等於 rpm/60（含 t=0 那一發）', () => {
    const cd = new Float32Array(1)
    let shots = 0
    for (let i = 0; i < 240; i++) shots += stepCadence(cd, 0, 800, true, DT)
    expect(shots).toBe(14)   // t = 0, 0.075, …, 0.975 共 14 發
  })

  it('三秒的平均射速收斂到標稱值', () => {
    const cd = new Float32Array(1)
    let shots = 0
    for (let i = 0; i < 720; i++) shots += stepCadence(cd, 0, 700, true, DT)
    expect(shots / 3).toBeCloseTo(700 / 60, 0)
  })

  it('放開扳機不擊發，且不累積「欠帳」', () => {
    // 若放開時繼續累加，重新扣下的瞬間會一次噴出整段時間的彈量。
    const cd = new Float32Array(1)
    stepCadence(cd, 0, 800, true, DT)
    let shots = 0
    for (let i = 0; i < 240; i++) shots += stepCadence(cd, 0, 800, false, DT)
    expect(shots).toBe(0)
    expect(stepCadence(cd, 0, 800, true, DT)).toBe(1)
  })

  it('連點扳機無法超過標稱射速', () => {
    // 這是「放開歸零」與「放開繼續倒數」的分野：歸零的話點放可以無限快。
    const cd = new Float32Array(1)
    let shots = stepCadence(cd, 0, 800, true, DT)
    // 一秒內以 20 Hz 連點（每 12 步一次）
    for (let i = 1; i < 240; i++) shots += stepCadence(cd, 0, 800, i % 12 === 0, DT)
    expect(shots).toBeLessThanOrEqual(14)
  })

  it('低更新率下一步可擊發多發（不會遺失彈量）', () => {
    // 0.25 s / 0.075 s：t = 0、0.075、0.15、0.225 共 4 發。
    // 【刻意避開 dt 剛好是射擊間隔整數倍的情形】0.3 s 表面上是 4 個間隔，
    // 但 0.075 在二進位浮點下是無限循環，0.075×4 = 0.30000000000000004，
    // 落在 t > 0 那一側——答案會是 4 或 5 全看捨入。那種邊界不該寫進測試。
    const cd = new Float32Array(1)
    expect(stepCadence(cd, 0, 800, true, 0.25)).toBe(4)
  })

  it('各掛架的時鐘互不干擾', () => {
    const cd = new Float32Array(2)
    stepCadence(cd, 0, 800, true, DT)
    expect(cd[1]).toBe(0)
    expect(stepCadence(cd, 1, 800, true, DT)).toBe(1)
  })
})

describe('MAX_MOUNTS —— 槍焰的容量上界（M7 spec §5.2）', () => {
  it('所有機種的掛架數都不超過它', () => {
    // 【為什麼要守】它是一個容量上界而不是一個描述。某天有人加一台
    // 九挺槍的飛機，第九挺的槍焰會**靜靜地畫不出來** —— 沒有錯誤、
    // 沒有警告，只是那一管永遠不閃。與 createFlights 檢查
    // 「index === 陣列位置」是同一類的守門。
    //
    // 【2026-08-30 由兩台改成掃全部】原本只點名 P-51D 與 K-4，而新機種
    // 正是最可能踩到上界的那一種。改成走機體資料，加一台就自動納入。
    for (const spec of [P51D, BF109K4, F6F5, KI84, A6M5, HE111, B17G, G4M]) {
      expect(spec.battery.mounts.length, `${spec.id} 超過 MAX_MOUNTS`)
        .toBeLessThanOrEqual(MAX_MOUNTS)
    }
  })
})
