import { Vector3 } from 'three'
import { HE111 } from '../../specs/he111'
import { body, edit, wingman, type Cut, type Path, type Shot } from './kit'

// ── 雷雨空襲 ───────────────────────────────────────────────
//
// 暴雨，He 111 編隊冒雨轟炸島上的港口。局部原點是群島最大那座島的島心（`site: 'island'`）。
//   0–8   長機右後方跟拍

const S1 = new Vector3()

const SPEED = 85
const ALT = 900
const lead: Path = (t, out) => out.set(0, ALT, 1200 - SPEED * t)

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      body(lead, t, 30, 8, 60, true, out.position)
      lead(t, S1)
      out.target.copy(S1)
      out.fov = 45
    },
  },
]

export const RAID: Shot = {
  id: 'raid',
  duration: 30,
  timeOfDay: 'storm',
  captionKey: 'reel.raid',
  faceSun: false,
  site: 'island',
  clear: { x: 0, z: 0, radius: 3000 },
  planes: [
    { spec: HE111, path: lead },
    { spec: HE111, path: wingman(lead, -40, -5, 40, 0.7) },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: [],
}
