import { G0, smoothstep } from '../core/math'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Situation } from './assess'
import { headingErrorTo, type EngageBasis } from './engageGeometry'
import { sweetYield } from './shotYield'
import { DEFAULT_STEER, EXTEND_SIDE_HOLD, type SteerConfig } from './steerConfig'

export type BandConfig = Pick<SteerConfig,
  | 'bandMaxPitch' | 'bandAspectEnter' | 'bandAspectFull' | 'sweetYieldTime'
  | 'bandZoomRatio' | 'bandZoomGain' | 'bandTolerance' | 'bandRegainEscape'
  | 'bandRegainGap' | 'bandDiveGap' | 'bandDiveDrop' | 'bandRegainMax' | 'bandPitchScale'
>

/**
 * 空層鎖選中的走法。`off` = 沒鎖，完全交給追擊。
 */
export type BandKind = 'off' | 'level' | 'zoom' | 'dive' | 'regain'

/**
 * 空層鎖自己的跨格狀態。與 `DefendState` 同一個位階 —— 由呼叫端持有、
 * 以參數傳入，模組本身仍然沒有可變的全域狀態（spec §4.3）。
 *
 * 【為什麼需要跨格】鎖的是**進入那一刻的高度**。每格重算的話它永遠等於
 * 「現在的高度」，誤差恒為 0，一層什麼都不做的恆等式。同理，三種走法也只
 * 在進入時挑一次 —— 轉到一半改主意是兩邊都不到位。
 */
export interface BandState {
  kind: BandKind
  /**
   * 這一刻生效的空層，m。`kind === 'off'` 時無意義。
   * 每步由 `min(anchor, sit.chaseAlt)` 重算 —— 見 `stepBand` 的夾制註解。
   */
  altitude: number
  /**
   * 進場時選定的走法目標高度，m —— `altitude` 的上界。
   *
   * 【為什麼要跟 `altitude` 分開存】基準要能動態貼著下方的敵人走（他降
   * 我跟著降、他爬回來我最多回到這裡），所以「進場時挑的那個數字」必須
   * 另外留著，`altitude` 才有東西可以夾。
   */
  anchor: number
  /** 鎖的力道，0..1。0 = 完全不介入、1 = 航跡角完全由高度帶決定 */
  hold: number
  /**
   * 轉向側，+1 = 左（與 `headingErrorTo` 同號）。
   *
   * 【沒有它會在正後方直飛 —— 實測 18 秒】面對面完美對穿之後目標停在正後方
   * 180°，`headingErrorTo` 的符號由浮點雜訊決定、逐格翻面，被上限夾出來的
   * 瞄準點於是左右輪流跳，指揮儀平均下來就是**直飛**（機首夾角 176°~180°、
   * 坡度 0°、距離 581 → 6,958 m）。與 `stepExtendSide` 管的是同一個死區，
   * 分開存是因為兩者的生命週期不同（那個跟著 extend 的進出走）。
   */
  side: number
  /**
   * 打完一擊要回去的高度，m。`NaN` = 沒有。
   *
   * 鎖因攻擊放開的那一刻記下 `anchor`（開始往下接敵之前的那一層），下一次
   * 上鎖時走 `regain` 爬回來。**換目標或鎖被外部歸零時要清掉**（`clearBandPerch`）
   * —— 留著的話 AI 會為了上一個目標的高度去爬。
   */
  perch: number
  /** 這一次回升累計了幾秒。到 `bandRegainMax` 就放棄 */
  regainTime: number
  /**
   * 這一次回升由 `stepAirPass` 設下：目標在機鼻前方也不讓位，直接拉。
   *
   * 【為什麼與打完一擊的回升不同】那一種讓位給機鼻前方的射擊機會；這一種是
   * 因為飛過頭或機鼻跟不上他才拉的 —— 他在前方也打不到，讓位的話就是繼續
   * 跟著他平轉。
   */
  forced: boolean
}

export function createBandState(): BandState {
  return {
    kind: 'off', altitude: 0, anchor: 0, hold: 0, side: 1, perch: NaN, regainTime: 0, forced: false,
  }
}

/** 忘掉要回去的高度。換目標、沒有目標、走地面或對艦路徑時呼叫 */
export function clearBandPerch(state: BandState): void {
  state.perch = NaN
  state.regainTime = 0
  state.forced = false
}

