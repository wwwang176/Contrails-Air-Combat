import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { barrage, body, edit, rampedOffset, timeline, wingman, type Cut, type Path, type Shot } from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、1,500 m。
//   0–8   長機左翼尖外的特寫，機首與四具發動機
//   8–16  編隊正下方仰拍，高砲在四周炸開
//   16–25 後組左翼那一架中彈冒煙，鏡頭貼在它右後方；23 秒掉隊往左下滑
//   25–34 編隊後下方的遠鏡頭：編隊飛遠，殘骸拖著煙往下掉

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

const STREAM_SPEED = 75
const STREAM_ALT = 1500
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, -STREAM_SPEED * t)
const STREAM_HIT = 4
const stragglerBase = wingman(streamLead, -105, -51, 150, 2.6)
const straggler: Path = (t, out) => {
  stragglerBase(t, out)
  out.x -= rampedOffset(t, 23, 3, 6)
  out.y -= rampedOffset(t, 23, 3, 9)
  return out
}
const escort = (dx: number, dy: number, dz: number, phase: number): Path => (t, out) => {
  streamLead(t, out)
  out.x += dx + 110 * Math.sin(0.33 * t + phase)
  out.y += dy + 14 * Math.sin(0.47 * t + phase)
  out.z += dz
  return out
}

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 左前方斜看：機首、座艙與左翼兩具發動機都在畫面裡，機身往右後方延伸
      body(streamLead, t, -30, 3, -24 + 0.6 * t, true, out.position)
      body(streamLead, t, -3, 0, 3, true, out.target)
      out.fov = 45
    },
  },
  {
    from: 8, subject: 0,
    camera(t, out) {
      streamLead(t, S1)
      out.position.set(S1.x - 40, S1.y - 200, S1.z + 150 - 4 * (t - 8))
      out.target.set(S1.x - 35, S1.y - 22, S1.z + 75)
      out.fov = 52
    },
  },
  {
    from: 16, subject: STREAM_HIT,
    camera(t, out) {
      body(straggler, t - 0.2, 26, 7, 48, true, out.position)
      body(straggler, t, 0, 0, -10, true, out.target)
      out.fov = 42
    },
  },
  {
    from: 25, subject: 0,
    camera(t, out) {
      streamLead(25, S1)
      out.position.set(S1.x - 160, S1.y - 120, S1.z + 420)
      streamLead(t, S2)
      out.target.set(S2.x - 50, S2.y - 70, S2.z + 120)
      out.fov = 40
    },
  },
]

export const STREAM: Shot = {
  id: 'stream',
  duration: 34,
  timeOfDay: 'noon',
  captionKey: 'reel.stream',
  faceSun: false,
  clear: { x: 0, z: -1300, radius: 3000 },
  planes: [
    { spec: B17G, path: streamLead },
    { spec: B17G, path: wingman(streamLead, -35, -6, 30, 0.9) },
    { spec: B17G, path: wingman(streamLead, 35, 6, 30, 1.7) },
    { spec: B17G, path: wingman(streamLead, -70, -45, 120, 0.3), extra: true },
    { spec: B17G, path: straggler },
    { spec: B17G, path: wingman(streamLead, -35, -39, 150, 3.4), extra: true },
    { spec: P51D, path: escort(70, 120, -40, 0) },
    { spec: P51D, path: escort(-90, 140, -90, Math.PI), extra: true },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(101, 6, 30, 1.4, (t, out) => streamLead(t, out).add(S3.set(-40, -20, 90)),
      { x: 170, yLo: -70, yHi: 90, z: 220 }, edit(CUTS), 70),
    { at: 16, kind: 'smoke', actor: STREAM_HIT },
    { at: 27, kind: 'kill', actor: STREAM_HIT, blast: false },
  ]),
}
