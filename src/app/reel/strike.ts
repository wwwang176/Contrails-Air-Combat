import { Vector3 } from 'three'
import { G4M } from '../../specs/g4m'
import { F4F4 } from '../../specs/f4f4'
import {
  BOMB_RELEASE_Y, TORPEDO_SPEED, barrage, body, bodyUp, edit, interceptShip, rampedOffset, shipAt, timeline,
  torpedoAt, torpedoEntry, velocityAt, wingman,
  type Cut, type Path, type ReelCamera, type ReelShip, type Shot,
} from './kit'

// ── 雷擊 ───────────────────────────────────────────────────
//
// 黃昏、倫內爾島外海，迎著落日。一式陸攻兩波貼海面 24 m 進場，兩艘巡洋艦、兩艘驅逐艦
// 往 +X 開、橫過前方，全艦開火。第一波右翼被防空打下；長機與左翼在距巡洋艦約 600 m
// 平飛投雷、拉起越過艦艏。第二波跟著投雷、從巡洋艦艦艉上空越過，右翼那一架被
// 咬在後面的野貓打得起火爆開。長機與左翼的雷跑了十八秒，28.4 與 29.2 秒一前一後
// 打在巡洋艦舷側；第二波的雷從艦艉後面擦過去。
//   0–2.6    第一波正後方貼海面：三架逆光剪影，鏡頭往前推，艦隊在天際線上
//   2.6–4.8  長機機腹下往前看：兩具發動機在畫面上緣，海面往後飛
//   4.8–7.1  右翼那一架的右翼後上方：黑雲炸開、右發起火，6.8 秒空中爆開
//   7.1–10.8 長機右側 40 m 貼海面跟拍：8.4 秒魚雷從機腹掉出，10.6 秒入水炸起水花
//   10.8–13  入水點後上方：白色航跡往前伸，長機與左翼拉起飛向巡洋艦，黑雲滿天
//   13–15.1  巡洋艦左舷艦艏外的海面仰拍：長機與左翼從艦艏前方的天空掠過
//   15.1–19.1 野貓座艙後上方：咬著第二波右翼瞄準連射，打到起火、18.9 秒爆開
//   19.1–22.4 跟在長機那一枚雷的後上方貼海面：航跡朝前方的巡洋艦直直伸過去
//   22.4–25.4 巡洋艦右舷前方 100 m 往艦艉看：船身在右，航跡從左邊斜斜逼近
//   25.4–28.1 航跡旁的海面：雷跡從鏡頭前劃過、衝向艦身
//   28.1–30.6 巡洋艦右舷 180 m：28.4 秒前段命中、29.2 秒後段再中，水柱與火光
//   30.6–33  巡洋艦後方貼海面：一道道雷跡收向冒煙的巡洋艦，陸攻在落日裡越飛越小

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

/** 船上一點（艦體座標：x 右舷、y 離海面、z 艦艉）在第 `t` 秒的世界座標 */
function onShip(s: ReelShip, t: number, lx: number, ly: number, lz: number, out: Vector3): Vector3 {
  shipAt(s, t, out)
  const c = Math.cos(s.heading)
  const n = Math.sin(s.heading)
  out.x += lx * c + lz * n
  out.y = ly
  out.z += -lx * n + lz * c
  return out
}

const AIM_A = new Vector3()
const AIM_B = new Vector3()
/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 600 m 的話，位置的內插幾乎就是遠的那一點
 */
function aimBetween(from: Vector3, a: Vector3, b: Vector3, w: number, out: Vector3): Vector3 {
  AIM_A.subVectors(a, from).normalize().multiplyScalar(100 * (1 - w))
  AIM_B.subVectors(b, from).normalize().multiplyScalar(100 * w)
  return out.copy(from).add(AIM_A).add(AIM_B)
}

const AIM_F = new Vector3()
const AIM_R = new Vector3()
const AIM_U = new Vector3()
const DEG = Math.PI / 180

