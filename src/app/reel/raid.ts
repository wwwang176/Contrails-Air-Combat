import { Vector3 } from 'three'
import { HE111 } from '../../specs/he111'
import { F4F4 } from '../../specs/f4f4'
import {
  BOMB_RELEASE_Y, barrage, body, bodyUp, bombAt, edit, rampedOffset, timeline, velocityAt, wingman,
  type Cut, type Path, type ReelCamera, type ReelPlane, type ReelProp, type ReelShip, type Shot,
} from './kit'

// ── 雷雨空襲 ───────────────────────────────────────────────
//
// 暴雨，九架 He 111 分三個三機編隊，從東南的海上往北飛，越過泊地的船、把炸彈
// 落在泊地與岸邊平地上的小機場、油庫，再右轉爬升離開。英軍的 Martlet 從正後方咬住右僚機，
// 打著它的右發動機；另一架從正前方對衝第二個編隊。局部原點是群島最大那座島的島心
// （`site: 'island'`）。
//
// 地形（局部座標）：主峰 425 m 在原點；東南岸 x 600…1050、z 700…900 是一片
// 0～40 m 的緩坡平地，海岸線從 (600, 1000) 斜到 (1050, 800)，再往南是開闊的泊地。
// 東北的小山頂 205 m 在 (1150, 320)。山坡上全是 30 m 高的針葉樹，貼地的鏡頭只能
// 架在沙灘上，或高過樹梢。
//
// 刀表：
//   0–2.6     雨幕剪影：長機左前下方仰看，長機與右僚機上下疊著、第三編隊在遠處
//   2.6–5.0   長機座艙頂上往前下看（投彈手的視線）：整片玻璃機鼻在下緣，島與泊地的船
//             在前方，船上的防空曳光往上竄
//   5.0–7.4   Martlet 肩後：從正後方略低處咬住右僚機、5.2 秒開火，右僚機的機槍手回擊；
//             6.3 秒右發起火，6.4 秒往右下脫離
//   7.4–9.8   右僚機右翼尖前上方回看：右發動機冒火拖煙
//   9.8–12.2  長機機腹下：10 秒起炸彈一枚枚從彈艙掉出來
//   12.2–15.0 跟著長機第四枚炸彈往下掉：鏡頭在炸彈下方往上看，整串炸彈與長機襯著天
//   15.0–17.0 第二編隊長機的上方砲塔往前看：Martlet 從左前上方俯衝對頭開火，
//             17.05 秒擦過頭頂
//   17.0–19.6 泊地西岸的沙灘：炸彈串落在並排停著的巡洋艦與驅逐艦身上，水柱與火光壓著
//             船身一根根掀起，鏡頭跟著震
//   19.6–22.2 山坡樹梢上仰拍：編隊從頭上飛過，起火的右僚機拖著煙
//   22.2–24.8 第二編隊長機的機腹吊艙往後下看：自己炸過的停機線在下面燒，第三編隊的
//             炸彈串走過油槽與彈藥堆，炸開起火
//   24.8–27.4 長機背上的機槍位往後看：自己的垂尾、後面兩個編隊、岸邊的機場在燒
//   27.4–30   第一個三機左後下方：剪影越飛越遠，往東北爬升離開

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

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

/**
 * 手持／機上的慢晃：注視點繞著鏡頭偏一個小角度，頻率 0.3～1.1 Hz 互質的正弦疊起來。
 * 鏡頭指向的晃動 RMS 約 0.7 × `deg` 度。偏的是角度不是公尺 —— 注視點在 5 m 與 300 m
 * 的刀，同一個 `deg` 晃得一樣多。快過 1.5 Hz 的話讀起來是抖，不是手持
 */
function shake(t: number, deg: number, seed: number, out: ReelCamera): void {
  const d = out.target.distanceTo(out.position) * deg * (Math.PI / 180)
  out.target.x += d * (0.6 * Math.sin(2.1 * t + seed) + 0.4 * Math.sin(4.9 * t + 2.1 * seed))
  out.target.y += d * (0.6 * Math.sin(2.9 * t + 1.3 * seed) + 0.4 * Math.sin(6.7 * t + seed))
  out.target.z += d * (0.5 * Math.sin(2.5 * t + 0.7 * seed) + 0.5 * Math.sin(4.3 * t + 1.9 * seed))
}

