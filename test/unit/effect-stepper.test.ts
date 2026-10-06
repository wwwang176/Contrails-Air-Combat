import { describe, expect, it, vi } from 'vitest'
import { createEffectStepper, type EffectStepPools } from '../../src/render/effectStepper'
import { createImpacts, pushImpact } from '../../src/world/events'

function setup() {
  const order: string[] = []
  const pool = (name: string) => ({
    emit: vi.fn(() => { order.push(name + '.emit') }),
    step: vi.fn(() => { order.push(name + '.step') }),
  })
  const fireEvents = createImpacts()
  const sprayEvents = createImpacts()
  const smokeEvents = createImpacts()
  const wrecks = {
    anchors: {}, fireEvents, sprayEvents, splashEvents: createImpacts(),
    step: vi.fn(() => {
      order.push('wrecks.step')
      fireEvents.count = 0
      sprayEvents.count = 0
      pushImpact(fireEvents, 10, 20, 30, 4, 5, 6)
      pushImpact(sprayEvents, 10, 0, 30, 0, 1, 0)
    }),
  }
  const debris = {
    smokeEvents, sprayEvents: createImpacts(),
    step: vi.fn(() => {
      order.push('debris.step')
      smokeEvents.count = 0
      pushImpact(smokeEvents, 40, 50, 60, 0, 1, 0)
    }),
  }
  let mistBorn = false
  let mistStepped = false
  const deps = {
    wrecks, debris,
    emitWreckFirePuff: vi.fn(() => { order.push('wreckFire') }),
    sparks: pool('sparks'), blastSparks: pool('blastSparks'),
    smoke: pool('smoke'), spray: pool('spray'), splashes: pool('splashes'),
    fireball: pool('fireball'), steam: pool('steam'), shipFireSmoke: pool('shipFireSmoke'),
    wreckFireSmoke: pool('wreckFireSmoke'), blastChunks: pool('blastChunks'),
    blastGlow: pool('blastGlow'), blastEmber: pool('blastEmber'), blastSmoke: pool('blastSmoke'),
    blastDust: pool('blastDust'), flakBursts: pool('flakBursts'), blastLights: pool('blastLights'),
    blastJets: { step: () => { mistBorn = true } },
    blastMist: { step: () => { mistStepped = mistBorn } },
    BLAST_POOLS: {
      fireball: pool('blastFire'), smoke: pool('blastSmoke'), dust: pool('blastDust'),
      spray: pool('spray'), jets: pool('jets'), splashEvents: createImpacts(),
    },
  }
  // 只需要實作推進器會呼叫的方法，不需要 GPU 資源
  const step = createEffectStepper(deps as unknown as EffectStepPools)
  return { deps, step, order, mistStepped: () => mistStepped }
}

describe('共用特效步進', () => {
  it('同幀消費殘骸與零件的新事件，水柱生成的水霧也在同幀更新', () => {
    const { deps, step, order, mistStepped } = setup()
    const terrain = { heightAt: () => 0, waterAt: () => 0 }
    step(0.1, 3, terrain, 20)
    expect(deps.emitWreckFirePuff).toHaveBeenCalledWith(10, 20, 30, 4)
    expect(order.indexOf('wrecks.step')).toBeLessThan(order.indexOf('wreckFire'))
    expect(order.indexOf('debris.step')).toBeLessThan(order.indexOf('smoke.emit'))
    expect(order.indexOf('smoke.emit')).toBeLessThan(order.indexOf('smoke.step'))
    expect(deps.blastChunks.step).toHaveBeenCalledWith(0.1, deps.wrecks.anchors)
    expect(deps.blastGlow.step).toHaveBeenCalledWith(0.1, deps.wrecks.anchors)
    expect(mistStepped()).toBe(true)
  })

  it('不需要 World；換地形與暫停後使用新的高度函式和當前時間', () => {
    const { deps, step } = setup()
    const oldTerrain = { heightAt: () => 20, waterAt: () => -Infinity }
    const newTerrain = { heightAt: () => 0, waterAt: () => 0 }
    step(0.1, 1, oldTerrain, 100)
    step(0, 2, newTerrain, 200)
    expect(deps.wrecks.step).toHaveBeenLastCalledWith(0, newTerrain.heightAt, newTerrain.waterAt, 200)
    expect(deps.debris.step).toHaveBeenLastCalledWith(0, newTerrain.heightAt, newTerrain.waterAt, 200)
    expect(deps.blastSparks.step).toHaveBeenLastCalledWith(200)
    expect(deps.splashes.emit).toHaveBeenLastCalledWith(deps.debris.sprayEvents, newTerrain.heightAt, 200)
    expect(deps.smoke.step).toHaveBeenLastCalledWith(0)
  })
})
