import { describe, it, expect } from 'vitest'
import { createFireball } from '../../src/render/fireball'
import { createSmoke } from '../../src/render/smoke'
import { createSpray, WATER_COLOR } from '../../src/render/spray'

describe('粒子池的歸零（M10 spec §5.5）', () => {
  // 【為什麼一次測三個】火球、煙、噴濺都是 createParticles 包出來的，
  // 一個 reset() 同時解決三個。分開測才看得出來三個都真的拿到了。
  const pools = [
    ['火球', () => createFireball()],
    ['煙', () => createSmoke()],
    ['噴濺', () => createSpray(WATER_COLOR)],
  ] as const

  for (const [name, make] of pools) {
    it(`${name}：reset 之後存活數歸零`, () => {
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      expect(p.live).toBeGreaterThan(0)
      p.reset()
      expect(p.live).toBe(0)
      p.dispose()
    })

    it(`${name}：reset 之後再 step 也不會冒出東西`, () => {
      // 【為什麼要多這一條】只把 live 歸零、不清 age 的話，下一次 step
      // 會把那些還沒到壽命的粒子重新算成活的 —— 上一場的煙會出現在新的一場。
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      p.reset()
      p.step(1 / 60)
      expect(p.live).toBe(0)
      p.dispose()
    })

    it(`${name}：reset 之後還能正常再用`, () => {
      const p = make()
      for (let i = 0; i < 20; i++) p.emit(0, 100, 0, 1, 2, 3)
      p.reset()
      p.emit(0, 100, 0, 1, 2, 3)
      expect(p.live).toBe(1)
      p.dispose()
    })
  }
})