/** 鏡頭往右轉 `yaw`、往上轉 `pitch`（弧度，小角度）：注視點沿畫面的右與上挪開 */
function turnAim(out: ReelCamera, yaw: number, pitch: number): void {
  AIM_F.subVectors(out.target, out.position)
  const dist = AIM_F.length()
  AIM_F.multiplyScalar(1 / dist)
  AIM_R.crossVectors(AIM_F, out.up).normalize()
  AIM_U.crossVectors(AIM_R, AIM_F)
  out.target.addScaledVector(AIM_R, yaw * dist).addScaledVector(AIM_U, pitch * dist)
}

/** 下面兩條正弦和的角度 RMS（每軸 √(0.7²/2 + 0.5²/2)，兩軸合起來） */
const HANDHELD_RMS = Math.SQRT2 * Math.sqrt(0.37)
/**
 * 手持晃動，**以角度計**：鏡頭指向的晃動 RMS 是 `deg` 度，頻率 0.33～1.13 Hz
 * （讀起來是手持或機上的慢晃；3 Hz 以上的快抖只留給 `jolt`）。
 * 用公尺疊在注視點上的話，同樣 1 m 在 20 m 外是 3°、在 500 m 外是 0.1°，看不出各刀晃多兇。
 * 呼叫時 `out.up` 要已經定好 —— 晃的方向是畫面的右與上
 */
function handheld(t: number, deg: number, seed: number, out: ReelCamera): void {
  const k = (deg * DEG) / HANDHELD_RMS
  turnAim(out,
    k * (0.7 * Math.sin(2.1 * t + seed) + 0.5 * Math.sin(5.3 * t + 2.3 * seed)),
    k * (0.7 * Math.sin(2.9 * t + 1.7 * seed) + 0.5 * Math.sin(7.1 * t + 0.9 * seed)))
}

/**
 * 衝擊：`at` 秒那一下猛晃 `deg` 度（約 3.3 Hz），0.25 秒的時間常數衰減，0.8 秒後歸零。
 * 爆炸、命中、擦身而過的那一瞬間用
 */
function jolt(t: number, at: number, deg: number, out: ReelCamera): void {
  const tau = t - at
  if (tau < 0 || tau > 0.8) return
  const k = deg * DEG * Math.exp(-tau / 0.25)
  turnAim(out, k * Math.sin(21 * tau + 0.5), k * Math.sin(17 * tau + 1.9))
}

const SPEED = 95
/** 進場高度。投雷時機腹離海面 22 m 上下，雷在空中飛約 200 m 才入水 */
const ALT = 24
/** 長機投雷的秒數：離巡洋艦中線約 600 m */
const T_DROP = 8.4
/**
 * 拉起：投雷 1.2 秒後才開始（投雷那一刻要平飛），越過巡洋艦那條航線時約 66 m。
 * 第二波照同一條剖面晚 3.4 秒，
 * 是從巡洋艦艦艉的上空越過 —— 那時要高過 55 m
 */
const PULL = T_DROP + 1.2
/** 長機第 0 秒的 z */
const LEAD_Z0 = -500
const lead: Path = (t, out) => {
  out.set(0, ALT + 0.8 * Math.sin(0.9 * t), LEAD_Z0 - SPEED * t)
  out.y += rampedOffset(t, PULL, 2, 5) - rampedOffset(t, PULL + 3, 2, 5)
  return out
}
const leftWing = wingman(lead, -34, 3, 38, 0.7)
/** 第一波右翼：投雷前被防空打下 */
const AA_HIT = 2
const rightWing = wingman(lead, 36, -1, 42, 2.2)
const AA_KILL = 6.8

/** 第二波：同一條航線晚 3.4 秒、左邊 150 m */
const WAVE2_LAG = 3.4
const wave2: Path = (t, out) => {
  lead(t - WAVE2_LAG, out)
  out.x -= 150
  out.y += 4
  return out
}
/** 第二波右翼：投雷之後被野貓打下 */
const FIGHTER_HIT = 4
const wave2Right = wingman(wave2, 34, -2, 44, 1.3)
const wave2Left = wingman(wave2, -34, 3, 40, 2.9)
const FIGHTER_KILL = 18.9

