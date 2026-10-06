import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Ship } from '../world/ships'
import type { GroundTarget } from '../world/groundTargets'
import type { StrikeTarget } from '../world/strikeTarget'
import type { Team } from '../world/team'
import type { GroundUnitId } from '../specs/ground'
import { BOMB_BLAST_RADIUS, type BombBay } from '../weapons/bomb'
import type { TargetBoard } from './target'
import type { TerrainSource } from './terrainSense'
import type { FireAim } from './fire'
import {
  createGroundStrafeState, groundAttackCommand, pickGroundTarget, pickShipTarget,
  resetGroundStrafe, shipAttackCommand, SHIP_ATTACK_RANGE,
} from './shipAttack'
import type { createShipAim } from './shipAttack'
import { GROUND_BOMB_AIM_RANGE, resetBombAim, setBombBallistics, stepBombAim } from './bombRun'
import type { createBombAim } from './bombRun'
import { resetStrike, stepStrike, type StrikeProfile } from './strikeRun'
import type { createStrikeState } from './strikeRun'
import { DIVE_RANK_COUNT, pickDiveTarget, resetDiveBomb, stepDiveBomb } from './diveBomb'
import type { createDiveBombState } from './diveBomb'
import { setTorpedoBallistics } from './torpedoRun'

/** 攻擊流程所需的輸入與既有狀態；由呼叫端直接提供，不逐步建立快照。 */
export interface SurfaceAttackContext {
  readonly board: Pick<TargetBoard, 'candidates'> | null
  readonly selfIndex: number
  readonly ships: readonly Ship[]
  readonly groundTargets: readonly GroundTarget[]
  readonly airOnly: boolean
  readonly terrain: TerrainSource | null
  readonly stationReference: Aircraft | null
  readonly bombBay: BombBay | null
  readonly bombDrag: number
  readonly strikeProfile: StrikeProfile
  readonly strikeRef: StrikeRef
  readonly strike: ReturnType<typeof createStrikeState>
  readonly shipAim: ReturnType<typeof createShipAim>
  readonly bombAim: ReturnType<typeof createBombAim>
  readonly diveBomb: ReturnType<typeof createDiveBombState>
}

export interface SurfaceAttackState {
  /** 地面目標清單的索引，−1 = 無；跨決策拍保留，與本步是否採用分開。 */
  groundAim: number
  /** 本物理步是否採用地面攻擊。控制器在每一步開始時清除。 */
  groundAttackActive: boolean
  /** 本步採用掃射才啟用防墜交還閘門；俯衝投彈不使用該閘門。 */
  groundStrafeActive: boolean
  /** 飛越目標後的離場狀態；不得因一般重選目標而重建。 */
  readonly groundStrafe: ReturnType<typeof createGroundStrafeState>
}

export function createSurfaceAttackState(): SurfaceAttackState {
  return {
    groundAim: -1,
    groundAttackActive: false,
    groundStrafeActive: false,
    groundStrafe: createGroundStrafeState(),
  }
}

/** 換場時一併放掉對地、對艦與投彈的鎖定；一般重選目標不能呼叫。 */
export function resetSurfaceAttack(
  state: SurfaceAttackState,
  ctx: Pick<SurfaceAttackContext, 'strike' | 'bombAim' | 'diveBomb' | 'shipAim' | 'strikeRef'>,
): void {
  resetStrike(ctx.strike)
  resetBombAim(ctx.bombAim)
  resetDiveBomb(ctx.diveBomb)
  ctx.shipAim.ship = -1
  ctx.strikeRef.index = -1
  state.groundAim = -1
  state.groundAttackActive = false
  state.groundStrafeActive = false
  resetGroundStrafe(state.groundStrafe)
}

/**
 * 投彈解算的步長。**必須與空中的炸彈相同** —— `World.step` 跑 240 Hz，
 * 兩邊不同的話 AI 算的落點與真正飛出去的那一顆會分家。
 */
const DT_SOLVE = 1 / 240

/**
 * 戰鬥機對地投彈時，離目標至少要這麼高才放，m。
 *
 * 【為什麼】爆風炸得到投彈的自己（`world/bombBlast.ts`）。低空俯衝放手之後
 * 飛機差不多是從落點正上方掠過，炸彈落地那一刻離爆心大約就是這個高度 ——
 * 要大過殺傷半徑（基準彈 30 m）一截。**起始值，由試飛裁定。**
 */