/** 炸彈串、機槍連射裡一下一下的間隔，秒 —— 與 `BOMB_INTERVAL` 同一個節拍 */
const KICK_INTERVAL = 0.22
/**
 * 衝擊的快抖（4 Hz 上下）：`from`～`to` 秒每隔 `KICK_INTERVAL` 踢一下，每一下 0.18 秒
 * 衰減掉，`to` 之後收掉。峰值約 `deg` 度。只用在炸彈落地、連射的那幾秒 —— 平時有它
 * 的話畫面一直在抖
 */
function jolt(t: number, deg: number, from: number, to: number, out: ReelCamera): void {
  if (t < from) return
  const last = t < to ? from + Math.floor((t - from) / KICK_INTERVAL) * KICK_INTERVAL : to
  const d = out.target.distanceTo(out.position) * deg * (Math.PI / 180) * Math.exp(-(t - last) / 0.18)
  out.target.x += d * Math.sin(23 * t)
  out.target.y += d * Math.sin(29 * t + 1.3)
  out.target.z += d * Math.sin(26 * t + 2.6)
}

const SPEED = 85
/** 雲底下的進場高度。主峰 425 m 在航線西邊 950 m，航線底下最高的是東北小山的山腰 */
const ALT = 270
const TRACK_X = 950
const Z0 = 2400
/** 投完彈、往右轉出去的時刻 */
const TURN_AT = 19.5

const lead: Path = (t, out) => {
  out.set(TRACK_X, ALT, Z0 - SPEED * t)
  out.x += rampedOffset(t, TURN_AT, 2.5, 5)
  out.z += rampedOffset(t, TURN_AT, 2.5, 1.5)
  out.y += rampedOffset(t, TURN_AT - 1, 2, 1.2) - rampedOffset(t, TURN_AT + 5, 2, 1.2)
  return out
}

/** 第一個三機：長機、左僚機、右僚機（右發動機中彈起火的那一架） */
const LEFT = wingman(lead, -34, 3, 28, 0.7)
const FIRE_AT = 6.3
const rightBase = wingman(lead, 34, -3, 28, 1.9)
/** 起火之後慢慢掉隊、往下沉 */
const crippled: Path = (t, out) => {
  rightBase(t, out)
  out.z += rampedOffset(t, FIRE_AT + 0.5, 3, 0.5)
  out.y -= rampedOffset(t, FIRE_AT + 1, 3, 0.25) - rampedOffset(t, FIRE_AT + 9, 3, 0.25)
  return out
}
const CRIPPLED = 2

/** 第二個三機：左後上方 */
const lead2 = wingman(lead, -64, 18, 120, 2.4)
const L2_LEFT = wingman(lead, -98, 21, 148, 3.1)
const L2_RIGHT = wingman(lead, -30, 15, 150, 0.2)
const LEAD2 = 3
/** 第三個三機：右後方更遠，背景 */
const lead3 = wingman(lead, 92, 30, 210, 1.3)
const L3_LEFT = wingman(lead, 60, 33, 238, 4.4)
const L3_RIGHT = wingman(lead, 126, 28, 236, 5.2)

/**
 * 從正後方略低處咬住右僚機的 Martlet（相對右僚機的位移）：沿一條固定的視線每秒
 * 拉近 30 m，`BREAK_AT` 往右下壓坡度脫離，接近率同時收掉 —— 不收的話它在 8 秒
 * 從右僚機旁不到 20 m 擦過。
 *
 * 【視線要幾乎貼著機尾方向】曳光沿機首直直打出去，機首沿速度：編隊的 85 m/s 加上
 * 接近的 30 m/s。機首那條線離目標中心是「距離 × 視線斜率 × 85/115」，開火時距離
 * 近 90 m，斜率 0.034 才落在 1.4 m；斜率翻倍的話超過目標翼展的六分之一，曳光從
 * 機身旁邊擦過去
 */
const ATTACK_T0 = 3.5
const BREAK_AT = 6.4
const LOS_X = 0.015
const LOS_Y = -0.03
const martlet: Path = (t, out) => {
  crippled(t, out)
  const s = 140 - 30 * (t - ATTACK_T0)
  out.x += LOS_X * s + rampedOffset(t, BREAK_AT, 0.8, 24) - rampedOffset(t, BREAK_AT + 2.2, 0.8, 24)
  out.y += LOS_Y * s - rampedOffset(t, BREAK_AT, 0.8, 6) + rampedOffset(t, BREAK_AT + 2.2, 0.8, 6)
    + rampedOffset(t, BREAK_AT + 3.5, 1.5, 6) - rampedOffset(t, BREAK_AT + 5.8, 1.5, 6)
  out.z += s + rampedOffset(t, BREAK_AT, 0.8, 13) - rampedOffset(t, BREAK_AT + 3, 0.8, 13)
  return out
}
const MARTLET = 9
/** Martlet 連射的起訖秒數：肩後那一刀的快抖跟著它 */
const MARTLET_FIRE = 5.2
const MARTLET_FIRE_LEN = 1.1

