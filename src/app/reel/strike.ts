import { Vector3 } from 'three'
import { G4M } from '../../specs/g4m'
import {
  barrage, body, edit, rampedOffset, shipAt, timeline, wingman, type Cut, type Path, type ReelShip, type Shot,
} from './kit'

// ── 雷擊 ───────────────────────────────────────────────────
//
// 黃昏、迎著落日。三架一式陸攻貼海面 30 m 進場，巡洋艦與驅逐艦橫過前方、全艦開火。
//   0–7    長機右前方的貼身跟拍，海面往後飛
//   7–14   巡洋艦舷外的海面上：陸攻迎面衝來，右翼那一架 12.5 秒落海
//   14–21  長機後上方，拉起越過巡洋艦的桅杆
//   21–30  海面上的固定機位：剩下兩架爬升飛向夕陽

const S1 = new Vector3()
const S3 = new Vector3()

const STRIKE_SPEED = 95
const STRIKE_ALT = 30
const strikeLead: Path = (t, out) => {
  out.set(0, STRIKE_ALT + 1.0 * Math.sin(0.9 * t), -STRIKE_SPEED * t)
  // 15 秒起拉起，21 秒後以約 23° 的爬升角穩住
  out.y += rampedOffset(t, 15, 2, 10) - rampedOffset(t, 19, 2, 10)
  return out
}
const STRIKE_HIT = 2
const WICHITA: ReelShip = { cls: 'wichita', x: -100, z: -1900, heading: -Math.PI / 2, speed: 8 }
const strikeCentre: Path = (t, out) => strikeLead(t, out).add(S3.set(0, 20, -180))

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 右前方斜看回來：機首、兩具發動機與座艙都在畫面裡，機身往後收進畫面深處。
      // 正側面的話機尾會伸進左邊的選單後面
      body(strikeLead, t, 24, 3, -26, true, out.position)
      body(strikeLead, t, 0, 0, 4, true, out.target)
      out.fov = 44
    },
  },
  {
    from: 7, subject: 0,
    camera(t, out) {
      shipAt(WICHITA, t, S1)
      out.position.set(S1.x + 30, 12, S1.z + 60)
      strikeLead(t, out.target)
      // 望遠：陸攻還在七八百公尺外，壓縮之後三架與周圍的黑雲擠在一起
      out.fov = 20
    },
  },
  {
    from: 14, subject: 0,
    camera(t, out) {
      body(strikeLead, t - 0.2, 8, 7, 42, true, out.position)
      body(strikeLead, t, 0, -4, -150, true, out.target)
      out.fov = 55
    },
  },
  {
    from: 21, subject: 0,
    camera(t, out) {
      shipAt(WICHITA, 21, S1)
      out.position.set(S1.x + 140, 14, S1.z + 260)
      strikeLead(t, out.target)
      out.fov = 40
    },
  },
]

export const STRIKE: Shot = {
  id: 'strike',
  duration: 30,
  timeOfDay: 'dusk',
  captionKey: 'reel.strike',
  faceSun: true,
  clear: { x: 0, z: -1500, radius: 3000 },
  planes: [
    { spec: G4M, path: strikeLead },
    { spec: G4M, path: wingman(strikeLead, -55, 2, 60, 0.7) },
    { spec: G4M, path: wingman(strikeLead, 55, -1, 60, 2.2) },
  ],
  ships: [
    // 往 +X 開，橫過陸攻的航線
    WICHITA,
    { cls: 'fletcher', x: -700, z: -2350, heading: -Math.PI / 2, speed: 8 },
  ],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(211, 4, 19, 2, strikeCentre, { x: 200, yLo: -10, yHi: 110, z: 200 }, edit(CUTS), 80),
    { at: 6, kind: 'aa', ship: 0, actor: 0, seconds: 13, miss: 35 },
    { at: 7.5, kind: 'aa', ship: 1, actor: 1, seconds: 10, miss: 45 },
    { at: 10, kind: 'smoke', actor: STRIKE_HIT },
    { at: 12.5, kind: 'kill', actor: STRIKE_HIT, blast: false },
  ]),
}