const AI_BOMB_MIN_HEIGHT = 80

/**
 * 轟炸機鎖定的打擊目標：在哪一份清單、第幾個。`index` 為 −1 = 沒有。
 *
 * 【為什麼是 kind + index 而不是物件參考】兩份清單都是由 `wireTerrain`
 * 每幀重接的，存參考的話換場之後會指著上一場的船。與 `ShipAim.ship`
 * 同一個理由。
 */
export interface StrikeRef {
  kind: 'ship' | 'ground'
  index: number
}

/**
 * 沒有空中目標時，戰鬥機掃射敵方的地面目標。回傳 true 代表 `out` 已經寫滿。
 *
 * 【長機與僚機都打】排在站位之前 —— 地面目標就是那一關的目標，僚機飛回站位
 * 的話整隊只有長機在打。
 *
 * 【只給戰鬥機】轟炸機走 `attackShip` 的攻擊航路。沒有地面目標的關卡是一次
 * 早退，對艦與空戰的路徑一個位元都不動。
 *
 * 【撞地不靠不去打來避】`emit` 裡的 `applySafety` 與地形感知照樣最後接手。
 */
export function strafeGround(
  s: SurfaceAttackState, ctx: SurfaceAttackContext, self: Aircraft, decide: boolean, out: Command,
  aim: FireAim, burstOpen: boolean, onlyUnit: GroundUnitId | null = null,
): boolean {
  const dives = self.spec.diveBomber === true
  if (ctx.groundTargets.length === 0 || (self.spec.role !== 'fighter' && !dives)) {
    s.groundAim = -1
    resetGroundStrafe(s.groundStrafe)
    return false
  }
  const me = ctx.board?.candidates[ctx.selfIndex]
  if (me === undefined) {
    s.groundAim = -1
    resetGroundStrafe(s.groundStrafe)
    return false
  }
  // 【俯衝轟炸機走自己的行為】任務指定了優先地面單位、以及沒有空中目標時排在站位之前，都從這裡進
  if (dives) return diveBombGround(s, ctx, self, decide, out, onlyUnit)
  // 【只打飛機】排在俯衝轟炸機的分支之後：它們不受這個旋鈕管
  if (ctx.airOnly) {
    s.groundAim = -1
    resetGroundStrafe(s.groundStrafe)
    return false
  }
  // 【離場途中也挑】挑到的是下一趟要打的那一台；離場拉開到它的回頭門檻才轉回來
  // （`groundStrafeCommand` 換目標時不打斷離場）。
  //
  // 【每一步都要複查】上一個決策拍之後它可能已經被打掉或起飛離場 —— 當場補挑，
  // 不等下一拍：少了這一格，掃射狀態會被清掉，離場做到一半就變成回頭進場
  const held = s.groundAim >= 0 ? ctx.groundTargets[s.groundAim] : undefined
  if (decide || (held !== undefined && !held.alive)) {
    s.groundAim = pickGroundTarget(
      self.state.position, me.team, ctx.groundTargets, SHIP_ATTACK_RANGE, onlyUnit,
    )
  }
  const t = s.groundAim >= 0 ? ctx.groundTargets[s.groundAim] : undefined
  if (t === undefined || !t.alive) {
    s.groundAim = -1
    resetGroundStrafe(s.groundStrafe)
    return false
  }
  groundAttackCommand(s.groundStrafe, self, t, decide, out, aim, ctx.terrain?.land ?? null)
  // 【掃射也吃點放】瞄得準就咬住，瞄得爛只點兩下 —— 與打飛機同一條規則
  out.firing = out.firing && burstOpen
  bombGround(s, ctx, self, t, decide, out)
  s.groundAttackActive = true
  s.groundStrafeActive = true
  return true
}

