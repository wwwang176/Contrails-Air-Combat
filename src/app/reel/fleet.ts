import { Vector3 } from 'three'
import { F6F5 } from '../../specs/f6f5'
import { F4F4 } from '../../specs/f4f4'
import { scatterClouds } from '../../render/clouds'
import {
  body, bodyUp, edit, rampedOffset, shipAt, wingman,
  type Cut, type Path, type ReelCamera, type ReelPlane, type ReelShip, type Shot,
} from './kit'
import { aimBetween } from './reelCameraMath'

// ── 艦隊 ───────────────────────────────────────────────────
//
// 拂曉的菲律賓海，特遣艦隊以輪形陣往朝陽開。三個戰鬥機隊形輪流進場：
// 低空四機（L）從艦尾追上來沿航艦左舷掠過、再爬向太陽；高空四機（H）繞著艦隊
// 盤旋；一對（P）從後上方俯衝、在航艦上空拉平通場。野貓在更外圈反向盤旋當背景。
//   0–3     艦艏劈浪：海面上、艦艏右前方，回看艦艏與外飄的甲板
//   3–5.5   右舷海面仰拍艦島與煙囪，高空四機從艦島後方的天空劃過
//   5.5–8.5 掛在 H 長機左翼尖回看座艙：壓坡度盤旋，座艙後面是整個輪形陣
//   8.5–11  艦尾後方的海面：低空四機從背後追上來，從鏡頭頂上呼嘯而過
//   11–13   左舷艦艏、略高於甲板，順著飛行甲板往艦艉看：低空四機貼著左舷迎面衝來
//   13–16.5 貼著海面看前出的驅逐艦衝過來，航艦在它後面，P 兩架在高空
//   16.5–19.5 掛在 P 僚機的垂尾後面往前看：長機與航艦都在俯衝線的前下方
//   19.5–22 艦艏前方的海面：P 兩架拉平、越過艦島朝鏡頭頂上衝來
//   22–25   H 僚機的右肩後：長機在右前方，整個艦隊在下面轉
//   25–28   低空四機的梯隊延長線稍後方：四架由近到遠疊成一串，迎著太陽爬升
//   28–32   艦隊左後上方的大遠景：輪形陣的航跡、迎光的海面

const S1 = new Vector3()
const S2 = new Vector3()

const FLEET_SPEED = 9
/** 航艦。艦體座標：艦艏 z −133、艦島在右舷 x 9.5…16.5、z −28…+7、頂 41.6 */
const ESSEX: ReelShip = { cls: 'essex', x: 0, z: 0, heading: 0, speed: FLEET_SPEED }
/**
 * 右舷前方加速前出的驅逐艦：與艦隊同航向、快 4 m/s，一路超到航艦前面。艦艏在艦體 z −57。
 * 航向與艦隊不同的話，從空中看就是一艘船走歪了
 */
const DD_SPRINT: ReelShip = { cls: 'fletcher', x: 240, z: -300, heading: 0, speed: 13 }

/** 船上一點（艦體座標：x 右舷、z 艦艉）在第 `t` 秒的世界座標 */
function onShip(s: ReelShip, t: number, lx: number, ly: number, lz: number, out: Vector3): Vector3 {
  shipAt(s, t, out)
  const c = Math.cos(s.heading)
  const n = Math.sin(s.heading)
  out.x += lx * c + lz * n
  out.y = ly
  out.z += -lx * n + lz * c
  return out
}

/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 600 m 的話，位置的內插幾乎就是遠的那一點
 */

const SH_F = new Vector3()
const SH_R = new Vector3()
const SH_U = new Vector3()
/** 三個不成倍數的慢頻率（Hz）疊起來的振幅；均方根是 √(Σa²/2) = 0.70 */
const SWAY_A = [0.8, 0.5, 0.3] as const
const SWAY_HZ = [0.37, 0.83, 1.31] as const
const SWAY_RMS = 0.70
/** 一軸的手持慢晃，均方根 1（無單位） */
function sway(t: number, seed: number): number {
  let s = 0
  for (let k = 0; k < 3; k++) s += SWAY_A[k]! * Math.sin(2 * Math.PI * SWAY_HZ[k]! * t + seed * (k + 1.7))
  return s / SWAY_RMS
}

