import type { HitBox, HitPart } from '../world/hit'
import type { Battery } from '../weapons/types'
import type { Turret } from '../weapons/turret'

/**
 * 陣營。**不是隊伍顏色** —— 隊伍顏色是敵我（藍＝友方），陣營是史實的那一邊。
 *
 * 【為什麼日本自成一格而不是掛在軸心底下】它只有一個用途：挑飛行員名冊。
 * 掛在 `axis` 底下的話零戰的機組會叫 Hans Richter。史實上日本當然是軸心，
 * 但這個型別問的不是「跟誰結盟」，是「這一架上面坐的是哪裡人」。
 *
 * 【為什麼住在 `specs/` 而不是 `battle/names.ts`】`AircraftSpec` 要用它，
 * 而 `battle/` 大量 import `specs/` —— 反過來會繞成循環。
 */
export type Faction = 'allies' | 'axis' | 'japan'

export interface AircraftSpec {
  id: string
  name: string
  /**
   * 這一架上面坐的是哪裡人。**決定飛行員名冊**（`battle/names.ts`）。
   *
   * 【為什麼名冊綁機種而不是綁隊伍顏色】玩家選陣營之後，藍隊有可能飛
   * Bf109。名字要跟著機種所屬的那一邊走（M9 spec §6.1）。
   *
   * 【為什麼是必填欄位而不是一份 id 白名單】以前是
   * `id === 'bf109k4' || id === 'he111' ? 'axis' : 'allies'` —— 新機種漏掉
   * 的症狀是拿到錯的那一本名冊，不是錯誤，是一排讀起來怪怪的名字。
   * 2026-08-21 的 He 111 就是這樣漏的。必填欄位漏填是編譯錯誤。
   */
  faction: Faction
  /**
   * 機種定位。**只有 `specs/feel.ts` 讀它** —— 兩類飛機套不同的手感輪廓。
   *
   * 【為什麼是一個欄位而不是一份 id 清單】寫成 `['he111', 'b17g']` 那種硬編
   * 清單的話，下一台轟炸機加進來時不會有任何東西提醒你去補；型別上少一個
   * 必填欄位會直接編譯失敗。這個專案已經被硬編機種清單咬過一次（見
   * `.claude/skills/aircraft-from-reference` 的「不要為外型寫測試」末段）。
   */
  role: 'fighter' | 'bomber'

  /** 戰鬥重量，kg */
  mass: number
  /** 機體軸慣量，kg·m²。pitch = Ixx、yaw = Iyy、roll = Izz */
  inertia: { pitch: number; yaw: number; roll: number }

  wing: {
    /** m² */
    area: number
    /** m */
    span: number
    /** 平均氣動弦長，m */
    chord: number
    /** Oswald 效率因子 */
    oswald: number
  }

  lift: {
    /** 升力線斜率，/rad */
    clAlpha: number
    /** 零升迎角，rad（有彎度翼型為負） */
    alphaZero: number
    /** 失速迎角，rad */
    alphaCrit: number
    /** 失速後 CL 崩塌的過渡寬度，rad */
    stallBlend: number
    /** 崩塌終點的 CL 相對於 CL_max 的比例 */
    postStallFactor: number
    /** 前緣縫翼展開時 alphaCrit 的增量，rad。無縫翼為 0 */
    slatAlphaBonus: number
    /** 縫翼展開迎角，rad */
    slatDeployAlpha: number
    /** 縫翼收回迎角，rad（小於展開值，形成遲滯） */
    slatRetractAlpha: number
  }

  drag: {
    /** 零升阻力係數 */
    cd0: number
    /** 側滑阻力係數，/rad² */
    cdBeta: number
    /** 臨界馬赫數 */
    machCrit: number
    /** 超過臨界馬赫後 cd0 的上升強度 */
    machDragFactor: number
  }

  side: {
    /** 側力係數，/rad。負值代表正側滑產生向左的力 */
    cyBeta: number
  }

  /** 力矩係數與穩定導數，全部以標準氣動軸定義 */
  moments: {
    cm0: number
    cmAlpha: number
    cmQ: number
    cmDe: number
    clBeta: number
    clP: number
    /** 全偏轉（δa = 1）時的滾轉力矩係數 */
    clDa: number
    cnBeta: number
    cnR: number
    cnDr: number
  }
  // 操縱導數符號約定（與教科書的 δ 正負相反，此處以「玩家意圖」為正）：
  //   aileron  +1 = 向右滾轉  → clDa 為正
  //   elevator +1 = 機首上仰  → cmDe 為正
  //   rudder   +1 = 機首右偏  → cnDr 為正

  /** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k) */
  controlStiffening: {
    /** 參考動壓，Pa。低於此值舵面權限為滿 */
    qRef: number
    aileronK: number
    elevatorK: number
    rudderK: number
  }

  engine: {
    /** 增壓器檔位。功率為 WEP 值（throttle = 1.1），單位 W */
    gears: readonly { powerSeaLevel: number; powerCritical: number; altCritical: number }[]
    /** 進氣衝壓恢復效率，0..1。見 Spec 修訂 2 */
    ramEfficiency: number
  }

  prop: {
    /** m */
    diameter: number
    etaMax: number
    /** 螺旋槳效率曲線的特徵速度，m/s */
    vRef: number
    /** 靜推力相對於動量理論理想值的比例 */
    figureOfMerit: number
  }

  limits: {
    gPositive: number
    gNegative: number
    /** 不可超越速度，m/s IAS */
    vne: number
  }