/**
 * 俯衝投彈（`ai/diveBomb.ts`）：平飛到目標上方、壓機鼻俯衝、離目標 500 m 投彈、拉起。回傳 true
 * 代表 `out` 已經寫滿。**只給 `spec.diveBomber` 的機種。**
 *
 * 【各架挑不同的目標】名次是 `selfIndex` 對 `DIVE_RANK_COUNT` 取餘數，距離從長機的位置量（長機自己
 * 量自己的）：各架各量各的位置，排序會不同，不同名次不保證挑到不同的目標。
 *
 * 【一趟之內不換目標】名次靠後的目標，排序隨長機的位置每個決策拍都可能換；一直換目標就一直轉向、
 * 掉速、對不準，永遠壓不下機鼻。只在脫離時重挑，脫離結束前最後一次挑的就是下一趟的目標；目標死了
 * 或還沒有也補挑。翻轉、俯衝與拉起鎖著瞄準點，目標中途被炸掉也要把這一趟飛完，所以那三個相位沒有
 * 目標時照樣呼叫。
 *
 * 【不走掃射的解除閘門】那一套（`groundStrafeActive`）會在對地俯衝時驗證改出、必要時把機首拉平，
 * 為低空掃射設計；俯衝投彈自己決定幾時拉起，安全層（`applySafety`）仍是最後一道。
 */
function diveBombGround(
  s: SurfaceAttackState, ctx: SurfaceAttackContext, self: Aircraft, decide: boolean, out: Command,
  onlyUnit: GroundUnitId | null = null,
): boolean {
  const me = ctx.board?.candidates[ctx.selfIndex]
  if (me === undefined) return false
  const state = ctx.diveBomb
  const flying = state.phase === 'flip' || state.phase === 'dive' || state.phase === 'pullout'
  let target = s.groundAim >= 0 ? ctx.groundTargets[s.groundAim] : undefined
  if (!flying) {
    if ((decide && state.phase === 'egress') || target === undefined || !target.alive) {
      const ref = ctx.stationReference !== null ? ctx.stationReference.state.position : self.state.position
      const rank = ctx.selfIndex >= 0 ? ctx.selfIndex % DIVE_RANK_COUNT : 0
      s.groundAim = pickDiveTarget(ref, me.team, ctx.groundTargets, SHIP_ATTACK_RANGE, rank, onlyUnit)
      target = s.groundAim >= 0 ? ctx.groundTargets[s.groundAim] : undefined
    }
    if (target === undefined || !target.alive) {
      s.groundAim = -1
      return false
    }
  }
  const bay = ctx.bombBay
  const loaded = bay !== null && bay.capacity > 0 && (bay.load > 0 || bay.queue > 0)
  stepDiveBomb(state, self, target !== undefined && target.alive ? target : null, loaded, out)
  s.groundAttackActive = true
  return true
}

/**
 * 掛彈的戰鬥機對地面目標投彈：與對船同一套落彈點瞄準（`stepBombAim`）——
 * 近了就把瞄準點換成落彈解，機首自己壓下去把落點推到車上，放得中就放。
 * 投完（或沒掛彈）就什麼都不做，瞄準點留給機槍。**排在掃射之後**，它要
 * 覆寫的正是掃射寫好的那一格。
 *
 * 【脫離段不接手】那一段要飛開、繞回來再打一趟；這裡若還在寫瞄準點，會把
 * 飛機拉回車隊上方打轉。
 *
 * 【離目標太低不放】炸彈的爆風不分敵我、也炸得到投彈的自己（`World` 的
 * `applyBombBlast`）。投彈的包絡沒有高度下限（`BOMB_ENVELOPE`），投太低是
 * 玩家自己的代價；AI 不該為了投一顆彈把自己炸下來。
 */
function bombGround(
  s: SurfaceAttackState, ctx: SurfaceAttackContext, self: Aircraft, t: GroundTarget,
  decide: boolean, out: Command,
): void {
  const bay = ctx.bombBay
  const loaded = bay !== null && bay.capacity > 0 && (bay.load > 0 || bay.queue > 0)
  if (!loaded || s.groundStrafe.phase === 'egress') {
    resetBombAim(ctx.bombAim)
    return
  }
  setBombBallistics(ctx.bombDrag, DT_SOLVE)
  // 【掛著彈的整段都保持正飛】理由同對船：倒飛進瞄準帶就投不出去
  out.upright = true
  // 【落點在殺傷半徑兩倍之內就放】車身的窗太窄，見 `stepBombAim` 的 nearEnough。
  // 兩倍比殺傷半徑寬：會有落空的，但不會整趟一枚都不放
  stepBombAim(ctx.bombAim, self, t, true, decide, null, GROUND_BOMB_AIM_RANGE, BOMB_BLAST_RADIUS * 2)
  if (ctx.bombAim.active) {
    out.aimWorld.copy(ctx.bombAim.aim)
    // 瞄準換成落彈解，已經不是掃射那一個要跟住的轉彎
    out.trackTurn = false
  }
  out.bombing = ctx.bombAim.release && self.state.position.y - t.position.y >= AI_BOMB_MIN_HEIGHT
}