/** 野貓從後上方追上來要幾秒 */
const CHASE_IN = 15
/** 野貓拉起脫離的秒數：目標爆開之後 */
const BREAK = 19.1
/**
 * 野貓：飛在目標自己的航跡上、晚 `lag` 秒（偏開 dx、dy），從後上方 520 m 追近，
 * `BREAK` 起往 `side` 那一側拉起脫離。追近用五次平滑曲線 —— 起點與終點的加速度
 * 都是零，姿態不會在追上的那一幀跳一下。
 *
 * 【沿航跡晚幾秒，不是同一刻加個位移】目標在爬升時，同一刻往後平移的追擊者機首
 * 跟著爬升角朝上，目標卻在水平前方 —— 曳光沿機首打出去，從目標上方飛過。
 * 走在目標剛飛過的那一段上，機首才對著前面的目標
 */
const wildcat = (target: Path, lag: number, dx: number, dy: number, side: number, phase: number): Path =>
  (t, out) => {
    target(t - lag, out)
    const u = t >= CHASE_IN ? 1 : t / CHASE_IN
    const far = 1 - u * u * u * (10 - 15 * u + 6 * u * u)
    out.x += dx + side * 45 * far + 0.8 * Math.sin(0.8 * t + phase)
    out.y += dy + 70 * far + 0.6 * Math.sin(1.1 * t + phase)
    out.z += 520 * far
    out.y += rampedOffset(t, BREAK, 1.5, 20) - rampedOffset(t, BREAK + 2.5, 1.5, 20)
    out.x += side * (rampedOffset(t, BREAK, 2, 12) - rampedOffset(t, BREAK + 3, 2, 12))
    return out
  }
const WILDCAT = 6
/**
 * 咬住第二波右翼那一架，約 60 m 後、右偏 1.5 m、低 1 m：機首那條線穿過陸攻的機身
 * （曳光沿機首直直打出去，偏開超過翼展的 1/6 就打不到機身）。比目標高的話，
 * 從座艙往前看的視線落在自己的發動機罩後面，目標整架被擋住
 */
const wildcatA = wildcat(wave2Right, 0.63, 1.5, -1, 1, 0)
const wildcatB = wildcat(wave2Left, 0.84, -8, 9, -1, 1.1)

/** 開場就拖著煙往下掉的一架（配角），4.4 秒落海 */
const burning: Path = (t, out) => out.set(130, 55 - 4 * t, -380 - 90 * t)
/** 第三波，遠在右邊 */
const wave3: Path = (t, out) => {
  lead(t - 1.2, out)
  out.x += 420
  out.y += 6
  return out
}

/** 被雷擊的巡洋艦。x 照長機那一枚雷的航線定：雷直直跑過去，打在艦體中心前方 20 m */
const WICHITA: ReelShip = { cls: 'wichita', x: -249, z: -1900, heading: -Math.PI / 2, speed: 8 }
/** 長機越過巡洋艦航線（從艦艏前方的天空掠過）的秒數 */
const LEAD_OVERHEAD = (LEAD_Z0 - WICHITA.z) / SPEED

// ── 魚雷：投下那一刻的位置、速度與入水點都在載入時算一次 ──

interface Drop {
  readonly at: number
  readonly p: Vector3
  readonly v: Vector3
  /** 投下後幾秒入水 */
  readonly entry: number
  /** 入水點（y = 0） */
  readonly splash: Vector3
}

/** 跑不到底的瞄點：只拿來取入水點 */
const NOWHERE = { x: 0, z: -1e6 }

