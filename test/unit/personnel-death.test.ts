import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { GROUND_UNITS } from '../../src/specs/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createImpacts, pushImpact } from '../../src/world/events'
import { queueExplosionCues } from '../../src/audio/explosionCues'
import { CUE, createCueQueue } from '../../src/audio/queue'

/** 【用 import.meta.glob 而不是 fs】`main.ts` 抓 DOM，載進 vitest 會直接爆；讀原始碼 */
const SOURCES = import.meta.glob('../../src/main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF
const MAIN = Object.values(SOURCES)[0]!.replace(/\r\n/g, '\n')
const body = (from: string, to: string): string => {
  const at = MAIN.indexOf(from)
  return MAIN.slice(at, MAIN.indexOf(to, at))
}

describe('人死不爆炸', () => {
  it('只有步兵與迫擊砲（砲組）是人', () => {
    expect(GROUND_UNITS.filter((u) => u.personnel === true).map((u) => u.id)).toEqual(['infantry', 'mortar'])
  })

  /** 死掉的人不畫；死掉的別種單位照舊畫成焦黑 */
  it('死掉的步兵不畫，死掉的油桶堆還在', () => {
    const live = createGroundTarget(0, 'infantry', 'red', 0, 0, 0)
    const dead = createGroundTarget(1, 'infantry', 'red', 10, 0, 0)
    dead.alive = false
    const dump = createGroundTarget(2, 'fuelDump', 'red', 20, 0, 0)
    dump.alive = false
    const targets = [live, dead, dump]
    const models = createGroundModels(targets)
    models.update(targets, new Vector3(0, 100, 0))
    expect(models.object.children.map((c) => c.visible)).toEqual([true, false, true])
    models.dispose()
  })

  /** 擊毀事件照推（計數與通報要用），只有畫面、震動、火與聲音略過 */
  it('擊毀的畫面與聲音兩條路都略過人', () => {
    expect(body('function emitGroundKills', '\n}\n')).toContain('if (t !== undefined && t.unit.personnel === true) continue')
    const groundTargets = [
      createGroundTarget(0, 'infantry', 'red', 0, 0, 0),
      createGroundTarget(1, 'mortar', 'red', 1, 0, 0),
      createGroundTarget(2, 'fuelDump', 'red', 2, 0, 0),
    ]
    const groundKillEvents = createImpacts(3)
    for (let i = 0; i < 3; i++) pushImpact(groundKillEvents, i, 0, 0, i, 0, 0)
    const empty = { count: 0, data: new Float32Array(0) }
    const cues = createCueQueue(3)
    queueExplosionCues(cues, {
      groundTargets, groundKillEvents, killEvents: empty, bombEvents: empty, torpedoEvents: empty,
    }, { waterAt: () => -Infinity }, 25)
    expect(cues.count).toBe(1)
    expect(Array.from(cues.data.slice(0, 5))).toEqual([CUE.Blast, 2, 0, 0, 1])
  })

  it('略過排在放火球與點煙柱之前', () => {
    const fn = body('function emitGroundKills', '\n}\n')
    const skip = fn.indexOf('personnel === true) continue')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(fn.indexOf('emitBlast('))
    expect(skip).toBeLessThan(fn.indexOf('lightGroundFire('))
  })
})
