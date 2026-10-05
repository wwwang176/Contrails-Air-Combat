import { Vector3, type Object3D } from 'three'
import type { Battle } from '../battle/battleState'
import type { World } from '../world/World'
import type { Combatant } from '../world/combatant'
import type { AiController } from '../ai/AiController'
import type { InputState } from '../input/InputState'
import type { AimAssist } from '../input/aimAssist'
import type { HudFrame } from '../hud/types'
import type { FixedStepAccumulator } from '../core/loop'
import type { Screen } from '../ui/screens'
import { aglOk, pitchOk, rollOk } from '../weapons/releaseEnvelope'

interface InspectionState {
  readonly screen: Screen
  readonly player: Combatant
  readonly world: Pick<World, 'time' | 'combatants' | 'groundTargets' | 'ships'>
  readonly battle: Pick<Battle, 'board' | 'batches' | 'mission'>
}

interface BattleInspectionDependencies {
  readState(): InspectionState
  readonly input: Pick<InputState, 'playerAi'>
  readonly playerAi: Pick<AiController,
    'groundStrafePhase' | 'groundStrafeReattackRange' | 'groundTarget' | 'hudOverride'
    | 'hudPhase' | 'intent' | 'mode' | 'profile' | 'recoveryCapture' | 'recoveryUrgency'
    | 'safetyAction' | 'sit' | 'target'>
  readonly hudFrame: Pick<HudFrame,
    'aimX' | 'aimY' | 'bombBayCapacity' | 'bombLoad' | 'bombState' | 'bombVisible'
    | 'bombX' | 'bombY' | 'bombing' | 'contactCount' | 'contacts' | 'noseX' | 'noseY'
    | 'pitch' | 'releaseAgl' | 'releaseEnv' | 'releaseOk' | 'roll' | 'runCount' | 'runX' | 'runY'>
  readonly aimAssist: Pick<AimAssist, 'target'>
  readonly loop: Pick<FixedStepAccumulator, 'lastSubstepCount'>
  readonly objectiveRing: { readonly object: Pick<Object3D, 'parent'> }
}

