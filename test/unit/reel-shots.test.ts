import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createReelCamera, rampedOffset, reelShots, type Shot } from '../../src/app/reelShots'
import { SHIP_CLASSES } from '../../src/world/ships'

const STEP = 0.1
const shots = [...reelShots(0.2), reelShots(0.8)[4]!]

/** 這一架在 `t` 已經交給殘骸池了嗎 */
function killedBy(shot: Shot, actor: number, t: number): boolean {
  return shot.events.some((e) => e.kind === 'kill' && e.actor === actor && e.at <= t)
}

function shipAt(shot: Shot, k: number, t: number, out: Vector3): Vector3 {
  const s = shot.ships[k]!
  return out.set(s.x - Math.sin(s.heading) * s.speed * t, 0, s.z - Math.cos(s.heading) * s.speed * t)
}

describe('rampedOffset：平順加上去的加速度', () => {
  it('二階差分就是加速度：起點 0、`d` 之後等於 a', () => {
    const h = 1e-3
    const acc = (t: number) =>
      (rampedOffset(t + h, 5, 2, 8) - 2 * rampedOffset(t, 5, 2, 8) + rampedOffset(t - h, 5, 2, 8)) / (h * h)
    expect(acc(4.9)).toBeCloseTo(0, 3)
    expect(acc(6)).toBeCloseTo(4, 1)
    expect(acc(8)).toBeCloseTo(8, 2)
  })
})

describe.each(shots.map((s) => [s.id + (s.id === 'home' ? `:${s.planes[0]!.spec.id}` : ''), s] as const))(
  '分鏡 %s',
  (_name, shot) => {
    const cam = createReelCamera()
    const a = new Vector3()
    const b = new Vector3()
    const ship = new Vector3()
    const times: number[] = []
    for (let t = 0; t <= shot.duration + 1e-9; t += STEP) times.push(t)

    it('事件照時間排、都在片長之內', () => {
      for (let k = 1; k < shot.events.length; k++) {
        expect(shot.events[k]!.at).toBeGreaterThanOrEqual(shot.events[k - 1]!.at)
      }
      for (const e of shot.events) expect(e.at).toBeLessThan(shot.duration)
    })

    it('飛機、船與鏡頭整段都在宣告的開闊海面圓內', () => {
      const inside = (p: Vector3, what: string, t: number): void => {
        expect(Math.hypot(p.x - shot.clear.x, p.z - shot.clear.z), `${what} t=${t.toFixed(1)}`)
          .toBeLessThan(shot.clear.radius)
      }
      for (const t of times) {
        shot.camera(t, cam)
        inside(cam.position, '鏡頭', t)
        shot.planes.forEach((p, i) => {
          if (!killedBy(shot, i, t)) inside(p.path(t, a), `#${i}`, t)
        })
        for (let k = 0; k < shot.ships.length; k++) inside(shipAt(shot, k, t, ship), `船 ${k}`, t)
      }
    })

    it('鏡頭在海面上至少 6 m，經過船的上空時高過桅杆', () => {
      for (const t of times) {
        shot.camera(t, cam)
        expect(cam.position.y, `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(6)
        for (let k = 0; k < shot.ships.length; k++) {
          shipAt(shot, k, t, ship)
          const r = SHIP_CLASSES[shot.ships[k]!.cls].radius
          if (Math.hypot(cam.position.x - ship.x, cam.position.z - ship.z) < r) {
            expect(cam.position.y, `經過船 ${k}，t=${t.toFixed(1)}`).toBeGreaterThan(55)
          }
        }
      }
    })

    it('還沒被擊落的飛機離海面至少 15 m，飛過船時高過桅杆', () => {
      for (const t of times) {
        shot.planes.forEach((p, i) => {
          if (killedBy(shot, i, t)) return
          p.path(t, a)
          expect(a.y, `#${i} t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(15)
          for (let k = 0; k < shot.ships.length; k++) {
            shipAt(shot, k, t, ship)
            const r = SHIP_CLASSES[shot.ships[k]!.cls].radius
            if (Math.hypot(a.x - ship.x, a.z - ship.z) < r) {
              expect(a.y, `#${i} 飛過船 ${k}，t=${t.toFixed(1)}`).toBeGreaterThan(55)
            }
          }
        })
      }
    })

    it('任兩架都不相撞（距離大於兩者半翼展之和）', () => {
      for (const t of times) {
        for (let i = 0; i < shot.planes.length; i++) {
          if (killedBy(shot, i, t)) continue
          shot.planes[i]!.path(t, a)
          for (let j = i + 1; j < shot.planes.length; j++) {
            if (killedBy(shot, j, t)) continue
            shot.planes[j]!.path(t, b)
            const minimum = (shot.planes[i]!.spec.wing.span + shot.planes[j]!.spec.wing.span) / 2
            expect(a.distanceTo(b), `#${i}–#${j} t=${t.toFixed(1)}`).toBeGreaterThan(minimum)
          }
        }
      }
    })

    it('主角在它的時間窗裡都在畫面內（16:9 與 4:3）', () => {
      for (const aspect of [16 / 9, 4 / 3]) {
        const c = new PerspectiveCamera(50, aspect, 1, 100000)
        for (const t of times) {
          if (t < shot.hero.from || t > shot.hero.to) continue
          shot.camera(t, cam)
          c.fov = cam.fov
          c.updateProjectionMatrix()
          c.position.copy(cam.position)
          c.lookAt(cam.target)
          c.updateMatrixWorld()
          shot.planes[shot.hero.actor]!.path(t, a)
          a.project(c)
          expect(Math.abs(a.x), `aspect ${aspect.toFixed(2)} t=${t.toFixed(1)}`).toBeLessThan(0.95)
          expect(Math.abs(a.y), `aspect ${aspect.toFixed(2)} t=${t.toFixed(1)}`).toBeLessThan(0.95)
          expect(a.z, `在鏡頭後面 t=${t.toFixed(1)}`).toBeLessThan(1)
        }
      }
    })
  },
)
