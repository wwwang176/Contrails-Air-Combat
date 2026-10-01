import { Vector3 } from 'three'
import type { AircraftSpec } from '../../specs/types'
import { KI84 } from '../../specs/ki84'
import { body, bodyUp, edit, timeline, wingman, type Cut, type Path, type Shot } from './kit'

// ── 歸航 ───────────────────────────────────────────────────
//
// 黃昏，戰鬥結束。四架貼著海面 30 m 往夕陽飛，隊形鬆散：長機左後方那一架（#1）
// 發動機拖著煙、翼晃著勉強跟上，外側的僚機（#2）在 8～14 秒滑過去貼著它。
// 右前方遠處另一個小隊；開場時右前方有一架燒著落海，煙柱留在海面上；
// 後方一架落隊的拖著煙，21.6 秒沒撐住落海。
//   0–3.5     大遠景：編隊後下方逆光，夕陽、拖煙、遠處燒著落海的那一架
//   3.5–6.5   長機座艙罩右前方特寫，受傷那一架拖著煙在後面
//   6.5–9.5   受傷那一架的左後下方：煙襯著天空拖過來，機身在晃
//   9.5–13    僚機右翼後緣順著翼展看出去：受傷那一架在翼尖外越靠越近
//   13–16.5   貼海面 7 m 的固定機位：機群從頭頂掠過，鏡頭轉身目送進夕陽
//   16.5–19.5 長機右翼後緣上方往前：機首、螺旋槳盤逆著夕陽
//   19.5–23   受傷那一架與僚機的正前下方仰拍：後面落隊的那一架拖著煙落海
//   23–26     長機飛行員的左肩回頭看受傷那一架，自己的垂尾在前景
//   26–29     受傷那一架的座艙罩後方看出去：長機在夕陽裡，地平線晃
//   29–33     鏡頭停在海面上往後退：機群變成夕陽裡的小點
//
// 【受傷那一架與僚機排在長機左側】回頭看的鏡頭裡它們落在畫面右半；
// 排在右側的話會滑到左邊的選單後面

const S1 = new Vector3()
const S2 = new Vector3()

const HOME_SPEED = 105
const HOME_ALT = 30
const START_Z = 1750

/** 0→1 的平順過渡，兩端的一、二階導數都是 0 —— 路徑拿它移位時坡度不會一步跳上去 */
function ease(t: number, t0: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - t0) / d))
  return u * u * u * (u * (u * 6 - 15) + 10)
}

const homeLead: Path = (t, out) => out.set(
  5 * Math.sin(0.13 * t + 0.4),
  HOME_ALT + 1.5 * Math.sin(0.6 * t),
  START_Z - HOME_SPEED * t,
)

/** 受傷那一架：左後下方，翼晃（約 ±10° 坡度）、一點一點往後掉 */
const wounded: Path = (t, out) => {
  homeLead(t, out)
  out.x += -24 + 1.3 * Math.sin(0.9 * t) + 0.35 * Math.sin(1.7 * t + 0.5)
  out.y += -8 + 1.8 * Math.sin(0.45 * t + 1)
  out.z += 34 + 0.5 * t
  return out
}

/**
 * 護著它的僚機：8～14 秒從外側 56 m 滑到它左後方、同一個高度。
 * 【橫向最近仍隔 13 m】受傷那一架左右晃 ±1.7 m，兩架太近的話晃到一起會穿模
 */
const escort: Path = (t, out) => {
  homeLead(t, out)
  const k = ease(t, 8, 6)
  out.x += -56 + 16 * k + 1.0 * Math.sin(0.4 * t + 2)
  out.y += -6 - 2 * k + 1.2 * Math.sin(0.5 * t + 1)
  out.z += 30 + 0.5 * t + 12 * k
  return out
}

/** 後方落隊的那一架：拖著煙慢慢往下沉，21.6 秒落海 */
const STRAGGLER_DOWN = 21.6
const straggler: Path = (t, out) => {
  homeLead(t, out)
  // 【在長機右後方】19.5 秒那一刀從前方回看受傷那一架，這一架要落在它旁邊
  // 的空處；排在它正後方的話整架被它擋住
  out.x += 40 + 3 * Math.sin(0.7 * t)
  out.y += 26 - 34 * ease(t, 3, 19)
  out.z += 480 + 4 * t
  return out
}