/**
 * 手持晃動：把視線轉開一個小角度（偏航＋俯仰），**量的是角度不是公尺** —— 同樣晃 1 m，
 * 8 m 外的主角是 7°、500 m 外的遠景看不出來。`deg` 是視線方向的均方根晃動，度；
 * `kickAt` 起再疊一下 3.5 Hz、0.18 秒衰減的抖動，峰值 `kickDeg`（擦身而過那一瞬間）。
 * 注視點沿著與視線垂直的方向挪，鏡頭位置不動 —— 位置一動，貼在旁邊的飛機會跟著跳
 */
function handheld(out: ReelCamera, t: number, deg: number, seed: number, kickAt = -1, kickDeg = 0): void {
  SH_F.subVectors(out.target, out.position)
  const d = SH_F.length()
  SH_F.multiplyScalar(1 / d)
  SH_R.crossVectors(SH_F, out.up).normalize()
  SH_U.crossVectors(SH_R, SH_F)
  const axis = (deg * Math.PI / 180) / Math.SQRT2
  let yaw = axis * sway(t, seed)
  let pitch = axis * sway(t, seed + 3.1)
  const u = t - kickAt
  if (kickAt >= 0 && u > 0) {
    const k = (kickDeg * Math.PI / 180) * Math.exp(-u / 0.18) * Math.sin(2 * Math.PI * 3.5 * u)
    yaw += 0.6 * k
    pitch += k
  }
  out.target.addScaledVector(SH_R, d * Math.tan(yaw)).addScaledVector(SH_U, d * Math.tan(pitch))
}

// ── 低空四機（L）：左梯隊，貼著 30 m 從艦尾追上來 ──
//
// 12.5 秒與航艦的艦島並排。航艦艦體外擴 8 m 到 x −22，再往外的海面上才能低於桅杆，
// 所以長機在 x −36、三架僚機一路往左排。
const LOW_SPEED = 115
const lowLead: Path = (t, out) => {
  out.set(-36, 30, 1325 - LOW_SPEED * t)
  out.y += rampedOffset(t, 14, 2, 7) - rampedOffset(t, 18, 2, 7)
  return out
}
/** 長機從艦尾後方那個海面機位頭頂掠過的秒數 */
const PASS_OVER = 9.35
const LOW_2 = wingman(lowLead, -16, 1, 12, 0.3)
const LOW_3 = wingman(lowLead, -32, 0, 24, 1.1)
const LOW_4 = wingman(lowLead, -48, 2, 36, 2.0)

// ── 高空與野貓的盤旋：圓心跟著艦隊走 ──
const ORBIT_CZ = -100
/**
 * 繞著艦隊的圓。`w` > 0 是右轉（圓心在右手邊）。僚機用同一個角速度、不同半徑與
 * 角度落後 —— 轉彎裡的隊形才不會散：外圈的飛得快，與真的編隊轉彎同一個關係。
 */
function orbit(r: number, alt: number, w: number, theta0: number, bob: number): Path {
  return (t, out) => {
    const th = theta0 + w * t
    return out.set(
      r * Math.cos(th),
      alt + 1.4 * Math.sin(0.47 * t + bob),
      ORBIT_CZ - FLEET_SPEED * t + r * Math.sin(th),
    )
  }
}
const HIGH_R = 600
const HIGH_W = 0.1667
/** 起始相位：第 3～5.5 秒的艦島仰拍裡，四機剛好從艦島後面劃進右邊的天空。改了它那一刀要重看 */
const HIGH_T0 = -2.55
/**
 * 右轉盤旋的四機：#2 在外圈幾乎正橫，#3、#4 在內圈（右後）。
 * #2 只落後 4 m：從它的右肩看出去，長機與轉彎圓心（艦隊）才在同一側、上下疊著；
 * 落後多了長機會跑到艦隊的左邊，兩者在畫面上拉開到一個塞不下
 */
const highLead = orbit(HIGH_R, 380, HIGH_W, HIGH_T0, 0)
const HIGH_2 = orbit(HIGH_R + 16, 382, HIGH_W, HIGH_T0 - 4 / HIGH_R, 1.1)
const HIGH_3 = orbit(HIGH_R - 22, 377, HIGH_W, HIGH_T0 - 16 / HIGH_R, 2.3)
const HIGH_4 = orbit(HIGH_R - 38, 379, HIGH_W, HIGH_T0 - 30 / HIGH_R, 3.4)