/** 瀏覽器量測用的純資料查詢；每次呼叫才讀戰局，換場後不保留舊世界。 */
export function createBattleInspection({
  readState, input, playerAi, hudFrame, aimAssist, loop, objectiveRing,
}: BattleInspectionDependencies) {
  /**
   * **量測出口**：場上每一席的機種與位置。
   *
   * 【為什麼需要它】對著某一群飛機量幀時間時，鏡頭要擺在它們身上，而它們一路
   * 在飛 —— 寫死座標的話量到一半整隊已經飛出畫面。
   */
  const __seats = () => {
    const { world } = readState()
    return world.combatants.map((c) => ({
      id: c.aircraft.spec.id,
      alive: c.alive,
      x: c.aircraft.state.position.x,
      y: c.aircraft.state.position.y,
      z: c.aircraft.state.position.z,
    }))
  }

  /**
   * **量測出口**：場上每一台地面目標的種類、位置與狀態。
   *
   * 【為什麼需要它】日 M2 的車隊會沿公路移動。驗收要看得到車真的在走、在轉彎、
   * 開到終點會退場 —— 截圖只看得到一幀，這一支給的是座標。
   */
  const __ground = () => {
    const { world } = readState()
    return world.groundTargets.map((t) => ({
      id: t.unit.id,
      team: t.team,
      alive: t.alive,
      arrived: t.arrived,
      dormant: t.dormant,
      scripted: t.scripted,
      speed: t.speed,
      x: +t.position.x.toFixed(1),
      y: +t.position.y.toFixed(1),
      z: +t.position.z.toFixed(1),
    }))
  }

  /**
   * **量測出口**：場上每一艘船的艦級、位置與艏向（度，0 = 艦首朝 −Z）。
   * 截圖要把上帝視角擺到某一艘旁邊，艦隊會走，只能讀當下的座標。
   */
  const __ships = () => {
    const { world } = readState()
    return world.ships.map((s) => ({
      cls: s.cls.id,
      alive: s.alive,
      x: +s.position.x.toFixed(1),
      z: +s.position.z.toFixed(1),
      heading: +(2 * Math.atan2(s.orientation.y, s.orientation.w) * 180 / Math.PI).toFixed(1),
    }))
  }

  /**
   * **量測出口**：把當前戰鬥的玩家座位讀成一個純資料點，給 Playwright 用。
   *
   * 【為什麼需要它】離線探針量的是 `stepBattle`，人工回報的卻是**在遊戲裡**
   * 按代飛看到的行為。兩者中間隔著這個檔案的接線 —— 何時換控制器、指揮層、
   * 暫停、掉幀丟時間。少了這個出口，Playwright 只讀得到像素，量不出軌跡。
   *
   * 【為什麼是函式而不是掛物件】`battle` 每開一場就換一顆，抓著舊的參考會
   * 量到上一場。
   *
   * 【為什麼回純數字而不是回 `battle`】跨 CDP 傳一整棵物件圖既慢又會踩到
   * 循環參考；而且要量什麼在這裡寫清楚，比在腳本裡挖欄位誠實。
   */
  const __probe = () => {
    const { screen, player, world, battle } = readState()
    if (screen !== 'battle') return null
    const a = player.aircraft
    const pos = a.state.position
    const vel = a.state.velocity
    const speed = vel.length()
    const right = new Vector3(1, 0, 0).applyQuaternion(a.state.orientation)
    const up = new Vector3(0, 1, 0).applyQuaternion(a.state.orientation)
    const aim = player.command.aimWorld
    // 被護送的單位（護航關才有），取還活著的平均高度
    let by = 0
    let bn = 0
    for (const c of world.combatants) {
      if (!c.alive) continue
      if (battle.board.protectedMask[c.index] === 0) continue
      by += c.aircraft.state.position.y
      bn++
    }
    const tgt = playerAi.target
    const groundTgt = playerAi.groundTarget
    return {
      /**
       * **物理時鐘**，秒。用 `world.time` 而不是 `elapsed` —— 後者累加的是
       * 牆鐘（`frameSeconds`），而固定步長迴圈撞到 `maxSubsteps` 時會丟時間。
       * 無頭瀏覽器跑 WebGL 幾乎一定會撞到，兩者於是分家。
       */
      t: +world.time.toFixed(2),
      ai: input.playerAi,
      alive: player.alive,
      x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1),
      v: +speed.toFixed(1),
      // 航跡角：速度向量相對地平線。正 = 爬升
      ga: speed > 1e-3 ? +(Math.asin(vel.y / speed) * 180 / Math.PI).toFixed(2) : 0,
      // 【坡度用 atan2 不用 asin】asin 的值域是 ±90°，**分不出正飛與倒飛**。
      // 實測踩過一次：一段「坡度只有 −11°、幾乎平飛」的取樣，真值是 179°
      bk: +(Math.atan2(-right.y, up.y) * 180 / Math.PI).toFixed(1),
      // 指令的航跡角 —— 與 ga 對照就知道低頭是被命令的還是掉下去的
      cmd: +(Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) * 180 / Math.PI).toFixed(2),
      intent: playerAi.intent,
      mode: playerAi.mode,
      phase: playerAi.hudPhase,
      override: playerAi.hudOverride,
      /**
       * 瞄具：狀態、投不投得出去、是否在投彈模式、落點圈與航跡末端的 NDC、
       * 航跡取樣數。教學截圖靠它挑時機、擺標註。
       */
      sight: {
        state: hudFrame.bombState, ok: hudFrame.releaseOk, bombing: hudFrame.bombing,
        vis: hudFrame.bombVisible, bx: +hudFrame.bombX.toFixed(4), by: +hudFrame.bombY.toFixed(4),
        run: hudFrame.runCount,
        rx: hudFrame.runCount > 0 ? +hudFrame.runX[hudFrame.runCount - 1]!.toFixed(4) : 0,
        ry: hudFrame.runCount > 0 ? +hudFrame.runY[hudFrame.runCount - 1]!.toFixed(4) : 0,
        agl: +hudFrame.releaseAgl.toFixed(0),
        // 彈艙：還有幾枚、滿艙幾枚。驗收「按下去真的投出去了」讀它
        load: hudFrame.bombLoad, cap: hudFrame.bombBayCapacity,
      },
      /** 準星：滑鼠圓圈（螢幕半高單位）與機頭十字（NDC）。教學截圖挑兩者分開的時機 */
      reticle: {
        ax: +hudFrame.aimX.toFixed(4), ay: +hudFrame.aimY.toFixed(4),
        nx: +hudFrame.noseX.toFixed(4), ny: +hudFrame.noseY.toFixed(4),
      },
      /**
       * 最近一架有預瞄環的敵機：目標框中心、半徑與預瞄環（螢幕半高單位）、距離 m。
       * 沒有就是 null。教學截圖拿它擺標籤
       */
      lead: probeLead(),
      /** 瞄準輔助正吸著的那一架，−1 = 沒有 */
      assist: aimAssist.target,
      /** Worker 改出風險與最後安全動作；供低空攻擊的 e2e 護欄判讀。 */
      ru: +playerAi.recoveryUrgency.toFixed(3),
      capture: playerAi.recoveryCapture,
      firing: player.command.firing,
      safety: playerAi.safetyAction,
      // 迴轉平面的俯仰偏置，度。正 = 拉高迴旋、負 = 俯衝迴旋、0 = 水平
      tpb: +(playerAi.sit.turnPitch * 180 / Math.PI).toFixed(2),
      asp: +(playerAi.sit.aspectAngle * 180 / Math.PI).toFixed(1),
      // 被護送單位的平均高度；全滅或非護航關時 NaN
      by: bn > 0 ? +(by / bn).toFixed(1) : Number.NaN,
      tr: tgt !== null ? +tgt.state.position.distanceTo(pos).toFixed(1) : -1,
      /** 這一格實際正在掃射的地面單位與距離；空字串／−1 = 沒有。 */
      gt: groundTgt?.unit.id ?? '',
      gr: groundTgt !== null ? +groundTgt.position.distanceTo(pos).toFixed(1) : -1,
      /** 對地掃射航次：approach = 進場，egress = 已飛越、正在拉開。 */
      gsp: playerAi.groundStrafePhase,
      /** 這次離場算出的回頭門檻；−1 = 此速度暫時沒有可持續迴轉解。 */
      grr: Number.isFinite(playerAi.groundStrafeReattackRange)
        ? +playerAi.groundStrafeReattackRange.toFixed(1) : -1,
      // 掉幀會讓固定步長迴圈丟時間，軌跡就與離線探針分家 —— 要看得到
      sub: loop.lastSubstepCount,
      /**
       * 代飛這一顆 AI 的反應延遲，秒。**這是兩條量測路徑對不對得起來的鑰匙。**
       * `ACE` 是 0、`VETERAN` 不是 —— 延遲不同，軌跡四十秒後就完全不一樣。
       */
      rd: playerAi.profile.reactionDelay,
      /**
       * 撤離圓環在不在場景裡。
       *
       * 【為什麼是這個而不是數像素】圓環畫在 WebGL 那一張畫布上，而
       * `preserveDrawingBuffer` 是關的 —— `getImageData` 讀不回來。所以 e2e
       * 問的是「它有沒有被加進場景」：`hasTarget` 為真卻沒加進去，正是那個
       * 會靜靜發生的失敗（環每一幀照常更新位置與半徑，就是不在場景裡）。
       */
      ring: objectiveRing.object.parent !== null,
      /** 整隊重生已經預警的批數，與場上活著的紅方架數。試飛用來看重生有沒有發生 */
      batches: battle.batches,
      redAlive: world.combatants.reduce((n, c) => n + (c.team === 'red' && c.alive ? 1 : 0), 0),
      /** 這一場有沒有終點。`ring` 的對照 —— 兩者必須一致 */
      tgtOn: battle.mission.hasTarget,
      /**
       * ── 投雷 HUD 的實際狀態 ──────────────────────────────
       *
       * 【為什麼要暴露這幾格】`test/e2e/torpedo-hud.e2e.ts` 只截圖的話，把
       * `main.ts` 的接線整個刪掉、`releaseAgl` 填錯、甚至 widget 完全不畫，
       * 那支腳本都還是會成功結束 —— 那是一條殺不死的護欄。
       *
       * 讀的是 `hudFrame` 本身，也就是 widget 真正拿到的那一份。
       */
      /** 航跡線這一幀畫幾個取樣點。0 = 不畫 */
      runN: hudFrame.runCount,
      /** HUD 拿到的離地高度 —— 必須是 `canRelease` 吃的那一個 */
      hudAgl: +hudFrame.releaseAgl.toFixed(1),
      /** 投放閘門三格的結果，順序同畫面 */
      gate: hudFrame.releaseEnv === null ? null : {
        roll: rollOk(hudFrame.releaseEnv, hudFrame.roll),
        pitch: pitchOk(hudFrame.releaseEnv, hudFrame.pitch),
        agl: aglOk(hudFrame.releaseEnv, hudFrame.releaseAgl),
      },
      /** 這一幀投得出去嗎 —— 三格全綠必須等於它 */
      relOk: hudFrame.releaseOk,
    }
  }

  /** `__probe` 的 `lead`：最近一架在畫面前方、預瞄環也在前方的敵機 */
  function probeLead(): { x: number; y: number; r: number; lx: number; ly: number; range: number } | null {
    let best: (typeof hudFrame.contacts)[number] | null = null
    for (let i = 0; i < hudFrame.contactCount; i++) {
      const c = hudFrame.contacts[i]!
      if (!c.active || !c.hostile || c.behind || !c.leadValid || c.leadBehind) continue
      if (best === null || c.range < best.range) best = c
    }
    if (best === null) return null
    return {
      x: +best.x.toFixed(4), y: +best.y.toFixed(4), r: +best.radius.toFixed(4),
      lx: +best.leadX.toFixed(4), ly: +best.leadY.toFixed(4), range: +best.range.toFixed(0),
    }
  }

  return { __probe, __seats, __ground, __ships }
}