/** 這一架在 `at` 秒投的雷。機腹點與速度和放映機、護欄用的是同一個算法 */
function drop(path: Path, at: number): Drop {
  const p = body(path, at, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
  const v = velocityAt(path, at, new Vector3())
  const entry = torpedoEntry(p, v)
  const splash = new Vector3()
  torpedoAt(p, v, entry, NOWHERE, entry, splash)
  splash.y = 0
  return { at, p, v, entry, splash }
}

/** 沒打中的雷：從入水點順著原航向直跑，跑到片尾之後才到瞄點 */
function straight(d: Drop): { x: number, z: number } {
  const len = Math.hypot(d.v.x, d.v.z)
  return { x: d.splash.x + (d.v.x / len) * 1200, z: d.splash.z + (d.v.z / len) * 1200 }
}

const LEAD_DROP = drop(lead, T_DROP)
/**
 * 長機那一枚的瞄點：撞上巡洋艦的前置點，再往艦艏挪 20 m、往雷來的那一舷挪 6 m ——
 * 瞄在中線上的話水柱從甲板中間冒出來，看起來不像打在舷側
 */
const HIT = interceptShip(WICHITA, LEAD_DROP.splash, T_DROP + LEAD_DROP.entry, new Vector3())
HIT.x += 20
HIT.z += 6
/** 命中的秒數 */
const T_HIT = T_DROP + LEAD_DROP.entry + Math.hypot(HIT.x - LEAD_DROP.splash.x, HIT.z - LEAD_DROP.splash.z) / TORPEDO_SPEED
/** 長機那一枚的航向（水平單位向量）與它右手邊 */
const RUN = new Vector3(HIT.x - LEAD_DROP.splash.x, 0, HIT.z - LEAD_DROP.splash.z).normalize()
const RUN_RIGHT = new Vector3(-RUN.z, 0, RUN.x)

/** 左翼那一枚：晚 0.8 秒打在艦體中心後方 45 m，第二根水柱 */
const LEFT_DROP = drop(leftWing, T_DROP + 0.13)
const LEFT_AIM = interceptShip(WICHITA, LEFT_DROP.splash, LEFT_DROP.at + LEFT_DROP.entry, new Vector3())
LEFT_AIM.x -= 45
LEFT_AIM.z += 6
const T_LEFT_HIT = LEFT_DROP.at + LEFT_DROP.entry
  + Math.hypot(LEFT_AIM.x - LEFT_DROP.splash.x, LEFT_AIM.z - LEFT_DROP.splash.z) / TORPEDO_SPEED
/**
 * 命中之後船上冒的兩團黑煙與火光（借高砲黑雲來畫），貼在命中點上方。
 * 水柱本身只沖到桅杆一半、一秒多就散，少了這兩團命中看起來太輕
 */
const HIT_SMOKE_A = new Vector3(HIT.x - 4, 14, HIT.z - 6)
const HIT_SMOKE_B = new Vector3(LEFT_AIM.x + 3, 12, LEFT_AIM.z - 7)

const W2_AT = T_DROP + WAVE2_LAG
const W2_DROP = drop(wave2, W2_AT)
const W2R_DROP = drop(wave2Right, W2_AT + 0.45)
const W2L_DROP = drop(wave2Left, W2_AT + 0.4)

/** 長機那一枚在第 `t` 秒的位置（水中時 y = 雷深） */
const torpedo = (t: number, out: Vector3): Vector3 => {
  torpedoAt(LEAD_DROP.p, LEAD_DROP.v, LEAD_DROP.entry, HIT, t - T_DROP, out)
  return out
}

/**
 * 右翼那一架中彈那一刻在它前方炸開的兩朵黑雲，局部座標。側向至少 20 m —— 飛機
 * 0.5 秒內穿過去，貼著翼尖後方的鏡頭跟著掠過，再近就是一整片黑
 */
const HIT_FLAK_A = rightWing(5.0, new Vector3()).add(new Vector3(-22, 10, -50))
const HIT_FLAK_B = rightWing(5.15, new Vector3()).add(new Vector3(26, 6, -70))

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 正後方貼海面往前推：三架排成一個淺 V，迎著落日是剪影。
      // 再近的話兩架僚機會左右攤出畫面，左邊那一架躲進選單後面
      body(lead, t, 22, -16, 300 - 30 * t, true, out.position)
      body(lead, t, -10, 8, -250, true, out.target)
      // 平穩進場的望遠：只晃一點點，30° 的鏡頭會把晃動放大
      handheld(t, 0.12, 0, out)
      out.fov = 30
    },
  },
  {
    from: 2.6, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、翼弦中間：機首玻璃與兩具發動機在畫面上緣，往前看貼著的海面
      body(lead, t, 0, -3.6, 2.0, false, out.position)
      body(lead, t, 0, -12, -200, false, out.target)
      bodyUp(lead, t, out.up)
      out.fov = 64
    },
  },
  {
    from: 4.8, subject: AA_HIT, mount: AA_HIT,
    camera(t, out) {
      // 右翼後上方、貼著平尾外側往前看：發動機拖出來的煙與火沿著翼面往鏡頭這邊掃過來。
      // 架在翼尖外側往內看的話，煙在鏡頭後面，畫面上看不到
      body(rightWing, t, 7.5, 2.8, 15, false, out.position)
      body(rightWing, t, 1.5, 0, -6, false, out.target)
      bodyUp(rightWing, t, out.up)
      // 掛在機身上不晃；爆開那一下震一次
      jolt(t, AA_KILL, 1.0, out)
      out.fov = 50
    },
  },
  {
    from: AA_KILL + 0.3, subject: 0,
    camera(t, out) {
      // 長機右側 40 m 貼海面跟拍：機身在畫面上半、海面在下半，雷從機腹掉出來往下落，
      // 10.6 秒在機身後下方入水。注視點放在機身後方 10 m，入水的水花才不會落到選單後面。
      // 鏡頭高度釘在 12 m —— 跟著飛機的高度走的話，拉起時海面整片掉出畫面
      body(lead, t, 40, 0, 2, true, out.position)
      out.position.y = 12
      body(lead, t, 0, 0, 10, true, out.target)
      out.target.y = 14
      // 跟拍機：平穩的慢晃，看的是雷掉下去，不是鏡頭
      handheld(t, 0.2, 1, out)
      out.fov = 46
    },
  },
  {
    from: 10.8, subject: 0,
    camera(t, out) {
      // 釘在入水點後方 30 m、右邊 12 m、13 m 高：水花還在落，白色航跡從前方往巡洋艦伸，
      // 長機從頭頂前方拉起離去。注視點跟長機晚 0.3 秒，鏡頭像是手搖著追
      out.position.copy(LEAD_DROP.splash).addScaledVector(RUN, -30).addScaledVector(RUN_RIGHT, 12)
      out.position.y = 13
      S1.copy(LEAD_DROP.splash).addScaledVector(RUN, 70)
      S1.y = 0
      lead(t - 0.3, S2)
      aimBetween(out.position, S1, S2, 0.45, out.target)
      // 海面上的手持，水花剛炸開
      handheld(t, 0.3, 2, out)
      out.fov = 56
    },
  },
  {
    from: 13, subject: 0,
    camera(t, out) {
      // 左舷艦艏外 30 m 的海面上仰拍（艦體外擴 8 m 是 17.4，再往外才能低於桅杆）：
      // 長機從艦艏前方的天空掠過。注視點晚 0.25 秒，長機掠過頭頂時鏡頭追不太上
      onShip(WICHITA, t, -30, 9, -75, out.position)
      onShip(WICHITA, t, 0, 14, -92, S1)
      lead(t - 0.25, S2)
      aimBetween(out.position, S1, S2, 0.62, out.target)
      // 仰拍掠過的那一刀最緊張：手持晃得多一點，長機越過頭頂那一刻再震一下
      handheld(t, 0.35, 3, out)
      jolt(t, LEAD_OVERHEAD, 0.7, out)
      out.fov = 60
    },
  },
  {
    from: 15.1, subject: FIGHTER_HIT, mount: WILDCAT,
    camera(t, out) {
      // 野貓座艙罩右後上方：目標在正前方 60 m，曳光收向它
      body(wildcatA, t, 0.7, 1.75, 2.6, false, out.position)
      wave2Right(t, out.target)
      bodyUp(wildcatA, t, out.up)
      // 掛在機上不晃；目標在 60 m 外爆開那一下震一次
      jolt(t, FIGHTER_KILL, 0.6, out)
      out.fov = 40
    },
  },
  {
    from: FIGHTER_KILL + 0.2, subject: null,
    camera(t, out) {
      // 長機那一枚雷的右後上方貼海面：航跡從腳下往前直直伸向巡洋艦
      torpedo(t, S1)
      out.position.copy(S1).addScaledVector(RUN, -30).addScaledVector(RUN_RIGHT, 3)
      out.position.y = 6.5
      out.target.copy(S1).addScaledVector(RUN, 140)
      out.target.y = 1
      // 貼著浪跟著雷跑：慢晃，航跡要穩穩地指著巡洋艦
      handheld(t, 0.25, 5, out)
      out.fov = 50
    },
  },
  {
    from: 22.4, subject: null,
    camera(t, out) {
      // 跟著巡洋艦走、在它右舷前方 100 m 的海上往艦艉看：船身在畫面右邊（左邊是選單），
      // 航跡從左邊斜斜逼近船身（船往前開，雷在船上看是從前方斜著進來）
      onShip(WICHITA, t, 100, 26, -150, out.position)
      onShip(WICHITA, t, 9, 5, -20, S1)
      torpedo(t, S2)
      S2.y = 0
      aimBetween(out.position, S1, S2, 0.6, out.target)
      // 浪裡的起伏：鏡頭像架在一艘跟著巡洋艦開的小艇上（0.2 Hz 的上下，加上手持）
      out.position.y += 0.4 * Math.sin(1.3 * t)
      handheld(t, 0.3, 6, out)
      out.fov = 58
    },
  },
  {
    from: 25.4, subject: null,
    camera(t, out) {
      // 航跡右側 22 m 的海面上、離船身 90 m：雷跡從鏡頭前劃過、衝向艦身
      out.position.copy(HIT).addScaledVector(RUN, -90).addScaledVector(RUN_RIGHT, 22)
      out.position.y = 6.5
      torpedo(t, S1)
      S1.y = 0
      onShip(WICHITA, t, 9, 6, -20, S2)
      aimBetween(out.position, S1, S2, 0.55, out.target)
      // 命中前最後幾秒：手持晃得比前幾刀多一點
      handheld(t, 0.4, 7, out)
      out.fov = 50
    },
  },
  {
    from: 28.1, subject: null,
    camera(t, out) {
      // 巡洋艦右舷 180 m 的海面：船身橫在畫面裡，兩根水柱一前一後從舷側沖上來
      out.position.copy(HIT).addScaledVector(RUN, -170).addScaledVector(RUN_RIGHT, 50)
      out.position.y = 8
      out.target.set(HIT.x - 25, 18, HIT.z)
      // 等命中時穩著；兩次命中各震一下
      handheld(t, 0.15, 8, out)
      jolt(t, T_HIT, 0.9, out)
      jolt(t, T_LEFT_HIT, 0.7, out)
      out.fov = 38
    },
  },
  {
    from: 30.6, subject: 0,
    camera(t, out) {
      // 陸攻來的那一側、離巡洋艦 500 m 貼海面迎著落日：一道道雷跡收向冒煙的巡洋艦，
      // 陸攻在它上方越飛越小
      shipAt(WICHITA, t, S1)
      out.position.set(S1.x - 60, 25, S1.z + 500)
      S1.y = 15
      lead(t, out.target).lerp(S1, 0.45)
      // 收尾的大遠景：幾乎不晃
      handheld(t, 0.08, 9, out)
      out.fov = 40
    },
  },
]

