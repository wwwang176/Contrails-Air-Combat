/**
 * **空層鎖的 1v1 演練場**。不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/band-drill.probe.ts
 *   OPENING=headOn npx vite-node test/tools/band-drill.probe.ts   單跑一個開局
 *   TP='{"bandMaxPitch":0}' npx vite-node test/tools/band-drill.probe.ts   消融
 *
 * 【場景由專案負責人指定】「情境可以設定一台打不死的靶機（永遠直飛）跟我機
 * 面對面 1v1」。靶機每一步被外部釘回等速直線、血量拉滿 —— 它是一把**尺**，
 * 不是對手。這樣量到的高度全部是自機的決定，沒有任何一格來自「對手也在機動」。
 *
 * 【為什麼一定要靶機不能用真實關卡】護送關那條軌跡裡，高度同時被交會幾何、
 * 對手的機動、僚機、指揮層四件事推。「AI 有沒有鎖住空層」在那裡量不出來 ——
 * 掉 300 m 可能是它自己低頭，也可能是敵人把它拽下去的。
 *
 * 【三個開局對應三段人工敘述】見 `OPENINGS`。
 *
 * 【判準】主判準是**交會之後 60 秒的高度帶**：
 *
 *   band       max(y) − min(y)，m。鎖住 = 小
 *   sag        y 相對開局高度的最低點，m。負很多 = 掉下去爬不回來
 *   reacquire  aspectAngle 首次回到 45° 以內要幾秒。太大 = 鎖到不打仗了
 *
 * 前兩者與第三者**互相拉扯** —— 純水平轉最省高度但轉得慢，俯衝轉最快但把
 * 高度丟掉。任何一版只看其中一個都會過關，所以三個一起看。
 */