/**
 * 沒有空中目標時，試著找一艘船打。回傳 true 代表 `out` 已經寫滿。
 *
 * 【為什麼獨立成函式】那一段本來就有三個 `return`
 * 與一堆鎖存維護，再塞五十行進去沒有人讀得完。而且這樣「沒有船就是
 * 一次早退」看得出來。
 *
 * 【重選只在決策拍】與空戰的目標選擇同一個節奏（10 Hz）。每個物理步
 * 重選的話，兩艘距離相近的船會讓機首在 240 Hz 下抖。
 */
export function attackShip(
  s: SurfaceAttackState, ctx: SurfaceAttackContext, self: Aircraft, decide: boolean, dt: number,
  out: Command, aim: FireAim, burstOpen: boolean,
): boolean {
  // 【不看自己有沒有武器】索敵只回答「那裡有什麼值得去的東西」，
  // 開不開得了火是開火層的事。一式陸攻沒有固定槍，但它低空掠過去時
  // 側方與機腹的銃手會打砲位。
  // 【兩份都空才早退】只看船的話，純建築的關卡轟炸機永遠選不到目標
  if (ctx.ships.length === 0 && ctx.groundTargets.length === 0) {
    ctx.shipAim.ship = -1
    ctx.strikeRef.index = -1
    return false
  }
  // 【陣營從板子讀】`AiController` 自己沒有這一格 —— 它只知道自己在
  // `candidates` 裡的位置。拿不到板子就不打船（那是試驗場與探針的情形，
  // 那些場景本來就沒有船）。
  const me = ctx.board?.candidates[ctx.selfIndex]
  if (me === undefined) {
    ctx.shipAim.ship = -1
    ctx.strikeRef.index = -1
    return false
  }
  // 【俯衝轟炸機有地面目標就俯衝】沒有可打的地面目標（回傳 false）才往下走船的水平轟炸
  if (self.spec.diveBomber === true && ctx.groundTargets.length > 0
    && diveBombGround(s, ctx, self, decide, out)) {
    return true
  }
  if (decide) {
    pickShipTarget(self.state.position, me.team, ctx.ships, ctx.shipAim, self.state.velocity)
  }
  const bay = ctx.bombBay
  const loaded = bay !== null && (bay.load > 0 || bay.queue > 0)
  if (bay !== null && bay.capacity > 0) {
    // 【兩份都設】剖面由 `strikeProfile` 決定，而這裡不知道是哪一份 ——
    // 兩支的參數是同一組值（阻力與步長），設漏一支的症狀只是「投不準」
    setBombBallistics(ctx.bombDrag, DT_SOLVE)
    setTorpedoBallistics(ctx.bombDrag, DT_SOLVE)
    // 【轟炸機走攻擊航路，戰鬥機走掃射】攻擊航路是「進場→鎖航向直飛→
    // 脫離」的循環，它要求平飛穩定通過船的正上方，換來的是一整艙彈能撒
    // 成一串。戰鬥機掛的是兩顆 60 kg —— 為兩顆彈飛完整條循環，換到的是
    // 一台在艦隊上空平飛的戰鬥機。
    if (self.spec.role !== 'fighter') {
      const target = pickStrike(ctx, self, me.team, decide)
      if (target === null) return false
      stepStrike(
        ctx.strike, self, target, ctx.strikeRef.index, ctx.strikeProfile,
        loaded, decide, dt, out,
      )
      return true
    }
  }
  const ship = ctx.shipAim.ship >= 0 ? ctx.ships[ctx.shipAim.ship] : undefined
  // 【每一步都要複查】上一個決策拍之後它可能已經沉了，而下一次重選要
  // 到 100 ms 後 —— 那一段時間對著一艘沉船掃射看起來就是壞掉。
  if (ship === undefined || !ship.alive) {
    ctx.shipAim.ship = -1
    return false
  }
  // 【砲位也要複查】它可能在這 100 ms 之內被打掉了。掉回瞄船體，
  // 而不是繼續瞄一個已經不存在的東西。
  if (ctx.shipAim.gun >= 0 && !(ship.guns[ctx.shipAim.gun]?.alive ?? false)) {
    ctx.shipAim.gun = -1
  }
  shipAttackCommand(self, ship, ctx.shipAim.gun, out, ctx.shipAim.point, aim)
  // 【掃射也吃點放】理由見 `strafeGround`
  out.firing = out.firing && burstOpen
  // 【掛著彈的整段對艦攻擊都保持正飛】進場段就翻轉的話，進落彈瞄準帶時
  // 已經倒飛，帶內來不及翻回來 —— 投放包絡擋掉，整條命一枚都不投
  out.upright = loaded
  // 【掛彈的戰鬥機：近了就把瞄準點換成落彈解】投完（或還沒進到那個距離）
  // 就什麼都不做，瞄準點留給機槍。**排在掃射之後** —— 它要覆寫的正是
  // 掃射寫好的那一格
  if (loaded) {
    stepBombAim(
      ctx.bombAim, self, ship, loaded, decide, ship.cls.aimPoints[ctx.shipAim.point] ?? null,
    )
    if (ctx.bombAim.active) out.aimWorld.copy(ctx.bombAim.aim)
    out.bombing = ctx.bombAim.release
  } else {
    resetBombAim(ctx.bombAim)
  }
  return true
}