/**
 * 鎖空層的力道，0..1。`max(夾角項, 射程項) × 讓位閘`。
 *
 * ```
 *   夾角項   smoothstep(45°..60°)      對不上他 —— 這是一個彎，不是一次修正
 *   射程項   sweetYield（攔截時間）    還不到拚的時候，先把高度守住
 *   讓位閘   射程項 < 0.3 時整層淡出   真的打得到就全力咬預瞄點
 * ```
 *
 * 前兩項是這一層的兩個觸發（「超過 45 度就考慮平飛迴轉」「在射程範圍外
 * 也是鎖空層」）；讓位閘是「進入射程則解除」—— 用的尺與開火紀律、玩家
 * 預瞄環同一把（`PROJECTILE_LIFETIME`）。
 *
 * 【為什麼讓位是乘上去的閘，不是把夾角項刪掉 —— 兩個方向各被咬過一次】
 *
 *   只留 max：射程內的轉圈戰裡目標隨時甩出 45° 外，夾角項把俯仰鎖回平飛、
 *   轉向夾在 75°，預瞄點在垂直方向上不准追 —— 人工回報「追不到預瞄點，
 *   轉彎的 AoA 沒辦法到極限」。而實測鎖住的迴轉段 G 5.5~6.9、失速餘裕
 *   1.05~1.13，拉桿從來不是問題，是鎖錯了時機。
 *
 *   只留射程項：對穿瞬間 `solveLead` 對後方目標常常仍有解，射程項從斜坡
 *   中段（0.37）慢慢爬，力道不足再加上閃爍重鎖，迴轉段漏掉 250 m ——
 *   護送關主判準從 +723 退到 −87。夾角項在那一刻是 1，正好補上。
 *
 * 【讓位閘的 0.3】射程項本身是攔截時間 1.2→2.4 s 的線性斜坡，0.3 對應
 * 「再 0.4 秒的彈道時間就進射程」。閘在 0..0.3 之間線性，沒有翻轉點。
 */
export function bandHold(
  sit: Situation,
  basis: EngageBasis,
  cfg: BandConfig = DEFAULT_STEER,
): number {
  if (!(cfg.bandMaxPitch > 0)) return 0
  const wide = smoothstep(cfg.bandAspectEnter, cfg.bandAspectFull, sit.aspectAngle)
  const far = sweetYield(basis.interceptTime, cfg)
  const hold = wide > far ? wide : far
  const gate = far >= 0.3 ? 1 : far / 0.3
  return hold * gate
}

/**
 * 爬 `bandZoomGain` 這麼高之後，速度還在 `bandZoomRatio` 倍角落速度以上嗎？
 *
 * 【為什麼不是「現在夠不夠快」】`cornerRatio > 1.15` 就拉高的話：
 * 面對面交會後 109 以 174 m/s（`cornerRatio` 1.16）判定「速度夠」，爬完 400 m
 * 掉到 132 m/s —— **正好落在角落速度上**，之後 40 秒都在慢慢爬、追不上直飛的
 * 靶機，距離由 2.3 km 拉到 4.8 km。裸比值回答的是「我現在快不快」，而該問的是
 * **「這筆交易付得起嗎」**。
 *
 * ```
 *   可動用的高度 = (V² − (k·Vc)²) / 2g        k = bandZoomRatio
 *   付得起       = 可動用的高度 > bandZoomGain
 * ```
 *
 * 【它自動跟著 `bandZoomGain` 走】想爬得更高，門檻自己就變嚴 —— 不必再掃一次
 * 比值。這是把兩個本來會分岔的旋鈕收成一個的作法。
 *
 * 【`cornerRatio` 非有限值退化成不准】沒有角落速度就沒有這筆帳可算，而水平
 * 迴轉在任何狀態下都是安全的（與 `repositionKnobs` 同一條退化原則）。
 */
function zoomAffordable(sit: Situation, self: Aircraft, cfg: BandConfig): boolean {
  if (!Number.isFinite(sit.cornerRatio) || sit.cornerRatio <= 0) return false
  const tas = self.state.velocity.length()
  const floor = (tas / sit.cornerRatio) * cfg.bandZoomRatio
  return (tas * tas - floor * floor) / (2 * G0) > cfg.bandZoomGain
}

/**
 * 維護空層鎖。每個物理步呼叫一次，就地改 `state`。
 *
 * @param active 現在是不是**攻擊階段**。`extend` 與 `defend` 有自己的高度邏輯，
 *               鎖要在那兩個意圖下退出 —— 不然脫離完回來會拿到一個幾十秒前的高度。
 * @param dt     這一步的秒數。回升的時間上限用它累計。
 */
