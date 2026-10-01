import { describe, expect, it } from 'vitest'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'
import { G4M_MODEL } from '../../src/render/geometry/g4m.model'
import { HE111_MODEL } from '../../src/render/geometry/he111.model'
import { JU87_MODEL } from '../../src/render/geometry/ju87.model'
import { KI84_MODEL } from '../../src/render/geometry/ki84.model'
import { A6M5_BOMB_LOADOUT, KI84_BOMB_LOADOUT, loadoutOf } from '../../src/weapons/stores'

/**
 * 投彈的操作方式由「模型有沒有 `bombPoint`」決定（`main.ts` 的 `syncBombLoad`）：
 * 有 → `B` 切機腹瞄準視角；沒有而且掛炸彈 → `B` 直接投。
 */
describe('投彈的操作方式', () => {
  it('Ju 87 直接投彈：沒有機腹瞄準視角，掛的是炸彈', () => {
    expect(JU87_MODEL.bombPoint).toBeNull()
    expect(loadoutOf('ju87')?.kind).toBe('bomb')
  })

  it('掛彈戰鬥機同樣直接投彈', () => {
    expect(KI84_MODEL.bombPoint).toBeNull()
    expect(KI84_BOMB_LOADOUT.kind).toBe('bomb')
    expect(A6M5_BOMB_LOADOUT.kind).toBe('bomb')
  })

  it('多發轟炸機仍有機腹瞄準視角', () => {
    for (const [id, model] of [['b17g', B17G_MODEL], ['he111', HE111_MODEL], ['g4m', G4M_MODEL]] as const) {
      expect(model.bombPoint, id).not.toBeNull()
      expect(loadoutOf(id), id).not.toBeNull()
    }
  })
})
