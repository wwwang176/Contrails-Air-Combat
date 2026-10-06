import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { CAMPAIGNS, MISSIONS } from '../../src/battle/missions'
import { briefingOf } from '../../src/ui/briefing'
import { HANGAR_ORDER, MISSION_ONLY_SIDE, SIDE_OF } from '../../src/ui/dossier'

/**
 * 選單的機種徽章要兩份素材：`public/ui/sil/<id>.png` 的側影，與 `SIDE_OF`
 * 的陣營。
 *
 * 【為什麼要護欄】兩份都是**漏了也不會報錯**的東西 —— 圖檔不在的話
 * `mask-image` 靜靜地畫不出東西，陣營漏填的話章就不見了，兩種都只是那一格
 * 空著。
 */
const FILES = new Set(readdirSync('public/ui/sil'))

describe('機種徽章的素材', () => {
  it('每台飛機都有側影圖', () => {
    expect(ALL_SPECS.filter((s) => !FILES.has(`${s.id}.png`)).map((s) => s.id)).toEqual([])
  })

  it('每台飛機都有陣營', () => {
    expect(ALL_SPECS.filter((s) => SIDE_OF[s.id] === undefined).map((s) => s.id)).toEqual([])
  })

  it('沒有多餘的側影圖', () => {
    const ids = new Set([...ALL_SPECS.map((s) => s.id), ...Object.keys(MISSION_ONLY_SIDE)].map((id) => `${id}.png`))
    expect([...FILES].filter((f) => !ids.has(f))).toEqual([])
  })

  it('只在簡報露面的機種有側影圖，而且不在遭遇戰與機庫的清單裡', () => {
    const only = Object.keys(MISSION_ONLY_SIDE)
    expect(only.length).toBeGreaterThan(0)
    expect(only.filter((id) => !FILES.has(`${id}.png`))).toEqual([])
    expect(only.filter((id) => ALL_SPECS.some((s) => s.id === id) || SIDE_OF[id] !== undefined
      || HANGAR_ORDER.includes(id))).toEqual([])
  })

  it('任何一張卡的簡報列出的機種，都有側影圖與陣營章', () => {
    const ids = new Set<string>()
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) {
        const b = briefingOf(m)
        for (const u of [...(b.mine ?? []), ...(b.foe ?? [])]) ids.add(u.id)
      }
    }
    expect([...ids].filter((id) => !FILES.has(`${id}.png`))).toEqual([])
    expect([...ids].filter((id) => SIDE_OF[id] === undefined && MISSION_ONLY_SIDE[id] === undefined)).toEqual([])
  })
})