export function stepBand(
  state: BandState,
  active: boolean,
  sit: Situation,
  basis: EngageBasis,
  self: Aircraft,
  dt: number,
  cfg: BandConfig = DEFAULT_STEER,
): void {
  const alt = self.state.position.y
  // 【回到那一層就算完成，鎖不鎖著都一樣】排在所有早退之前 —— 到達那一步鎖
  // 剛好放開、或被 extend 打斷期間爬到了，記憶都要清掉；留著的話之後下降時
  // 沒有新的攻擊也會再爬回舊的那一層。回升中到達時 `anchor` 仍是那一層，敵人
  // 在下方時下一段接敵就從這裡開始往下
  if (alt >= state.perch - cfg.bandTolerance) {
    if (state.kind === 'regain') state.kind = 'level'
    clearBandPerch(state)
  }
  // 【他要跑掉了就別爬，先追】目標在自己射程的 `bandRegainEscape` 倍以外、而且
  // 距離還在拉大：繼續回升只會讓他越跑越遠，最後追不回射程。`anchor` 改成現在
  // 的高度，照常接敵。目標沒在跑（慢的轟炸機、正在轉彎纏鬥）時回升照舊。
  // 射程與開火紀律同一把尺：彈丸壽命內飛得到的距離（`fire.ts`）
  if (
    Number.isFinite(state.perch) && sit.closureRate < 0
    && sit.range > cfg.bandRegainEscape * self.spec.battery.sight.muzzleVelocity * PROJECTILE_LIFETIME
  ) {
    if (state.kind === 'regain') {
      state.kind = 'level'
      state.anchor = alt
    }
    clearBandPerch(state)
  }
  let hold = active ? bandHold(sit, basis, cfg) : 0
  // 【打完一擊、目標甩到機鼻 45° 外：不讓位，直接回升】讓位閘只看攔截時間，
  // 交會之後目標還在近距離時它仍然說「打得到」，AI 於是跟著回頭追 —— 靶機
  // 情境裡那一下俯衝反轉從 2,100 m 掉到 1,063 m，速度與高度一起丟光，回升
  // 再也爬不回去。目標在機鼻前方時照舊讓位，射擊機會優先 —— 除非這一次回升
  // 是 `stepAirPass` 設的（`forced`），那時一律不讓位
  if (active && state.perch > alt + cfg.bandTolerance) {
    const wide = state.forced
      ? 1 : smoothstep(cfg.bandAspectEnter, cfg.bandAspectFull, sit.aspectAngle)
    if (wide > hold) hold = wide
  }
  state.hold = hold
  if (hold <= 0) {
    // 【鎖因攻擊放開：記住開始接敵之前的那一層】`active` 為真、上一步還鎖著、
    // 力道歸零，是目標進了射程（見 `bandHold` 的讓位閘）。**讓位閘不看方位**
    // —— 擦身而過、目標在正後方時它一樣放開，所以另外要求目標在機鼻 45° 內，
    // 才算一次攻擊。因為 extend／defend 放開的不記。回升中又攻擊時 `perch`
    // 已經是那一層，不動。轟炸機不記：它的航路另有 `strikeRun`
    if (
      active && state.kind !== 'off' && state.kind !== 'regain'
      && self.spec.role === 'fighter'
      && sit.aspectAngle < cfg.bandAspectEnter
      && state.anchor - sit.chaseAlt >= cfg.bandRegainGap
    ) {
      state.perch = state.anchor
      state.regainTime = 0
    }
    state.kind = 'off'
    return
  }
  // 【側別只在方向明確時更新】正後方 ±20°（與 `EXTEND_SIDE_HOLD` 同值）是
  // 死區，沿用上一格 —— 理由見 `BandState.side`。
  const err = headingErrorTo(self, basis.losAxis)
  if (Math.abs(err) < Math.PI - EXTEND_SIDE_HOLD) state.side = err >= 0 ? 1 : -1
  // 【往上拉設下的回升不等鎖放開】`stepAirPass` 可能在鎖還鎖著的時候觸發
  // （上膛之後目標暫時出了射程、鎖重新上了）。只從 `off` 進回升的話，它會停在
  // 舊的那一層、`forced` 把力道釘在 1，計時也不走 —— 既不拉也不解除
  if (state.forced && state.kind !== 'regain' && state.kind !== 'off'
    && state.perch > alt + cfg.bandTolerance) {
    state.kind = 'regain'
    state.anchor = state.perch
  }
  // 【已經鎖住就不重挑走法】見 `BandState` 的註解 —— 但基準夾制（下方）
  // 每步都要重算，所以不能在這裡 return。
  if (state.kind === 'off') {
    // 【打完一擊先回去】要回去的那一層比現在高才走回升；已經在那一層就不必
    if (state.perch > alt + cfg.bandTolerance) {
      state.kind = 'regain'
      state.anchor = state.perch
    } else if (sit.altitudeAdvantage > cfg.bandDiveGap) {
      state.kind = 'dive'
      // 【不會低於敵人】俯衝迴轉是把**多餘的**高度換成速度，不是把優勢
      // 丟掉。兩項設定目前不可能讓這一行生效（Drop 400 < Gap 1200），但
      // 它是這個分支的**定義**而不是設定值的副作用。
      const floor = alt - sit.altitudeAdvantage
      const wanted = alt - cfg.bandDiveDrop
      state.anchor = wanted > floor ? wanted : floor
    } else if (zoomAffordable(sit, self, cfg)) {
      state.kind = 'zoom'
      state.anchor = alt + cfg.bandZoomGain
    } else {
      state.kind = 'level'
      state.anchor = alt
    }
  }
  // 【時間上限：每一個處在回升的步各算一次，進場那一步也算】只算「進場前已經
  // 是回升」的步的話，鎖每步放開又重鎖時一步都不會累計，上限形同虛設。逾時
  // 就放掉，`anchor` 改成現在的高度，照常接敵
  if (state.kind === 'regain') {
    state.regainTime += dt
    if (state.regainTime >= cfg.bandRegainMax) {
      state.kind = 'level'
      state.anchor = alt
      clearBandPerch(state)
    }
  }

  // 【基準跟著下方的敵人走】沒有這一項時：
  // P-51 在 4800、敵機在下方射程內打轟炸機，夾角項鎖住俯仰 → 機頭壓不向
  // 他 → 攔截時間不收斂 → 讓位閘永遠不開 —— 「近在眼前卻死不低頭」，
  // 最後迴轉閂鎖把人帶走。鎖自己的層只在「敵人同層或在上」成立；敵人在
  // 下方時空層要**貼著他那層**，下降的過程會讓機頭壓得向他、攔截收斂、
  // 讓位閘照常打開。
  //
  //   `chaseAlt = max(目標高度, 被護送最低)` —— 護送中不低於轟炸機，
  //   「不陪他鑽到編隊下面」自動成立；下限另有高度鎖（floor）接著。
  //   取 min：敵人在上或同層時 chaseAlt ≥ anchor，行為一個字不變；
  //   敵人在下方時動態貼著他（他降我降、他爬回來最多回到 anchor）。
  //   俯衝走法的 anchor 在敵人低於它時同樣被貼下去 —— 與本設計一致，
  //   「多留一段優勢」讓位給「下去接戰」。
  //
  // 【回升不貼敵】打完一擊正要回到那一層，貼著下方的敵人的話回升永遠不會發生
  state.altitude = state.kind === 'regain' || state.anchor < sit.chaseAlt
    ? state.anchor : sit.chaseAlt
}