const CAP_R = 1150
const CAP_W = -0.087
const CAP_T0 = 0.6
const CAP: readonly Path[] = [
  orbit(CAP_R, 250, CAP_W, CAP_T0, 0.4),
  orbit(CAP_R - 15, 253, CAP_W, CAP_T0 + 13 / CAP_R, 1.5),
  orbit(CAP_R + 24, 248, CAP_W, CAP_T0 + 18 / CAP_R, 2.6),
  orbit(CAP_R + 40, 251, CAP_W, CAP_T0 + 31 / CAP_R, 3.9),
]

// ── 俯衝通場的一對（P）：560 m 推桿俯衝，在航艦上空 70 m 左右拉平 ──
//
// 推桿的下沉加速度不能超過 1 g —— 「加速度 + 重力」一變號，`flightPose` 算出來的機體
// 上方就翻到下面，整架瞬間倒飛。
const PASS_SPEED = 130
const passLead: Path = (t, out) => {
  out.set(6, 560, 2600 - PASS_SPEED * t)
  out.y += rampedOffset(t, 7, 1.5, -8) - rampedOffset(t, 14.5, 1.5, -8)
    + rampedOffset(t, 17, 1.5, 15) - rampedOffset(t, 21, 1.5, 15)
    + rampedOffset(t, 23, 1.5, 6) - rampedOffset(t, 26.5, 1.5, 6)
  return out
}
const PASS_2 = wingman(passLead, 14, 3, 18, 0.9)

const L0 = 0
const H0 = 4
const H1 = 5
const P0 = 8
const P1 = 9

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: null,
    camera(t, out) {
      // 艦體外擴 8 m 是 x ±22，鏡頭在 30 才不算在船的上空。注視點就在艦艏前緣 ——
      // 再往艦艉放的話，近的艦艏投影到注視點左邊、被推進選單後面
      onShip(ESSEX, t, 30, 6.5, -178 + 4 * t, out.position)
      onShip(ESSEX, t, -2, 13, -122, out.target)
      out.fov = 44
      // 貼著海面的小艇感：慢晃，不搶艦艏的戲
      handheld(out, t, 0.25, 1.0)
    },
  },
  {
    from: 3, subject: H0,
    camera(t, out) {
      onShip(ESSEX, t, 34, 7, 22, out.position)
      onShip(ESSEX, t, 4, 52, -26, out.target)
      out.fov = 55
      handheld(out, t, 0.2, 2.0)
    },
  },
  {
    from: 5.5, subject: H0, mount: H0,
    camera(t, out) {
      // 左翼尖（命中盒到 x −6.58）回看座艙。右轉壓坡度時，轉彎圓心 —— 也就是艦隊 ——
      // 在機體的右上方，所以往機體右上看出去
      body(highLead, t, -7.4, 1.2, 1.6, false, out.position)
      body(highLead, t, 30, 12, -2, false, out.target)
      bodyUp(highLead, t, out.up)
      out.fov = 64
      // 掛在機身上：機身本來就不抖，只留一點氣流的感覺。再大的話 8 m 外的座艙就在晃
      handheld(out, t, 0.08, 3.0)
    },
  },
  {
    from: 8.5, subject: L0,
    camera(t, out) {
      // 釘在梯隊的正下方：長機在右上 25 m、#2 幾乎正頂上，9.4 秒掠過之後鏡頭轉身
      // 目送它們飛向航艦與太陽
      out.position.set(-58, 7, 250)
      // 跟不上：注視點晚 0.07 秒，掠過頭頂那一下長機往畫面左邊衝；9.35 秒掠過時抖一下。
      // 最近點只有 33 m，晚 0.12 秒長機就滑到選單邊上，晚 0.2 秒整架甩出畫面
      lowLead(t - 0.07, out.target)
      out.fov = 54
      handheld(out, t, 0.35, 4.0, PASS_OVER, 1.0)
    },
  },
  {
    from: 11, subject: L0,
    camera(t, out) {
      // 左舷艦艏的甲板邊緣外、略高於甲板面（18.3），沿左舷往艦艉看：艦島在畫面左邊，
      // 梯隊貼著左舷迎面衝來，長機在 13.4 秒從鏡頭旁 12 m 掠過 —— 切在那之前。
      // 架在右舷的話整座艦島擋在鏡頭與左舷的梯隊之間。注視點只有一半跟著長機
      onShip(ESSEX, t, -25, 23, -95, out.position)
      onShip(ESSEX, t, -28, 26, 60, S1)
      lowLead(t, S2)
      aimBetween(out.position, S1, S2, 0.5, out.target)
      out.fov = 50
      handheld(out, t, 0.3, 5.0)
    },
  },
  {
    from: 13, subject: null,
    camera(t, out) {
      // 釘在海上：驅逐艦第 16 秒艦艏經過鏡頭旁 20 m
      onShip(DD_SPRINT, 16, 20, 6.5, -60, out.position)
      onShip(DD_SPRINT, t, 0, 6, -40, out.target)
      out.fov = 46
      handheld(out, t, 0.3, 6.0)
    },
  },
  {
    from: 16.5, subject: P0, mount: P1,
    camera(t, out) {
      // 垂尾頂後方（垂尾命中盒到 y 2.19、z 7.22）
      body(PASS_2, t, 0, 2.9, 8.6, false, out.position)
      passLead(t, S1)
      shipAt(ESSEX, t, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      bodyUp(PASS_2, t, out.up)
      out.fov = 50
      handheld(out, t, 0.1, 7.0)
    },
  },
  {
    from: 19.5, subject: P0,
    camera(t, out) {
      onShip(ESSEX, t, 40, 8, -200, out.position)
      // 跟不上：拉平往鏡頭衝的那一段，注視點晚 0.15 秒
      passLead(t - 0.15, out.target)
      out.fov = 50
      handheld(out, t, 0.35, 8.0)
    },
  },
  {
    from: 22, subject: H0, mount: H1,
    camera(t, out) {
      // 右肩後：機身命中盒 |x| 0.76、頂 1.42，再外擴 0.5
      body(HIGH_2, t, 1.3, 2.1, 3.0, false, out.position)
      highLead(t, S1)
      shipAt(ESSEX, t, S2)
      aimBetween(out.position, S1, S2, 0.5, out.target)
      bodyUp(HIGH_2, t, out.up)
      out.fov = 56
      handheld(out, t, 0.1, 9.0)
    },
  },
  {
    from: 25, subject: L0,
    camera(t, out) {
      // 梯隊延長線稍後方：四架由近到遠斜斜疊成一串。架在側面的話梯隊橫著攤開，
      // 最左邊那兩架會落到選單後面；正好壓在延長線上的話前一架整個擋住後一架
      body(lowLead, t, -60, 13, 66, true, out.position)
      body(lowLead, t, -26, 0, 20, true, out.target)
      out.fov = 40
      // 跟拍機的機上晃動
      handheld(out, t, 0.25, 10.0)
    },
  },
  {
    from: 28, subject: null,
    camera(t, out) {
      onShip(ESSEX, t, -260, 140, 620, out.position)
      onShip(ESSEX, t, 60, 30, -520, out.target)
      out.fov = 40
      // 收尾的大遠景要穩
      handheld(out, t, 0.08, 11.0)
    },
  },
]