/**
 * 轟炸機的打擊目標：船與建築裡價值最高的那一個。
 *
 * 【先船後建築，只有建築更值錢才換】沒有地面目標時與只掃船的版本逐位元
 * 相同（`strike-replay-baseline.test.ts`）—— `pickShipTarget` 照舊跑，
 * 建築那一圈是零長度。
 *
 * 【每一步都要複查】上一個決策拍之後它可能已經沉了或炸毀了。死了就放掉，
 * 下一個決策拍重選。
 *
 * @returns 目標的視圖，沒有就 null（並把 `strikeRef.index` 設成 −1）
 */
function pickStrike(
  ctx: SurfaceAttackContext, self: Aircraft, team: Team, decide: boolean,
): StrikeTarget | null {
  const ref = ctx.strikeRef
  if (decide) {
    const g = pickGroundTarget(self.state.position, team, ctx.groundTargets, SHIP_ATTACK_RANGE)
    const ship = ctx.shipAim.ship >= 0 ? ctx.ships[ctx.shipAim.ship] : undefined
    const ground = g >= 0 ? ctx.groundTargets[g] : undefined
    const shipValue = ship === undefined ? -1 : ship.value
    const groundValue = ground === undefined ? -1 : ground.value
    // 【同價值比距離，與各自清單內的規則相同】船的距離量到船心 —— 砲位
    // 那一層的距離只有船自己那一支在比，跨清單只需要一個粗略的量
    const p = self.state.position
    const takeGround = ground !== undefined && (
      groundValue > shipValue
      || (groundValue === shipValue && ship !== undefined
        && p.distanceToSquared(ground.position) < p.distanceToSquared(ship.position))
    )
    // 【一趟只打一個目標】同價值的候選隨距離輪流變成最近的那個，照單全收的
    // 話進場到一半瞄點跳走，飛機帶著坡度鎖航向、整趟放不出來。所以只在
    // 這幾種時候換：手上沒有或死了、脫離結束回頭進場（`StrikeState.repick`）、
    // 進場段而候選**更值錢**（開場時廠區還在索敵半徑外，先選到的是高砲陣地）
    const held = ref.index < 0 ? undefined
      : ref.kind === 'ship' ? ctx.ships[ref.index] : ctx.groundTargets[ref.index]
    const candidateValue = takeGround ? groundValue : shipValue
    if (held === undefined || !held.alive || ctx.strike.repick
      || (ctx.strike.phase === 'approach' && candidateValue > held.value)) {
      ctx.strike.repick = false
      if (takeGround) {
        ref.kind = 'ground'
        ref.index = g
      } else {
        ref.kind = 'ship'
        ref.index = ctx.shipAim.ship
      }
    }
  }
  if (ref.index < 0) return null
  const target = ref.kind === 'ship' ? ctx.ships[ref.index] : ctx.groundTargets[ref.index]
  if (target === undefined || !target.alive) {
    ref.index = -1
    return null
  }
  return target
}