/**
 * 從左前上方俯衝對頭攻擊第二個編隊的 Martlet：第 `PASS_AT` 秒穿過第二編隊長機所在的
 * 橫切面，在它左上方 (−14, 16)。最後 2.6 秒是一條直線，之前往東彎過來（反向的
 * `rampedOffset`：越早偏得越多），穿過去之後拉平。
 *
 * 【直線的斜率是瞄出來的】曳光沿機首直直打出去。橫移 (13.4, −15.3) m/s 讓機首那條線
 * 在穿越前 1.6 秒（`HEAD_AIM_AT`，約 345 m）正好穿過長機中心；之後每秒偏開約 13 m
 * （長機自己往前飛 85 m/s，機首的線是斜的），所以只能在那一刻前後各 0.2 秒開火 ——
 * 再長就超過翼展的六分之一，曳光從翼尖外飛過。越晚瞄準，橫移要越大、偏得越快
 * 【往前延伸要彎】直線往回推 17 秒是 3.6 km 外，出了動作圓
 */
const PASS_AT = 17.05
const HEAD_SPEED = 130
const HEAD_AIM_AT = PASS_AT - 1.6
const HEAD_VX = 13.4
const HEAD_VY = -15.3
/** 直線段從穿越前幾秒開始 */
const HEAD_LINE = 2.6
const headOn: Path = (t, out) => {
  const tau = t - PASS_AT
  lead2(PASS_AT, out)
  out.x += -14 + HEAD_VX * tau + rampedOffset(-t, HEAD_LINE - PASS_AT, 1.5, 8)
  out.y += 16 + HEAD_VY * tau
    + rampedOffset(t, PASS_AT + 0.3, 1.5, 4.5) - rampedOffset(t, PASS_AT + 3.8, 1.5, 4.5)
  out.z += HEAD_SPEED * tau
  return out
}
const HEAD_ON = 10

const BOMB_AT = 10.0
const BOMB_INTERVAL = 0.22
/**
 * 跟拍的那一枚：長機第四枚。投下那一刻的機腹點與速度在載入時算一次 ——
 * 與放映機 `releasePose` 同一套（`flightPose` 的中央差分），鏡頭才貼得住那一枚
 */
