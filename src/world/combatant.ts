import type { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command, Controller } from '../control/Controller'
import type { TakeoffRoll } from '../control/takeoffRoll'
import type { BombBay } from '../weapons/bomb'
import type { Loadout } from '../weapons/stores'
import type { TurretState } from './turrets'
import type { Team } from './team'

/** 世界裡的一架飛機：機體 + 控制器 + 武器狀態 + 戰損狀態。 */
export interface Combatant {
  /** 在 `World.combatants` 裡的索引。彈丸用它記錄射手，判定時排除自傷。 */
  readonly index: number
  readonly aircraft: Aircraft
  controller: Controller
  readonly command: Command
  /**
   * 每個掛架一個射擊時鐘。長度等於 `spec.battery.mounts.length`。
   *
   * 【不是 readonly】換裝機種時掛架數會變（P-51 六個、109 三個），
   * `setSpec` 必須換掉整個陣列。
   */
  cooldowns: Float32Array
  /**
   * 這一台的彈艙。**不是 readonly** —— 換裝機種時容量會變（B-17G 十枚、
   * G4M 兩枚、戰鬥機零枚），與 `cooldowns` 同一個理由。
   *
   * 【零容量就是掛不了彈】`stepBombBay` 在 `load === 0 && queue === 0` 時
   * 進回補，而回補又補回 0 —— 空艙的機種因此永遠投不出東西，不必另外擋。
   */
  bombBay: BombBay
  /**
   * 這一台掛什麼。**`null` = 掛不了東西。**
   *
   * 【為什麼不是每次從 spec 查】`bombBay.capacity` 由它推導，而任務卡可以
   * 用 `blueLoadout` 覆寫（`battle/setup.ts`）—— 覆寫過的值必須留得住，
   * 從 spec 重查會把它抹掉。
   */
  loadout: Loadout | null
  /**
   * 每個掛架的槍焰剩餘秒數。長度等於 `spec.battery.mounts.length`。
   *
   * 【為什麼是計時器而不是事件】事件會帶著**物理子步**的位置，而畫面畫
   * 在**內插後**的位置 —— 200 m/s 下差 0.83 m，槍焰會相對機身抖動接近
   * 一個機身長度。計時器是一個**狀態**，渲染層讀它的時候自己用內插姿態
   * 重算槍口位置（M7 spec §2.1）。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時掛架數會變。
   */
  muzzleFlash: Float32Array

  /**
   * 每座砲塔的執行期狀態。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時砲塔數會變。
   */
  turretStates: TurretState[]
  /** 每座砲塔的射速時鐘。與 `cooldowns` 平行，但砲塔走自己那一條。 */
  turretCooldowns: Float32Array
  hp: number
  /**
   * 包圍球半徑，m。命中判定的粗篩用，隨 spec 一起更新。
   *
   * 【為什麼存在 Combatant 上而不是每次算】它只跟機種有關，而 resolveHits
   * 每步要對 4,000 發 × 每架各問一次——那是每秒上百萬次呼叫。
   */
  hitRadius: number
  team: Team
  /**
   * 還在戰場上。false = 已退場（被打爆或撞地）。
   *
   * 【為什麼是旗標而不是從 combatants 移除】`index` 是彈丸記錄射手用的。
   * `splice` 之後所有在飛的彈丸都會認錯主人 —— 包括「打不到自己」那條
   * 規則，於是死人的遺彈會開始打活人，而症狀離成因很遠。
   */
  alive: boolean
  /** 這一步打中別人幾次。HUD 的 X 標記靠它觸發（0.15 s 計時在 HUD 那一層）。 */
  hitsDealt: number
  /** 靶機為真：被打爆就滿血重生。玩家為假（M2 沒有東西打得到玩家）。 */
  respawnOnDestroy: boolean
  /**
   * 滾行起飛腳本。**非 null 時位置由腳本驅動**：控制器不跑、物理積分與撞地
   * 判定跳過。它仍然在 `combatants` 裡、命中判定照打 —— 在跑道上打掉正在
   * 加速的飛機要成立。腳本走完由 `step` 設回 null，之後照常飛。
   */
  takeoff: TakeoffRoll | null
  /**
   * 這個席位整場不進場（`battle/setup.ts` 的 `reinforce`：起飛時停機線上已經
   * 沒有對應的那一架）。**`alive` 同時為 false**，但不是被擊落 —— 不推擊墜、
   * 畫面不畫、不留殘骸。預留的座位範圍是建構期綁死的，所以席位留著、不進場。
   */
  retired: boolean
  readonly spawnPosition: Vector3
  spawnAltitude: number
  spawnTas: number
}
