import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 俯衝警笛的接線護欄 —— **讀 `main.ts` 與 `audio/engine.ts` 的原始碼**，寫法同 `audio-wiring.test.ts`。
 * 曲線與目錄各有單元測試；這裡守的是「有沒有接上」。接漏的壞法不會報錯，只是某一種視角聽不到警笛
 * （自己、上帝視角、隊友與敵人各走一條路）。
 */
const read = (p: string): string => new TextDecoder().decode(readFileSync(p)).replace(/\r\n/g, '\n')
const MAIN = read('src/main.ts')
const CONTROLLER = read('src/app/battleAudioController.ts')
const FLIGHT = read('src/audio/flightAudio.ts').split('\n').map(line => line.replace(/^  /, '')).join('\n')
const LOOPS = read('src/audio/aircraftLoopAudio.ts').split('\n').map(line => line.replace(/^  /, '')).join('\n')
const ENGINE = read('src/audio/engine.ts')

/** 從 `head` 那一行起、到下一個頂層 `}` 為止的函式本體 */
function body(src: string, head: string): string {
  const lines = src.split('\n')
  const at = lines.findIndex((l) => l.includes(head))
  expect(at, head).toBeGreaterThanOrEqual(0)
  let end = at + 1
  while (end < lines.length && lines[end] !== '}') end++
  return lines.slice(at, end + 1).join('\n')
}

describe('警笛：音訊引擎', () => {
  /** 【三個地方都要登記】`Record` 的型別只強制其中一部分，字面量與陣列不會被檢查 */
  it('定位池有警笛、自己的槽位有警笛', () => {
    expect(ENGINE).toMatch(/export type SelfSlot = [^\n]*'siren'/)
    expect(ENGINE).toMatch(/export type LoopPool = [^\n]*'siren'/)
    expect(ENGINE).toMatch(/LOOP_VOICES: Record<LoopPool, number> = \{[^}]*siren: 4/)
    expect(ENGINE).toMatch(/LOOP_CATEGORY: Record<LoopPool, Category> = \{[^}]*siren: 'siren'/)
    expect(ENGINE).toMatch(/SELF_CATEGORY: Record<SelfSlot, Category> = \{[^}]*siren: 'sirenSelf'/)
    expect(ENGINE).toMatch(/const loops: Record<LoopPool, LoopVoice\[\]> = \{[^}]*siren: \[\]/)
    expect(ENGINE).toMatch(/for \(const slot of \[[^\]]*'siren'[^\]]*\] as SelfSlot\[\]\)/)
  })

  /**
   * 【每架自己的增益要進 HDR】警笛的音量隨空速在 −50 到 0 dB 之間變。只看類別增益的話，
   * 一架幾乎沒在動的警笛也被當成全音量，會把其他聲音壓下去，而且不報錯。
   */
  it('定位循環可以帶每架自己的增益，而且進 HDR 的峰值、響度估計與實際增益', () => {
    expect(ENGINE).toMatch(/assign\(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number,\s*gainDb\?: number\): void/)
    const assign = body(ENGINE, 'function assign(')
    expect(assign).toContain('v.extraDb = gainDb')
    expect(assign).toMatch(/CATEGORY\[cat\]\.gainDb \+ \(makeup\.get\(file\) \?\? 0\) \+ gainDb/)
    expect(assign).toMatch(/gainOf\(file, cat, absorptionDb\(d\) \+ duck \+ gainDb\)/)
    expect(body(ENGINE, 'function framePeak(')).toContain('+ v.extraDb')
  })
})