const FOLLOW_AT = BOMB_AT + 3 * BOMB_INTERVAL
const FOLLOW_P = body(lead, FOLLOW_AT, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const FOLLOW_V = velocityAt(lead, FOLLOW_AT, new Vector3())

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 架在長機與右僚機連線的延長線上：兩架在畫面上疊成一串。架在右前方的話
      // 右僚機落到畫面左半、躲進選單後面
      body(lead, t, -30, -24, -34 + 4 * t, true, out.position)
      body(lead, t, 14, -2, 18, true, out.target)
      out.fov = 48
      shake(t, 0.42, 1, out)
    },
  },
  {
    from: 2.6, subject: null, mount: 0,
    camera(t, out) {
      // 座艙頂上（座艙命中盒頂 1.60、再外擴 0.5）往前下看：整片玻璃機鼻在畫面下緣
      body(lead, t, 0, 2.3, -0.6, false, out.position)
      body(lead, t, 0, -80, -400, false, out.target)
      bodyUp(lead, t, out.up)
      out.fov = 64
      shake(t, 0.14, 2, out)
    },
  },
  {
    from: 5.0, subject: CRIPPLED, mount: MARTLET,
    camera(t, out) {
      // 右肩後（座艙命中盒頂 1.20、機身 |x| 0.73，各外擴 0.5）
      body(martlet, t, 0.9, 1.9, 2.8, false, out.position)
      crippled(t, S1)
      body(martlet, t, 0, 0, -200, false, S2)
      aimBetween(out.position, S1, S2, 0.35, out.target)
      bodyUp(martlet, t, out.up)
      out.fov = 50
      shake(t, 0.35, 3, out)
      // 連射時機身的震動：慢晃之外再疊一層小的快抖
      jolt(t, 0.3, MARTLET_FIRE, MARTLET_FIRE + MARTLET_FIRE_LEN, out)
    },
  },
  {
    from: 7.4, subject: CRIPPLED, mount: CRIPPLED,
    camera(t, out) {
      // 右翼外段（命中盒到 x 11.36、前緣 z −0.34）的前上方往內回看右發動機
      body(crippled, t, 9.5, 2.0, -4.0, false, out.position)
      body(crippled, t, 1.5, 0, 3, false, out.target)
      bodyUp(crippled, t, out.up)
      out.fov = 48
      shake(t, 0.14, 4, out)
    },
  },
  {
    from: 9.8, subject: 0, mount: 0,
    camera(t, out) {
      // 機腹右後下方往前上看彈艙：炸彈從機腹掉出來、從鏡頭前落下去
      body(lead, t, 2.6, -4.2, 5.5, false, out.position)
      body(lead, t, 0, -2.2, -1.5, false, out.target)
      bodyUp(lead, t, out.up)
      out.fov = 60
      shake(t, 0.14, 5, out)
    },
  },
  {
    from: 12.2, subject: null,
    camera(t, out) {
      // 跟著那一枚往下掉：鏡頭在它右前下方 20 m，往上看炸彈與後面的長機 —— 炸彈與飛機
      // 襯著天。往下看的話深色的彈體疊在深色的海上，看不見
      bombAt(FOLLOW_P, FOLLOW_V, t - FOLLOW_AT, S1)
      out.position.set(S1.x + 8, S1.y - 20, S1.z - 10)
      lead(t, S2)
      aimBetween(out.position, S1, S2, 0.45, out.target)
      out.fov = 58
      shake(t, 0.35, 6, out)
    },
  },
  {
    from: 15.0, subject: HEAD_ON, mount: LEAD2,
    camera(t, out) {
      // 上方砲塔的位置（機身命中盒頂 1.50、背上補漏盒頂 1.68）
      body(lead2, t, 0, 2.5, 3.0, false, out.position)
      headOn(t, S1)
      body(lead2, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      bodyUp(lead2, t, out.up)
      out.fov = 40
      shake(t, 0.17, 7, out)
    },
  },
  {
    from: 17.0, subject: null,
    camera(t, out) {
      // 泊地西岸的沙灘（沙灘上沒有樹）往東看：長機三機的炸彈串落在 200 m 外並排的
      // 巡洋艦與驅逐艦身上。整串落地的 1.6 秒裡跟著震
      out.position.set(750, 12, 945)
      out.target.set(1000, 30, 990)
      out.fov = 52
      shake(t, 0.3, 8, out)
      // 長機三機的炸彈 17.8～19.4 秒落地（200 m 外的水柱：一下 0.9°）
      jolt(t, 0.9, 17.8, 19.4, out)
    },
  },
  {
    from: 19.6, subject: 0,
    camera(t, out) {
      // 山腰高過樹梢 10 m：注視點跟不上長機 0.25 秒，偏向背後挨炸的停機線
      out.position.set(950, 168, 450)
      lead(t - 0.25, S1)
      S2.set(900, 20, 790)
      aimBetween(out.position, S1, S2, 0.25, out.target)
      out.fov = 62
      shake(t, 0.42, 9, out)
    },
  },
  {
    from: 22.2, subject: null, mount: LEAD2,
    camera(t, out) {
      // 第二編隊長機的機腹吊艙後方（機身命中盒底 −1.25、吊艙補漏盒底 −1.31，再外擴 0.5）
      // 往後下看：自己剛炸過、正在燒的停機線在正下方，第三編隊的炸彈串 22.3～23.8 秒
      // 走過右後方的油槽與彈藥堆。注視點釘在地上，鏡頭跟著飛機慢慢轉過去
      body(lead2, t, 0, -2.3, 5.0, false, out.position)
      out.target.set(960, 15, 790)
      bodyUp(lead2, t, out.up)
      out.fov = 56
      shake(t, 0.14, 10, out)
    },
  },
  {
    from: 24.8, subject: LEAD2, mount: 0,
    camera(t, out) {
      // 背上機槍位（機身命中盒頂 1.50）往後看
      body(lead, t, 0, 2.4, 5.0, false, out.position)
      body(lead, t, 0, -30, 200, false, out.target)
      bodyUp(lead, t, out.up)
      out.fov = 58
      shake(t, 0.14, 11, out)
    },
  },
  {
    from: 27.4, subject: 0,
    camera(t, out) {
      // 左後下方、慢慢落後：三機的腹面剪影襯著雨幕
      body(lead, t, -10, -22, 85 + 6 * (t - 27.4), true, out.position)
      body(lead, t, -8, 0, 10, true, out.target)
      out.fov = 44
      shake(t, 0.17, 12, out)
    },
  },
]