const CAMERA = edit(CUTS)
const flakAhead: Path = (t, out) => lead(t, out).add(S3.set(-40, 25, -170))

export const STRIKE: Shot = {
  id: 'strike',
  duration: 33,
  timeOfDay: 'dusk',
  faceSun: true,
  clear: { x: 0, z: -1600, radius: 3000 },
  planes: [
    { spec: G4M, path: lead },
    { spec: G4M, path: leftWing },
    { spec: G4M, path: rightWing },
    { spec: G4M, path: wave2 },
    { spec: G4M, path: wave2Right },
    { spec: G4M, path: wave2Left },
    { spec: F4F4, path: wildcatA },
    { spec: F4F4, path: wildcatB, extra: true },
    { spec: G4M, path: burning, extra: true },
    { spec: G4M, path: wave3, extra: true },
    { spec: G4M, path: wingman(wave3, 36, -3, 42, 0.4), extra: true },
  ],
  ships: [
    // 往 +X 開，橫過陸攻的航線
    WICHITA,
    { cls: 'fletcher', x: 160, z: -1650, heading: -Math.PI / 2, speed: 8 },
    { cls: 'fletcher', x: -260, z: -2300, heading: -Math.PI / 2, speed: 8 },
    { cls: 'wichita', x: -620, z: -1960, heading: -Math.PI / 2, speed: 8 },
  ],
  cuts: CUTS,
  camera: CAMERA,
  events: timeline([
    ...barrage(211, 2, 15, 2.2, flakAhead, { x: 220, yLo: -10, yHi: 120, z: 220 }, CAMERA, 70),
    ...barrage(223, 8, 24, 1.2, (t, out) => wave2(t, out).add(S3.set(0, 30, -120)),
      { x: 180, yLo: 0, yHi: 110, z: 180 }, CAMERA, 70),
    { at: 0, kind: 'smoke', actor: 8 },
    { at: 4.4, kind: 'kill', actor: 8, blast: false },
    { at: 2, kind: 'aa', ship: 0, actor: 0, seconds: 13, miss: 30 },
    { at: 3, kind: 'aa', ship: 1, actor: 1, seconds: 12, miss: 28 },
    { at: 3.5, kind: 'aa', ship: 0, actor: AA_HIT, seconds: 3.3, miss: 8 },
    { at: 5.0, kind: 'flak', x: HIT_FLAK_A.x, y: HIT_FLAK_A.y, z: HIT_FLAK_A.z },
    { at: 5.1, kind: 'smoke', actor: AA_HIT, engine: 0, fire: true },
    { at: 5.15, kind: 'flak', x: HIT_FLAK_B.x, y: HIT_FLAK_B.y, z: HIT_FLAK_B.z },
    { at: 5, kind: 'aa', ship: 3, actor: 3, seconds: 14, miss: 35 },
    { at: 6, kind: 'aa', ship: 1, actor: 9, seconds: 12, miss: 50 },
    { at: AA_KILL, kind: 'kill', actor: AA_HIT, blast: true },
    { at: T_DROP, kind: 'torpedo', actor: 0, aim: HIT, hit: true },
    { at: LEFT_DROP.at, kind: 'torpedo', actor: 1, aim: LEFT_AIM, hit: true },
    { at: T_HIT + 0.15, kind: 'flak', x: HIT_SMOKE_A.x, y: HIT_SMOKE_A.y, z: HIT_SMOKE_A.z },
    { at: T_LEFT_HIT + 0.15, kind: 'flak', x: HIT_SMOKE_B.x, y: HIT_SMOKE_B.y, z: HIT_SMOKE_B.z },
    { at: 9, kind: 'aa', ship: 2, actor: 0, seconds: 10, miss: 40 },
    { at: 9, kind: 'aa', ship: 3, actor: 5, seconds: 14, miss: 40 },
    { at: 10, kind: 'aa', ship: 2, actor: FIGHTER_HIT, seconds: 6, miss: 25 },
    { at: W2_DROP.at, kind: 'torpedo', actor: 3, aim: straight(W2_DROP), hit: false },
    { at: W2L_DROP.at, kind: 'torpedo', actor: 5, aim: straight(W2L_DROP), hit: false },
    { at: W2R_DROP.at, kind: 'torpedo', actor: FIGHTER_HIT, aim: straight(W2R_DROP), hit: false },
    { at: 12, kind: 'aa', ship: 0, actor: 1, seconds: 8, miss: 40 },
    { at: 14, kind: 'aa', ship: 0, actor: 3, seconds: 8, miss: 35 },
    { at: 15.0, kind: 'burst', actor: WILDCAT, seconds: 0.5, target: FIGHTER_HIT },
    { at: 15, kind: 'gunner', actor: 5, target: 7, seconds: 5, miss: 10 },
    { at: 15.2, kind: 'gunner', actor: FIGHTER_HIT, target: WILDCAT, seconds: 4, miss: 8 },
    { at: 15.5, kind: 'burst', actor: 7, seconds: 0.7 },
    { at: 16.2, kind: 'burst', actor: WILDCAT, seconds: 0.9, target: FIGHTER_HIT },
    { at: 16, kind: 'gunner', actor: 3, target: WILDCAT, seconds: 3, miss: 12 },
    { at: 16.9, kind: 'smoke', actor: FIGHTER_HIT, engine: 0, fire: true },
    { at: 17.4, kind: 'burst', actor: 7, seconds: 0.8 },
    { at: 17.7, kind: 'burst', actor: WILDCAT, seconds: 1.1, target: FIGHTER_HIT },
    { at: FIGHTER_KILL, kind: 'kill', actor: FIGHTER_HIT, blast: true },
    { at: 16, kind: 'aa', ship: 3, actor: 0, seconds: 7, miss: 50 },
  ]),
}
