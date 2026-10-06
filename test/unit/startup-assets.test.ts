import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadingScreen } from '../../src/ui/loading'
import { preloadStartupAssets } from '../../src/app/startupAssets'

const loaders = vi.hoisted(() => ({ aircraft: vi.fn(), ships: vi.fn(), ground: vi.fn(), balloon: vi.fn() }))
vi.mock('../../src/render/geometry/buildAircraft', () => ({
  AIRCRAFT_MODEL_COUNT: 2, preloadAircraftModels: loaders.aircraft,
}))
vi.mock('../../src/render/shipAssets', () => ({ preloadShipModels: loaders.ships }))
vi.mock('../../src/render/geometry/ground', () => ({
  groundModelUrls: () => ['ground.glb'], preloadGroundModels: loaders.ground,
}))
vi.mock('../../src/render/balloons', () => ({
  BALLOON_MODEL_COUNT: 1, preloadBalloonModel: loaders.balloon,
}))

beforeEach(() => Object.values(loaders).forEach((loader) => loader.mockReset()))

function fixture() {
  const calls: string[] = []
  const loading: LoadingScreen = {
    show: vi.fn(), hide: vi.fn(),
    hold: vi.fn(async () => { calls.push('hold') }),
    step: vi.fn(async (label) => { calls.push(label) }),
    set: vi.fn(),
    finish: vi.fn(async () => { calls.push('finish') }),
  }
  loaders.aircraft.mockImplementation(async (done: () => void) => {
    calls.push('aircraft'); done(); done()
  })
  loaders.ships.mockImplementation(async (_ids: string[], done: () => void) => {
    calls.push('ships'); for (let i = 0; i < 4; i++) done()
  })
  loaders.ground.mockImplementation(async (_ids: undefined, done: () => void) => {
    calls.push('ground'); done()
  })
  loaders.balloon.mockImplementation(async (done: () => void) => {
    calls.push('balloon'); done()
  })
  return { calls, loading }
}

describe('啟動模型預載', () => {
  it('依序載入所有模型，進度包含氣球與四種艦船，完成後才收畫面', async () => {
    const { calls, loading } = fixture()
    await preloadStartupAssets(loading)
    expect(calls).toEqual([
      'hold', 'loading.aircraft', 'aircraft', 'loading.ships', 'ships',
      'loading.ground', 'ground', 'balloon', 'finish',
    ])
    expect(loaders.ships).toHaveBeenCalledWith(['essex', 'wichita', 'fletcher', 'lst'], expect.any(Function))
    expect(loaders.ground).toHaveBeenCalledWith(undefined, expect.any(Function))
    expect(loading.step).toHaveBeenNthCalledWith(1, 'loading.aircraft', 0)
    expect(loading.step).toHaveBeenNthCalledWith(2, 'loading.ships', 2 / 8)
    expect(loading.step).toHaveBeenNthCalledWith(3, 'loading.ground', 6 / 8)
    expect(loading.set).toHaveBeenCalledTimes(8)
    expect(loading.set).toHaveBeenLastCalledWith('loading.ground', 1)
    expect(loading.finish).toHaveBeenCalledWith('loading.done')
  })

  it('飛機尚未載完時不開始船艦，也不提前收畫面', async () => {
    const { loading } = fixture()
    let finish!: () => void
    const started = new Promise<void>((resolve) => {
      loaders.aircraft.mockImplementation(() => { resolve(); return new Promise<void>((r) => { finish = r }) })
    })
    const pending = preloadStartupAssets(loading)
    await started
    expect(loaders.ships).not.toHaveBeenCalled()
    expect(loading.finish).not.toHaveBeenCalled()
    finish()
    await pending
    expect(loading.finish).toHaveBeenCalledOnce()
  })

  it('模型載入失敗時傳回錯誤並保持遮罩，不讓選單使用缺失樣板', async () => {
    const { loading } = fixture()
    const error = new Error('模型載入失敗')
    loaders.ground.mockRejectedValue(error)
    await expect(preloadStartupAssets(loading)).rejects.toBe(error)
    expect(loaders.balloon).not.toHaveBeenCalled()
    expect(loading.finish).not.toHaveBeenCalled()
    expect(loading.hide).not.toHaveBeenCalled()
  })
})