/** 開場右前方那一架：0.4 秒交給殘骸池，燒著斜斜落海，煙柱留在海面上 */
const BURNING_DOWN = 0.4
const burning: Path = (t, out) => out.set(300, 200 - 25 * t, 560 - 100 * t)

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 編隊後下方往前看：四架與夕陽同框，右前方燒著落海的那一架也在畫面裡。
      // 鏡頭比編隊低 12 m —— 平視的話四架疊在地平線上，剪影分不開
      body(homeLead, t, 8, -12, 230 - 10 * t, true, out.position)
      // 注視點比編隊高：近處海面上夕陽的反光一片片很粗，留在畫面下緣之外
      body(homeLead, t, -14, 6, -150, true, out.target)
      out.fov = 38
    },
  },
  {
    from: 3.5, subject: 0, mount: 0,
    camera(t, out) {
      // 右前方回看座艙罩：夕陽從正前方打在玻璃與機身上。架在後方往前看的話
      // 夕陽在畫面右緣之外（主角右推之後），整架只剩背光的黑影
      body(homeLead, t, 2.6, 1.5, -2.2, false, out.position)
      body(homeLead, t, -0.8, 1.0, 1.2, false, out.target)
      bodyUp(homeLead, t, out.up)
      out.fov = 42
    },
  },
  {
    from: 6.5, subject: 1, mount: 1,
    camera(t, out) {
      // 左後下方往前：煙從機身裡的引擎點冒出來、過了機尾才露出來，在畫面右側
      // 朝鏡頭拖過來。架在整流罩旁往後看的話整條煙藏在機身後面；鏡頭與它
      // 平視的話灰煙疊在暗海上看不出來。
      // 鏡頭只跟航向不跟滾轉 —— 地平線不動，才看得出是這一架自己在晃
      body(wounded, t, -6, -2.2, 16, true, out.position)
      body(wounded, t, 0, 0.8, 1, true, out.target)
      out.fov = 42
    },
  },
  {
    from: 9.5, subject: 1, mount: 2,
    camera(t, out) {
      // 僚機右翼後緣上方順著翼展看出去：受傷那一架在翼尖外越靠越近，
      // 它的煙往畫面右邊拖；僚機壓坡度時地平線跟著歪。
      // 【鏡頭要跟著滾轉】只離翼面 0.8 m，只跟航向的話僚機一壓坡度鏡頭就進翼裡
      // 注視點在它後上方一點：畫面右側留給那條煙，地平線不壓到畫面頂
      body(escort, t, 2.5, 0.9, 3.4, false, out.position)
      wounded(t, out.target)
      out.target.y += 2.5
      out.target.z += 5
      bodyUp(escort, t, out.up)
      out.fov = 46
    },
  },
  {
    from: 13, subject: 0,
    camera(t, out) {
      // 長機 15 秒從頭頂上 23 m 掠過。架在它航線右邊 8 m —— 正下方的話鏡頭
      // 會仰到正上方，lookAt 的上方退化，畫面打轉
      homeLead(15, S1)
      out.position.set(S1.x + 8, 7, S1.z)
      homeLead(t, S2)
      out.target.set(S2.x, S2.y - 2, S2.z - 10)
      out.fov = 58
    },
  },
  {
    // 拍的是長機自己的螺旋槳：機身中心在鏡頭後方，沒有「哪一架在畫面裡」可查
    from: 16.5, subject: null, mount: 0,
    camera(t, out) {
      // 右翼後緣上方往前：機首與槳盤在左前方六公尺，夕陽在右前方。
      // 槳盤與夕陽在畫面上要擠在選單右邊那六成裡 —— 鏡頭再往前架，兩者的
      // 夾角就撐到四十幾度，機首掉進選單後面；貼著整流罩架的話整流罩佔掉半個畫面
      body(homeLead, t, 2.2, 1.2, 3.0, false, out.position)
      body(homeLead, t, 0.8, 0.3, -7, false, out.target)
      bodyUp(homeLead, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 19.5, subject: 1,
    camera(t, out) {
      // 跟著長機走、不跟受傷那一架 —— 它在晃，鏡頭跟著晃就分不出是誰在晃
      // 鏡頭在它們下方 10 m 仰拍：兩架襯在天空上。平視的話後方的島剛好在
      // 它們背後，剪影融進島裡
      body(homeLead, t, -20, -20, -18, true, out.position)
      wounded(t, S1)
      escort(t, S2)
      out.target.copy(S1).lerp(S2, 0.3)
      out.fov = 32
    },
  },
  {
    from: 23, subject: 1, mount: 0,
    camera(t, out) {
      body(homeLead, t, -0.95, 1.5, 1.6, false, out.position)
      wounded(t, out.target)
      out.target.y += 4
      bodyUp(homeLead, t, out.up)
      out.fov = 42
    },
  },
  {
    from: 26, subject: 0, mount: 1,
    camera(t, out) {
      // 座艙罩正後方上一點：自己的座艙罩與機首壓在畫面下方，長機在右前方。
      // 【z 3.6】再往後就進零戰垂尾的命中盒（前緣 4.36 m）
      body(wounded, t, 0.5, 1.9, 3.6, false, out.position)
      homeLead(t, out.target)
      out.target.y -= 3
      bodyUp(wounded, t, out.up)
      out.fov = 46
    },
  },
  {
    from: 29, subject: 0,
    camera(t, out) {
      // 停在海面上、慢慢往後退往上升：機群以每秒一百多公尺飛離，四秒後只剩夕陽裡幾個點
      homeLead(29, S1)
      const u = t - 29
      // 【架在長機右後方】受傷那一架在左邊，鏡頭架在它正後方的話那條煙從頭頂
      // 蓋過整個畫面。注視點抬高，近處海面粗的反光留在畫面下緣之外
      out.position.set(S1.x + 15, S1.y - 16 + 3 * u, S1.z + 110 + 15 * u)
      homeLead(t, S2)
      out.target.set(S2.x - 10, S2.y + 8 + 12 * u, S2.z)
      out.fov = 36
    },
  },
]

/** 歸航那一段飛疾風或零戰，每次進主選單抽一次 */
export function homeShot(spec: AircraftSpec): Shot {
  return {
    id: 'home',
    duration: 33,
    timeOfDay: 'dusk',
    captionKey: spec === KI84 ? 'reel.homeKi84' : 'reel.homeA6m5',
    faceSun: true,
    // 比動作範圍（約 2.6 km）大一圈：回頭看、往夕陽看的鏡頭都看得到四五公里外，
    // 圈子貼著動作畫的話剪影常常疊在島上
    clear: { x: 0, z: 0, radius: 4500 },
    planes: [
      { spec, path: homeLead },
      { spec, path: wounded },
      { spec, path: escort },
      { spec, path: wingman(homeLead, 30, 5, 26, 1.3), extra: true },
      // 右前方遠處的另一個小隊
      { spec, path: wingman(homeLead, 200, 12, -900, 0.2), extra: true },
      { spec, path: wingman(homeLead, 178, 14, -880, 2.4), extra: true },
      { spec, path: wingman(homeLead, 222, 10, -876, 4.1), extra: true },
      { spec, path: burning, extra: true },
      { spec, path: straggler, extra: true },
      // 左後方遠處的兩架
      { spec, path: wingman(homeLead, -260, 15, 700, 0.9), extra: true },
      { spec, path: wingman(homeLead, -238, 18, 726, 3.3), extra: true },
    ],
    ships: [],
    cuts: CUTS,
    camera: edit(CUTS),
    events: timeline([
      { at: 0, kind: 'smoke', actor: 1 },
      { at: 0, kind: 'smoke', actor: 7 },
      { at: 0, kind: 'smoke', actor: 8 },
      { at: BURNING_DOWN, kind: 'kill', actor: 7, blast: false },
      { at: STRAGGLER_DOWN, kind: 'kill', actor: 8, blast: false },
    ]),
  }
}
