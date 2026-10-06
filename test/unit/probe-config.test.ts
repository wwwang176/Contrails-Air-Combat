import { describe, expect, it, vi } from 'vitest'
import { withProbeConfig } from '../tools/probe-config'

describe('同步探針設定覆寫', () => {
  it('整場共用覆寫，結束後保留物件身分並還原數值', () => {
    const config = { pitch: 1, margin: 2 }
    const consumer = config
    withProbeConfig(config, '{"pitch":0}', 'TP', () => {
      expect(consumer).toEqual({ pitch: 0, margin: 2 })
    })
    expect(consumer).toBe(config)
    expect(config).toEqual({ pitch: 1, margin: 2 })
  })

  it('量測失敗仍還原兩層設定，並保留原始錯誤', () => {
    const steer = { pitch: 1 }
    const doctrine = { margin: 2 }
    const failure = new Error('量測失敗')
    expect(() => withProbeConfig(steer, '{"pitch":0}', 'TP', () => {
      withProbeConfig(doctrine, '{"margin":800}', 'DP', () => {
        expect(steer.pitch).toBe(0)
        expect(doctrine.margin).toBe(800)
        throw failure
      })
    })).toThrow(failure)
    expect(steer).toEqual({ pitch: 1 })
    expect(doctrine).toEqual({ margin: 2 })
  })

  it.each([
    '{', 'null', '[]', '0', '"pitch"',
    '{"pitch":0,"margin":2}', '{"pitch":"0"}',
    '{"pitch":null}', '{"pitch":true}', '{"pitch":1e999}',
    '{"toString":0}', '{"__proto__":0}',
  ])('拒絕錯誤設定且不啟動量測：%s', (json) => {
    const config = { pitch: 1 }
    const run = vi.fn()
    expect(() => withProbeConfig(config, json, 'TP', run)).toThrow(/TP/)
    expect(run).not.toHaveBeenCalled()
    expect(config).toEqual({ pitch: 1 })
  })

  it('第二層設定無效時，也會還原已套用的第一層', () => {
    const steer = { pitch: 1 }
    const doctrine = { margin: 2 }
    const run = vi.fn()
    expect(() => withProbeConfig(steer, '{"pitch":0}', 'TP', () => {
      withProbeConfig(doctrine, '{"pitch":0}', 'DP', run)
    })).toThrow(/DP.*pitch/)
    expect(run).not.toHaveBeenCalled()
    expect(steer.pitch).toBe(1)
    expect(doctrine.margin).toBe(2)
  })

  it.each([undefined, '', '{}'])('沒有覆寫時照常量測：%s', (json) => {
    const config = { pitch: 1 }
    const run = vi.fn(() => expect(config.pitch).toBe(1))
    withProbeConfig(config, json, 'TP', run)
    expect(run).toHaveBeenCalledOnce()
  })
})