describe('警笛：主程式', () => {
  const main = body(CONTROLLER, 'function update(')
  const self = body(FLIGHT, 'function update(')
  const fn = body(LOOPS, 'function update(')

  /** 【自己的不定位、坐在座艙裡才有】上帝視角時鏡頭在世界裡，不定位的聲音會變成「在耳邊」 */
  it('自己的警笛：只有坐在座艙裡且這型有檔才播，音量與音高來自 sirenParams', () => {
    expect(self).toMatch(/sirenParams\(vneRatio, noseDownRad\(me\.aircraft\.state\.orientation\), SIREN\)/)
    expect(self).toMatch(/audio\.selfLoop\('siren', flying && sirenSelf !== null \? sirenSelf : null, SIREN\.rate, SIREN\.gainDb\)/)
    expect(self).toMatch(/const sirenSelf = sirenFile\(spec\.id\)/)
  })

  /**
   * 【別人的與上帝視角的自己走定位池】隊友、敵人都在裡面；上帝視角時自己那架也算一架。
   * 條件缺哪一項的症狀：缺 alive／retired → 死掉的還在叫；缺 `c === me && flying` → 坐在座艙裡
   * 聽到兩份（自己的加定位在機身上的）；缺可聞門檻 → 巡航的也佔掉四個聲道、抬高 HDR 的窗口。
   */
  it('定位的警笛：活著、沒退場、不是座艙裡的自己、這型有檔、過了可聞門檻', () => {
    expect(fn).toMatch(/!c\.alive \|\| c\.retired \|\| \(c === me && flying\) \|\| sirenFile\(c\.aircraft\.spec\.id\) === null/)
    expect(fn).toMatch(/if \(SIREN\.gainDb > SIREN_AUDIBLE_DB\) AUDIO_VALID\[c\.index\] = 1/)
  })

  /**
   * 【先清再填、而且把這一架的播放速度與增益存起來】`AUDIO_VALID` 是與引擎、開火、砲塔共用的暫存，
   * 不先清的話上一段留下的 1 會讓不是警笛的飛機被當成警笛；速度與增益不存的話，`assign` 讀到上一幀（或別架）的值。
   */
  it('每一架先清可用旗標，再存這一架的播放速度與增益', () => {
    expect(fn).toMatch(/AUDIO_VALID\[c\.index\] = 0\n\s+if \(!c\.alive \|\| c\.retired/)
    expect(fn).toMatch(/SIREN_RATE\[c\.index\] = SIREN\.rate\n\s+SIREN_GAIN\[c\.index\] = SIREN\.gainDb\n\s+if \(SIREN\.gainDb > SIREN_AUDIBLE_DB\)/)
  })

  it('最近的四架進池，播放速度乘上多普勒、增益帶進去', () => {
    expect(LOOPS).toMatch(/const SIREN_KEYS = new Int32Array\(4\)/)
    expect(fn).toMatch(/nearestN\(positions, AUDIO_VALID, n, cam\.x, cam\.y, cam\.z, SIREN_KEYS\)/)
    expect(fn).toMatch(/audio\.assign\('siren', c\.index, sirenFile\(c\.aircraft\.spec\.id\)!, p\.x, p\.y, p\.z,\s*SIREN_RATE\[c\.index\]! \* dopplerRate\(p, c\.aircraft\.state\.velocity, cam, camVel\), SIREN_GAIN\[c\.index\]!\)/)
  })

  /** 【每一幀、每一架】用的是這一架自己的指示空速與機頭朝下的角度，不是自己的 */
  it('每架的速度比與機頭角度用它自己的指示空速、極速與姿態', () => {
    expect(fn).toMatch(/sirenParams\(\s*indicatedAirspeed\(c\.aircraft\.diag\.aero\.tas, c\.aircraft\.diag\.air\.sigma\) \/ c\.aircraft\.spec\.limits\.vne,\s*noseDownRad\(c\.aircraft\.state\.orientation\), SIREN\)/)
  })

  it('警笛暫存在建立時配置，主程式每幀使用同一個管理器', () => {
    expect(LOOPS).toMatch(/^const SIREN = \{ rate: 0, gainDb: 0 \}$/m)
    expect(LOOPS).toMatch(/^const SIREN_RATE = new Float32Array\(64\)$/m)
    expect(LOOPS).toMatch(/^const SIREN_GAIN = new Float32Array\(64\)$/m)
    expect(MAIN).toContain('const aircraftLoopAudio = createAircraftLoopAudio(audio, ctx.camera.position, camVel)')
    expect(main).toMatch(/aircraftLoopAudio\.update\(\s*world\.combatants, renderPositions, me, elapsed, flying,\s*battleAudioCues\.ownTurretVolley,?\s*\)/)
    expect(body(CONTROLLER, 'function reset(')).toContain('aircraftLoopAudio.reset()')
    expect(main).toContain('flightAudio.update(world, me, elapsed, worldSeconds, arenaWarning)')
  })
})
