import { Vector3 } from 'three'
import { G4M } from '../../specs/g4m'
import { F4F4 } from '../../specs/f4f4'
import {
  barrage, body, bodyUp, edit, rampedOffset, shipAt, timeline, velocityAt, wingman, wreckAt,
  type Cut, type Path, type ReelShip, type Shot,
} from './kit'

// ── 雷擊 ───────────────────────────────────────────────────
//
// 黃昏、倫內爾島外海，迎著落日。一式陸攻兩波貼海面 28 m 進場，兩艘巡洋艦、兩艘驅逐艦
// 往 +X 開、橫過前方，全艦開火。第一波右翼被防空打下；第二波後面咬著兩架野貓，
// 右翼那一架被野貓打得拖火落海。其餘越過巡洋艦的桅杆拉起，飛進夕陽。
//   0–3     第一波正後方貼海面：三架逆光剪影，鏡頭往前推，艦隊在天際線上
//   3–5.6   長機機腹下往前看：兩具發動機在畫面上緣，海面往後飛，遠處一架拖煙落海
//   5.6–8.4 巡洋艦另一側的望遠：陸攻從巡洋艦的上層結構後面衝出來
//   8.4–10.8  長機座艙後上方：巡洋艦在正前方越來越大，曳光迎面而來
//   10.8–13.4 右翼那一架的右翼後上方：黑雲在翼旁炸開、發動機冒煙，13.4 秒空中起火
//   13.4–16 貼海面在它後方：殘骸拖火落海激起水柱，巡洋艦逆光在後
//   16–18.6 野貓座艙後上方：咬著第二波右翼那一架連射，陸攻旋回槍回擊
//   18.6–21 那一架左前方貼著飛：拖煙、19.8 秒落海，野貓拉起脫離
//   21–23.6 巡洋艦遠側海面仰拍：長機越過桅杆與煙囪、從頭頂掠過
//   23.6–26.4 第二波長機機背上往後看：機翼在前景，巡洋艦拖著航跡，曳光追上來
//   26.4–29.2 第二波右後下方跟著爬：迎著落日的剪影，第一波在更前更高處
//   29.2–32 巡洋艦後方貼海面的大遠景：巡洋艦剪影，陸攻在上方越飛越小

const S1 = new Vector3()
const S3 = new Vector3()

const SPEED = 95
const ALT = 28
/** 第一波開始拉起的秒數。巡洋艦的投影範圍在 21.3～21.7 秒，到那裡要高過 55 m */
const PULL = 17.5
/** 長機：21.5 秒越過巡洋艦，之後以約 17° 的爬升角穩住 */
const lead: Path = (t, out) => {
  out.set(0, ALT + 1.0 * Math.sin(0.9 * t), 140 - SPEED * t)
  out.y += rampedOffset(t, PULL, 2, 10) - rampedOffset(t, PULL + 3, 2, 10)
  return out
}
const leftWing = wingman(lead, -34, 3, 38, 0.7)
/** 第一波右翼：防空打下 */
const AA_HIT = 2
const rightWing = wingman(lead, 36, -1, 42, 2.2)
const AA_KILL = 13.4

/**
 * 第二波：同一條航線晚 3.4 秒、左邊 150 m。從巡洋艦艦艉後方通過，
 * 不經過任何一艘船的投影範圍
 */
const WAVE2_LAG = 3.4
const wave2: Path = (t, out) => {
  lead(t - WAVE2_LAG, out)
  out.x -= 150
  out.y += 4
  return out
}
/** 第二波右翼：野貓打下。要在第二波拉起（20.9 秒）之前落海，殘骸才是貼海面摔下去 */
const FIGHTER_HIT = 4
const wave2Right = wingman(wave2, 34, -2, 44, 1.3)
const wave2Left = wingman(wave2, -34, 3, 40, 2.9)
const FIGHTER_KILL = 19.8

/** 野貓從後上方追上來要幾秒 */
const CHASE_IN = 14
/** 野貓拉起脫離的秒數：最後一段連射之後、目標落海之前 */
const BREAK = 18.4
/**
 * 野貓：從目標後上方 520 m 追近到 (dx, dy, dz)，`BREAK` 起往 `side` 那一側拉起脫離。
 * 追近用五次平滑曲線 —— 起點與終點的加速度都是零，姿態不會在 14 秒那一幀跳一下
 */
const wildcat = (target: Path, dx: number, dy: number, dz: number, side: number, phase: number): Path =>
  (t, out) => {
    target(t, out)
    const u = t >= CHASE_IN ? 1 : t / CHASE_IN
    const far = 1 - u * u * u * (10 - 15 * u + 6 * u * u)
    out.x += dx + side * 45 * far + 1.5 * Math.sin(0.8 * t + phase)
    out.y += dy + 70 * far + 1.2 * Math.sin(1.1 * t + phase)
    out.z += dz + 520 * far
    out.y += rampedOffset(t, BREAK, 1.5, 20) - rampedOffset(t, BREAK + 2.5, 1.5, 20)
    out.x += side * (rampedOffset(t, BREAK, 2, 12) - rampedOffset(t, BREAK + 3, 2, 12))
    return out
  }