/**
 * 超出高度帶多遠，−1..1。**0 = 在帶內，本層完全不介入**。正 = 帶在上面、該爬。
 *
 * 【為什麼鎖的是一個帶而不是一條線】鎖 5000 m 指的是 4900~5100 這一段。
 * 鎖一條線的話，20 m 的誤差也會下指令 —— 而高度會被拉桿、
 * 推力、坡度不斷推開，結果是整個轉彎過程中俯仰指令一直在抗。帶內交給追擊，
 * 追擊才有空間把機首帶到該去的地方。
 *
 * 【為什麼出帶之後是斜坡而不是閥】帶緣上的閥就是一個裸門檻：跨線瞬間下滿舵、
 * 飛機有俯仰慣性、衝過頭、再跨回來 —— spec §3.5 量到的那個振盪 40 秒的極限環。
 * 回傳值同時驅動**指令角度**與**介入力道**（見呼叫端），所以帶緣上這一層是
 * 逐位元的恆等式，沒有任何不連續。
 */
export function bandError(deltaAltitude: number, cfg: BandConfig = DEFAULT_STEER): number {
  if (!(cfg.bandPitchScale > 0)) return 0
  const tol = cfg.bandTolerance
  let excess = deltaAltitude > tol
    ? deltaAltitude - tol
    : deltaAltitude < -tol ? deltaAltitude + tol : 0
  if (excess === 0) return 0
  excess /= cfg.bandPitchScale
  if (excess < -1) return -1
  if (excess > 1) return 1
  return excess
}