  /**
   * 結構強度，HP。實際扣血 = 單發傷害 × 部位倍率 ÷ 該部位的防護力。
   *
   * 【2026-09-01：戰鬥機不再一律 1000】spec §6.3 原本規定戰鬥機一律 1000，
   * 而那讓**體型差被忽略**：F6F-5 的正後方命中面積是 P-51D 的 1.42 倍，同樣
   * 的血量等於它天生脆 29%，而 Hellcat 的招牌正好是耐打。
   *
   * 新的訂法是**正比於質量**，而那不是發明出來的規則 —— 兩台轟炸機既有的
   * 3000 / 5000 本來就落在這條線的 3% 之內（質量比例給 3101 / 4970），
   * 只有三台戰鬥機因為 §6.3 被壓平了：
   *
   * ```
   *              質量 kg   ÷4427    hp     耐打（hp ÷ 正後方命中面積）
   *   P-51D        4427     1.00   1000     1.00
   *   F6F-5        5634     1.27   1270     0.90   （改前 0.71）
   *   Bf 109 K-4   3375     0.76    760     0.92   （改前 1.21）
   *   He 111      13727     3.10   3000     不動，在誤差內
   *   B-17G       22000     4.97   5000     不動，在誤差內
   * ```
   *
   * 三台戰鬥機的耐打差距因此由 50 個百分點縮到 2 個，而且用的是物理量。
   * 專案負責人 2026-09-01 裁決。
   */
  hp: number

  /**
   * 各部位的**防護力**。1.0 = 基準，> 1 更耐打、< 1 更容易被打壞。
   *
   *     實際扣血 = 單發傷害 × PART_MULTIPLIER[部位] ÷ protection[部位]
   *
   * ── 為什麼跟 `PART_MULTIPLIER` 分成兩張表 ──────────────────
   *
   * 那一張回答「**打到哪裡比較痛**」—— 那是解剖學，每台飛機都一樣（座艙有
   * 駕駛員、引擎會停車、機翼只是多幾個洞）。這一張回答「**這一台的這裡有沒有
   * 裝甲**」—— 那是個別飛機的事（Hellcat 有 96 kg 裝甲板與氣冷引擎，Mustang
   * 的機腹散熱器一發就報銷）。
   *
   * 合成一張的話，每加一台新飛機都得重新推導一次「座艙為什麼是 2.5」，而那
   * 跟機種無關。分開之後新機種只要回答一個問題：**這台哪裡比別人耐打**。
   *
   * ── 誠實揭露：它改變不了整體強弱 ─────────────────────────
   *
   * 依實測的傷害佔比加權，整張表只把各機種的受傷改變 −8.5% 到 +5.0%。原因是
   * **權重不在裝甲該在的地方**：引擎只吃 5.4% 的傷害、機身 7.7%，而機翼＋
   * 尾段吃掉 72%，那兩處沒有什麼史實裝甲差異可寫。
   *
   * 所以它真正的作用是**「該往哪裡打」**而不是「誰比較耐打」。同一發 M2
   * 打中機身：P-51D 22.5 點、109 與 He 111 18.0 點、F6F 與 B-17G 15.7 點
   * —— 打野馬的肚子比打地獄貓的肚子多 43%。整體強弱由 `hp` 負責。
   *
   * 【護欄】`specs.test.ts` 把每一格夾在 0.7～1.5，超出要專案負責人裁決。
   * 不是 1.0 的每一格都要在該機種的註解裡寫出處。
   */
  protection: Readonly<Record<HitPart, number>>

  /**
   * 命中盒，**機體座標**。六個部位各一，數值取自 M1 量出來的機身資料。
   *
   * 【為什麼放在這裡而不是 weapons/】它描述的是**機體**不是武器——與翼展、
   * 重量、慣量是同一類東西，所以跟 AircraftSpec 一起走。型別放在消費它的
   * world/hit.ts。
   */
  hitBoxes: readonly HitBox[]

  /** 機載武裝。資料在 src/weapons/，這裡只是把它掛上機體。 */
  battery: Battery

  /**
   * 自衛砲塔。**必填，戰鬥機填空陣列。**
   *
   * 【為什麼必填而不是選填】選填的話新增機種時不會有任何東西提醒你去補；
   * 必填欄位由型別直接擋下來。這個專案已經被硬編機種清單咬過一次
   * （見 `.claude/skills/aircraft-from-reference` 的「不要為外型寫測試」
   * 末段），`role` 那一輪也是同一個理由。
   *
   * 與 `battery` 的差別：`battery` 由**玩家的扳機**驅動
   * （`Combatant.command.firing`），砲塔自己找目標、自己決定開火。
   */
  turrets: readonly Turret[]
}

/** 史實性能參考值，供 L2 測試斷言。全部為 SI 單位。 */
export interface HistoricalReference {
  /** 臨界高度的極速 */
  vmaxAtCritical: { speed: number; altitude: number }
  /** 海平面極速，m/s */
  vmaxSeaLevel: number
  /** 海平面爬升率，m/s */
  climbRateSeaLevel: number
  /** 乾淨構型失速速度，m/s */
  stallSpeed: number
  /** 實用升限，m */
  serviceCeiling: number
  /** 史實 CL_max，供推導值的合理性檢查（±8%） */
  clMax: number
}

/**
 * 推導 CL_max。見 Spec 修訂 1：CL_max 不是獨立參數，
 * 而是由升力線斜率與失速迎角推導，確保 CL 曲線在失速點連續。
 */
export function derivedClMax(spec: AircraftSpec, slatsDeployed: boolean): number {
  const alphaCrit = spec.lift.alphaCrit + (slatsDeployed ? spec.lift.slatAlphaBonus : 0)
  return spec.lift.clAlpha * (alphaCrit - spec.lift.alphaZero)
}
