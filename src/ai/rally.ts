import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'

const FWD = new Vector3(0, 0, -1)
const R = makeScratch(1)
/** 位置誤差退化的下限，m */
const MIN_ERROR = 1e-6

/**
 * 瞄準集合點的方向，寫進 `out`（單位向量）。就地修改，不碰 `self`。
 *
 * 【為什麼不像 `stationCommand` 那樣近距離改平行飛】站位是一個要**維持**
 * 的狀態，飛機會長期停在誤差趨近 0 的地方，那時方向由浮點雜訊主導。集合點
 * 不是 —— 它的用途是「到了就解除」，而 `arriveRadius`（300 m）遠大於雜訊
 * 尺度，飛機根本不會逼近到誤差為 0。**這是刻意的簡化，不是漏掉。**
 *
 * 熱路徑：不配置。
 */
export function rallyAim(self: Aircraft, point: Vector3, out: Vector3): void {
  const err = R.v[0]!.copy(point).sub(self.state.position)
  const len = err.length()
  if (len < MIN_ERROR) {
    // 【已經在點上】方向沒有定義。回機首而不是留 NaN —— NaN 流進指揮儀之後
    // 所有比較都變成 false，飛機會靜靜地亂飛而且完全不報錯
    out.copy(FWD).applyQuaternion(self.state.orientation)
    return
  }
  out.copy(err).divideScalar(len)
}

/**
 * 飛向集合點。寫滿整個 `Command`（含 `firing = false`）。
 *
 * 【為什麼油門是常數 WEP 而不是像 `stationCommand` 那樣連續調節】站位要
 * **維持相對速度**，所以需要一個比例控制器；撤離只要「盡快到」。而且撤離的
 * 目的正是把能量補回來 —— 全推力本身就是手段的一部分。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`。
 */
export function rallyCommand(self: Aircraft, point: Vector3, out: Command): void {
  rallyAim(self, point, out.aimWorld)
  out.throttle = WEP_THROTTLE
  out.brake = 0
  // 開火紀律是獨立的一層（fire.ts）。撤離途中不開槍
  out.firing = false
}