import { Quaternion, Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { ACE, VETERAN } from '../../src/ai/profile'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { BF109G6 } from '../../src/specs/bf109g6'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const RAD = Math.PI / 180
const FWD = new Vector3(0, 0, -1)

/** 我機的開局高度。專案負責人舉的例子就是 5000 m */
const ALT = 5000
const TAS = 180
/** 交會之後量多久。高度問題 30 秒看不出來（`steer.ts` 記載的教訓） */
const WINDOW = 60
const SECONDS = 100

/** 無傷害彈藥 —— 量的是機動，不是誰打死誰 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const MINE: AircraftSpec = { ...BF109G6, battery: harmless(BF109G6.battery) }
const DRONE: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

/** 靶機的控制器：不開火、不機動（狀態每步被外部釘回去） */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(FWD)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

interface Opening {
  label: string
  /** 靶機相對我的位置。−Z 是我的正前方 */
  offset: Vector3
  /** 靶機的航向（單位向量） */
  course: Vector3
}

/**
 * 三個開局，逐字對應人工敘述。
 *
 * 【`headOn` 是主要情境】「我在 5000 M 跟敵人面對面攻擊，敵人從我面前穿越後，
 * 我會啟動平飛迴轉（保持 5000 M 左右）的方式迴旋找敵人。」
 *
 * 【另外兩個是 2026-08-24 補充的】「敵人在我後方且我比他高，平飛迴轉；敵人在
 * 我前上方，補能量但朝向敵人抬高飛。」後者量的其實是 `extendPitchAngle` 的
 * 高度項（`altitudeGapScale`），不是空層鎖 —— 但兩者在同一條軌跡上交棒，
 * 分開量會看不到交棒處的斷點。
 */
const OPENINGS: Record<string, Opening> = {
  headOn: {
    label: '面對面同高（3000 m）',
    offset: new Vector3(0, 0, -3000),
    course: new Vector3(0, 0, 1),
  },
  behindBelow: {
    label: '敵人在我後方 1200 m、比我低 800 m',
    offset: new Vector3(0, -800, 1200),
    course: new Vector3(0, 0, -1),
  },
  frontAbove: {
    label: '敵人在我前上方 2000 m、比我高 1000 m',
    offset: new Vector3(0, 1000, -2000),
    course: new Vector3(0, 0, 1),
  },
  /**
   * 【2026-08-24 的人工回報】「敵人在我的前方從左舷飛到右舷，跟我高度同高，
   * 距離 600 M，我一樣沒有瞄準到預瞄點（反而是瞄在飛機與預瞄點中間）。」
   * 那是 `engageKnobs` 的後置追擊 —— 尾追門在 90° 橫越還留一半權重。
   * 這個開局量的是**機首離預瞄點幾度**（ld 欄），咬住 = 幾度以內。
   */
  crossing: {
    label: '敵人在正前方 600 m 同高、左舷向右舷橫越',
    offset: new Vector3(0, 0, -600),
    course: new Vector3(1, 0, 0),
  },
  /**
   * 【2026-08-24 的人工回報】「__drill 交會後觸發 extend（能量+高度），敵人在
   * 我的右後方，為什麼沒有慢慢地朝他的方位轉向？」敵人擺在右後上方：
   * 上方 400 m 讓高度閂鎖（floorGap < 0）與高度加權的能量閂鎖一起觸發，
   * 重現「能量+高度」的組合。量的是回場轉率與 asp 收斂時間。
   */
  /**
   * 【2026-08-24 專案負責人指定的量測局】「敵人持續在遠方（600~800 M）繞圈、
   * 在我機同高度橫飛，看看鎖不鎖得到。」靶機每步釘在「以我機當下位置為
   * 圓心、半徑 700 m、同高」的圓軌道上切向飛 —— 距離與橫越幾何永遠不變。
   * 視線角速度 180/700 ≈ 15°/s，在 109 的轉率能力內、低於開火紀律的
   * maxLosRate（0.35 rad/s ≈ 20°/s）。理論上鎖得住。
   */
  orbit: {
    label: '靶機繞著我 700 m 等距橫飛（15°/s）',
    offset: new Vector3(0, 0, -700),
    course: new Vector3(1, 0, 0),
  },
  /**
   * 【2026-08-24 補償器的欺敵對照局】尾追 500 m、靶機做 S 繞（6 s 週期、
   * 航向 ±11.5°、約 3.4 G 的橫向假動作）。穩態補償器的成敗判準是一對：
   * orbit（等速繞圈）要被補上、weave（交替假動作）要維持跟不上 ——
   * 「新鮮 − 延遲」的差在 S 繞下正負交替，低通應把它平均成零。
   */
  weave: {
    label: '尾追 500 m，靶機 S 繞（6 s 週期 ±11.5°）',
    offset: new Vector3(0, 0, -500),
    course: new Vector3(0, 0, -1),
  },
  /**
   * 【2026-08-25 專案負責人的實戰回報】「我開 P-51 在 4800 m，敵方 Bf 109
   * 在我下方**射程內**，卻死不低頭攻擊，最後觸發 extend(迴旋) 平飛離開。」
   * 敵人在下方 400 m、斜距 530 m —— 肉眼「就在射程內」。推測的死結：
   * 夾角項飽和（敵在下方 ≈ 高夾角）鎖住俯仰 → 機頭壓不向他 → 攔截時間
   * 不收斂 → 讓位閘（射程項 < 0.3 才淡出）永遠不開 → 平飛繞圈到迴轉
   * 閂鎖到期。判據：力道欄若恆為 1，即「閘沒開」得證。
   */
  below: {
    label: '敵人在下方 400 m（斜距 530 m 射程級）',
    offset: new Vector3(0, -400, -350),
    course: new Vector3(1, 0, 0),
  },
  /**
   * 【死結的完整重現】直飛與橫越的下方靶機都攔得到（幾何一下就收斂）；
   * 實戰那幕的關鍵是 109 在下面**繞著轟炸機轉** —— 幾何持續旋轉、攔截
   * 時間永不收斂。靶機繞著「開局位置正前方 600 m、下方 400 m」的固定
   * 圓心，半徑 400 m、150 m/s（21°/s，一台在低處纏鬥的 109）。
   */
  belowOrbit: {
    label: '敵人在下方 400 m 繞固定圓心（半徑 400、150 m/s）',
    offset: new Vector3(0, -400, -600),
    course: new Vector3(1, 0, 0),
  },
  rearHigh: {
    label: '敵人在右後上方（右 600、後 900、上 400）',
    offset: new Vector3(600, 400, 900),
    course: new Vector3(0, 0, -1),
  },
  /**
   * 【2026-08-24 的人工回報】「如果攻擊階段、補能量階段飛機的姿態是機背朝下，
   * 這時候觸發拉升會變得更俯衝，應該要先把飛機滾轉回正再拉高。」開局就把自機
   * 擺成倒飛、敵人在正後方 —— 空層鎖立刻要求平飛迴轉，而倒飛的飛機拉桿是往
   * 地面拉。量「回正之前掉了多少高度」。
   */
  inverted: {
    label: '我機倒飛、敵人在我正後方 1500 m 同高',
    offset: new Vector3(0, 0, 1500),
    course: new Vector3(0, 0, -1),
  },
}

interface Row {
  t: number
  y: number
  /** 航跡角，度 */
  ga: number
  /** 坡度，度。倒飛時 |bk| > 90 —— 用 atan2(right.y, up.y) 才分得出來 */
  bk: number
  /** 指令的航跡角（aimWorld 相對地平線），度。與 ga 對照就知道是誰在低頭 */
  cmd: number
  v: number
  /** 機首與視線的夾角，度 */
  asp: number
  range: number
  intent: string
  mode: string
  kind: string
  hold: number
  /** 高度帶中心 − 我的高度，m */
  dy: number
  /** 機首與預瞄點的夾角，度。咬住預瞄點 = 小 */
  ld: number
  /**
   * **實際輸出的指令**（含反應延遲）與預瞄點的夾角，度。
   * ad ≈ 0 而 ld 大 = 指令對、機體還在追；ad 也大 = 有層在偏移指令。
   */
  ad: number
  /** 取樣窗內的最大過載，G */
  g: number
  /** 3D 重播用：自機位置與姿態、靶機位置、預瞄點世界座標 */
  px: number, pz: number
  qx: number, qy: number, qz: number, qw: number
  dx: number, dy2: number, dz: number
  lx: number, ly: number, lz: number
  /** 取樣窗內的最小失速餘裕。1.0 = 貼著 CLmax，1.15 = unload 閘門線 */
  sm: number
}

function run(key: string): void {
  const o = OPENINGS[key]!
  const world = new World()

  const mine = new Aircraft(MINE, ALT, TAS)
  const drone = new Aircraft(DRONE, ALT + o.offset.y, TAS)

  const minePos = new Vector3(0, ALT, 0)
  const dronePos = minePos.clone().add(o.offset)
  const droneVel = o.course.clone().normalize().multiplyScalar(TAS)

  for (const [a, p, c] of [
    [mine, minePos, FWD],
    [drone, dronePos, o.course.clone().normalize()],
  ] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, c)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }
  if (key === 'inverted') {
    // 繞自身縱軸滾 180 度 —— 機背朝下、機首方向不變
    const roll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)
    mine.state.orientation.multiply(roll)
    mine.prevOrientation.copy(mine.state.orientation)
  }

  const ai = new AiController()
  const mc = world.add(mine, ai, 'blue', minePos, ALT, TAS)
  const dc = world.add(drone, new Idle(), 'red', dronePos, ALT + o.offset.y, TAS)
  for (const c of [mc, dc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  // PROFILE=ace 量「零反應延遲」的對照 —— 代飛在 profile 漏接修正前就是這個
  ai.profile = process.env['PROFILE'] === 'ace' ? ACE : VETERAN
  // TAU=2 在 VETERAN 的 0.3 s 延遲上掛穩態補償器 —— 掃描 τ 用
  const tau = Number(process.env['TAU'] ?? '')
  if (tau > 0) ai.profile = { ...VETERAN, trimTau: tau }

  const droneStart = dronePos.clone()
  // orbit 開局的軌道相位。從正前方（−Z）開始逆時針；15°/s 的視線角速度
  let orbitAngle = -Math.PI / 2
  const ORBIT_R = 700
  const ORBIT_V = 180
  // belowOrbit 開局：固定圓心（開局時定死，不跟著我機）與相位
  const BO_R = 400
  const BO_V = 150
  let boAngle = 0
  const boCx = dronePos.x
  const boCz = dronePos.z
  const BO_ALT = ALT - 400
  // weave 開局：航向 psi = A sin(w t)，位置逐步積分（決定性）
  const WEAVE_V = 170
  const WEAVE_A = 0.35
  const WEAVE_W = (2 * Math.PI) / 6
  let weaveX = droneStart.x
  let weaveZ = droneStart.z
  const rows: Row[] = []
  const los = new Vector3()
  const nose = new Vector3()
  // 逐步量過載：速度差分減重力。取樣窗內取最大 —— 「這一段有沒有拉到極限」
  const prevVel = mine.state.velocity.clone()
  const accel = new Vector3()
  let gMax = 0
  let smMin = Infinity

  for (let s = 0; s < SECONDS * 240; s++) {
    world.step(DT)
    accel.copy(mine.state.velocity).sub(prevVel).divideScalar(DT)
    accel.y += 9.80665
    const g = accel.length() / 9.80665
    if (g > gMax) gMax = g
    prevVel.copy(mine.state.velocity)
    if (ai.sit.stallMargin < smMin) smMin = ai.sit.stallMargin
    // 【靶機釘回等速直線 + 血量拉滿】「打不死的靶機（永遠直飛）」的全部意思
    if (key === 'orbit') {
      // 【繞著我機等距橫飛】圓心 = 我機當下位置、高度固定在開局值。
      // 這是量測儀不是對手 —— 幾何被釘死，追瞄誤差沒有藉口。
      orbitAngle += (ORBIT_V / ORBIT_R) * DT
      const ocx = mine.state.position.x
      const ocz = mine.state.position.z
      drone.state.position.set(
        ocx + ORBIT_R * Math.cos(orbitAngle), ALT,
        ocz + ORBIT_R * Math.sin(orbitAngle),
      )
      drone.state.velocity.set(
        -Math.sin(orbitAngle) * ORBIT_V, 0, Math.cos(orbitAngle) * ORBIT_V,
      )
      drone.state.orientation.setFromUnitVectors(
        FWD, drone.state.velocity.clone().normalize(),
      )
    } else if (key === 'belowOrbit') {
      // 【繞固定圓心】與 orbit 的差別：圓心不跟著我機 —— 它在打別人，
      // 不是在量我。半徑 400 起繞，圓心 = 開局位置。
      boAngle += (BO_V / BO_R) * DT
      drone.state.position.set(
        boCx + BO_R * Math.cos(boAngle), BO_ALT,
        boCz + BO_R * Math.sin(boAngle),
      )
      drone.state.velocity.set(
        -Math.sin(boAngle) * BO_V, 0, Math.cos(boAngle) * BO_V,
      )
      drone.state.orientation.setFromUnitVectors(
        FWD, drone.state.velocity.clone().normalize(),
      )
    } else if (key === 'weave') {
      // 【S 繞靶機】基準航向 −Z，航向做正弦擺動 —— 一下左彎一下右彎的假動作
      const psi = WEAVE_A * Math.sin(WEAVE_W * ((s + 1) * DT))
      const vx = WEAVE_V * Math.sin(psi)
      const vz = -WEAVE_V * Math.cos(psi)
      weaveX += vx * DT
      weaveZ += vz * DT
      drone.state.position.set(weaveX, ALT, weaveZ)
      drone.state.velocity.set(vx, 0, vz)
      drone.state.orientation.setFromUnitVectors(
        FWD, drone.state.velocity.clone().normalize(),
      )
    } else {
      drone.state.position.copy(droneStart).addScaledVector(droneVel, (s + 1) * DT)
      drone.state.velocity.copy(droneVel)
    }
    drone.state.angularVelocity.set(0, 0, 0)
    drone.prevPosition.copy(drone.state.position)
    drone.prevOrientation.copy(drone.state.orientation)
    dc.hp = DRONE.hp
    dc.alive = true

    if (!mc.alive) {
      console.log(`  ${(s * DT).toFixed(1)} s：自機墜毀，停`)
      break
    }
    if (s % 60 !== 0) continue

    los.copy(drone.state.position).sub(mine.state.position)
    const range = los.length()
    nose.copy(FWD).applyQuaternion(mine.state.orientation)
    const asp = range > 1e-3 ? Math.acos(
      Math.max(-1, Math.min(1, nose.dot(los) / range)),
    ) / RAD : 0

    const v = mine.state.velocity
    const horiz = Math.hypot(v.x, v.z)
    const right = new Vector3(1, 0, 0).applyQuaternion(mine.state.orientation)
    const up = new Vector3(0, 1, 0).applyQuaternion(mine.state.orientation)
    // 【讀 AI 的原始指令而不是飛機的姿態】兩者的差就是「它想去哪」與「它到得了
    // 哪」的差。`raw` 是 private，量測用轉型讀 —— 探針不是產品程式碼。
    const aim = (ai as unknown as { raw: Command }).raw.aimWorld

    const lead = (ai as unknown as { basis: { leadPoint: Vector3 } }).basis.leadPoint
    const ll = lead.length()
    const ld = ll > 1e-3 ? Math.acos(
      Math.max(-1, Math.min(1, nose.dot(lead) / ll)),
    ) / RAD : 0
    const cmdAim = mc.command.aimWorld
    const ad = ll > 1e-3 && cmdAim.length() > 1e-3 ? Math.acos(
      Math.max(-1, Math.min(1, cmdAim.dot(lead) / (ll * cmdAim.length()))),
    ) / RAD : 0

    rows.push({
      t: s * DT,
      ld,
      ad,
      px: +mine.state.position.x.toFixed(1),
      pz: +mine.state.position.z.toFixed(1),
      qx: +mine.state.orientation.x.toFixed(4),
      qy: +mine.state.orientation.y.toFixed(4),
      qz: +mine.state.orientation.z.toFixed(4),
      qw: +mine.state.orientation.w.toFixed(4),
      dx: +drone.state.position.x.toFixed(1),
      dy2: +drone.state.position.y.toFixed(1),
      dz: +drone.state.position.z.toFixed(1),
      lx: +(mine.state.position.x + lead.x).toFixed(1),
      ly: +(mine.state.position.y + lead.y).toFixed(1),
      lz: +(mine.state.position.z + lead.z).toFixed(1),
      cr: +ai.sit.cornerRatio.toFixed(3),
      es: ai.defend.extendSide,
      y: mine.state.position.y,
      ga: Math.atan2(v.y, horiz) / RAD,
      bk: -Math.atan2(right.y, up.y) / RAD,
      cmd: Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) / RAD,
      v: v.length(),
      asp,
      range,
      intent: ai.intent,
      mode: ai.mode,
      kind: ai.band.kind,
      hold: ai.band.hold,
      dy: ai.band.kind === 'off' ? 0 : ai.band.altitude - mine.state.position.y,
      g: gMax,
      sm: smMin,
    })
    gMax = 0
    smMin = Infinity
  }

  // ── 交會點：距離的第一個極小值 ──────────────────────────
  let merge = 0
  for (let i = 1; i < rows.length - 1; i++) {
    if (rows[i]!.range <= rows[i - 1]!.range && rows[i]!.range < rows[i + 1]!.range) {
      merge = i
      break
    }
  }
  const after = rows.filter((r) => r.t >= rows[merge]!.t && r.t <= rows[merge]!.t + WINDOW)

  // 【JSON=1 給 HTML artifact 畫圖】stdout 一行一個開局的完整取樣
  if (process.env['JSON'] === '1') {
    console.log(JSON.stringify({ key, label: o.label, alt: ALT, rows }))
    return
  }
  console.log(`\n══ ${o.label} ══`)
  console.log('   t    高度   航跡  指令  坡度  空速  夾角  預瞄差  距離   意圖     模式        鎖   力道   帶差    G   失速餘裕')
  for (const r of rows) {
    if (r.t % 2 !== 0) continue
    const mark = r === rows[merge] ? ' ←交會' : ''
    console.log(
      `  ${r.t.toFixed(0).padStart(3)} ${r.y.toFixed(0).padStart(6)}`
      + ` ${r.ga.toFixed(0).padStart(5)}° ${r.cmd.toFixed(0).padStart(4)}°`
      + ` ${r.bk.toFixed(0).padStart(5)}°`
      + ` ${r.v.toFixed(0).padStart(5)} ${r.asp.toFixed(0).padStart(4)}°`
      + ` ${r.ld.toFixed(0).padStart(4)}°/${r.ad.toFixed(0)}°`
      + ` ${r.range.toFixed(0).padStart(5)}`
      + ` ${r.intent.padEnd(8)} ${r.mode.padEnd(11)}`
      + ` ${r.kind.padEnd(5)} ${r.hold.toFixed(2)} ${r.dy.toFixed(0).padStart(6)}`
      + ` ${r.g.toFixed(1).padStart(4)} ${r.sm === Infinity ? '  —' : r.sm.toFixed(2).padStart(6)}${mark}`,
    )
  }

  const ys = after.map((r) => r.y)
  const band = Math.max(...ys) - Math.min(...ys)
  const sag = Math.min(...ys) - ALT
  let reacquire = -1
  for (let i = merge + 1; i < rows.length; i++) {
    if (rows[i]!.asp < 45) { reacquire = rows[i]!.t - rows[merge]!.t; break }
  }
  const kinds = new Map<string, number>()
  for (const r of after) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1)

  console.log(
    `\n  交會 ${rows[merge]!.t.toFixed(0)} s（${rows[merge]!.range.toFixed(0)} m）`
    + `　交會後 ${WINDOW} s：帶寬 ${band.toFixed(0)} m`
    + `　最低 ${sag >= 0 ? '+' : ''}${sag.toFixed(0)} m`
    + `　重新對上 ${reacquire < 0 ? '未' : reacquire.toFixed(0) + ' s'}`,
  )
  console.log('  鎖的分佈　' + [...kinds].map(
    ([k, n]) => `${k} ${(100 * n / after.length).toFixed(0)}%`,
  ).join('　'))
}

// 【設定覆寫由環境變數進】掃描與消融不必改原始碼重跑，與其他探針同一個手法
const tp = process.env['TP']
if (tp) {
  Object.assign(DEFAULT_STEER, JSON.parse(tp) as Record<string, number>)
  console.log(`覆寫：${tp}`)
}
console.log(
  `Bf 109 G-6（AI、VETERAN）對打不死的直飛 P-51D 靶機。`
  + `開局 ${ALT} m / ${TAS} m/s。bandMaxPitch = `
  + `${(DEFAULT_STEER.bandMaxPitch / RAD).toFixed(0)}°`,
)
const only = process.env['OPENING']
for (const k of Object.keys(OPENINGS)) {
  if (only && k !== only) continue
  run(k)
}