/**
 * 泊地的船：停著。巡洋艦與驅逐艦艦艏朝北並排，船身順著第一編隊的航線 —— 長機那一串
 * （x 950）落在巡洋艦左舷那半邊、左僚機那一串（x 914）落在驅逐艦中線上，右僚機那一串
 * （x 986）貼著巡洋艦右舷 9 m 落下。船挪開十幾公尺，炸彈就全落在水裡
 */
const SHIPS: readonly ReelShip[] = [
  { cls: 'wichita', x: 958, z: 1000, heading: 0, speed: 0 },
  { cls: 'fletcher', x: 914, z: 1005, heading: 0, speed: 0 },
  { cls: 'fletcher', x: 1260, z: 930, heading: -1.15, speed: 0 },
]

/**
 * 岸邊平地上的小機場與油庫。第二編隊的三串（x 853、888、920，z 860→745，20.8～22.2 秒）
 * 落在停機線與油桶堆上，第三編隊（x 1007、1045、1074，22.3～23.8 秒）落在油槽與
 * 彈藥堆上 —— 炸彈落在命中盒外擴 15 m 內才會炸毀，挪開幾十公尺就只剩彈坑。
 * 停機線西端兩架、高砲與探照燈在炸彈串外面，炸完還在
 */
const PROPS: readonly ReelProp[] = [
  { id: 'parkedP51', x: 860, z: 790, heading: Math.PI },
  { id: 'parkedP51', x: 885, z: 796, heading: Math.PI },
  { id: 'parkedP51', x: 910, z: 802, heading: Math.PI },
  { id: 'parkedP51', x: 835, z: 784, heading: Math.PI },
  { id: 'parkedP51', x: 810, z: 778, heading: Math.PI },
  { id: 'fuelDump', x: 890, z: 765, heading: 0.3 },
  { id: 'oilTank', x: 1000, z: 795, heading: 0 },
  { id: 'bombDump', x: 1030, z: 765, heading: -0.4 },
  { id: 'truck', x: 1060, z: 745, heading: 1.2 },
  { id: 'flakHeavy', x: 800, z: 830, heading: 0 },
  { id: 'flakLight', x: 850, z: 870, heading: 0 },
  { id: 'searchlight', x: 960, z: 820, heading: 0 },
]

const PLANES: readonly ReelPlane[] = [
  { spec: HE111, path: lead },
  { spec: HE111, path: LEFT },
  { spec: HE111, path: crippled },
  { spec: HE111, path: lead2 },
  { spec: HE111, path: L2_LEFT },
  { spec: HE111, path: L2_RIGHT, extra: true },
  { spec: HE111, path: lead3, extra: true },
  { spec: HE111, path: L3_LEFT, extra: true },
  { spec: HE111, path: L3_RIGHT, extra: true },
  { spec: F4F4, path: martlet },
  { spec: F4F4, path: headOn },
]

