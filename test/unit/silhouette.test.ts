import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { ALL_SPECS } from '../../src/battle/skirmish'
import { SIDE_OF } from '../../src/ui/dossier'

/**
 * 選單的機種徽章要兩份素材：`public/ui/sil/<id>.png` 的側影，與 `SIDE_OF`
 * 的陣營。
 *
 * 【為什麼要護欄】兩份都是**漏了也不會報錯**的東西 —— 圖檔不在的話
 * `mask-image` 靜靜地畫不出東西，陣營漏填的話章就不見了，兩種都只是那一格
 * 空著。加新機種的人要跑一次 `tools/blender/render_silhouettes.py`。
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
    const ids = new Set(ALL_SPECS.map((s) => `${s.id}.png`))
    expect([...FILES].filter((f) => !ids.has(f))).toEqual([])
  })
})
