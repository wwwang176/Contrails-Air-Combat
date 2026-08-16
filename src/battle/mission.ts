import { Vector3 } from 'three'

/**
 * 一場戰鬥的結果。`victory` = 任務達成，`defeat` = 任務失敗。
 *
 * 【為什麼住在這裡而不是 `setup.ts`】它現在是**任務判定的產物**。留在
 * `setup.ts` 的話 `mission.ts` 要 import `setup.ts`，而 `setup.ts` 又要
 * import `mission.ts` —— 一個沒有必要的循環。`setup.ts` 再匯出這個型別，
 * 既有的 import 站點全部不用動。
 */
export type Outcome = 'fighting' | 'victory' | 'defeat'

/**
 * 這一關怎麼算贏。
 *
 * 【為什麼是可辨識聯集而不是一個函數】關卡是**資料**（`battle/missions.ts`
 * 是一張表）。函數會把「怎麼打」藏進閉包裡，而閉包不能比較、不能序列化、
 * 也不能在測試裡直接組一個出來。
 */
export type MissionRules =
  | { kind: 'annihilate' }
  | {
    kind: 'evacuate'
    /** 撤離點的世界座標 */
    point: Vector3
    /** 抵達半徑，m。**也就是圓環的半徑** —— 看到的圈就是判定範圍 */
    radius: number
    /** 時限，秒。無時限給 `Infinity` */
    seconds: number
  }

/**
 * `stepMission` 讀的快照。**就地重填，不配置。**
 *
 * 【為什麼不直接吃 `Battle`】與 `CommandUnit`（`ai/command.ts`）、
 * `SteerConfig` 同一套手法：吃快照才能單元測試而不用建一個世界出來。
 */
export interface MissionInputs {
  aliveBlue: number
  aliveRed: number
  /** 玩家目前那一架的位置 */
  playerPos: Vector3
  /**
   * 玩家那一架還活著嗎。
   *
   * 【為什麼一定要有】接手有 2 秒延遲（`battle/takeover.ts` 的
   * `TAKEOVER_DELAY`），那段期間 `Battle.player` 仍然指著**已經退場的那一
   * 架**，位置停在墜落點。少了這個旗標，「玩家死在圓環裡、僚機還活著」會
   * 判成撤離成功。
   */
  playerAlive: boolean
}

/**
 * 任務的狀態。**判定與顯示都在這裡**，由同一次 `stepMission` 寫出。
 *
 * 【為什麼判定與顯示不分開】分開的話 HUD 要自己再算一次進度，而兩份邏輯
 * 會漂移 —— 玩家看到「剩 12 架」卻突然贏了。這是這一輪唯一真正的新風險，
 * 合在一起就從結構上消掉（spec §4.3）。
 */
export interface MissionState {
  outcome: Outcome
  /** 撤離點。`hasTarget` 為 false 時無意義。**物件重用，不換參考** */
  readonly target: Vector3
  hasTarget: boolean
  /** 抵達半徑，m */
  targetRadius: number
  /** 剩餘秒數。無時限時是 `Infinity` */
  secondsLeft: number
  /** HUD 的計量。殲滅＝剩餘敵機數，撤離＝到撤離點的距離 m */
  metric: number
}

export function createMissionState(rules: MissionRules): MissionState {
  const s: MissionState = {
    outcome: 'fighting',
    target: new Vector3(),
    hasTarget: false,
    targetRadius: 0,
    secondsLeft: Infinity,
    metric: 0,
  }
  resetMissionState(rules, s)
  return s
}

/**
 * 回到開局。**「再打一場」與暫停選單的「重新開始」都要呼叫。**
 *
 * 【為什麼不是重新 `createMissionState`】`Battle.mission` 是 readonly 的
 * 參考，而 `main.ts` 與 HUD 每幀讀它。換掉物件會讓那些參考指向孤兒 ——
 * 與 `Aircraft.reset` 改成就地寫回是同一條教訓（見 `setup.ts` 的
 * `stepCommandLayer` 註解）。
 *
 * 【annihilate 分支一定要把目標清乾淨】撤離打完換遭遇戰時，殘留的
 * `hasTarget` 會讓圓環留在畫面上、小地圖上也留一個指向不存在座標的圈。
 */
export function resetMissionState(rules: MissionRules, out: MissionState): void {
  out.outcome = 'fighting'
  if (rules.kind === 'evacuate') {
    out.target.copy(rules.point)
    out.hasTarget = true
    out.targetRadius = rules.radius
    out.secondsLeft = rules.seconds
    // 【開局的 metric 先給 0 而不是實際距離】這裡拿不到玩家位置，而第一個
    // 物理步就會覆蓋它。給一個假的距離反而會在第一幀閃一下錯的數字。
    out.metric = 0
    return
  }
  out.target.set(0, 0, 0)
  out.hasTarget = false
  out.targetRadius = 0
  out.secondsLeft = Infinity
  out.metric = 0
}

/**
 * 推進一步：同時寫出判定與顯示。
 *
 * 【定案之後不再改任何欄位】一場只判一次 —— 與 `stepBattle` 現況的
 * `if (b.outcome !== 'fighting') return` 一致。少了這一條，結算畫面上的
 * 數字會在勝負已定之後繼續跳。
 *
 * 【victory 先於 defeat】同一步同時滿足時算贏：飛進圓環的那一步剛好時限
 * 歸零，判贏才符合玩家的認知。殲滅那一側的順序則是**照抄改動前的兩行**
 * （`setup.ts` 舊的 `if (red === 0) ... else if (blue === 0) ...`）。
 */
export function stepMission(
  rules: MissionRules, inp: MissionInputs, dt: number, out: MissionState,
): void {
  if (out.outcome !== 'fighting') return

  if (rules.kind === 'annihilate') {
    out.metric = inp.aliveRed
    if (inp.aliveRed === 0) out.outcome = 'victory'
    else if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 撤離 ──────────────────────────────────────────────
  // 【`Infinity - dt` 仍是 `Infinity`】無時限因此不必特例。有測試釘住這件
  // 事，否則哪天改成一個計時器物件就會靜靜壞掉。
  out.secondsLeft -= dt
  out.metric = inp.playerPos.distanceTo(rules.point)

  // 【NaN 走這條】`NaN < radius` 是 false，所以位置壞掉時不會誤判成功；
  // 落到下面的兩條失敗條件，而那兩條不讀位置。
  if (inp.playerAlive && out.metric < rules.radius) {
    out.outcome = 'victory'
    return
  }
  if (inp.aliveBlue === 0 || out.secondsLeft <= 0) out.outcome = 'defeat'
}