const PLANES: readonly ReelPlane[] = [
  { spec: F6F5, path: lowLead },
  { spec: F6F5, path: LOW_2 },
  { spec: F6F5, path: LOW_3, extra: true },
  { spec: F6F5, path: LOW_4, extra: true },
  { spec: F6F5, path: highLead },
  { spec: F6F5, path: HIGH_2 },
  { spec: F6F5, path: HIGH_3, extra: true },
  { spec: F6F5, path: HIGH_4, extra: true },
  { spec: F6F5, path: passLead },
  { spec: F6F5, path: PASS_2 },
  ...CAP.map((path) => ({ spec: F4F4, path, extra: true })),
]

export const FLEET: Shot = {
  id: 'fleet',
  duration: 32,
  // 鏡頭在 390 m 以下、飛機在 570 m 以下，雲整層放在 800 m 以上，頭頂也撒
  clouds: scatterClouds({ x: 0, z: -600, inner: 0, outer: 6500, yMin: 800, yMax: 1500, rMin: 60, rMax: 140, count: 60, seed: 4 }),
  timeOfDay: 'dawn',
  faceSun: true,
  clear: { x: 0, z: -100, radius: 3000 },
  planes: PLANES,
  ships: [
    ESSEX,
    DD_SPRINT,
    { cls: 'wichita', x: -400, z: 120, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: 380, z: 260, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: -300, z: -700, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: 140, z: 820, heading: 0, speed: FLEET_SPEED },
    { cls: 'wichita', x: 420, z: -480, heading: 0, speed: FLEET_SPEED },
  ],
  cuts: CUTS,
  camera: edit(CUTS),
  events: [],
}