export const RAID: Shot = {
  id: 'raid',
  duration: 30,
  timeOfDay: 'storm',
  faceSun: false,
  site: 'island',
  clear: { x: 900, z: 900, radius: 2800 },
  planes: PLANES,
  ships: SHIPS,
  props: PROPS,
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(301, 0, 24, 1.4, (t, out) => lead(t, out).add(S3.set(0, 20, 80)),
      { x: 220, yLo: -70, yHi: 110, z: 260 }, edit(CUTS), 60),
    // 船上的防空：從進場一路打到編隊飛過頭頂
    { at: 1.0, kind: 'aa', ship: 0, actor: 0, seconds: 6, miss: 30 },
    { at: 2.0, kind: 'aa', ship: 1, actor: 1, seconds: 6, miss: 30 },
    { at: 3.0, kind: 'aa', ship: 2, actor: CRIPPLED, seconds: 6, miss: 30 },
    { at: 8.0, kind: 'aa', ship: 0, actor: LEAD2, seconds: 8, miss: 25 },
    { at: 9.0, kind: 'aa', ship: 1, actor: 0, seconds: 8, miss: 25 },
    { at: 10.0, kind: 'aa', ship: 2, actor: 6, seconds: 8, miss: 30 },
    // Martlet 咬住右僚機
    { at: 4.2, kind: 'gunner', actor: CRIPPLED, target: MARTLET, seconds: 3.0, miss: 10 },
    { at: 4.6, kind: 'gunner', actor: 0, target: MARTLET, seconds: 2.0, miss: 16 },
    { at: MARTLET_FIRE, kind: 'burst', actor: MARTLET, seconds: MARTLET_FIRE_LEN, target: CRIPPLED },
    // 第 1 具是右發
    { at: FIRE_AT, kind: 'smoke', actor: CRIPPLED, engine: 1, fire: true },
    { at: 7.6, kind: 'gunner', actor: CRIPPLED, target: MARTLET, seconds: 1.6, miss: 14 },
    // 對衝第二編隊
    { at: 15.0, kind: 'gunner', actor: LEAD2, target: HEAD_ON, seconds: 2.0, miss: 12 },
    { at: 15.2, kind: 'gunner', actor: 4, target: HEAD_ON, seconds: 1.8, miss: 14 },
    { at: 15.4, kind: 'gunner', actor: 5, target: HEAD_ON, seconds: 1.6, miss: 16 },
    { at: HEAD_AIM_AT - 0.2, kind: 'burst', actor: HEAD_ON, seconds: 0.4, target: LEAD2 },
    // 船中彈：放映機的炸彈只認地形，落在船身上也是在水面炸一根水柱，船本身不會起火。
    // 在甲板高度、照長機與左僚機那兩串直接命中的秒數與落點各放一朵黑雲當中彈的火光，
    // 之後每隔一兩秒再冒一朵當甲板上的火與黑煙。落點是 `bombAt` 算的，改了投彈秒數、
    // 航線或船的位置要重算
    { at: 17.85, kind: 'flak', x: 950, y: 10, z: 978 },
    { at: 18.0, kind: 'flak', x: 914, y: 7, z: 994 },
    { at: 18.25, kind: 'flak', x: 950, y: 10, z: 941 },
    { at: 18.45, kind: 'flak', x: 914, y: 7, z: 956 },
    ...[19.2, 20.3, 21.5, 22.8, 24.1, 25.6, 27.2].map((at, k) => (
      { at, kind: 'flak' as const, x: 955 + (k % 2) * 4, y: 14, z: 960 - (k % 3) * 18 })),
    ...[19.6, 20.9, 22.3, 23.6, 25.0, 26.6, 28.3].map((at, k) => (
      { at, kind: 'flak' as const, x: 915, y: 10, z: 985 - (k % 2) * 25 })),
    // 油槽與彈藥堆：第三編隊是配角，觸控裝置上不出場、不投彈，這兩處就炸不到。
    // 桌機上 22.6～22.9 秒已經被炸彈炸毀，這兩筆在那之後才到，炸毀過的不會再炸一次
    { at: 23.0, kind: 'destroy', prop: 6 },
    { at: 23.1, kind: 'destroy', prop: 7 },
    // 投彈：長機與左僚機的炸彈串直接落在巡洋艦與驅逐艦身上（各三、四枚），右僚機那一串
    // 貼著巡洋艦右舷落下；第二、三編隊落在岸邊的機場與油庫
    { at: BOMB_AT, kind: 'bomb', actor: 0, count: 8, interval: BOMB_INTERVAL },
    { at: 10.05, kind: 'bomb', actor: 1, count: 8, interval: BOMB_INTERVAL },
    { at: 10.15, kind: 'bomb', actor: CRIPPLED, count: 8, interval: BOMB_INTERVAL },
    { at: 13.0, kind: 'bomb', actor: LEAD2, count: 8, interval: BOMB_INTERVAL },
    { at: 13.1, kind: 'bomb', actor: 4, count: 8, interval: BOMB_INTERVAL },
    { at: 13.05, kind: 'bomb', actor: 5, count: 8, interval: BOMB_INTERVAL },
    { at: 14.2, kind: 'bomb', actor: 6, count: 8, interval: BOMB_INTERVAL },
    { at: 14.3, kind: 'bomb', actor: 7, count: 8, interval: BOMB_INTERVAL },
    { at: 14.25, kind: 'bomb', actor: 8, count: 8, interval: BOMB_INTERVAL },
  ]),
}