const WILDCAT = 6
const wildcatA = wildcat(wave2Right, 6, 6, 70, 1, 0)
const wildcatB = wildcat(wave2Left, -8, 9, 80, -1, 1.1)

/** 開場就拖著煙往下掉的一架（配角），4.4 秒落海 */
const burning: Path = (t, out) => out.set(130, 55 - 4 * t, -380 - 90 * t)
/** 第三波，遠在右邊 */
const wave3: Path = (t, out) => {
  lead(t - 1.2, out)
  out.x += 420
  out.y += 6
  return out
}

const WICHITA: ReelShip = { cls: 'wichita', x: -100, z: -1900, heading: -Math.PI / 2, speed: 8 }

/**
 * 右翼那一架中彈那一刻在它前方炸開的兩朵黑雲，局部座標。側向至少 20 m —— 飛機
 * 0.5 秒內穿過去，貼著翼尖後方的鏡頭跟著掠過，再近就是一整片黑
 */
const HIT_FLAK_A = rightWing(10.9, new Vector3()).add(new Vector3(-22, 10, -50))
const HIT_FLAK_B = rightWing(11.05, new Vector3()).add(new Vector3(26, 6, -70))
const AA_KILL_P = rightWing(AA_KILL, new Vector3())
const AA_KILL_V = velocityAt(rightWing, AA_KILL, new Vector3())
const FIGHTER_KILL_P = wave2Right(FIGHTER_KILL, new Vector3())
const FIGHTER_KILL_V = velocityAt(wave2Right, FIGHTER_KILL, new Vector3())

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 正後方貼海面往前推：三架排成一個淺 V，迎著落日是剪影。
      // 再近的話兩架僚機會左右攤出畫面，左邊那一架躲進選單後面
      body(lead, t, 22, -18, 300 - 30 * t, true, out.position)
      body(lead, t, -10, 8, -250, true, out.target)
      out.fov = 30
    },
  },
  {
    from: 3, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、翼弦中間：機首玻璃與兩具發動機在畫面上緣，往前看貼著的海面
      body(lead, t, 0, -3.6, 2.0, false, out.position)
      body(lead, t, 0, -12, -200, false, out.target)
      bodyUp(lead, t, out.up)
      out.fov = 64
    },
  },
  {
    from: 5.6, subject: 0,
    camera(t, out) {
      // 巡洋艦遠側 320 m、30 m 高的望遠：視線剛好掠過艦體，陸攻從上層結構後面冒出來
      shipAt(WICHITA, t, S1)
      out.position.set(S1.x + 20, 30, S1.z - 320)
      lead(t, out.target)
      out.fov = 9
    },
  },
  {
    from: 8.4, subject: null, mount: 0,
    camera(t, out) {
      // 座艙罩後上方往前看：巡洋艦在正前方
      body(lead, t, 1.1, 2.4, 2.0, false, out.position)
      shipAt(WICHITA, t, out.target)
      out.target.y = 14
      bodyUp(lead, t, out.up)
      out.fov = 46
    },
  },
  {
    from: 10.8, subject: AA_HIT, mount: AA_HIT,
    camera(t, out) {
      // 右翼後上方、貼著平尾外側往前看：發動機拖出來的煙沿著翼面往鏡頭這邊掃過來。
      // 架在翼尖外側往內看的話，煙在鏡頭後面，畫面上看不到
      body(rightWing, t, 7.5, 2.8, 15, false, out.position)
      body(rightWing, t, 1.5, 0, -6, false, out.target)
      bodyUp(rightWing, t, out.up)
      out.fov = 50
    },
  },
  {
    from: AA_KILL, subject: null,
    camera(t, out) {
      // 殘骸後方貼海面：它往前栽進海裡，巡洋艦在水柱後面逆光
      out.position.set(AA_KILL_P.x + 50, 9, AA_KILL_P.z + 140)
      wreckAt(AA_KILL_P, AA_KILL_V, t - AA_KILL, out.target)
      out.fov = 34
    },
  },
  {
    from: 16, subject: FIGHTER_HIT, mount: WILDCAT,
    camera(t, out) {
      body(wildcatA, t, 0.7, 1.75, 2.6, false, out.position)
      wave2Right(t, out.target)
      bodyUp(wildcatA, t, out.up)
      out.fov = 40
    },
  },
  {
    from: 18.6, subject: FIGHTER_HIT,
    camera(t, out) {
      // 左前方貼著飛，落海之後鏡頭照原速再飛、轉過去看水柱
      const tc = t < FIGHTER_KILL ? t : FIGHTER_KILL
      body(wave2Right, tc, -26, -8, -34, true, out.position)
      out.position.z -= SPEED * (t - tc)
      if (t < FIGHTER_KILL) wave2Right(t, out.target)
      else wreckAt(FIGHTER_KILL_P, FIGHTER_KILL_V, t - FIGHTER_KILL, out.target)
      out.fov = 46
    },
  },
  {
    from: 21, subject: 0,
    camera(t, out) {
      // 巡洋艦遠側 60 m 的海面上仰拍：長機越過桅杆、從頭頂掠過
      out.position.set(10, 9, -1960)
      // 視線往桅杆那邊偏三成，桅杆才不會落在選單後面
      shipAt(WICHITA, t, S1)
      S1.y = 30
      lead(t, out.target).lerp(S1, 0.3)
      out.fov = 58
    },
  },
  {
    from: 23.6, subject: null, mount: 3,
    camera(t, out) {
      // 第二波長機機背上往後看：垂直尾翼在前景，艦隊在後下方，曳光追上來
      body(wave2, t, 0.8, 4.2, 3.5, false, out.position)
      shipAt(WICHITA, t, out.target)
      out.target.y = 10
      bodyUp(wave2, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 26.4, subject: 3,
    camera(t, out) {
      // 第二波右後下方跟著爬：迎著落日，兩架是剪影，第一波在更前面更高的地方
      body(wave2, t, 6, -10, 50, true, out.position)
      body(wave2, t, -4, 6, -200, true, out.target)
      out.fov = 44
    },
  },
  {
    from: 29.2, subject: 0,
    camera(t, out) {
      // 巡洋艦後方 500 m、貼海面迎著落日：巡洋艦是畫面下方的剪影，陸攻在它上方越飛越小
      shipAt(WICHITA, t, S1)
      out.position.set(S1.x - 60, 25, S1.z + 500)
      S1.y = 15
      lead(t, out.target).lerp(S1, 0.45)
      out.fov = 40
    },
  },
]

const CAMERA = edit(CUTS)
const flakAhead: Path = (t, out) => lead(t, out).add(S3.set(-40, 25, -170))

export const STRIKE: Shot = {
  id: 'strike',
  duration: 32,
  timeOfDay: 'dusk',
  captionKey: 'reel.strike',
  faceSun: true,
  clear: { x: 0, z: -1300, radius: 3000 },
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
    ...barrage(211, 3, 27, 2.2, flakAhead, { x: 220, yLo: -10, yHi: 120, z: 220 }, CAMERA, 70),
    ...barrage(223, 8, 29, 1.2, (t, out) => wave2(t, out).add(S3.set(0, 30, -120)),
      { x: 180, yLo: 0, yHi: 110, z: 180 }, CAMERA, 70),
    { at: 0, kind: 'smoke', actor: 8 },
    { at: 4.4, kind: 'kill', actor: 8, blast: false },
    { at: 5, kind: 'aa', ship: 0, actor: 0, seconds: 17, miss: 30 },
    { at: 6, kind: 'aa', ship: 1, actor: 1, seconds: 15, miss: 28 },
    { at: 7, kind: 'aa', ship: 3, actor: 3, seconds: 19, miss: 35 },
    { at: 9.5, kind: 'aa', ship: 0, actor: AA_HIT, seconds: 3.9, miss: 8 },
    { at: 10.9, kind: 'flak', x: HIT_FLAK_A.x, y: HIT_FLAK_A.y, z: HIT_FLAK_A.z },
    { at: 11, kind: 'smoke', actor: AA_HIT },
    { at: 11.05, kind: 'flak', x: HIT_FLAK_B.x, y: HIT_FLAK_B.y, z: HIT_FLAK_B.z },
    { at: 10, kind: 'aa', ship: 1, actor: 9, seconds: 12, miss: 50 },
    { at: 12, kind: 'aa', ship: 1, actor: 0, seconds: 9, miss: 40 },
    { at: 12, kind: 'aa', ship: 3, actor: 5, seconds: 14, miss: 40 },
    { at: 13, kind: 'aa', ship: 2, actor: FIGHTER_HIT, seconds: 6, miss: 25 },
    { at: AA_KILL, kind: 'kill', actor: AA_HIT, blast: true },
    { at: 13.8, kind: 'burst', actor: WILDCAT, seconds: 0.6 },
    { at: 14, kind: 'aa', ship: 2, actor: 0, seconds: 14, miss: 45 },
    { at: 14, kind: 'gunner', actor: 5, target: 7, seconds: 5.5, miss: 10 },
    { at: 14.5, kind: 'gunner', actor: FIGHTER_HIT, target: WILDCAT, seconds: 5, miss: 8 },
    { at: 15, kind: 'burst', actor: 7, seconds: 0.7 },
    { at: 15.5, kind: 'gunner', actor: 3, target: WILDCAT, seconds: 3.5, miss: 12 },
    { at: 16.2, kind: 'burst', actor: WILDCAT, seconds: 0.8 },
    { at: 16.8, kind: 'smoke', actor: FIGHTER_HIT },
    { at: 17, kind: 'burst', actor: 7, seconds: 0.8 },
    { at: 17.5, kind: 'burst', actor: WILDCAT, seconds: 1.0 },
    { at: FIGHTER_KILL, kind: 'kill', actor: FIGHTER_HIT, blast: false },
    { at: 21, kind: 'aa', ship: 0, actor: 1, seconds: 8, miss: 40 },
    { at: 22, kind: 'aa', ship: 0, actor: 3, seconds: 8, miss: 35 },
    { at: 23, kind: 'aa', ship: 3, actor: 0, seconds: 7, miss: 50 },
  ]),
}
